'use strict';
/* ============================================================
   TERRAIN + SKY + TIME OF DAY + POST
   The terrain height function exists twice: in JS (physics, road
   placement) and in GLSL (rendering). Keep both in sync.
   ============================================================ */

const TERR = { A: 20, ox: 0, oz: 0, f0: 0, f1: 0, r0: 2400, r1: 3300, rh: 150 };

function terrSetup(map) {
  TERR.A = map.hill; TERR.ox = (map.seed * 137) % 1000; TERR.oz = (map.seed * 311) % 1000;
  TERR.f0 = map.flat[0]; TERR.f1 = map.flat[1]; TERR.r0 = map.rim[0]; TERR.r1 = map.rim[1]; TERR.rh = map.rim[2];
}
function terrH(x, z) {
  const qx = x + TERR.ox, qz = z + TERR.oz;
  let h = 0.55 * Math.sin(qx * 0.0071 + 1.3) * Math.sin(qz * 0.0059 + 0.4) + 0.30 * Math.sin(qx * 0.0163 + qz * 0.0121 + 2.1) + 0.15 * Math.sin(qx * 0.0391 - qz * 0.0337 + 0.7);
  h *= TERR.A;
  const d = Math.sqrt(x * x + z * z);
  if (TERR.f1 > 0) h *= smoothstep(TERR.f0, TERR.f1, d);
  const t = smoothstep(TERR.r0, TERR.r1, d); h += TERR.rh * t * t;
  return h;
}
function terrNormal(x, z, out) {
  const e = 1.5, hx = terrH(x + e, z) - terrH(x - e, z), hz = terrH(x, z + e) - terrH(x, z - e);
  const l = Math.sqrt(hx * hx + 4 * e * e + hz * hz);
  out.x = -hx / l; out.y = 2 * e / l; out.z = -hz / l; return out;
}

const NIGHT = { value: 0 }; // shared uniform: 0 day, 1 night (window lights, lamps)

const GLSL_H = '\
uniform vec2 uCenter; uniform float uA; uniform vec2 uOff; uniform vec2 uFlat; uniform vec3 uRim; uniform float uRange;\n\
float terrH(vec2 p){\n\
  vec2 q = p + uOff;\n\
  float h = 0.55*sin(q.x*0.0071+1.3)*sin(q.y*0.0059+0.4) + 0.30*sin(q.x*0.0163+q.y*0.0121+2.1) + 0.15*sin(q.x*0.0391-q.y*0.0337+0.7);\n\
  h *= uA;\n\
  float d = length(p);\n\
  if (uFlat.y > 0.0) h *= smoothstep(uFlat.x, uFlat.y, d);\n\
  float t = smoothstep(uRim.x, uRim.y, d); h += uRim.z*t*t;\n\
  return h;\n\
}\n\
vec2 terrWarp(vec2 uv){ vec2 a = abs(uv); vec2 f = a*(0.12+0.88*a*a); return sign(uv)*f*uRange; }\n';

const GLSL_NOISE = '\
float th(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }\n\
float tn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(th(i),th(i+vec2(1.,0.)),f.x), mix(th(i+vec2(0.,1.)),th(i+vec2(1.,1.)),f.x), f.y); }\n';

function makeTerrain(map) {
  const N = 192, nv = (N + 1) * (N + 1), pos = new Float32Array(nv * 3), idx = new Uint32Array(N * N * 6);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const k = (j * (N + 1) + i) * 3; pos[k] = i / N * 2 - 1; pos[k + 1] = j / N * 2 - 1; pos[k + 2] = 0; }
  let q = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  const P = map.pal;
  const U = {
    uCenter: { value: new THREE.Vector2() }, uA: { value: TERR.A }, uOff: { value: new THREE.Vector2(TERR.ox, TERR.oz) }, uFlat: { value: new THREE.Vector2(TERR.f0, TERR.f1) },
    uRim: { value: new THREE.Vector3(TERR.r0, TERR.r1, TERR.rh) }, uRange: { value: 3300 },
    uColA: { value: lin(P.gA) }, uColB: { value: lin(P.gB) }, uRock: { value: lin(P.rock) }, uSnow: { value: lin(P.snow) }, uSnowLine: { value: P.snowLine },
    uSand: { value: map.theme === 'desert' ? 1 : 0 }
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97, metalness: 0 });
  mat.onBeforeCompile = function (sh) {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + GLSL_H + 'varying vec3 vTW; varying vec3 vTN;')
      .replace('#include <beginnormal_vertex>',
        'vec2 tOff = terrWarp(position.xy); vec2 tW = tOff + uCenter; float tH = terrH(tW);\n' +
        'float te = 2.0; float thx = terrH(tW+vec2(te,0.))-terrH(tW-vec2(te,0.)); float thz = terrH(tW+vec2(0.,te))-terrH(tW-vec2(0.,te));\n' +
        'vec3 objectNormal = normalize(vec3(-thx/(2.*te), 1.0, -thz/(2.*te))); vTW = vec3(tW.x, tH, tW.y); vTN = objectNormal;')
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(tW.x, tH, tW.y);'); // world-space vertices: heights and positions use the same point
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_NOISE + 'varying vec3 vTW; varying vec3 vTN; uniform vec3 uColA; uniform vec3 uColB; uniform vec3 uRock; uniform vec3 uSnow; uniform float uSnowLine; uniform float uSand;')
      .replace('#include <color_fragment>',
        'vec3 tnn = normalize(vTN); vec2 tp = vTW.xz;\n' +
        'float n1 = tn(tp*0.011), n2 = tn(tp*0.085), n3 = tn(tp*0.7), n4 = tn(tp*2.6);\n' +
        'vec3 tc = mix(uColA, uColB, smoothstep(0.3,0.7,n1)); tc *= 0.86 + 0.26*n2 + 0.1*(n3-0.5) + 0.12*(n4-0.5);\n' +
        'if (uSand > 0.5) { float rip = sin((tp.x*0.9 + tp.y*0.35) + n1*12.0)*0.5+0.5; tc *= 0.93 + 0.1*rip; }\n' +
        'float slope = 1.0 - tnn.y; float rockM = smoothstep(0.14, 0.34, slope + (n2-0.5)*0.12);\n' +
        'tc = mix(tc, uRock*(0.75+0.4*n2), rockM);\n' +
        'float snowM = smoothstep(uSnowLine, uSnowLine+22.0, vTW.y + (n2-0.5)*9.0) * (1.0 - smoothstep(0.3, 0.55, slope));\n' +
        'tc = mix(tc, uSnow, snowM);\n' +
        'diffuseColor.rgb = tc;');
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; mesh.receiveShadow = true;
  mesh.userData.update = function (x, z) { U.uCenter.value.set(Math.round(x / 25) * 25, Math.round(z / 25) * 25); };
  mesh.userData.dispose = function () { g.dispose(); mat.dispose(); };
  return mesh;
}

