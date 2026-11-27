'use strict';
/* ============================================================
   ACCOUNTS: register, log in, log out, and the saved game (garage
   and credits) per player. Passwords hashed with scrypt, sessions
   are random bearer tokens.
   Storage: Turso (libSQL over HTTP) when TURSO_DATABASE_URL and
   TURSO_AUTH_TOKEN are set. Otherwise plain JSON files in DATA_DIR
   (local development and the test without a database).
   Routes (all under /api/):
     POST /api/register   {name, password}  -> {token, name}
     POST /api/login      {name, password}  -> {token, name}
     POST /api/logout                        (Bearer token)
     GET  /api/me                            -> {name}
     GET  /api/save                          -> {save} (null if none yet)
     PUT  /api/save       <save JSON>        -> {ok}
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SAVES_DIR = path.join(DATA_DIR, 'saves');
const MAX_BODY = 600 * 1024;            // a save is a few KB; anything bigger is refused
const MAX_SESSIONS_PER_USER = 5;

const DB_URL = (process.env.TURSO_DATABASE_URL || '').trim();
const DB_TOKEN = (process.env.TURSO_AUTH_TOKEN || '').trim();
const USE_TURSO = !!(DB_URL && DB_TOKEN);
const PIPE_URL = DB_URL.replace(/^(libsql|turso):\/\//, 'https://').replace(/\/+$/, '') + '/v2/pipeline';

// Google sign-in. Off until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
const GOOGLE_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const GOOGLE_SECRET = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
const GOOGLE_ON = !!(GOOGLE_ID && GOOGLE_SECRET);
const GOOGLE_AUTH_URL = process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = process.env.GOOGLE_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, ''); // this server's own address, e.g. https://your-service.onrender.com
const SITE_URL = (process.env.SITE_URL || 'https://redlinesimulator.vercel.app/').trim(); // where players return after signing in

/* ---------- Turso over HTTP (no npm package needed) ---------- */
function dbArg(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'number') return { type: 'integer', value: String(Math.trunc(v)) };
  return { type: 'text', value: String(v) };
}
function dbCell(c) {
  if (!c || c.type === 'null') return null;
  if (c.type === 'integer' || c.type === 'float') return Number(c.value);
  return c.value;
}
// Runs one SQL statement; returns the rows as objects keyed by column name.
async function dbRun(sql, args) {
  const body = { requests: [{ type: 'execute', stmt: { sql: sql, args: (args || []).map(dbArg) } }, { type: 'close' }] };
  const r = await fetch(PIPE_URL, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + DB_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(function () { return {}; });
  const res = j.results && j.results[0];
  if (!r.ok || !res || res.type !== 'ok') {
    throw new Error('Turso ' + r.status + ': ' + JSON.stringify((res && res.error) || j).slice(0, 300));
  }
  const result = res.response.result;
  const cols = result.cols.map(function (c) { return c.name; });
  return result.rows.map(function (row) {
    const o = {};
    cols.forEach(function (name, i) { o[name] = dbCell(row[i]); });
    return o;
  });
}

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, salt TEXT NOT NULL, hash TEXT NOT NULL, created INTEGER NOT NULL, google_sub TEXT)',
  'CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, uid TEXT NOT NULL, t INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS saves (uid TEXT PRIMARY KEY, data TEXT NOT NULL)'
];

/* ---------- local files (fallback) ---------- */
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);            // replace in one step so a crash never leaves half a file
}
function fileWrite(file, data) { return Promise.resolve().then(function () { writeJson(file, data); }); }

/* ---------- in-memory copy, loaded once at start ---------- */
let users = [];       // [{id, name, salt, hash, created}]
let sessions = {};    // {token: {uid, t}}
let ready;

if (USE_TURSO) {
  ready = (async function () {
    for (const sql of SCHEMA) await dbRun(sql);
    users = await dbRun('SELECT id, name, salt, hash, created, google_sub FROM users');
    sessions = {};
    for (const r of await dbRun('SELECT token, uid, t FROM sessions')) sessions[r.token] = { uid: r.uid, t: r.t };
  })();
} else {
  fs.mkdirSync(SAVES_DIR, { recursive: true });
  users = readJson(USERS_FILE, []);
  sessions = readJson(SESSIONS_FILE, {});
  ready = Promise.resolve();
}
ready.catch(function (e) { console.error('Accounts setup failed: ' + e.message); });
console.log('Accounts storage: ' + (USE_TURSO ? 'Turso database' : 'local files in ' + DATA_DIR));

