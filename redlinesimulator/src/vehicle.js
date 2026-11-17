'use strict';
/* ============================================================
   VEHICLE: arcade physics on terrain + race AI
   Heading h: forward = (sin h, cos h), left = (cos h, -sin h).
   Steer input +1 = left = heading increases.
   ============================================================ */

const SIM_DT = 1 / 90;
const SURF = { city: { g: 0.72, d: 2.2 }, desert: { g: 0.66, d: 3.0 }, alpine: { g: 0.6, d: 2.6 }, sakura: { g: 0.6, d: 2.6 }, salt: { g: 0.92, d: 1.2 }, port: { g: 0.72, d: 2.2 } };
const _gr = {}, _cl = [];

class Vehicle {
  constructor(carId, mods, kind) {
    this.carId = carId; this.car = CARS[carId]; this.kind = kind || 'ai'; this.player = this.kind === 'player';
    this.mods = mods || defaultMods(); this.st = carStats(carId, this.mods);
    this.x = 0; this.z = 0; this.y = 0; this.h = 0; this.vx = 0; this.vz = 0; this.yaw = 0; this.steer = 0; this.nitro = 1;
    this.vf = 0; this.vl = 0; this.rpm = 0.2; this.gear = 0; this.slip = 0; this.onRoad = true; this.hit = 0; this.boosting = false;
    this.accelNow = 0; this.braking = false; this.water = false; this.nx = 0; this.ny = 1; this.nz = 0; this.drift = 0;
    this.s = 0; this.prog = 0; this.lap = 0; this.finished = false; this.finishT = 0; this.hint = -1; this.lane = 0; this.laneBase = 0; this.skill = 0.9; this.stuck = 0; this.rank = 1; this.name = '';
    this.mesh = null; this.api = null; this.halfL = 2.2; this.halfW = 0.95; this.dist = 0;
    this.tilt = { rx: 0, rz: 0 };
  }
  setPose(x, z, h) { this.x = x; this.z = z; this.h = h; this.vx = this.vz = 0; this.yaw = 0; this.steer = 0; this.vf = 0; this.vl = 0; this.hint = -1; this.hit = 0; }

