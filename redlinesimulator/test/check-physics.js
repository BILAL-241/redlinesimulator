'use strict';
// Headless AI runs over every event route on every map (no rendering).
// Run: THREE_PATH=/path/to/three.min.js node test/check-physics.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctxStub = () => new Proxy({}, { get: (t, k) => k === 'createImageData' ? (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
const sandbox = { console, Math, performance, document: { createElement: () => ({ width: 0, height: 0, getContext: ctxStub }) }, localStorage: { getItem() { return null; }, setItem() {} } };
sandbox.window = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(process.env.THREE_PATH, 'utf8'), sandbox);
['util.js', 'data.js', 'save.js', 'models.js', 'terrain.js', 'world.js', 'vehicle.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', f), 'utf8'), sandbox, { filename: f }));
const out = vm.runInContext(`
(function () {
  const rep = [], bad = [], quick = ${process.argv.includes('quick')};
  (quick ? [0, 2] : [0, 1, 2, 3, 4, 5]).forEach(function (mi) {
    const W = buildWorld(mi, 0), tested = [];
    W.events.forEach(function (e) {
      if (e.type === 'attack' && tested.length > 4) return;
      const car = CARS[40], v = new Vehicle(car.id, defaultMods(), 'ai'); v.skill = 0.95;
      const o = e.route.at(e.s0 - 8); v.setPose(o.x, o.z, Math.atan2(o.tx, o.tz)); v.halfL = 2.2; v.halfW = 0.95;
      const L = e.route.closed ? e.laps * e.route.len : e.route.len - e.s0 - 14; let t = 0, lap = -1, ps0 = e.route.len - 8, prog = -1, stuck = 0, offT = 0, maxHit = 0, nan = false, ps = ps0; const tmp = {};
      while (t < 700) {
        const inp = aiInputs(v, e.route, [v], SIM_DT, 9999); v.step(SIM_DT, inp, W); t += SIM_DT;
        if (!isFinite(v.x + v.z + v.vf)) { nan = true; break; }
        e.route.nearest(v.x, v.z, v.hint, tmp); v.hint = tmp.i;
        if (e.route.closed) { const p2 = ((tmp.s - e.s0) % e.route.len + e.route.len) % e.route.len; if (ps > 0.75 * e.route.len && p2 < 0.25 * e.route.len) lap++; ps = p2; prog = lap * e.route.len + p2; } else prog = tmp.s - e.s0;
        if (Math.abs(v.vf) < 1.5) stuck += SIM_DT; if (!v.onRoad) offT += SIM_DT; maxHit = Math.max(maxHit, v.hit);
        if (prog >= L) break;
      }
      const ok = !nan && prog >= L;
      rep.push(W.map.name + ' / ' + e.name + ' (' + Math.round(L) + 'm): ' + (ok ? Math.round(t) + 's avg ' + Math.round(L / t * 3.6) + 'km/h' : 'DNF at ' + Math.round(prog)) + ' off-road ' + offT.toFixed(1) + 's hit ' + maxHit.toFixed(1) + ' stuck ' + stuck.toFixed(1));
      if (!ok) bad.push(W.map.name + ' ' + e.name + ' did not finish');
      else if (offT > 6) bad.push(W.map.name + ' ' + e.name + ' off-road ' + offT.toFixed(1) + 's');
      if (e.type === 'attack') tested.push(1);
    });
    // static collision: drive into the nearest collider and make sure we stop and stay finite
    const v2 = new Vehicle(40, defaultMods(), 'player'); v2.halfL = 2.2; v2.halfW = 0.95; let cmp = null;
    W.cols.forEach(function (l) { if (!cmp && l[0] && Math.hypot(l[0].x, l[0].z) > 300 && Math.hypot(l[0].x, l[0].z) < 900) cmp = l[0]; });
    if (cmp) { v2.setPose(cmp.x - 40, cmp.z, Math.PI / 2); let minD = 1e9, hit = 0; for (let i = 0; i < 90 * 8; i++) { v2.step(SIM_DT, { steer: 0, throttle: 1, brake: 0, hand: false, nitro: false }, W); hit = Math.max(hit, v2.hit); if (!isFinite(v2.x)) { bad.push('collision NaN'); break; } }
      rep.push(W.map.name + ' collision test: max impact ' + hit.toFixed(1) + ' m/s, final x ' + Math.round(v2.x) + ' (collider at ' + Math.round(cmp.x) + ')'); }
    W.dispose();
  });
  return JSON.stringify({ rep: rep, bad: bad });
})()`, sandbox);
const r = JSON.parse(out); console.log(r.rep.join('\n'));
if (r.bad.length) { console.error('PROBLEMS:\n' + r.bad.join('\n')); process.exit(1); }
console.log('physics OK');
