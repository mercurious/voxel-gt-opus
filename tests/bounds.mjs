// Containment regression for the street courses: cars must stay inside the
// barrier lines the scene draws (track.barriers, which sim.js collides with)
// whatever the player does at the hard corners and escape roads.
//
// Geometry: the barrier lines are two closed, simple polylines that never cross
// each other or the road between the painted edges, with no saw-tooth (no
// step or notch jutting > 5 cm into the road; real kerb corners have straight
// runs either side); every escape road is spliced in, drivable, and closed by
// its end wall.
// Driving: for each corner (curvature peaks, the named corners, escape-road
// mouths) a car is launched at the entry at 60-200 km/h with lateral offsets
// and heading errors, then driven like a player who gets it wrong:
// understeering straight on, turning in early and clipping the inside, turning
// in late, spinning, steering into the outside wall, aiming down the escape
// road, being shoved into the outside wall by a car alongside. After the hit
// it either holds the throttle against the wall, steers away, reverses and
// drives off, or scrubs along the wall sawing at the wheel and then reverses
// at full lock. Every step the rendered car bodies (corners, side and end
// midpoints) must be inside the barrier lines and no barrier corner may poke
// into them.
// Usage: node tests/bounds.mjs [trackId] [-v] [--trace=<track>#<run>]
//   -v       list every corner and the first failing runs
//   --trace  dump one run's body outlines to tests/out/bounds-trace.json
import fs from 'node:fs';
import { CARS } from '../src/cars.js';
import { TRACKS } from '../src/tracks.js';
import { buildTrack, notchAt, NOTCH_SPAN } from '../src/trackCore.js';
import { RaceCar, stepCar, collideCars } from '../src/sim.js';
import { decodeCity } from '../src/city/cityData.js';
import { courseGround } from '../src/city/ground.js';

const DT = 1 / 120;
const TOL = 0.1; // m a body point may sit past a barrier line
const args = process.argv.slice(2);
const verbose = args.includes('-v');
const trace = (args.find((a) => a.startsWith('--trace=')) || '').slice(8);
const only = args.find((a) => !a.startsWith('-'));
const CITY_IDS = ['nyc', 'tokyo', 'madrid'];
const RUN_CARS = ['f40', 'gtr34', 'mazda3t', 'jcw53'].map((id) => CARS.find((c) => c.id === id));
const SPEEDS = [60, 100, 140, 200]; // km/h
const HEAD_ERR = [-12, 0, 12]; // degrees
const T_RUN = 6;

// ---- barrier geometry index -------------------------------------------------------
// z-row buckets for even-odd point-in-region, a grid of segments for queries
function indexBarriers(B) {
  const rows = new Map(), grid = new Map(), C = 4;
  const key = (a, b) => (a + 32768) * 65536 + (b + 32768);
  const add = (m, k, v) => { let b = m.get(k); if (!b) m.set(k, (b = [])); b.push(v); };
  for (let s = 0; s < B.n; s++) {
    for (let r = Math.floor(Math.min(B.az[s], B.bz[s])); r <= Math.floor(Math.max(B.az[s], B.bz[s])); r++) add(rows, r, s);
    for (let a = Math.floor(Math.min(B.ax[s], B.bx[s]) / C); a <= Math.floor(Math.max(B.ax[s], B.bx[s]) / C); a++) {
      for (let b = Math.floor(Math.min(B.az[s], B.bz[s]) / C); b <= Math.floor(Math.max(B.az[s], B.bz[s]) / C); b++) add(grid, key(a, b), s);
    }
  }
  const inside = (x, z) => {
    let c = false;
    for (const s of rows.get(Math.floor(z)) || []) {
      const ax = B.ax[s], az = B.az[s], bx = B.bx[s], bz = B.bz[s];
      if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) c = !c;
    }
    return c;
  };
  const stamp = new Uint32Array(B.n);
  let qid = 0;
  const near = (x, z, r, fn) => {
    qid++;
    for (let a = Math.floor((x - r) / C); a <= Math.floor((x + r) / C); a++) {
      for (let b = Math.floor((z - r) / C); b <= Math.floor((z + r) / C); b++) {
        for (const s of grid.get(key(a, b)) || []) if (stamp[s] !== qid) { stamp[s] = qid; fn(s); }
      }
    }
  };
  const dist = (x, z, r = 3) => {
    let best = r;
    near(x, z, r, (s) => {
      const vx = B.bx[s] - B.ax[s], vz = B.bz[s] - B.az[s];
      const t = Math.max(0, Math.min(1, ((x - B.ax[s]) * vx + (z - B.az[s]) * vz) / (vx * vx + vz * vz || 1)));
      best = Math.min(best, Math.hypot(x - B.ax[s] - vx * t, z - B.az[s] - vz * t));
    });
    return best;
  };
  return { inside, near, dist };
}