  step(dt, inp, W) {
    const st = this.st, g = W.ground(this.x, this.z, _gr), sf = SURF[W.map.theme] || SURF.city;
    this.nx = g.nx; this.ny = g.ny; this.nz = g.nz; this.y = g.y; this.water = g.water;
    const off = g.surf !== 0, gScale = off ? sf.g : 1; this.onRoad = !off;
    let fx = Math.sin(this.h), fz = Math.cos(this.h), lx = Math.cos(this.h), lz = -Math.sin(this.h);
    let vf = this.vx * fx + this.vz * fz, vl = this.vx * lx + this.vz * lz; const av = Math.abs(vf);

    const maxSteer = 0.6 / (1 + Math.pow(av / 18, 1.5)), target = inp.steer * maxSteer * st.steer;
    this.steer += (target - this.steer) * Math.min(1, dt * 10);

    let a = 0;
    const wantBoost = inp.nitro && this.nitro > 0.02 && inp.throttle > 0 && vf > -1;
    this.boosting = wantBoost;
    if (wantBoost) this.nitro = Math.max(0, this.nitro - dt * 0.26 / st.tank); else this.nitro = Math.min(1, this.nitro + dt * 0.05);
    const topNow = st.top * (wantBoost ? 1.16 : 1);
    if (inp.throttle > 0) {
      if (vf < -0.5) a += st.brake * inp.throttle;
      else {
        const f = clamp(1 - Math.pow(Math.max(vf, 0) / topNow, 2.4), 0, 1);
        const drive = st.accel * inp.throttle * f * (wantBoost ? 1.7 : 1), traction = (st.grip + 3) * gScale * (inp.hand ? 0.35 : 1);
        a += Math.min(drive, traction);
      }
    }
    this.braking = false;
    if (inp.brake > 0) {
      if (vf > 0.6) { a -= st.brake * inp.brake * gScale; this.braking = true; }
      else if (vf > -14) a -= st.accel * 0.45 * inp.brake;
    }
    a += 9.81 * (g.nx * fx + g.nz * fz) / Math.max(g.ny, 0.5) * 0.9; // slope
    const sgn = vf > 0 ? 1 : (vf < 0 ? -1 : 0);
    let drag = 0.9 + 0.0012 * vf * vf;
    if (inp.throttle === 0) drag += 1.2;
    if (off) drag += sf.d; if (inp.hand) drag += 3.2;
    if (this.water) drag += 14;
    const vfBefore = vf; vf += a * dt - sgn * drag * dt;
    if (inp.throttle === 0 && inp.brake === 0 && vfBefore * vf < 0) vf = 0;
    this.accelNow = (vf - vfBefore) / dt;

    const aLat = st.grip * 1.15 * gScale * (inp.hand ? 0.85 : 1);
    let yawT = av > 0.4 ? (vf / 2.7) * Math.tan(this.steer) : 0;
    const yawMax = aLat / Math.max(av, 5); yawT = clamp(yawT, -yawMax, yawMax);
    if (inp.hand && av > 6) yawT *= 1.4;
    this.yaw += (yawT - this.yaw) * Math.min(1, dt * (inp.hand ? 5 : 12));
    const oldVx = fx * vf + lx * vl, oldVz = fz * vf + lz * vl;
    this.h += this.yaw * dt;
    fx = Math.sin(this.h); fz = Math.cos(this.h); lx = Math.cos(this.h); lz = -Math.sin(this.h);
    vf = oldVx * fx + oldVz * fz; vl = oldVx * lx + oldVz * lz;

    const av2 = Math.abs(vf), slipRatio = av2 > 3 ? Math.abs(vl) / av2 : 0;
    let gr = st.grip * gScale * 1.3;
    if (inp.hand) gr *= 0.16; else if (slipRatio > 0.45) gr *= 0.55;
    const removed = vl * (1 - Math.exp(-gr * dt)); vl -= removed; vf -= (vf > 0 ? 1 : -1) * Math.abs(removed) * 0.14;
    this.slip = clamp((Math.abs(vl) - 1.4) / 6, 0, 1) + (inp.hand && av2 > 8 ? 0.55 : 0) + (off && av2 > 10 ? 0.25 : 0);
    this.drift = av2 > 9 ? Math.atan2(Math.abs(vl), av2) : 0;
    this.vl = vl;
    this.vx = fx * vf + lx * vl; this.vz = fz * vf + lz * vl;
    this.x += this.vx * dt; this.z += this.vz * dt; this.vf = vf;
    this.dist += Math.hypot(this.vx, this.vz) * dt;

    // static collisions (3 circles along the car)
    this.hit = 0; this.collide(W);

    const frac = clamp(Math.abs(this.vf) / st.top, 0, 1.2), gears = 6, gg = Math.min(gears, 1 + Math.floor(frac * gears * 0.999));
    const inGear = clamp(frac * gears - (gg - 1), 0, 1);
    let rpmT = 0.26 + 0.74 * inGear + (gg === 1 ? 0 : 0.06); if (Math.abs(this.vf) < 1.5) rpmT = 0.22 + 0.5 * inp.throttle;
    this.rpm += (clamp(rpmT, 0.15, 1) - this.rpm) * Math.min(1, dt * 9);
    this.gear = this.vf < -0.6 ? -1 : (Math.abs(this.vf) < 0.4 ? 0 : gg);
  }

  collide(W) {
    const sh = Math.sin(this.h), ch = Math.cos(this.h), R = this.halfW, off = [-(this.halfL - R), 0, this.halfL - R];
    for (let pass = 0; pass < 2; pass++) for (let k = 0; k < 3; k++) {
      const cx = this.x + sh * off[k], cz = this.z + ch * off[k], list = W.colsAt(cx, cz, _cl);
      for (let i = 0; i < list.length; i++) {
        const c = list[i]; let nx, nz, pen;
        if (c.c) { const dx = cx - c.x, dz = cz - c.z, d = Math.hypot(dx, dz) || 0.001, rr = c.hx + R; if (d >= rr) continue; nx = dx / d; nz = dz / d; pen = rr - d; }
        else {
          const px = clamp(cx, c.x - c.hx, c.x + c.hx), pz = clamp(cz, c.z - c.hz, c.z + c.hz), dx = cx - px, dz = cz - pz, d2 = dx * dx + dz * dz;
          if (d2 > 0.000001) { const d = Math.sqrt(d2); if (d >= R) continue; nx = dx / d; nz = dz / d; pen = R - d; }
          else { const ex = c.hx - Math.abs(cx - c.x), ez = c.hz - Math.abs(cz - c.z); if (ex < ez) { nx = cx > c.x ? 1 : -1; nz = 0; pen = ex + R; } else { nx = 0; nz = cz > c.z ? 1 : -1; pen = ez + R; } }
        }
        pen = Math.min(pen, 1.5); this.x += nx * pen; this.z += nz * pen;
        const vn = this.vx * nx + this.vz * nz;
        if (vn < 0) {
          this.vx -= 1.25 * vn * nx; this.vz -= 1.25 * vn * nz; this.hit = Math.max(this.hit, -vn);
          const rx = sh * off[k], rz = ch * off[k], tq = rx * nz * -vn - rz * nx * -vn; this.yaw += clamp(-tq * 0.03, -0.5, 0.5);
          const s = Math.max(0, 1 - 0.8 * (-vn / 20)); this.vx *= s; this.vz *= s;
        }
      }
    }
  }

