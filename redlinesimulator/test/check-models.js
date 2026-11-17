'use strict';
// Builds every car with random customization in Node and checks geometry sanity.
// Run: THREE_PATH=/path/to/three.min.js node test/check-models.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const threePath = process.env.THREE_PATH;
const sandbox = { console, Math, document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) }, localStorage: { getItem() { return null; }, setItem() {} } };
sandbox.window = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(threePath, 'utf8'), sandbox);
['util.js', 'data.js', 'save.js', 'models.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', f), 'utf8'), sandbox, { filename: f }));
const r = JSON.parse(vm.runInContext(`
(function () {
  let seed = 7; const rnd = (n) => { seed = (seed * 16807) % 2147483647; return seed % n; };
  const out = { built: 0, draws: 0, tris: 0, bad: [] };
  CARS.forEach(function (car) {
    for (let k = 0; k < 3; k++) {
      const p = sanitizeMods({ paint: rnd(16), finish: rnd(4), wheelStyle: rnd(5), wheelColor: rnd(7), spoiler: rnd(5), stance: rnd(4), tint: rnd(4), stripe: rnd(5), stripeColor: rnd(5), underglow: rnd(6), perf: { engine: rnd(4), tires: 0, brakes: rnd(4), nitro: 0 } });
      p.driver = defaultDriver(); p.driver.helmet = rnd(4); p.driver.hair = rnd(6);
      try {
        const g = buildCarMesh(car, p, { low: k === 2 });
        let n = 0, tris = 0; g.traverse(function (o) { if (o.isMesh) { n++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
        if (g.userData.api.glow) g.remove(g.userData.api.glow);
        const bb = new THREE.Box3().setFromObject(g); const s = new THREE.Vector3(); bb.getSize(s);
        if (!(s.x > 1.5 && s.x < 2.9 && s.z > 3.3 && s.z < 6.2 && s.y > 0.9 && s.y < 2.3) || !isFinite(s.x + s.y + s.z)) out.bad.push(car.name + ' size ' + s.x.toFixed(2) + ',' + s.y.toFixed(2) + ',' + s.z.toFixed(2));
        // body normals should point outward: check the paint mesh
        const paint = g.getObjectByName('m_paint'); const pa = paint.geometry.attributes, c = new THREE.Vector3(0, 0.6, 0); let inward = 0, tot = 0;
        for (let i = 0; i < pa.position.count; i += 7) { const v = new THREE.Vector3().fromBufferAttribute(pa.position, i), nn = new THREE.Vector3().fromBufferAttribute(pa.normal, i); if (v.y > 0.25 && v.y < 1.5 && Math.abs(v.z) < 1.8) { tot++; if (nn.dot(v.clone().sub(c)) < -0.05) inward++; } }
        if (tot && inward / tot > 0.25) out.bad.push(car.name + ' normals inward ' + inward + '/' + tot);
        out.built++; out.draws += n; out.tris += tris;
      } catch (e) { out.bad.push(car.name + ' threw ' + e.message + ' ' + (e.stack || '').split('\\n')[1]); }
    }
  });
  return JSON.stringify(out);
})()`, sandbox));
console.log('built', r.built, 'cars | avg meshes', Math.round(r.draws / r.built), '| avg triangles', Math.round(r.tris / r.built));
if (r.bad.length) { console.error(r.bad.slice(0, 12).join('\n')); process.exit(1); }
console.log('models OK');
