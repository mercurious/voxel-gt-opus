// Track geometry that both the simulation and renderer use. No three.js here,
// so it runs headless in tests.
import { clamp, lerp, smoothstep, wrapAngle, periodicCurve } from './util.js';
import { G, TIRE_MU, FRONT_MU } from './physics.js';

export const SURF_ID = { asphalt: 0, grass: 1, gravel: 2, runoff: 3 };

function catmullUniformClosed(xs, zs, sub) {
  const n = xs.length, ox = [], oz = [];
  for (let i = 0; i < n; i++) {
    const i0 = (i - 1 + n) % n, i2 = (i + 1) % n, i3 = (i + 2) % n;
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      const f = (p0, p1, p2, p3) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
      ox.push(f(xs[i0], xs[i], xs[i2], xs[i3]));
      oz.push(f(zs[i0], zs[i], zs[i2], zs[i3]));
    }
  }
  return [ox, oz];
}

function resampleClosed(xs, zs, step) {
  const n = xs.length;
  const cum = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) cum[i] = cum[i - 1] + Math.hypot(xs[i % n] - xs[i - 1], zs[i % n] - zs[i - 1]);
  const L = cum[n];
  const N = Math.round(L / step);
  const ds = L / N;
  const px = new Float32Array(N), pz = new Float32Array(N);
  let j = 0;
  for (let k = 0; k < N; k++) {
    const s = k * ds;
    while (cum[j + 1] < s) j++;
    const t = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    px[k] = lerp(xs[j], xs[(j + 1) % n], t);
    pz[k] = lerp(zs[j], zs[(j + 1) % n], t);
  }
  return { px, pz, N, ds, L };
}

// circular moving average
function smoothArr(a, rad, passes = 1) {
  const N = a.length;
  let cur = Float32Array.from(a);
  for (let p = 0; p < passes; p++) {
    const out = new Float32Array(N);
    let acc = 0;
    for (let k = -rad; k <= rad; k++) acc += cur[(k + N) % N];
    for (let i = 0; i < N; i++) {
      out[i] = acc / (2 * rad + 1);
      acc += cur[(i + rad + 1) % N] - cur[(i - rad + N) % N];
    }
    cur = out;
  }
  return cur;
}

function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const r1 = bx - ax, r2 = bz - az, s1 = dx - cx, s2 = dz - cz;
  const den = r1 * s2 - r2 * s1;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * s2 - (cz - az) * s1) / den;
  const u = ((cx - ax) * r2 - (cz - az) * r1) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}

class Grid {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  add(x, z, v) {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let b = this.map.get(k);
    if (!b) this.map.set(k, (b = []));
    b.push(v);
  }
  query(x, z, r, fn) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const b = this.map.get(this.key(cx, cz));
      if (b) for (const v of b) fn(v);
    }
  }
}

