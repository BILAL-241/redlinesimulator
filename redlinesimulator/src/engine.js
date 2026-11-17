'use strict';
/* ============================================================
   ENGINE: renderer + post, input, audio, particles, showroom/garage view
   ============================================================ */

const GL = { renderer: null, canvas: null, camera: null, q: 2, autoQ: 2, ready: false, fpsAcc: 0, fpsN: 0, goodSecs: 0, lastQ: 0, onRebuild: null, lost: false, exposure: 1, blur: 0, vig: 0.35, w: 1, h: 1, pr: 1 };

function showFatal(msg) {
  const el = document.getElementById('fatal');
  if (el) { el.querySelector('p').textContent = msg; el.hidden = false; }
}
function qualityLevel() {
  if (settings.quality === 'low') return 0;
  if (settings.quality === 'medium') return 1;
  if (settings.quality === 'high') return 2;
  return GL.autoQ;
}
function sizeGL() {
  const w = Math.max(2, window.innerWidth), h = Math.max(2, window.innerHeight), q = GL.q, dpr = window.devicePixelRatio || 1;
  GL.pr = q === 0 ? 1 : Math.min(dpr, q === 1 ? 1.25 : 1.75);
  GL.w = w; GL.h = h;
  GL.renderer.setPixelRatio(GL.pr); GL.renderer.setSize(w, h, false);
  if (Post.on) Post.resize(w, h, GL.pr);
  if (GL.camera) { GL.camera.aspect = w / h; GL.camera.updateProjectionMatrix(); }
}
function setPostMode(on) {
  const r = GL.renderer;
  if (on) { r.toneMapping = THREE.NoToneMapping; r.outputEncoding = THREE.LinearEncoding; }
  else { r.toneMapping = THREE.ACESFilmicToneMapping; r.outputEncoding = THREE.sRGBEncoding; Post.dispose(); }
}
function applyQuality(scene) {
  if (!GL.renderer) return;
  const q = qualityLevel(), was = GL.q; GL.q = q;
  GL.renderer.shadowMap.enabled = q > 0;
  const usePost = q >= 1;
  if (usePost && !Post.on) { setPostMode(true); if (!Post.init(GL.renderer, new THREE.Scene(), GL.camera, GL.w, GL.h, GL.pr, q)) setPostMode(false); }
  else if (!usePost && Post.on) setPostMode(false);
  if (Post.on && Post.bloom) { Post.bloom.strength = q >= 2 ? 0.6 : 0.45; if (was !== q) Post.init(GL.renderer, new THREE.Scene(), GL.camera, GL.w, GL.h, GL.pr, q); }
  sizeGL();
  if (GL.onQuality) GL.onQuality(q);
}
function initGL() {
  GL.canvas = document.getElementById('gl');
  try { GL.renderer = new THREE.WebGLRenderer({ canvas: GL.canvas, antialias: true, powerPreference: 'high-performance' }); }
  catch (e) { showFatal('Your browser could not start 3D graphics. Enable hardware acceleration or try another browser.'); return false; }
  const r = GL.renderer;
  r.shadowMap.type = THREE.PCFSoftShadowMap; r.toneMappingExposure = 1.0;
  GL.autoQ = (window.innerWidth < 760 || /Mobi|Android/i.test(navigator.userAgent)) ? 1 : 2;
  GL.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.35, 7000);
  GL.w = window.innerWidth; GL.h = window.innerHeight;
  window.addEventListener('resize', sizeGL);
  GL.canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); GL.lost = true; });
  GL.canvas.addEventListener('webglcontextrestored', function () { GL.lost = false; if (GL.onRebuild) GL.onRebuild(); });
  GL.ready = true; applyQuality();
  return true;
}
function glRender(scene, camera, exposure) {
  const r = GL.renderer;
  if (Post.on && Post.composer) {
    Post.setCamera(scene, camera); Post.fin.uniforms.uExp.value = exposure; Post.fin.uniforms.uBlur.value = GL.blur; Post.fin.uniforms.uVig.value = GL.vig;
    Post.composer.render();
  } else { r.toneMappingExposure = exposure; r.render(scene, camera); }
}
function autoQualityTick(dt) {
  if (settings.quality !== 'auto') return;
  GL.fpsAcc += dt; GL.fpsN++;
  if (GL.fpsAcc < 2.5) return;
  const fps = GL.fpsN / GL.fpsAcc; GL.fpsAcc = 0; GL.fpsN = 0;
  if (fps < 34 && GL.autoQ > 0) { GL.autoQ--; GL.goodSecs = -40; applyQuality(); }
  else if (fps > 56) { GL.goodSecs += 2.5; if (GL.goodSecs > 18 && GL.autoQ < 2 && GL.lastQ !== GL.autoQ + 1) { GL.lastQ = GL.autoQ; GL.autoQ++; GL.goodSecs = 0; applyQuality(); } }
}