/* ------------------------------- SKY ------------------------------- */
const SKY_FRAG = '\
uniform vec3 uTop; uniform vec3 uBot; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uMoonDir; uniform float uNight; uniform float uCloud; uniform float uTime; uniform vec3 uCloudCol;\n\
varying vec3 vDir;\n\
float sh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }\n\
float sn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(sh(i),sh(i+vec2(1.,0.)),f.x), mix(sh(i+vec2(0.,1.)),sh(i+vec2(1.,1.)),f.x), f.y); }\n\
float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*sn(p); p*=2.03; a*=0.5; } return s; }\n\
void main(){\n\
  vec3 d = normalize(vDir); float h = clamp(d.y, 0.0, 1.0);\n\
  vec3 col = mix(uBot, uTop, pow(h, 0.5));\n\
  col = mix(uBot, col, smoothstep(-0.04, 0.12, d.y));\n\
  float sd = max(dot(d, uSunDir), 0.0);\n\
  col += uSunCol * (pow(sd, 1100.0) * 6.0 + pow(sd, 18.0) * 0.35 + pow(sd, 4.0) * 0.08);\n\
  float md = max(dot(d, uMoonDir), 0.0); col += vec3(0.75,0.85,1.0) * pow(md, 1500.0) * 2.2 * uNight;\n\
  vec2 cp = d.xz / (d.y + 0.22) * 1.1 + vec2(uTime*0.006, uTime*0.002);\n\
  float cl = smoothstep(0.48, 0.82, fbm(cp)) * smoothstep(0.02, 0.2, d.y) * uCloud;\n\
  vec3 cc = mix(uCloudCol, uCloudCol*vec3(1.0,0.95,0.9) + uSunCol*0.25*pow(sd,3.0), 1.0-uNight);\n\
  col = mix(col, cc, cl*0.9);\n\
  vec2 sp = floor(vec2(atan(d.z, d.x)*210.0, d.y*210.0)); float star = step(0.9975, sh(sp)) * uNight * smoothstep(0.08, 0.4, d.y) * (1.0 - cl);\n\
  col += vec3(star);\n\
  gl_FragColor = vec4(col, 1.0);\n\
  #include <tonemapping_fragment>\n\
  #include <encodings_fragment>\n\
}';

function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color() }, uBot: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() },
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uNight: { value: 0 }, uCloud: { value: 0.5 }, uTime: { value: 0 }, uCloudCol: { value: new THREE.Color() }
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: SKY_FRAG
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(4500, 32, 16), mat);
  m.renderOrder = -10; m.frustumCulled = false; return m;
}

