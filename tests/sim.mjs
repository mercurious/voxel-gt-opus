// Headless simulation tests: every car laps every track under AI control.
// Reports flying-lap times, top speed, wall contacts and checks for NaNs.
// Usage: node tests/sim.mjs [trackId] [carId]
import { CARS } from '../src/cars.js';
import { TRACKS } from '../src/tracks.js';
import { buildTrack } from '../src/trackCore.js';
import { RaceCar, stepCar, collideCars } from '../src/sim.js';
import { AIDriver } from '../src/ai.js';
import { formatTime } from '../src/util.js';

const DT = 1 / 120;
const [onlyTrack, onlyCar] = process.argv.slice(2);
const settings = { auto: true, tcs: true, asm: true };
let failures = 0;

function runSolo(track, spec, laps = 2) {
  const rc = new RaceCar(spec, track);
  rc.placeAt(track.length - 30, 0);
  rc.ai = new AIDriver(rc, { skill: 0.97 });
  let t = 0, lap = -1, lapStart = 0, last = rc.loc.i;
  const times = [];
  let vmax = 0, hits = 0, maxOff = 0, offSamples = 0, samples = 0;
  while (t < 60 * 12 && times.length < laps) {
    rc.ai.update(DT, [rc], t);
    stepCar(rc, DT, settings);
    t += DT;
    const i = rc.loc.i;
    if (last > track.N * 0.9 && i < track.N * 0.1) {
      lap++;
      if (lap >= 1) times.push(t - lapStart);
      lapStart = t;
    }
    last = i;
    const v = rc.veh.speed;
    if (!Number.isFinite(v) || !Number.isFinite(rc.veh.x)) { console.log('  NaN!'); failures++; break; }
    vmax = Math.max(vmax, v);
    if (rc.impact > 2) { hits++; }
    rc.impact = 0;
    const off = Math.abs(rc.loc.d) - track.halfW;
    maxOff = Math.max(maxOff, off);
    if (off > 0.9) offSamples++;
    samples++;
  }
  return { times, vmax, hits, maxOff, offPct: (100 * offSamples) / samples, t };
}

function runRace(track, laps = 2) {
  const cars = CARS.map((s, k) => {
    const rc = new RaceCar(s, track);
    rc.placeAt(track.length - 12 - k * 8, k % 2 ? -3 : 3);
    rc.ai = new AIDriver(rc, { skill: 0.94 + 0.01 * k });
    return rc;
  });
  let t = 0;
  const lapsDone = cars.map(() => 0), last = cars.map((c) => c.loc.i);
  let impacts = 0;
  while (t < 60 * 15 && lapsDone.some((l) => l < laps)) {
    for (const c of cars) c.ai.update(DT, cars, t);
    for (const c of cars) stepCar(c, DT, settings);
    collideCars(cars);
    t += DT;
    cars.forEach((c, k) => {
      if (last[k] > track.N * 0.9 && c.loc.i < track.N * 0.1) lapsDone[k]++;
      last[k] = c.loc.i;
      if (c.impact > 3) impacts++;
      c.impact = 0;
      if (!Number.isFinite(c.veh.x)) { failures++; throw new Error('NaN in race'); }
    });
  }
  return { t, lapsDone, impacts };
}

for (const def of TRACKS) {
  if (onlyTrack && def.id !== onlyTrack) continue;
  const t0 = Date.now();
  const track = buildTrack(def);
  console.log(`\n== ${def.short}: N=${track.N} ds=${track.ds.toFixed(2)} len=${track.length.toFixed(0)}m crossings=${track.crossings.length} build=${Date.now() - t0}ms`);
  for (const c of track.crossings) console.log(`   crossing lo=${c.lo} hi=${c.hi} dy=${(track.py[c.hi] - track.py[c.lo]).toFixed(1)}m`);
  for (const spec of CARS) {
    if (onlyCar && spec.id !== onlyCar) continue;
    const r = runSolo(track, spec);
    const ok = r.times.length === 2;
    if (!ok) failures++;
    console.log(`  ${spec.id.padEnd(6)} lap=${ok ? formatTime(r.times[1]) : 'DNF'} vmax=${(r.vmax * 3.6).toFixed(0)}km/h wallHits=${r.hits} maxOff=${r.maxOff.toFixed(1)}m off%=${r.offPct.toFixed(1)}`);
  }
  if (!onlyCar) {
    const rr = runRace(track);
    console.log(`  ${CARS.length}-car race: ${rr.t.toFixed(0)}s laps=${rr.lapsDone.join(',')} contacts=${rr.impacts}`);
    if (rr.lapsDone.some((l) => l < 2)) failures++;
  }
}
console.log(failures ? `\nFAILURES: ${failures}` : '\nall ok');
process.exit(failures ? 1 : 0);