/* ---------------- environment map (PMREM from a gradient sphere + softboxes) ---------------- */
function makeEnvTexture(renderer, topHex, botHex, boost) {
  const sc = new THREE.Scene(), geo = new THREE.SphereGeometry(50, 32, 18);
  const top = lin(topHex), bot = lin(botHex), pos = geo.attributes.position, cols = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { const h = clamp(pos.getY(i) / 50 * 0.5 + 0.5, 0, 1); c.copy(bot).lerp(top, Math.pow(h, 0.8)); cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  sc.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const light = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(boost || 4) });
  [[0, 30, 10, 30, 3], [-34, 12, -6, 3, 16], [34, 10, 8, 3, 14], [0, 8, -40, 36, 4]].forEach(function (p) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(p[3], p[4], 1), light); m.position.set(p[0], p[1], p[2]); m.lookAt(0, 0, 0); sc.add(m);
  });
  const pm = new THREE.PMREMGenerator(renderer), rt = pm.fromScene(sc, 0.03); pm.dispose();
  sc.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return rt.texture;
}
// Outdoor environment: bright sky above, warm ground below, a sun softbox
function makeWorldEnv(renderer) {
  const sc = new THREE.Scene(), geo = new THREE.SphereGeometry(50, 32, 18);
  const top = lin('#6fa4e0'), hor = lin('#dfe9f4'), bot = lin('#4a4f58'), pos = geo.attributes.position, cols = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 50; if (y > 0) c.copy(hor).lerp(top, Math.pow(y, 0.6)); else c.copy(hor).lerp(bot, Math.min(1, -y * 3)); cols[i * 3] = c.r * 1.2; cols[i * 3 + 1] = c.g * 1.2; cols[i * 3 + 2] = c.b * 1.2; }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  sc.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sun = new THREE.Mesh(new THREE.BoxGeometry(14, 14, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.85).multiplyScalar(9) })); sun.position.set(30, 30, 18); sun.lookAt(0, 0, 0); sc.add(sun);
  const soft = new THREE.Mesh(new THREE.BoxGeometry(40, 6, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(2.2) })); soft.position.set(-25, 18, -20); soft.lookAt(0, 0, 0); sc.add(soft);
  const pm = new THREE.PMREMGenerator(renderer), rt = pm.fromScene(sc, 0.02); pm.dispose();
  sc.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return rt.texture;
}

/* ------------------------------ INPUT ------------------------------ */
const Input = {
  keys: {}, touch: { left: false, right: false, gas: false, brake: false, rev: false, hand: false, nitro: false },
  steer: 0, throttle: 0, brake: 0, hand: false, nitro: false, usingTouch: false, pressed: {},
  init: function () {
    const self = this;
    window.addEventListener('keydown', function (e) {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.code !== 'Escape') return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].indexOf(e.code) >= 0) e.preventDefault();
      if (!self.keys[e.code]) self.pressed[e.code] = true;
      self.keys[e.code] = true;
    });
    window.addEventListener('keyup', function (e) { self.keys[e.code] = false; });
    window.addEventListener('blur', function () { self.keys = {}; const t = self.touch; t.left = t.right = t.gas = t.brake = t.rev = t.hand = t.nitro = false; });
  },
  was: function (code) { const v = !!this.pressed[code]; this.pressed[code] = false; return v; },
  clearPressed: function () { this.pressed = {}; },
  poll: function (dt) {
    const k = this.keys, t = this.touch;
    let left = k.KeyA || k.ArrowLeft || t.left, right = k.KeyD || k.ArrowRight || t.right;
    let th = (k.KeyW || k.ArrowUp || t.gas) ? 1 : 0, br = (k.KeyS || k.ArrowDown || t.brake || t.rev) ? 1 : 0;
    let hand = !!(k.Space || t.hand), nitro = !!(k.ShiftLeft || k.ShiftRight || t.nitro);
    let target = (left ? 1 : 0) - (right ? 1 : 0);
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i]; if (!p || !p.connected) continue;
        const ax = p.axes[0] || 0; if (Math.abs(ax) > 0.12) target = -ax;
        const rt = p.buttons[7] ? p.buttons[7].value : 0, lt = p.buttons[6] ? p.buttons[6].value : 0;
        if (rt > 0.05) th = Math.max(th, rt); if (lt > 0.05) br = Math.max(br, lt);
        if (p.buttons[0] && p.buttons[0].pressed) hand = true; if (p.buttons[2] && p.buttons[2].pressed) nitro = true;
        break;
      }
    } catch (e) { /* ignore */ }
    const rate = Math.abs(target) > 0.01 ? 7 : 11;
    this.steer += (target - this.steer) * Math.min(1, dt * rate);
    this.throttle = th; this.brake = br; this.hand = hand; this.nitro = nitro;
  }
};

