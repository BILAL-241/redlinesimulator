'use strict';
/* ============================================================
   NPCs: pedestrians on the pavement, traffic that brakes behind
   other cars and stops for the player, and police officers on foot
   who chase a wanted player and arrest them. Merged into Game.
   ============================================================ */

const PED_COUNT = [0, 16, 32];          // by traffic setting: off, light, busy
const PED_CULL = 260;                   // only pedestrians this close are drawn
const FOLLOW_GAP = 14, STOP_GAP = 3;     // metres: start slowing, come to a stop
const JAM_TIME = 14;                    // seconds stuck behind something before the car moves on
const COP_PAL = { suit: '#1d3a6e', pants: '#15192a', skin: '#b87a52', hair: '#0d0d0d', shoe: '#0a0a0a' };
const PED_PALS = [
  { suit: '#7a3b2e', pants: '#2a2f3d', skin: '#c58b62', hair: '#1a140f', shoe: '#101010' },
  { suit: '#d9b26a', pants: '#3d4a5c', skin: '#8d5a3b', hair: '#0a0a0a', shoe: '#2a1d14' },
  { suit: '#4e7d5b', pants: '#1f1f25', skin: '#e0b48f', hair: '#6b4a2b', shoe: '#222222' },
  { suit: '#e6e6e6', pants: '#2c3a4f', skin: '#f0c8a6', hair: '#2e2116', shoe: '#1a1a1a' },
  { suit: '#8c5ea8', pants: '#222', skin: '#a06c46', hair: '#101010', shoe: '#151515' }
];

