'use strict';
/* ============================================================
   MODELS: sculpted procedural cars + drivers (Three.js r128)
   Car forward = +Z, left = +X, up = +Y.
   Bodies are lofted cross-sections (smooth surfaces), merged per
   material so a car costs ~25 draw calls.
   ============================================================ */

const SHAPES = {
  hatch:    { L: 3.95, W: 1.74, g: 0.15, R: 0.31, wb: 2.45, top: [[-1.98,.74],[-1.88,.94],[-1.3,.97],[.4,.93],[1.2,.84],[1.8,.72],[1.98,.58]], gh: { zf0: .62, zf1: .05, zr1: -1.4, zr0: -1.9, roof: 1.46, belt: .95 } },
  sedan:    { L: 4.75, W: 1.84, g: 0.15, R: 0.33, wb: 2.78, top: [[-2.38,.80],[-2.25,.97],[-1.4,.98],[.7,.93],[1.45,.86],[2.1,.76],[2.38,.62]], gh: { zf0: .72, zf1: .18, zr1: -.85, zr0: -1.3, roof: 1.43, belt: .95 } },
  coupe:    { L: 4.6,  W: 1.87, g: 0.13, R: 0.34, wb: 2.7,  top: [[-2.3,.78],[-2.18,.94],[-1.4,.96],[.5,.92],[1.4,.82],[2.0,.70],[2.3,.56]], gh: { zf0: .55, zf1: -.1, zr1: -.78, zr0: -1.4, roof: 1.31, belt: .93 } },
  wedge:    { L: 4.55, W: 1.98, g: 0.11, R: 0.35, wb: 2.7,  top: [[-2.28,.76],[-2.1,.90],[-1.0,.94],[.35,.90],[1.2,.74],[1.95,.56],[2.28,.44]], gh: { zf0: .42, zf1: -.28, zr1: -.8, zr0: -1.5, roof: 1.14, belt: .88 } },
  roadster: { L: 4.25, W: 1.82, g: 0.13, R: 0.33, wb: 2.55, top: [[-2.12,.74],[-2.0,.90],[-1.0,.93],[.45,.9],[1.3,.8],[1.9,.68],[2.12,.56]], gh: { zf0: .45, zf1: .12, zr1: .1, zr0: .06, roof: 1.08, belt: .92 }, open: true },
  wagon:    { L: 4.9,  W: 1.84, g: 0.15, R: 0.33, wb: 2.85, top: [[-2.45,.82],[-2.3,.98],[-1.2,1.0],[.8,.95],[1.5,.88],[2.2,.77],[2.45,.62]], gh: { zf0: .85, zf1: .3, zr1: -1.8, zr0: -2.3, roof: 1.5, belt: .97 } },
  suv:      { L: 4.7,  W: 1.96, g: 0.24, R: 0.40, wb: 2.8,  top: [[-2.35,.98],[-2.25,1.18],[-1.5,1.2],[.9,1.12],[1.6,1.05],[2.2,.98],[2.35,.82]], gh: { zf0: .9, zf1: .45, zr1: -1.9, zr0: -2.25, roof: 1.78, belt: 1.18 } },
  truck:    { L: 5.3,  W: 2.0,  g: 0.26, R: 0.42, wb: 3.2,  top: [[-2.65,1.0],[-2.5,1.12],[-1.0,1.12],[.55,1.14],[1.9,1.05],[2.5,.98],[2.65,.82]], gh: { zf0: 1.15, zf1: .7, zr1: -.4, zr0: -.55, roof: 1.86, belt: 1.15 }, truck: true }
};

/* ------------------------- helpers ------------------------- */
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function T(x, y, z, rx, ry, rz, sx, sy, sz) {
  _e.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_e); _p.set(x || 0, y || 0, z || 0);
  _s.set(sx == null ? 1 : sx, sy == null ? (sx == null ? 1 : sx) : sy, sz == null ? (sx == null ? 1 : sx) : sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}
const PRIM = {};
function prim(k) {
  if (!PRIM[k]) {
    PRIM.box = new THREE.BoxGeometry(1, 1, 1); PRIM.sph = new THREE.SphereGeometry(1, 14, 10); PRIM.cyl = new THREE.CylinderGeometry(1, 1, 1, 14);
    PRIM.cylLo = new THREE.CylinderGeometry(1, 1, 1, 8); PRIM.cir = new THREE.CircleGeometry(1, 18);
  }
  return PRIM[k];
}
// shared primitives are cloned into the bag so merging may dispose its inputs
class Bag {
  constructor() { this.m = {}; }
  add(k, g, mx, own) { (this.m[k] = this.m[k] || []).push({ g: g, m: mx || new THREE.Matrix4(), dispose: !!own }); }
  prim(k, pk, mx) { this.add(k, prim(pk), mx, false); }
  mesh(k, mat, shadow) {
    const a = this.m[k]; if (!a || !a.length) return null;
    const me = new THREE.Mesh(mergeGeos(a), mat); me.castShadow = shadow !== false; return me;
  }
}

