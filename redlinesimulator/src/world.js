'use strict';
/* ============================================================
   WORLD: road network, routes, props, colliders, events, minimap
   buildWorld(mapIndex, quality) -> W
   ============================================================ */

/* ---------- small helpers ---------- */
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  return lerp(lerp(hash2(ix, iz), hash2(ix + 1, iz), sx), lerp(hash2(ix, iz + 1), hash2(ix + 1, iz + 1), sx), sz);
}
const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _e4 = new THREE.Euler(), _p3 = new THREE.Vector3(), _s3 = new THREE.Vector3();
function mat4(x, y, z, sx, sy, sz, ry) {
  _e4.set(0, ry || 0, 0); _q4.setFromEuler(_e4); _p3.set(x, y, z); _s3.set(sx, sy, sz); return new THREE.Matrix4().compose(_p3, _q4, _s3);
}
function cg(g, hex, m) { return { g: g, m: m || new THREE.Matrix4(), c: lin(hex) }; }
function mergeC(items) {
  const geo = mergeGeos(items.map(function (i) { return { g: i.g, m: i.m }; }));
  const col = new Float32Array(geo.attributes.position.count * 3); let o = 0;
  items.forEach(function (i) { const n = i.g.attributes.position.count; for (let k = 0; k < n; k++) { col[(o + k) * 3] = i.c.r; col[(o + k) * 3 + 1] = i.c.g; col[(o + k) * 3 + 2] = i.c.b; } o += n; i.g.dispose(); });
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); return geo;
}
function resample(pts, step, closed) {
  const src = closed ? pts.concat([pts[0]]) : pts, out = [src[0]];
  let carry = 0;
  for (let i = 1; i < src.length; i++) {
    const a = src[i - 1], b = src[i], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
    let d = step - carry;
    while (d <= L) { out.push({ x: a.x + dx * d / L, z: a.z + dz * d / L }); d += step; }
    carry = L - (d - step);
  }
  if (closed) { const l = out[out.length - 1], f = out[0]; if (Math.hypot(l.x - f.x, l.z - f.z) < step * 0.5) out.pop(); }
  else { const l = out[out.length - 1], b = src[src.length - 1]; if (Math.hypot(l.x - b.x, l.z - b.z) > 1) out.push({ x: b.x, z: b.z }); }
  return out;
}

/* ---------- Route: polyline with arc length, tangents and curvature ---------- */
class Route {
  constructor(pts, closed, step) {
    this.closed = !!closed; this.p = resample(pts, step || 6, this.closed); const n = this.n = this.p.length;
    this.cum = new Float32Array(n + 1); this.tx = new Float32Array(n); this.tz = new Float32Array(n); this.k = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.p[i], b = this.p[this.closed ? (i + 1) % n : Math.min(i + 1, n - 1)], d = Math.hypot(b.x - a.x, b.z - a.z);
      this.cum[i + 1] = this.cum[i] + (i === n - 1 && !this.closed ? 0 : d);
      this.tx[i] = d > 0.01 ? (b.x - a.x) / d : (i ? this.tx[i - 1] : 1); this.tz[i] = d > 0.01 ? (b.z - a.z) / d : (i ? this.tz[i - 1] : 0);
    }
    this.len = this.cum[n];
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) { const j = this.closed ? (i + 1) % n : Math.min(i + 1, n - 1); raw[i] = Math.abs(wrapPi(Math.atan2(this.tx[j], this.tz[j]) - Math.atan2(this.tx[i], this.tz[i]))) / (step || 6); }
    for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let d = -4; d <= 4; d++) { let j = i + d; if (this.closed) j = (j + n) % n; else if (j < 0 || j >= n) continue; s += raw[j]; c++; } this.k[i] = s / c; }
  }
  nearest(x, z, hint, out) {
    const n = this.n, p = this.p; let best = 1e18, bi = 0;
    const test = (i) => { const dx = p[i].x - x, dz = p[i].z - z, d = dx * dx + dz * dz; if (d < best) { best = d; bi = i; } };
    if (hint >= 0) { for (let d = -30; d <= 30; d++) { let i = hint + d; if (this.closed) i = (i % n + n) % n; else if (i < 0 || i >= n) continue; test(i); } if (best > 90 * 90) { best = 1e18; for (let i = 0; i < n; i++) test(i); } }
    else for (let i = 0; i < n; i++) test(i);
    const o = out || {}; o.i = bi; o.d = Math.sqrt(best);
    const a = p[bi], tx = this.tx[bi], tz = this.tz[bi], t = clamp((x - a.x) * tx + (z - a.z) * tz, -6, 6);
    o.s = this.cum[bi] + t; o.side = (x - a.x) * -tz + (z - a.z) * tx; // +side = left of travel direction (x,z plane, left is -z·tx.. see note)
    return o;
  }
  at(s, out) {
    const o = out || {}; let L = this.len;
    if (this.closed) s = ((s % L) + L) % L; else s = clamp(s, 0, L);
    let lo = 0, hi = this.n; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    const i = lo, nx = this.closed ? (i + 1) % this.n : Math.min(i + 1, this.n - 1), seg = this.cum[i + 1] - this.cum[i] || 1, f = clamp((s - this.cum[i]) / seg, 0, 1);
    o.x = lerp(this.p[i].x, this.p[nx].x, f); o.z = lerp(this.p[i].z, this.p[nx].z, f); o.tx = this.tx[i]; o.tz = this.tz[i]; o.i = i; o.k = this.k[i]; return o;
  }
  reversed() { return new Route(this.p.slice().reverse(), this.closed, 6); }
}

/* ---------- RoadNet: all roads, spatial hash ---------- */
class RoadNet {
  constructor() { this.roads = []; this.cell = 64; this.h = new Map(); }
  add(pts, w, kind, closed, lift) {
    const r = { id: this.roads.length, w: w, kind: kind, closed: !!closed, lift: lift, route: new Route(pts, closed, 10) };
    this.roads.push(r); return r;
  }
  index() {
    const C = this.cell; this.h.clear();
    this.roads.forEach((r) => {
      const p = r.route.p, n = p.length, m = r.closed ? n : n - 1;
      for (let i = 0; i < m; i++) {
        const a = p[i], b = p[(i + 1) % n], seg = { x0: a.x, z0: a.z, x1: b.x, z1: b.z, r: r, i: i };
        const x0 = Math.floor(Math.min(a.x, b.x) / C), x1 = Math.floor(Math.max(a.x, b.x) / C), z0 = Math.floor(Math.min(a.z, b.z) / C), z1 = Math.floor(Math.max(a.z, b.z) / C);
        for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) { const k = (cx + 512) * 1024 + (cz + 512); let l = this.h.get(k); if (!l) this.h.set(k, l = []); l.push(seg); }
      }
    });
  }
  query(x, z, out) {
    const C = this.cell, cx = Math.floor(x / C), cz = Math.floor(z / C), o = out || {}; let best = 1e18, bs = null, bt = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = this.h.get((cx + i + 512) * 1024 + (cz + j + 512)); if (!l) continue;
      for (let k = 0; k < l.length; k++) {
        const s = l[k], dx = s.x1 - s.x0, dz = s.z1 - s.z0, L2 = dx * dx + dz * dz || 1;
        const t = clamp(((x - s.x0) * dx + (z - s.z0) * dz) / L2, 0, 1), px = s.x0 + dx * t - x, pz = s.z0 + dz * t - z, d = px * px + pz * pz;
        if (d < best) { best = d; bs = s; bt = t; }
      }
    }
    if (!bs) { o.d = 1e9; o.road = null; return o; }
    o.d = Math.sqrt(best); o.road = bs.r; o.seg = bs.i; o.t = bt;
    o.px = bs.x0 + (bs.x1 - bs.x0) * bt; o.pz = bs.z0 + (bs.z1 - bs.z0) * bt; return o;
  }
}

