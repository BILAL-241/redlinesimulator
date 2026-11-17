'use strict';
/* ============================================================
   CARMODELS: 3D car models from assets/models/vehicles/ (one file per model, shared by cars).
   Each body type has a short list of models; cars rotate through it by id. Every model is measured from its real vertices,
   turned to face forward (+Z), centred and placed on the ground, so nothing floats or sinks.
   A car whose file is missing or fails to load uses the CarConcept model instead.
   ============================================================ */
const CarModels = {
  FALLBACK: '/assets/models/CarConcept.glb', // used for any car whose own model is missing
  FILE_TIMEOUT: 30000,   // ms per file
  TOTAL_TIMEOUT: 150000, // ms for the whole set; anything not loaded by then uses the procedural car
  tpl: {}, models: {}, ready: false, failed: 0, done: 0, total: 0,
  FOLDER: '/assets/models/vehicles/',
  // Which model each body type uses. Cars rotate through the list by id, so cars of one body type still differ.
  BODY_MODELS: {
    wedge: ['purple-hero-car', 'neon-hover-car'], coupe: ['muscle-getaway-car', 'purple-hero-car'],
    roadster: ['open-wheel-racer'], sedan: ['neon-future-cab'], hatch: ['neon-future-cab', 'neon-hover-car'],
    wagon: ['neon-future-cab'], suv: ['armoured-cash-van'], truck: ['army-cargo-truck']
  },
  fileFor: function (car) { const list = this.BODY_MODELS[car.body] || ['neon-future-cab']; return list[car.id % list.length]; },
  has: function (car) { return !!this.tpl[car.id]; },

  // Embedded copy (built into dist/index.html) when present, otherwise the file in assets/models/vehicles/.
  modelUrl: function (name) { const e = window.EMBEDDED_MODELS; return (e && e[name]) || (this.FOLDER + name + '.glb'); },
  note: function (msg) { const e = document.getElementById('m-models'); if (e) e.textContent = msg; },

  // Real extents from the actual vertices (the file's stored bounds can be wrong).
  trueBox: function (root) {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3(), v = new THREE.Vector3();
    root.traverse(function (o) {
      if (!o.isMesh || !o.geometry.attributes.position) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
    });
    return box;
  },

  // Prepare a loaded file once: face +Z, keep real metres when plausible, measure the car.
  prepare: function (key, root) {
    let box = this.trueBox(root);
    let size = box.getSize(new THREE.Vector3());
    if (size.x > size.z) { root.rotation.y = Math.PI / 2; box = this.trueBox(root); size = box.getSize(new THREE.Vector3()); }
    const len = size.z;
    const s = (len >= 3.2 && len <= 6.5) ? 1 : 4.4 / len; // real metres kept; odd units rescaled to a 4.4 m car
    const c = box.getCenter(new THREE.Vector3());
    this.models[key] = { root: root, s: s, cx: c.x, cz: c.z, minY: box.min.y, L: len * s, W: size.x * s, H: size.y * s };
  },

  load: function () {
    const self = this;
    if (!window.THREE || !THREE.GLTFLoader) { this.failed = CARS.length; this.note('Basic car models: the 3D loader script did not load. Check your connection and reload.'); return Promise.resolve(false); }
    const loader = new THREE.GLTFLoader();
    const names = {}; CARS.forEach(function (c) { names[self.fileFor(c)] = true; });
    const files = Object.keys(names); this.total = CARS.length; this.done = 0;
    this.note('Loading car models ...');
    const one = function (key, url) {
      return new Promise(function (res) {
        let finished = false;
        const t = setTimeout(function () { if (!finished) { finished = true; res(false); } }, self.FILE_TIMEOUT);
        loader.load(url, function (g) {
          if (finished) return; finished = true; clearTimeout(t);
          try { self.prepare(key, g.scene); res(true); } catch (e) { res(false); }
        }, undefined, function () { if (!finished) { finished = true; clearTimeout(t); res(false); } });
      });
    };
    const cap = new Promise(function (res) { setTimeout(res, self.TOTAL_TIMEOUT); });
    const all = Promise.all(files.map(function (f) { return one(f, self.modelUrl(f)); }).concat([one('__fallback', self.FALLBACK)]));
    return Promise.race([all, cap]).then(function () {
      const fb = self.models.__fallback;
      let missing = 0;
      CARS.forEach(function (c) {
        const m = self.models[self.fileFor(c)];
        if (m) self.tpl[c.id] = m; else if (fb) { self.tpl[c.id] = fb; missing++; } else missing++;
      });
      self.done = self.total; self.failed = missing; self.ready = true;
      if (missing === self.total) self.note('Basic car models: the 3D files are missing from assets/models/. Check your upload.');
      else if (missing) self.note((self.total - missing) + ' of ' + self.total + ' cars use their own 3D model. The rest use the CarConcept model.');
      else self.note('All ' + self.total + ' cars use 3D models.');
      return missing < self.total;
    });
  },

  make: function (car, prof, opts) {
    opts = opts || {};
    const T = this.tpl[car.id], sh = carShape(car);
    const group = new THREE.Group(), body = new THREE.Group(); body.name = 'body';
    body.scale.setScalar(T.s); group.add(body);
    const model = T.root.clone(true);
    // centre on the origin and stand on the ground (lowest point at y = 0)
    model.position.set(-T.cx, -T.minY, -T.cz); body.add(model);

    const fin = FINISHES[prof.finish], hex = prof.customPaint || PAINTS[prof.paint][1];
    const physical = function (color, o) { return regMat(new THREE.MeshPhysicalMaterial(Object.assign({ color: lin(color), metalness: fin.metal, roughness: fin.rough, clearcoat: fin.clear, clearcoatRoughness: 0.04, envMapIntensity: 0.9 }, o || {}))); };
    const paint1 = physical(hex);
    const paint2 = physical('#' + new THREE.Color(hex).multiplyScalar(0.55).getHexString());
    const glass = regMat(new THREE.MeshPhysicalMaterial({ color: lin('#06090d'), metalness: 0.85, roughness: 0.03, transparent: true, opacity: 0.3 + TINTS[prof.tint][1] * 0.68, envMapIntensity: 1.6 }));
    const rim = regMat(new THREE.MeshStandardMaterial({ color: lin(WHEEL_COLORS[prof.wheelColor][1]), roughness: 0.22, metalness: 0.92, envMapIntensity: 1.3 }));
    const head = regMat(new THREE.MeshStandardMaterial({ color: lin('#fff6e0'), emissive: lin('#fff1d0'), emissiveIntensity: 1.2, roughness: 0.2 }));
    const tail = regMat(new THREE.MeshStandardMaterial({ color: lin('#3a0508'), emissive: lin('#ff1220'), emissiveIntensity: 0.9, roughness: 0.3 }));

    const heads = [], tails = [];
    // Materials are chosen by the mesh name first (lights, glass, wheels, body panels), then by material name.
    const pick = function (m, mesh) {
      const n = (m && m.name) || '', mn = (mesh && mesh.name) || '';
      if (/Headlight/.test(mn) || /Headlight/.test(n)) { heads.push(head); return head; }
      if (/Taillight|Turnsignal|Brakelight/.test(mn) || /Brakelight|Taillight/.test(n)) { tails.push(tail); return tail; }
      if (/Glass|Windshield|Window/.test(mn) || /^Glass/.test(n)) return glass;
      if (/Rim|mesh_20|Brake|Disc|Wheel|mesh_19/.test(mn) || /^Rim/.test(n)) return rim;
      if (/^Paint 1/.test(n) || n === 'ToyCar') return paint1;
      if (/^Paint 2/.test(n)) return paint2;
      if (/^Body/.test(mn) && /Palette|Paint/.test(n)) return paint1;
      return m;
    };
    model.traverse(function (o) {
      if (!o.isMesh) return;
      o.castShadow = !opts.noShadow;
      o.material = Array.isArray(o.material) ? o.material.map(function (m) { return pick(m, o); }) : pick(o.material, o);
    });

    // underglow, same as the procedural car
    let glow = null; const ug = UNDERGLOWS[prof.underglow || 0][1];
    if (ug && !opts.low) {
      glow = new THREE.Mesh(new THREE.PlaneGeometry(sh.W * 2.3, sh.L * 1.4), new THREE.MeshBasicMaterial({ map: glowTexture(), color: lin(ug), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.95 }));
      glow.rotation.x = -Math.PI / 2; glow.position.y = 0.04; group.add(glow);
    }

    const api = {
      body: body, bodyMat: paint1, glow: glow, wheels: [], tailBase: 0.9,
      dims: { L: T.L, W: T.W, roof: T.H, wheelR: sh.R, belt: T.H * 0.7, wb: T.L * 0.6 },
      // wheels and steering are not animated on the 3D models yet
      setSteer: function () {}, roll: function () {},
      setBrake: function (on) { tails.forEach(function (m) { m.emissiveIntensity = on ? 3.6 : api.tailBase; }); },
      setNight: function (n) { api.tailBase = 0.9 + n * 0.9; heads.forEach(function (m) { m.emissiveIntensity = 0.9 + n * 3.4; }); }
    };

    group.userData.api = api;
    return group;
  }
};