/* ---------- persistence ---------- */
async function saveUser(user) {
  if (USE_TURSO) {
    return dbRun('INSERT INTO users (id, name, salt, hash, created, google_sub) VALUES (?, ?, ?, ?, ?, ?)',
      [user.id, user.name, user.salt, user.hash, user.created, user.google_sub || null]);
  }
  return fileWrite(USERS_FILE, users.concat([user]));
}

async function persistSessions(removed, added) {
  if (USE_TURSO) {
    for (const t of removed) await dbRun('DELETE FROM sessions WHERE token = ?', [t]);
    for (const t of added) await dbRun('INSERT INTO sessions (token, uid, t) VALUES (?, ?, ?)', [t, sessions[t].uid, sessions[t].t]);
    return;
  }
  return fileWrite(SESSIONS_FILE, sessions);
}

async function readSave(uid) {
  if (USE_TURSO) {
    const rows = await dbRun('SELECT data FROM saves WHERE uid = ?', [uid]);
    return rows.length ? JSON.parse(rows[0].data) : null;
  }
  return readJson(saveFile(uid), null);
}

async function writeSave(uid, save) {
  if (USE_TURSO) {
    return dbRun('INSERT INTO saves (uid, data) VALUES (?, ?) ON CONFLICT(uid) DO UPDATE SET data = excluded.data',
      [uid, JSON.stringify(save)]);
  }
  return fileWrite(saveFile(uid), save);
}

function saveFile(userId) {
  return path.join(SAVES_DIR, userId + '.json');
}

/* ---------- accounts and sessions ---------- */
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function newToken() { return crypto.randomBytes(32).toString('hex'); }

function sessionFor(token) {
  if (!token || typeof token !== 'string' || !sessions[token]) return null;
  return users.find(u => u.id === sessions[token].uid) || null;
}

async function openSession(userId) {
  const mine = Object.keys(sessions).filter(t => sessions[t].uid === userId).sort((a, b) => sessions[a].t - sessions[b].t);
  const removed = [];
  while (mine.length >= MAX_SESSIONS_PER_USER) { const t = mine.shift(); delete sessions[t]; removed.push(t); }
  const token = newToken();
  sessions[token] = { uid: userId, t: Date.now() };
  await persistSessions(removed, [token]);
  return token;
}

function validName(name) { return typeof name === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(name); }
function validPassword(p) { return typeof p === 'string' && p.length >= 6 && p.length <= 100; }

function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0; const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, PUT, OPTIONS'
  });
  res.end(JSON.stringify(obj));
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.indexOf('Bearer ') === 0 ? h.slice(7) : '';
}

async function authRoute(req, res, key) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: 'Bad request' }); }
  if (!body || typeof body !== 'object') return send(res, 400, { error: 'Bad request' });
  const name = String(body.name || '').trim(), password = String(body.password || '');

  if (key.endsWith('register')) {
    if (!validName(name)) return send(res, 400, { error: 'Name: 3 to 16 letters, numbers or _' });
    if (!validPassword(password)) return send(res, 400, { error: 'Password: 6 to 100 characters' });
    if (users.some(u => u.name.toLowerCase() === name.toLowerCase())) return send(res, 409, { error: 'That name is taken' });
    const salt = crypto.randomBytes(16).toString('hex');
    const user = { id: crypto.randomBytes(8).toString('hex'), name: name, salt: salt, hash: hashPassword(password, salt), created: Date.now() };
    await saveUser(user);
    users.push(user);
    return send(res, 200, { token: await openSession(user.id), name: user.name });
  }

  const user = users.find(u => u.name.toLowerCase() === name.toLowerCase());
  const given = Buffer.from(hashPassword(password, user ? user.salt : 'x'), 'hex');
  const real = Buffer.from(user ? user.hash : '00', 'hex');
  const ok = !!user && given.length === real.length && crypto.timingSafeEqual(given, real);
  if (!ok) return send(res, 401, { error: 'Wrong name or password' });
  return send(res, 200, { token: await openSession(user.id), name: user.name });
}

