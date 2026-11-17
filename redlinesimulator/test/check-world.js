'use strict';
// Builds every map headlessly and checks roads, events, traps, colliders, spawn.
// Run: THREE_PATH=/path/to/three.min.js node test/check-world.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctxStub = () => new Proxy({}, { get: (t, k) => k === 'createImageData' ? (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {} , set: () => true });
const sandbox = { console, Math, performance, document: { createElement: () => ({ width: 0, height: 0, getContext: ctxStub }) }, localStorage: { getItem() { return null; }, setItem() {} } };
sandbox.window = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(process.env.THREE_PATH, 'utf8'), sandbox);
['util.js', 'data.js', 'save.js', 'models.js', 'terrain.js', 'world.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', f), 'utf8'), sandbox, { filename: f }));
const out = vm.runInContext(`
(function () {
  const rep = [], bad = [];
  MAPS.forEach(function (m, i) {
    const t0 = performance.now(); let W;
    try { W = buildWorld(i, 2); } catch (e) { bad.push(m.name + ' threw ' + e.message + ' ' + (e.stack || '').split('\\n').slice(1, 3).join('|')); return; }
    const dt = Math.round(performance.now() - t0);
    let inst = 0, draws = 0; W.chunks.forEach(function (g) { g.children.forEach(function (c) { inst += c.count; draws++; }); });
    const len = W.net.roads.reduce(function (s, r) { return s + r.route.len; }, 0);
    const sp = W.spawn, g = {}; W.ground(sp.x, sp.z, g);
    if (!(g.surf === 0)) bad.push(m.name + ' spawn not on road d=' + (W.onRoad(sp.x, sp.z) ? 'on' : 'off'));
    if (W.events.length < 8) bad.push(m.name + ' events ' + W.events.length);
    if (W.traps.length < 4) bad.push(m.name + ' traps ' + W.traps.length);
    W.events.forEach(function (e) { if (!isFinite(e.x + e.z + e.h) || e.route.len < 500) bad.push(m.name + ' bad event ' + e.id + ' len ' + e.route.len); });
    // outer ring tight curvature check
    let kmax = 0; W.net.roads.forEach(function (r) { if (r.kind !== 'gridH' && r.kind !== 'gridV') for (let k = 3; k < r.route.n - 3; k++) kmax = Math.max(kmax, r.route.k[k]); });
    if (kmax > 1 / 28) bad.push(m.name + ' tight curve radius ' + Math.round(1 / kmax));
    rep.push(m.name + ': build ' + dt + 'ms roads ' + W.net.roads.length + ' ' + Math.round(len / 1000) + 'km, instances ' + inst + ' (' + draws + ' meshes), events ' + W.events.length + ', traps ' + W.traps.length + ', minRadius ' + Math.round(1 / kmax) + 'm');
    W.dispose();
  });
  return JSON.stringify({ rep: rep, bad: bad });
})()`, sandbox);
const r = JSON.parse(out); console.log(r.rep.join('\n'));
if (r.bad.length) { console.error(r.bad.join('\n')); process.exit(1); }
console.log('world OK');