function interp(pts, z) {
  const n = pts.length; if (z <= pts[0][0]) return pts[0][1]; if (z >= pts[n - 1][0]) return pts[n - 1][1];
  let i = 0; while (z > pts[i + 1][0]) i++;
  return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * (z - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
}
function smoothArr(a, passes) {
  for (let k = 0; k < passes; k++) { const b = a.slice(); for (let i = 1; i < a.length - 1; i++) a[i] = (b[i - 1] + 2 * b[i] + b[i + 1]) / 4; }
}

/* per-car silhouette: base shape plus a deterministic variation so no two cars match */
function carShape(car) {
  const S = SHAPES[car.body], r = mulberry32(car.id * 7919 + 13);
  const kL = 1 + (r() - 0.5) * 0.1, kW = 1 + (r() - 0.5) * 0.05, kH = 1 + (r() - 0.5) * 0.07;
  const wide = (car.cls === 'Hyper' || car.cls === 'Super') ? 0.05 : (car.cls === 'Muscle' ? 0.03 : 0);
  const low = car.cls === 'Hyper' ? 0.94 : (car.cls === 'Super' ? 0.96 : 1), k = kH * low;
  const sy = function (y) { return S.g + (y - S.g) * k; }, sz = function (z) { return z * kL; };
  return {
    L: S.L * kL, W: S.W * kW + wide, g: S.g, R: S.R, wb: S.wb * kL, open: !!S.open, truck: !!S.truck, body: car.body,
    top: S.top.map(function (p) { return [sz(p[0]), sy(p[1])]; }),
    gh: { zf0: sz(S.gh.zf0), zf1: sz(S.gh.zf1), zr1: sz(S.gh.zr1), zr0: sz(S.gh.zr0), roof: sy(S.gh.roof), belt: sy(S.gh.belt) },
    flare: wide > 0 ? 0.05 : 0.015, rnd: r
  };
}

/* ------------------------- body loft ------------------------- */
const RING = 30;
function ringPoint(a, hw, yMid, hh, n, tumble) {
  const c = Math.cos(a), s = Math.sin(a);
  const fx = Math.sign(c) * Math.pow(Math.abs(c), 2 / n), fy = Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
  let x = hw * fx; if (fy > 0) x *= 1 - tumble * fy;
  return [x, yMid + hh * fy];
}
function loftGeometry(N, getRing) {
  const pos = new Float32Array(N * RING * 3), uv = new Float32Array(N * RING * 2), idx = [];
  for (let i = 0; i < N; i++) {
    const pts = getRing(i);
    for (let j = 0; j < RING; j++) {
      const o = (i * RING + j);
      pos[o * 3] = pts[j][0]; pos[o * 3 + 1] = pts[j][1]; pos[o * 3 + 2] = pts[j][2];
      uv[o * 2] = i / (N - 1); uv[o * 2 + 1] = j / RING;
    }
  }
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < RING; j++) {
    const a = i * RING + j, b = i * RING + (j + 1) % RING, c = (i + 1) * RING + j, d = (i + 1) * RING + (j + 1) % RING;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function buildBodyLoft(sh, bag, geo) {
  const L = sh.L, zs = [], step = 0.1, n = Math.ceil(L / step);
  for (let i = 0; i <= n; i++) zs.push(-L / 2 + L * i / n);
  const yTopA = zs.map(function (z) { return interp(sh.top, z); }); smoothArr(yTopA, 6);
  const yTopAt = function (z) { return interp(zs.map(function (q, i) { return [q, yTopA[i]]; }), z); };
  const endR = function (z) { const e = 0.2, d = Math.abs(z) - (L / 2 - e); return d <= 0 ? 1 : Math.pow(Math.max(0, 1 - Math.pow(d / e, 3)), 1 / 3); };
  const hwAt = function (z) {
    const t = clamp((Math.abs(z) - 0.25 * L) / (0.25 * L), 0, 1);
    let hw = sh.W / 2 * (1 - 0.1 * t * t);
    const zw = [sh.wb / 2, -sh.wb / 2];
    zw.forEach(function (c) { hw += sh.flare * Math.exp(-Math.pow((z - c) / 0.55, 2)); });
    return hw;
  };
  const yBotAt = function (z) { return sh.g + 0.06 + 0.24 * Math.pow(smoothstep(0.3 * L, 0.5 * L, Math.abs(z)), 1.3); };
  const wheelsZ = [sh.wb / 2, -sh.wb / 2];
  const g = loftGeometry(zs.length, function (i) {
    const z = zs[i], e = endR(z), yb = yBotAt(z), yt = yTopA[i];
    const hh = Math.max(0.03, (yt - yb) / 2 * e), yMid = (yt + yb) / 2, hw = hwAt(z) * e;
    const out = [];
    for (let j = 0; j < RING; j++) {
      const a = Math.PI / 2 + j / RING * Math.PI * 2;
      const p = ringPoint(a, hw, yMid, hh, 3.0, 0.08);
      let x = p[0], y = p[1];
      // wheel arches: dent the lower flank around each wheel so the tire sits in a well
      for (let w = 0; w < 2; w++) {
        const dz = z - wheelsZ[w], dy = y - sh.R, d = Math.sqrt(dz * dz + dy * dy), rr = sh.R * 1.18;
        if (d < rr && Math.abs(x) > hw * 0.35) { const f = Math.pow(1 - d / rr, 0.55); x -= Math.sign(x) * 0.34 * f; }
      }
      out.push([x, y, z]);
    }
    return out;
  });
  geo.paintGeo = g;
  bag.add('paint', g, new THREE.Matrix4(), true);
  return { yTopAt: yTopAt, hwAt: hwAt, yBotAt: yBotAt };
}

function buildGreenhouse(sh, bag, fn) {
  const gh = sh.gh, zr0 = gh.zr0, zf0 = gh.zf0, belt = gh.belt;
  const zs = [], n = Math.max(6, Math.ceil((zf0 - zr0) / 0.08));
  for (let i = 0; i <= n; i++) zs.push(zr0 + (zf0 - zr0) * i / n);
  const roofAt = function (z) {
    if (z >= gh.zf1) { const t = (z - gh.zf1) / Math.max(0.01, zf0 - gh.zf1); return gh.roof - (gh.roof - belt) * Math.pow(t, 1.35); }
    if (z <= gh.zr1) { const t = (gh.zr1 - z) / Math.max(0.01, gh.zr1 - zr0); return gh.roof - (gh.roof - belt) * Math.pow(t, 1.5); }
    const t = (z - gh.zr1) / Math.max(0.01, gh.zf1 - gh.zr1); return gh.roof + 0.025 * Math.sin(t * Math.PI);
  };
  const g = loftGeometry(zs.length, function (i) {
    const z = zs[i], top = roofAt(z), bot = belt - 0.04, hh = Math.max(0.005, (top - bot) / 2), yMid = (top + bot) / 2;
    const hw = fn.hwAt(z) * 0.87;
    const out = [];
    for (let j = 0; j < RING; j++) {
      const a = Math.PI / 2 + j / RING * Math.PI * 2, p = ringPoint(a, hw, yMid, hh, 3.4, 0.3);
      const tt = clamp((p[1] - bot) / (top - bot), 0, 1); // tumblehome: the glass leans inwards towards the roof
      out.push([p[0] * (1 - 0.3 * tt), p[1], z]);
    }
    return out;
  });
  // split faces into roof (paint), pillars (trim), glass by orientation and position
  const pos = g.attributes.position, nor = g.attributes.normal;
  const roof = [], glass = [], trim = [];
  const zB = (gh.zf1 + gh.zr1) / 2, Ns = zs.length;
  for (let i = 0; i < Ns - 1; i++) for (let j = 0; j < RING; j++) {
    const a = i * RING + j, b = i * RING + (j + 1) % RING, c = (i + 1) * RING + j, d = (i + 1) * RING + (j + 1) % RING;
    const cz = (zs[i] + zs[i + 1]) / 2;
    const ny = (nor.getY(a) + nor.getY(b) + nor.getY(c) + nor.getY(d)) / 4;
    const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c) + pos.getY(d)) / 4;
    if (sh.open && cz < gh.zf1 - 0.01) continue;
    if (cy < belt - 0.02 && ny < 0.3) continue;
    let tgt;
    if (ny > 0.45 && cz <= gh.zf1 + 0.001 && cz >= gh.zr1 - 0.001 && !sh.open) tgt = roof;
    else if (Math.abs(ny) < 0.55 && (Math.abs(cz - zB) < 0.05 || cz > zf0 - 0.1 || cz < zr0 + 0.08)) tgt = trim;
    else tgt = glass;
    tgt.push(a, b, c, b, d, c);
  }
  const part = function (key, arr) {
    if (!arr.length) return;
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', pos); gg.setAttribute('normal', nor); gg.setAttribute('uv', g.attributes.uv);
    gg.setIndex(arr); bag.add(key, gg, new THREE.Matrix4(), false);
  };
  part('paint', roof); part('glass', glass); part('trim', trim);
  return { roofAt: roofAt };
}

