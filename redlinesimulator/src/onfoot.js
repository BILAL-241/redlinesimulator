'use strict';
/* ============================================================
   ON FOOT: walk around the world, get out of your car, get into
   parked cars, or steal traffic cars. Stealing raises the wanted
   level (1 to 3 stars). Police cars chase you until they catch you
   (fine, you lose the wanted level) or lose you (you get far enough
   away for long enough). Methods are merged into Game below.
   ============================================================ */

const WALK = { speed: 4.6, run: 8.5, turn: 2.6, enterR: 4.2, radius: 0.42, bustR: 3.2, lostR: 170, lostT: 14 };
const POLICE_TYPES = ['sedan', 'suv', 'wagon'];

function buildWalkerMesh(pal) {
  pal = pal || {};
  const g = new THREE.Group(), mk = function (hex, rough) { return new THREE.MeshStandardMaterial({ color: lin(hex), roughness: rough || 0.75, metalness: 0 }); };
  const suit = mk(pal.suit || '#2c3e5c'), pants = mk(pal.pants || '#1d2230'), skin = mk(pal.skin || '#c58b62'), hair = mk(pal.hair || '#1a140f'), shoe = mk(pal.shoe || '#111111');
  const part = function (geo, m, x, y, z) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; return o; };
  const legs = [], arms = [];
  [-1, 1].forEach(function (s) {
    const hip = new THREE.Group(); hip.position.set(0.12 * s, 0.92, 0);
    hip.add(part(new THREE.BoxGeometry(0.17, 0.82, 0.19), pants, 0, -0.41, 0));
    hip.add(part(new THREE.BoxGeometry(0.19, 0.12, 0.27), shoe, 0, -0.86, 0.04));
    g.add(hip); legs.push(hip);
    const sh = new THREE.Group(); sh.position.set(0.31 * s, 1.5, 0);
    sh.add(part(new THREE.BoxGeometry(0.14, 0.62, 0.15), suit, 0, -0.31, 0));
    g.add(sh); arms.push(sh);
  });
  g.add(part(new THREE.BoxGeometry(0.48, 0.66, 0.26), suit, 0, 1.25, 0));
  g.add(part(new THREE.SphereGeometry(0.16, 12, 10), skin, 0, 1.74, 0));
  const cap = part(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, 1.2), hair, 0, 1.77, 0);
  g.add(cap);
  g.userData.legs = legs; g.userData.arms = arms;
  return g;
}

