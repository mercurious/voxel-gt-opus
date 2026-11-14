// Close-up showroom renders of the voxel cars (front 3/4, rear 3/4, side,
// and a night shot with the lights on) for judging the models by eye.
// Usage: node tests/carshots.mjs [carId,carId...] [outDir]
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv[2] ? process.argv[2].split(',') : null;
const outDir = process.argv[3] || path.join(root, 'tests/out/cars');
fs.mkdirSync(outDir, { recursive: true });

const entry = `
import * as THREE from 'three';
import { CARS, carById } from './src/cars.js';
import { buildCarObject } from './src/carModel.js';
const W = 1280, H = 720;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 200);
const hemi = new THREE.HemisphereLight('#cfe0ff', '#1a1e2a', 1.4);
const key = new THREE.DirectionalLight('#ffffff', 2.6);
key.position.set(5, 9, 6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
const rim = new THREE.DirectionalLight('#ff9a3c', 1.4);
rim.position.set(-6, 3, -6);
scene.add(hemi, key, rim);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ color: '#30384f' }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
let car = null;
window.cars = CARS.map((c) => c.id);
window.shot = (id, paint, view, night) => {
  const spec = carById(id);
  if (car) { scene.remove(car.root); car.dispose(); }
  car = buildCarObject(spec, spec.paints[paint % spec.paints.length].hex);
  scene.add(car.root);
  car.setLights(!!night, { spot: !!night });
  scene.background = new THREE.Color(night ? '#05070d' : '#0b1020');
  hemi.intensity = night ? 0.12 : 1.4; key.intensity = night ? 0.05 : 2.6; rim.intensity = night ? 0.1 : 1.4;
  floor.material.color.set(night ? '#2a2c30' : '#30384f');
  const L = spec.model.length;
  const views = {
    front: [0.42, 0.3, 1],
    rear: [-0.3, 0.26, -1],
    back: [0, 0.16, -1],
    face: [0, 0.16, 1],
    side: [0, 0.12, 1.0, 1],
    night: [0.25, 0.35, 1, 0, 1.8],
  };
  const [ang, el, sgn, side, far] = views[view];
  const dist = (L * 1.45 + 2.2) * (far || 1);
  const a = side ? Math.PI / 2 : ang * Math.PI / 2;
  camera.position.set(Math.sin(a) * dist * Math.cos(el), 0.9 + Math.sin(el) * dist, Math.cos(a) * dist * Math.cos(el) * sgn);
  camera.lookAt(0, side ? 0.6 : 0.55, view === 'night' ? 1.5 : 0);
  renderer.render(scene, camera);
  return true;
};
window.ready = true;
`;
const out = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'js' },
  bundle: true, format: 'iife', write: false, target: 'es2020', logLevel: 'error',
});
const html = `<!doctype html><html><body style="margin:0;background:#000"><script>${out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;

const exe = process.env.CHROME || path.join(os.homedir(), '.cache/ms-playwright/chromium-1140/chrome-linux/chrome');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.setContent(html);
await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
const ids = only || (await page.evaluate(() => window.cars));
for (const id of ids) {
  const paints = process.env.ALLPAINTS ? [0, 1, 2] : [0];
  for (const p of paints) {
    for (const view of (process.env.VIEWS || 'front,rear,side,night').split(',')) {
      await page.evaluate(([i, pp, v]) => window.shot(i, pp, v, v === 'night'), [id, p, view]);
      const f = path.join(outDir, `${id}${p ? '-p' + p : ''}-${view}.png`);
      await page.screenshot({ path: f });
      console.log('  shot', path.relative(root, f));
    }
  }
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