/* ---------- theme setup ---------- */
const THEMES = {
  city: { wig: 0.55, links: 5, grid: 160, chords: 0, spokes: 0, wiggle: [0, 300], wl: -3.4 },
  desert: { wig: 1.0, links: 4, grid: 0, chords: 2, spokes: 3, wiggle: [26, 700], wl: null },
  alpine: { wig: 1.35, links: 6, grid: 0, chords: 0, spokes: 3, wiggle: [48, 250], wl: null },
  sakura: { wig: 1.1, links: 5, grid: 0, chords: 0, spokes: 4, wiggle: [36, 300], wl: -12 },
  salt: { wig: 0.35, links: 4, grid: 0, chords: 3, spokes: 4, wiggle: [0, 300], wl: null },
  port: { wig: 0.6, links: 5, grid: 220, chords: 0, spokes: 0, wiggle: [10, 400], wl: -3.0 }
};

function ringFn(R, wig, rnd) {
  const ks = [2, 3, 5, 7, 9], am = [0.06, 0.05, 0.025, 0.015, 0.01], ph = ks.map(function () { return rnd() * 6.283; });
  return function (t) { let s = 0; for (let i = 0; i < 5; i++) s += am[i] * wig * Math.sin(ks[i] * t + ph[i]); return R * (1 + s); };
}
function ringPts(fn, step) {
  const n = Math.ceil(6.283 * fn(0) / step), pts = [];
  for (let i = 0; i < n; i++) { const t = i / n * 6.283185, r = fn(t); pts.push({ x: Math.cos(t) * r, z: Math.sin(t) * r }); }
  return pts;
}
function wigglePath(a, b, A, lam, ph) {
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz), n = Math.max(2, Math.ceil(L / 12)), nx = -dz / L, nz = dx / L, pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, off = A * Math.sin(t * L / lam * 6.283 + ph) * Math.sin(Math.PI * t);
    pts.push({ x: a.x + dx * t + nx * off, z: a.z + dz * t + nz * off });
  }
  return pts;
}

function generateRoads(map) {
  const th = THEMES[map.theme], rnd = mulberry32(map.seed * 977 + 5), net = new RoadNet(), F = {};
  const fo = ringFn(map.R, th.wig, rnd), fi = ringFn(map.Rin, th.wig * 0.8, rnd);
  F.fo = fo; F.fi = fi;
  F.outer = net.add(ringPts(fo, 12), 14, 'ring', true, 0.20);
  F.inner = net.add(ringPts(fi, 12), 14, 'ring', true, 0.22);
  F.links = [];
  const nl = th.links, t0 = rnd() * 6.283;
  for (let i = 0; i < nl; i++) {
    const ti = t0 + i / nl * 6.283 + (rnd() - 0.5) * 0.25, to = ti + (rnd() - 0.5) * 0.35;
    const a = { x: Math.cos(ti) * fi(ti), z: Math.sin(ti) * fi(ti) }, b = { x: Math.cos(to) * fo(to), z: Math.sin(to) * fo(to) };
    F.links.push(net.add(wigglePath(a, b, th.wiggle[0], th.wiggle[1], rnd() * 6.283), 11, 'link', false, 0.26 + i * 0.004));
  }
  for (let i = 0; i < th.chords; i++) {
    const ta = i / th.chords * 3.1416 + rnd() * 0.4, tb = ta + 3.1416 + (rnd() - 0.5) * 0.5;
    const a = { x: Math.cos(ta) * fo(ta), z: Math.sin(ta) * fo(ta) }, b = { x: Math.cos(tb) * fo(tb), z: Math.sin(tb) * fo(tb) };
    net.add(wigglePath(a, b, th.wiggle[0] * 0.5, th.wiggle[1] * 1.5, rnd() * 6.283), 12, 'chord', false, 0.34 + i * 0.004);
  }
  for (let i = 0; i < th.spokes; i++) {
    const t = i / th.spokes * 6.283 + rnd() * 0.5, r = fi(t);
    net.add(wigglePath({ x: 0, z: 0 }, { x: Math.cos(t) * r, z: Math.sin(t) * r }, th.wiggle[0] * 0.4, 260, rnd() * 6.283), 10, 'spoke', false, 0.30 + i * 0.004);
  }
  if (th.grid) {
    const g = th.grid, cnt = Math.floor(map.Rin * 0.85 / g);
    for (let k = -cnt; k <= cnt; k++) {
      [0, 1].forEach(function (dir) {
        const line = k * g, pts = [];
        // march outwards both ways until the inner ring is reached
        const hit = function (sign) {
          let u = 0; const out = [];
          while (u < 1800) { u += 10; const x = dir ? line : sign * u, z = dir ? sign * u : line, r = Math.hypot(x, z), t = Math.atan2(z, x); out.push({ x: x, z: z }); if (r >= fi(t < 0 ? t + 6.283185 : t) - 2) break; }
          return out;
        };
        const a = hit(-1).reverse(), b = hit(1);
        if (a.length + b.length < 6) return;
        net.add(a.concat(b), 12, dir ? 'gridV' : 'gridH', false, dir ? 0.12 : 0.16);
      });
    }
  }
  net.index(); F.net = net;
  return F;
}