Object.assign(Game, {
  /* ---------- helpers ---------- */
  targetPos: function () { return this.onFoot ? this.walk : this.player; },
  walkerInit: function () {
    if (!this.walk) { const mesh = buildWalkerMesh(); this.W.scene.add(mesh); this.walk = { x: 0, z: 0, h: 0, y: 0, mesh: mesh, phase: 0, speed: 0 }; }
    return this.walk;
  },
  roadPoint: function (x, z) { const q = {}; this.W.net.query(x, z, q); return q.road ? { x: q.px, z: q.pz } : { x: this.W.spawn.x, z: this.W.spawn.z }; },
  carName: function (car) { return car ? (car.make + ' ' + car.model) : 'car'; },

  /* ---------- finding cars ---------- */
  carNear: function () {
    const w = this.walk, best = { d: WALK.enterR, c: null };
    const consider = function (x, z, c) { const d = Math.hypot(x - w.x, z - w.z); if (d < best.d) { best.d = d; best.c = c; } };
    this.parked.forEach(function (p) { consider(p.x, p.z, { kind: 'parked', v: p }); });
    this.traffic.forEach(function (t) { if (t.active && t.knock <= 0 && t.mesh && t.mesh.userData.car) consider(t.x, t.z, { kind: 'traffic', t: t }); });
    return best.c;
  },
  carAction: function () {
    if (this.ev) { this.toast('Not during an event', true); return; }
    if (this.onFoot) {
      const c = this.carNear(); if (!c) return;
      if (c.kind === 'parked') this.getIn(c.v); else this.steal(c.t);
    } else this.getOut();
  },

  /* ---------- getting out and in ---------- */
  getOut: function () {
    const v = this.player;
    if (Math.abs(v.vf) > 3) { this.toast('Stop the car first', true); return; }
    v.parked = true; v.vx = v.vz = 0; v.hit = 0; this.parked.push(v);
    if (v.headL) v.headL.intensity = 0;
    this.headL = null;
    const w = this.walkerInit();
    w.x = v.x + Math.cos(v.h) * 3.0; w.z = v.z - Math.sin(v.h) * 3.0; // outside the car's blocking radius w.h = Math.atan2(Math.cos(v.h), -Math.sin(v.h)); w.y = this.W.heightAt(w.x, w.z);
    w.mesh.visible = true; this.onFoot = true; this.waterT = 0; this.outT = 0;
    this.toast('Out of the car', false);
  },
  getIn: function (v) {
    const i = this.parked.indexOf(v); if (i >= 0) this.parked.splice(i, 1);
    v.parked = false; v.vx = v.vz = 0; v.hit = 0;
    this.player = v; this.onFoot = false; this.walk.mesh.visible = false;
    if (v.headL) this.headL = v.headL;
    v.px = v.x; v.pz = v.z; v.ph = v.h; v.stuck = 0;
    this.camH = v.h; this.snapCamera();
    this.toast('Driving ' + this.carName(v.car), false);
  },
  makeCarVehicle: function (id, mods) {
    const v = new Vehicle(id, mods, 'player'), mesh = buildCarMesh(v.car, profileFor(id, mods), {});
    v.mesh = mesh; v.api = mesh.userData.api; v.halfL = v.api.dims.L / 2; v.halfW = Math.min(1.0, v.api.dims.W / 2);
    mesh.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    const sp = new THREE.SpotLight(0xfff0d8, 0, 110, 0.5, 0.7, 1.2); sp.position.set(0, 0.8, 1.8); sp.target.position.set(0, -0.3, 22); mesh.add(sp); mesh.add(sp.target); v.headL = sp;
    this.W.scene.add(mesh); v.api.setNight(this.W.night);
    return v;
  },
  steal: function (t) {
    const car = t.mesh.userData.car; if (!car) return;
    const mods = defaultMods(); mods.paint = Math.floor(Math.random() * PAINTS.length);
    const v = this.makeCarVehicle(car.id, mods);
    v.setPose(t.x, t.z, t.h); v.px = v.x; v.pz = v.z; v.ph = v.h;
    const g = this.W.ground(v.x, v.z, {}); v.y = g.y; v.ny = g.ny; v.nx = g.nx; v.nz = g.nz;
    // the traffic car is gone; it respawns elsewhere later
    t.active = false; t.mesh.visible = false; t.respawn = 30; t.knock = 0;
    this.player = v; this.onFoot = false; this.walk.mesh.visible = false;
    if (v.headL) this.headL = v.headL;
    this.camH = v.h; this.snapCamera();
    this.addWanted(1);
    this.toast('Stole a ' + this.carName(car) + '!', true);
  },

  /* ---------- walking ---------- */
  blockedAt: function (x, z) {
    const W = this.W, g = W.ground(x, z, {});
    if (g.water) return true;
    const cols = W.colsAt(x, z, _cl);
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.c) { if (Math.hypot(x - c.x, z - c.z) < c.hx + WALK.radius) return true; }
      else { const px = clamp(x, c.x - c.hx, c.x + c.hx), pz = clamp(z, c.z - c.hz, c.z + c.hz); if (Math.hypot(x - px, z - pz) < WALK.radius) return true; }
    }
    const cars = this.parked.concat(this.traffic.filter(function (t) { return t.active; }));
    for (let i = 0; i < cars.length; i++) { const o = cars[i]; if (Math.hypot(x - o.x, z - o.z) < (o.halfL || 2.2) * 0.9 + WALK.radius) return true; }
    return false;
  },
  stepWalk: function (dt, inp) {
    const w = this.walkerInit(), W = this.W;
    w.h += inp.steer * WALK.turn * dt;
    const fwd = inp.throttle > 0 ? 1 : (inp.brake > 0.5 ? -0.6 : 0);
    const spd = (inp.nitro && inp.throttle > 0) ? WALK.run : WALK.speed;
    const dx = Math.sin(w.h) * fwd * spd * dt, dz = Math.cos(w.h) * fwd * spd * dt;
    const moved = Math.hypot(dx, dz);
    if (moved > 0) {
      if (!this.blockedAt(w.x + dx, w.z + dz)) { w.x += dx; w.z += dz; }
      else if (!this.blockedAt(w.x + dx, w.z)) w.x += dx;
      else if (!this.blockedAt(w.x, w.z + dz)) w.z += dz;
    }
    // stay inside the map
    const d = Math.hypot(w.x, w.z), lim = TERR.r0 + 380;
    if (d > lim) { w.x *= lim / d; w.z *= lim / d; }
    const g = W.ground(w.x, w.z, _gr); w.y = g.y;
    // walk animation
    const sp = moved / Math.max(dt, 1e-6);
    w.speed += (sp - w.speed) * Math.min(1, dt * 10);
    w.phase += w.speed * dt * 1.7;
    const sw = Math.min(1, w.speed / 3) * 0.7, legs = w.mesh.userData.legs, arms = w.mesh.userData.arms;
    for (let i = 0; i < 2; i++) { const s = i === 0 ? 1 : -1; legs[i].rotation.x = Math.sin(w.phase) * sw * s; arms[i].rotation.x = -Math.sin(w.phase) * sw * s * 0.8; }
  },
  walkerReset: function () {
    const w = this.walk, p = this.roadPoint(w.x, w.z); w.x = p.x; w.z = p.z; w.y = this.W.heightAt(w.x, w.z);
    this.toast('Back on the street', false);
  },

  /* ---------- wanted level and police ---------- */
  addWanted: function (n) {
    this.wanted = Math.min(3, (this.wanted || 0) + n); this.lostT = 0;
    this.syncChasers(); this.syncCops();
  },
  spawnChaser: function () {
    const W = this.W, p = this.targetPos(), roads = W.net.roads.filter(function (r) { return r.kind !== 'spoke'; });
    const pool = CARS.filter(function (c) { return POLICE_TYPES.indexOf(c.body) >= 0 && c.tier <= 6; });
    for (let tries = 0; tries < 40; tries++) {
      const r = roads[Math.floor(Math.random() * roads.length)], rt = r.route, i = Math.floor(Math.random() * rt.n), pt = rt.p[i];
      const d = Math.hypot(pt.x - p.x, pt.z - p.z);
      if (d < 150 || d > 260) continue;
      const car = pool[Math.floor(Math.random() * pool.length)], mods = defaultMods(); mods.paint = 0; mods.tint = 2;
      const mesh = buildCarMesh(car, profileFor(car.id, mods), { noDriver: true, low: true, noShadow: true });
      const roof = (mesh.userData.api && mesh.userData.api.dims.roof) || 1.5, dims = mesh.userData.api.dims;
      const bar = new THREE.Group(), red = new THREE.MeshBasicMaterial({ color: 0xff3030 }), blue = new THREE.MeshBasicMaterial({ color: 0x3080ff });
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.22), red), br = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.22), blue);
      bl.position.set(-0.28, 0, 0); br.position.set(0.28, 0, 0); bar.add(bl, br); bar.position.set(0, roof + 0.12, 0); mesh.add(bar);
      const c = { mesh: mesh, bl: bl, br: br, x: pt.x, z: pt.z, h: Math.atan2(p.x - pt.x, p.z - pt.z), y: 0, vx: 0, vz: 0, vf: 0, speed: 0, halfL: dims.L / 2, halfW: 0.95, mass: 1.2, flash: 0 };
      W.scene.add(mesh); return c;
    }
    return null;
  },
  syncChasers: function () {
    const want = this.wanted || 0;
    while (this.chasers.length > want) { const c = this.chasers.pop(); this.W.scene.remove(c.mesh); disposeTree(c.mesh); }
    while (this.chasers.length < want) { const c = this.spawnChaser(); if (!c) break; this.chasers.push(c); }
  },
  updateChaser: function (c, dt, p) {
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz);
    const turn = wrapPi(Math.atan2(dx, dz) - c.h); c.h += clamp(turn, -1.8 * dt, 1.8 * dt);
    const top = d > 40 ? 26 : d > 14 ? 16 : 7;
    c.speed += (top - c.speed) * Math.min(1, dt * 1.5);
    c.x += Math.sin(c.h) * c.speed * dt; c.z += Math.cos(c.h) * c.speed * dt;
    c.vx = Math.sin(c.h) * c.speed; c.vz = Math.cos(c.h) * c.speed; c.vf = c.speed;
    const g = this.W.ground(c.x, c.z, {}); c.y = g.y;
    c.mesh.rotation.order = 'YXZ'; c.mesh.rotation.set(0, c.h, 0); c.mesh.position.set(c.x, c.y, c.z);
    c.flash += dt; const f = Math.floor(c.flash * 4) % 2 === 0;
    c.bl.visible = f; c.br.visible = !f;
  },
  updateWanted: function (dt) {
    if (!this.wanted) return;
    const p = this.targetPos(); let near = Infinity;
    for (let i = 0; i < this.chasers.length; i++) { const c = this.chasers[i]; this.updateChaser(c, dt, p); near = Math.min(near, Math.hypot(c.x - p.x, c.z - p.z)); }
    if (near < (this.onFoot ? WALK.bustR - 0.6 : WALK.bustR)) { this.busted(); return; }
    if (near > WALK.lostR) this.lostT = (this.lostT || 0) + dt; else this.lostT = 0;
    if (this.lostT > WALK.lostT) { this.clearWanted(); this.toast('Police lost you', false); }
  },
  busted: function () {
    this.arrest('Busted!');
  },
  // Police take the player in: fine for each star, wanted level cleared, back on the street.
  arrest: function (what) {
    const fine = Math.min(SAVE.money, 500 * Math.max(1, this.wanted || 0));
    addMoney(-fine, 'fine');
    this.clearWanted();
    if (this.onFoot) {
      this.walkerReset(); this.toast(what + ' Fined ' + fmtMoney(fine) + ' CR', true);
    } else this.respawn(what + ' Fined ' + fmtMoney(fine) + ' CR');
  },
  wantedHud: function () {
    showEl('h-wanted-card', !!this.wanted);
    if (this.wanted) setText('h-wanted', '★'.repeat(this.wanted) + '☆'.repeat(3 - this.wanted));
  },

  /* ---------- camera and hint ---------- */
  cameraWalk: function (dt) {
    const cam = GL.camera, w = this.walk;
    if (this.mode !== 'roam' && this.mode !== 'paused' && this.mode !== 'map') return;
    this.camH += wrapPi(w.h - this.camH) * (1 - Math.exp(-dt * 6));
    const sx = Math.sin(this.camH), cz = Math.cos(this.camH);
    const tx = w.x - sx * 4.2, tz = w.z - cz * 4.2, ty = w.y + 2.0, k = 1 - Math.exp(-dt * 10);
    this.camP.x += (tx - this.camP.x) * k; this.camP.z += (tz - this.camP.z) * k; this.camP.y += (ty - this.camP.y) * k;
    const gy = this.W.heightAt(this.camP.x, this.camP.z) + 0.6; if (this.camP.y < gy) this.camP.y = gy;
    cam.position.set(this.camP.x, this.camP.y, this.camP.z);
    cam.lookAt(w.x + sx * 2, w.y + 1.3, w.z + cz * 2);
    cam.fov = lerp(cam.fov, 62, Math.min(1, dt * 4)); cam.updateProjectionMatrix();
  },
  actionHint: function () {
    if (this.onFoot) {
      const c = this.carNear(); if (!c) return '';
      return '<kbd>E</kbd> ' + (c.kind === 'parked' ? 'Get in ' + this.carName(c.v.car) : 'Steal ' + this.carName(c.t.mesh.userData.car));
    }
    return Math.abs(this.player.vf) < 3 ? '<kbd>E</kbd> Get out' : '';
  }
});