const cross = (ax, az, bx, bz, cx, cz, dx, dz) => {
  const r1 = bx - ax, r2 = bz - az, s1 = dx - cx, s2 = dz - cz, den = r1 * s2 - r2 * s1;
  if (Math.abs(den) < 1e-12) return false;
  const t = ((cx - ax) * s2 - (cz - az) * s1) / den, u = ((cx - ax) * r2 - (cz - az) * r1) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
};

// Static checks of the barrier lines; returns a list of problems.
function checkGeometry(track, gi) {
  const B = track.barriers, { N, px, pz, nx, nz, hw, def } = track;
  const bad = [];
  // simple and disjoint: no two segments cross except neighbours sharing a vertex
  const loopOf = new Int32Array(B.n), start = [];
  let s0 = 0;
  B.loops.forEach((l, k) => { start.push(s0); for (let q = 0; q < l.src.length; q++) loopOf[s0 + q] = k; s0 += l.src.length; });
  let crossings = 0;
  for (let s = 0; s < B.n; s++) {
    const l = loopOf[s], m = B.loops[l].src.length, q = s - start[l];
    const prev = start[l] + ((q - 1 + m) % m), next = start[l] + ((q + 1) % m);
    gi.near((B.ax[s] + B.bx[s]) / 2, (B.az[s] + B.bz[s]) / 2, B.len[s] / 2 + 0.1, (o) => {
      if (o <= s || o === prev || o === next) return;
      if (cross(B.ax[s], B.az[s], B.bx[s], B.bz[s], B.ax[o], B.az[o], B.bx[o], B.bz[o])) {
        crossings++;
        if (crossings <= 3) bad.push(`barrier segments ${s} and ${o} cross at (${B.ax[s].toFixed(1)}, ${B.az[s].toFixed(1)})`);
      }
    });
  }
  // no saw-tooth a car sliding along the wall could catch on
  let notches = 0;
  for (const l of B.loops) {
    const m = l.src.length, P = [];
    for (let k = 0; k < m; k++) P.push({ x: l.pts[k * 2], z: l.pts[k * 2 + 1] });
    for (let k = 0; k < m; k++) {
      if (l.kind[k] === 2 || l.kind[(k - 1 + m) % m] === 2) continue; // the square ends of escape roads
      const d = notchAt(P, k, l.side);
      if (d > 0.05 && ++notches <= 5) bad.push(`barrier notch ${d.toFixed(2)} m deep within ${NOTCH_SPAN} m at (${P[k].x.toFixed(1)}, ${P[k].z.toFixed(1)})`);
    }
  }
  // the road between the painted edges (less 1 m) is inside and clear of barriers
  for (let i = 0; i < N; i++) {
    const w = hw[i] - 1;
    const ax = px[i] + nx[i] * w, az = pz[i] + nz[i] * w, bx = px[i] - nx[i] * w, bz = pz[i] - nz[i] * w;
    if (!gi.inside(px[i], pz[i])) { bad.push(`course sample ${i} is outside the barriers`); continue; }
    let hit = -1;
    gi.near(px[i], pz[i], w + 0.1, (s) => { if (hit < 0 && cross(ax, az, bx, bz, B.ax[s], B.az[s], B.bx[s], B.bz[s])) hit = s; });
    if (hit >= 0) bad.push(`barrier segment ${hit} crosses the road at sample ${i}`);
  }
  // escape roads: all spliced in, drivable to the far end and closed there by a tyre wall
  if (track.escapes.length !== (def.escapes || []).length) bad.push(`${(def.escapes || []).length - track.escapes.length} escape roads dropped`);
  for (const e of track.escapes) {
    let walls = 0;
    gi.near(e.x + e.dx * e.len, e.z + e.dz * e.len, e.hw + 1, (s) => {
      if (B.kind[s] !== 2) return;
      walls++;
      const mx = (B.ax[s] + B.bx[s]) / 2, mz = (B.az[s] + B.bz[s]) / 2;
      if (!gi.inside(mx + B.nx[s], mz + B.nz[s])) bad.push(`escape road at (${e.x}, ${e.z}) is not drivable up to its end wall`);
      if (gi.inside(mx - B.nx[s] * 0.5, mz - B.nz[s] * 0.5)) bad.push(`escape road at (${e.x}, ${e.z}) is open behind its end wall`);
    });
    if (!walls) bad.push(`escape road at (${e.x}, ${e.z}) has no end wall`);
  }
  return bad;
}