/* ---------- road mesh ---------- */
function roadTexture(map) {
  // 256x512 asphalt: seeded grain, wear tracks, patches and cracks so the road reads as a surface, not a flat colour.
  return canvasTex(256, 512, function (c, w, h) {
    const rnd = mulberry32(map.seed * 17 + 3);
    c.fillStyle = map.road; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { c.fillStyle = 'rgba(' + (rnd() < 0.5 ? '255,255,255' : '0,0,0') + ',' + (0.02 + rnd() * 0.06).toFixed(3) + ')'; c.fillRect(rnd() * w, rnd() * h, 1, 1 + rnd() * 2); }
    for (let i = 0; i < 260; i++) { c.fillStyle = 'rgba(' + (rnd() < 0.6 ? '0,0,0' : '255,255,255') + ',' + (0.04 + rnd() * 0.06).toFixed(3) + ')'; const r = 1 + rnd() * 3; c.beginPath(); c.arc(rnd() * w, rnd() * h, r, 0, 6.283); c.fill(); }
    // tyre wear: darker, polished bands where cars drive
    [0.3, 0.7].forEach(function (x0) {
      const g = c.createLinearGradient(w * (x0 - 0.12), 0, w * (x0 + 0.12), 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.13)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(w * (x0 - 0.12), 0, w * 0.24, h);
    });
    // patched repairs and oil stains
    for (let i = 0; i < 14; i++) { c.fillStyle = 'rgba(' + (rnd() < 0.5 ? '40,40,46' : '120,118,112') + ',' + (0.12 + rnd() * 0.12).toFixed(3) + ')'; const pw = w * (0.08 + rnd() * 0.22), ph = h * (0.03 + rnd() * 0.08); c.fillRect(rnd() * (w - pw), rnd() * (h - ph), pw, ph); }
    // hairline cracks
    c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = 0.8;
    for (let i = 0; i < 12; i++) { let x = rnd() * w, y = rnd() * h; c.beginPath(); c.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 22; y += 6 + rnd() * 14; c.lineTo(x, y); } c.stroke(); }
    const sg = c.createLinearGradient(0, 0, w, 0); sg.addColorStop(0, 'rgba(60,55,45,0.55)'); sg.addColorStop(0.1, 'rgba(60,55,45,0)'); sg.addColorStop(0.9, 'rgba(60,55,45,0)'); sg.addColorStop(1, 'rgba(60,55,45,0.55)');
    c.fillStyle = sg; c.fillRect(0, 0, w, h);
    c.fillStyle = map.line; c.fillRect(w * 0.135, 0, w * 0.018, h); c.fillRect(w * 0.847, 0, w * 0.018, h);
    c.fillRect(w * 0.492, 0, w * 0.016, h * 0.42);
  }, null, true);
}

