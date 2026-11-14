// Scenic screenshots of a track from fixed camera positions along the lap
// (landmarks, corners, skyline). Boots the built game, starts a race, parks
// the player at each spot and takes over the camera.
// Usage: node tests/views.mjs [outDir] [trackId] [quality]
//   views come from VIEWS[trackId] below: [name, where, options]
//   where: lap fraction, or [lat, lon] of a landmark on a city course (the
//          camera then stands on the course near it and looks at it)
//   options: off (lateral m, + = left), h (camera height), back (m behind),
//            side (lateral camera offset), ahead (look-at distance),
//            lookOff (lateral look-at offset), lookUp (m)
import { CITY_DATA } from '../src/cityData.generated.js';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] || path.join(root, 'tests/out/views');
const trackId = process.argv[3] || 'nyc';
const quality = process.argv[4] || 'high';
fs.mkdirSync(outDir, { recursive: true });

const VIEWS = {
  nyc: [
    ['v01-start-grid', 0.985, { h: 22, back: 60, side: -14, ahead: 60 }],
    ['v02-fifth-ave', 0.06, { h: 2.2, back: 9, ahead: 70, lookUp: 6 }],
    ['v03-st-patricks', [40.7585, -73.9765], { h: 26, back: 85, side: -10, lookUp: 28 }],
    ['v04-rockefeller-center', [40.7587, -73.9782], { h: 9, back: 30, side: 6, lookUp: 5 }],
    ['v05-library-lions', [40.75297, -73.98185], { h: 7, back: 45, side: -4, lookUp: 4 }],
    ['v06-bryant-park', [40.7537, -73.9838], { h: 24, back: 40, side: -8, lookUp: 0 }],
    ['v07-times-square', 0.425, { h: 3, back: 12, ahead: 60, lookUp: 12 }],
    ['v08-duffy-square-tkts', [40.75915, -73.98492], { h: 7, back: 45, side: 3, lookUp: 5 }],
    ['v09-columbus-circle', 0.745, { h: 45, back: 70, side: 40, ahead: 40 }],
    ['v10-central-park-south', 0.85, { h: 4, back: 14, ahead: 80, lookUp: 4 }],
    ['v11-plaza-pulitzer', [40.76425, -73.97370], { h: 12, back: 45, side: 4, lookUp: 12 }],
    ['v12-skyline-down-fifth', 0.02, { h: 120, back: 120, ahead: 900, lookUp: -40 }],
  ],
  tokyo: [
    ['t01-aoyama-dori-start', 0.004, { h: 3, back: 14, ahead: 70, lookUp: 6 }],
    ['t02-akasaka-mitsuke-shuto', [35.6782, 139.7362], { h: 14, back: 70, side: -4, lookUp: 6 }],
    ['t03-benkei-bashi-moat', 0.25, { h: 6, back: 16, ahead: 60, lookUp: 6 }],
    ['t04-yotsuya', 0.49, { h: 8, back: 30, ahead: 40, lookUp: 6 }],
    ['t05-shinjuku-dori-neon', 0.58, { h: 3, back: 12, ahead: 60, lookUp: 10 }],
    ['t06-akasaka-palace', [35.68044, 139.72793], { h: 110, back: 140, side: 0, lookUp: 0 }],
    ['t07-shinanomachi', 0.8, { h: 3, back: 12, ahead: 60, lookUp: 6 }],
    ['t08-tokyo-tower-skyline', [35.65858, 139.74543], { h: 40, back: 0, lookUp: 120 }],
    ['t09-chase-headlights', 0.12, { chase: true }],
  ],
  madrid: [
    ['m01-start-grid', 0.985, { h: 22, back: 60, side: -12, ahead: 60 }],
    ['m02-gran-via', 0.02, { h: 2.5, back: 10, ahead: 80, lookUp: 8 }],
    ['m03-callao-carrion', [40.42030, -3.70640], { h: 5, back: 95, side: 4, lookUp: 58 }],
    ['m04-telefonica', [40.42026, -3.70194], { h: 6, back: 110, side: -3, lookUp: 70 }],
    ['m05-metropolis', [40.41888, -3.69745], { h: 5, back: -90, side: 3, lookUp: 36 }],
    ['m06-cibeles', [40.41934, -3.69309], { h: 12, back: 55, side: 3, lookUp: 4 }],
    ['m07-palacio-cibeles', [40.41884, -3.69238], { h: 6, back: 90, side: 4, lookUp: 25 }],
    ['m08-paseo-del-prado', 0.33, { h: 3, back: 12, ahead: 70, lookUp: 6 }],
    ['m09-neptuno', [40.41526, -3.69415], { h: 7, back: 28, side: 4, lookUp: 2 }],
    ['m10-congreso-lions', [40.41615, -3.69690], { h: 5, back: 45, side: -2, lookUp: 5 }],
    ['m11-puerta-del-sol', [40.41652, -3.70358], { h: 4, back: 45, side: 0, lookUp: 16 }],
    ['m12-sol-sign', [40.41681, -3.70484], { h: 3, back: 90, side: 0, lookUp: 26 }],
    ['m13-calle-mayor', 0.62, { h: 2.5, back: 10, ahead: 60, lookUp: 6 }],
    ['m14-almudena', [40.41560, -3.71455], { h: 4, back: 55, side: 3, lookUp: 42 }],
    ['m15-palacio-real', [40.41790, -3.71420], { h: 12, back: 40, side: -6, lookUp: 12 }],
    ['m16-plaza-de-espana', [40.42317, -3.71264], { h: 38, back: 70, side: -10, lookUp: 4 }],
    ['m17-edificio-espana', [40.42458, -3.71105], { h: 3, back: 40, side: -2, lookUp: 70 }],
    ['m18-sol-from-above', [40.41690, -3.70370], { h: 45, back: 120, side: 0, lookUp: 0 }],
  ],
};
const origin = CITY_DATA[trackId]?.origin;
const project = ([lat, lon]) => [(lon - origin.lon) * origin.kx, -(lat - origin.lat) * origin.ky];