/* ------------------------------ AUDIO ------------------------------ */
const Sound = {
  ctx: null, ok: false,
  init: function () {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.gain.value = settings.sound ? 0.3 : 0; this.master.connect(c.destination);
      this.filter = c.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 400; this.filter.Q.value = 0.3; this.filter.connect(this.master);
      this.o1 = c.createOscillator(); this.o1.type = 'triangle'; this.o2 = c.createOscillator(); this.o2.type = 'sine';
      this.g1 = c.createGain(); this.g1.gain.value = 0; this.g2 = c.createGain(); this.g2.gain.value = 0;
      this.o1.connect(this.g1); this.o2.connect(this.g2); this.g1.connect(this.filter); this.g2.connect(this.filter); this.o1.start(); this.o2.start();
      const buf = c.createBuffer(1, c.sampleRate, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noise = c.createBufferSource(); this.noise.buffer = buf; this.noise.loop = true;
      this.nf = c.createBiquadFilter(); this.nf.type = 'bandpass'; this.nf.frequency.value = 700; this.nf.Q.value = 0.6;
      this.ng = c.createGain(); this.ng.gain.value = 0; this.noise.connect(this.nf); this.nf.connect(this.ng); this.ng.connect(this.master); this.noise.start();
      this.ok = true;
    } catch (e) { this.ok = false; }
  },
  setMuted: function (m) { if (this.ok) this.master.gain.setTargetAtTime(m ? 0 : 0.3, this.ctx.currentTime, 0.05); },
  update: function (rpm, throttle, slip, boost, active) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, f = 42 + rpm * 85;
    this.o1.frequency.setTargetAtTime(f, t, 0.04); this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
    const vol = active ? (0.03 + throttle * 0.035 + rpm * 0.02) : 0.0;
    this.g1.gain.setTargetAtTime(vol, t, 0.05); this.g2.gain.setTargetAtTime(vol * 0.8, t, 0.05);
    this.filter.frequency.setTargetAtTime(260 + rpm * 700 + throttle * 300 + (boost ? 250 : 0), t, 0.05);
    this.ng.gain.setTargetAtTime(active ? clamp(slip, 0, 1) * 0.06 : 0, t, 0.05);
  },
  silence: function () { if (this.ok) { const t = this.ctx.currentTime; this.g1.gain.setTargetAtTime(0, t, 0.05); this.g2.gain.setTargetAtTime(0, t, 0.05); this.ng.gain.setTargetAtTime(0, t, 0.05); } },
  tone: function (f, type, vol, dur, f2) {
    if (!this.ok) return;
    try {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f; if (f2) o.frequency.linearRampToValueAtTime(f2, c.currentTime + dur);
      g.gain.value = vol; g.gain.setTargetAtTime(0, c.currentTime + dur * 0.5, dur * 0.3); o.connect(g); g.connect(this.master); o.start(); o.stop(c.currentTime + dur * 2);
    } catch (e) { /* ignore */ }
  },
  thump: function (v) { this.tone(70, 'sine', clamp(v, 0.05, 0.5), 0.18); },
  beep: function (hi) { this.tone(hi ? 880 : 560, 'sine', 0.08, 0.2); },
  cash: function () { this.tone(880, 'triangle', 0.12, 0.12); setTimeout(() => this.tone(1320, 'triangle', 0.12, 0.2), 90); },
  win: function () { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 'triangle', 0.14, 0.25), i * 110)); }
};

