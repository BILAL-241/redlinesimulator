'use strict';
// Builds dist/index.html: template + inlined scripts. Run: node build.js
const fs = require('fs');
const path = require('path');
const order = ['util.js', 'data.js', 'save.js', 'models.js', 'carmodels.js', 'terrain.js', 'world.js', 'engine.js', 'vehicle.js', 'ui.js', 'net.js', 'game.js', 'onfoot.js', 'npc.js', 'account.js', 'boot.js'];
const tpl = fs.readFileSync(path.join(__dirname, 'src/template.html'), 'utf8');
// Car models are embedded in the page, so the game works from this one file on any static host.
const vdir = path.join(__dirname, 'assets/models/vehicles');
const embedded = {};
if (fs.existsSync(vdir)) fs.readdirSync(vdir).filter(f => /\.glb$/.test(f)).sort().forEach(f => {
  embedded[f.replace(/\.glb$/, '')] = 'data:model/gltf-binary;base64,' + fs.readFileSync(path.join(vdir, f)).toString('base64');
});
const embedCode = 'window.EMBEDDED_MODELS = ' + JSON.stringify(embedded) + ';\n';
const mpServer = /^wss?:\/\//.test(process.env.MP_SERVER || '') ? process.env.MP_SERVER : '';
const mpCode = 'window.MP_SERVER = ' + JSON.stringify(mpServer) + ';\n';
const code = embedCode + mpCode + order.map(f => '/* ---- ' + f + ' ---- */\n' + fs.readFileSync(path.join(__dirname, 'src', f), 'utf8').replace(/^'use strict';\n/, '')).join('\n');
const J = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/';
const libs = [
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  J + 'shaders/CopyShader.js', J + 'shaders/LuminosityHighPassShader.js',
  J + 'postprocessing/EffectComposer.js', J + 'postprocessing/RenderPass.js', J + 'postprocessing/ShaderPass.js', J + 'postprocessing/MaskPass.js', J + 'postprocessing/UnrealBloomPass.js', J + 'loaders/GLTFLoader.js'
].map(u => '<script src="' + u + '"></script>').join('\n');
// Scripts share one scope, so wrap once and keep a single strict directive.
const out = tpl.replace('<!--SCRIPTS-->', libs + '\n<script>\n\'use strict\';\n' + code.replace(/<\/script/gi, '<\\/script') + '\n</script>');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/index.html'), out);
const vm = require('vm');
new vm.Script('(function(){\n\'use strict\';\n' + code + '\n})', { filename: 'bundle.js' });
console.log('built dist/index.html', (out.length / 1024).toFixed(0) + ' KB, syntax OK');
