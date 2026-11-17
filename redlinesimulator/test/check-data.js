'use strict';
// Data and economy sanity. Run: node test/check-data.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const sb = { console, Math, document: { createElement: () => ({ getContext: () => ({}) }) }, localStorage: { getItem() { return null; }, setItem() {} } };
sb.window = sb; vm.createContext(sb);
['util.js', 'data.js', 'save.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', f), 'utf8'), sb, { filename: f }));
const r = JSON.parse(vm.runInContext(`(function () {
  const bad = [], names = new Set();
  if (CARS.length < 50 || CARS.length > 60) bad.push('car count ' + CARS.length);
  if (MAPS.length < 5 || MAPS.length > 6) bad.push('map count ' + MAPS.length);
  CARS.forEach(function (c) {
    if (names.has(c.name)) bad.push('dup ' + c.name); names.add(c.name);
    const s = carStats(c.id, defaultMods());
    if (!(s.topKmh > 140 && s.topKmh < 380 && s.accel > 5 && s.accel < 20 && s.grip > 6 && s.grip < 15)) bad.push(c.name + ' stats out of range');
    if (!(c.price >= 3000 && c.price < 600000)) bad.push(c.name + ' price ' + c.price);
  });
  const mx = carStats(CARS.find(c => c.model === 'Zero').id, sanitizeMods({ perf: { engine: 3, tires: 3, brakes: 3, nitro: 3 } }));
  if (mx.topKmh > 420) bad.push('maxed top speed ' + mx.topKmh);
  if (!SAVE.owned[STARTER_CAR]) bad.push('no starter');
  if (CARS[STARTER_CAR].price > SAVE.money) bad.push('starter more than starting cash');
  // buy / sell round trip
  const id = CARS.find(c => c.price < 12000 && c.id !== STARTER_CAR).id, m0 = SAVE.money;
  if (!buyCar(id)) bad.push('buy failed'); if (SAVE.money !== m0 - CARS[id].price) bad.push('buy cost wrong');
  const d = JSON.parse(JSON.stringify(SAVE.owned[id])); d.paint = 3; d.perf.engine = 2; const cost = modsCost(id, SAVE.owned[id], d);
  SAVE.money = cost - 1; if (applyDraft(id, d)) bad.push('applied while broke'); SAVE.money = cost + 5; if (!applyDraft(id, d) || SAVE.money !== 5) bad.push('apply cost wrong');
  const sv = sellValue(id); if (!(sv > 0 && sv < CARS[id].price + cost)) bad.push('sell value ' + sv);
  if (!sellCar(id)) bad.push('sell failed');
  MAPS.forEach(function (m) { ['theme', 'seed', 'R', 'Rin', 'start', 'hill', 'flat', 'rim', 'pal', 'road', 'line', 'sunI', 'ambI', 'fog', 'cloud', 'difficulty'].forEach(function (k) { if (m[k] === undefined) bad.push(m.name + ' missing ' + k); }); });
  const san = sanitizeMods({ paint: 999, wheelStyle: -3, perf: { engine: 99 }, customPaint: 'bad' }); if (san.paint !== 0 || san.perf.engine !== 0 || san.customPaint !== null) bad.push('sanitize failed');
  return JSON.stringify({ bad: bad, cars: CARS.length, maps: MAPS.length, cheapest: CARS.reduce((a, c) => Math.min(a, c.price), 1e9), top: CARS.reduce((a, c) => Math.max(a, c.price), 0) });
})()`, sb));
console.log(r.cars + ' cars, ' + r.maps + ' maps, price range ' + r.cheapest + ' - ' + r.top);
if (r.bad.length) { console.error(r.bad.join('\n')); process.exit(1); }
console.log('data OK');