/* -------------------------- TIME OF DAY -------------------------- */
const _sd = new THREE.Vector3();
function applyTimeOfDay(w, hours, camPos) {
  const map = w.map, P = map.pal, ang = (hours - 6) / 12 * Math.PI;
  _sd.set(Math.cos(ang) * 0.85, Math.sin(ang), 0.4).normalize();
  const elev = _sd.y, day = smoothstep(-0.1, 0.3, elev), tw = Math.exp(-Math.pow((elev - 0.03) / 0.17, 2));
  const dayTop = lin(P.dayTop), dayBot = lin(P.dayBot), nTop = lin('#04081a'), nBot = lin('#0f1a36'), tTop = lin('#34346e'), tBot = lin('#ff8a55');
  const top = nTop.clone().lerp(dayTop, day).lerp(tTop, tw * 0.55);
  const bot = nBot.clone().lerp(dayBot, day).lerp(tBot, tw * 0.75);
  const su = w.sky.material.uniforms;
  su.uTop.value.copy(top); su.uBot.value.copy(bot); su.uSunDir.value.copy(_sd);
  const sunCol = lin('#fff3e0').lerp(lin('#ff8f45'), clamp(tw * 1.2, 0, 1)); su.uSunCol.value.copy(sunCol).multiplyScalar(smoothstep(-0.08, 0.05, elev));
  su.uMoonDir.value.set(-_sd.x * 0.6, Math.max(0.35, -_sd.y), 0.5).normalize();
  su.uNight.value = 1 - day; su.uCloud.value = map.cloud;
  su.uCloudCol.value.copy(lin('#ffffff')).multiplyScalar(0.25 + 0.75 * day).lerp(bot, 0.25);
  w.sun.color.copy(sunCol); w.sun.intensity = map.sunI * smoothstep(-0.02, 0.38, elev);
  w.sunDir = _sd.clone();
  w.hemi.color.copy(top).lerp(lin('#ffffff'), 0.35); w.hemi.groundColor.copy(lin(P.gA)).multiplyScalar(0.5);
  w.hemi.intensity = lerp(0.42, map.ambI, day);
  w.moon.intensity = 0.55 * (1 - day);
  w.night = 1 - day; NIGHT.value = clamp((1 - day) * 1.15 - 0.08, 0, 1);
  w.scene.fog.color.copy(bot).multiplyScalar(0.92 + 0.08 * day);
  w.scene.fog.density = map.fog * (1 + (1 - day) * 0.25 + tw * 0.2);
  w.exposure = lerp(1.55, 1.0, day) * (1 + tw * 0.1);
  w.envScale = lerp(0.22, 1.0, day);
  (w.envMats || []).forEach(function (m) { m.envMapIntensity = 0.4 * w.envScale; });
  CarMats.forEach(function (m) { if (m.userData.carEnv !== false) m.envMapIntensity = (m.userData.envBase || (m.userData.envBase = m.envMapIntensity)) * w.envScale; });
}

/* ------------------------------ POST ------------------------------ */
const FinalShader = {
  uniforms: { tDiffuse: { value: null }, uExp: { value: 1 }, uBlur: { value: 0 }, uVig: { value: 0.35 }, uSat: { value: 1.08 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: '\
uniform sampler2D tDiffuse; uniform float uExp; uniform float uBlur; uniform float uVig; uniform float uSat; varying vec2 vUv;\n\
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }\n\
void main(){\n\
  vec2 dir = vUv - 0.5; float r = length(dir);\n\
  vec3 col = vec3(0.0);\n\
  for (int i = 0; i < 6; i++) { float k = float(i) / 5.0; col += texture2D(tDiffuse, vUv - dir * uBlur * k * (0.3 + r)).rgb; }\n\
  col /= 6.0; col *= uExp; col = aces(col);\n\
  float l = dot(col, vec3(0.2126,0.7152,0.0722)); col = mix(vec3(l), col, uSat);\n\
  col = pow(col, vec3(1.0/2.2)); col *= 1.0 - uVig * r * r * 1.5;\n\
  gl_FragColor = vec4(col, 1.0);\n\
}'
};

const Post = {
  on: false, composer: null, bloom: null, fin: null, rp: null,
  init: function (renderer, scene, camera, w, h, pr, q) {
    this.dispose();
    try {
      if (!THREE.EffectComposer || !THREE.UnrealBloomPass || !THREE.RenderPass || !THREE.ShaderPass) return false;
      const gl2 = renderer.capabilities.isWebGL2;
      const rt = gl2 ? new THREE.WebGLMultisampleRenderTarget(4, 4, { type: THREE.HalfFloatType, format: THREE.RGBAFormat }) : new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, format: THREE.RGBAFormat });
      if (gl2) rt.samples = q >= 2 ? 4 : 2;
      const c = this.composer = new THREE.EffectComposer(renderer, rt);
      c.setPixelRatio(pr); c.setSize(w, h);
      this.rp = new THREE.RenderPass(scene, camera); c.addPass(this.rp);
      this.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(Math.max(64, w >> 1), Math.max(64, h >> 1)), 0.5, 0.65, 1.0);
      c.addPass(this.bloom);
      this.fin = new THREE.ShaderPass(FinalShader); this.fin.renderToScreen = true; c.addPass(this.fin);
      this.on = true; return true;
    } catch (e) { if (window.console) console.error('post init failed', e); this.dispose(); return false; }
  },
  resize: function (w, h, pr) { if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); if (this.bloom) this.bloom.setSize(Math.max(64, w >> 1), Math.max(64, h >> 1)); } },
  setCamera: function (scene, camera) { if (this.rp) { this.rp.scene = scene; this.rp.camera = camera; } },
  dispose: function () { this.on = false; if (this.composer) { try { this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); } catch (e) { /* ignore */ } } this.composer = null; this.bloom = null; this.fin = null; this.rp = null; }
};