/* ------------------------- wheels ------------------------- */
function tireGeo(R, w, seg) {
  const pts = [[.62, -.5], [.8, -.5], [.965, -.42], [1, -.2], [1, .2], [.965, .42], [.8, .5], [.62, .5]].map(function (p) { return new THREE.Vector2(R * p[0], w * p[1]); });
  const g = new THREE.LatheGeometry(pts, seg || 24); g.rotateZ(Math.PI / 2); return g;
}
function buildWheelParts(style, R, w, low, caliperHex) {
  const bag = new Bag();
  bag.add('rubber', tireGeo(R, w, low ? 14 : 28), null, true);
  const fx = w * 0.34, rimR = R * 0.62;
  bag.prim('dark', 'cyl', T(w * 0.2, 0, 0, 0, 0, Math.PI / 2, rimR * 0.97, 0.03, rimR * 0.97));
  bag.add('rim', new THREE.TorusGeometry(rimR * 0.97, 0.022, 6, low ? 12 : 26), T(fx, 0, 0, 0, Math.PI / 2, 0), true);
  if (low) { bag.prim('rim', 'cyl', T(fx, 0, 0, 0, 0, Math.PI / 2, rimR * 0.8, 0.02, rimR * 0.8)); return bag; }
  bag.prim('rim', 'cyl', T(fx + 0.01, 0, 0, 0, 0, Math.PI / 2, R * 0.15, 0.04, R * 0.15));
  const sp = function (n, wid, twist, off) {
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + (off || 0), len = rimR * 0.9;
      bag.prim('rim', 'box', new THREE.Matrix4().makeRotationX(a).multiply(T(fx, len / 2 + R * 0.05, 0, 0, twist || 0, 0, 0.03, len, wid)));
    }
  };
  const s = style % 5;
  if (s === 0) sp(5, 0.1);
  else if (s === 1) { sp(16, 0.028); bag.add('rim', new THREE.TorusGeometry(rimR * 0.55, 0.018, 6, 24), T(fx - 0.005, 0, 0, 0, Math.PI / 2, 0), true); }
  else if (s === 2) sp(11, 0.12, 0.6);
  else if (s === 3) bag.prim('rim', 'cyl', T(fx, 0, 0, 0, 0, Math.PI / 2, rimR * 0.9, 0.035, rimR * 0.9));
  else { sp(5, 0.05, 0, -0.1); sp(5, 0.05, 0, 0.1); }
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; bag.prim('chrome', 'cylLo', T(fx + 0.025, Math.cos(a) * R * 0.1, Math.sin(a) * R * 0.1, 0, 0, Math.PI / 2, 0.012, 0.02, 0.012)); }
  bag.prim('disc', 'cyl', T(w * 0.1, 0, 0, 0, 0, Math.PI / 2, R * 0.5, 0.022, R * 0.5));
  bag.prim('caliper', 'box', T(w * 0.1, R * 0.34, R * 0.1, 0, 0, 0, 0.07, R * 0.2, R * 0.34));
  return bag;
}