function buildRoadMesh(W) {
  const roads = W.net.roads, pos = [], uv = [], idx = [], wl = W.waterY, hasW = wl > -1e8;
  roads.forEach(function (r) {
    const rt = r.route, n = rt.n, m = r.closed ? n + 1 : n, base = pos.length / 3, hw = r.w / 2, sh = 1.6;
    for (let i = 0; i < m; i++) {
      const j = i % n, p = rt.p[j], tx = rt.tx[j], tz = rt.tz[j], nx = -tz, nz = tx, s = (r.closed && i === n) ? rt.len : rt.cum[j];
      const offs = [-hw - sh, -hw, hw, hw + sh], us = [0, 0.1, 0.9, 1];
      for (let c = 0; c < 4; c++) {
        const x = p.x + nx * offs[c], z = p.z + nz * offs[c];
        let y = terrH(x, z); if (hasW) y = Math.max(y, wl + 0.55);
        y += r.lift - ((c === 0 || c === 3) ? 0.1 : 0);
        pos.push(x, y, z); uv.push(us[c], s / 12);
      }
    }
    for (let i = 0; i < m - 1; i++) for (let c = 0; c < 3; c++) { const a = base + i * 4 + c, b = a + 4; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  const nr = g.attributes.normal; for (let i = 0; i < nr.count; i++) nr.setXYZ(i, 0, 1, 0);
  const mat = new THREE.MeshStandardMaterial({ map: roadTexture(W.map), roughness: 0.86, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.name = 'roads';
  return mesh;
}

/* ---------- prop kits ---------- */
function makeKits(map) {
  const K = {}, B = THREE.BoxGeometry, C = THREE.CylinderGeometry, Co = THREE.ConeGeometry, I = THREE.IcosahedronGeometry;
  K.pine = mergeC([
    cg(new C(0.22, 0.34, 2.6, 6), '#4a3626', mat4(0, 1.3, 0, 1, 1, 1)),
    cg(new Co(2.7, 4.4, 8), '#1f4a2c', mat4(0, 4.2, 0, 1, 1, 1)), cg(new Co(2.1, 3.8, 8), '#245533', mat4(0, 6.4, 0, 1, 1, 1)), cg(new Co(1.4, 3.2, 8), '#2b6139', mat4(0, 8.6, 0, 1, 1, 1))]);
  K.oak = mergeC([cg(new C(0.28, 0.4, 3, 6), '#4d3b2a', mat4(0, 1.5, 0, 1, 1, 1)), cg(new I(2.6, 1), '#3f7a3c', mat4(0, 4.6, 0, 1, 0.9, 1)), cg(new I(1.8, 1), '#4b8a44', mat4(1.2, 3.8, 0.7, 1, 1, 1))]);
  K.blossom = mergeC([cg(new C(0.25, 0.38, 3, 6), '#4a3228', mat4(0, 1.5, 0, 1, 1, 1)), cg(new I(2.5, 1), '#f3a9c6', mat4(0, 4.6, 0, 1, 0.85, 1)), cg(new I(1.8, 1), '#f9c9da', mat4(1.4, 3.9, 0.5, 1, 1, 1)), cg(new I(1.6, 1), '#ea92b3', mat4(-1.2, 4.2, -0.8, 1, 1, 1))]);
  K.rock = mergeC([cg(new I(1, 1), '#8a8479', mat4(0, 0.4, 0, 1.2, 0.8, 1))]);
  K.cactus = mergeC([cg(new C(0.35, 0.4, 4, 7), '#4f7f46', mat4(0, 2, 0, 1, 1, 1)), cg(new C(0.22, 0.22, 1.6, 6), '#4f7f46', mat4(0.9, 2.4, 0, 1, 1, 1)), cg(new C(0.22, 0.22, 1.2, 6), '#4f7f46', mat4(0.9, 3.0, 0, 1, 0.8, 1)), cg(new C(0.22, 0.22, 1.2, 6), '#4f7f46', mat4(-0.8, 2.6, 0, 1, 1, 1))]);
  K.mesa = mergeC([cg(new C(0.85, 1, 1, 10), '#b5703f', mat4(0, 0.5, 0, 1, 1, 1)), cg(new C(0.88, 0.85, 0.12, 10), '#cc8a52', mat4(0, 1.0, 0, 1, 1, 1))]);
  K.house = mergeC([cg(new B(1, 1, 1), '#e8e2d6', mat4(0, 0.5, 0, 1, 1, 1)), cg(new Co(0.78, 0.5, 4), '#8c4a3a', mat4(0, 1.25, 0, 1, 1, 1, Math.PI / 4))]);
  K.container = mergeC([cg(new B(1, 1, 1), '#ffffff', mat4(0, 0.5, 0, 1, 1, 1))]);
  K.tank = mergeC([cg(new C(1, 1, 1, 18), '#d9dde2', mat4(0, 0.5, 0, 1, 1, 1)), cg(new C(0.96, 0.96, 0.06, 18), '#9aa1a8', mat4(0, 1.02, 0, 1, 1, 1))]);
  K.crane = mergeC([
    cg(new B(2, 52, 2), '#e0a21a', mat4(-14, 26, -9, 1, 1, 1)), cg(new B(2, 52, 2), '#e0a21a', mat4(-14, 26, 9, 1, 1, 1)), cg(new B(2, 52, 2), '#e0a21a', mat4(14, 26, -9, 1, 1, 1)), cg(new B(2, 52, 2), '#e0a21a', mat4(14, 26, 9, 1, 1, 1)),
    cg(new B(34, 3, 22), '#e0a21a', mat4(0, 52, 0, 1, 1, 1)), cg(new B(4, 4, 90), '#d28f12', mat4(0, 56, 34, 1, 1, 1)), cg(new B(30, 1.2, 1.2), '#cfd3d8', mat4(0, 20, -9, 1, 1, 1))]);
  K.turbine = mergeC([cg(new C(0.9, 1.6, 70, 8), '#eceff2', mat4(0, 35, 0, 1, 1, 1)), cg(new B(2.4, 2.4, 6), '#dfe3e8', mat4(0, 71, 0, 1, 1, 1)),
    cg(new B(1.2, 38, 0.5), '#f4f6f8', mat4(0, 90, 2.6, 1, 1, 1)), cg(new B(33, 1.2, 0.5), '#f4f6f8', mat4(-16, 66, 2.6, 1, 1, 1)), cg(new B(33, 1.2, 0.5), '#f4f6f8', mat4(16, 66, 2.6, 1, 1, 1))]);
  K.torii = mergeC([cg(new C(0.45, 0.55, 9, 8), '#c8321f', mat4(-7.2, 4.5, 0, 1, 1, 1)), cg(new C(0.45, 0.55, 9, 8), '#c8321f', mat4(7.2, 4.5, 0, 1, 1, 1)),
    cg(new B(18.5, 0.9, 1.1), '#c8321f', mat4(0, 8.8, 0, 1, 1, 1)), cg(new B(16, 0.7, 0.8), '#1d1a1a', mat4(0, 7.2, 0, 1, 1, 1)), cg(new B(20, 0.5, 1.5), '#161313', mat4(0, 9.5, 0, 1, 1, 1))]);
  K.lamp = mergeC([cg(new C(0.12, 0.18, 8.5, 6), '#3a3e46', mat4(0, 4.25, 0, 1, 1, 1)), cg(new B(0.2, 0.2, 2.2), '#3a3e46', mat4(0, 8.4, 1.0, 1, 1, 1))]);
  K.lampHead = mergeC([cg(new B(0.5, 0.16, 0.9), '#ffffff', mat4(0, 8.25, 1.9, 1, 1, 1))]);
  K.box = mergeC([cg(new B(1, 1, 1), '#ffffff', mat4(0, 0.5, 0, 1, 1, 1))]);
  return K;
}

function propMat(kind) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.0 });
  if (kind === 'building') {
    m.roughness = 0.7; m.metalness = 0.1;
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uNight = NIGHT;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBP; varying vec3 vBN; varying float vSeed;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\n vBP = position * vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)); vSeed = instanceMatrix[3].x * 0.137 + instanceMatrix[3].z * 0.291;\n#else\n vBP = position; vSeed = 0.0;\n#endif\n vBN = normal;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vBP; varying vec3 vBN; varying float vSeed; uniform float uNight; float bh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }')
        .replace('#include <color_fragment>', '#include <color_fragment>\n float bwin = 0.0; float blit = 0.0; vec3 ban = abs(vBN);\n if (ban.y < 0.5) { float u = ban.x > ban.z ? vBP.z : vBP.x; vec2 g = vec2(u/3.4, vBP.y/3.8); vec2 id = floor(g); vec2 f = fract(g); bwin = step(0.2,f.x)*step(f.x,0.8)*step(0.24,f.y)*step(f.y,0.76)*step(3.0, vBP.y); blit = step(0.5, bh(id + vSeed)) * bwin; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.15,0.21,0.29) * (0.9 + 0.2*bh(vec2(floor(vBP.y/3.8), vSeed))), bwin * 0.8); }\n diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(0.0, 6.0, vBP.y)) * (0.93 + 0.14 * bh(vec2(floor(vBP.y / 3.8), vSeed + 7.0)));')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(1.0,0.7,0.38) * blit * uNight * 1.15;');
    };
  }
  return m;
}

/* ---------- water ---------- */
function makeWater(map, y) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000), new THREE.MeshStandardMaterial({ color: lin(map.theme === 'sakura' ? '#2f7f9a' : '#1d4a6a'), roughness: 0.14, metalness: 0.25, transparent: true, opacity: 0.88 }));
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.frustumCulled = false; m.renderOrder = 1; return m;
}

/* ---------- events ---------- */
function buildEvents(W) {
  const map = W.map, F = W.F, ev = [], diff = map.difficulty, rewardOf = function (len, laps) { return Math.round(len * laps / 1000 * 900 * (0.8 + 0.12 * diff) / 50) * 50; };
  const startOf = function (route, s) { const o = route.at(s); return { x: o.x, z: o.z, h: Math.atan2(o.tx, o.tz) }; };
  const mk = function (e) { const st = startOf(e.route, e.s0 || 0); e.x = st.x; e.z = st.z; e.h = st.h; e.map = map.id; e.id = map.id + ':' + e.id; ev.push(e); };
  mk({ id: 'c-in', type: 'circuit', name: map.theme === 'city' ? 'Downtown Circuit' : 'Inner Ring Circuit', route: F.inner.route, laps: 2, s0: F.inner.route.len * 0.25, rivals: 5, diff: 0.55 + diff * 0.05, reward: rewardOf(F.inner.route.len, 2) });
  mk({ id: 'c-out', type: 'circuit', name: 'Grand Loop', route: F.outer.route, laps: 1, s0: F.outer.route.len * 0.6, rivals: 5, diff: 0.62 + diff * 0.05, reward: rewardOf(F.outer.route.len, 1) });
  F.links.forEach(function (l, i) {
    const rt = l.route, nm = ['Ridge', 'Skyline', 'Harbor', 'Summit', 'Canyon', 'Overpass', 'Back Road', 'Crown'][i % 8];
    mk({ id: 's' + i, type: 'sprint', name: nm + ' Sprint', route: rt, s0: 24, laps: 1, rivals: 3, diff: 0.5 + i * 0.04 + diff * 0.04, reward: rewardOf(rt.len, 1) });
    const rv = rt.reversed();
    mk({ id: 'a' + i, type: 'attack', name: nm + ' Time Attack', route: rv, s0: 24, laps: 1, rivals: 0, diff: 0, reward: Math.round(rv.len / 1000 * 1100 * (0.8 + 0.12 * diff) / 50) * 50, par: [rv.len / 40, rv.len / 32, rv.len / 26] });
  });
  // speed traps: straight stretches, spread out
  const rnd = mulberry32(map.seed * 31 + 7), traps = [], cand = [W.F.outer].concat(W.net.roads.filter(function (r) { return r.kind === 'chord' || r.kind === 'link'; }));
  for (let tries = 0; tries < 400 && traps.length < 8; tries++) {
    const r = cand[Math.floor(rnd() * cand.length)], rt = r.route, i = Math.floor(rnd() * rt.n);
    let kmax = 0; for (let d = -12; d <= 12; d++) { const j = r.closed ? (i + d + rt.n) % rt.n : clamp(i + d, 0, rt.n - 1); kmax = Math.max(kmax, rt.k[j]); }
    if (kmax > 0.0012 || (!r.closed && (i < 40 || i > rt.n - 40))) continue;
    const p = rt.p[i]; if (traps.some(function (t) { return Math.hypot(t.x - p.x, t.z - p.z) < 500; })) continue;
    traps.push({ id: map.id + ':t' + traps.length, x: p.x, z: p.z, tx: rt.tx[i], tz: rt.tz[i], need: Math.round((150 + diff * 14 + rnd() * 40) / 10) * 10, reward: Math.round((500 + diff * 160 + rnd() * 300) / 50) * 50 });
  }
  return { events: ev, traps: traps };
}

