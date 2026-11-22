'use strict';
// Starts the server on a spare port with a temporary data folder and checks register, login, save and logout.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const PORT = 8197, BASE = 'http://localhost:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-acc-'));
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DATA }), stdio: ['ignore', 'pipe', 'pipe'] });
let fails = 0;
function check(name, ok, extra) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); if (!ok) fails++; }
async function call(method, p, body, token) {
  const r = await fetch(BASE + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
(async function () {
  await new Promise(r => setTimeout(r, 1200));
  try {
    const reg = await call('POST', '/api/register', { name: 'Bilal_1', password: 'secret1' });
    check('register', reg.status === 200 && reg.body.token, JSON.stringify(reg.status));
    const dup = await call('POST', '/api/register', { name: 'bilal_1', password: 'secret1' });
    check('duplicate name refused (case-insensitive)', dup.status === 409);
    const weak = await call('POST', '/api/register', { name: 'ab', password: '123' });
    check('bad name and short password refused', weak.status === 400);
    const bad = await call('POST', '/api/login', { name: 'Bilal_1', password: 'wrong' });
    check('wrong password refused', bad.status === 401);
    const login = await call('POST', '/api/login', { name: 'Bilal_1', password: 'secret1' });
    check('login with right password', login.status === 200 && login.body.token);
    const tok = login.body.token;
    const me = await call('GET', '/api/me', null, tok);
    check('me with token', me.status === 200 && me.body.name === 'Bilal_1');
    const noAuth = await call('GET', '/api/save');
    check('save needs login', noAuth.status === 401);
    const empty = await call('GET', '/api/save', null, tok);
    check('no save yet returns null', empty.status === 200 && empty.body.save === null);
    const put = await call('PUT', '/api/save', { money: 12345, owned: { '3': {} } }, tok);
    check('save uploaded', put.status === 200);
    const got = await call('GET', '/api/save', null, tok);
    check('save read back', got.body.save && got.body.save.money === 12345);
    const out = await call('POST', '/api/logout', null, tok);
    check('logout', out.status === 200);
    const after = await call('GET', '/api/me', null, tok);
    check('token dead after logout', after.status === 401);
    const stored = fs.readFileSync(path.join(DATA, 'users.json'), 'utf8');
    check('password not stored in plain text', stored.indexOf('secret1') < 0);
  } catch (e) { check('test ran', false, e.message); }
  srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(fails ? fails + ' FAILED' : 'ACCOUNTS TEST OK');
  process.exit(fails ? 1 : 0);
})();
