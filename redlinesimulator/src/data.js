'use strict';
/* ============================================================
   DATA: cars, prices, customization, performance parts, maps
   All makes are fictional. 12 makes x 5 models = 60 cars.
   ============================================================ */

const BODY = {
  //          mass  gripAdj steerAdj
  hatch:    { mass: 1050, gripAdj: 0.0,  steerAdj: 1.05 },
  sedan:    { mass: 1350, gripAdj: 0.0,  steerAdj: 1.0 },
  coupe:    { mass: 1300, gripAdj: 0.6,  steerAdj: 1.0 },
  wedge:    { mass: 1250, gripAdj: 1.2,  steerAdj: 0.98 },
  roadster: { mass: 1150, gripAdj: 0.7,  steerAdj: 1.02 },
  wagon:    { mass: 1450, gripAdj: -0.3, steerAdj: 0.97 },
  suv:      { mass: 1900, gripAdj: -1.4, steerAdj: 0.92 },
  truck:    { mass: 2100, gripAdj: -1.6, steerAdj: 0.90 }
};

// [make, model, body, tier 1..10, class]
const CAR_TABLE = [
  ['Aurion','Pico','hatch',1,'Compact'], ['Aurion','Verta','sedan',3,'Sedan'], ['Aurion','Kaze','coupe',5,'Sport'], ['Aurion','Shiro','roadster',6,'Sport'], ['Aurion','Raiden','wedge',8,'Super'],
  ['Valkor','Brute','coupe',6,'Muscle'], ['Valkor','Havoc','coupe',7,'Muscle'], ['Valkor','Stallion','coupe',5,'Muscle'], ['Valkor','Dominion','sedan',5,'Muscle'], ['Valkor','Reaper','wedge',9,'Super'],
  ['Nimbus','Drift','hatch',3,'Compact'], ['Nimbus','Cloud','sedan',2,'Sedan'], ['Nimbus','Storm','coupe',6,'Sport'], ['Nimbus','Tempest','roadster',7,'Sport'], ['Nimbus','Zenith','wedge',9,'Hyper'],
  ['Kestrel','Scout','suv',3,'Utility'], ['Kestrel','Ranger','truck',4,'Utility'], ['Kestrel','Summit','suv',5,'Utility'], ['Kestrel','Dune','truck',6,'Utility'], ['Kestrel','Raptor','suv',7,'Utility'],
  ['Orrin','Mini','hatch',1,'Compact'], ['Orrin','Pulse','hatch',4,'Compact'], ['Orrin','Echo','wagon',3,'Sedan'], ['Orrin','Volt','coupe',5,'Sport'], ['Orrin','Arc','sedan',6,'Sedan'],
  ['Zephyra','Aria','coupe',5,'Sport'], ['Zephyra','Lyra','roadster',6,'Sport'], ['Zephyra','Vega','wedge',8,'Super'], ['Zephyra','Nova','wedge',9,'Hyper'], ['Zephyra','Orion','wedge',10,'Hyper'],
  ['Brannock','Clipper','roadster',3,'Classic'], ['Brannock','Barnet','coupe',3,'Classic'], ['Brannock','Regent','sedan',2,'Classic'], ['Brannock','Marlow','wagon',2,'Classic'], ['Brannock','Fury','coupe',5,'Classic'],
  ['Halcyon','Aero','coupe',7,'Sport'], ['Halcyon','Mirage','wedge',8,'Super'], ['Halcyon','Eclipse','wedge',9,'Super'], ['Halcyon','Solstice','roadster',8,'Super'], ['Halcyon','Zero','wedge',10,'Hyper'],
  ['Tessaro','Bolide','wedge',9,'Super'], ['Tessaro','Corsa','coupe',7,'Sport'], ['Tessaro','Vento','roadster',7,'Sport'], ['Tessaro','Strada','sedan',4,'Sedan'], ['Tessaro','Furia','wedge',10,'Hyper'],
  ['Ironvale','Anvil','truck',3,'Utility'], ['Ironvale','Forge','suv',4,'Utility'], ['Ironvale','Vulcan','truck',5,'Utility'], ['Ironvale','Titan','suv',6,'Utility'], ['Ironvale','Colossus','truck',7,'Utility'],
  ['Solene','Petit','hatch',2,'Compact'], ['Solene','Lumen','sedan',4,'Sedan'], ['Solene','Chic','coupe',4,'Sport'], ['Solene','Soleil','roadster',5,'Sport'], ['Solene','Flare','hatch',6,'Compact'],
  ['Draxon','Fang','coupe',8,'Sport'], ['Draxon','Claw','wedge',9,'Super'], ['Draxon','Venom','wedge',10,'Hyper'], ['Draxon','Talon','coupe',7,'Sport'], ['Draxon','Wraith','sedan',8,'Sedan']
];
const CAR_CLASSES = ['All', 'Compact', 'Sedan', 'Classic', 'Muscle', 'Sport', 'Super', 'Hyper', 'Utility'];