/* ------------------------- materials ------------------------- */
const CarMats = new Set();
function regMat(m) { CarMats.add(m); return m; }
function makeCarMats(prof) {
  const fin = FINISHES[prof.finish], hex = prof.customPaint || PAINTS[prof.paint][1];
  const M = {};
  M.paint = regMat(new THREE.MeshPhysicalMaterial({ color: lin(hex), metalness: fin.metal, roughness: fin.rough, clearcoat: fin.clear, clearcoatRoughness: 0.04, envMapIntensity: 0.9 }));
  M.glass = regMat(new THREE.MeshPhysicalMaterial({ color: lin('#06090d'), metalness: 0.85, roughness: 0.03, transparent: true, opacity: 0.3 + TINTS[prof.tint][1] * 0.68, envMapIntensity: 1.6 }));
  M.trim = regMat(new THREE.MeshStandardMaterial({ color: lin('#0c0d10'), roughness: 0.5, metalness: 0.3 }));
  M.chrome = regMat(new THREE.MeshStandardMaterial({ color: lin('#e4e7ec'), roughness: 0.12, metalness: 1.0, envMapIntensity: 1.4 }));
  M.rubber = regMat(new THREE.MeshStandardMaterial({ color: lin('#0b0b0d'), roughness: 0.9, metalness: 0 }));
  M.rim = regMat(new THREE.MeshStandardMaterial({ color: lin(WHEEL_COLORS[prof.wheelColor][1]), roughness: 0.22, metalness: 0.92, envMapIntensity: 1.3 }));
  M.dark = regMat(new THREE.MeshStandardMaterial({ color: lin('#121317'), roughness: 0.7, metalness: 0.4 }));
  M.disc = regMat(new THREE.MeshStandardMaterial({ color: lin('#8a8e96'), roughness: 0.4, metalness: 0.9 }));
  const brakeStage = prof.perf ? prof.perf.brakes : 0;
  M.caliper = regMat(new THREE.MeshStandardMaterial({ color: lin(['#2a2d33', '#d9202b', '#ffb020', '#27d3ff'][brakeStage]), roughness: 0.4, metalness: 0.5 }));
  M.interior = regMat(new THREE.MeshStandardMaterial({ color: lin('#1d2027'), roughness: 0.85, metalness: 0 }));
  M.head = regMat(new THREE.MeshStandardMaterial({ color: lin('#fff6e0'), emissive: lin('#fff1d0'), emissiveIntensity: 1.2, roughness: 0.2 }));
  M.tail = regMat(new THREE.MeshStandardMaterial({ color: lin('#3a0508'), emissive: lin('#ff1220'), emissiveIntensity: 0.9, roughness: 0.3 }));
  M.stripe = regMat(new THREE.MeshStandardMaterial({ color: lin(STRIPE_COLORS[prof.stripeColor][1]), roughness: 0.35, metalness: 0.1 }));
  return M;
}

