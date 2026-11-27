'use strict';
/* ============================================================
   GAME: open-world session. Roaming, events, traffic, income,
   camera, HUD, pause, autosave and the main loop.
   Modes: menu | garage | roam | paused | map  (event state lives in Game.ev)
   ============================================================ */

const $ = function (id) { return document.getElementById(id); };
const _ht = {};
function setText(id, v) { const e = $(id); if (!e) return; v = String(v); if (_ht[id] !== v) { _ht[id] = v; e.textContent = v; } }
function setW(id, pct) { const e = $(id); if (!e) return; const v = Math.round(pct * 10) / 10 + '%'; if (_ht['w' + id] !== v) { _ht['w' + id] = v; e.style.width = v; } }
function showEl(id, on) { const e = $(id); if (e) e.hidden = !on; }
function unitSpeed(ms) { return settings.units === 'mph' ? ms * 2.23694 : ms * 3.6; }

const RIVAL_NAMES = ['K. Mori', 'A. Vega', 'J. Okafor', 'L. Brandt', 'S. Rahim', 'M. Duarte', 'T. Novak', 'E. Lindqvist', 'R. Salazar', 'H. Park'];
const PLACE_PAY = [1, 0.6, 0.4, 0.25, 0.15, 0.1];
const TRAFFIC_SIZE = [0, 12, 22];