  // visual pose. dt in seconds of frame time; alpha for interpolation is handled by caller via prevX etc.
  applyMesh(dt, x, z, h) {
    const m = this.mesh; if (!m) return;
    const fx = Math.sin(h), fz = Math.cos(h), lx = Math.cos(h), lz = -Math.sin(h), ny = Math.max(this.ny, 0.3);
    const tr = this.tilt, trx = -Math.atan(-(this.nx * fx + this.nz * fz) / ny), trz = Math.atan(-(this.nx * lx + this.nz * lz) / ny), k = Math.min(1, dt * 9);
    tr.rx += (trx - tr.rx) * k; tr.rz += (trz - tr.rz) * k;
    m.rotation.order = 'YXZ'; m.rotation.set(tr.rx, h, tr.rz); m.position.set(x, this.y, z);
    const api = this.api;
    if (api) {
      api.roll(this.vf * dt / (api.dims.wheelR || 0.33)); api.setSteer(this.steer); api.setBrake(this.braking);
      api.body.rotation.x += (clamp(-this.accelNow * 0.0022, -0.045, 0.045) - api.body.rotation.x) * k;
      api.body.rotation.z += (clamp(this.yaw * this.vf * 0.0026, -0.06, 0.06) - api.body.rotation.z) * k;
    }
  }
}

/* ------------------------------ race AI ------------------------------ */
const _rq = {}, _pt = {}, _la = {};
function aiInputs(v, route, others, dt, raceT) {
  const n = route.n, av = Math.abs(v.vf), st = v.st;
  route.nearest(v.x, v.z, v.hint, _rq); v.hint = _rq.i; v.s = _rq.s;
  let avoid = 0;
  for (let i = 0; i < others.length; i++) {
    const o = others[i]; if (o === v || !o.mesh) continue;
    const dx = o.x - v.x, dz = o.z - v.z, fx = Math.sin(v.h), fz = Math.cos(v.h), ahead = dx * fx + dz * fz, side = dx * Math.cos(v.h) - dz * Math.sin(v.h);
    if (ahead > 0 && ahead < 16 && Math.abs(side) < 2.6 && o.vf < v.vf + 4) avoid = side > 0 ? -3.4 : 3.4;
  }
  const maxLane = 3.6, laneT = clamp(v.laneBase + avoid, -maxLane, maxLane); v.lane += (laneT - v.lane) * Math.min(1, dt * 1.6);
  const look = clamp(9 + av * 0.55, 10, 60); route.at(_rq.s + look, _pt);
  const tx = _pt.x + _pt.tz * v.lane, tz = _pt.z - _pt.tx * v.lane;
  const err = wrapPi(Math.atan2(tx - v.x, tz - v.z) - v.h), steer = clamp(err * 2.2, -1, 1);
  const aLatSafe = st.grip * 0.92, bAI = st.brake * 0.55; let vt = st.top * v.skill;
  for (let j = 0; j < 46; j++) {
    let k = _rq.i + j; if (route.closed) k %= n; else if (k >= n) break;
    const kap = Math.max(route.k[k], 0.0006), vc = Math.sqrt(aLatSafe / kap) * (0.92 + v.skill * 0.08), allow = Math.sqrt(vc * vc + 2 * bAI * j * 6);
    if (allow < vt) vt = allow;
  }
  let th = 0, br = 0;
  if (v.vf < vt - 0.5) th = clamp((vt - v.vf) / 5 + 0.25, 0, 1); else if (v.vf > vt + 1.5) br = clamp((v.vf - vt) / 6, 0, 1);
  if (Math.abs(err) > 0.55 && av > 12) th = Math.min(th, 0.35);
  const nitro = vt >= st.top * v.skill * 0.97 && Math.abs(err) < 0.08 && v.nitro > 0.6 && raceT > 4000;
  return { steer: steer, throttle: th, brake: br, hand: false, nitro: nitro };
}
