// End-to-end flow: a 1-lap race (player on autopilot) must reach the results
// screen; a time trial must record a best lap and save a ghost.
import { chromium } from 'playwright-core';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] || path.join(root, 'tests/out');
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME || path.join(os.homedir(), '.cache/ms-playwright/chromium-1140/chrome-linux/chrome'),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let ok = true;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) ok = false; };

await page.goto('file://' + path.join(root, 'dist/voxel-gt.html'));
await page.waitForSelector('#menu.screen-title', { timeout: 120000 });

// ---- race to the flag ----
await page.evaluate(() => { window.__vgt.settings.laps = 1; window.__vgt.startRace({ mode: 'race', car: 'f40', paint: 0, track: 'monza' }); });
await page.waitForFunction(() => window.__vgt.app === 'race', null, { timeout: 60000 });
const res = await page.evaluate(() => {
  const r = window.__vgt.race;
  const AI = r.cars.find((c) => c.ai).ai.constructor;
  r.player.ai = new AI(r.player, { skill: 0.97 });
  let n = 0;
  while (r.state !== 'results' && n < 60 * 60 * 6) { r.update(1 / 60, null); n++; }
  return { state: r.state, t: r.time, rows: r.results && r.results.rows.map((x) => [x.pos, x.name, x.total.toFixed(1), x.best && x.best.toFixed(2)]) };
});
console.log(res);
check(res.state === 'results', 'race reaches results');
await page.waitForSelector('#menu.screen-results', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(800);
check(await page.$('#menu.screen-results') !== null, 'results screen shown');
await page.screenshot({ path: path.join(outDir, 'flow-results.png') });

// ---- time trial: two laps on autopilot -> best lap + ghost ----
await page.evaluate(() => window.__vgt.startRace({ mode: 'timetrial', car: 'nsxr', paint: 1, track: 'suzuka' }));
await page.waitForFunction(() => window.__vgt.app === 'race', null, { timeout: 60000 });
const tt2 = await page.evaluate(() => window.__vgt.race.mode);
check(tt2 === 'timetrial', 'time trial started');
const ghost = await page.evaluate(() => {
  const r = window.__vgt.race;
  r.player.ai = new window.__vgt.AIDriver(r.player, { skill: 0.96 });
  let n = 0;
  while (r.player.lapTimes.length < 2 && n < 60 * 60 * 8) { r.update(1 / 60, null); n++; }
  const g = JSON.parse(localStorage.getItem('voxelgt.ghost.suzuka') || 'null');
  const best = JSON.parse(localStorage.getItem('voxelgt.best') || '{}');
  return { laps: r.player.lapTimes.map((t) => t.toFixed(2)), ghostTime: g && g.time.toFixed(2), ghostSamples: g && g.data.length / 4, best: best.suzuka, ghostObj: !!r.ghostObj };
});
console.log(ghost);
check(ghost.laps.length >= 2, 'two timed laps');
check(ghost.ghostTime != null && ghost.ghostSamples > 100, 'ghost saved');
check(ghost.best && ghost.best.nsxr > 0, 'best lap recorded');
check(ghost.ghostObj, 'ghost car loaded for playback');
await page.evaluate(() => { const r = window.__vgt.race; r.player.ai = null; for (let k = 0; k < 240; k++) r.update(1 / 60, { drive: { throttle: 1, brake: 0, steer: 0 }, events: new Set() }); });
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(outDir, 'flow-tt-ghost.png') });

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
await browser.close();
process.exit(ok ? 0 : 1);
