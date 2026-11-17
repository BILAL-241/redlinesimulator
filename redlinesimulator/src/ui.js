'use strict';
/* ============================================================
   UI: menu, garage + dealership, travel, map, pause, results, settings
   ============================================================ */

const CLS_ICON = { Compact: 'C', Sedan: 'S', Classic: 'CL', Muscle: 'M', Sport: 'SP', Super: 'SU', Hyper: 'HY', Utility: 'U' };
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function cr(n) { return fmtMoney(n) + ' CR'; }
function clone(o) { return JSON.parse(JSON.stringify(o)); }

const UI = {
  g: { tab: 'cars', id: 0, draft: null, cls: 'All', sort: 'price', q: '', sellArm: false },
  travelFrom: 'menu', bigSel: null, bigPins: [], bigS: 600,

  init: function () {
    const self = this, on = function (id, fn) { const e = $(id); if (e) e.addEventListener('click', fn); };
    // menu
    on('m-play', function () { Sound.init(); UI.goLandscape(); Game.start(); });
    on('m-garage', function () { Game.openGarage(false); });
    on('m-travel', function () { self.openTravel('menu'); });
    on('m-settings', function () { self.openSettings(); });
    // garage
    on('g-back', function () { self.garageExit(); });
    $('g-tabs').addEventListener('click', function (e) { const b = e.target.closest('button'); if (b) { self.g.tab = b.dataset.t; self.g.sellArm = false; self.renderGarage(); Garage.setFocus(({ paint: 'paint', wheels: 'wheels', body: 'body', perf: 'perf', driver: 'driver' })[self.g.tab] || 'car'); } });
    $('g-body').addEventListener('click', function (e) { const b = e.target.closest('[data-a]'); if (b) self.garageAct(b.dataset.a, b.dataset.k, b.dataset.v); });
    $('g-body').addEventListener('input', function (e) {
      if (e.target.id === 'g-cpaint') { self.g.draft.customPaint = e.target.value; Garage.setPaintLive(); self.renderFoot(); self.renderStats(); }
      if (e.target.id === 'g-name') { SAVE.driver.name = String(e.target.value).replace(/[<>&"]/g, '').slice(0, 14) || 'Driver'; persist(); }
      if (e.target.id === 'g-search') { self.g.q = e.target.value; self.renderBody(true); }
    });
    // travel
    on('tr-back', function () { self.closeTravel(); });
    // pause
    on('p-resume', function () { Game.resume(); });
    on('p-map', function () { Game.openMap(); });
    on('p-garage', function () { Game.openGarage(true); });
    on('p-travel', function () { UI.showModal('md-pause', false); self.openTravel('pause'); });
    on('p-settings', function () { self.openSettings(); });
    on('p-abandon', function () { Game.endEvent(true); Game.respawn('Event abandoned'); Game.resume(); });
    on('p-quit', function () { Game.toMenu(); UI.showModal('md-pause', false); });
    // map
    on('bm-close', function () { Game.closeMap(); }); on('bm-clear', function () { Game.wp = null; self.bigSel = null; self.bmInfo(); });
    on('bm-wp', function () { if (self.bigSel) { Game.wp = { x: self.bigSel.x, z: self.bigSel.z }; Game.toast('Waypoint set', false); } });
    on('bm-go', function () {
      const s = self.bigSel; if (!s || !s.h === undefined) return; Game.closeMap(); Game.resume();
      Game.teleport(s.x - Math.sin(s.h) * 14, s.z - Math.cos(s.h) * 14, s.h); Game.camH = s.h; Game.snapCamera(); Game.toast('Arrived: ' + s.name, false);
    });
    const bm = $('bigmap'); bm.addEventListener('click', function (e) { self.bigClick(e); });
    // results
    on('r-again', function () { Game.retryEvent(); }); on('r-ok', function () { Game.closeResults(); });
    // settings
    on('s-close', function () { self.closeSettings(); });
    on('s-reset', function () { if (!self.resetArm) { self.resetArm = true; $('s-reset').textContent = 'Tap again to erase everything'; } else { self.resetArm = false; try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem('rg2_settings'); } catch (e) { /* ignore */ } location.reload(); } });
    // confirm dialog
    on('c-apply', function () { self.confirmDo('apply'); }); on('c-discard', function () { self.confirmDo('discard'); }); on('c-cancel', function () { self.confirmDo('cancel'); });
    // hud buttons
    on('h-btn-pause', function () { Game.pause(); }); on('h-btn-map', function () { Game.openMap(); });
    this.bindTouch();
    const rd = $('rotate-skip'); if (rd) rd.addEventListener('click', function () { document.body.classList.add('no-rotate'); });
    window.addEventListener('touchstart', function () { if (!Input.usingTouch) { Input.usingTouch = true; Game.updateTouch(); } }, { passive: true });
  },
  goLandscape: function () {
    try {
      if (!(Input.usingTouch || (window.matchMedia && matchMedia('(pointer: coarse)').matches))) return;
      const el = document.documentElement, fs = el.requestFullscreen || el.webkitRequestFullscreen;
      const lock = function () { try { const p = screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ } };
      if (fs && !document.fullscreenElement) { const r = fs.call(el); if (r && r.then) r.then(lock, function () {}); else lock(); } else lock();
    } catch (e) { /* ignore */ }
  },
  bindTouch: function () {
    const map = { 't-left': 'left', 't-right': 'right', 't-gas': 'gas', 't-brake': 'brake', 't-rev': 'rev', 't-nitro': 'nitro', 't-hand': 'hand' };
    Object.keys(map).forEach(function (id) {
      const b = $(id), k = map[id]; if (!b) return;
      const set = function (v) { Input.touch[k] = v; b.classList.toggle('on', v); };
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } set(true); });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (n) { b.addEventListener(n, function () { set(false); }); });
    });
    const a = $('t-act'); if (a) a.addEventListener('pointerdown', function (e) { e.preventDefault(); Input.pressed.KeyE = true; });
  },

  /* ----- screens ----- */
  show: function (name) {
    ['scr-menu', 'scr-hud', 'scr-garage', 'scr-travel'].forEach(function (id) { showEl(id, false); });
    if (name === 'menu') { showEl('scr-menu', true); this.menuInfo(); }
    if (name === 'hud') showEl('scr-hud', true);
    showEl('h-pause', false);
  },
  menuInfo: function () {
    const c = CARS[SAVE.current]; setText('m-car', c.make + ' ' + c.model); setText('m-money', cr(SAVE.money)); setText('m-map', MAPS[SAVE.map].name);
    setText('m-owned', Object.keys(SAVE.owned).length + ' / ' + CARS.length);
    $('m-play').firstChild.textContent = SAVE.pos || SAVE.stats.km > 0 ? 'Continue ' : 'Drive ';
  },
  loading: function (on) { const e = $('loading'); if (e) e.classList.toggle('off', !on); },
  showModal: function (id, on) { showEl(id, on); },
  refreshWallet: function () { setText('h-money', fmtMoney(SAVE.money)); setText('g-money', cr(SAVE.money)); setText('m-money', cr(SAVE.money)); if (!$('scr-garage').hidden) this.renderFoot(); },
  hint: function (html, on) { const e = $('h-hint'); if (!e) return; if (_ht.hint !== html) { _ht.hint = html; e.innerHTML = html; } e.classList.toggle('on', !!on); const a = $('t-act'); if (a) a.hidden = !on || !Input.usingTouch; },
  showRace: function (on, def) {
    showEl('h-race', on); showEl('h-evname', on); if (def) setText('h-evname', def.name);
    const p = $('h-pause'); if (p) p.hidden = true; showEl('p-abandon', on);
  },
  results: function (r) {
    setText('r-map', r.map + ' · ' + r.name); setText('r-title', r.title);
    $('r-tbl').innerHTML = r.rows.map(function (x) { return '<div class="tr' + (x.me ? ' me' : '') + '"><span class="p">' + x.p + '</span><span>' + esc(x.n) + '<span class="c">' + esc(x.c) + '</span></span><span class="t">' + esc(x.t) + '</span></div>'; }).join('');
    $('r-pay').innerHTML = '<b>+' + fmtMoney(r.pay) + ' CR</b>' + (r.repeat ? ' <small>(repeat run, reduced)</small>' : '');
    setText('r-best', (r.sub ? r.sub + ' · ' : '') + 'Your time ' + r.time + (r.newBest ? ' · NEW RECORD' : ' · Best ' + fmtTime(r.best)));
    showEl('scr-results', true);
  },

  /* ----- settings ----- */
  openSettings: function () { this.renderSettings(); showEl('md-settings', true); },
  closeSettings: function () { showEl('md-settings', false); saveSettings(); applyQuality(); if (Game.W) Game.W.scene.fog && 0; },
  renderSettings: function () {
    const self = this, chips = function (id, opts, cur, fn) {
      const e = $(id); e.innerHTML = opts.map(function (o) { return '<button type="button" class="chip' + (o[0] === cur ? ' on' : '') + '" data-v="' + o[0] + '">' + o[1] + '</button>'; }).join('');
      e.onclick = function (ev) { const b = ev.target.closest('button'); if (!b) return; const v = b.dataset.v; fn(isNaN(+v) || v === '' ? v : +v); self.renderSettings(); };
    };
    chips('s-q', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], settings.quality, function (v) { settings.quality = v; saveSettings(); applyQuality(); });
    chips('s-snd', [[1, 'On'], [0, 'Off']], settings.sound ? 1 : 0, function (v) { settings.sound = !!v; Sound.setMuted(!v); saveSettings(); });
    chips('s-un', [['kmh', 'km/h'], ['mph', 'mph']], settings.units, function (v) { settings.units = v; saveSettings(); });
    chips('s-cam', [[0, 'Chase'], [1, 'Close'], [2, 'Cockpit']], settings.camera, function (v) { settings.camera = v; saveSettings(); });
    chips('s-traf', [[0, 'Off'], [1, 'Light'], [2, 'Busy']], settings.traffic, function (v) { settings.traffic = v; saveSettings(); if (Game.W) Game.buildTraffic(); });
    chips('s-day', [[0, 'Frozen'], [1, 'Normal'], [4, 'Fast']], settings.daySpeed, function (v) { settings.daySpeed = v; saveSettings(); });
    chips('s-time', [[6, 'Dawn'], [12, 'Noon'], [18.5, 'Dusk'], [23, 'Night']], -1, function (v) { if (Game.W) { Game.hours = v; Game.todT = 0; } else Game.hours = v; });
  },

  /* ----- travel (map select) ----- */
  openTravel: function (from) {
    this.travelFrom = from; showEl('scr-menu', false); showEl('scr-travel', true);
    const g = $('tr-grid');
    g.innerHTML = MAPS.map(function (m, i) {
      const P = m.pal, here = i === SAVE.map && Game.W;
      const svg = '<svg viewBox="0 0 200 116" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="sk' + i + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + P.dayTop + '"/><stop offset="1" stop-color="' + P.dayBot + '"/></linearGradient></defs><rect width="200" height="116" fill="url(#sk' + i + ')"/>' +
        '<path d="M0 78 L28 52 L52 70 L84 38 L118 66 L146 46 L200 74 L200 116 L0 116Z" fill="' + P.rock + '" opacity=".85"/><path d="M0 92 Q50 74 100 88 T200 82 L200 116 L0 116Z" fill="' + P.gA + '"/>' +
        '<path d="M-10 112 Q60 86 120 98 T220 90" stroke="' + m.road + '" stroke-width="9" fill="none"/><path d="M-10 112 Q60 86 120 98 T220 90" stroke="' + m.line + '" stroke-width="1" stroke-dasharray="6 6" fill="none"/></svg>';
      return '<button type="button" class="mc' + (here ? ' on' : '') + '" data-i="' + i + '"><div class="pv">' + svg + '</div><div class="tx"><div class="tg">' + esc(m.tag) + '</div><div class="nm">' + esc(m.name) + '</div><div class="ds">' + esc(m.desc) + '</div>' +
        '<div class="mt"><span>Size <b>' + (m.R * 2 / 1000).toFixed(1) + ' km</b></span><span>Challenge <span class="dots">' + [1, 2, 3, 4, 5].map(function (d) { return '<i class="' + (d <= m.difficulty ? 'f' : '') + '"></i>'; }).join('') + '</span></span></div>' +
        '<div class="go">' + (here ? 'You are here' : 'Drive here &rarr;') + '</div></div></button>';
    }).join('');
    g.onclick = function (e) { const b = e.target.closest('.mc'); if (!b) return; const i = +b.dataset.i; if (i === SAVE.map && Game.W) { UI.closeTravel(); if (Game.mode === 'paused') Game.resume(); return; } showEl('scr-travel', false); if (Game.mode !== 'menu') UI.show('hud'); Game.travel(i); };
  },
  closeTravel: function () { showEl('scr-travel', false); if (this.travelFrom === 'menu') { UI.show('menu'); } else { showEl('md-pause', true); } },

  /* ----- garage / dealership ----- */
  openGarage: function () {
    ['scr-menu', 'scr-hud', 'scr-travel'].forEach(function (id) { showEl(id, false); }); showEl('scr-garage', true);
    const g = this.g; g.id = SAVE.current; g.draft = clone(SAVE.owned[g.id]); g.tab = 'cars'; g.q = ''; g.sellArm = false; g.cls = 'All';
    Garage.active = true; Garage.show(g.id, g.draft); Garage.setFocus('car'); this.renderGarage();
  },
  closeGarage: function () { showEl('scr-garage', false); showEl('md-confirm', false); },
  isOwned: function () { return !!SAVE.owned[this.g.id]; },
  dirty: function () { const g = this.g; return this.isOwned() && modsCost(g.id, SAVE.owned[g.id], g.draft) + (JSON.stringify(g.draft) !== JSON.stringify(SAVE.owned[g.id]) ? 1 : 0) > 0; },
  garageEsc: function () { this.garageExit(); },
  garageExit: function () {
    if (this.dirty()) { showEl('md-confirm', true); setText('c-cost', cr(modsCost(this.g.id, SAVE.owned[this.g.id], this.g.draft))); $('c-apply').disabled = !canAfford(modsCost(this.g.id, SAVE.owned[this.g.id], this.g.draft)); return; }
    Game.closeGarage();
  },
  confirmDo: function (a) {
    const g = this.g; showEl('md-confirm', false);
    if (a === 'cancel') return;
    if (a === 'apply') { if (!applyDraft(g.id, g.draft)) return; }
    Game.closeGarage();
  },
  renderGarage: function () {
    const g = this.g, tabs = [['shop', 'Dealership'], ['cars', 'My Cars'], ['paint', 'Paint'], ['wheels', 'Wheels'], ['body', 'Body'], ['perf', 'Tuning'], ['driver', 'Driver']];
    $('g-tabs').innerHTML = tabs.map(function (t) { return '<button type="button" role="tab" data-t="' + t[0] + '" class="' + (g.tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('');
    this.refreshWallet(); this.renderBody(); this.renderStats(); this.renderFoot();
  },
  pick: function (id) {
    const g = this.g; g.id = id; g.sellArm = false; g.draft = clone(SAVE.owned[id] || defaultMods());
    if (SAVE.owned[id]) { SAVE.current = id; persist(); }
    Garage.show(id, g.draft); this.renderBody(true); this.renderStats(); this.renderFoot();
  },
  pc: function (price, cur) { return cur ? '<em class="cur">&#10003;</em>' : (price > 0 ? '<em class="pr">' + fmtMoney(price) + '</em>' : ''); },
  chipRow: function (label, key, list, price, nameFn) {
    const d = this.g.draft, sv = SAVE.owned[this.g.id] || d, self = this;
    return '<div class="opt"><div class="lab">' + label + '</div><div class="chips">' + list.map(function (it, i) {
      const nm = nameFn ? nameFn(it, i) : it, cur = sv[key] === i;
      return '<button type="button" class="chip' + (d[key] === i ? ' on' : '') + '" data-a="set" data-k="' + key + '" data-v="' + i + '">' + esc(nm) + (d[key] === i && cur ? '' : self.pc(price ? price(i) : 0, cur && d[key] !== i)) + '</button>';
    }).join('') + '</div></div>';
  },
  swatchRow: function (label, key, list, hexFn, nameFn, price) {
    const d = this.g.draft, sv = SAVE.owned[this.g.id] || d;
    return '<div class="opt"><div class="lab">' + label + '<em>' + esc(nameFn(list[d[key]], d[key])) + (price !== undefined && d[key] !== sv[key] ? ' · ' + (price > 0 ? cr(price) : 'free') : '') + '</em></div><div class="sw">' + list.map(function (it, i) {
      const h = hexFn(it); return '<button type="button" aria-label="' + esc(nameFn(it, i)) + '" class="' + (d[key] === i ? 'on' : '') + (h ? '' : ' none') + '" style="' + (h ? 'background:' + h : '') + '" data-a="set" data-k="' + key + '" data-v="' + i + '"></button>';
    }).join('') + '</div></div>';
  },
  renderBody: function (keepScroll) {
    const g = this.g, el = $('g-body'), st = el.scrollTop, owned = this.isOwned(), d = g.draft, self = this; let h = '';
    const needOwn = '<div class="empty">You don\'t own this car yet. Buy it in the Dealership to paint, tune and modify it.</div>';
    if (g.tab === 'cars') {
      const ids = Object.keys(SAVE.owned).map(Number);
      h += '<div class="lab2">Your garage · ' + ids.length + ' car' + (ids.length > 1 ? 's' : '') + '</div><div class="carlist">' + ids.map(function (id) { return self.carCard(id, true); }).join('') + '</div>';
      if (owned) {
        const sv = sellValue(g.id), only = Object.keys(SAVE.owned).length < 2;
        h += '<button type="button" class="btn ghost' + (g.sellArm ? ' danger' : '') + '" data-a="sell"' + (only ? ' disabled' : '') + '>' + (only ? 'Keep at least one car' : (g.sellArm ? 'Confirm: sell for ' + cr(sv) : 'Sell this car · ' + cr(sv))) + '</button>';
      }
    } else if (g.tab === 'shop') {
      h += '<div class="search"><input id="g-search" class="textin" type="search" placeholder="Search cars" value="' + esc(g.q) + '" autocomplete="off"></div>';
      h += '<div class="chips">' + CAR_CLASSES.map(function (c) { return '<button type="button" class="chip' + (g.cls === c ? ' on' : '') + '" data-a="cls" data-v="' + c + '">' + c + '</button>'; }).join('') + '</div>';
      h += '<div class="chips"><span class="lab2" style="margin:0 6px 0 0;align-self:center">Sort</span>' + [['price', 'Price'], ['speed', 'Speed'], ['accel', 'Accel'], ['handling', 'Handling']].map(function (s) { return '<button type="button" class="chip' + (g.sort === s[0] ? ' on' : '') + '" data-a="sort" data-v="' + s[0] + '">' + s[1] + '</button>'; }).join('') + '</div>';
      let list = CARS.filter(function (c) { return (g.cls === 'All' || c.cls === g.cls) && (!g.q || (c.make + ' ' + c.model).toLowerCase().indexOf(g.q.toLowerCase()) >= 0); });
      list.sort(function (a, b) { return g.sort === 'price' ? a.price - b.price : b.rate[g.sort] - a.rate[g.sort]; });
      h += '<div class="carlist">' + (list.length ? list.map(function (c) { return self.carCard(c.id, false); }).join('') : '<div class="empty">No cars match.</div>') + '</div>';
    } else if (g.tab === 'paint') {
      if (!owned) h = needOwn; else {
        const sv = SAVE.owned[g.id];
        h += this.swatchRow('Colour', 'paint', PAINTS, function (p) { return p[1]; }, function (p) { return p ? p[0] : ''; }, d.customPaint ? undefined : COST.paint);
        h += '<div class="opt"><div class="lab">Custom colour<em>' + (d.customPaint ? (sv.customPaint === d.customPaint ? 'applied' : cr(COST.customPaint)) : cr(COST.customPaint)) + '</em></div><div class="colorpick"><input id="g-cpaint" type="color" value="' + (d.customPaint || PAINTS[d.paint][1]) + '"><button type="button" class="chip" data-a="cp-on">Use custom</button><button type="button" class="chip" data-a="cp-off">Clear</button></div></div>';
        h += this.chipRow('Finish', 'finish', FINISHES, function (i) { return COST.finish[i]; }, function (f) { return f.name; });
        h += this.chipRow('Window tint', 'tint', TINTS, function (i) { return COST.tint[i]; }, function (t) { return t[0]; });
        h += this.swatchRow('Underglow', 'underglow', UNDERGLOWS, function (u) { return u[1]; }, function (u) { return u ? u[0] : ''; }, COST.underglow[d.underglow]);
      }
    } else if (g.tab === 'wheels') {
      if (!owned) h = needOwn; else {
        h += this.chipRow('Wheel style', 'wheelStyle', WHEEL_STYLES, function (i) { return COST.wheelStyle[i]; });
        h += this.swatchRow('Wheel colour', 'wheelColor', WHEEL_COLORS, function (w) { return w[1]; }, function (w) { return w ? w[0] : ''; }, COST.wheelColor);
      }
    } else if (g.tab === 'body') {
      if (!owned) h = needOwn; else {
        h += this.chipRow('Spoiler', 'spoiler', SPOILERS, function (i) { return COST.spoiler[i]; });
        h += this.chipRow('Stance', 'stance', STANCES, function (i) { return COST.stance[i]; }, function (s) { return s[0]; });
        h += this.chipRow('Livery stripes', 'stripe', STRIPES, function (i) { return COST.stripe[i]; });
        if (d.stripe > 0) h += this.swatchRow('Stripe colour', 'stripeColor', STRIPE_COLORS, function (s) { return s[1]; }, function (s) { return s ? s[0] : ''; }, COST.stripeColor);
      }
    } else if (g.tab === 'perf') {
      if (!owned) h = needOwn; else {
        const sv = SAVE.owned[g.id];
        h += '<div class="lab2">Performance parts · prices scale with the car</div>';
        PERF.forEach(function (p) {
          h += '<div class="opt"><div class="lab">' + p.name + '<em>' + p.desc + '</em></div><div class="chips">';
          for (let s = 0; s <= 3; s++) {
            let pr = 0; for (let k = sv.perf[p.key] + 1; k <= s; k++) pr += perfCost(g.id, p.key, k);
            const lock = s < sv.perf[p.key];
            h += '<button type="button" class="chip' + (d.perf[p.key] === s ? ' on' : '') + '"' + (lock ? ' disabled' : '') + ' data-a="perf" data-k="' + p.key + '" data-v="' + s + '">' + (s === 0 ? 'Stock' : 'Stage ' + s) + (s === sv.perf[p.key] ? '<em class="cur">&#10003;</em>' : (pr > 0 ? '<em class="pr">' + fmtMoney(pr) + '</em>' : '')) + '</button>';
          }
          h += '</div></div>';
        });
      }
    } else if (g.tab === 'driver') {
      const dr = SAVE.driver, sw = function (label, key, list, hexFn, nameFn) {
        return '<div class="opt"><div class="lab">' + label + '</div><div class="sw">' + list.map(function (it, i) { return '<button type="button" aria-label="' + esc(nameFn(it, i)) + '" class="' + (dr[key] === i ? 'on' : '') + '" style="background:' + hexFn(it) + '" data-a="drv" data-k="' + key + '" data-v="' + i + '"></button>'; }).join('') + '</div></div>';
      }, ch = function (label, key, list) { return '<div class="opt"><div class="lab">' + label + '</div><div class="chips">' + list.map(function (it, i) { return '<button type="button" class="chip' + (dr[key] === i ? ' on' : '') + '" data-a="drv" data-k="' + key + '" data-v="' + i + '">' + esc(it) + '</button>'; }).join('') + '</div></div>'; };
      h += '<div class="opt"><div class="lab">Name</div><input id="g-name" class="textin" maxlength="14" value="' + esc(dr.name) + '" autocomplete="off"></div>' + sw('Skin', 'skin', SKIN_TONES, function (x) { return x; }, function (x, i) { return 'Skin ' + (i + 1); }) +
        ch('Hair style', 'hair', HAIR_STYLES) + sw('Hair colour', 'hairColor', HAIR_COLORS, function (x) { return x; }, function (x, i) { return 'Hair ' + (i + 1); }) + sw('Race suit', 'suit', SUIT_COLORS, function (x) { return x; }, function (x, i) { return 'Suit ' + (i + 1); }) +
        ch('Helmet', 'helmet', HELMETS) + sw('Helmet colour', 'helmetColor', HELMET_COLORS, function (x) { return x; }, function (x, i) { return 'Helmet ' + (i + 1); });
      h += '<div class="hint">Driver changes are free and saved automatically.</div>';
    }
    el.innerHTML = h; if (keepScroll) el.scrollTop = st;
  },
  carCard: function (id, mine) {
    const c = CARS[id], g = this.g, own = !!SAVE.owned[id], pips = Math.ceil(c.tier / 2);
    return '<button type="button" class="cc' + (g.id === id ? ' on' : '') + '" data-a="pick" data-v="' + id + '"><span class="mk">' + esc(c.make) + ' · ' + c.cls + '</span><span class="md">' + esc(c.model) + '</span>' +
      '<span class="pips">' + [1, 2, 3, 4, 5].map(function (p) { return '<i class="' + (p <= pips ? 'f' : '') + '"></i>'; }).join('') + '<span>' + (own ? (SAVE.current === id && mine ? 'DRIVING' : 'OWNED') : cr(c.price)) + '</span></span></button>';
  },
  garageAct: function (a, k, v) {
    const g = this.g; v = isNaN(+v) || v === '' ? v : +v;
    if (a === 'pick') { this.pick(v); return; }
    if (a === 'cls') { g.cls = v; this.renderBody(true); return; }
    if (a === 'sort') { g.sort = v; this.renderBody(true); return; }
    if (a === 'sell') {
      if (!g.sellArm) { g.sellArm = true; this.renderBody(true); return; }
      const id = g.id; if (sellCar(id)) { Game.toast && 0; this.pick(SAVE.current); this.refreshWallet(); } return;
    }
    if (a === 'drv') { SAVE.driver[k] = v; persist(); Garage.refresh(); this.renderBody(true); return; }
    if (!this.isOwned()) return;
    const d = g.draft;
    if (a === 'set') { d[k] = v; if (k === 'paint') d.customPaint = null; }
    else if (a === 'perf') { if (v < SAVE.owned[g.id].perf[k]) return; d.perf[k] = v; }
    else if (a === 'cp-on') { const e = $('g-cpaint'); d.customPaint = e ? e.value : PAINTS[d.paint][1]; }
    else if (a === 'cp-off') d.customPaint = null;
    if (k === 'paint' || k === 'finish' || a === 'cp-on' || a === 'cp-off') { if (k === 'finish' || k === 'paint' || a.indexOf('cp') === 0) Garage.setPaintLive(); } else Garage.refresh();
    this.renderBody(true); this.renderStats(); this.renderFoot();
  },
  renderStats: function () {
    const g = this.g, c = CARS[g.id], s = carStats(g.id, g.draft), base = carStats(g.id, SAVE.owned[g.id] || defaultMods()), own = this.isOwned();
    const bar = function (lab, key) { const dv = s.rate[key] - base.rate[key]; return '<div class="bar"><span>' + lab + '</span><div><i style="width:' + clamp(s.rate[key], 0, 100) + '%"></i></div><b>' + s.rate[key] + (dv > 0 ? '<small class="up"> +' + dv + '</small>' : '') + '</b></div>'; };
    $('g-stats').innerHTML = '<div class="sub">' + esc(c.make) + ' · ' + c.cls + (own ? '' : ' · for sale') + '</div><h3>' + esc(c.model) + '</h3>' + bar('Speed', 'speed') + bar('Accel', 'accel') + bar('Handling', 'handling') + bar('Braking', 'braking') +
      '<div class="specs"><span><b>' + s.hp + '</b> hp</span><span><b>' + s.topKmh + '</b> km/h</span><span><b>' + s.zeroTo100 + '</b> s 0-100</span><span>PI <b>' + s.pi + '</b></span></div>';
  },
  renderFoot: function () {
    const g = this.g, f = $('g-foot'); if (!f) return; let h = '';
    if (!this.isOwned()) {
      const c = CARS[g.id], ok = canAfford(c.price);
      h = '<button type="button" class="btn primary" data-a="buy"' + (ok ? '' : ' disabled') + '>' + (ok ? 'Buy · ' + cr(c.price) : 'Need ' + cr(c.price - SAVE.money) + ' more') + '</button>';
    } else {
      const cost = modsCost(g.id, SAVE.owned[g.id], g.draft), ch = JSON.stringify(g.draft) !== JSON.stringify(SAVE.owned[g.id]);
      if (ch) h = '<button type="button" class="btn" data-a="revert">Revert</button><button type="button" class="btn primary" data-a="apply"' + (canAfford(cost) ? '' : ' disabled') + '>' + (cost > 0 ? (canAfford(cost) ? 'Apply · ' + cr(cost) : 'Need ' + cr(cost - SAVE.money) + ' more') : 'Apply') + '</button>';
      else h = '<div class="hint" style="padding:11px 4px">No pending changes</div>';
    }
    h += '<button type="button" class="btn ghost" data-a="exit">' + (Game.pauseFrom === 'world' ? 'Back to game' : 'Menu') + '</button>';
    f.innerHTML = h;
  }
};

/* footer buttons delegate */
document.addEventListener('click', function (e) {
  const b = e.target.closest('#g-foot [data-a]'); if (!b) return; const a = b.dataset.a, g = UI.g;
  if (a === 'buy') { if (buyCar(g.id)) { g.draft = clone(SAVE.owned[g.id]); Garage.show(g.id, g.draft); g.tab = 'cars'; UI.renderGarage(); Sound.cash(); } }
  else if (a === 'revert') { g.draft = clone(SAVE.owned[g.id]); Garage.show(g.id, g.draft); UI.renderBody(true); UI.renderStats(); UI.renderFoot(); }
  else if (a === 'apply') { if (applyDraft(g.id, g.draft)) { g.draft = clone(SAVE.owned[g.id]); UI.renderBody(true); UI.renderStats(); UI.renderFoot(); Sound.cash(); } }
  else if (a === 'exit') UI.garageExit();
});

/* ----- full map ----- */
UI.openMap = function () {
  showEl('scr-map', true); this.bigSel = null; this.bmInfo();
  const cv = $('bigmap'), S = Math.floor(Math.min(window.innerWidth * 0.94, window.innerHeight * 0.74, 760)); cv.width = cv.height = S; cv.style.width = cv.style.height = S + 'px'; this.bigS = S;
};
UI.closeMap = function () { showEl('scr-map', false); };
UI.bmInfo = function () {
  const s = this.bigSel; showEl('bm-wp', !!s); showEl('bm-go', !!(s && s.h !== undefined));
  setText('bm-title', s ? s.name : 'Tap the map to set a waypoint'); setText('bm-sub', s ? s.sub : (Game.wp ? 'Waypoint active' : 'Tap an event marker for details and fast travel'));
};
UI.pinsFor = function () {
  const W = Game.W, pins = []; if (!W) return pins;
  W.events.forEach(function (e) { pins.push({ x: e.x, z: e.z, h: e.h, name: e.name, sub: ({ circuit: 'Circuit race', sprint: 'Sprint race', attack: 'Time attack' })[e.type] + ' · up to ' + cr(e.reward) + (SAVE.best[e.id] ? ' · best ' + fmtTime(SAVE.best[e.id]) : ''), col: e.type === 'circuit' ? '#ffb020' : e.type === 'sprint' ? '#27d3ff' : '#c98bff', r: 6 }); });
  W.traps.forEach(function (t) { const d = SAVE.trapsDone[t.id]; pins.push({ x: t.x, z: t.z, h: Math.atan2(t.tx, t.tz), name: 'Speed trap', sub: 'Reach ' + t.need + ' km/h · ' + cr(t.reward) + (d ? ' · best ' + d + ' km/h' : ''), col: d ? '#2e7d4a' : '#5fe08a', r: 4.5 }); });
  return pins;
};
UI.drawBigMap = function () {
  const W = Game.W, cv = $('bigmap'), c = cv.getContext('2d'), S = this.bigS; if (!W || !W.mapCanvas) return;
  const k = S / (W.mapExt * 2), tx = function (v) { return (v + W.mapExt) * k; }, v = Game.player;
  c.clearRect(0, 0, S, S); c.drawImage(W.mapCanvas, 0, 0, S, S);
  this.bigPins = this.pinsFor();
  this.bigPins.forEach(function (p) { c.fillStyle = p.col; c.strokeStyle = '#000'; c.lineWidth = 1.5; c.beginPath(); c.arc(tx(p.x), tx(p.z), p.r, 0, 6.2832); c.fill(); c.stroke(); });
  const sel = this.bigSel; if (sel) { c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.arc(tx(sel.x), tx(sel.z), 11, 0, 6.2832); c.stroke(); }
  if (Game.wp) { c.fillStyle = '#ff5a64'; c.beginPath(); c.arc(tx(Game.wp.x), tx(Game.wp.z), 6, 0, 6.2832); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke(); }
  c.save(); c.translate(tx(v.x), tx(v.z)); c.rotate(-v.h + Math.PI); c.rotate(0); c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, -9); c.lineTo(6, 8); c.lineTo(0, 4); c.lineTo(-6, 8); c.closePath(); c.fill(); c.stroke(); c.restore();
};
UI.bigClick = function (e) {
  const W = Game.W; if (!W) return; const cv = $('bigmap'), r = cv.getBoundingClientRect(), mx = (e.clientX - r.left) * (cv.width / r.width), my = (e.clientY - r.top) * (cv.height / r.height), k = this.bigS / (W.mapExt * 2);
  let best = null, bd = 16; this.bigPins.forEach(function (p) { const d = Math.hypot((p.x + W.mapExt) * k - mx, (p.z + W.mapExt) * k - my); if (d < bd) { bd = d; best = p; } });
  this.bigSel = best || { x: mx / k - W.mapExt, z: my / k - W.mapExt, name: 'Waypoint', sub: 'Custom location' };
  this.bmInfo();
};
