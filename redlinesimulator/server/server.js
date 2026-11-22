'use strict';
/* Redline Garage multiplayer server. No npm packages needed: run with `node server/server.js`.
   - Serves the game (dist/index.html, built automatically if missing) and the WebSocket relay on one port.
   - Rooms are keyed by "<room code>:<map index>": everyone in the same room on the same map shares one world.
   - Each client owns its car. The server validates, rate-limits and relays positions, cars and chat.
   Env: PORT (default 8080), MAX_PLAYERS (default 16), ALLOWED_ORIGINS (comma list, default: any origin). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const accounts = require('./accounts');

const PORT = Number(process.env.PORT) || 8080;
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 16;
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const TICK_MS = 66, MAX_FRAME = 4096, MAP_COUNT = 6, CAR_COUNT = 60, FLOOD_PER_SEC = 90;
const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'dist', 'index.html');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function ensureBuild() {
  if (fs.existsSync(INDEX)) return true;
  console.log('dist/index.html missing, building it now...');
  try { childProcess.execFileSync(process.execPath, [path.join(ROOT, 'build.js')], { stdio: 'inherit' }); } catch (e) { console.error('Build failed: ' + e.message); }
  return fs.existsSync(INDEX);
}

/* ---------- minimal WebSocket (RFC 6455, text frames) ---------- */
class Sock {
  constructor(socket, onMsg, onClose) {
    this.socket = socket; this.buf = Buffer.alloc(0); this.frag = null; this.fragLen = 0;
    this.open = true; this.alive = true; this.onMsg = onMsg; this.onClose = onClose;
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.close());
    socket.on('error', () => this.close());
  }
  get readyState() { return this.open ? 1 : 3; }
  onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.open) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; if (this.buf.readUInt32BE(2) > 0) return this.close(); len = this.buf.readUInt32BE(6); off = 10; }
      if (!masked || len > MAX_FRAME) return this.close(); // browsers always mask; oversized frames are dropped
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.slice(off, off + 4), payload = Buffer.from(this.buf.slice(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.slice(off + 4 + len);
      if (op === 8) return this.close();                  // close
      if (op === 9) { this.raw(10, payload); continue; }  // ping -> pong
      if (op === 10) { this.alive = true; continue; }     // pong
      if (op !== 0 && op !== 1 && op !== 2) return this.close();
      let data;
      if (op === 0) { if (!this.frag) return this.close(); this.frag.push(payload); this.fragLen += len; if (this.fragLen > MAX_FRAME) return this.close(); if (!fin) continue; data = Buffer.concat(this.frag); this.frag = null; this.fragLen = 0; }
      else if (!fin) { this.frag = [payload]; this.fragLen = len; continue; }
      else data = payload;
      this.onMsg(data.toString('utf8'));
    }
  }
  raw(op, payload) {
    if (!this.open) return;
    const n = payload.length; let head;
    if (n < 126) head = Buffer.from([0x80 | op, n]);
    else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeUInt32BE(n, 6); }
    this.socket.write(Buffer.concat([head, payload]));
  }
  send(str) { this.raw(1, Buffer.from(str, 'utf8')); }
  ping() { this.raw(9, Buffer.alloc(0)); }
  close() {
    if (!this.open) return; this.open = false;
    try { this.socket.write(Buffer.from([0x88, 0])); } catch (e) { /* ignore */ }
    try { this.socket.destroy(); } catch (e) { /* ignore */ }
    if (this.onClose) this.onClose();
  }
  terminate() { this.close(); }
}

/* ---------- rooms ---------- */
const rooms = new Map(); // key -> Map(id -> client)
const clients = new Set();
let nextId = 1;

const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>&"]/g, '').trim().slice(0, n);
function cleanMods(m) {
  const o = {}; if (!m || typeof m !== 'object') return o;
  ['paint', 'finish', 'wheelStyle', 'wheelColor', 'spoiler', 'stance', 'tint', 'stripe', 'stripeColor', 'underglow'].forEach(k => { o[k] = num(m[k], 0, 40, 0) | 0; });
  o.customPaint = typeof m.customPaint === 'string' && /^#[0-9a-f]{6}$/i.test(m.customPaint) ? m.customPaint : null;
  const p = m.perf || {}; o.perf = { engine: num(p.engine, 0, 3, 0) | 0, tires: num(p.tires, 0, 3, 0) | 0, brakes: num(p.brakes, 0, 3, 0) | 0, nitro: num(p.nitro, 0, 3, 0) | 0 };
  return o;
}
function cleanDriver(d) {
  const o = {}; d = d && typeof d === 'object' ? d : {};
  ['hair', 'hairColor', 'skin', 'suit', 'helmet', 'helmetColor'].forEach(k => { o[k] = num(d[k], 0, 40, 0) | 0; });
  return o;
}
const pub = (c) => ({ id: c.id, name: c.name, car: c.car, mods: c.mods, driver: c.driver });
const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
function bcast(room, obj, except) { const s = JSON.stringify(obj); room.forEach(c => { if (c !== except && c.ws.readyState === 1) c.ws.send(s); }); }