/* ------------------------- lights / details ------------------------- */
function addLights(bag, sh, fn, make) {
  const st = MAKE_STYLE[make] || ['bar', 'bar'], L = sh.L, W = sh.W;
  const zf = L / 2 - 0.32, yf = fn.yTopAt(zf) - 0.1, xf = fn.hwAt(zf) * 0.6;
  [-1, 1].forEach(function (s) {
    bag.prim('trim', 'box', T(s * xf, yf, zf - 0.02, 0, s * 0.3, 0, 0.5, 0.12, 0.14));
    if (st[0] === 'bar') { bag.prim('head', 'box', T(s * xf, yf + 0.01, zf + 0.04, 0, s * 0.3, 0, 0.44, 0.045, 0.06)); bag.prim('head', 'box', T(s * xf * 0.96, yf - 0.045, zf + 0.04, 0, s * 0.3, 0, 0.3, 0.02, 0.05)); }
    if (st[0] === 'twin') { bag.prim('head', 'sph', T(s * (xf + 0.12), yf, zf + 0.05, 0, 0, 0, 0.075, 0.075, 0.035)); bag.prim('head', 'sph', T(s * (xf - 0.1), yf, zf + 0.05, 0, 0, 0, 0.065, 0.065, 0.035)); }
    if (st[0] === 'wedge') { bag.prim('head', 'box', T(s * xf, yf + 0.005, zf + 0.04, 0, s * 0.42, s * -0.22, 0.5, 0.05, 0.06)); bag.prim('head', 'box', T(s * (xf - 0.2), yf - 0.035, zf + 0.06, 0, s * 0.3, 0, 0.12, 0.05, 0.05)); }
    if (st[0] === 'round') { bag.prim('head', 'sph', T(s * xf, yf, zf + 0.05, 0, 0, 0, 0.13, 0.13, 0.04)); bag.prim('chrome', 'cyl', T(s * xf, yf, zf + 0.03, Math.PI / 2, 0, 0, 0.14, 0.01, 0.14)); }
  });
  const zr = -L / 2 + 0.28, yr = fn.yTopAt(zr) - 0.1;
  if (st[1] === 'bar') { bag.prim('tail', 'box', T(0, yr, zr - 0.02, 0, 0, 0, W * 0.74, 0.05, 0.06)); bag.prim('trim', 'box', T(0, yr, zr - 0.01, 0, 0, 0, W * 0.78, 0.09, 0.05)); }
  else [-1, 1].forEach(function (s) {
    const xr = fn.hwAt(zr) * 0.66;
    bag.prim('trim', 'box', T(s * xr, yr, zr, 0, 0, 0, 0.42, 0.11, 0.07));
    if (st[1] === 'twin') { bag.prim('tail', 'cyl', T(s * (xr + 0.1), yr, zr - 0.04, Math.PI / 2, 0, 0, 0.07, 0.03, 0.07)); bag.prim('tail', 'cyl', T(s * (xr - 0.1), yr, zr - 0.04, Math.PI / 2, 0, 0, 0.07, 0.03, 0.07)); }
    else { bag.prim('tail', 'box', T(s * xr, yr + 0.02, zr - 0.04, 0, 0, 0, 0.38, 0.04, 0.04)); bag.prim('tail', 'box', T(s * xr, yr - 0.03, zr - 0.04, 0, 0, 0, 0.26, 0.03, 0.04)); }
  });
  // grille, intakes, splitter, diffuser, plate
  bag.prim('trim', 'box', T(0, fn.yBotAt(zf) + 0.2, L / 2 - 0.14, 0, 0, 0, W * 0.42, 0.14, 0.06));
  bag.prim('trim', 'box', T(0, fn.yBotAt(zf) + 0.05, L / 2 - 0.3, 0, 0, 0, W * 0.62, 0.03, 0.14));
  bag.prim('trim', 'box', T(0, fn.yBotAt(zr) + 0.1, -L / 2 + 0.3, 0, 0, 0, W * 0.6, 0.08, 0.16));
  bag.prim('chrome', 'box', T(0, fn.yBotAt(zr) + 0.28, -L / 2 + 0.02, 0, 0, 0, 0.36, 0.1, 0.02));
}

function addExhaust(bag, sh, fn, stage) {
  const zr = -sh.L / 2 + 0.06, y = fn.yBotAt(zr) + 0.1, r = 0.045 + stage * 0.008;
  [-1, 1].forEach(function (s) { bag.prim('chrome', 'cyl', T(s * sh.W * 0.28, y, zr - 0.02, Math.PI / 2, 0, 0, r, 0.14, r)); bag.prim('dark', 'cyl', T(s * sh.W * 0.28, y, zr - 0.09, Math.PI / 2, 0, 0, r * 0.7, 0.02, r * 0.7)); });
}

