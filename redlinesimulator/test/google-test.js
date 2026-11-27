'use strict';
// Tests Google sign-in against a local stand-in for Google (token and user-info endpoints).
// Checks: start redirects to Google with the right settings, the callback creates an account and
// returns the session to the game, a second sign-in reuses the same account, and bad or reused
// states are refused.
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const SRV = 8191, GOOGLE = 8192, SITE = 'http://localhost:8190/game/';
let fails = 0;
function check(name, ok, extra) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); if (!ok) fails++; }

function mockGoogle() {
  return new Promise(function (resolve) {
    const s = http.createServer(function (req, res) {
      let raw = ''; req.on('data', c => raw += c);
      req.on('end', function () {
        const reply = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
        if (req.url === '/token' && req.method === 'POST') {
          const f = new URLSearchParams(raw);
          if (f.get('code') === 'good-code' && f.get('client_secret') === 'test-secret') return reply(200, { access_token: 'at-1' });
          return reply(400, { error: 'invalid_grant' });
        }
        if (req.url === '/userinfo' && req.headers.authorization === 'Bearer at-1') {
          return reply(200, { sub: 'google-123', email: 'sam@example.com', given_name: 'Sam', name: 'Sam Lee' });
        }
        reply(401, { error: 'no' });
      });
    });
    s.listen(GOOGLE, function () { resolve(s); });
  });
}

function startServer() {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(SRV), DATA_DIR: require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'rg-goog-')),
      TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
      GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
      GOOGLE_AUTH_URL: 'http://localhost:' + GOOGLE + '/auth',
      GOOGLE_TOKEN_URL: 'http://localhost:' + GOOGLE + '/token',
      GOOGLE_USERINFO_URL: 'http://localhost:' + GOOGLE + '/userinfo',
      PUBLIC_URL: 'http://localhost:' + SRV, SITE_URL: SITE
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise(function (resolve) {
    srv.stdout.on('data', function (d) { if (String(d).indexOf('port ' + SRV) >= 0) resolve(srv); });
  });
}

const get = (p, token) => fetch('http://localhost:' + SRV + p, { redirect: 'manual', headers: token ? { authorization: 'Bearer ' + token } : {} });
function fragment(loc) { return new URLSearchParams((loc || '').split('#')[1] || ''); }

(async function () {
  const g = await mockGoogle();
  const srv = await startServer();
  try {
    const st = await get('/api/google/start');
    const loc = new URL(st.headers.get('location'));
    check('start redirects to Google', st.status === 302 && loc.origin + loc.pathname === 'http://localhost:' + GOOGLE + '/auth');
    check('start sends client id and callback', loc.searchParams.get('client_id') === 'test-client' && loc.searchParams.get('redirect_uri') === 'http://localhost:' + SRV + '/api/google/callback');
    const state = loc.searchParams.get('state');

    const cb = await get('/api/google/callback?code=good-code&state=' + state);
    const f1 = fragment(cb.headers.get('location'));
    check('callback returns to the game with a token', cb.status === 302 && cb.headers.get('location').indexOf(SITE + '#') === 0 && !!f1.get('token'));
    check('callback gives the player name', f1.get('name') === 'Sam', f1.get('name'));
    const me = await get('/api/me', f1.get('token'));
    check('token from Google sign-in works', me.status === 200 && (await me.json()).name === 'Sam');

    const reuse = await get('/api/google/callback?code=good-code&state=' + state);
    check('state cannot be reused', fragment(reuse.headers.get('location')).get('error') === 'google-failed');

    const st2 = await get('/api/google/start');
    const state2 = new URL(st2.headers.get('location')).searchParams.get('state');
    const cb2 = await get('/api/google/callback?code=good-code&state=' + state2);
    const f2 = fragment(cb2.headers.get('location'));
    check('second sign-in uses the same account', f2.get('name') === 'Sam', f2.get('name'));

    const st3 = await get('/api/google/start');
    const state3 = new URL(st3.headers.get('location')).searchParams.get('state');
    const bad = await get('/api/google/callback?code=wrong-code&state=' + state3);
    check('bad code refused', fragment(bad.headers.get('location')).get('error') === 'google-failed');

    const forged = await get('/api/google/callback?code=good-code&state=not-a-real-state');
    check('forged state refused', fragment(forged.headers.get('location')).get('error') === 'google-failed');

    const pw = await fetch('http://localhost:' + SRV + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Sam', password: 'anything' }) });
    check('Google-only account cannot log in with a password', pw.status === 401);
  } catch (e) { check('test ran', false, e.message); }
  srv.kill(); g.close();
  console.log(fails ? fails + ' FAILED' : 'GOOGLE TEST OK');
  process.exit(fails ? 1 : 0);
})();