/* ---------------------------- PARTICLES ---------------------------- */
function softTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
class Particles {
  constructor(max, additive, tex) {
    this.max = max; this.ptr = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max); this.grow = new Float32Array(max); this.a0 = new Float32Array(max);
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1)); g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
      uniforms: { map: { value: tex }, uScale: { value: 800 } },
      vertexShader: 'attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uScale; varying float vA; varying vec3 vC; void main(){ vA = aAlpha; vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(0.5, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying float vA; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, vA * t.a); }'
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
  }
  emit(x, y, z, vx, vy, vz, life, size, grow, r, g, b, a) {
    const i = this.ptr; this.ptr = (this.ptr + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z; this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = this.maxLife[i] = life; this.size[i] = size; this.grow[i] = grow; this.a0[i] = a; this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b; this.alpha[i] = a;
  }
  update(dt, h) {
    this.mat.uniforms.uScale.value = h * 0.8;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      this.life[i] -= dt; const k = i * 3, d = Math.pow(0.4, dt);
      this.vel[k] *= d; this.vel[k + 1] = this.vel[k + 1] * d + 0.4 * dt; this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] += this.grow[i] * dt; this.alpha[i] = this.life[i] > 0 ? this.a0[i] * (this.life[i] / this.maxLife[i]) : 0;
    }
    const A = this.geo.attributes; A.position.needsUpdate = A.aSize.needsUpdate = A.aAlpha.needsUpdate = A.aColor.needsUpdate = true;
  }
  clear() { this.life.fill(0); }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

/* ------------------------------ SHOWROOM ------------------------------ */
function box(w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }
function buildShowroom(renderer) {
  const root = new THREE.Group(), env = makeEnvTexture(renderer, '#1c2540', '#07090f', 5);
  const bgTex = canvasTex(512, 256, function (g, w, h) {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#070910'); gr.addColorStop(0.55, '#10172a'); gr.addColorStop(1, '#1b2742'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const rg = g.createRadialGradient(w / 2, h * 0.78, 4, w / 2, h * 0.78, w * 0.4); rg.addColorStop(0, 'rgba(255,176,32,0.20)'); rg.addColorStop(1, 'rgba(255,176,32,0)'); g.fillStyle = rg; g.fillRect(0, 0, w, h);
  });
  bgTex.wrapS = bgTex.wrapT = THREE.ClampToEdgeWrapping;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(34, 34, 26, 40, 1, true), new THREE.MeshBasicMaterial({ map: bgTex, side: THREE.BackSide })); wall.position.y = 12; root.add(wall);
  const floorTex = canvasTex(256, 256, function (g, w, h) { const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2); gr.addColorStop(0, '#222a3d'); gr.addColorStop(0.6, '#10141f'); gr.addColorStop(1, '#090b11'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  floorTex.wrapS = floorTex.wrapT = THREE.ClampToEdgeWrapping;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(34, 48), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.62, metalness: 0.12, envMapIntensity: 0.35 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; root.add(floor);
  const tt = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(4.1, 4.3, 0.18, 56), new THREE.MeshStandardMaterial({ color: lin('#232a3b'), roughness: 0.4, metalness: 0.5 })); base.position.y = 0.09; base.receiveShadow = true; tt.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4.15, 0.04, 8, 72), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 0.6, 0.12) })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.19; tt.add(ring); root.add(tt);
  const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.5, 1.9) });
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, s = box(0.25, 0.1, 9, strip, Math.cos(a) * 11, 14, Math.sin(a) * 11); s.rotation.y = -a; root.add(s); }
  const key = new THREE.SpotLight(0xffffff, 1.7, 70, 0.6, 0.6, 1); key.position.set(8, 14, 9); key.target.position.set(0, 0.6, 0); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0003;
  const rim = new THREE.SpotLight(lin('#ffb020'), 0.9, 70, 0.7, 0.6, 1); rim.position.set(-9, 6, -9); rim.target.position.set(0, 0.8, 0);
  const fill = new THREE.SpotLight(lin('#5aa8ff'), 1.0, 70, 0.8, 0.8, 1); fill.position.set(-10, 7, 8); fill.target.position.set(0, 0.6, 0);
  [key, rim, fill].forEach(function (l) { root.add(l); root.add(l.target); });
  root.add(new THREE.AmbientLight(0x8794b8, 0.3));
  return { root: root, env: env, turntable: tt };
}