function addSpoiler(bag, sh, fn, sp) {
  if (!sp) return;
  const zt = -sh.L / 2 + 0.3, yt = fn.yTopAt(zt), W = sh.W;
  if (sp === 1) bag.prim('paint', 'box', T(0, yt + 0.03, -sh.L / 2 + 0.2, 0, 0, 0, W * 0.78, 0.04, 0.2));
  if (sp === 2) bag.prim('paint', 'box', T(0, yt + 0.06, zt - 0.02, -0.25, 0, 0, W * 0.8, 0.05, 0.4));
  if (sp === 3) { [-1, 1].forEach(function (s) { bag.prim('trim', 'box', T(s * W * 0.3, yt + 0.14, zt, 0, 0, 0, 0.05, 0.3, 0.07)); }); bag.prim('paint', 'box', T(0, yt + 0.3, zt, -0.1, 0, 0, W * 0.92, 0.04, 0.36)); }
  if (sp === 4) {
    [-1, 1].forEach(function (s) { bag.prim('trim', 'box', T(s * W * 0.28, yt + 0.24, zt, 0, 0, 0, 0.06, 0.48, 0.08)); bag.prim('paint', 'box', T(s * W * 0.49, yt + 0.5, zt, 0, 0, 0, 0.03, 0.22, 0.52)); });
    bag.prim('trim', 'box', T(0, yt + 0.5, zt, -0.14, 0, 0, W * 0.98, 0.05, 0.46));
  }
}

function addMisc(bag, sh, fn, gh, drv) {
  const belt = sh.gh.belt;
  // mirrors
  [-1, 1].forEach(function (s) {
    const z = sh.gh.zf0 - 0.14, x = fn.hwAt(z) * 0.98 + 0.07;
    bag.prim('paint', 'box', T(s * x, belt + 0.07, z, 0, s * 0.2, 0, 0.14, 0.08, 0.1));
    bag.prim('trim', 'box', T(s * (x - 0.05), belt + 0.02, z, 0, 0, 0, 0.1, 0.03, 0.04));
  });
  // side skirts
  [-1, 1].forEach(function (s) { bag.prim('trim', 'box', T(s * (fn.hwAt(0) - 0.045), fn.yBotAt(0) + 0.07, -0.1, 0, 0, 0, 0.04, 0.07, sh.wb * 0.5)); });
  if (sh.open) {
    const zc = -0.05; bag.prim('interior', 'box', T(0, fn.yTopAt(zc) + 0.012, zc - 0.1, 0, 0, 0, sh.W * 0.62, 0.02, 1.35));
    [-1, 1].forEach(function (s) { bag.prim('interior', 'box', T(s * sh.W * 0.2, fn.yTopAt(zc) + 0.1, zc - 0.42, 0.2, 0, 0, 0.42, 0.22, 0.12)); bag.prim('interior', 'box', T(s * sh.W * 0.2, fn.yTopAt(zc) + 0.05, zc - 0.18, 0, 0, 0, 0.4, 0.1, 0.36)); });
  }
  if (sh.truck) {
    bag.prim('interior', 'box', T(0, fn.yTopAt(-1.5) + 0.012, -1.6, 0, 0, 0, sh.W * 0.8, 0.02, 2.1));
    [-1, 1].forEach(function (s) { bag.prim('paint', 'box', T(s * sh.W * 0.47, fn.yTopAt(-1.5) + 0.12, -1.6, 0, 0, 0, 0.07, 0.24, 2.2)); });
    bag.prim('paint', 'box', T(0, fn.yTopAt(-2.5) + 0.12, -2.55, 0, 0, 0, sh.W * 0.96, 0.24, 0.07));
  }
}

function addStripes(bag, sh, fn, prof) {
  if (!prof.stripe) return;
  const s = prof.stripe, W = sh.W, zs = [];
  for (let z = -sh.L / 2 + 0.3; z <= sh.L / 2 - 0.3; z += 0.15) zs.push(z);
  const lay = function (x, w) {
    zs.forEach(function (z) {
      if (z > sh.gh.zr0 - 0.05 && z < sh.gh.zf0 + 0.05 && !sh.open) return; // greenhouse region is glass
      bag.prim('stripe', 'box', T(x, fn.yTopAt(z) + 0.006, z, 0, 0, 0, w, 0.012, 0.16));
    });
  };
  if (s === 1) lay(0, W * 0.2);
  if (s === 2) { lay(-W * 0.13, W * 0.08); lay(W * 0.13, W * 0.08); }
  if (s === 3) [-1, 1].forEach(function (sg) { bag.prim('stripe', 'box', T(sg * (fn.hwAt(0) + 0.002), fn.yBotAt(0) + 0.26, 0, 0, 0, 0, 0.012, 0.1, sh.L * 0.62)); });
  if (s === 4) { zs.filter(function (z) { return z > sh.gh.zf0; }).forEach(function (z) { [-1, 1].forEach(function (sg) { bag.prim('stripe', 'box', T(sg * W * 0.09, fn.yTopAt(z) + 0.006, z, 0, 0, 0, W * 0.1, 0.012, 0.16)); }); }); }
}