// ---- corners ------------------------------------------------------------------------
function findCorners(track) {
  const { N, ds, curv, def } = track;
  const out = [];
  const cdist = (a, b) => Math.min(Math.abs(a - b), N - Math.abs(a - b));
  const nameAt = (i) => {
    let best = null, bd = 30;
    for (const [u, name] of def.corners || []) {
      const d = cdist(Math.round(u * N), i);
      if (d < bd) { bd = d; best = name; }
    }
    return best;
  };
  const add = (i, why) => {
    if (out.some((c) => cdist(c.i, i) < 12)) return null;
    const c = { i, why, dir: Math.sign(curv[i]) || 1, name: nameAt(i) || `s${Math.round(i * ds)}` };
    out.push(c);
    return c;
  };
  // curvature peaks (sharper than a 50 m radius)
  for (let i = 0; i < N; i++) {
    const k = Math.abs(curv[i]);
    if (k < 0.02) continue;
    let peak = true;
    for (let q = -6; q <= 6 && peak; q++) if (Math.abs(curv[(i + q + N) % N]) > k) peak = false;
    if (peak) add(i, 'curv');
  }
  const sharpest = (i0, r) => {
    let bi = i0, bk = 0;
    for (let q = -r; q <= r; q++) { const j = (i0 + q + N) % N; if (Math.abs(curv[j]) > bk) { bk = Math.abs(curv[j]); bi = j; } }
    return bi;
  };
  // named corners: the sharpest sample near the marker
  for (const [u] of def.corners || []) add(sharpest(Math.round(u * N) % N, 15), 'named');
  // escape roads: the corner at the mouth
  for (const e of track.escapes) {
    const bi = sharpest(track.locate(e.x, e.z).i, 10);
    const c = out.find((o) => cdist(o.i, bi) < 12) || add(bi, 'escape');
    (c.esc ||= []).push(e);
  }
  return out.sort((a, b) => a.i - b.i);
}

// ---- driving --------------------------------------------------------------------------
function setSpeed(veh, v) {
  veh.vx = v;
  const n = veh.spec.gears.length;
  veh.gear = n;
  for (let g = 1; g <= n; g++) if (veh.wheelRpm(g) < veh.spec.redline * 0.9) { veh.gear = g; break; }
  veh.rpm = Math.max(veh.spec.idle, veh.wheelRpm());
}