// Light signature per make (head style, tail style)
const MAKE_STYLE = {
  Aurion: ['bar', 'bar'], Valkor: ['twin', 'twin'], Nimbus: ['wedge', 'bar'], Kestrel: ['round', 'split'],
  Orrin: ['round', 'twin'], Zephyra: ['wedge', 'bar'], Brannock: ['round', 'twin'], Halcyon: ['bar', 'bar'],
  Tessaro: ['wedge', 'split'], Ironvale: ['twin', 'split'], Solene: ['round', 'split'], Draxon: ['wedge', 'twin']
};

function carPrice(tier, cls) {
  const k = cls === 'Classic' ? 0.85 : (cls === 'Utility' ? 0.92 : 1);
  return Math.round(3500 * Math.pow(tier, 1.7) * k / 100) * 100;
}

function buildCar(row, idx) {
  const make = row[0], model = row[1], body = row[2], tier = row[3], cls = row[4];
  const b = BODY[body], t = tier;
  const topKmh = Math.round(138 + t * 19 + (body === 'wedge' ? 8 : 0) - (body === 'truck' || body === 'suv' ? 14 : 0));
  const accel = 6.2 + t * 1.05 - (b.mass - 1250) / 900;
  const grip = 7.4 + t * 0.34 + b.gripAdj;
  const brake = 15 + t * 0.9 + b.gripAdj * 0.8;
  const hp = Math.round(85 + t * 68 + (b.mass < 1300 ? 12 : 0));
  return {
    id: idx, make: make, model: model, name: make + ' ' + model, body: body, tier: tier, cls: cls, hp: hp,
    topKmh: topKmh, topMs: topKmh / 3.6, accel: accel, grip: grip, brake: brake, mass: b.mass, steer: b.steerAdj,
    price: carPrice(tier, cls), zeroTo100: +Math.max(2.1, (27.8 / accel) * 1.28).toFixed(1),
    factory: 'hsl(' + ((idx * 47) % 360) + ',' + (cls === 'Classic' ? 38 : 62) + '%,' + (cls === 'Classic' ? 42 : 50) + '%)',
    rate: {
      speed: Math.round(((topKmh - 150) / 190) * 100),
      accel: Math.round(clampN(((accel - 6) / 11) * 100, 6, 100)),
      handling: Math.round(clampN(((grip - 6) / 8) * 100, 6, 100)),
      braking: Math.round(clampN(((brake - 14) / 11) * 100, 6, 100))
    }
  };
}
function clampN(v, a, b) { return v < a ? a : (v > b ? b : v); }
const CARS = CAR_TABLE.map(buildCar);
const STARTER_CAR = 20; // Orrin Mini