Object.assign(Game, {
  /* ---------- pedestrians ---------- */
  spawnPeds: function () {
    this.peds = [];
    const n = PED_COUNT[settings.traffic] || 0, W = this.W; if (!n || !W) return;
    const rnd = mulberry32(W.map.seed * 91 + 17), roads = W.net.roads.filter(function (r) { return r.kind !== 'spoke' && r.kind !== 'chord'; });
    if (!roads.length) return;
    for (let i = 0; i < n; i++) {
      const r = roads[Math.floor(rnd() * roads.length)], rt = r.route, s = rt.cum[Math.floor(rnd() * rt.n)];
      const mesh = buildWalkerMesh(PED_PALS[i % PED_PALS.length]); // own mesh: clone() would lose the leg/arm references
      mesh.visible = false; W.scene.add(mesh);
      this.peds.push({ road: r, route: rt, s: s, dir: rnd() < 0.5 ? 1 : -1, side: rnd() < 0.5 ? 1 : -1, speed: 1.1 + rnd() * 0.9, phase: rnd() * 6.28, mesh: mesh, x: 0, z: 0, h: 0, y: 0, speedNow: 0 });
    }
  },
  pedPose: function (p, dt) {
    const rt = p.route, L = rt.len;
    p.s += p.dir * p.speed * dt;
    if (rt.closed) p.s = ((p.s % L) + L) % L; else if (p.s < 4 || p.s > L - 4) { p.dir = -p.dir; p.s = clamp(p.s, 4, L - 4); }
    const o = rt.at(p.s, _tp), off = p.road.w / 2 + 2.4;
    p.x = o.x + (-o.tz) * p.side * off; p.z = o.z + o.tx * p.side * off;
    p.h = Math.atan2(p.dir * o.tx, p.dir * o.tz);
    const g = this.W.ground(p.x, p.z, _gr); p.y = g.y;
    p.water = g.water;
  },
  updatePeds: function (dt) {
    if (!this.peds || !this.peds.length) return;
    const pl = this.targetPos();
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i];
      this.pedPose(p, dt);
      const d = Math.hypot(p.x - pl.x, p.z - pl.z);
      const visible = d < PED_CULL && !p.water;
      p.mesh.visible = visible;
      if (!visible) continue;
      p.mesh.position.set(p.x, p.y, p.z); p.mesh.rotation.y = p.h;
      p.phase += p.speed * dt * 1.7;
      const sw = 0.55, legs = p.mesh.userData.legs, arms = p.mesh.userData.arms;
      for (let k = 0; k < 2; k++) { const s = k === 0 ? 1 : -1; legs[k].rotation.x = Math.sin(p.phase) * sw * s; arms[k].rotation.x = -Math.sin(p.phase) * sw * s * 0.8; }
    }
  },

  /* ---------- traffic that brakes behind other cars ---------- */
  trafficFollow: function (t, dt) {
    const base = t.cruise || t.speed || 0;
    const fx = Math.sin(t.h), fz = Math.cos(t.h);
    let gap = Infinity;
    const check = function (o, halfL) {
      const dx = o.x - t.x, dz = o.z - t.z, ahead = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      if (ahead <= 0 || lat > 2.2) return;
      const g = ahead - (t.halfL + (halfL || 2.2));
      if (g < gap) gap = g;
    };
    if (!this.onFoot && !this.ev) check(this.player, this.player.halfL);
    for (let i = 0; i < this.parked.length; i++) check(this.parked[i], this.parked[i].halfL);
    for (let i = 0; i < this.chasers.length; i++) check(this.chasers[i], this.chasers[i].halfL);
    for (let i = 0; i < this.traffic.length; i++) { const o = this.traffic[i]; if (o !== t && o.active && o.knock <= 0) check(o, o.halfL); }
    let want = base;
    if (gap < FOLLOW_GAP) want = gap < STOP_GAP ? 0 : base * (gap - STOP_GAP) / (FOLLOW_GAP - STOP_GAP);
    t.speed += (want - t.speed) * Math.min(1, dt * (want < t.speed ? 4 : 1.5));
    if (t.speed < 0.05) t.speed = 0;
    // stuck for too long (e.g. a car was left on the road): move the traffic car elsewhere
    if (t.speed === 0 && gap < FOLLOW_GAP) t.jam = (t.jam || 0) + dt; else t.jam = 0;
    if (t.jam > JAM_TIME) { t.jam = 0; t.active = false; t.mesh.visible = false; t.respawn = 1; }
  },

  /* ---------- police officers on foot ---------- */
  spawnCop: function () {
    // Pick a random direction 45 to 75 m from the player, then snap to the nearest road (roads cover the whole map, so random road points rarely land near the player).
    const W = this.W, p = this.walk, q = {};
    for (let tries = 0; tries < 30; tries++) {
      const a = Math.random() * 6.2832, R = 45 + Math.random() * 30;
      W.net.query(p.x + Math.cos(a) * R, p.z + Math.sin(a) * R, q);
      if (!q.road) continue;
      const g = W.ground(q.px, q.pz, _gr); if (g.water) continue;
      const mesh = buildWalkerMesh(COP_PAL); W.scene.add(mesh);
      return { x: q.px, z: q.pz, h: 0, y: g.y, mesh: mesh, phase: Math.random() * 6.28, speed: 0 };
    }
    return null;
  },
  syncCops: function () {
    const want = this.onFoot && this.wanted ? this.wanted : 0;
    while (this.cops.length > want) { const c = this.cops.pop(); this.W.scene.remove(c.mesh); disposeTree(c.mesh); }
    while (this.cops.length < want) { const c = this.spawnCop(); if (!c) break; this.cops.push(c); }
  },
  updateCops: function (dt) {
    if (!this.cops) this.cops = [];
    this.copT = (this.copT || 0) - dt;
    if (this.copT <= 0) { this.copT = 0.5; this.syncCops(); } // throttled: spawning searches the roads
    if (!this.cops.length) return;
    const w = this.walk, W = this.W;
    if (!this.onFoot) return;
    for (let i = 0; i < this.cops.length; i++) {
      const c = this.cops[i];
      const dx = w.x - c.x, dz = w.z - c.z, d = Math.hypot(dx, dz);
      if (d < 2.0) { this.arrest('Arrested! Fined '); return; }
      const want = Math.atan2(dx, dz);
      c.h += clamp(wrapPi(want - c.h), -4 * dt, 4 * dt);
      const sp = d > 25 ? 6.2 : 5.0;
      const mx = Math.sin(c.h) * sp * dt, mz = Math.cos(c.h) * sp * dt;
      if (!this.blockedAt(c.x + mx, c.z + mz)) { c.x += mx; c.z += mz; }
      else if (!this.blockedAt(c.x + mx, c.z)) c.x += mx;
      else if (!this.blockedAt(c.x, c.z + mz)) c.z += mz;
      const g = W.ground(c.x, c.z, _gr); c.y = g.y;
      c.speed += (sp - c.speed) * Math.min(1, dt * 6); c.phase += c.speed * dt * 1.7;
      c.mesh.visible = true; c.mesh.position.set(c.x, c.y, c.z); c.mesh.rotation.y = c.h;
      const sw = Math.min(1, c.speed / 3) * 0.7, legs = c.mesh.userData.legs, arms = c.mesh.userData.arms;
      for (let k = 0; k < 2; k++) { const s = k === 0 ? 1 : -1; legs[k].rotation.x = Math.sin(c.phase) * sw * s; arms[k].rotation.x = -Math.sin(c.phase) * sw * s * 0.8; }
    }
  },
  clearWanted: function () {
    this.wanted = 0; this.lostT = 0;
    this.syncChasers(); this.syncCops();
  }
});