// steer (-1..1, + = left) that turns the car toward heading h
const steerTo = (veh, h) => Math.max(-1, Math.min(1, Math.atan2(Math.sin(h - veh.h), Math.cos(h - veh.h)) * 3));

const BEHAVIOURS = ['understeer', 'early', 'late', 'spin', 'outward', 'escape', 'squeeze'];

// Player input for this step. st.tHit = time of the first wall contact.
function drive(beh, post, st, rc, t, c, track) {
  const veh = rc.veh, inp = rc.input, dir = c.dir;
  const loc = rc.loc;
  const trackH = Math.atan2(loc.tx, loc.tz);
  inp.handbrake = false;
  if (st.tHit == null && (rc.impact > 1.5 || (rc.wallScrape > 0.5 && t > 0.2))) st.tHit = t;
  if (st.tHit == null && t > 3) st.tHit = t;
  const th = st.tHit;
  if (th != null && beh !== 'spin') {
    const u = t - th;
    if (post === 0) {
      // hold it against the wall, steer away, reverse out, drive on
      if (u < 0.8) { inp.throttle = 1; inp.brake = 0; return; }
      if (u < 2.0) { inp.throttle = 1; inp.brake = 0; inp.steer = steerTo(veh, trackH); return; }
      if (u < 3.4) { inp.throttle = 0; inp.brake = 1; inp.steer = -steerTo(veh, trackH); return; } // auto box reverses
      inp.throttle = 1; inp.brake = 0; inp.steer = steerTo(veh, trackH);
    } else {
      // scrub along the wall sawing at the wheel, then reverse at full lock
      if (u < 2.4) { inp.throttle = 1; inp.brake = 0; inp.steer = Math.floor(u / 0.4) % 2 ? 1 : -1; return; }
      if (u < 4.4) { inp.throttle = 0; inp.brake = 1; inp.steer = dir; return; }
      inp.throttle = 1; inp.brake = 0; inp.steer = -dir;
    }
    return;
  }
  switch (beh) {
    case 'understeer': case 'squeeze': inp.throttle = 1; inp.brake = 0; inp.steer = 0; break;
    case 'early': inp.throttle = 0.7; inp.brake = 0; inp.steer = dir; break;
    case 'late': {
      let ahead = c.i * track.ds - loc.s;
      if (ahead < -track.length / 2) ahead += track.length;
      inp.throttle = 0.8; inp.brake = 0; inp.steer = ahead < 6 ? dir : 0;
      break;
    }
    case 'spin': {
      inp.throttle = 1; inp.brake = 0;
      if (t < 0.25) inp.steer = 0;
      else if (t < 1.4) { inp.steer = dir; inp.handbrake = true; }
      else if (t < 2.6) inp.steer = post ? dir : -dir;
      else if (t < 3.8) { inp.throttle = 0; inp.brake = 1; inp.steer = dir; }
      else inp.steer = steerTo(veh, trackH);
      break;
    }
    case 'outward': inp.throttle = 1; inp.brake = 0; inp.steer = -dir * 0.5; break;
    case 'escape': inp.throttle = 1; inp.brake = 0; inp.steer = steerTo(veh, st.aim); break;
  }
}

// the rendered car body (game.render: wheelbase centre +- overhangs), from the CG
function bodyFrame(rc) {
  const v = rc.veh, M = rc.spec.model;
  const front = v.a - v.L / 2 + M.wheelbase / 2 + M.frontOverhang;
  return { front, rear: M.length - front, hw: M.width / 2 };
}

function bodyOutline(rc, bf) {
  const v = rc.veh, fx = Math.sin(v.h), fz = Math.cos(v.h), lx = fz, lz = -fx;
  return [[bf.front, bf.hw], [bf.front, -bf.hw], [-bf.rear, -bf.hw], [-bf.rear, bf.hw]].map(([f, l]) => [v.x + fx * f + lx * l, v.z + fz * f + lz * l]);
}