/* ------------------------- public: build a car ------------------------- */
function buildCarMesh(car, prof, opts) {
  opts = opts || {};
  if (!opts.procedural && typeof CarModels !== 'undefined' && CarModels.ready && CarModels.has(car)) return CarModels.make(car, prof, opts);
  const low = !!opts.low;
  const sh = carShape(car);
  // stance lowers or raises the whole body relative to wheels
  const stanceOff = STANCES[prof.stance || 0][1];
  const group = new THREE.Group(), body = new THREE.Group(); body.name = 'body'; group.add(body);
  const M = makeCarMats(prof), bag = new Bag(), holder = {};
  const fn = buildBodyLoft(sh, bag, holder);
  buildGreenhouse(sh, bag, fn);
  addLights(bag, sh, fn, car.make);
  addExhaust(bag, sh, fn, prof.perf ? prof.perf.engine : 0);
  addSpoiler(bag, sh, fn, prof.spoiler || 0);
  addMisc(bag, sh, fn, holder, null);
  if (!low) addStripes(bag, sh, fn, prof);
  ['paint', 'glass', 'trim', 'chrome', 'dark', 'interior', 'head', 'tail', 'stripe'].forEach(function (k) {
    const me = bag.mesh(k, M[k], k !== 'glass' && k !== 'head' && k !== 'tail'); if (me) { me.name = 'm_' + k; body.add(me); }
  });
  body.position.y = stanceOff;

  // driver (visible through glass, or in open cars)
  if (!low && !opts.noDriver) {
    const drv = buildDriver(prof.driver || defaultDriver(), { seated: true });
    const zc = sh.open ? -0.12 : (sh.gh.zf1 + sh.gh.zr1) / 2 - 0.1;
    drv.position.set(sh.W * 0.2, sh.gh.belt - 0.52, zc); drv.scale.setScalar(0.92); body.add(drv);
  }

  // wheels
  const wBag = buildWheelParts(prof.wheelStyle || 0, sh.R, 0.26, low, null);
  const wMeshes = [['rubber', M.rubber], ['rim', M.rim], ['dark', M.dark], ['chrome', M.chrome], ['disc', M.disc], ['caliper', M.caliper]].map(function (p) { return wBag.mesh(p[0], p[1], p[0] === 'rubber'); }).filter(Boolean);
  const wheels = [];
  const wx = function (z) { return fn.hwAt(z) * 0.98 - 0.12; };
  [[1, sh.wb / 2, true], [-1, sh.wb / 2, true], [1, -sh.wb / 2, false], [-1, -sh.wb / 2, false]].forEach(function (d) {
    const pivot = new THREE.Group(), flip = new THREE.Group(), spin = new THREE.Group();
    pivot.position.set(d[0] * wx(d[1]), sh.R + stanceOff * 0.4, d[1]);
    if (d[0] < 0) flip.rotation.y = Math.PI;
    wMeshes.forEach(function (m) { const c = new THREE.Mesh(m.geometry, m.material); c.castShadow = m === wMeshes[0]; spin.add(c); });
    flip.add(spin); pivot.add(flip); group.add(pivot);
    wheels.push({ pivot: pivot, spin: spin, front: d[2], dir: d[0] });
  });
  // wheel well liners
  const linerGeo = new THREE.CircleGeometry(sh.R * 1.1, 16), liner = new THREE.Mesh(linerGeo, M.dark);
  [[1, sh.wb / 2], [-1, sh.wb / 2], [1, -sh.wb / 2], [-1, -sh.wb / 2]].forEach(function (d) {
    const l = liner.clone(); l.position.set(d[0] * (wx(d[1]) - 0.2), sh.R + stanceOff, d[1]); l.rotation.y = d[0] * Math.PI / 2; body.add(l);
  });

  // underglow
  let glow = null; const ug = UNDERGLOWS[prof.underglow || 0][1];
  if (ug && !low) {
    glow = new THREE.Mesh(new THREE.PlaneGeometry(sh.W * 2.3, sh.L * 1.4), new THREE.MeshBasicMaterial({ map: glowTexture(), color: lin(ug), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.95 }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.04; group.add(glow);
  }

  group.traverse(function (o) { if (o.isMesh && opts.noShadow) o.castShadow = false; });
  const api = {
    wheels: wheels, bodyMat: M.paint, tailMat: M.tail, headMat: M.head, glow: glow, body: body,
    dims: { L: sh.L, W: sh.W, roof: sh.gh.roof, wheelR: sh.R, belt: sh.gh.belt, wb: sh.wb },
    setBrake: function (on) { M.tail.emissiveIntensity = on ? 3.6 : api.tailBase; },
    setNight: function (n) { api.tailBase = 0.9 + n * 0.9; M.head.emissiveIntensity = 0.9 + n * 3.4; },
    setSteer: function (a) { wheels.forEach(function (w) { if (w.front) w.pivot.rotation.y = a; }); },
    roll: function (d) { wheels.forEach(function (w) { w.spin.rotation.x += d * w.dir; }); },
    tailBase: 0.9
  };
  group.userData.api = api;
  return group;
}

let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.28)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c); return _glowTex;
}