function trapGantry(t) {
  const items = [], ang = Math.atan2(t.tx, t.tz), cs = Math.cos(ang), sn = Math.sin(ang), w = 12;
  const at = function (lx, ly, sx, sy, sz, hex) { return cg(new THREE.BoxGeometry(1, 1, 1), hex, mat4(0, 0, 0, 1, 1, 1).premultiply(new THREE.Matrix4().makeTranslation(lx, ly, 0)).multiply(new THREE.Matrix4().makeScale(sx, sy, sz))); };
  items.push(at(-w, 3.5, 0.5, 7, 0.5, '#2b2f38'), at(w, 3.5, 0.5, 7, 0.5, '#2b2f38'), at(0, 7.2, 2 * w + 1, 1.5, 0.7, '#1b1e25'), at(0, 7.2, 2 * w - 2, 1.1, 0.8, '#ffb13b'));
  const geo = mergeC(items);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3, emissive: lin('#ff9a1f'), emissiveIntensity: 0.0 }));
  m.rotation.y = ang; m.position.set(t.x, terrH(t.x, t.z) + 0.2, t.z); return m;
}

/* ---------- minimap bake ---------- */
function bakeMap(W, S) {
  const map = W.map, ext = 3000, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d'), G = 160, img = c.createImageData(G, G), P = map.pal, A = new THREE.Color(P.gA), B = new THREE.Color(P.gB), R = new THREE.Color(P.rock);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = (i / (G - 1) * 2 - 1) * ext, z = (j / (G - 1) * 2 - 1) * ext, h = terrH(x, z), hx = terrH(x + 30, z) - terrH(x - 30, z), sh = clamp(0.5 + hx * 0.012 * (TERR.A > 15 ? 0.5 : 1.5), 0.25, 0.85);
    let col; if (h < W.waterY) col = [30, 70, 100]; else { const t = clamp(h / Math.max(40, TERR.A * 1.6), 0, 1), cc = A.clone().lerp(R, t * 0.9).lerp(B, 0.2); col = [cc.r * 255, cc.g * 255, cc.b * 255]; }
    const k = (j * G + i) * 4, d = Math.hypot(x, z), edge = 1 - smoothstep(2600, 3000, d);
    img.data[k] = col[0] * sh * 1.25 * edge; img.data[k + 1] = col[1] * sh * 1.25 * edge; img.data[k + 2] = col[2] * sh * 1.25 * edge; img.data[k + 3] = 255;
  }
  const tmp = document.createElement('canvas'); tmp.width = tmp.height = G; tmp.getContext('2d').putImageData(img, 0, 0);
  c.fillStyle = '#0b0e13'; c.fillRect(0, 0, S, S); c.imageSmoothingEnabled = true; c.drawImage(tmp, 0, 0, S, S);
  const k = S / (ext * 2), tx = function (v) { return (v + ext) * k; };
  W.net.roads.forEach(function (r) {
    const p = r.route.p; c.beginPath(); c.moveTo(tx(p[0].x), tx(p[0].z)); for (let i = 1; i < p.length; i++) c.lineTo(tx(p[i].x), tx(p[i].z)); if (r.closed) c.closePath();
    c.lineJoin = 'round'; c.strokeStyle = 'rgba(0,0,0,0.65)'; c.lineWidth = r.w * k * 1.9 + 1.5; c.stroke();
    c.strokeStyle = r.kind === 'ring' ? '#e9edf5' : '#b8c0cf'; c.lineWidth = r.w * k * 1.2 + 0.5; c.stroke();
  });
  W.mapScale = k; W.mapExt = ext; return cv;
}

