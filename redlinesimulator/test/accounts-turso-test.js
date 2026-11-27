'use strict';
// Runs the account flow with the Turso storage path, against test/turso-mock.js (a local stand-in
// for Turso's HTTP API). Restarts the server in the middle to check that accounts, sessions and
// saves are kept in the database and not only in memory.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const mock = require('./turso-mock');
const PORT = 8195, MOCK_PORT = 8196, TOKEN = 'test-token';
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-turso-'));
const DB_FILE = path.join(DIR, 'mock.db');
const BASE = 'http://localhost:' + PORT;
let fails = 0;
function check(name, ok, extra) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); if (!ok) fails++; }

function startServer() {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATA_DIR: path.join(DIR, 'unused'),
      TURSO_DATABASE_URL: 'http://localhost:' + MOCK_PORT, TURSO_AUTH_TOKEN: TOKEN
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise(function (resolve) {
    srv.stdout.on('data', function (d) { if (String(d).indexOf('port ' + PORT) >= 0) resolve(srv); });
  });
}

async function call(method, p, body, token) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}

(async function () {
  let srv, mockSrv;
  try {
    mockSrv = await mock.start(MOCK_PORT, DB_FILE, TOKEN);
    srv = await startServer();

    const reg = await call('POST', '/api/register', { name: 'Bilal_2', password: 'secret1' });
    check('register (Turso)', reg.status === 200 && reg.body.token, String(reg.status));
    const dup = await call('POST', '/api/register', { name: 'bilal_2', password: 'secret1' });
    check('duplicate name refused (Turso)', dup.status === 409);
    const bad = await call('POST', '/api/login', { name: 'Bilal_2', password: 'wrong' });
    check('wrong password refused (Turso)', bad.status === 401);
    const login = await call('POST', '/api/login', { name: 'Bilal_2', password: 'secret1' });
    check('login (Turso)', login.status === 200 && login.body.token);
    const tok = login.body.token;
    const put = await call('PUT', '/api/save', { money: 12345, owned: { '3': {} } }, tok);
    check('save uploaded (Turso)', put.status === 200);
    const put2 = await call('PUT', '/api/save', { money: 99999 }, tok);
    check('save replaced (Turso)', put2.status === 200);

    // Restart the game server; the database keeps the data.
    srv.kill(); await new Promise(r => setTimeout(r, 300));
    srv = await startServer();

    const me = await call('GET', '/api/me', null, tok);
    check('session survives restart', me.status === 200 && me.body.name === 'Bilal_2');
    const got = await call('GET', '/api/save', null, tok);
    check('save survives restart', got.body && got.body.save && got.body.save.money === 99999);
    const login2 = await call('POST', '/api/login', { name: 'Bilal_2', password: 'secret1' });
    check('login survives restart', login2.status === 200);
    const out = await call('POST', '/api/logout', null, tok);
    check('logout (Turso)', out.status === 200);
    const after = await call('GET', '/api/me', null, tok);
    check('token dead after logout (Turso)', after.status === 401);
    const raw = fs.readFileSync(DB_FILE);
    check('password not stored in plain text (Turso)', raw.indexOf('secret1') < 0);
  } catch (e) { check('test ran', false, e.message); }
  if (srv) srv.kill();
  if (mockSrv) mockSrv.close();
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(fails ? fails + ' FAILED' : 'ACCOUNTS TURSO TEST OK');
  process.exit(fails ? 1 : 0);
})();
