'use strict';
// Headless end-to-end test. Run:
// THREE_DIR=<node_modules/three> SHOTS=<dir> NODE_PATH=$(npm root -g) node test/browser-test.js [quick]
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const THREE_DIR = process.env.THREE_DIR, SHOTS = process.env.SHOTS || '/tmp/shots', quick = process.argv.includes('quick');
fs.mkdirSync(SHOTS, { recursive: true });
const html = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8').replace('<title>', '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>');
const errors = [];
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + ' ' + (e.stack || '').split('\n')[1]));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u === 'http://t.local/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    const am = u.match(/\/assets\/models\/(.+\.glb)$/); if (am) return route.fulfill({ contentType: 'model/gltf-binary', body: fs.readFileSync(path.join(__dirname, '../assets/models', am[1])) });
    if (u.includes('three.min.js')) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(THREE_DIR, 'build/three.min.js')) });
    const m = u.match(/examples\/js\/(.+\.js)$/); if (m) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(THREE_DIR, 'examples/js', m[1])) });
    return route.abort();
  });
  await page.goto('http://t.local/');
  await page.waitForFunction(() => typeof Game !== 'undefined' && Game.mode === 'menu', null, { timeout: 60000 });
  const shot = async n => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  await page.evaluate(() => { settings.quality = 'high'; applyQuality(); });
  await page.waitForTimeout(1500); await shot('01-menu');
  // garage tabs
  await page.click('#m-garage'); await page.waitForTimeout(1500); await shot('02-garage-cars');
  for (const t of ['shop', 'paint', 'perf', 'driver']) { await page.click('#g-tabs [data-t=' + t + ']'); await page.waitForTimeout(900); await shot('03-garage-' + t); }
  // buy a car in the dealership (give money first)
  await page.evaluate(() => { SAVE.money = 400000; UI.refreshWallet(); });
  await page.click('#g-tabs [data-t=shop]');
  await page.evaluate(() => UI.pick(CARS.findIndex(c => c.model === 'Eclipse')));
  await page.waitForTimeout(1200); await shot('04-dealer-eclipse');
  await page.click('#g-foot [data-a=buy]'); await page.waitForTimeout(800);
  await page.click('#g-tabs [data-t=paint]'); await page.click('#g-body .sw button:nth-child(9)'); await page.click('#g-tabs [data-t=perf]'); await page.click('#g-body [data-a=perf][data-k=engine][data-v="2"]');
  await page.waitForTimeout(800); await shot('05-garage-modded');
  const cost = await page.evaluate(() => modsCost(UI.g.id, SAVE.owned[UI.g.id], UI.g.draft));
  await page.click('#g-foot [data-a=apply]'); await page.waitForTimeout(500);
  const afterApply = await page.evaluate(() => ({ money: SAVE.money, eng: SAVE.owned[SAVE.current].perf.engine, paint: SAVE.owned[SAVE.current].paint }));
  console.log('apply cost', cost, afterApply);
  await page.click('#g-foot [data-a=exit]'); await page.waitForTimeout(500);
  // drive
  const maps = quick ? [0] : [0, 1, 2, 3, 4, 5];
  for (const mi of maps) {
    await page.evaluate(m => { SAVE.map = m; SAVE.pos = null; }, mi);
    await page.evaluate(() => { if (Game.W) Game.disposeWorld(); Game.start(); });
    await page.waitForFunction(() => Game.mode === 'roam' && Game.W, null, { timeout: 90000 });
    const r = await page.evaluate(() => {
      Input.poll = function () {}; Input.throttle = 1; const v = Game.player; let bad = 0;
      for (let i = 0; i < 900; i++) { Game.simStep(SIM_DT); if (!isFinite(v.x + v.z + v.vf)) bad++; }
      Input.throttle = 0; Game.todT = 0; Game.frame(1 / 30);
      return { map: Game.W.map.name, speed: Math.round(v.vf * 3.6), x: Math.round(v.x), z: Math.round(v.z), onRoad: v.onRoad, bad: bad };
    });
    console.log(JSON.stringify(r));
    await page.evaluate(() => {
      const W = Game.W, rt = W.F.links[0].route, o = rt.at(420), v = Game.player; Game.teleport(o.x, o.z, Math.atan2(o.tx, o.tz)); Game.camH = v.h; Game.snapCamera();
      Input.throttle = 1; for (let i = 0; i < 160; i++) Game.simStep(SIM_DT); Input.throttle = 0; Game.hours = 15; Game.todT = 0; Game.frame(1 / 30); Game.frame(1 / 30); Game.frame(1 / 30);
    });
    await shot('10-map' + mi + '-day');
    if (mi === 0 || mi === 2) { await page.evaluate(() => { Game.hours = 22; Game.todT = 0; Game.frame(1 / 30); Game.frame(1 / 30); }); await shot('11-map' + mi + '-night'); }
  }
  // event run on the last map: player follows the AI controller
  const ev = await page.evaluate(() => {
    const e = Game.W.events.find(x => x.type === 'sprint'); Game.teleport(e.x - Math.sin(e.h) * 20, e.z - Math.cos(e.h) * 20, e.h); Game.startEvent(e);
    const v = Game.player, E = Game.ev; v.skill = 0.97; let n = 0, bad = 0;
    for (let i = 0; i < 90 * 120 && !E.results; i++) {
      if (Game.ev !== E) break;
      const inp = E.state === 'countdown' ? null : aiInputs(v, E.route, [v].concat(E.rivals), SIM_DT, 9999);
      if (inp) { Input.steer = inp.steer; Input.throttle = inp.throttle; Input.brake = inp.brake; Input.nitro = inp.nitro; }
      Game.simStep(SIM_DT); n++; if (!isFinite(v.x)) bad++;
    }
    return { name: e.name, steps: n, state: E.state, rank: v.rank, finished: v.finished, t: v.finishT, bad: bad, results: !!E.results, money: SAVE.money };
  });
  console.log('event', JSON.stringify(ev));
  await page.evaluate(() => Game.frame(1 / 30)); await shot('20-results');
  await page.evaluate(() => Game.closeResults()); await page.waitForTimeout(300);
  await page.evaluate(() => { Game.openMap(); Game.frame(1 / 30); }); await shot('21-bigmap');
  await page.evaluate(() => { Game.closeMap(); Game.resume(); });
  const real = errors.filter(e => !/Failed to load resource/.test(e));
  console.log(real.length ? 'ERRORS:\n' + real.slice(0, 10).join('\n') : 'no console errors');
  await browser.close();
  process.exit(real.length ? 1 : 0);
})().catch(e => { console.error('TEST FAILED', e); process.exit(2); });
