// Headless browser smoke test: boots the built game, walks the menus, runs a
// race with the throttle pinned, collects console errors and screenshots.
// Usage: node tests/browser.mjs [outDir] [trackId] [carId] [mode]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] || path.join(root, 'tests/out');
const trackId = process.argv[3] || 'suzuka';
const carId = process.argv[4] || 'nsxr';
const mode = process.argv[5] || 'race';
fs.mkdirSync(outDir, { recursive: true });

const exe = process.env.CHROME || path.join(os.homedir(), '.cache/ms-playwright/chromium-1140/chrome-linux/chrome');
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); else if (m.text().includes('voxel-gt')) console.log('  console:', m.text()); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack || ''}`));

const shot = async (name) => { await page.screenshot({ path: path.join(outDir, name + '.png') }); console.log('  shot', name); };
async function run() {
const t0 = Date.now();
await page.goto('file://' + path.join(root, 'dist/voxel-gt.html'));
await page.waitForSelector('#menu.screen-title', { timeout: 120000 });
console.log(`title after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await page.waitForTimeout(1500);
await shot('01-title');
await page.keyboard.press('Enter');
await page.waitForSelector('#menu.screen-main');
await page.waitForTimeout(500);
await shot('02-main');
await page.keyboard.press('Enter');
await page.waitForSelector('#menu.screen-car');
await page.waitForTimeout(1200);
await shot('03-car');
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(700);
await shot('03b-car-next');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
await page.keyboard.press('Enter');
await page.waitForSelector('#menu.screen-track');
await page.waitForTimeout(500);
await shot('04-track');

// start the requested race directly
await page.evaluate(([t, c, m]) => window.__vgt.startRace({ mode: m, car: c, paint: 0, track: t }), [trackId, carId, mode]);
await page.waitForFunction(() => window.__vgt.app === 'race', null, { timeout: 120000 });
await page.waitForTimeout(1500);
await shot('05-countdown');
await page.waitForTimeout(3500);
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(4000);
await shot('06-launch');
await page.keyboard.press('KeyC');
await page.waitForTimeout(1500);
await shot('07-cam-far');
await page.keyboard.press('KeyC');
await page.waitForTimeout(1500);
await shot('08-cam-hood');
await page.keyboard.press('KeyC');
await page.waitForTimeout(1500);
await shot('09-cam-bumper');
await page.keyboard.press('KeyC');
const info = await page.evaluate(() => {
  const r = window.__vgt.race;
  const h = r.hud();
  return { fps: window.__fps, speed: h.speed * 3.6, gear: h.gear, pos: h.pos, state: r.state, lap: h.lap, time: r.time, calls: window.__vgt.renderer.info.render.calls, tris: window.__vgt.renderer.info.render.triangles };
});
console.log('race info', info);
await page.keyboard.up('ArrowUp');
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
await shot('10-pause');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

console.log(errors.length ? `ERRORS (${errors.length}):\n` + errors.slice(0, 20).join('\n') : 'no console errors');
}
try {
  await run();
} catch (e) {
  console.log('FAILED:', e.message.split('\n')[0]);
  await page.screenshot({ path: path.join(outDir, 'zz-fail.png') }).catch(() => {});
  console.log(errors.length ? `ERRORS (${errors.length}):\n` + errors.slice(0, 20).join('\n') : 'no console errors');
  process.exitCode = 1;
}
await browser.close();