/* ------------------------------ GARAGE ------------------------------ */
const Garage = {
  showroom: null, scene: null, camera: null, car: null, driver: null, active: false, idle: 0, carId: 0, mods: null,
  o: { theta: 0.75, phi: 0.2, r: 8.6, tx: 0, ty: 0.75, tz: 0, gr: 8.6, gtx: 0, gty: 0.75, gtz: 0, gphi: 0.2 },
  pointers: {},
  focus: { car: [8.6, 0, 0.75, 0, 0.2], paint: [8.6, 0, 0.75, 0, 0.2], wheels: [5.6, 0, 0.5, 1.2, 0.1], body: [8.2, 0, 0.9, -0.8, 0.25], perf: [7.4, 0, 0.8, 0.5, 0.15], driver: [4.4, -3.4, 1.15, 1.0, 0.08] },
  init: function () {
    this.showroom = buildShowroom(GL.renderer);
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x07090f); this.scene.environment = this.showroom.env; this.scene.add(this.showroom.root);
    this.camera = new THREE.PerspectiveCamera(40, GL.w / GL.h, 0.2, 200);
    const self = this, cv = GL.canvas;
    cv.addEventListener('pointerdown', function (e) { if (!self.active) return; self.pointers[e.pointerId] = { x: e.clientX, y: e.clientY }; self.idle = 0; try { cv.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } });
    cv.addEventListener('pointermove', function (e) {
      const p = self.pointers[e.pointerId]; if (!p || !self.active) return; const ids = Object.keys(self.pointers);
      if (ids.length >= 2) { const a = self.pointers[ids[0]], b = self.pointers[ids[1]], before = Math.hypot(a.x - b.x, a.y - b.y); p.x = e.clientX; p.y = e.clientY; const after = Math.hypot(a.x - b.x, a.y - b.y); self.o.gr = clamp(self.o.gr * (before / (after || 1)), 3, 13); }
      else { self.o.theta -= (e.clientX - p.x) * 0.006; self.o.gphi = clamp(self.o.gphi + (e.clientY - p.y) * 0.004, 0.02, 1.2); p.x = e.clientX; p.y = e.clientY; }
      self.idle = 0;
    });
    const up = function (e) { delete self.pointers[e.pointerId]; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', function (e) { if (!self.active) return; e.preventDefault(); self.o.gr = clamp(self.o.gr + e.deltaY * 0.005, 3, 13); self.idle = 0; }, { passive: false });
  },
  setFocus: function (name) {
    const f = this.focus[name] || this.focus.car;
    this.o.gr = f[0]; this.o.gtx = f[1]; this.o.gty = f[2]; this.o.gtz = f[3]; this.o.gphi = f[4];
    if (name === 'driver') this.o.theta = 0.45; if (name === 'wheels') this.o.theta = 1.35; this.idle = 0;
  },
  enter: function () { this.active = true; this.refresh(); },
  leave: function () {
    this.active = false;
    if (this.car) { this.showroom.root.remove(this.car); disposeTree(this.car); this.car = null; }
    if (this.driver) { this.showroom.root.remove(this.driver); disposeTree(this.driver); this.driver = null; }
  },
  show: function (carId, mods) { this.carId = carId; this.mods = mods; this.refresh(); },
  refresh: function () {
    if (!this.active || !this.mods) return;
    const root = this.showroom.root;
    if (this.car) { root.remove(this.car); disposeTree(this.car); }
    if (this.driver) { root.remove(this.driver); disposeTree(this.driver); }
    this.car = buildCarMesh(CARS[this.carId], profileFor(this.carId, this.mods), {});
    this.car.position.y = 0.18; root.add(this.car); this.car.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    const fig = buildDriver(SAVE.driver, { seated: false }); fig.position.set(-3.4, 0.18, 1.0); fig.rotation.y = 0.9; fig.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    this.driver = fig; root.add(fig);
  },
  setPaintLive: function () {
    if (!this.car || !this.mods) return;
    const hex = this.mods.customPaint || PAINTS[this.mods.paint][1], f = FINISHES[this.mods.finish], m = this.car.userData.api.bodyMat;
    m.color.copy(lin(hex)); m.metalness = f.metal; m.roughness = f.rough; m.clearcoat = f.clear;
  },
  update: function (dt) {
    const o = this.o, cam = this.camera; this.idle += dt;
    if (this.idle > 2.5 && Object.keys(this.pointers).length === 0) o.theta += dt * 0.28;
    const k = 1 - Math.exp(-dt * 5);
    o.r += (o.gr - o.r) * k; o.tx += (o.gtx - o.tx) * k; o.ty += (o.gty - o.ty) * k; o.tz += (o.gtz - o.tz) * k; o.phi += (o.gphi - o.phi) * k;
    const cp = Math.cos(o.phi), sp = Math.sin(o.phi);
    cam.position.set(o.tx + Math.sin(o.theta) * cp * o.r, o.ty + sp * o.r, o.tz + Math.cos(o.theta) * cp * o.r); cam.lookAt(o.tx, o.ty, o.tz);
    cam.aspect = GL.w / GL.h; cam.fov = 40;
    const iw = GL.w, ih = GL.h;
    if (iw <= 820 && ih > iw * 0.8) cam.setViewOffset(iw, ih, 0, ih * 0.2, iw, ih); else if (iw > 820) cam.setViewOffset(iw, ih, iw * 0.09, 0, iw, ih); else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    if (this.car) this.car.userData.api.roll(dt * 0.4);
  }
};
