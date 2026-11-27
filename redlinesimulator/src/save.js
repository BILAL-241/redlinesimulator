'use strict';
/* ============================================================
   SAVE + ECONOMY: money, owned cars, per-car mods, settings
   ============================================================ */

const SAVE_KEY = 'rg2_save';
const settings = Object.assign({ quality: 'auto', sound: true, units: 'kmh', camera: 0, daySpeed: 1, traffic: 1 }, store.get('rg2_settings', {}));
function saveSettings() { store.set('rg2_settings', settings); }

const SAVE = { v: 2, money: 12000, current: STARTER_CAR, owned: {}, driver: defaultDriver(), map: 0, stats: { km: 0, wins: 0, races: 0, earned: 0, drift: 0, topKmh: 0 }, best: {}, trapsDone: {}, clock: {}, pos: null };

function clampIdx(v, len, def) { v = Math.floor(Number(v)); return (isFinite(v) && v >= 0 && v < len) ? v : def; }

function sanitizeMods(m) {
  const d = defaultMods(); m = Object.assign(d, m || {});
  m.paint = clampIdx(m.paint, PAINTS.length, 0); m.finish = clampIdx(m.finish, FINISHES.length, 0);
  m.wheelStyle = clampIdx(m.wheelStyle, WHEEL_STYLES.length, 0); m.wheelColor = clampIdx(m.wheelColor, WHEEL_COLORS.length, 0);
  m.spoiler = clampIdx(m.spoiler, SPOILERS.length, 0); m.stance = clampIdx(m.stance, STANCES.length, 0);
  m.tint = clampIdx(m.tint, TINTS.length, 1); m.stripe = clampIdx(m.stripe, STRIPES.length, 0);
  m.stripeColor = clampIdx(m.stripeColor, STRIPE_COLORS.length, 0); m.underglow = clampIdx(m.underglow, UNDERGLOWS.length, 0);
  if (typeof m.customPaint !== 'string' || !/^#[0-9a-f]{6}$/i.test(m.customPaint)) m.customPaint = null;
  const p = Object.assign({ engine: 0, tires: 0, brakes: 0, nitro: 0 }, m.perf || {});
  PERF.forEach(function (x) { p[x.key] = clampIdx(p[x.key], 4, 0); });
  m.perf = p;
  return m;
}

function sanitizeSave() {
  SAVE.money = isFinite(SAVE.money) ? Math.max(0, Math.floor(SAVE.money)) : 12000;
  const owned = {};
  Object.keys(SAVE.owned || {}).forEach(function (k) { const id = Number(k); if (CARS[id]) owned[id] = sanitizeMods(SAVE.owned[k]); });
  if (!Object.keys(owned).length) owned[STARTER_CAR] = defaultMods();
  SAVE.owned = owned;
  SAVE.current = owned[SAVE.current] ? SAVE.current : Number(Object.keys(owned)[0]);
  const dr = Object.assign(defaultDriver(), SAVE.driver || {});
  dr.hair = clampIdx(dr.hair, HAIR_STYLES.length, 0); dr.hairColor = clampIdx(dr.hairColor, HAIR_COLORS.length, 0);
  dr.skin = clampIdx(dr.skin, SKIN_TONES.length, 1); dr.suit = clampIdx(dr.suit, SUIT_COLORS.length, 0);
  dr.helmet = clampIdx(dr.helmet, HELMETS.length, 1); dr.helmetColor = clampIdx(dr.helmetColor, HELMET_COLORS.length, 0);
  dr.name = String(dr.name || 'Driver').replace(/[<>&"]/g, '').slice(0, 14) || 'Driver';
  SAVE.driver = dr;
  SAVE.map = clampIdx(SAVE.map, MAPS.length, 0);
  SAVE.stats = Object.assign({ km: 0, wins: 0, races: 0, earned: 0, drift: 0, topKmh: 0 }, SAVE.stats || {});
  SAVE.best = SAVE.best && typeof SAVE.best === 'object' ? SAVE.best : {};
  SAVE.trapsDone = SAVE.trapsDone && typeof SAVE.trapsDone === 'object' ? SAVE.trapsDone : {};
  SAVE.clock = SAVE.clock && typeof SAVE.clock === 'object' ? SAVE.clock : {};
  const ps = SAVE.pos; SAVE.pos = (ps && isFinite(ps.x) && isFinite(ps.z) && isFinite(ps.h) && ps.map === SAVE.map) ? { x: +ps.x, z: +ps.z, h: +ps.h, map: ps.map } : null;
}

(function loadSave() {
  const s = store.get(SAVE_KEY, null);
  if (s && typeof s === 'object') Object.assign(SAVE, s);
  sanitizeSave();
})();
function persist() { store.set(SAVE_KEY, SAVE); if (typeof Account !== 'undefined') Account.scheduleUpload(); }

/* ----- money ----- */
function addMoney(n, why) {
  n = Math.round(n); if (!n) return;
  SAVE.money = Math.max(0, SAVE.money + n);
  if (n > 0) SAVE.stats.earned += n;
  if (window.onMoney) window.onMoney(n, why);
}
function canAfford(n) { return SAVE.money >= n; }

/* ----- profile used by the mesh builder: current owned car mods + driver ----- */
function profileFor(carId, mods) {
  const m = mods || SAVE.owned[carId] || defaultMods();
  return Object.assign({}, m, { perf: Object.assign({}, m.perf), driver: SAVE.driver });
}

/* ----- stats with upgrades applied (used by physics and garage) ----- */
function carStats(carId, mods) {
  const c = CARS[carId], m = mods || SAVE.owned[carId] || defaultMods();
  const p = m.perf || {};
  const at = function (arr, st) { return st > 0 ? arr[st - 1] : 1; };
  const e = PERF[0], t = PERF[1], b = PERF[2], n = PERF[3];
  let grip = c.grip * at(t.grip, p.tires), top = c.topMs * at(e.top, p.engine), acc = c.accel * at(e.acc, p.engine), brake = c.brake * at(b.brake, p.brakes);
  const sm = [1, 1.03, 1.05, 0.96][m.stance || 0]; grip *= sm;
  if (m.spoiler > 0) { grip *= 1 + 0.012 * m.spoiler; top *= 1 - 0.002 * m.spoiler; }
  const tank = at(n.tank, p.nitro);
  const topKmh = Math.round(top * 3.6);
  const out = {
    grip: grip, top: top, topKmh: topKmh, accel: acc, brake: brake, tank: tank, mass: c.mass, steer: c.steer,
    hp: Math.round(c.hp * at(e.acc, p.engine)),
    rate: {
      speed: Math.round(((topKmh - 150) / 190) * 100),
      accel: Math.round(clampN(((acc - 6) / 11) * 100, 6, 100)),
      handling: Math.round(clampN(((grip - 6) / 8) * 100, 6, 100)),
      braking: Math.round(clampN(((brake - 14) / 11) * 100, 6, 100))
    }
  };
  out.pi = Math.round((out.rate.speed + out.rate.accel + out.rate.handling + out.rate.braking) / 4 * 9 + 100);
  out.zeroTo100 = +Math.max(2.0, (27.8 / acc) * 1.28).toFixed(1);
  return out;
}

/* ----- changes in the garage cost money. Compare a draft against the saved mods. ----- */
function modsCost(carId, saved, draft) {
  let c = 0;
  const diff = function (k) { return saved[k] !== draft[k]; };
  if (diff('paint') || (saved.customPaint !== draft.customPaint)) c += draft.customPaint ? (saved.customPaint === draft.customPaint ? 0 : COST.customPaint) : COST.paint;
  if (diff('finish')) c += COST.finish[draft.finish];
  if (diff('wheelStyle')) c += COST.wheelStyle[draft.wheelStyle];
  if (diff('wheelColor')) c += COST.wheelColor;
  if (diff('spoiler')) c += COST.spoiler[draft.spoiler];
  if (diff('stance')) c += COST.stance[draft.stance];
  if (diff('tint')) c += COST.tint[draft.tint];
  if (diff('stripe')) c += COST.stripe[draft.stripe];
  if (diff('stripeColor') && draft.stripe > 0) c += COST.stripeColor;
  if (diff('underglow')) c += COST.underglow[draft.underglow];
  PERF.forEach(function (p) {
    const from = saved.perf[p.key], to = draft.perf[p.key];
    for (let s = from + 1; s <= to; s++) c += perfCost(carId, p.key, s);
  });
  return c;
}

function applyDraft(carId, draft) {
  const cost = modsCost(carId, SAVE.owned[carId], draft);
  if (!canAfford(cost)) return false;
  SAVE.owned[carId] = sanitizeMods(JSON.parse(JSON.stringify(draft)));
  addMoney(-cost, 'mods'); persist(); return true;
}

function sellValue(carId) {
  const c = CARS[carId], m = SAVE.owned[carId]; if (!m) return 0;
  let invested = 0; PERF.forEach(function (p) { for (let s = 1; s <= m.perf[p.key]; s++) invested += perfCost(carId, p.key, s); });
  return Math.round((c.price * 0.55 + invested * 0.4) / 50) * 50;
}
function buyCar(carId) {
  const c = CARS[carId]; if (!c || SAVE.owned[carId] || !canAfford(c.price)) return false;
  addMoney(-c.price, 'buy'); SAVE.owned[carId] = defaultMods(); SAVE.current = carId; persist(); return true;
}
function sellCar(carId) {
  if (!SAVE.owned[carId] || Object.keys(SAVE.owned).length < 2) return false;
  const v = sellValue(carId); delete SAVE.owned[carId];
  if (SAVE.current === carId) SAVE.current = Number(Object.keys(SAVE.owned)[0]);
  addMoney(v, 'sell'); persist(); return true;
}