const exe = process.env.CHROME || path.join(os.homedir(), '.cache/ms-playwright/chromium-1140/chrome-linux/chrome');
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
try {
  await page.goto('file://' + path.join(root, 'dist/voxel-gt.html'));
  await page.waitForSelector('#menu.screen-title', { timeout: 120000 });
  await page.evaluate((q) => { window.__vgt.settings.quality = q; }, quality);
  await page.evaluate((t) => window.__vgt.startRace({ mode: 'timetrial', car: 'nsxr', paint: 0, track: t }), trackId);
  await page.waitForFunction(() => window.__vgt.app === 'race', null, { timeout: 120000 });
  await page.waitForTimeout(2000);
  for (const [name, where, o] of VIEWS[trackId] || []) {
    const target = Array.isArray(where) ? project(where) : null;
    await page.evaluate(([u, o, target]) => {
      const r = window.__vgt.race, cam = window.__vgt.camera, tr = r.track;
      const s = target ? tr.locate(target[0], target[1]).s : u * tr.length;
      const rc = r.player;
      rc.placeAt(s, o.off || 0);
      rc.frozen = true;
      r.rig.__update ??= r.rig.update;
      if (o.chase) { r.rig.update = r.rig.__update; r.rig.inited = false; return; } // the game's own chase camera
      const p = tr.sample(s - (o.back ?? 10), o.side || 0);
      const q = target ? { x: target[0], z: target[1], y: tr.sample(s, 0).y } : tr.sample(s + (o.ahead ?? 40), o.lookOff || 0);
      r.rig.update = () => {};
      cam.position.set(p.x, p.y + (o.h ?? 3), p.z);
      cam.lookAt(q.x, q.y + (o.lookUp ?? 0), q.z);
      cam.updateMatrixWorld();
    }, [Array.isArray(where) ? 0 : where, o, target]);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, name + '.png') });
    console.log('  shot', name);
  }
  const info = await page.evaluate(() => ({ fps: window.__fps, calls: window.__vgt.renderer.info.render.calls, tris: window.__vgt.renderer.info.render.triangles }));
  console.log('last view', info);
} catch (e) {
  console.log('FAILED:', e.message.split('\n')[0]);
  process.exitCode = 1;
}
console.log(errors.length ? `ERRORS (${errors.length}):\n` + errors.slice(0, 20).join('\n') : 'no console errors');
await browser.close();