/* ----------------------- CUSTOMIZATION ----------------------- */
const PAINTS = [
  ['Signal Red', '#d9202b'], ['Sunset Orange', '#ff6a1a'], ['Amber', '#ffb020'], ['Citrus', '#d8e83a'],
  ['Lime', '#5fd35a'], ['Emerald', '#0f9d6b'], ['Teal', '#14b8b0'], ['Ice Blue', '#6fc4ff'],
  ['Cobalt', '#2a5bd7'], ['Midnight', '#16205b'], ['Violet', '#7a47e0'], ['Magenta', '#e0359e'],
  ['Pearl White', '#f3f1ec'], ['Silver', '#b8bcc4'], ['Graphite', '#3a3e46'], ['Onyx', '#0d0e11']
];
const FINISHES = [
  { id: 'gloss',    name: 'Gloss',    metal: 0.25, rough: 0.16, clear: 1.0 },
  { id: 'matte',    name: 'Matte',    metal: 0.05, rough: 0.82, clear: 0.0 },
  { id: 'metallic', name: 'Metallic', metal: 0.85, rough: 0.26, clear: 0.8 },
  { id: 'satin',    name: 'Satin',    metal: 0.4,  rough: 0.5,  clear: 0.3 }
];
const WHEEL_STYLES = ['Five Spoke', 'Mesh', 'Turbine', 'Disc', 'Split Spoke'];
const WHEEL_COLORS = [['Chrome','#d4d8de'], ['Black','#15161a'], ['Gold','#d9a82e'], ['Bronze','#8b5a2b'], ['White','#f3f3f3'], ['Red','#d9202b'], ['Blue','#2a5bd7']];
const SPOILERS = ['None', 'Lip', 'Ducktail', 'Wing', 'GT Wing'];
const STANCES = [['Stock', 0], ['Lowered', -0.05], ['Slammed', -0.09], ['Lifted', 0.09]];
const TINTS = [['Clear', 0.25], ['Light', 0.55], ['Dark', 0.85], ['Limo', 0.97]];
const STRIPES = ['None', 'Single', 'Double', 'Side Band', 'Hood Split'];
const STRIPE_COLORS = [['White','#f4f4f4'], ['Black','#101114'], ['Red','#d9202b'], ['Yellow','#ffd23f'], ['Cyan','#27d3ff']];
const UNDERGLOWS = [['Off', null], ['Cyan', '#27d3ff'], ['Magenta', '#ff3da8'], ['Lime', '#7dff4a'], ['Amber', '#ffb020'], ['Violet', '#9a5bff']];

// Prices in credits (CR). Arrays are indexed by option. Performance prices scale with the car, see perfCost().
const COST = {
  paint: 500, customPaint: 1500, finish: [0, 800, 1200, 600], wheelStyle: [0, 400, 600, 900, 1200], wheelColor: 300,
  spoiler: [0, 600, 1200, 2200, 3500], stance: [0, 700, 1400, 900], tint: [0, 200, 400, 600],
  stripe: [0, 500, 500, 700, 700], stripeColor: 100, underglow: [0, 1500, 1500, 1500, 1500, 1500]
};

const PERF = [
  { key: 'engine', name: 'Engine',      desc: 'More top speed and punch',   frac: [0.06, 0.14, 0.28], top: [1.04, 1.08, 1.12], acc: [1.08, 1.17, 1.28] },
  { key: 'tires',  name: 'Tires',       desc: 'More grip in corners',        frac: [0.04, 0.09, 0.18], grip: [1.05, 1.10, 1.16] },
  { key: 'brakes', name: 'Brakes',      desc: 'Shorter stopping distance',   frac: [0.03, 0.07, 0.14], brake: [1.10, 1.20, 1.32] },
  { key: 'nitro',  name: 'Nitro tank',  desc: 'Longer, stronger boost',      frac: [0.03, 0.08, 0.16], tank: [1.4, 1.9, 2.5] }
];
function perfCost(carId, key, stage) {
  const p = PERF.find(function (x) { return x.key === key; });
  return Math.round(CARS[carId].price * p.frac[stage - 1] / 50) * 50;
}

function defaultMods() {
  return { paint: 0, customPaint: null, finish: 0, wheelStyle: 0, wheelColor: 0, spoiler: 0, stance: 0, tint: 1, stripe: 0, stripeColor: 0, underglow: 0, perf: { engine: 0, tires: 0, brakes: 0, nitro: 0 } };
}

const HAIR_STYLES = ['Short', 'Buzz', 'Long', 'Ponytail', 'Curly', 'None'];
const HAIR_COLORS = ['#1a1412', '#4a3020', '#8a5a2b', '#d8b060', '#b8341f', '#c9c9d0', '#3a6fe0', '#e0509a'];
const SKIN_TONES = ['#ffe0c4', '#f1c27d', '#d79a6a', '#b0714a', '#8a5434', '#5c3a26'];
const SUIT_COLORS = ['#1c2433', '#d9202b', '#f4f4f4', '#2a5bd7', '#ffb020', '#14b8b0', '#7a47e0', '#2b2f36'];
const HELMETS = ['None', 'Full Face', 'Open Face', 'Cap'];
const HELMET_COLORS = ['#f4f4f4', '#101114', '#d9202b', '#ffb020', '#2a5bd7', '#27d3ff'];
function defaultDriver() { return { name: 'Driver', hair: 0, hairColor: 0, skin: 1, suit: 0, helmet: 1, helmetColor: 0 }; }

/* ------------------------------- MAPS -------------------------------
   Each map is an open world about 6 km across. Roads are generated from
   `seed` at load time (see world.js). Colors are sRGB hex.            */