function leave(c) {
  if (!c.room) return;
  const room = rooms.get(c.key); c.room = null; c.st = null;
  if (!room) return;
  room.delete(c.id);
  bcast(room, { t: 'leave', id: c.id });
  if (!room.size) rooms.delete(c.key);
}

function handle(c, raw) {
  let m; try { m = JSON.parse(raw); } catch (e) { return; }
  if (!m || typeof m.t !== 'string') return;
  if (++c.msgs > FLOOD_PER_SEC) return;
  if (m.t === 'join') {
    leave(c);
    const code = clean(m.room, 16).toLowerCase() || 'public', map = num(m.map, 0, MAP_COUNT - 1, 0) | 0, key = code + ':' + map;
    let room = rooms.get(key); if (!room) { room = new Map(); rooms.set(key, room); }
    if (room.size >= MAX_PLAYERS) return send(c.ws, { t: 'err', m: 'That world is full (' + MAX_PLAYERS + ' players). Try again later.' });
    c.name = clean(m.name, 14) || 'Driver'; c.car = num(m.car, 0, CAR_COUNT - 1, 0) | 0; c.mods = cleanMods(m.mods); c.driver = cleanDriver(m.driver);
    c.key = key; c.room = room; c.st = null;
    send(c.ws, { t: 'welcome', id: c.id, room: code, map, players: Array.from(room.values()).map(pub) });
    room.set(c.id, c); bcast(room, { t: 'join', p: pub(c) }, c);
  } else if (m.t === 'leave') { leave(c); }
  else if (!c.room) { return; }
  else if (m.t === 's') {
    c.st = [c.id, num(m.x, -30000, 30000, 0), num(m.z, -30000, 30000, 0), num(m.h, -10, 10, 0), num(m.vf, -200, 200, 0), num(m.st, -1, 1, 0), m.b ? 1 : 0, num(m.vx, -200, 200, 0), num(m.vz, -200, 200, 0)];
  } else if (m.t === 'car') {
    c.car = num(m.car, 0, CAR_COUNT - 1, 0) | 0; c.mods = cleanMods(m.mods); c.driver = cleanDriver(m.driver); c.name = clean(m.name, 14) || c.name;
    bcast(c.room, { t: 'car', p: pub(c) }, c);
  } else if (m.t === 'chat') {
    const now = Date.now(); c.chatTokens = Math.min(3, c.chatTokens + (now - c.lastChat) / 1500); c.lastChat = now;
    const text = clean(m.m, 120); if (!text || c.chatTokens < 1) return; c.chatTokens -= 1;
    bcast(c.room, { t: 'chat', id: c.id, name: c.name, m: text });
  }
}

function countCarFiles() {
  try { return fs.readdirSync(path.join(ROOT, 'assets', 'models', 'vehicles')).filter(f => /\.glb$/.test(f)).length; } catch (e) { return 0; }
}

/* ---------- HTTP + upgrade ---------- */
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (accounts.handleApi(req, res, url)) return;
  if (url === '/health') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return res.end(JSON.stringify({ ok: true, game: fs.existsSync(INDEX), rooms: rooms.size, players: clients.size, carModels: countCarFiles() })); }
  if (url.indexOf('/assets/models/') === 0) { // car models: cached for a week
    const f = path.join(ROOT, decodeURIComponent(url)), dir = path.join(ROOT, 'assets', 'models') + path.sep;
    if (f.indexOf(dir) !== 0 || !fs.existsSync(f)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': 'model/gltf-binary', 'cache-control': 'public, max-age=604800' });
    return fs.createReadStream(f).pipe(res);
  }
  if (url === '/' || url === '/index.html') {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500, { 'content-type': 'text/plain' }); return res.end('dist/index.html is missing. Run "node build.js" in the project folder, then restart.'); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }); res.end(data);
    });
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found');
});

server.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'], origin = req.headers.origin || '';
  if (!key || (ORIGINS.length && ORIGINS.indexOf(origin) < 0)) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return socket.destroy(); }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  const c = { ws: null, id: nextId++, key: '', room: null, name: 'Driver', car: 0, mods: {}, driver: {}, st: null, msgs: 0, chatTokens: 3, lastChat: 0 };
  c.ws = new Sock(socket, (raw) => handle(c, raw), () => { clients.delete(c); leave(c); });
  clients.add(c);
  if (head && head.length) c.ws.onData(head);
});

/* ---------- timers ---------- */
setInterval(() => { // batched state broadcast: each player gets everyone else's latest state
  rooms.forEach(room => {
    if (room.size < 2) return;
    const all = []; room.forEach(c => { if (c.st) all.push(c.st); });
    if (!all.length) return;
    room.forEach(c => { const others = all.filter(s => s[0] !== c.id); if (others.length) send(c.ws, { t: 'S', p: others }); });
  });
}, TICK_MS);
setInterval(() => { clients.forEach(c => { c.msgs = 0; }); }, 1000);
setInterval(() => { // heartbeat: drop connections that stopped answering
  clients.forEach(c => { if (!c.ws.alive) return c.ws.terminate(); c.ws.alive = false; try { c.ws.ping(); } catch (e) { /* ignore */ } });
}, 15000);

ensureBuild();
server.listen(PORT, () => console.log('Redline Garage server on port ' + PORT + ' (max ' + MAX_PLAYERS + ' per world)'));