async function route(req, res, key, token) {
  if (key === 'POST /api/register' || key === 'POST /api/login') return authRoute(req, res, key);

  if (key === 'POST /api/logout') {
    if (token && sessions[token]) { delete sessions[token]; await persistSessions([token], []); }
    return send(res, 200, { ok: true });
  }

  if (key === 'GET /api/google/start') return googleStart(req, res);
  if (key === 'GET /api/google/callback') return googleCallback(req, res);

  const user = sessionFor(token);
  if (!user) return send(res, 401, { error: 'Log in first' });

  if (key === 'GET /api/me') return send(res, 200, { name: user.name });

  if (key === 'GET /api/save') return send(res, 200, { save: await readSave(user.id) });

  if (key === 'PUT /api/save') {
    let raw;
    try { raw = await readBody(req); } catch (e) { return send(res, 413, { error: 'Save too large' }); }
    let save; try { save = JSON.parse(raw); } catch (e) { return send(res, 400, { error: 'Bad save' }); }
    if (!save || typeof save !== 'object' || Array.isArray(save)) return send(res, 400, { error: 'Bad save' });
    await writeSave(user.id, save);
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'Not found' });
}

/* ---------- Google sign-in ---------- */
// Flow: the game opens /api/google/start, which sends the player to Google. Google sends them back
// to /api/google/callback, which signs them in (creating the account on first use) and returns them
// to the game with the session token in the address fragment (#token=...).
const googleStates = new Map(); // state -> expiry time (pending sign-ins in this server's memory)

function redirect(res, location) {
  res.writeHead(302, { location: location, 'cache-control': 'no-store' });
  res.end();
}
function backToSite(res, params) {
  redirect(res, SITE_URL.replace(/#.*$/, '') + '#' + new URLSearchParams(params).toString());
}
function googleRedirectUri() { return PUBLIC_URL + '/api/google/callback'; }

function googleStart(req, res) {
  if (!GOOGLE_ON || !PUBLIC_URL) return send(res, 503, { error: 'Google sign-in is not set up' });
  const state = crypto.randomBytes(16).toString('hex');
  googleStates.set(state, Date.now() + 10 * 60 * 1000);
  const q = new URLSearchParams({
    client_id: GOOGLE_ID, redirect_uri: googleRedirectUri(), response_type: 'code',
    scope: 'openid email profile', state: state, prompt: 'select_account'
  });
  return redirect(res, GOOGLE_AUTH_URL + '?' + q.toString());
}

// A name for a new Google player: their first name or the start of their email, letters, digits and _ only.
async function newGoogleUser(info) {
  let base = String(info.given_name || info.name || String(info.email || '').split('@')[0]).replace(/[^A-Za-z0-9_]/g, '').slice(0, 10);
  if (base.length < 3) base = 'player';
  let name = base, n = 1;
  while (users.some(u => u.name.toLowerCase() === name.toLowerCase())) name = base + (++n);
  const user = { id: crypto.randomBytes(8).toString('hex'), name: name, salt: '', hash: '', created: Date.now(), google_sub: info.sub };
  await saveUser(user);
  users.push(user);
  return user;
}

async function googleCallback(req, res) {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const state = params.get('state') || '', code = params.get('code') || '';
  const expiry = googleStates.get(state);
  googleStates.delete(state);
  if (!GOOGLE_ON || !expiry || expiry < Date.now() || !code) return backToSite(res, { error: 'google-failed' });
  try {
    const tr = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code, client_id: GOOGLE_ID, client_secret: GOOGLE_SECRET,
        redirect_uri: googleRedirectUri(), grant_type: 'authorization_code'
      }).toString()
    });
    const tok = await tr.json().catch(function () { return {}; });
    if (!tok.access_token) return backToSite(res, { error: 'google-failed' });
    const ir = await fetch(GOOGLE_USERINFO_URL, { headers: { authorization: 'Bearer ' + tok.access_token } });
    const info = await ir.json().catch(function () { return {}; });
    if (!info.sub) return backToSite(res, { error: 'google-failed' });
    const user = users.find(u => u.google_sub === info.sub) || await newGoogleUser(info);
    const token = await openSession(user.id);
    return backToSite(res, { token: token, name: user.name });
  } catch (e) {
    console.error('Google sign-in failed: ' + e.message);
    return backToSite(res, { error: 'google-failed' });
  }
}

// Returns true if the request was an /api/ route (handled here), false otherwise.
function handleApi(req, res, url) {
  if (url.indexOf('/api/') !== 0) return false;
  if (req.method === 'OPTIONS') { send(res, 204, {}); return true; }
  const key = req.method + ' ' + url, token = bearer(req);
  ready.then(function () { return route(req, res, key, token); })
    .catch(function (e) {
      console.error('Accounts error: ' + e.message);
      send(res, 500, { error: 'Server error, try again' });
    });
  return true;
}

module.exports = { handleApi, DATA_DIR, USE_TURSO };