const Game = {
  mode: 'boot', W: null, mapIdx: -1, env: null, player: null, rivals: [], traffic: [], trafficPool: [], ev: null, wp: null,
  hours: 12, acc: 0, simT: 0, camH: 0, camP: { x: 0, y: 0, z: 0 }, camShake: 0, saveT: 0, todT: 0, hintT: 0, nearEv: null, nearTrap: null,
  drift: { score: 0, t: 0, quiet: 0 }, kmAcc: 0, lastHit: 0, outT: 0, waterT: 0, coolMiss: 0, toastT: 0, cashT: 0, cashSum: 0, pauseFrom: 'roam',
  smoke: null, spark: null, flame: null, headL: null, last: 0, fatalCount: 0, loading: false, traps: {}, pose: {}, keepWorld: false,

  /* ---------------------------- boot ---------------------------- */
  init: function () {
    if (!initGL()) return false;
    Input.init(); Garage.init();
    const tex = softTexture(); this.smoke = new Particles(500, false, tex); this.spark = new Particles(160, true, tex); this.flame = new Particles(120, true, tex);
    this.worldEnv = makeWorldEnv(GL.renderer);
    GL.onRebuild = function () { Game.rebuildAfterLoss(); };
    GL.onQuality = function () { Game.applyShadowFlags(); };
    window.onMoney = function (n, why) { Game.cash(n, why); };
    this.hours = SAVE.clock[MAPS[SAVE.map].id] !== undefined ? SAVE.clock[MAPS[SAVE.map].id] : MAPS[SAVE.map].start;
    this.toMenu();
    this.last = performance.now();
    const self = this;
    const loop = function (now) {
      requestAnimationFrame(loop);
      const dt = clamp((now - self.last) / 1000, 0, 0.1); // never negative: rAF time can be a few ms behind performance.now() self.last = now;
      try { self.frame(dt); self.fatalCount = 0; }
      catch (e) {
        if (window.console) console.error(e);
        if (++self.fatalCount > 5) { self.fatalCount = 0; try { self.toMenu(); } catch (e2) { showFatal('Something went wrong. Reload the page to continue. Your progress is saved.'); } }
      }
    };
    requestAnimationFrame(loop);
    document.addEventListener('visibilitychange', function () { if (document.hidden) self.autoPause(); });
    window.addEventListener('blur', function () { self.autoPause(); });
    window.addEventListener('pagehide', function () { self.savePos(); persist(); });
    return true;
  },
  rebuildAfterLoss: function () {
    // texture-heavy objects are rebuilt after a context loss
    const wasWorld = this.W !== null; this.disposeWorld(); Garage.leave(); Garage.showroom = null; Garage.init(); this.worldEnv = makeWorldEnv(GL.renderer);
    applyQuality(); if (wasWorld) this.toMenu(); else this.toMenu();
  },
  autoPause: function () { if (this.mode === 'roam') this.pause(); },

  /* ---------------------------- modes ---------------------------- */
  toMenu: function () {
    this.savePos(); persist();
    if (this.ev) this.endEvent(true);
    this.disposeWorld();
    this.mode = 'menu'; Sound.silence();
    Garage.leave(); Garage.active = true; Garage.show(SAVE.current, SAVE.owned[SAVE.current]); Garage.setFocus('car');
    UI.show('menu'); showEl('touch', false);
  },
  disposeWorld: function () {
    Net.leaveWorld();
    if (this.player && this.player.mesh) { this.player.mesh.parent && this.player.mesh.parent.remove(this.player.mesh); }
    this.clearRivals(); this.clearTraffic();
    if (this.W) { this.smoke.clear(); this.spark.clear(); this.flame.clear(); this.W.dispose(); this.W = null; }
    this.player = null; this.mapIdx = -1; this.wp = null; this.nearEv = null;
  },
  start: function () { // from menu: continue where we left off
    const self = this;
    UI.loading(true);
    setTimeout(function () {
      try { self.enterWorld(); } catch (e) { if (window.console) console.error(e); UI.loading(false); showFatal('Could not build this map: ' + e.message); }
      UI.loading(false);
    }, 40);
  },
  enterWorld: function () {
    if (this.W && this.mapIdx !== SAVE.map) this.disposeWorld();
    Garage.leave(); Garage.active = false;
    if (!this.W) this.buildWorld(SAVE.map);
    else this.refreshPlayer();
    this.mode = 'roam'; UI.show('hud'); this.updateTouch(); Input.clearPressed(); Sound.init(); Sound.setMuted(!settings.sound);
    this.acc = 0; this.last = performance.now();
  },
  buildWorld: function (idx) {
    const map = MAPS[idx], q = qualityLevel();
    this.W = buildWorld(idx, q); this.mapIdx = idx; const W = this.W;
    this.onFoot = false; this.walk = null; this.parked = []; this.chasers = []; this.cops = []; this.peds = []; this.wanted = 0; this.lostT = 0;
    W.scene.environment = this.worldEnv; [this.smoke.points, this.spark.points, this.flame.points].forEach(function (p) { W.scene.add(p); });
    this.hours = SAVE.clock[map.id] !== undefined ? SAVE.clock[map.id] : map.start; this.todT = 0;
    this.makePlayer();
    const p = SAVE.pos;
    if (p) this.teleport(p.x, p.z, p.h); else this.teleport(W.spawn.x, W.spawn.z, W.spawn.h);
    this.camH = this.player.h; this.snapCamera();
    this.buildTraffic(); this.spawnPeds(); applyTimeOfDay(W, this.hours, GL.camera.position); this.applyShadowFlags();
    W.update(this.player.x, this.player.z, 0.01, GL.camera.position);
    Net.joinWorld();
  },
  applyShadowFlags: function () { if (this.W) { this.W.sun.castShadow = qualityLevel() >= 1; } },
  makePlayer: function () {
    if (this.player && this.player.mesh) { this.W.scene.remove(this.player.mesh); disposeTree(this.player.mesh); }
    const id = SAVE.current, v = new Vehicle(id, SAVE.owned[id], 'player'), mesh = buildCarMesh(v.car, profileFor(id), {});
    v.mesh = mesh; v.api = mesh.userData.api; v.halfL = v.api.dims.L / 2; v.halfW = Math.min(1.0, v.api.dims.W / 2);
    mesh.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    const sp = new THREE.SpotLight(0xfff0d8, 0, 110, 0.5, 0.7, 1.2); sp.position.set(0, 0.8, 1.8); sp.target.position.set(0, -0.3, 22); mesh.add(sp); mesh.add(sp.target); this.headL = sp;
    this.W.scene.add(mesh);
    if (this.player) { v.x = this.player.x; v.z = this.player.z; v.h = this.player.h; }
    v.px = v.x; v.pz = v.z; v.ph = v.h; this.player = v;
  },
  refreshPlayer: function () { // after garage changes
    const old = this.player, x = old.x, z = old.z, h = old.h, nitro = old.nitro;
    this.makePlayer(); this.player.setPose(x, z, h); this.player.nitro = nitro; this.player.px = x; this.player.pz = z; this.player.ph = h;
    this.player.api.setNight(this.W.night); Net.sendCar();
  },
  teleport: function (x, z, h) {
    const v = this.player; v.setPose(x, z, h); v.px = x; v.pz = z; v.ph = h; v.hint = -1; v.nitro = 1;
    const g = this.W.ground(x, z, {}); v.y = g.y; v.ny = g.ny; v.nx = g.nx; v.nz = g.nz;
  },
  respawn: function (msg) {
    const v = this.player, W = this.W;
    if (this.ev && this.ev.route) {
      const r = this.ev.route, o = {}; r.nearest(v.x, v.z, -1, o); const p = r.at(o.s - 4);
      this.teleport(p.x, p.z, Math.atan2(p.tx, p.tz)); v.hint = o.i;
    } else {
      const q = {}; W.net.query(v.x, v.z, q);
      if (q.road) {
        const rt = q.road.route, i = clamp(Math.round(q.seg + q.t), 0, rt.n - 1), tx = rt.tx[i], tz = rt.tz[i], hh = Math.atan2(tx, tz), diff = Math.abs(wrapPi(hh - v.h)) > Math.PI / 2;
        this.teleport(q.px, q.pz, diff ? hh + Math.PI : hh);
      } else this.teleport(W.spawn.x, W.spawn.z, W.spawn.h);
    }
    this.camH = v.h; this.snapCamera(); this.toast(msg || 'Back on the road', false);
    this.drift.score = 0; this.waterT = 0; this.outT = 0;
  },
  savePos: function () {
    if (this.W && this.player) { SAVE.pos = { x: this.player.x, z: this.player.z, h: this.player.h, map: this.mapIdx }; SAVE.clock[this.W.map.id] = this.hours; }
  },

  /* ---------------------------- pause / map / garage ---------------------------- */
  pause: function () { if (this.mode !== 'roam') return; this.mode = 'paused'; Sound.silence(); UI.showModal('md-pause', true); this.savePos(); persist(); },
  resume: function () { if (this.mode !== 'paused' && this.mode !== 'map') return; UI.showModal('md-pause', false); UI.showModal('scr-map', false); this.mode = 'roam'; Input.clearPressed(); this.last = performance.now(); },
  openMap: function () { if (this.mode !== 'roam' && this.mode !== 'paused') return; UI.showModal('md-pause', false); this.mode = 'map'; Sound.silence(); UI.openMap(); },
  closeMap: function () { UI.closeMap(); this.mode = 'paused'; UI.showModal('md-pause', true); },
  openGarage: function (fromWorld) {
    if (fromWorld && this.onFoot) { this.toast('Get in a car to open the garage', true); return; }
    this.pauseFrom = fromWorld ? 'world' : 'menu';
    if (fromWorld) { UI.showModal('md-pause', false); this.savePos(); }
    this.mode = 'garage'; Sound.silence(); Garage.active = true; UI.openGarage();
  },
  closeGarage: function () {
    UI.closeGarage();
    if (this.pauseFrom === 'world' && this.W) { Garage.leave(); Garage.active = false; this.refreshPlayer(); this.mode = 'paused'; UI.show('hud'); UI.showModal('md-pause', true); }
    else this.toMenu();
  },
  travel: function (idx) {
    const self = this; UI.loading(true); this.savePos(); persist();
    setTimeout(function () {
      try {
        if (self.ev) self.endEvent(true);
        self.disposeWorld(); SAVE.map = idx; SAVE.pos = null; persist();
        Garage.leave(); Garage.active = false; self.buildWorld(idx); self.mode = 'roam'; UI.show('hud'); self.updateTouch(); Input.clearPressed(); Sound.init();
        UI.showModal('md-pause', false); UI.showModal('scr-map', false); self.toast(MAPS[idx].name, false);
      } catch (e) { if (window.console) console.error(e); showFatal('Could not build this map: ' + e.message); }
      UI.loading(false);
    }, 40);
  },

  /* ---------------------------- traffic ---------------------------- */
  clearTraffic: function () {
    this.traffic.forEach(function (t) { if (t.mesh && t.mesh.parent) t.mesh.parent.remove(t.mesh); });
    this.traffic = []; this.trafficPool.forEach(function (g) { disposeTree(g); }); this.trafficPool = [];
  },
  buildTraffic: function () {
    this.clearTraffic();
    const n = TRAFFIC_SIZE[settings.traffic] || 0; if (!n) return;
    const rnd = mulberry32(this.W.map.seed + 77), cheap = CARS.filter(function (c) { return c.tier <= 6 && c.body !== 'wedge'; });
    for (let i = 0; i < 6; i++) {
      const car = cheap[Math.floor(rnd() * cheap.length)], mods = defaultMods(); mods.paint = Math.floor(rnd() * PAINTS.length); mods.tint = 2;
      const g = buildCarMesh(car, profileFor(car.id, mods), { noDriver: true, low: true, noShadow: true }); g.userData.car = car; this.trafficPool.push(g);
    }
    for (let i = 0; i < n; i++) {
      const tpl = this.trafficPool[i % this.trafficPool.length], mesh = tpl.clone(true);
      const t = { mesh: mesh, route: null, dir: 1, s: 0, speed: 0, lane: 0, x: 0, z: 0, h: 0, vx: 0, vz: 0, vf: 0, halfL: tpl.userData.car ? 2.2 : 2.2, halfW: 0.95, knock: 0, mass: 0.9 + rnd() * 0.4, miss: 0, active: true };
      this.W.scene.add(mesh); this.traffic.push(t); this.placeTraffic(t, true);
    }
  },
  placeTraffic: function (t, anywhere) {
    const W = this.W, p = this.player, roads = W.net.roads.filter(function (r) { return r.kind !== 'spoke'; });
    for (let tries = 0; tries < 14; tries++) {
      const r = roads[Math.floor(Math.random() * roads.length)], rt = r.route, i = Math.floor(Math.random() * rt.n), pt = rt.p[i], d = Math.hypot(pt.x - p.x, pt.z - p.z);
      if (anywhere ? (d > 900 || d < 60) : (d < 380 || d > 760)) continue;
      t.route = rt; t.road = r; t.dir = Math.random() < 0.5 ? 1 : -1; t.s = rt.cum[i]; t.speed = 15 + (((r.id * 7 + (t.dir > 0 ? 3 : 0)) % 5) * 2.2);
      t.knock = 0; t.vx = t.vz = 0; t.cruise = t.speed; t.jam = 0; this.trafficPose(t, 0); t.mesh.visible = true; t.active = true; return;
    }
    t.mesh.visible = false; t.active = false;
  },
  trafficPose: function (t, dt) {
    const rt = t.route, W = this.W; let L = rt.len;
    t.s += t.dir * t.speed * dt;
    if (rt.closed) t.s = ((t.s % L) + L) % L; else if (t.s < 4 || t.s > L - 4) { t.dir = -t.dir; t.s = clamp(t.s, 4, L - 4); }
    const o = rt.at(t.s, _tp), w = t.road.w / 4, nx = t.dir * -o.tz, nz = t.dir * o.tx;
    t.x = o.x + nx * w; t.z = o.z + nz * w; t.h = Math.atan2(t.dir * o.tx, t.dir * o.tz);
    t.vx = Math.sin(t.h) * t.speed; t.vz = Math.cos(t.h) * t.speed; t.vf = t.speed;
    const g = W.ground(t.x, t.z, _tg); t.y = g.y; const m = t.mesh, fx = Math.sin(t.h), fz = Math.cos(t.h), lx = Math.cos(t.h), lz = -Math.sin(t.h), ny = Math.max(g.ny, 0.3);
    m.rotation.order = 'YXZ'; m.rotation.set(-Math.atan(-(g.nx * fx + g.nz * fz) / ny), t.h, Math.atan(-(g.nx * lx + g.nz * lz) / ny)); m.position.set(t.x, t.y, t.z);
  },

  /* ---------------------------- events ---------------------------- */
  nearestEvent: function () {
    const v = this.player; let best = null, bd = 26;
    for (let i = 0; i < this.W.events.length; i++) { const e = this.W.events[i], d = Math.hypot(e.x - v.x, e.z - v.z); if (d < bd) { bd = d; best = e; } }
    return best;
  },
  pickRivals: function (def) {
    const me = carStats(SAVE.current, SAVE.owned[SAVE.current]).pi, target = me + (def.diff - 0.62) * 70, rnd = Math.random;
    const list = CARS.filter(function (c) { return c.id !== SAVE.current; }).map(function (c) { return { c: c, d: Math.abs(carStats(c.id, defaultMods()).pi - target) }; }).sort(function (a, b) { return a.d - b.d; }).slice(0, 14);
    const out = []; while (out.length < def.rivals && list.length) out.push(list.splice(Math.floor(rnd() * list.length), 1)[0].c);
    return out;
  },
  startEvent: function (def) {
    if (this.ev) return;
    const W = this.W, v = this.player, route = def.route, closed = route.closed, L = route.len;
    this.clearRivals(); this.traffic.forEach(function (t) { t.mesh.visible = false; });
    const cars = this.pickRivals(def), n = cars.length, slots = n + 1, myIdx = Math.min(n, 3);
    const E = { def: def, route: route, L: L, s0: def.s0 || 0, laps: def.laps, state: 'countdown', t: 0, t0: 0, rivals: [], results: null, finishT: 0, best: SAVE.best[def.id] || null, gold: def.par ? def.par[0] : 0 };
    const place = function (v2, k) {
      const row = Math.floor(k / 2), lane = (k % 2 ? 2.3 : -2.3), s = E.s0 - 8 - row * 8.5, o = route.at(closed ? s : Math.max(s, 0));
      v2.setPose(o.x + o.tz * lane, o.z - o.tx * lane, Math.atan2(o.tx, o.tz)); v2.px = v2.x; v2.pz = v2.z; v2.ph = v2.h; v2.hint = -1; v2.lane = lane; v2.laneBase = lane * 0.6;
      v2.prog = -1e3; v2.lap = closed ? -1 : 0; v2._ps = closed ? L - 8 - row * 8.5 : 0; v2.finished = false; v2.nitro = 1;
    };
    let k = 0; const nameBase = Math.floor(Math.random() * RIVAL_NAMES.length);
    for (let i = 0; i < slots; i++) {
      if (i === myIdx) { place(v, k++); continue; }
      const car = cars[i < myIdx ? i : i - 1], mods = defaultMods(); mods.paint = Math.floor(Math.random() * PAINTS.length); mods.wheelStyle = Math.floor(Math.random() * WHEEL_STYLES.length);
      const rv = new Vehicle(car.id, mods, 'ai'), mesh = buildCarMesh(car, profileFor(car.id, mods), { noDriver: true });
      rv.mesh = mesh; rv.api = mesh.userData.api; rv.halfL = rv.api.dims.L / 2; rv.halfW = Math.min(1.0, rv.api.dims.W / 2); mesh.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
      rv.name = RIVAL_NAMES[(nameBase + i) % RIVAL_NAMES.length]; rv.skill = clamp(0.8 + def.diff * 0.17 + (Math.random() - 0.5) * 0.05, 0.78, 0.99);
      W.scene.add(mesh); place(rv, k++); E.rivals.push(rv); this.rivals.push(rv);
    }
    v.name = SAVE.driver.name; v.finished = false;
    this.ev = E; this.camH = v.h; this.snapCamera(); this.drift.score = 0; this.wp = null;
    UI.showRace(true, def); this.toast(def.name, false);
  },
  clearRivals: function () {
    const W = this.W;
    this.rivals.forEach(function (r) { if (r.mesh) { if (W) W.scene.remove(r.mesh); disposeTree(r.mesh); } });
    this.rivals = [];
  },
  endEvent: function (silent) {
    if (!this.ev) return; this.ev = null; this.clearRivals(); this.traffic.forEach(function (t) { if (t.active) t.mesh.visible = true; });
    UI.showRace(false); showEl('h-center', false); if (!silent) { UI.showModal('scr-results', false); }
  },
  retryEvent: function () { const d = this.ev ? this.ev.def : this.lastDef; UI.showModal('scr-results', false); if (this.ev) this.endEvent(true); if (d) { this.respawnAtEvent(d); this.startEvent(d); this.mode = 'roam'; UI.show('hud'); } },
  respawnAtEvent: function (d) { this.teleport(d.x, d.z, d.h); },
  eventProgress: function (v, E) {
    const r = E.route, o = _ep; r.nearest(v.x, v.z, v.hint, o); v.hint = o.i; v.s = o.s;
    if (r.closed) {
      const ps = ((o.s - E.s0) % E.L + E.L) % E.L;
      if (v._ps > 0.75 * E.L && ps < 0.25 * E.L) v.lap++; else if (v._ps < 0.25 * E.L && ps > 0.75 * E.L && v.lap > -1) v.lap--;
      v._ps = ps; v.prog = v.lap * E.L + ps;
    } else v.prog = o.s - E.s0;
  },
  finishLine: function (E) { return E.route.closed ? E.laps * E.L : E.L - E.s0 - 14; },
  updateEvent: function (dt) {
    const E = this.ev, v = this.player; if (!E) return;
    if (E.state === 'countdown') {
      E.t += dt; const c = 3.4 - E.t, n = Math.ceil(c - 0.4);
      if (c > 0.4) { setText('h-center', n > 0 ? n : 'GO'); showEl('h-center', true); const prev = E._cn; if (prev !== n) { E._cn = n; Sound.beep(false); } }
      if (c <= 0.4) { E.state = 'run'; E.t0 = this.simT; setText('h-center', 'GO'); $('h-center').className = 'center-msg go'; Sound.beep(true); setTimeout(function () { showEl('h-center', false); $('h-center').className = 'center-msg'; }, 800); }
      return;
    }
    const all = [v].concat(E.rivals), fl = this.finishLine(E), tNow = this.simT - E.t0;
    all.forEach((x) => { this.eventProgress(x, E); if (!x.finished && x.prog >= fl) { x.finished = true; x.finishT = tNow - (x.prog - fl) / Math.max(5, Math.abs(x.vf)); } });
    all.sort(function (a, b) { return (b.finished - a.finished) || (a.finished ? a.finishT - b.finishT : b.prog - a.prog); }); all.forEach(function (x, i) { x.rank = i + 1; });
    if (v.finished && E.state === 'run') { E.state = 'done'; E.doneAt = this.simT; E.finishT = v.finishT; Sound.win(); }
    if (E.state === 'done' && this.simT - E.doneAt > 1.6 && !E.results) this.showResults();
    // rubber banding
    E.rivals.forEach(function (r) { const gap = (r.prog - v.prog); r.skill = clamp(r.skill - clamp(gap / 3000, -0.002, 0.002) * dt * 6, 0.76, 1.0); });
    if (v.stuck > 5) { v.stuck = 0; this.respawn('Reset'); }
    E.rivals.forEach(function (r) { if (Math.abs(r.vf) < 2 && r.prog > 0) { r.stuck += dt; if (r.stuck > 3) { r.stuck = 0; const o = E.route.at(r.s + 14); r.setPose(o.x, o.z, Math.atan2(o.tx, o.tz)); } } else r.stuck = 0; });
  },
  showResults: function () {
    const E = this.ev, v = this.player, def = E.def, rows = [], all = [v].concat(E.rivals); all.sort(function (a, b) { return a.rank - b.rank; });
    const t = E.finishT; let pay = 0, title, sub = '';
    if (def.type === 'attack') {
      const par = def.par, tier = t <= par[0] ? 0 : t <= par[1] ? 1 : t <= par[2] ? 2 : 3, mult = [1, 0.6, 0.35, 0.1][tier];
      title = ['Gold', 'Silver', 'Bronze', 'Finished'][tier]; pay = def.reward * mult; sub = 'Targets: gold ' + fmtTime(par[0] * 1000) + ' · silver ' + fmtTime(par[1] * 1000) + ' · bronze ' + fmtTime(par[2] * 1000);
      rows.push({ p: 1, n: v.name, c: v.car.make + ' ' + v.car.model, t: fmtTime(t * 1000), me: true });
    } else {
      const rk = v.rank; title = rk === 1 ? 'Victory' : rk <= 3 ? 'Podium' : 'Finished ' + rk + (rk === 2 ? 'nd' : rk === 3 ? 'rd' : 'th'); pay = def.reward * (PLACE_PAY[rk - 1] || 0.08);
      all.forEach(function (x) { rows.push({ p: x.rank, n: x.name, c: x.car.make + ' ' + x.car.model, t: x.finished ? fmtTime(x.finishT * 1000) : 'racing', me: x === v }); });
    }
    const prev = SAVE.best[def.id], repeat = !!prev; if (repeat) pay *= 0.7;
    pay = Math.round(pay / 10) * 10; let newBest = false;
    if (!prev || t * 1000 < prev) { SAVE.best[def.id] = Math.round(t * 1000); newBest = true; }
    SAVE.stats.races++; if (v.rank === 1 && def.type !== 'attack') SAVE.stats.wins++;
    addMoney(pay, 'event'); persist(); E.results = true; this.lastDef = def;
    UI.results({ map: this.W.map.name, name: def.name, title: title, rows: rows, pay: pay, repeat: repeat, time: fmtTime(t * 1000), best: SAVE.best[def.id], newBest: newBest, sub: sub });
    this.mode = 'paused'; showEl('h-center', false);
  },
  closeResults: function () { UI.showModal('scr-results', false); this.endEvent(true); this.mode = 'roam'; Input.clearPressed(); this.last = performance.now(); this.respawn('Event finished'); },

  /* ---------------------------- income & feedback ---------------------------- */
  cash: function (n, why) {
    if (!this.W) { UI.refreshWallet(); return; }
    this.cashSum += n; this.cashT = 2.2; UI.refreshWallet(); if (n > 0 && why !== 'sell') Sound.cash();
  },
  toast: function (msg, bad) { const e = $('h-toast'); if (!e) return; e.textContent = msg; e.className = 'toast on' + (bad ? ' bad' : ''); this.toastT = 2.2; },
  checkTraps: function (v) {
    const traps = this.W.traps;
    for (let i = 0; i < traps.length; i++) {
      const t = traps[i], dx = v.x - t.x, dz = v.z - t.z; if (dx * dx + dz * dz > 2500) { t.side = undefined; continue; }
      const side = dx * t.tx + dz * t.tz, lat = Math.abs(dx * -t.tz + dz * t.tx);
      if (t.side !== undefined && t.side * side < 0 && lat < 14) {
        const kmh = Math.round(Math.abs(v.vf) * 3.6), best = SAVE.trapsDone[t.id] || 0; let msg = 'Speed trap  ' + kmh + ' km/h';
        if (kmh >= t.need) {
          if (!best) { addMoney(t.reward, 'trap'); msg += '  +' + fmtMoney(t.reward) + ' CR'; } else if (kmh > best + 5) { addMoney(Math.round(t.reward * 0.25 / 10) * 10, 'trap'); msg += '  new record'; }
          if (kmh > best) SAVE.trapsDone[t.id] = kmh; t.mesh.material.emissiveIntensity = 1.4;
        } else msg += '  (need ' + t.need + ')';
        this.toast(msg, kmh < t.need); this.recordTop(kmh);
      }
      t.side = side;
    }
  },
  recordTop: function (kmh) { if (kmh > SAVE.stats.topKmh) SAVE.stats.topKmh = kmh; },
  driftTick: function (v, dt) {
    const D = this.drift;
    if (v.drift > 0.2 && Math.abs(v.vf) > 11 && v.onRoad && !v.hit) { D.score += dt * Math.abs(v.vf) * v.drift * 9; D.quiet = 0; }
    else { D.quiet += dt; if (D.quiet > 0.8 && D.score > 0) { if (D.score > 250) { const pay = Math.round(D.score * 0.12 / 10) * 10; addMoney(pay, 'drift'); SAVE.stats.drift += Math.round(D.score); this.toast('Drift +' + pay + ' CR', false); } D.score = 0; } }
    if (v.hit > 4) D.score = 0;
  },

  /* ---------------------------- main frame ---------------------------- */
  frame: function (dt) {
    if (GL.lost) return;
    Input.poll(dt); const W = this.W;
    if (this.mode === 'menu' || this.mode === 'garage') {
      Garage.update(dt); glRender(Garage.scene, Garage.camera, 1.05); autoQualityTick(dt);
      if (this.mode === 'garage' && Input.was('Escape')) UI.garageEsc(); else Input.was('Escape');
      return;
    }
    if (!W) return;
    if (this.mode === 'roam') {
      if (Input.was('Escape')) { this.pause(); }
      else {
        this.acc += dt; let n = 0;
        while (this.acc >= SIM_DT && n < 8) { this.simStep(SIM_DT); this.acc -= SIM_DT; n++; }
        if (n === 8) this.acc = 0;
        this.simT += 0; this.worldFrame(dt);
      }
    } else { Input.clearPressed(); if (this.mode === 'map') UI.drawBigMap(); }
    this.camera(dt); this.render(dt);
    autoQualityTick(dt);
  },
  frameStep: function (dt) { this.frame(dt); }, // used by tests

  simStep: function (dt) {
    const v = this.player, W = this.W, E = this.ev; this.simT += dt;
    const frozen = E && E.state === 'countdown';
    const inp = frozen ? ZERO_IN : Input;
    v.px = v.x; v.pz = v.z; v.ph = v.h;
    if (this.onFoot) this.stepWalk(dt, inp); else v.step(dt, inp, W);
    // traffic
    for (let i = 0; i < this.traffic.length; i++) {
      const t = this.traffic[i]; if (!t.active || E) continue;
      if (t.knock > 0) {
        t.knock -= dt; t.x += t.vx * dt; t.z += t.vz * dt; t.vx *= Math.exp(-1.6 * dt); t.vz *= Math.exp(-1.6 * dt); t.h += t.spin * dt; t.spin *= Math.exp(-2 * dt);
        t.vf = Math.hypot(t.vx, t.vz); const g = W.ground(t.x, t.z, _tg); t.y = g.y; t.mesh.position.set(t.x, t.y, t.z); t.mesh.rotation.y = t.h;
        if (t.knock <= 0) { t.mesh.visible = false; t.active = false; t.respawn = 2; }
      } else { this.trafficFollow(t, dt); this.trafficPose(t, dt); }
      if (!this.onFoot) this.carHit(v, t);
    }
    if (!this.onFoot) {
      for (let i = 0; i < this.parked.length; i++) { const p = this.parked[i]; if (p !== v) { this.carHit(v, p); p.vx = p.vz = 0; } }
      for (let i = 0; i < this.chasers.length; i++) this.carHit(v, this.chasers[i]);
    }
    if (this.wanted && !E) this.updateWanted(SIM_DT);
    if (E) {
      this.updateEvent(dt);
      if (E.state !== 'countdown') {
        const all = E.rivals;
        for (let i = 0; i < all.length; i++) {
          const r = all[i]; r.px = r.x; r.pz = r.z; r.ph = r.h;
          const inp2 = r.finished && r.prog > this.finishLine(E) + 150 ? { steer: 0, throttle: 0, brake: 0.6, hand: false, nitro: false } : aiInputs(r, E.route, [v].concat(all), dt, (this.simT - E.t0) * 1000);
          r.step(dt, inp2, W);
        }
        for (let i = 0; i < all.length; i++) { this.carHit(v, all[i]); for (let j = i + 1; j < all.length; j++) this.carHit(all[i], all[j]); }
      }
    }
    // collision feedback
    if (!this.onFoot && v.hit > 2.5 && this.simT - this.lastHit > 0.2) {
      this.lastHit = this.simT; Sound.thump(v.hit * 0.03); this.camShake = Math.min(1, v.hit * 0.05);
      for (let k = 0; k < Math.min(10, v.hit); k++) this.spark.emit(v.x, v.y + 0.5, v.z, (Math.random() - 0.5) * 8, Math.random() * 4, (Math.random() - 0.5) * 8, 0.35, 0.18, -0.2, 1, 0.7, 0.3, 1);
    }
    // stuck + out of bounds + water
    if (!this.onFoot && (!E || E.state !== 'countdown')) { if (Math.abs(v.vf) < 1 && Input.throttle > 0.5) v.stuck += dt; else v.stuck = 0; }
    if (!this.onFoot) {
      const d = Math.hypot(v.x, v.z); this.outT = d > TERR.r0 + 400 ? this.outT + dt : 0; if (this.outT > 3.5) this.respawn('Out of bounds');
      this.waterT = v.water ? this.waterT + dt : 0; if (this.waterT > 2) this.respawn('Splash! Back on the road');
    }
    if (!E && !this.onFoot) { this.driftTick(v, dt); this.checkTraps(v); this.coolMiss -= dt; this.nearMiss(v); }
    this.kmAcc += Math.hypot(v.vx, v.vz) * dt;
    if (this.kmAcc >= 1000) { this.kmAcc -= 1000; SAVE.stats.km += 1; if (!E) addMoney(40, 'distance'); this.recordTop(Math.round(Math.abs(v.vf) * 3.6)); }
  },
  nearMiss: function (v) {
    if (this.coolMiss > 0 || Math.abs(v.vf) < 28) return;
    for (let i = 0; i < this.traffic.length; i++) { const t = this.traffic[i]; if (!t.active || t.knock > 0) continue; const dx = t.x - v.x, dz = t.z - v.z, d2 = dx * dx + dz * dz; if (d2 < 9 && d2 > 3.0) { this.coolMiss = 3; addMoney(30, 'miss'); this.toast('Near miss +30 CR', false); return; } }
  },
  carHit: function (a, b) {
    const dx = b.x - a.x, dz = b.z - a.z; if (dx * dx + dz * dz > 30) return;
    const as = Math.sin(a.h), ac = Math.cos(a.h), bs = Math.sin(b.h), bc = Math.cos(b.h), ao = [-(a.halfL - 1), 0, a.halfL - 1], bo = [-(b.halfL - 1), 0, b.halfL - 1], R = 1.9;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const ax = a.x + as * ao[i], az = a.z + ac * ao[i], bx = b.x + bs * bo[j], bz = b.z + bc * bo[j], ex = bx - ax, ez = bz - az, d = Math.hypot(ex, ez);
      if (d < R && d > 0.001) {
        const nx = ex / d, nz = ez / d, pen = (R - d) * 0.5, ma = a.st ? a.st.mass / 1400 : 1, mb = b.st ? b.st.mass / 1400 : (b.mass || 1), tot = ma + mb;
        a.x -= nx * pen * (mb / tot) * 2; a.z -= nz * pen * (mb / tot) * 2; b.x += nx * pen * (ma / tot) * 2; b.z += nz * pen * (ma / tot) * 2;
        const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (rv < 0) {
          const j2 = -(1.3) * rv / (1 / ma + 1 / mb);
          a.vx -= j2 / ma * nx; a.vz -= j2 / ma * nz; b.vx += j2 / mb * nx; b.vz += j2 / mb * nz;
          if (a.hit !== undefined) a.hit = Math.max(a.hit, -rv); if (b.hit !== undefined) b.hit = Math.max(b.hit, -rv);
          if (b.knock !== undefined) { b.knock = 2.5; b.spin = (Math.random() - 0.5) * 4; }
          a.yaw += (Math.random() - 0.5) * 0.3 * Math.min(1, -rv / 12);
        }
        return;
      }
    }
  },

  worldFrame: function (dt) {
    const W = this.W, v = this.player, E = this.ev, alpha = clamp(this.acc / SIM_DT, 0, 1);
    const w = this.walk, onFoot = this.onFoot;
    this.pose = onFoot ? { x: w.x, z: w.z, h: w.h, y: w.y } : this.interp(v, alpha); const P = this.pose;
    // time of day
    this.hours = (this.hours + dt * settings.daySpeed / 150) % 24; // Normal: a full day takes about an hour
    this.todT -= dt; if (this.todT <= 0) { this.todT = 0.2; applyTimeOfDay(W, this.hours, GL.camera.position); v.api.setNight(W.night); if (this.headL) this.headL.intensity = 7 * clamp(W.night * 1.3, 0, 1); }
    W.update(P.x, P.z, dt, GL.camera.position);
    // meshes
    if (onFoot) { w.mesh.visible = true; w.mesh.rotation.y = w.h; w.mesh.position.set(w.x, w.y, w.z); v.applyMesh(dt, v.x, v.z, v.h); }
    else v.applyMesh(dt, P.x, P.z, P.h);
    this.parked.forEach(function (p) { if (p !== v) p.applyMesh(dt, p.x, p.z, p.h); });
    this.chasers.forEach(function (c) { c.mesh.visible = true; });
    Net.update(dt, P, v);
    this.rivals.forEach((r) => { const q = this.interp(r, alpha); r.applyMesh(dt, q.x, q.z, q.h); r.api.setNight(W.night); });
    // traffic respawn
    for (let i = 0; i < this.traffic.length; i++) {
      const t = this.traffic[i]; if (E) continue;
      if (!t.active) { t.respawn = (t.respawn || 0) - dt; if (t.respawn <= 0) { this.placeTraffic(t, false); } continue; }
      if (t.knock <= 0 && ((t.x - v.x) * (t.x - v.x) + (t.z - v.z) * (t.z - v.z) > 950 * 950)) this.placeTraffic(t, false);
    }
    // effects
    this.updatePeds(dt); this.updateCops(dt);
    this.effects(dt, v);
    // prompts
    this.hintT -= dt;
    if (this.hintT <= 0) {
      this.hintT = 0.15; this.nearEv = E ? null : this.nearestEvent();
      let hint = '';
      if (!this.nearEv && !E) hint = this.actionHint();
    if (this.nearEv) { const d = this.nearEv; hint = '<kbd>E</kbd> ' + d.name + (d.type === 'circuit' ? ' · ' + d.laps + (d.laps > 1 ? ' laps' : ' lap') : '') + ' · up to ' + fmtMoney(d.reward) + ' CR'; }
      UI.hint(hint, !!hint);
    }
    if (Input.was('KeyE')) { if (this.nearEv && !E) { this.startEvent(this.nearEv); this.nearEv = null; } else this.carAction(); }
    if (Input.was('KeyR')) { if (this.onFoot) this.walkerReset(); else this.respawn('Reset'); }
    if (Input.was('KeyC')) { settings.camera = (settings.camera + 1) % 3; saveSettings(); this.toast(['Chase camera', 'Close camera', 'Cockpit camera'][settings.camera], false); }
    if (Input.was('KeyT')) Net.openChat();
    if (Input.was('KeyM') || Input.was('Tab')) this.openMap();
    if (Input.was('KeyG') && !E) this.openGarage(true);
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) { const e = $('h-toast'); if (e) e.className = 'toast'; } }
    if (this.cashT > 0) { this.cashT -= dt; if (this.cashT <= 0) { this.cashSum = 0; } }
    this.hud(dt);
    // sound
    Sound.update(v.rpm, this.onFoot ? 0 : Input.throttle, v.slip, v.boosting, true);
    this.wantedHud();
    // autosave
    this.saveT += dt; if (this.saveT > 25) { this.saveT = 0; this.savePos(); persist(); }
  },
  interp: function (v, a) { return { x: lerp(v.px === undefined ? v.x : v.px, v.x, a), z: lerp(v.pz === undefined ? v.z : v.pz, v.z, a), h: (v.ph === undefined ? v.h : v.ph) + wrapPi(v.h - (v.ph === undefined ? v.h : v.ph)) * a }; },

  effects: function (dt, v) {
    const sh = Math.sin(v.h), ch = Math.cos(v.h), lx = ch, lz = -sh, sp = Math.abs(v.vf);
    if (v.slip > 0.35 && sp > 8 && !v.water) {
      const off = !v.onRoad, c = off ? [0.62, 0.52, 0.38] : [0.82, 0.82, 0.84];
      [-1, 1].forEach((s) => { if (Math.random() < Math.min(1, v.slip * dt * 50)) this.smoke.emit(v.x - sh * v.halfL * 0.7 + lx * s * v.halfW, v.y + 0.25, v.z - ch * v.halfL * 0.7 + lz * s * v.halfW, v.vx * 0.2 + (Math.random() - 0.5), 0.6 + Math.random() * 0.5, v.vz * 0.2 + (Math.random() - 0.5), 1.1 + Math.random() * 0.6, 0.9, 2.2, c[0], c[1], c[2], off ? 0.35 : 0.42); });
    } else if (!v.onRoad && sp > 12 && Math.random() < dt * 40) this.smoke.emit(v.x - sh * 1.5, v.y + 0.2, v.z - ch * 1.5, (Math.random() - 0.5) * 2, 0.8, (Math.random() - 0.5) * 2, 0.9, 0.7, 2.0, 0.6, 0.5, 0.36, 0.28);
    if (v.boosting) for (let i = 0; i < 2; i++) this.flame.emit(v.x - sh * (v.halfL + 0.2) + lx * (Math.random() - 0.5) * 0.5, v.y + 0.45, v.z - ch * (v.halfL + 0.2) + lz * (Math.random() - 0.5) * 0.5, -sh * 5 + v.vx * 0.3, 0.2, -ch * 5 + v.vz * 0.3, 0.22, 0.5, -1.2, 0.3, 0.6, 1, 0.9);
    this.smoke.update(dt, GL.h); this.spark.update(dt, GL.h); this.flame.update(dt, GL.h);
  },

  /* ---------------------------- camera ---------------------------- */
  snapCamera: function () { this.camP.x = this.player.x - Math.sin(this.camH) * 7; this.camP.z = this.player.z - Math.cos(this.camH) * 7; this.camP.y = this.player.y + 2.5; },
  camera: function (dt) {
    if (this.onFoot) { this.cameraWalk(dt); return; }
    const cam = GL.camera, v = this.player, P = this.pose.x === undefined ? v : this.pose, mode = settings.camera, sp = Math.hypot(v.vx, v.vz);
    if (this.mode !== 'roam' && this.mode !== 'paused' && this.mode !== 'map') return;
    const velH = Math.atan2(v.vx, v.vz), th = sp > 7 && v.vf > 0 ? v.h + wrapPi(velH - v.h) * 0.4 : v.h;
    this.camH += wrapPi(th - this.camH) * (1 - Math.exp(-dt * (mode === 1 ? 7 : 4.5)));
    const sx = Math.sin(this.camH), cz = Math.cos(this.camH);
    if (mode === 2) {
      const lx = Math.cos(P.h), lz = -Math.sin(P.h), eye = v.api.dims.belt + 0.36;
      cam.position.set(P.x + Math.sin(P.h) * 0.1 + lx * 0.34, v.y + eye, P.z + Math.cos(P.h) * 0.1 + lz * 0.34);
      cam.lookAt(cam.position.x + Math.sin(P.h) * 20, v.y + eye - 0.1 + v.tilt.rx * -8, cam.position.z + Math.cos(P.h) * 20);
      cam.fov = lerp(cam.fov, 66 + Math.min(sp * 0.2, 12), Math.min(1, dt * 4)); GL.blur = 0;
    } else {
      const dist = (mode === 1 ? 5.0 : 6.8) + Math.min(sp * 0.02, 1.4), hgt = mode === 1 ? 1.55 : 2.15;
      const tx = P.x - sx * dist, tz = P.z - cz * dist; let ty = v.y + hgt;
      const k = 1 - Math.exp(-dt * 12); this.camP.x += (tx - this.camP.x) * k; this.camP.z += (tz - this.camP.z) * k; this.camP.y += (ty - this.camP.y) * k;
      const gy = this.W.heightAt(this.camP.x, this.camP.z) + 0.7; if (this.camP.y < gy) this.camP.y = gy;
      cam.position.set(this.camP.x, this.camP.y, this.camP.z);
      cam.lookAt(P.x + sx * 6, v.y + 1.0, P.z + cz * 6);
      cam.fov = lerp(cam.fov, 58 + clamp(sp * 0.22, 0, 14) + (v.boosting ? 7 : 0), Math.min(1, dt * 4));
      GL.blur = lerp(GL.blur, clamp((sp - 38) / 75, 0, 1) * 0.05 + (v.boosting ? 0.03 : 0), Math.min(1, dt * 3));
    }
    if (this.camShake > 0) { cam.position.x += (Math.random() - 0.5) * this.camShake * 0.25; cam.position.y += (Math.random() - 0.5) * this.camShake * 0.25; this.camShake = Math.max(0, this.camShake - dt * 3); }
    cam.updateProjectionMatrix();
  },
  render: function () {
    const W = this.W; glRender(W.scene, GL.camera, W.exposure);
  },

  /* ---------------------------- HUD ---------------------------- */
  updateTouch: function () { showEl('touch', Input.usingTouch && (this.mode === 'roam')); document.body.classList.toggle('touch', !!Input.usingTouch); },
  hud: function (dt) {
    const v = this.player, E = this.ev;
    setText('h-spd', Math.round(unitSpeed(Math.abs(v.vf)))); setText('h-unit', settings.units === 'mph' ? 'MPH' : 'KM/H');
    setW('h-rpm', v.rpm * 100); setW('h-nit', v.nitro * 100); setText('h-gear', v.gear < 0 ? 'R' : v.gear === 0 ? 'N' : v.gear);
    setText('h-money', fmtMoney(SAVE.money)); setText('h-clock', fmtClock(this.hours)); setText('h-map', this.W.map.name);
    const D = this.drift.score; showEl('h-drift', D > 60); if (D > 60) setText('h-drift', 'DRIFT ' + Math.round(D));
    const ce = $('h-cash'); if (ce) { ce.textContent = this.cashSum ? (this.cashSum > 0 ? '+' : '') + fmtMoney(this.cashSum) + ' CR' : ''; ce.className = 'cash' + (this.cashT > 0 ? ' on' : '') + (this.cashSum < 0 ? ' neg' : ''); }
    if (E) {
      const tNow = E.state === 'countdown' ? 0 : (E.state === 'done' ? E.finishT : this.simT - E.t0);
      setText('h-time', fmtTime(tNow * 1000)); setText('h-best', E.best ? fmtTime(E.best) : '--:--.---');
      if (E.def.type === 'attack') { setText('h-pos', ''); setText('h-lap', 'Gold ' + fmtTime(E.gold * 1000)); showEl('c-pos', false); }
      else { showEl('c-pos', true); setText('h-pos', v.rank + ' / ' + (E.rivals.length + 1)); }
      if (E.route.closed) setText('h-lap', Math.max(1, Math.min(E.laps, v.lap + 1)) + ' / ' + E.laps);
      else if (E.def.type !== 'attack') setText('h-lap', Math.round(clamp(v.prog / this.finishLine(E), 0, 1) * 100) + '%');
    }
    // waypoint
    if (this.wp) {
      const d = Math.hypot(this.wp.x - v.x, this.wp.z - v.z); setText('h-wp', (d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m')); showEl('c-wp', true);
      if (d < 40) { this.wp = null; this.toast('Arrived', false); }
    } else showEl('c-wp', false);
    this.drawMini();
  },
  drawMini: function () {
    const cv = $('mini'); if (!cv) return; const c = cv.getContext('2d'), S = cv.width, W = this.W, P = this.pose, v = this.player;
    if (!W.mapCanvas || P.x === undefined) return;
    const zoom = 0.2 * S / 256 * (Math.abs(v.vf) > 40 ? 0.8 : 1), k = W.mapScale, th = P.h + Math.PI;
    c.save(); c.clearRect(0, 0, S, S); c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 2, 0, 6.2832); c.clip();
    c.fillStyle = '#0b0e13'; c.fillRect(0, 0, S, S);
    c.translate(S / 2, S / 2); c.rotate(th); const s = zoom / k; c.scale(s, s); c.drawImage(W.mapCanvas, -(P.x + W.mapExt) * k, -(P.z + W.mapExt) * k);
    c.setTransform(1, 0, 0, 1, 0, 0);
    const cs = Math.cos(th), sn = Math.sin(th), pin = function (x, z, col, r, edge) {
      let dx = (x - P.x) * zoom, dz = (z - P.z) * zoom, rx = dx * cs - dz * sn, ry = dx * sn + dz * cs; const d = Math.hypot(rx, ry), lim = S / 2 - 10;
      if (d > lim) { if (!edge) return; rx *= lim / d; ry *= lim / d; }
      c.fillStyle = col; c.beginPath(); c.arc(S / 2 + rx, S / 2 + ry, r, 0, 6.2832); c.fill();
    };
    if (!this.ev) { W.events.forEach(function (e) { pin(e.x, e.z, e.type === 'circuit' ? '#ffb020' : e.type === 'sprint' ? '#27d3ff' : '#c98bff', 3.5 * S / 256, false); }); W.traps.forEach(function (t) { pin(t.x, t.z, '#5fe08a', 3 * S / 256, false); }); }
    else pin(this.ev.def.x, this.ev.def.z, '#ffb020', 4 * S / 256, true);
    if (this.wp) pin(this.wp.x, this.wp.z, '#ff5a64', 5 * S / 256, true);
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(S / 2, S / 2 - 9 * S / 256); c.lineTo(S / 2 + 6 * S / 256, S / 2 + 7 * S / 256); c.lineTo(S / 2, S / 2 + 3 * S / 256); c.lineTo(S / 2 - 6 * S / 256, S / 2 + 7 * S / 256); c.closePath(); c.fill();
    c.restore();
  }
};
const ZERO_IN = { steer: 0, throttle: 0, brake: 1, hand: false, nitro: false };
const _tp = {}, _tg = {}, _ep = {};