export function buildTrack(def) {
  const raw = def.points;
  const rx = [], rz = [];
  for (let i = 0; i < raw.length; i += 2) { rx.push(raw[i]); rz.push(raw[i + 1]); }
  const [dx, dz] = catmullUniformClosed(rx, rz, 8);
  const { px, pz, N, ds, L } = resampleClosed(dx, dz, def.step || 2);

  // tangents / normals / heading
  const tx = new Float32Array(N), tz = new Float32Array(N), nx = new Float32Array(N), nz = new Float32Array(N);
  const head = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    let x = px[b] - px[a], z = pz[b] - pz[a];
    const l = Math.hypot(x, z) || 1;
    x /= l; z /= l;
    tx[i] = x; tz[i] = z;
    nx[i] = z; nz[i] = -x; // left normal
    head[i] = Math.atan2(x, z);
  }
  // signed curvature (+ = left turn)
  const curvRaw = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 2 + N) % N, b = (i + 2) % N;
    curvRaw[i] = wrapAngle(head[b] - head[a]) / (4 * ds);
  }
  const curv = smoothArr(curvRaw, 3, 2);

  // ---- elevation ----------------------------------------------------------
  const elev = periodicCurve(def.elevation || [[0, 0], [0.5, 0]]);
  let py = new Float32Array(N);
  for (let i = 0; i < N; i++) py[i] = elev(i / N);
  py = smoothArr(py, 10, 2);

  // self-crossings (Suzuka): later pass goes over the earlier one
  const crossings = [];
  {
    const grid = new Grid(24);
    for (let i = 0; i < N; i++) grid.add(px[i], pz[i], i);
    for (let i = 0; i < N; i++) {
      const i2 = (i + 1) % N;
      grid.query(px[i], pz[i], 6, (j) => {
        if (j <= i + 40) return;
        if (i < 40 && j > N - 40 + i) return;
        const j2 = (j + 1) % N;
        const t = segIntersect(px[i], pz[i], px[i2], pz[i2], px[j], pz[j], px[j2], pz[j2]);
        if (t != null && !crossings.some((c) => Math.abs(c.lo - i) < 30)) crossings.push({ lo: i, hi: j });
      });
    }
  }
  const clearance = def.bridgeClearance || 7.5;
  for (const c of crossings) {
    const need = clearance - (py[c.hi] - py[c.lo]);
    if (need > 0) {
      const sig = 70 / ds; // ~70 m ramp
      for (let k = -Math.ceil(sig * 3); k <= Math.ceil(sig * 3); k++) {
        const i = (c.hi + k + N) % N;
        py[i] += need * Math.exp(-(k * k) / (2 * sig * sig));
      }
    }
    c.x = px[c.lo]; c.z = pz[c.lo];
  }
  const slope = new Float32Array(N);
  for (let i = 0; i < N; i++) slope[i] = (py[(i + 1) % N] - py[(i - 1 + N) % N]) / (2 * ds);

  // ---- widths, kerbs, run-off, walls --------------------------------------
  const halfW = def.width / 2;
  const absK = new Float32Array(N);
  for (let i = 0; i < N; i++) absK[i] = Math.abs(curv[i]);
  const cornerF = new Float32Array(N); // 0 straight .. 1 tight corner
  for (let i = 0; i < N; i++) cornerF[i] = smoothstep(0.003, 0.02, absK[i]);
  const kerb = new Uint8Array(N); // bit0 left, bit1 right
  const runL = new Float32Array(N), runR = new Float32Array(N);
  const surfL = new Uint8Array(N), surfR = new Uint8Array(N);
  const reach = Math.round(36 / ds), back = Math.round(14 / ds);
  for (let i = 0; i < N; i++) {
    // outside-of-corner run-off extends past the exit, where cars run wide
    let outL = 0, outR = 0, inL = 0, inR = 0;
    for (let k = -back; k <= reach; k++) {
      const j = (i - k + N) % N; // corner at j upstream (k>0) of i
      const f = cornerF[j] * (k > 0 ? 1 - k / (reach + 1) : 1);
      if (curv[j] > 0) { outR = Math.max(outR, f); inL = Math.max(inL, f); }
      else { outL = Math.max(outL, f); inR = Math.max(inR, f); }
    }
    runL[i] = def.verge + def.runoff * outL + 3 * inL;
    runR[i] = def.verge + def.runoff * outR + 3 * inR;
    const kf = absK[i] > 0.006;
    surfL[i] = outL > 0.3 ? SURF_ID[def.runoffSurface || 'gravel'] : SURF_ID.grass;
    surfR[i] = outR > 0.3 ? SURF_ID[def.runoffSurface || 'gravel'] : SURF_ID.grass;
    if (kf) kerb[i] = 3;
  }
  // grow kerbs a little along the track
  const kerb2 = new Uint8Array(N);
  const kgrow = Math.round(8 / ds);
  for (let i = 0; i < N; i++) if (kerb[i]) for (let k = -kgrow; k <= kgrow; k++) kerb2[(i + k + N) % N] = 3;

  // keep walls clear of other parts of the circuit (ignore over/under passes)
  const ptGrid = new Grid(30);
  for (let i = 0; i < N; i++) ptGrid.add(px[i], pz[i], i);
  const limL = new Float32Array(N).fill(1e9), limR = new Float32Array(N).fill(1e9);
  const sepIdx = Math.round(150 / ds);
  for (let i = 0; i < N; i++) {
    ptGrid.query(px[i], pz[i], 90, (j) => {
      let di = Math.abs(i - j);
      di = Math.min(di, N - di);
      if (di < sepIdx) return;
      if (Math.abs(py[i] - py[j]) > 4) return;
      const ddx = px[j] - px[i], ddz = pz[j] - pz[i];
      const dist = Math.hypot(ddx, ddz);
      const side = ddx * nx[i] + ddz * nz[i];
      const lim = Math.max(halfW + 2.5, dist * 0.5 - 0.5);
      if (side > 0) limL[i] = Math.min(limL[i], lim);
      else limR[i] = Math.min(limR[i], lim);
    });
  }
  let wallL = new Float32Array(N), wallR = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    wallL[i] = halfW + runL[i];
    wallR[i] = halfW + runR[i];
  }
  wallL = smoothArr(wallL, Math.round(20 / ds), 2);
  wallR = smoothArr(wallR, Math.round(20 / ds), 2);
  for (let i = 0; i < N; i++) { wallL[i] = Math.min(wallL[i], limL[i]); wallR[i] = Math.min(wallR[i], limR[i]); }
  // the min() can leave steps; ease them while never exceeding the limit
  const wl2 = smoothArr(wallL, 3, 2), wr2 = smoothArr(wallR, 3, 2);
  for (let i = 0; i < N; i++) {
    wallL[i] = Math.max(halfW + 2.5, Math.min(wl2[i], limL[i]));
    wallR[i] = Math.max(halfW + 2.5, Math.min(wr2[i], limR[i]));
  }

  const track = {
    def, N, ds, length: L, px, pz, py, tx, tz, nx, nz, head, curv, slope,
    halfW, wallL, wallR, kerb: kerb2, surfL, surfR, crossings,
    lineOff: null, lineCurv: null,
  };
  computeRacingLine(track);
  track.locate = (x, z, hint) => locate(track, x, z, hint);
  track.sample = (s, off) => sampleAt(track, s, off);
  return track;
}