const MAPS = [
  {
    id: 'harbor', name: 'Neon Harbor', tag: 'City and docks', theme: 'city', seed: 11, R: 2250, Rin: 640,
    desc: 'A dense downtown grid under neon, ringed by a fast coastal highway. Best driven after dark.',
    start: 21.5, hill: 5, flat: [1000, 1700], rim: [2500, 3300, 170], difficulty: 3,
    pal: { gA: '#4d6845', gB: '#5c744f', rock: '#6b6f76', snow: '#ffffff', snowLine: 99999, dayTop: '#3f86d6', dayBot: '#cfe0f0' },
    road: '#2c2f38', line: '#e8ecff', sunI: 2.3, ambI: 0.9, fog: 0.00058, cloud: 0.55
  },
  {
    id: 'dunes', name: 'Dune Run', tag: 'Desert highways', theme: 'desert', seed: 23, R: 2300, Rin: 700,
    desc: 'Endless sand, long straights and sweeping bends. Mesas on the horizon and nothing in your way.',
    start: 14, hill: 17, flat: [0, 0], rim: [2400, 3300, 230], difficulty: 2,
    pal: { gA: '#d8ae6a', gB: '#c99857', rock: '#9b6a43', snow: '#ffffff', snowLine: 99999, dayTop: '#3b84d4', dayBot: '#f2d8a6' },
    road: '#46423d', line: '#f4ead2', sunI: 2.7, ambI: 0.95, fog: 0.00062, cloud: 0.25
  },
  {
    id: 'alpine', name: 'Alpine Pass', tag: 'Snow mountains', theme: 'alpine', seed: 37, R: 2200, Rin: 620,
    desc: 'High mountain roads with hairpins, pine forests and snow on the peaks. Narrow and unforgiving.',
    start: 10.5, hill: 44, flat: [0, 0], rim: [2300, 3300, 420], difficulty: 5,
    pal: { gA: '#506c4c', gB: '#60805a', rock: '#7b8088', snow: '#f2f6fa', snowLine: 36, dayTop: '#5b8fcb', dayBot: '#dbe7f3' },
    road: '#3a3f47', line: '#ffffff', sunI: 2.4, ambI: 1.0, fog: 0.00085, cloud: 0.6
  },
  {
    id: 'sakura', name: 'Sakura Valley', tag: 'Forest touge', theme: 'sakura', seed: 41, R: 2150, Rin: 600,
    desc: 'Rolling hills, blossom trees and a mountain village. Golden hour never looked this good.',
    start: 17.4, hill: 26, flat: [0, 0], rim: [2300, 3200, 240], difficulty: 4,
    pal: { gA: '#4f7f4a', gB: '#6c9a52', rock: '#6b6258', snow: '#ffffff', snowLine: 99999, dayTop: '#4f8cd0', dayBot: '#f6d5b8' },
    road: '#34343c', line: '#f6e9e6', sunI: 2.5, ambI: 0.95, fog: 0.0008, cloud: 0.45
  },
  {
    id: 'salt', name: 'Salt Flats', tag: 'Top speed country', theme: 'salt', seed: 53, R: 2500, Rin: 800,
    desc: 'A blinding white plain with the longest, straightest roads in the game. Find your top speed.',
    start: 12, hill: 3, flat: [0, 0], rim: [2800, 3400, 150], difficulty: 1,
    pal: { gA: '#ece9e1', gB: '#dedbd2', rock: '#b8aea2', snow: '#ffffff', snowLine: 99999, dayTop: '#4a9ae8', dayBot: '#f2f7ff' },
    road: '#56595f', line: '#ffffff', sunI: 2.9, ambI: 1.05, fog: 0.00048, cloud: 0.35
  },
  {
    id: 'port', name: 'Iron Port', tag: 'Industrial zone', theme: 'port', seed: 67, R: 2200, Rin: 620,
    desc: 'Container yards, cranes and refineries linked by tight service roads and a big freight ring.',
    start: 8.5, hill: 8, flat: [900, 1500], rim: [2400, 3300, 190], difficulty: 4,
    pal: { gA: '#4a5048', gB: '#3f453f', rock: '#454850', snow: '#ffffff', snowLine: 99999, dayTop: '#6f84a0', dayBot: '#cdd5dd' },
    road: '#2c2e33', line: '#ffd23f', sunI: 2.3, ambI: 0.9, fog: 0.0007, cloud: 0.5
  }
];