/* ------------------------------ DRIVER ------------------------------ */
function stdMat(color, o) { return new THREE.MeshStandardMaterial(Object.assign({ color: lin(color), roughness: 0.6, metalness: 0.1 }, o || {})); }
function buildDriver(d, o) {
  o = o || {};
  const g = new THREE.Group();
  const skin = stdMat(SKIN_TONES[d.skin], { roughness: 0.7 }), suit = stdMat(SUIT_COLORS[d.suit], { roughness: 0.65 });
  const dark = stdMat('#15161a'), hairMat = stdMat(HAIR_COLORS[d.hairColor], { roughness: 0.8 });
  const base = o.seated ? 0.0 : 0.9;
  const cyl = function (rt, rb, h, mat, x, y, z) { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 14), mat); m.position.set(x, y, z); return m; };
  const sph = function (r, mat, x, y, z) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat); m.position.set(x, y, z); return m; };
  const bx = function (w, h, dd, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), mat); m.position.set(x, y, z); return m; };
  g.add(cyl(0.2, 0.17, 0.52, suit, 0, base + 0.26, 0));
  const sh = sph(0.2, suit, 0, base + 0.5, 0); sh.scale.set(1.15, 0.5, 0.75); g.add(sh);
  g.add(cyl(0.05, 0.055, 0.1, skin, 0, base + 0.6, 0));
  [-1, 1].forEach(function (sx) {
    const arm = cyl(0.058, 0.05, 0.5, suit, sx * 0.27, base + 0.3, o.seated ? 0.12 : 0);
    if (o.seated) { arm.rotation.x = -1.1; arm.position.set(sx * 0.27, base + 0.32, 0.17); }
    g.add(arm); g.add(sph(0.055, dark, sx * 0.27, base + (o.seated ? 0.2 : 0.02), o.seated ? 0.4 : 0));
  });
  if (!o.seated) [-1, 1].forEach(function (sx) { g.add(cyl(0.085, 0.075, 0.82, suit, sx * 0.1, 0.5, 0)); g.add(bx(0.14, 0.1, 0.28, dark, sx * 0.1, 0.05, 0.05)); });
  const hy = base + 0.77;
  g.add(sph(0.125, skin, 0, hy, 0)); g.add(sph(0.013, dark, -0.045, hy + 0.01, 0.115)); g.add(sph(0.013, dark, 0.045, hy + 0.01, 0.115));
  const helm = d.helmet, hs = d.hair;
  if (helm === 0 || helm === 3) {
    const cap = function (r, tl) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12, 0, Math.PI * 2, 0, tl), hairMat); m.position.set(0, hy + 0.005, -0.005); return m; };
    if (hs === 0) g.add(cap(0.134, Math.PI * 0.55)); if (hs === 1) g.add(cap(0.129, Math.PI * 0.4));
    if (hs === 2) { g.add(cap(0.136, Math.PI * 0.55)); g.add(bx(0.26, 0.28, 0.08, hairMat, 0, hy - 0.1, -0.09)); }
    if (hs === 3) { g.add(cap(0.134, Math.PI * 0.55)); const t = cyl(0.03, 0.02, 0.26, hairMat, 0, hy - 0.08, -0.17); t.rotation.x = 0.35; g.add(t); }
    if (hs === 4) { for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; g.add(sph(0.05, hairMat, Math.cos(a) * 0.09, hy + 0.1 + (i % 2) * 0.02, Math.sin(a) * 0.09)); } g.add(sph(0.07, hairMat, 0, hy + 0.14, 0)); }
  }
  if (helm > 0) {
    const hm = stdMat(HELMET_COLORS[d.helmetColor], { roughness: 0.25, metalness: 0.3 });
    if (helm === 1) { g.add(sph(0.17, hm, 0, hy + 0.01, -0.005)); g.add(bx(0.26, 0.09, 0.1, stdMat('#0a1118', { roughness: 0.05, metalness: 0.8 }), 0, hy + 0.02, 0.12)); }
    else if (helm === 2) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.165, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), hm); m.position.set(0, hy + 0.01, -0.005); g.add(m); }
    else { const m = new THREE.Mesh(new THREE.SphereGeometry(0.14, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hm); m.position.set(0, hy + 0.025, -0.005); g.add(m); g.add(bx(0.2, 0.015, 0.12, hm, 0, hy + 0.045, 0.14)); }
  }
  return g;
}