// Minimum-curvature-ish racing line via multi-resolution elastic band.
function computeRacingLine(t) {
  const { N, px, pz, nx, nz, halfW } = t;
  const lim = halfW - 1.0; // car edge on the white line; kerbs are a bonus
  const o = new Float32Array(N);
  const qx = new Float32Array(N), qz = new Float32Array(N);
  const upd = () => { for (let i = 0; i < N; i++) { qx[i] = px[i] + nx[i] * o[i]; qz[i] = pz[i] + nz[i] * o[i]; } };
  for (const [k, iters] of [[48, 60], [24, 80], [12, 120], [6, 160], [3, 200], [1, 120]]) {
    for (let it = 0; it < iters; it++) {
      upd();
      for (let i = 0; i < N; i++) {
        const a = (i - k + N) % N, b = (i + k) % N;
        const mx = (qx[a] + qx[b]) * 0.5, mz = (qz[a] + qz[b]) * 0.5;
        const delta = (mx - qx[i]) * nx[i] + (mz - qz[i]) * nz[i];
        o[i] = clamp(o[i] + delta * 0.6, -lim, lim);
      }
    }
  }
  // relax the residual digitising ripple out of the line (a car can't follow it anyway)
  for (let it = 0; it < 30; it++) {
    upd();
    for (let i = 0; i < N; i++) {
      const a = (i - 2 + N) % N, b = (i + 2) % N;
      const mx = (qx[a] + qx[b]) * 0.5, mz = (qz[a] + qz[b]) * 0.5;
      o[i] = clamp(o[i] + ((mx - qx[i]) * nx[i] + (mz - qz[i]) * nz[i]) * 0.5, -lim - 0.4, lim + 0.4);
    }
  }
  upd();
  const lc = new Float32Array(N);
  const k = 6;
  for (let i = 0; i < N; i++) {
    const a = (i - k + N) % N, b = (i + k) % N;
    const ax = qx[a], az = qz[a], bx = qx[i], bz = qz[i], cx = qx[b], cz = qz[b];
    const ab = Math.hypot(bx - ax, bz - az), bc = Math.hypot(cx - bx, cz - bz), ca = Math.hypot(ax - cx, az - cz);
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    // sign: cross>0 means turning right in x/z (z down); we want +left
    lc[i] = ab * bc * ca < 1e-6 ? 0 : (-2 * cross) / (ab * bc * ca);
  }
  t.lineOff = o;
  t.lineCurv = smoothArr(lc, 4, 2);
  t.lineX = qx; t.lineZ = qz;
}