/* ---------- main builder ---------- */
function buildWorld(mapIdx, quality) {
  const map = MAPS[mapIdx], th = THEMES[map.theme], q = quality || 2; terrSetup(map);
  const W = { map: map, idx: mapIdx, th: th, quality: q, scene: new THREE.Scene(), chunks: [], cols: new Map(), colCell: 48, lampHeads: null, night: 0, exposure: 1, envScale: 1, time: 0, markers: [], disposables: [] };
  W.waterY = th.wl === null ? -1e9 : th.wl;
  const F = generateRoads(map); W.F = F; W.net = F.net;
  const sc = W.scene; sc.fog = new THREE.FogExp2(0xaabbcc, map.fog);
  W.sky = makeSky(); sc.add(W.sky);
  W.hemi = new THREE.HemisphereLight(0xffffff, 0x555555, 0.8); sc.add(W.hemi);
  W.sun = new THREE.DirectionalLight(0xffffff, 2); W.sun.castShadow = q >= 1;
  const sm = q >= 2 ? 2048 : 1024; W.sun.shadow.mapSize.set(sm, sm);
  const sh = W.sun.shadow.camera; sh.left = sh.bottom = -60; sh.right = sh.top = 60; sh.near = 10; sh.far = 500; W.sun.shadow.bias = -0.0004; W.sun.shadow.normalBias = 0.5;
  sc.add(W.sun); sc.add(W.sun.target);
  W.moon = new THREE.DirectionalLight(0x8fa6ff, 0.4); W.moon.position.set(-200, 300, 100); sc.add(W.moon);
  W.terrain = makeTerrain(map); sc.add(W.terrain);
  W.roadMesh = buildRoadMesh(W); sc.add(W.roadMesh);
  if (th.wl !== null) { W.water = makeWater(map, th.wl); sc.add(W.water); }

  /* colliders */
  const addCol = function (x, z, hx, hz, circ) {
    const C = W.colCell, col = { x: x, z: z, hx: hx, hz: hz, c: !!circ };
    const x0 = Math.floor((x - hx) / C), x1 = Math.floor((x + hx) / C), z0 = Math.floor((z - hz) / C), z1 = Math.floor((z + hz) / C);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const k = (i + 512) * 1024 + (j + 512); let l = W.cols.get(k); if (!l) W.cols.set(k, l = []); l.push(col); }
  };
  W.colsAt = function (x, z, out) {
    const C = W.colCell, i = Math.floor(x / C), j = Math.floor(z / C); out.length = 0;
    const l = W.cols.get((i + 512) * 1024 + (j + 512)); if (l) for (let k = 0; k < l.length; k++) out.push(l[k]); return out;
  };

  /* instancing store: per chunk, per kind */
  const CH = 400, store = new Map(), kits = makeKits(map), mats = {}, rndG = mulberry32(map.seed * 4421 + 3);
  const matFor = function (kind) { return mats[kind] || (mats[kind] = propMat(kind === 'building' ? 'building' : 'std')); };
  const put = function (kind, x, y, z, sx, sy, sz, ry, col) {
    const cx = Math.floor(x / CH), cz = Math.floor(z / CH), key = cx * 4096 + cz;
    let ch = store.get(key); if (!ch) store.set(key, ch = { cx: cx, cz: cz, kinds: {} });
    (ch.kinds[kind] || (ch.kinds[kind] = [])).push({ m: mat4(x, y, z, sx, sy, sz, ry), c: col });
  };
  const white = new THREE.Color(1, 1, 1), tint = function (base, v) { const k = 1 + (rndG() - 0.5) * v; return new THREE.Color(base.r * k, base.g * k, base.b * k); };
  const roadClear = function (x, z, extra) { const o = W._rq || (W._rq = {}); W.net.query(x, z, o); return o.d - (o.road ? o.road.w / 2 : 0) > extra; };
  const slopeAt = function (x, z) { const e = 3; const hx = terrH(x + e, z) - terrH(x - e, z), hz = terrH(x, z + e) - terrH(x, z - e); return Math.hypot(hx, hz) / (2 * e); };

  const scatter = function (kind, geoKey, o) {
    const rr = mulberry32(map.seed * 17 + kind.length * 131 + (o.salt || 0)), maxR = o.maxD || 3200, att = Math.round(o.att * (q >= 2 ? 1 : q === 1 ? 0.65 : 0.4));
    const n = Math.ceil(maxR / CH);
    for (let cx = -n; cx < n; cx++) for (let cz = -n; cz < n; cz++) {
      if (Math.hypot((cx + 0.5) * CH, (cz + 0.5) * CH) > maxR + 280) continue;
      for (let a = 0; a < att; a++) {
        const x = (cx + rr()) * CH, z = (cz + rr()) * CH, d = Math.hypot(x, z); if (d < (o.minD || 0) || d > maxR) continue;
        if (o.noise && vnoise(x * o.noise[0], z * o.noise[0]) < o.noise[1] + rr() * 0.12) continue;
        const h = terrH(x, z); if (h < W.waterY + 0.8) continue;
        if (o.maxH !== undefined && h > o.maxH) continue;
        if (slopeAt(x, z) > (o.slope || 0.5)) continue;
        const s = lerp(o.s[0], o.s[1], rr()), sy = s * lerp(o.sy ? o.sy[0] : 1, o.sy ? o.sy[1] : 1, rr());
        if (!roadClear(x, z, (o.clear === undefined ? 5 : o.clear) + (o.collide || 0.5) * s)) continue;
        if (o.test && !o.test(x, z, d)) continue;
        put(geoKey, x, h - (o.sink || 0.15), z, o.sx ? s * lerp(o.sx[0], o.sx[1], rr()) : s, sy, o.sz ? s * lerp(o.sz[0], o.sz[1], rr()) : s, rr() * 6.283, tint(o.col || white, o.tintV === undefined ? 0.3 : o.tintV));
        if (o.col2) { /* unused */ }
        if (o.collide) addCol(x, z, o.collide * s, o.collide * s, true);
      }
    }
  };
  const inCity = function (x, z) { const t = Math.atan2(z, x); return Math.hypot(x, z) < F.fi(t < 0 ? t + 6.283185 : t) + 40; };
  const ringIn = function (t) { return F.fi(t < 0 ? t + 6.283185 : t); };

  const sandy = map.theme === 'desert', theme = map.theme;
  if (theme === 'alpine') {
    scatter('pine', 'pine', { att: 640, noise: [0.0035, 0.38], s: [0.9, 2.0], sy: [0.9, 1.4], collide: 0.45, clear: 6, slope: 0.62, maxH: 62, minD: 80, salt: 1 });
    scatter('rock', 'rock', { att: 60, s: [1.5, 6], sy: [0.7, 1.5], col: new THREE.Color(0.5, 0.5, 0.55), clear: 7, slope: 1.2, sink: 0.4, collide: 0.8, salt: 2 });
    scatter('house', 'house', { att: 1, s: [6, 8], sy: [0.8, 1.1], collide: 0.55, clear: 14, minD: 120, maxD: 1900, slope: 0.12, salt: 3, tintV: 0.5 });
  } else if (theme === 'sakura') {
    scatter('blossom', 'blossom', { att: 320, noise: [0.004, 0.42], s: [0.9, 1.7], collide: 0.45, clear: 6, slope: 0.5, minD: 300, salt: 1, tintV: 0.2 });
    scatter('oak', 'oak', { att: 280, noise: [0.0045, 0.35], s: [0.9, 1.8], collide: 0.5, clear: 6, slope: 0.55, salt: 2, tintV: 0.35 });
    scatter('rock', 'rock', { att: 20, s: [1.2, 4], sy: [0.6, 1.2], col: new THREE.Color(0.55, 0.52, 0.5), clear: 7, slope: 1, sink: 0.3, collide: 0.8, salt: 3 });
    scatter('house', 'house', { att: 14, s: [7, 10], sy: [0.7, 1.0], collide: 0.55, clear: 14, maxD: 330, slope: 0.1, salt: 4, tintV: 0.5, sink: 0.1 });
  } else if (theme === 'desert') {
    scatter('rock', 'rock', { att: 55, s: [1.5, 8], sy: [0.6, 1.4], col: new THREE.Color(0.8, 0.55, 0.4), clear: 8, slope: 1, sink: 0.4, collide: 0.85, salt: 1 });
    scatter('cactus', 'cactus', { att: 120, noise: [0.006, 0.45], s: [0.9, 2.2], collide: 0.5, clear: 6, salt: 2, tintV: 0.3 });
    scatter('mesa', 'mesa', { att: 3, s: [30, 75], sy: [0.5, 1.3], col: new THREE.Color(1, 0.85, 0.7), minD: 1300, maxD: 3000, clear: 70, slope: 0.4, collide: 0.8, sink: 2, salt: 3 });
  } else if (theme === 'salt') {
    scatter('rock', 'rock', { att: 9, s: [2, 9], sy: [0.6, 1.2], col: new THREE.Color(0.8, 0.75, 0.7), clear: 12, slope: 1, sink: 0.5, collide: 0.85, salt: 1 });
    scatter('turbine', 'turbine', { att: 1, s: [0.9, 1.1], minD: 1100, maxD: 2600, clear: 60, slope: 0.3, sink: 0.2, collide: 1.4, salt: 2, tintV: 0.05 });
  } else if (theme === 'city') {
    scatter('oak', 'oak', { att: 140, noise: [0.005, 0.4], s: [0.8, 1.5], collide: 0.5, clear: 6, minD: 300, salt: 1 });
    scatter('house', 'house', { att: 60, s: [8, 13], sy: [0.7, 1.3], collide: 0.55, clear: 14, minD: 740, maxD: 1500, slope: 0.1, salt: 2, tintV: 0.5, sink: 0.05, test: function (x, z) { return !inCity(x, z); } });
    scatter('pine', 'pine', { att: 80, noise: [0.004, 0.4], s: [0.8, 1.3], collide: 0.45, clear: 6, minD: 1500, salt: 3 });
  } else if (theme === 'port') {
    scatter('oak', 'oak', { att: 40, noise: [0.005, 0.5], s: [0.7, 1.2], collide: 0.5, clear: 6, minD: 800, salt: 1 });
    scatter('rock', 'rock', { att: 30, s: [1.5, 6], sy: [0.6, 1.2], col: new THREE.Color(0.5, 0.5, 0.52), clear: 8, slope: 1, sink: 0.4, collide: 0.8, minD: 1000, salt: 2 });
    scatter('tank', 'tank', { att: 2, s: [14, 22], sy: [0.8, 1.6], collide: 0.5, clear: 24, minD: 1500, maxD: 2000, slope: 0.1, sink: 0.1, salt: 3, tintV: 0.2 });
    scatter('crane', 'crane', { att: 1, s: [1, 1.2], minD: 800, maxD: 1500, clear: 40, slope: 0.1, sink: 0.1, salt: 4, tintV: 0.2 });
  }
  scatter('tree', 'oak', { att: 0, s: [1, 1] });

  /* city buildings */
  if (theme === 'city') {
    const g = th.grid, cnt = Math.floor(map.Rin * 0.85 / g), rb = mulberry32(map.seed * 555 + 9), pal = ['#9aa3b2', '#7f8896', '#b1b7c2', '#6f7a8c', '#a69d92', '#8e95a1', '#5f6b7e'].map(function (h) { return lin(h); });
    for (let i = -cnt - 1; i <= cnt; i++) for (let j = -cnt - 1; j <= cnt; j++) {
      const cx = (i + 0.5) * g, cz = (j + 0.5) * g, rr = Math.hypot(cx, cz), t = Math.atan2(cz, cx);
      if (Math.hypot(Math.abs(cx) + g / 2, Math.abs(cz) + g / 2) > ringIn(t) - 6) continue;
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
        if (rb() < 0.08) continue;
        const lw = g / 2 - 9, lx = cx + (a - 0.5) * (g / 2), lz = cz + (b - 0.5) * (g / 2), w = lw * (0.78 + rb() * 0.2), dd = lw * (0.78 + rb() * 0.2);
        const hh = 14 + rb() * 22 + 95 * Math.exp(-Math.pow(rr / 300, 2)) * (0.3 + rb() * 0.9) + (rb() < 0.15 ? 40 : 0);
        put('building', lx, z0(lx, lz), lz, w, hh, dd, 0, pal[Math.floor(rb() * pal.length)]);
        addCol(lx, lz, w / 2, dd / 2, false);
      }
    }
    function z0() { return 0; }
  }
  /* port yards */
  if (theme === 'port') {
    const g = th.grid, cnt = Math.floor(map.Rin * 0.85 / g), rb = mulberry32(map.seed * 321 + 4), cols = ['#c0392b', '#2e6fb5', '#e0a21a', '#2f9a62', '#8e5ab0', '#d9d9d9', '#e0703a', '#3b4a5c'].map(function (h) { return lin(h); });
    for (let i = -cnt - 1; i <= cnt; i++) for (let j = -cnt - 1; j <= cnt; j++) {
      const cx = (i + 0.5) * g, cz = (j + 0.5) * g, t = Math.atan2(cz, cx);
      if (Math.hypot(Math.abs(cx) + g / 2, Math.abs(cz) + g / 2) > ringIn(t) - 6) continue;
      const kind = rb();
      if (kind < 0.2) { // warehouse
        const w = g * 0.6, d = g * 0.5; put('building', cx, 0, cz, w, 11 + rb() * 5, d, 0, lin('#8d96a2')); addCol(cx, cz, w / 2, d / 2, false); continue;
      }
      const half = g / 2 - 10;
      for (let rx = -half + 6; rx < half - 6; rx += 15) for (let rz = -half + 3; rz < half - 3; rz += 4.2) {
        if (rb() < 0.34) continue;
        const lv = rb() < 0.6 ? 1 : (rb() < 0.6 ? 2 : 3), col = cols[Math.floor(rb() * cols.length)];
        for (let L = 0; L < lv; L++) put('container', cx + rx, L * 2.7, cz + rz, 12, 2.6, 2.4, 0, col);
        addCol(cx + rx, cz + rz, 6, 1.2, false);
      }
    }
  }

  /* torii gates over roads (sakura) */
  if (theme === 'sakura') {
    const rb = mulberry32(map.seed + 99), cand = W.net.roads.filter(function (r) { return r.kind === 'link' || r.kind === 'spoke'; });
    for (let i = 0; i < 7; i++) {
      const r = cand[i % cand.length], rt = r.route, k = 8 + Math.floor(rb() * (rt.n - 16)), p = rt.p[k];
      put('torii', p.x, terrH(p.x, p.z) + 0.2, p.z, 1, 1, 1, Math.atan2(rt.tx[k], rt.tz[k]) + Math.PI / 2 * 0, white);
      // pillars sit at the road edges, drive through
      W.markers.push({ torii: true });
    }
  }

  /* street lamps */
  if (theme === 'city' || theme === 'port') {
    W.net.roads.forEach(function (r) {
      if (r.kind !== 'gridH' && r.kind !== 'gridV' && r.kind !== 'ring') return;
      const rt = r.route; let s = 20, side = 1;
      while (s < rt.len) {
        const o = rt.at(s), px = o.x + -o.tz * side * (r.w / 2 + 2.6), pz = o.z + o.tx * side * (r.w / 2 + 2.6);
        if (roadClear(px, pz, 0.6)) {
          const ry = Math.atan2(-o.tz * side, o.tx * side) * 0 + Math.atan2(-(-o.tz * side), -(o.tx * side)) + Math.PI * 0;
          put('lamp', px, terrH(px, pz) + 0.05, pz, 1, 1, 1, Math.atan2(-o.tz * side * -1, -o.tx * side * -1) * 0 + Math.atan2(o.tz * side, -o.tx * side) * 0 + Math.atan2(-o.tx * side, -o.tz * side) + Math.PI, white);
          put('lampHead', px, terrH(px, pz) + 0.05, pz, 1, 1, 1, Math.atan2(-o.tx * side, -o.tz * side) + Math.PI, white);
          addCol(px, pz, 0.3, 0.3, true);
        }
        s += 48; side = -side;
      }
    });
  }

  /* realize instanced meshes per chunk */
  store.forEach(function (ch) {
    const grp = new THREE.Group(); grp.userData.cx = (ch.cx + 0.5) * CH; grp.userData.cz = (ch.cz + 0.5) * CH;
    Object.keys(ch.kinds).forEach(function (kind) {
      const list = ch.kinds[kind], geoKey = kind === 'building' ? 'box' : kind, g = kits[geoKey] || kits.box;
      const mat = kind === 'lampHead' ? (W.lampMat || (W.lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.5), vertexColors: false, fog: true }))) : matFor(kind === 'building' ? 'building' : 'std');
      const im = new THREE.InstancedMesh(g, mat, list.length); im.frustumCulled = false;
      list.forEach(function (it, i) { im.setMatrixAt(i, it.m); im.setColorAt(i, it.c); });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      grp.add(im);
    });
    grp.visible = false; W.chunks.push(grp); sc.add(grp);
  });
  W.kits = kits; W.propMats = mats;
  W.envMats = [W.terrain.material, W.roadMesh.material].concat(W.water ? [W.water.material] : [], Object.keys(mats).map(function (k) { return mats[k]; }));

  /* events and markers */
  const E = buildEvents(W); W.events = E.events; W.traps = E.traps;
  W.traps.forEach(function (t) { t.mesh = trapGantry(t); sc.add(t.mesh); });
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, uniforms: { uCol: { value: new THREE.Color(1, 0.7, 0.2) }, uT: { value: 0 }, uCam: { value: new THREE.Vector3() } },
    vertexShader: 'varying float vY; varying vec3 vW; void main(){ vY = position.y; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'uniform vec3 uCol; uniform float uT; uniform vec3 uCam; varying float vY; varying vec3 vW; void main(){ float a = (1.0 - vY/70.0) * (0.4 + 0.2*sin(vY*0.25 - uT*3.0)); a *= smoothstep(30.0, 90.0, distance(vW, uCam)); gl_FragColor = vec4(uCol * a, a); }'
  });
  W.beamMat = beamMat;
  const beamGeo = new THREE.CylinderGeometry(2.4, 2.4, 70, 16, 1, true); beamGeo.translate(0, 35, 0);
  W.events.forEach(function (e) {
    const m = new THREE.Mesh(beamGeo, beamMat); m.position.set(e.x, terrH(e.x, e.z), e.z); m.visible = false; m.frustumCulled = false; sc.add(m); e.marker = m;
  });
  W.beamGeo = beamGeo;

  /* spawn */
  if (th.grid) { W.spawn = { x: 0, z: 0, h: Math.PI / 2 }; }
  else { const rt = F.inner.route, o = rt.at(0); W.spawn = { x: o.x, z: o.z, h: Math.atan2(o.tx, o.tz) }; }
  W.mapCanvas = bakeMap(W, 640);

  /* queries */
  const rq = {}, nrm = { x: 0, y: 1, z: 0 };
  W.onRoad = function (x, z) { W.net.query(x, z, rq); return rq.road && rq.d < rq.road.w / 2 + 1.0 ? rq.road : null; };
  W.ground = function (x, z, out) {
    let y = terrH(x, z); W.net.query(x, z, rq); let surf = 1, lift = 0;
    if (rq.road) {
      const hw = rq.road.w / 2;
      if (rq.d < hw + 1.6) { if (W.waterY > -1e8) y = Math.max(y, W.waterY + 0.55); lift = rq.road.lift * (1 - smoothstep(hw, hw + 1.6, rq.d)); if (rq.d < hw + 0.4) surf = 0; }
    }
    out.y = y + lift; out.surf = surf; out.road = surf === 0 ? rq.road : null; terrNormal(x, z, nrm); out.nx = nrm.x; out.ny = nrm.y; out.nz = nrm.z; out.water = y < W.waterY - 0.2 && surf !== 0; return out;
  };
  W.heightAt = function (x, z) { const o = W._ho || (W._ho = {}); return W.ground(x, z, o).y; };

  /* per-frame */
  let vt = 0;
  W.update = function (px, pz, dt, camPos) {
    W.time += dt; W.terrain.userData.update(px, pz);
    if (camPos) W.sky.position.copy(camPos);
    W.sun.position.set(px + W.sunDir.x * 250, W.heightAt(px, pz) + W.sunDir.y * 250, pz + W.sunDir.z * 250); W.sun.target.position.set(px, 0, pz); W.sun.target.updateMatrixWorld();
    if (W.water) W.water.position.set(px, W.waterY, pz);
    beamMat.uniforms.uT.value = W.time; if (camPos) beamMat.uniforms.uCam.value.copy(camPos);
    if (W.lampMat) W.lampMat.color.setRGB(1, 0.85, 0.5).multiplyScalar(0.08 + 3.2 * NIGHT.value);
    vt -= dt; if (vt <= 0) {
      vt = 0.25; const vd = (q >= 2 ? 1250 : q === 1 ? 1000 : 750) + 280;
      for (let i = 0; i < W.chunks.length; i++) { const g = W.chunks[i]; g.visible = Math.hypot(g.userData.cx - px, g.userData.cz - pz) < vd; }
      W.events.forEach(function (e) { e.marker.visible = Math.hypot(e.x - px, e.z - pz) < 1600; });
    }
  };
  W.dispose = function () {
    disposeTree(sc); W.terrain.userData.dispose(); Object.keys(mats).forEach(function (k) { mats[k].dispose(); });
    if (W.mapCanvas) W.mapCanvas = null;
  };
  W.sunDir = new THREE.Vector3(0.5, 0.8, 0.3).normalize();
  return W;
}
