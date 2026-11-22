'use strict';
/* ============================================================
   ACCOUNTS: register, log in, log out, and the saved game (garage
   and credits) per player. Plain JSON files in DATA_DIR, passwords
   hashed with scrypt, sessions are random bearer tokens.
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

fs.mkdirSync(SAVES_DIR, { recursive: true });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);            // replace in one step so a crash never leaves half a file
}

let users = readJson(USERS_FILE, []);      // [{id, name, salt, hash, created}]
let sessions = readJson(SESSIONS_FILE, {}); // {token: {uid, t}}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function newToken() { return crypto.randomBytes(32).toString('hex'); }

function sessionFor(token) {
  if (!token || typeof token !== 'string' || !sessions[token]) return null;
  return users.find(u => u.id === sessions[token].uid) || null;
}

function openSession(userId) {
  const mine = Object.keys(sessions).filter(t => sessions[t].uid === userId).sort((a, b) => sessions[a].t - sessions[b].t);
  while (mine.length >= MAX_SESSIONS_PER_USER) delete sessions[mine.shift()];
  const token = newToken();
  sessions[token] = { uid: userId, t: Date.now() };
  writeJson(SESSIONS_FILE, sessions);
  return token;
}

function validName(name) { return typeof name === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(name); }
function validPassword(p) { return typeof p === 'string' && p.length >= 6 && p.length <= 100; }

function saveFile(userId) {
  return path.join(SAVES_DIR, userId + '.json');
}

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

// Returns true if the request was an /api/ route (handled here), false otherwise.
function handleApi(req, res, url) {
  if (url.indexOf('/api/') !== 0) return false;
  if (req.method === 'OPTIONS') { send(res, 204, {}); return true; }

  const route = req.method + ' ' + url;
  const token = bearer(req);

  if (route === 'POST /api/register' || route === 'POST /api/login') {
    readBody(req).then(function (raw) {
      let body; try { body = JSON.parse(raw); } catch (e) { return send(res, 400, { error: 'Bad request' }); }
      const name = String(body.name || '').trim(), password = String(body.password || '');
      if (route.endsWith('register')) {
        if (!validName(name)) return send(res, 400, { error: 'Name: 3 to 16 letters, numbers or _' });
        if (!validPassword(password)) return send(res, 400, { error: 'Password: 6 to 100 characters' });
        if (users.some(u => u.name.toLowerCase() === name.toLowerCase())) return send(res, 409, { error: 'That name is taken' });
        const salt = crypto.randomBytes(16).toString('hex');
        const user = { id: crypto.randomBytes(8).toString('hex'), name: name, salt: salt, hash: hashPassword(password, salt), created: Date.now() };
        users.push(user); writeJson(USERS_FILE, users);
        return send(res, 200, { token: openSession(user.id), name: user.name });
      }
      const user = users.find(u => u.name.toLowerCase() === name.toLowerCase());
      const given = Buffer.from(hashPassword(password, user ? user.salt : 'x'), 'hex');
      const real = Buffer.from(user ? user.hash : '00', 'hex');
      const ok = !!user && given.length === real.length && crypto.timingSafeEqual(given, real);
      if (!ok) return send(res, 401, { error: 'Wrong name or password' });
      return send(res, 200, { token: openSession(user.id), name: user.name });
    }).catch(function (e) { send(res, 400, { error: 'Bad request' }); });
    return true;
  }

  const user = sessionFor(token);
  if (route === 'POST /api/logout') {
    if (token && sessions[token]) { delete sessions[token]; writeJson(SESSIONS_FILE, sessions); }
    return send(res, 200, { ok: true }), true;
  }
  if (!user) { send(res, 401, { error: 'Log in first' }); return true; }

  if (route === 'GET /api/me') { send(res, 200, { name: user.name }); return true; }

  if (route === 'GET /api/save') {
    const save = readJson(saveFile(user.id), null);
    send(res, 200, { save: save }); return true;
  }

  if (route === 'PUT /api/save') {
    readBody(req).then(function (raw) {
      let save; try { save = JSON.parse(raw); } catch (e) { return send(res, 400, { error: 'Bad save' }); }
      if (!save || typeof save !== 'object' || Array.isArray(save)) return send(res, 400, { error: 'Bad save' });
      writeJson(saveFile(user.id), save);
      send(res, 200, { ok: true });
    }).catch(function () { send(res, 413, { error: 'Save too large' }); });
    return true;
  }

  send(res, 404, { error: 'Not found' });
  return true;
}

module.exports = { handleApi, DATA_DIR };
