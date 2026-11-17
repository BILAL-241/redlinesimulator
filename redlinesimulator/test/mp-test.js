'use strict';
// Multiplayer end-to-end test: starts server/server.js, opens two browser pages, checks they see each other.
// THREE_DIR=<node_modules/three> SHOTS=<dir> NODE_PATH=$(npm root -g) node test/mp-test.js
const fs = require('fs'), path = require('path'), { spawn } = require('child_process'), { chromium } = require('playwright');
const THREE_DIR = process.env.THREE_DIR, SHOTS = process.env.SHOTS || '/tmp/shots', PORT = 8123;
fs.mkdirSync(SHOTS, { recursive: true });
const errors = []; let fails = 0;
const check = (name, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); if (!ok) fails++; };
(async () => {
  const srv = spawn('node', [path.join(__dirname, '../server/server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 620 } }), page = await ctx.newPage();
    page.on('pageerror', e => errors.push(name + ' pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(name + ' console: ' + m.text()); });
    await page.route('**/*', route => {
      const u = route.request().url();
      if (u.startsWith('http://localhost:' + PORT)) return route.continue(); // game + websocket come from the real server
      if (u.includes('three.min.js')) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(THREE_DIR, 'build/three.min.js')) });
      const m = u.match(/examples\/js\/(.+\.js)$/); if (m) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(THREE_DIR, 'examples/js', m[1])) });
      return route.abort();
    });
    await page.goto('http://localhost:' + PORT + '/'); await page.waitForFunction(() => typeof Game !== 'undefined' && Game.mode === 'menu', null, { timeout: 60000 });
    await page.evaluate(n => { settings.quality = 'low'; applyQuality(); SAVE.driver.name = n; SAVE.map = 0; SAVE.pos = null; }, name);
    return page;
  };
  const A = await mk('Alice'), B = await mk('Bobby');
  // Alice: settings path (custom address + room). Bobby: one-click button with the default address and saved room.
  await A.click('#m-mp-cfg'); await A.fill('#mp-url', 'ws://localhost:' + PORT); await A.fill('#mp-room', 'testroom'); await A.click('#mp-connect');
  await A.waitForFunction(() => Net.status === 'on', null, { timeout: 10000 }); await A.click('#mp-close');
  await B.evaluate(() => { Net.room = 'testroom'; Net.saveCfg(); });
  await B.evaluate(() => document.getElementById('m-mp').click());
  await B.waitForFunction(() => Net.status === 'on', null, { timeout: 60000 });
  await A.evaluate(() => Game.start());
  for (const p of [A, B]) await p.waitForFunction(() => Game.mode === 'roam' && Game.W, null, { timeout: 90000 });
  // Bob starts next to Alice
  const apos = await A.evaluate(() => ({ x: Game.player.x, z: Game.player.z, h: Game.player.h }));
  await B.evaluate(a => { Game.teleport(a.x + 6, a.z + 8, a.h); }, apos);
  await B.waitForTimeout(500);
  // Alice drives forward in sim; frames render so the net loop runs
  await A.evaluate(() => { Input.poll = function () {}; Input.throttle = 1; });
  for (let i = 0; i < 6; i++) { await A.evaluate(() => { for (let k = 0; k < 90; k++) Game.simStep(SIM_DT); Game.frame(1 / 15); }); await B.evaluate(() => Game.frame(1 / 15)); await B.waitForTimeout(250); }
  const sa = await A.evaluate(() => ({ n: Object.keys(Net.remotes).length, joined: Net.joined, x: Game.player.x, z: Game.player.z }));
  const sb = await B.evaluate(() => { const r = Object.values(Net.remotes)[0]; return { n: Object.keys(Net.remotes).length, name: r && r.name, seen: r && r.seen, vis: r && r.mesh.visible, x: r && r.x, z: r && r.z, badge: document.getElementById('h-mp').textContent }; });
  console.log(JSON.stringify(sa), JSON.stringify(sb));
  check('Alice sees Bobby', sa.n === 1); check('Bobby sees Alice', sb.n === 1 && sb.name === 'Alice' && sb.seen);
  check('remote car visible', !!sb.vis); check('remote position tracks', sb.seen && Math.hypot(sb.x - sa.x, sb.z - sa.z) < 40, 'dist=' + (sb.seen ? Math.hypot(sb.x - sa.x, sb.z - sa.z).toFixed(1) : 'n/a'));
  check('badge shows count', /2 online/.test(sb.badge), sb.badge);
  // chat
  await A.evaluate(() => Net.send({ t: 'chat', m: 'hello <b>there</b>' })); await B.waitForFunction(() => Net.chat.some(c => c.n === 'Alice'), null, { timeout: 15000 }).catch(() => {});
  const chat = await B.evaluate(() => ({ log: Net.chat.map(c => c.n + ':' + c.m), html: document.getElementById('h-chat').innerHTML }));
  check('chat delivered and escaped', chat.log.some(l => l === 'Alice:hello bthere/b') && !/<b>there/.test(chat.html), JSON.stringify(chat.log.slice(-1)));
  // car change broadcast
  await A.evaluate(() => { const id = CARS.findIndex(c => c.model === 'Eclipse'); SAVE.owned[id] = defaultMods(); SAVE.current = id; Game.refreshPlayer(); }); await B.waitForFunction(() => { const r = Object.values(Net.remotes)[0]; return r && r.v.car.model === 'Eclipse'; }, null, { timeout: 15000 }).catch(() => {});
  const car = await B.evaluate(() => { const r = Object.values(Net.remotes)[0]; return r ? r.v.car.model : null; });
  check('car change replicated', car === 'Eclipse', car);
  await B.evaluate(() => { Game.todT = 0; Game.frame(1 / 30); Game.frame(1 / 30); }); await B.waitForTimeout(300); await B.screenshot({ path: path.join(SHOTS, 'mp-bobby-view.png') });
  // leave
  await A.evaluate(() => Net.disconnect()); await B.waitForFunction(() => Object.keys(Net.remotes).length === 0, null, { timeout: 15000 }).catch(() => {});
  check('remote removed on disconnect', (await B.evaluate(() => Object.keys(Net.remotes).length)) === 0);
  // invalid inputs are ignored by the server
  const bad = await B.evaluate(() => { Net.send({ t: 'join', room: '<x>', map: 99, name: '<img>', car: 9999, mods: { paint: 'a' } }); return true; });
  await B.waitForTimeout(400);
  check('page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); srv.kill(); console.log(fails ? 'MP TEST FAILED' : 'MP TEST OK'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