// Speed the AI (and the on-track driving line) aims for at each sample.
export function speedProfile(track, spec, gripScale = 0.95) {
  const { N, ds } = track;
  const mu = spec.grip * gripScale * TIRE_MU * Math.min(FRONT_MU, spec.rearGrip || 1.05);
  const m = spec.mass;
  const c = (0.5 * 1.225 * spec.clA) / m;
  const dragK = (0.5 * 1.225 * spec.cd * spec.area) / m;
  const P = spec.powerPS * 735.5 * 0.86 * 0.88; // usable power at the wheels
  const vGear = ((spec.redline * Math.PI) / 30) * spec.wheelRadius / (spec.gears[spec.gears.length - 1] * spec.final);
  const vmax = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const k = Math.abs(track.lineCurv[i]);
    const den = k - mu * c;
    let v = den <= 1e-5 ? 120 : Math.sqrt((mu * G) / den);
    vmax[i] = Math.min(v, vGear * 0.995, 120);
  }
  const drivenFrac = spec.driveFront > 0 ? 1 : 1 - spec.wf + 0.05;
  // friction circle: longitudinal grip left over after cornering at speed v
  const left = (v, k) => {
    const g = mu * (G + c * v * v);
    const lat = v * v * k;
    return Math.sqrt(Math.max(0, g * g - lat * lat)) / g;
  };
  const acc = (v, k) => Math.max(0, Math.min(mu * G * drivenFrac * left(v, k), P / Math.max(v, 4) / m) - dragK * v * v - 0.014 * G);
  const brk = (v, k) => mu * G * 0.8 * spec.brake * Math.max(0.15, left(v, k)) + dragK * v * v;
  const v = Float32Array.from(vmax);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) { // forward: acceleration limit
      const a = (i - 1 + N) % N;
      v[i] = Math.min(v[i], Math.sqrt(v[a] * v[a] + 2 * acc(v[a], Math.abs(track.lineCurv[a])) * ds));
    }
    for (let i = N - 1; i >= 0; i--) { // backward: braking limit
      const b = (i + 1) % N;
      v[i] = Math.min(v[i], Math.sqrt(v[b] * v[b] + 2 * brk(v[b], Math.abs(track.lineCurv[b])) * ds));
    }
  }
  return v;
}

export function locate(t, x, z, hint = -1) {
  const { N, px, pz } = t;
  let best = -1, bestD = Infinity;
  if (hint >= 0) {
    for (let k = -14; k <= 26; k++) {
      const i = (hint + k + N) % N;
      const d = (px[i] - x) ** 2 + (pz[i] - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  if (best < 0 || bestD > 70 * 70) {
    bestD = Infinity;
    for (let i = 0; i < N; i++) {
      const d = (px[i] - x) ** 2 + (pz[i] - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  // choose the segment (best-1,best) or (best,best+1) and project
  let i0 = best, i1 = (best + 1) % N;
  const vx = px[i1] - px[i0], vz = pz[i1] - pz[i0];
  let tt = ((x - px[i0]) * vx + (z - pz[i0]) * vz) / (vx * vx + vz * vz);
  if (tt < 0) {
    i0 = (best - 1 + N) % N; i1 = best;
    const wx = px[i1] - px[i0], wz = pz[i1] - pz[i0];
    tt = ((x - px[i0]) * wx + (z - pz[i0]) * wz) / (wx * wx + wz * wz);
  }
  tt = clamp(tt, 0, 1);
  const cx = lerp(px[i0], px[i1], tt), cz = lerp(pz[i0], pz[i1], tt);
  const nxx = lerp(t.nx[i0], t.nx[i1], tt), nzz = lerp(t.nz[i0], t.nz[i1], tt);
  const d = (x - cx) * nxx + (z - cz) * nzz;
  return {
    i: i0, t: tt,
    s: (i0 + tt) * t.ds,
    d,
    y: lerp(t.py[i0], t.py[i1], tt),
    slope: lerp(t.slope[i0], t.slope[i1], tt),
    tx: lerp(t.tx[i0], t.tx[i1], tt), tz: lerp(t.tz[i0], t.tz[i1], tt),
    wallL: lerp(t.wallL[i0], t.wallL[i1], tt),
    wallR: lerp(t.wallR[i0], t.wallR[i1], tt),
    kerb: t.kerb[i0],
    surfL: t.surfL[i0], surfR: t.surfR[i0],
  };
}

export function sampleAt(t, s, off = 0) {
  const { N, ds } = t;
  let f = s / ds;
  f = ((f % N) + N) % N;
  const i0 = Math.floor(f), i1 = (i0 + 1) % N, u = f - i0;
  const x = lerp(t.px[i0], t.px[i1], u) + lerp(t.nx[i0], t.nx[i1], u) * off;
  const z = lerp(t.pz[i0], t.pz[i1], u) + lerp(t.nz[i0], t.nz[i1], u) * off;
  const tx = lerp(t.tx[i0], t.tx[i1], u), tz = lerp(t.tz[i0], t.tz[i1], u);
  return { x, z, y: lerp(t.py[i0], t.py[i1], u), heading: Math.atan2(tx, tz), i: i0 };
}