const POINTS = (bf) => {
  const mid = (bf.front - bf.rear) / 2;
  return [[bf.front, bf.hw, 'FL'], [bf.front, -bf.hw, 'FR'], [-bf.rear, bf.hw, 'RL'], [-bf.rear, -bf.hw, 'RR'],
    [mid, bf.hw, 'L'], [mid, -bf.hw, 'R'], [bf.front, 0, 'F'], [-bf.rear, 0, 'B']];
};

// worst violation this step, or null
function checkBody(rc, bf, gi, B) {
  const v = rc.veh, fx = Math.sin(v.h), fz = Math.cos(v.h), lx = fz, lz = -fx;
  if (!gi.inside(v.x, v.z)) return { depth: 99, what: 'car centre outside the barriers' };
  let worst = null;
  for (const [f, l, name] of bf.points) {
    const x = v.x + fx * f + lx * l, z = v.z + fz * f + lz * l;
    if (gi.inside(x, z)) continue;
    const d = gi.dist(x, z);
    if (d > TOL && (!worst || d > worst.depth)) worst = { depth: d, what: `${name} ${d >= 3 ? '>3' : d.toFixed(2)} m outside the barriers` };
  }
  // barrier corners poking into the body
  const mid = (bf.front - bf.rear) / 2, hl = (bf.front + bf.rear) / 2;
  const cx = v.x + fx * mid, cz = v.z + fz * mid;
  gi.near(cx, cz, hl + 1, (s) => {
    const rx = B.ax[s] - cx, rz = B.az[s] - cz;
    const d = Math.min(hl - Math.abs(rx * fx + rz * fz), bf.hw - Math.abs(rx * lx + rz * lz));
    if (d > TOL && (!worst || d > worst.depth)) worst = { depth: d, what: `barrier corner ${d.toFixed(2)} m into the body` };
  });
  return worst;
}

function runOne(track, gi, c, e, beh, post, spec, kmh, off, herr, tr) {
  const rc = new RaceCar(spec, track, { isPlayer: true });
  const settings = beh === 'spin' ? { auto: true, tcs: false, asm: false } : { auto: true, tcs: true, asm: true };
  const st = { tHit: null };
  const back = Math.max(25, Math.min(60, (kmh / 3.6) * 0.9));
  if (beh === 'escape') {
    // straight down the approach street at the escape road, across its width
    const b = 30 + (kmh / 3.6) * 0.4;
    const x = e.x - e.dx * b + e.nx * off, z = e.z - e.dz * b + e.nz * off;
    st.aim = Math.atan2(e.dx, e.dz) + (herr * Math.PI) / 180;
    rc.veh.reset(x, z, st.aim, 0);
    rc.loc = track.locate(x, z);
    rc.hint = rc.loc.i;
  } else {
    rc.placeAt(c.i * track.ds - back, off);
    rc.veh.h += (herr * Math.PI) / 180;
  }
  const cars = [rc];
  if (beh === 'squeeze') {
    // a car alongside on the inside runs wide and shoves this one into the outside barrier
    const o = new RaceCar(RUN_CARS[(RUN_CARS.indexOf(spec) + 1) % RUN_CARS.length], track);
    o.placeAt(c.i * track.ds - back, off + c.dir * 2.6);
    o.veh.h += (herr * Math.PI) / 180;
    cars.push(o);
  }
  for (const car of cars) {
    car.veh.y = car.loc.y;
    setSpeed(car.veh, kmh / 3.6);
    car.bf = bodyFrame(car);
    car.bf.points = POINTS(car.bf);
    if (checkBody(car, car.bf, gi, track.barriers)) return null; // starting pose not clear of the barriers: skip
  }
  let lastI = rc.loc.i, maxJump = 0, fail = null, maxDepth = 0;
  for (let t = 0; t < T_RUN; t += DT) {
    drive(beh, post, st, rc, t, c, track);
    if (cars[1]) Object.assign(cars[1].input, { throttle: 1, brake: 0, steer: -c.dir * 0.25 });
    for (const car of cars) { car.impact = 0; stepCar(car, DT, settings); }
    if (cars[1]) collideCars(cars);
    let j = Math.abs(rc.loc.i - lastI);
    j = Math.min(j, track.N - j);
    maxJump = Math.max(maxJump, j);
    lastI = rc.loc.i;
    let bad = null;
    for (const car of cars) {
      const b = checkBody(car, car.bf, gi, track.barriers);
      if (b && (!bad || b.depth > bad.depth)) bad = { ...b, what: car === rc ? b.what : `pushing car: ${b.what}` };
    }
    if (tr) tr.push({ o: bodyOutline(rc, rc.bf), bad: bad ? bad.what : null, i: rc.loc.i, d: +rc.loc.d.toFixed(2) });
    if (bad) {
      maxDepth = Math.max(maxDepth, bad.depth);
      if (!fail) fail = { t, ...bad, phase: st.tHit == null ? 'approach' : `${(t - st.tHit).toFixed(1)} s after the hit`, i: rc.loc.i, d: rc.loc.d };
    }
    if (!Number.isFinite(rc.veh.x)) { fail = { t, depth: 99, what: 'NaN', phase: '' }; break; }
  }
  return { fail, maxJump, maxDepth };
}

