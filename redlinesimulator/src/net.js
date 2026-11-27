'use strict';
/* ============================================================
   NET: multiplayer client. Talks to server/server.js over WebSocket.
   Everyone in the same room code on the same map shares the world.
   Each client owns its own car and sends ~15 state updates per second;
   other players are drawn as smoothed, non-solid cars with name tags.
   Offline play is unchanged: nothing here runs until you press Connect.
   ============================================================ */
const Net = {
  ws: null, status: 'off', url: '', room: 'public', id: 0, wantOn: false, joined: false, retry: 0, retryT: 0,
  remotes: {}, chat: [], sendT: 0, chatOpen: false, _g: {},

  init: function () {
    const saved = store.get('rg.net', {}), loc = window.location;
    // The game is served by the same server that runs the relay, so the default address is this page's own host.
    // MP_SERVER (set at build time) points at a separately hosted relay, for hosts that serve only static files.
    const def = window.MP_SERVER || (/^https?:$/.test(loc.protocol) && loc.host ? (loc.protocol === 'https:' ? 'wss://' : 'ws://') + loc.host : '');
    this.defUrl = def;
    // A saved custom address is only reused on the host it was saved from (avoids a stale localhost address after deploy).
    this.url = (saved.host === loc.host && saved.url) ? saved.url : def; this.room = saved.room || 'public';
  },
  saveCfg: function () { store.set('rg.net', { url: this.url, room: this.room, host: window.location.host }); },
  quickJoin: function () {
    if (!this.defUrl && !this.url) { if (Game.toast) Game.toast('Multiplayer needs the game opened from its server address', true); return false; }
    this.connect(this.url || this.defUrl, this.room || 'public'); return true;
  },
  online: function () { return this.status === 'on'; },
  count: function () { return Object.keys(this.remotes).length + 1; },

  /* ---- connection ---- */
  connect: function (url, room) {
    this.disconnect(true);
    url = String(url || '').trim(); room = String(room || 'public').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 16) || 'public';
    if (!/^wss?:\/\/.+/i.test(url)) { this.setStatus('off', 'Enter a server address that starts with ws:// or wss://'); return; }
    this.url = url; this.room = room; this.saveCfg(); this.wantOn = true; this.failed = 0; this.wasOpen = false; this.open();
  },
  explain: function () {
    if (window.location.protocol === 'https:' && this.url.indexOf('ws://') === 0) return 'This page is https, so the address must start with wss://';
    return 'Could not reach the server at ' + this.url + '. Open the game from your server\'s https:// address (not the Claude link), and check the server is running (' + window.location.origin + '/health).';
  },
  open: function () {
    const self = this; this.setStatus('connecting', 'Connecting to ' + this.url + ' ...');
    let ws; try { ws = new WebSocket(this.url); } catch (e) { this.setStatus('off', 'Could not open that address.'); this.wantOn = false; return; }
    this.ws = ws;
    ws.onopen = function () { self.retry = 0; self.failed = 0; self.wasOpen = true; self.setStatus('on', 'Connected. Room: ' + self.room); if (Game.W) self.joinWorld(); };
    ws.onmessage = function (e) { let m; try { m = JSON.parse(e.data); } catch (er) { return; } self.onMsg(m); };
    ws.onerror = function () { self.failed++; };
    ws.onclose = function () {
      if (self.ws !== ws) return; self.ws = null; self.joined = false; self.clearRemotes();
      if (self.wantOn && self.retry < 5) { self.retry++; self.setStatus('connecting', 'Connection lost. Retrying (' + self.retry + '/5) ...'); self.retryT = setTimeout(function () { if (self.wantOn) self.open(); }, 1000 * self.retry); }
      else { const why = !self.wasOpen ? self.explain() : 'Connection lost. Offline play still works.'; self.wantOn = false; self.setStatus('off', why); if (Game.W && Game.toast) Game.toast('Multiplayer connection lost', true); }
    };
  },
  disconnect: function (silent) {
    this.wantOn = false; clearTimeout(this.retryT);
    const ws = this.ws; this.ws = null; this.joined = false; this.clearRemotes();
    if (ws) { try { ws.close(); } catch (e) { /* ignore */ } }
    this.setStatus('off', silent ? 'Not connected. Offline play still works.' : 'Disconnected.');
  },
  setStatus: function (s, msg) {
    this.status = s; this.msg = msg || '';
    const note = $('m-mp-note'); if (note) note.textContent = s === 'on' ? 'Connected to the shared world.' : this.msg;
    const e = $('mp-status'); if (e) { e.textContent = this.msg; e.className = 'mp-status ' + s; }
    const c = $('mp-connect'), d = $('mp-disconnect'); if (c) c.hidden = s !== 'off'; if (d) d.hidden = s === 'off';
    const b = $('m-mp'); if (b) b.classList.toggle('live', s === 'on');
    this.badge();
  },
  send: function (o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); },

  /* ---- session hooks called by Game ---- */
  joinWorld: function () {
    if (!this.online() || !Game.W) return;
    this.clearRemotes();
    this.send({ t: 'join', room: this.room, map: Game.mapIdx, name: SAVE.driver.name, car: SAVE.current, mods: SAVE.owned[SAVE.current], driver: SAVE.driver });
    this.joined = true; this.sendT = 0; this.badge();
  },
  leaveWorld: function () { if (this.joined) this.send({ t: 'leave' }); this.joined = false; this.clearRemotes(); this.closeChat(); this.badge(); },
  sendCar: function () { if (this.joined) this.send({ t: 'car', name: SAVE.driver.name, car: SAVE.current, mods: SAVE.owned[SAVE.current], driver: SAVE.driver }); },

  /* ---- incoming ---- */
  onMsg: function (m) {
    if (m.t === 'welcome') {
      this.id = m.id; this.clearRemotes(); (m.players || []).forEach((p) => this.addRemote(p));
      this.log('', 'Joined room "' + m.room + '" with ' + (m.players ? m.players.length : 0) + ' other driver(s).', true); this.badge();
    } else if (m.t === 'join') { this.addRemote(m.p); if (m.p) this.log('', m.p.name + ' joined.', true); this.badge(); }
    else if (m.t === 'leave') { const r = this.remotes[m.id]; if (r) this.log('', r.name + ' left.', true); this.removeRemote(m.id); this.badge(); }
    else if (m.t === 'car') { if (m.p) { this.removeRemote(m.p.id, true); this.addRemote(m.p, true); } }
    else if (m.t === 'S') {
      const now = performance.now(), a = m.p || [];
      for (let i = 0; i < a.length; i++) {
        const s = a[i], r = this.remotes[s[0]]; if (!r) continue;
        r.tx = s[1]; r.tz = s[2]; r.th = s[3]; r.vf = s[4]; r.st = s[5]; r.brk = !!s[6]; r.vx = s[7]; r.vz = s[8]; r.t = now;
        if (!r.seen) { r.seen = true; r.x = r.tx; r.z = r.tz; r.h = r.th; }
      }
    } else if (m.t === 'chat') { this.log(m.name, m.m, false); if (!(this.chatOpen)) Sound.beep(false); }
    else if (m.t === 'err') { this.log('', m.m, true); if (Game.toast) Game.toast(m.m, true); }
  },

  /* ---- remote cars ---- */
  driverOf: function (d) {
    const o = defaultDriver(); d = d || {};
    o.hair = clampIdx(d.hair, HAIR_STYLES.length, 0); o.hairColor = clampIdx(d.hairColor, HAIR_COLORS.length, 0); o.skin = clampIdx(d.skin, SKIN_TONES.length, 1);
    o.suit = clampIdx(d.suit, SUIT_COLORS.length, 0); o.helmet = clampIdx(d.helmet, HELMETS.length, 1); o.helmetColor = clampIdx(d.helmetColor, HELMET_COLORS.length, 0);
    return o;
  },
  addRemote: function (p, quiet) {
    const W = Game.W; if (!W || !p || this.remotes[p.id] || p.id === this.id) return;
    const car = CARS[Number(p.car)]; if (!car) return;
    const mods = sanitizeMods(p.mods), prof = Object.assign({}, mods, { perf: Object.assign({}, mods.perf), driver: this.driverOf(p.driver) });
    const v = new Vehicle(car.id, mods, 'remote'), mesh = buildCarMesh(car, prof, { noDriver: true, noShadow: true });
    v.mesh = mesh; v.api = mesh.userData.api; v.halfL = v.api.dims.L / 2;
    const name = String(p.name || 'Driver').replace(/[<>&"]/g, '').slice(0, 14) || 'Driver';
    const label = this.makeLabel(name); label.position.set(0, v.api.dims.roof + 0.9, 0); mesh.add(label);
    mesh.visible = false; W.scene.add(mesh);
    this.remotes[p.id] = { id: p.id, name: name, v: v, mesh: mesh, label: label, x: 0, z: 0, h: 0, tx: 0, tz: 0, th: 0, vx: 0, vz: 0, vf: 0, st: 0, brk: false, t: 0, seen: false, quiet: !!quiet };
  },
  removeRemote: function (id) {
    const r = this.remotes[id]; if (!r) return;
    if (r.mesh.parent) r.mesh.parent.remove(r.mesh);
    if (r.label.material.map) r.label.material.map.dispose(); r.label.material.dispose(); r.mesh.remove(r.label);
    disposeTree(r.mesh); delete this.remotes[id];
  },
  clearRemotes: function () { Object.keys(this.remotes).forEach((id) => this.removeRemote(id)); },
  makeLabel: function (text) {
    const tex = canvasTex(256, 64, function (g, w, h) {
      g.clearRect(0, 0, w, h); g.font = '700 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const tw = Math.min(w - 12, g.measureText(text).width + 28); g.fillStyle = 'rgba(8,10,18,0.72)';
      g.beginPath(); g.roundRect ? g.roundRect((w - tw) / 2, 8, tw, h - 16, 14) : g.rect((w - tw) / 2, 8, tw, h - 16); g.fill();
      g.fillStyle = '#ffffff'; g.fillText(text, w / 2, h / 2 + 1, w - 24);
    });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
    sp.renderOrder = 10; sp.scale.set(4, 1, 1); return sp;
  },

  /* ---- per-frame ---- */
  update: function (dt, P, v) {
    const W = Game.W; if (!W) return;
    if (this.joined) {
      this.sendT -= dt;
      if (this.sendT <= 0) {
        this.sendT = 0.066;
        this.send({ t: 's', x: +v.x.toFixed(2), z: +v.z.toFixed(2), h: +v.h.toFixed(3), vf: +v.vf.toFixed(2), st: +v.steer.toFixed(3), b: v.braking ? 1 : 0, vx: +v.vx.toFixed(2), vz: +v.vz.toFixed(2) });
      }
    }
    const now = performance.now(), k = Math.min(1, dt * 12), ids = Object.keys(this.remotes);
    for (let i = 0; i < ids.length; i++) {
      const r = this.remotes[ids[i]]; if (!r.seen) continue;
      const age = Math.min(0.25, (now - r.t) / 1000), ex = r.tx + r.vx * age, ez = r.tz + r.vz * age;
      const dx = ex - r.x, dz = ez - r.z;
      if (dx * dx + dz * dz > 2500) { r.x = ex; r.z = ez; r.h = r.th; } else { r.x += dx * k; r.z += dz * k; r.h += wrapPi(r.th - r.h) * k; }
      const pd = Math.hypot(r.x - P.x, r.z - P.z), vis = pd < 1500; r.mesh.visible = vis; if (!vis) continue;
      const g = W.ground(r.x, r.z, this._g), rv = r.v;
      rv.y = g.y; rv.nx = g.nx; rv.ny = g.ny; rv.nz = g.nz; rv.vf = r.vf; rv.steer = r.st; rv.braking = r.brk; rv.yaw = 0; rv.accelNow = 0;
      rv.applyMesh(dt, r.x, r.z, r.h); rv.api.setNight(W.night);
      const s = clamp(pd / 22, 1, 7); r.label.scale.set(4 * s * 0.55, 1 * s * 0.55, 1); r.label.visible = pd < 450;
    }
    this.badge();
  },
  badge: function () {
    const e = $('h-mp'); if (!e) return;
    const on = this.online() && this.joined; e.hidden = !on; const cb = $('h-btn-chat'); if (cb) cb.hidden = !on; if (!on) return;
    const t = (this.room === 'public' ? 'Shared world' : 'Room ' + this.room) + ' · ' + this.count() + ' online'; if (this._bt !== t) { this._bt = t; e.textContent = t; }
  },

  /* ---- chat ---- */
  log: function (name, text, sys) {
    this.chat.push({ n: name, m: text, sys: !!sys, t: performance.now() }); if (this.chat.length > 40) this.chat.shift(); this.renderChat();
  },
  renderChat: function () {
    const box = $('h-chat'); if (!box) return; const esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
    box.innerHTML = this.chat.slice(-6).map(function (c) { return '<div class="' + (c.sys ? 'sys' : '') + '">' + (c.n ? '<b>' + esc(c.n) + '</b> ' : '') + esc(c.m) + '</div>'; }).join('');
    box.classList.add('on'); clearTimeout(this._ct); const self = this; this._ct = setTimeout(function () { if (!self.chatOpen) box.classList.remove('on'); }, 9000);
  },
  openChat: function () {
    if (!this.online() || !this.joined) return; const row = $('h-chat-row'), inp = $('h-chat-in'); if (!row || !inp) return;
    this.chatOpen = true; row.hidden = false; inp.value = ''; const box = $('h-chat'); if (box) box.classList.add('on'); inp.focus();
  },
  closeChat: function () { this.chatOpen = false; const row = $('h-chat-row'), inp = $('h-chat-in'); if (inp) inp.blur(); if (row) row.hidden = true; },
  submitChat: function () {
    const inp = $('h-chat-in'); const text = inp ? inp.value.trim().slice(0, 120) : ''; if (text) this.send({ t: 'chat', m: text });
    this.closeChat();
  },
  bindUI: function () {
    const self = this, on = function (id, fn) { const e = $(id); if (e) e.addEventListener('click', fn); };
    on('m-mp', function () { if (!self.quickJoin()) return; Sound.init(); UI.goLandscape(); Game.start(); });
    on('m-mp-cfg', function () { const u = $('mp-url'), r = $('mp-room'); if (u) u.value = self.url; if (r) r.value = self.room; self.setStatus(self.status, self.msg || 'Not connected. Offline play still works.'); showEl('md-mp', true); });
    // Single player: Drive always runs offline, so leave any multiplayer connection first.
    on('m-play', function () { self.disconnect(true); });
    on('mp-close', function () { showEl('md-mp', false); });
    on('mp-connect', function () { self.connect(($('mp-url') || {}).value, ($('mp-room') || {}).value); });
    on('mp-disconnect', function () { self.disconnect(); });
    on('h-btn-chat', function () { self.openChat(); });
    const inp = $('h-chat-in');
    if (inp) inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); self.submitChat(); } else if (e.key === 'Escape') { e.preventDefault(); self.closeChat(); } });
    if (inp) inp.addEventListener('blur', function () { setTimeout(function () { if (self.chatOpen) self.closeChat(); }, 150); });
    this.setStatus('off', 'Not connected. Offline play still works.');
  }
};