// ---- fuzz: a player mashing the controls anywhere --------------------------------------
// Starts every FUZZ_STEP m around the whole lap (random offset, a quarter of
// them facing the wrong way) and inside every escape road (driven to its end
// wall, reversed out, spun), then FUZZ_T s of random episodes: throttle with
// random steering, long full-lock donuts (some on the handbrake), braking into
// reverse at full lock, coasting; aids on or off. Every step: the body inside
// the barrier lines (2D), and the car on the ground the scene draws there.
const FUZZ_STEP = 30, FUZZ_T = 20, GROUND_TOL = 0.3;
function rand(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function fuzz(track, gi, ground, cityIdx) {
  const starts = [];
  for (let s = 0; s < track.length; s += FUZZ_STEP) starts.push({ s });
  track.escapes.forEach((e, k) => { for (let q = 0; q < 4; q++) starts.push({ e, k, q }); });
  const fails = [];
  starts.forEach((st, run) => {
    const R = rand(cityIdx * 100003 + run * 7919 + 17);
    const spec = CARS[run % CARS.length];
    const rc = new RaceCar(spec, track, { isPlayer: true });
    const bf = bodyFrame(rc);
    bf.points = POINTS(bf);
    let desc, script = null;
    if (st.e) {
      // from the mouth down the escape road (or back up it from the end wall)
      const e = st.e, al = st.q < 2 ? 4 : e.len - 5, la = (R() * 2 - 1) * (e.hw - 1.6);
      const x = e.x + e.dx * al + e.nx * la, z = e.z + e.dz * al + e.nz * la;
      const h = Math.atan2(e.dx, e.dz) + (st.q < 2 ? 0 : Math.PI) + (R() - 0.5) * 0.4;
      rc.veh.reset(x, z, h, 0);
      rc.loc = track.locate(x, z);
      rc.hint = rc.loc.i;
      rc.veh.y = rc.loc.y;
      script = st.q % 2 === 0 ? [['drive', 4, 0], ['reverse', 3, 1], ['donut', 4, 1], ['drive', 3, -1]] : [['drive', 2, 0], ['donut', 5, -1], ['reverse', 3, -1]];
      desc = `escape road ${st.k} at along ${al.toFixed(0)}`;
    } else {
      const i = Math.floor(st.s / track.ds) % track.N;
      const w = Math.max(0, Math.min(track.wallL[i], track.wallR[i]) - 2);
      rc.placeAt(st.s, (R() * 2 - 1) * w);
      if (R() < 0.25) rc.veh.h += Math.PI; else rc.veh.h += (R() - 0.5) * 0.6;
      setSpeed(rc.veh, R() * 30);
      desc = `s=${st.s} m`;
    }
    if (checkBody(rc, bf, gi, track.barriers)) return; // starting pose not clear: skip
    const settings = { auto: true, tcs: R() < 0.6, asm: R() < 0.6 };
    let mode = 'coast', until = 0, steer = 0, fail = null;
    for (let t = 0; t < FUZZ_T; t += DT) {
      if (t >= until) {
        if (script && script.length) { const [m, d, sgn] = script.shift(); mode = m; until = t + d; steer = sgn; }
        else {
          const p = R();
          mode = p < 0.35 ? 'drive' : p < 0.55 ? 'donut' : p < 0.75 ? 'reverse' : p < 0.9 ? 'brake' : 'coast';
          until = t + (mode === 'donut' ? 3 + R() * 4 : 0.5 + R() * 3);
          steer = mode === 'donut' || mode === 'reverse' ? (R() < 0.5 ? -1 : 1) : R() * 2 - 1;
        }
      }
      const inp = rc.input;
      inp.handbrake = mode === 'donut' && (run & 1) === 1;
      inp.throttle = mode === 'drive' || mode === 'donut' ? 1 : 0;
      inp.brake = mode === 'reverse' || mode === 'brake' ? 1 : 0;
      inp.steer = steer;
      stepCar(rc, DT, settings);
      let bad = checkBody(rc, bf, gi, track.barriers);
      // the surface drawn under the car: the course road (out to the barrier
      // line, track.roadL/roadR) at the course height, else the ground
      const l = rc.loc, onRoad = l.d <= track.roadL[l.i] + 0.6 && -l.d <= track.roadR[l.i] + 0.6;
      const gy = onRoad ? l.y : ground.groundY(rc.veh.x, rc.veh.z);
      if (!bad && Math.abs(gy - rc.veh.y) > GROUND_TOL) bad = { what: `car ${Math.abs(gy - rc.veh.y).toFixed(1)} m ${rc.veh.y > gy ? 'above' : 'below'} the ground under it` };
      if (bad) { fail = { t, ...bad, x: rc.veh.x, z: rc.veh.z, mode }; break; }
    }
    if (fail) fails.push({ run, desc, car: spec.id, ...fail });
  });
  return { runs: starts.length, fails };
}

// ---- main ---------------------------------------------------------------------------------
let totalFails = 0;
const t0 = Date.now();
for (const id of CITY_IDS) {
  if (only && id !== only) continue;
  const def = TRACKS.find((d) => d.id === id);
  const track = buildTrack(def);
  const gi = indexBarriers(track.barriers);
  const geo = trace ? [] : checkGeometry(track, gi);
  const corners = findCorners(track);
  let runs = 0, fails = 0, through = 0, maxJumpAll = 0, n = 0;
  const byCorner = [];
  for (const c of corners) {
    const rec = { c, runs: 0, fails: 0, worst: null, jump: 0, list: [] };
    const minW = Math.min(track.wallL[c.i], track.wallR[c.i]);
    const cases = [];
    for (const beh of BEHAVIOURS) {
      if (beh === 'escape') {
        for (const e of c.esc || []) for (const off of [-e.hw + 1.4, 0, e.hw - 1.4]) cases.push([beh, e, off]);
      } else if (beh === 'squeeze') cases.push([beh, null, -c.dir * 0.3 * Math.max(0, minW - 2)]);
      else for (const f of [-0.55, 0, 0.55]) cases.push([beh, null, f * Math.max(0, minW - 2)]);
    }
    for (const [beh, e, off] of cases) for (const kmh of SPEEDS) for (const herr of HEAD_ERR) for (const post of [0, 1]) {
      const spec = RUN_CARS[n % RUN_CARS.length];
      const runId = n++;
      if (trace && trace !== `${id}#${runId}`) continue;
      const tr = trace ? [] : null;
      const r = runOne(track, gi, c, e, beh, post, spec, kmh, off, herr, tr);
      if (tr) {
        fs.mkdirSync('tests/out', { recursive: true });
        fs.writeFileSync('tests/out/bounds-trace.json', JSON.stringify(tr));
        console.log(`trace ${id}#${runId}: ${tr.length} steps -> tests/out/bounds-trace.json, ${r && r.fail ? r.fail.what : 'contained'}`);
      }
      if (!r) continue;
      runs++; rec.runs++;
      rec.jump = Math.max(rec.jump, r.maxJump);
      if (!r.fail) continue;
      fails++; rec.fails++;
      if (r.maxDepth > 0.62) through++; // past the back of the concrete block
      const f = { runId, beh, post, kmh, off: +off.toFixed(1), herr, car: spec.id, jump: r.maxJump, ...r.fail, maxDepth: r.maxDepth };
      rec.list.push(f);
      if (!rec.worst || r.maxDepth > rec.worst.maxDepth) rec.worst = f;
    }
    maxJumpAll = Math.max(maxJumpAll, rec.jump);
    byCorner.push(rec);
  }
  if (trace) continue;
  const fz = fuzz(track, gi, courseGround(track, decodeCity(def.city).demAt), CITY_IDS.indexOf(id));
  totalFails += fails + geo.length + fz.fails.length;
  console.log(`\n== ${def.short}: ${track.barriers.n} barrier segments, ${track.escapes.length} escape roads, ${corners.length} corners, ${runs} runs: ${fails} out of bounds (${through} through the barrier), max locate jump ${maxJumpAll} samples; fuzz ${fz.runs} runs x ${FUZZ_T} s: ${fz.fails.length} failed`);
  for (const g of geo) console.log(`  GEOMETRY ${g}`);
  for (const f of fz.fails.slice(0, verbose ? 50 : 8)) console.log(`  FUZZ #${f.run} from ${f.desc}, ${f.car}: ${f.what} at t=${f.t.toFixed(2)} s (${f.mode}) at (${f.x.toFixed(1)}, ${f.z.toFixed(1)})`);
  if (fz.fails.length > (verbose ? 50 : 8)) console.log(`  ... ${fz.fails.length - (verbose ? 50 : 8)} more fuzz failures`);
  for (const r of byCorner) {
    const c = r.c;
    const tag = `${c.name} (i=${c.i}, ${c.why}${c.esc ? ', escape road' : ''}, k=${track.curv[c.i].toFixed(3)})`;
    if (!r.fails) { if (verbose) console.log(`  ok   ${tag}: ${r.runs} runs, locate jump ${r.jump}`); continue; }
    const behs = [...new Set(r.list.map((f) => f.beh))].join(',');
    const sp = [...new Set(r.list.map((f) => f.kmh))].sort((a, b) => a - b).join('/');
    const fmt = (f) => `#${f.runId} ${f.beh}/${f.post} ${f.kmh} km/h off=${f.off} herr=${f.herr} ${f.car}: ${f.what} at t=${f.t.toFixed(2)} s (${f.phase}), loc i=${f.i} d=${f.d?.toFixed(1)}, max ${f.maxDepth >= 99 ? 'centre out' : f.maxDepth.toFixed(2) + ' m'}, locate jump ${f.jump}`;
    console.log(`  FAIL ${tag}: ${r.fails}/${r.runs} runs [${behs}] at ${sp} km/h\n       worst ${fmt(r.worst)}`);
    if (verbose) for (const f of r.list.slice(0, 10)) console.log(`       ${fmt(f)}`);
  }
}
if (!trace) console.log(`\n${totalFails ? `FAILURES: ${totalFails}` : 'all contained'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(totalFails ? 1 : 0);
