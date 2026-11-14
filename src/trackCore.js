// Track geometry that both the simulation and renderer use. No three.js here,
// so it runs headless in tests.
//
// Circuits (Monza, Suzuka, Spa) have a constant width, elevation keys and
// generous run-off. Street courses (def.street) add per-point data from the
// city generator: road width + real elevation per raw point (def.pointW,
// def.pointY), the course's street corridor (def.corridor) that bounds the
// barriers, and escape roads (def.escapes) where the barrier opens into a
// side street.
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

// Arc-length resample. src[k] = fractional index into the input polyline, so
// per-point attributes of the input can follow the resampled curve.
function resampleClosed(xs, zs, step) {
  const n = xs.length;
  const cum = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) cum[i] = cum[i - 1] + Math.hypot(xs[i % n] - xs[i - 1], zs[i % n] - zs[i - 1]);
  const L = cum[n];
  const N = Math.round(L / step);
  const ds = L / N;
  const px = new Float32Array(N), pz = new Float32Array(N), src = new Float32Array(N);
  let j = 0;
  for (let k = 0; k < N; k++) {
    const s = k * ds;
    while (cum[j + 1] < s) j++;
    const t = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    px[k] = lerp(xs[j], xs[(j + 1) % n], t);
    pz[k] = lerp(zs[j], zs[(j + 1) % n], t);
    src[k] = j + t;
  }
  return { px, pz, N, ds, L, src };
}

// Linear interpolation of a closed per-point array at a fractional index.
function perPoint(arr, f) {
  const n = arr.length;
  const i0 = Math.floor(f) % n, u = f - Math.floor(f);
  return lerp(arr[i0], arr[(i0 + 1) % n], u);
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
  const { px, pz, N, ds, L, src } = resampleClosed(dx, dz, def.step || 2);
  const SUB = 8; // catmull subdivisions per raw point

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
  let py = new Float32Array(N);
  if (def.pointY) {
    for (let i = 0; i < N; i++) py[i] = perPoint(def.pointY, src[i] / SUB);
  } else {
    const elev = periodicCurve(def.elevation || [[0, 0], [0.5, 0]]);
    for (let i = 0; i < N; i++) py[i] = elev(i / N);
  }
  py = smoothArr(py, 10, 2);

  // road half-width per sample (constant on circuits)
  const halfW = def.width / 2;
  let hw = new Float32Array(N).fill(halfW);
  if (def.pointW) {
    for (let i = 0; i < N; i++) hw[i] = perPoint(def.pointW, src[i] / SUB) / 2;
    hw = smoothArr(hw, Math.round(6 / ds), 2);
  }

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
  const absK = new Float32Array(N);
  for (let i = 0; i < N; i++) absK[i] = Math.abs(curv[i]);
  const kerb2 = new Uint8Array(N); // bit0 left, bit1 right
  const runL = new Float32Array(N), runR = new Float32Array(N);
  const surfL = new Uint8Array(N), surfR = new Uint8Array(N); // street: all asphalt
  if (!def.street) {
    const cornerF = new Float32Array(N); // 0 straight .. 1 tight corner
    for (let i = 0; i < N; i++) cornerF[i] = smoothstep(0.003, 0.02, absK[i]);
    const kerb = new Uint8Array(N);
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
    const kgrow = Math.round(8 / ds);
    for (let i = 0; i < N; i++) if (kerb[i]) for (let k = -kgrow; k <= kgrow; k++) kerb2[(i + k + N) % N] = 3;
  }

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
      const lim = Math.max(hw[i] + 2.5, dist * 0.5 - 0.5);
      if (side > 0) limL[i] = Math.min(limL[i], lim);
      else limR[i] = Math.min(limR[i], lim);
    });
  }
  let wallL, wallR;
  if (def.street) {
    [wallL, wallR] = streetWalls(def, { N, ds, px, pz, nx, nz, hw, limL, limR });
  } else {
    wallL = new Float32Array(N); wallR = new Float32Array(N);
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
  }
  // Tight street corners keep extra room on the inside: pure pursuit cuts
  // the apex of a 90-degree turn by a metre or so.
  let inL = new Float32Array(N), inR = new Float32Array(N);
  if (def.street) {
    for (let i = 0; i < N; i++) {
      const f = 1.3 * smoothstep(0.02, 0.07, absK[i]);
      if (curv[i] > 0) inL[i] = f; else inR[i] = f;
    }
    inL = smoothArr(inL, Math.round(6 / ds), 2);
    inR = smoothArr(inR, Math.round(6 / ds), 2);
  }

  const track = {
    def, N, ds, length: L, px, pz, py, tx, tz, nx, nz, head, curv, slope,
    halfW, hw, edgeL: null, edgeR: null, roomL: null, roomR: null, roadL: wallL, roadR: wallR, wallL, wallR,
    kerb: kerb2, surfL, surfR, crossings,
    escapes: buildEscapes(def),
    barriers: null,
    lineOff: null, lineCurv: null,
  };
  track.barriers = buildBarriers(track);
  // roadL/roadR: how far the road surface reaches either side, out to the
  // barrier line (cast along the normal; on streets the line can sit a little
  // beyond the wall offset where saw-tooth was cut away). Where the ray finds
  // no barrier nearby (an escape-road mouth) the wall offset.
  // edgeL/edgeR, the usable track: the painted edge on circuits; on streets
  // the barrier line less a margin.
  // roomL/roomR, what the racing line and the AI may use: the same, but on
  // streets pulled in ahead of and behind barrier corners that step into the
  // road, by at most ROOM_SLOPE m sideways per metre along (no car follows a
  // kerb corner square, and a line aimed past one runs into it).
  if (def.street) {
    const road = [new Float32Array(N), new Float32Array(N)], edges = [new Float32Array(N), new Float32Array(N)];
    for (const [k, side, wall, inner] of [[0, 1, wallL, inL], [1, -1, wallR, inR]]) {
      for (let i = 0; i < N; i++) {
        const cap = wall[i] + NOTCH_DEPTH + 1, ray = barrierRay(track, i, side, cap);
        road[k][i] = ray < cap ? Math.max(wall[i], ray) : wall[i];
        edges[k][i] = Math.min(wall[i], ray) - 0.7 - inner[i];
      }
    }
    [track.roadL, track.roadR] = road;
    [track.edgeL, track.edgeR] = edges;
    [track.roomL, track.roomR] = edges.map((e) => slopeLimit(e, ds));
  } else {
    track.edgeL = Float32Array.from(hw);
    track.edgeR = Float32Array.from(hw);
    track.roomL = track.edgeL;
    track.roomR = track.edgeR;
  }
  computeRacingLine(track);
  track.locate = (x, z, hint) => locate(track, x, z, hint);
  track.sample = (s, off) => sampleAt(track, s, off);
  return track;
}

// Distance from course sample i along its normal on `side` to the first
// barrier segment of that side's line (or maxT).
const rayNear = [];
function barrierRay(t, i, side, maxT) {
  const B = t.barriers, dx = t.nx[i] * side, dz = t.nz[i] * side, ox = t.px[i], oz = t.pz[i];
  const nLeft = B.loops[0].src.length;
  const cnt = barriersNear(B, ox + dx * maxT * 0.5, oz + dz * maxT * 0.5, maxT * 0.5 + 0.5, rayNear);
  let best = maxT;
  for (let q = 0; q < cnt; q++) {
    const s = rayNear[q];
    if ((s < nLeft) !== (side > 0)) continue;
    const u = segIntersect(ox, oz, ox + dx * maxT, oz + dz * maxT, B.ax[s], B.az[s], B.bx[s], B.bz[s]);
    if (u !== null) best = Math.min(best, u * maxT);
  }
  return best;
}

// Lower envelope of a closed per-sample offset with its slope limited to
// ROOM_SLOPE: steps become ramps that start early, never later.
const ROOM_SLOPE = 0.33;
function slopeLimit(e, ds) {
  const N = e.length, K = 20, out = Float32Array.from(e);
  for (let i = 0; i < N; i++) {
    for (let j = 1; j <= K; j++) {
      const r = ROOM_SLOPE * j * ds;
      out[i] = Math.min(out[i], e[(i + j) % N] + r, e[(i - j + N) % N] + r);
    }
  }
  return out;
}

// Street barriers: cast a ray out along each normal and find where it leaves
// the union of the course's street rectangles (def.corridor = flat
// [x0,z0,x1,z1,halfW], each extended by halfW past its ends), exactly, so
// straights get a barrier on the kerb line and 90-degree corners open up to
// the whole intersection box with clean straight runs and corner points. The
// barrier face sits 0.5 m inside the kerb, never inside the course's own kerb
// line (hw), and clear of other parts of the course (lim).
function streetWalls(def, t) {
  const { N, px, pz, nx, nz, hw, limL, limR } = t;
  const segs = [];
  const grid = new Grid(40);
  const c = def.corridor;
  for (let k = 0; k < c.length; k += 5) {
    const x0 = c[k], z0 = c[k + 1], x1 = c[k + 2], z1 = c[k + 3], h = c[k + 4];
    const L = Math.hypot(x1 - x0, z1 - z0) || 1e-3;
    const si = segs.length;
    segs.push({ x0, z0, ux: (x1 - x0) / L, uz: (z1 - z0) / L, L, h });
    for (let s = 0; s <= L + 20; s += 20) grid.add(x0 + segs[si].ux * Math.min(s, L), z0 + segs[si].uz * Math.min(s, L), si);
  }
  const cap = def.wallCap || 20, gap = 0.5;
  // distance along the ray (ox, oz) + t (dx, dz), from t0, to where it leaves the union
  const iv = [];
  const exit = (ox, oz, dx, dz, t0) => {
    iv.length = 0;
    grid.query(ox + dx * cap * 0.5, oz + dz * cap * 0.5, 45 + cap * 0.5, (si) => {
      const s = segs[si];
      const a0 = (ox - s.x0) * s.ux + (oz - s.z0) * s.uz, da = dx * s.ux + dz * s.uz;
      const l0 = (oz - s.z0) * s.ux - (ox - s.x0) * s.uz, dl = dz * s.ux - dx * s.uz;
      let lo = -Infinity, hi = Infinity;
      for (const [p, dp, a, b] of [[a0, da, -s.h, s.L + s.h], [l0, dl, -s.h, s.h]]) {
        if (Math.abs(dp) < 1e-9) { if (p < a || p > b) return; continue; }
        const u = (a - p) / dp, v = (b - p) / dp;
        lo = Math.max(lo, Math.min(u, v)); hi = Math.min(hi, Math.max(u, v));
      }
      if (hi > lo) iv.push(lo, hi);
    });
    let d = t0;
    for (let grown = true; grown && d < cap;) {
      grown = false;
      for (let q = 0; q < iv.length; q += 2) if (iv[q] <= d + 1e-6 && iv[q + 1] > d + 1e-6) { d = iv[q + 1]; grown = true; }
    }
    return Math.min(d, cap);
  };
  const lim = [limL, limR];
  const out = [new Float32Array(N), new Float32Array(N)];
  for (let i = 0; i < N; i++) {
    for (const [k, side] of [[0, 1], [1, -1]]) {
      out[k][i] = Math.min(lim[k][i], exit(px[i], pz[i], nx[i] * side, nz[i] * side, hw[i]) - gap);
    }
  }
  return out;
}

// Escape roads: oriented rectangles (side-street stubs) the car may enter
// where a barrier opens. def.escapes = [{x, z, dx, dz, hw, len}]: mouth centre,
// unit direction, half-width and length. buildBarriers() splices each into the
// barrier line and drops any it can't splice cleanly.
function buildEscapes(def) {
  return (def.escapes || []).map((e) => ({ ...e, nx: -e.dz, nz: e.dx }));
}

// Escape road containing (x, z), with local coordinates, or null.
export function escapeAt(track, x, z, margin = 0) {
  for (const e of track.escapes) {
    const rx = x - e.x, rz = z - e.z;
    const along = rx * e.dx + rz * e.dz, lat = rx * e.nx + rz * e.nz;
    if (along >= -margin && along <= e.len + margin && Math.abs(lat) <= e.hw + margin) return { e, along, lat };
  }
  return null;
}

// ---- barriers ----------------------------------------------------------------
// The one barrier definition: sim.js collides with it, trackScene/cityScene
// draw it. A closed polyline either side of the course, in race order, along
// the wall offsets of every sample, with the folds offsets make on the inside
// of tight corners cut out and each escape road spliced in as a detour down
// its side street, closed by an end wall. Escapes that can't be spliced
// cleanly are dropped, so the barrier stays closed there. Street loops are
// thinned to straight runs of <= SEG_MAX m (one concrete block each).
//   loops[k] = { side (+1 left, -1 right), pts [x0, z0, ...], src (course
//               sample per vertex, for heights), kind (per segment) }
//   flat per segment s (vertex a -> b): ax az bx bz, inward unit normal nx nz
//   (toward the drivable side), len, y (course height), kind (0 wall,
//   1 escape side, 2 escape end), want (heading a glancing hit steers toward,
//   NaN for none), convex (vertex a juts into the drivable side; vnx vnz is
//   its normal, the mean of its two faces'), over (near a place where the
//   course crosses itself on a bridge: only there does height decide whether
//   a car meets the segment; everywhere else containment is purely 2D)
// Query segments near a point with barriersNear().
const SEG_MAX = 4.2;
const BCELL = 8;
const OVER_SPAN = 50; // samples either side of a bridge crossing
const bkey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

function buildBarriers(t) {
  const { def, N, px, pz, nx, nz, wallL, wallR } = t;
  const loops = [];
  for (const side of [1, -1]) {
    const w = side > 0 ? wallL : wallR;
    const P = [];
    // vertex: position, course sample, kind + want heading of the segment it starts
    for (let i = 0; i < N; i++) P.push({ x: px[i] + nx[i] * w[i] * side, z: pz[i] + nz[i] * w[i] * side, i, k: 0, h: NaN });
    loops.push({ side, P: def.street ? untangle(dropNotches(untangle(P), side)) : untangle(P) });
  }
  const course = loops.map((l) => l.P);
  t.escapes = t.escapes.filter((e) => spliceEscape(t, loops, course, e));
  // streets: one concrete block per segment; circuits keep a vertex per sample
  if (def.street) {
    for (const l of loops) l.P = subdivide(dropNotches(thin(dropShort(l.P, 0.6), 0.05, SEG_MAX), l.side), SEG_MAX);
  }
  return packBarriers(t, loops);
}

// Signed turn at vertex k of a closed barrier line on `side`: < 0 where the
// line bends away from the road there (the vertex juts into the road), > 0
// where it bends toward it.
function barrierTurn(P, k, side) {
  const n = P.length, a = P[(k - 1 + n) % n], b = P[k], c = P[(k + 1) % n];
  const ux = b.x - a.x, uz = b.z - a.z, vx = c.x - b.x, vz = c.z - b.z;
  return side * Math.atan2(ux * vz - uz * vx, ux * vx + uz * vz);
}

// Street outlines are unions of straight street rectangles, so where a street
// bends gently or changes width the rectangles' corners leave a saw-tooth of
// steps along the kerb. A vertex that juts into the road with a vertex bending
// back toward it within NOTCH_SPAN m is such a step (a real kerb corner has
// straight runs either side). notchAt() returns how far the vertex juts out of
// the line through its neighbouring corners (0: not a notch); dropNotches()
// removes it, so the line only ever moves away from the road, onto the outer
// rectangle corners: the outer kerb of the bend.
export const NOTCH_SPAN = 4;
const NOTCH_DEPTH = 3, NOTCH_TURN = 0.02;
export function notchAt(P, k, side) {
  if (barrierTurn(P, k, side) > -NOTCH_TURN) return 0;
  const n = P.length, at = (q) => P[((q % n) + n) % n];
  let found = false;
  const nb = [];
  for (const dir of [1, -1]) {
    let dist = 0, q = k;
    nb.push(at(k + dir));
    for (let s = 1; s < n; s++) {
      dist += Math.hypot(at(k + dir * s).x - at(k + dir * (s - 1)).x, at(k + dir * s).z - at(k + dir * (s - 1)).z);
      if (dist > NOTCH_SPAN) break;
      const tn = barrierTurn(P, ((k + dir * s) % n + n) % n, side);
      if (Math.abs(tn) >= NOTCH_TURN) {
        if (q === k) { q = k + dir * s; nb[nb.length - 1] = at(q); } // the next corner either side
        if (tn > NOTCH_TURN) { found = true; break; }
      }
    }
  }
  if (!found) return 0;
  const [c, a] = nb, b = P[k];
  const vx = c.x - a.x, vz = c.z - a.z, l = Math.hypot(vx, vz) || 1;
  return Math.abs((b.x - a.x) * vz - (b.z - a.z) * vx) / l;
}
function dropNotches(P, side) {
  for (let pass = 0, changed = true; changed && pass < 200; pass++) {
    changed = false;
    for (let k = 0; k < P.length; k++) {
      if (P[k].k === 2 || P[(k - 1 + P.length) % P.length].k === 2) continue; // keep the end walls square
      const d = notchAt(P, k, side);
      if (d > 0 && d <= NOTCH_DEPTH) { P.splice(k, 1); k = Math.max(-1, k - 3); changed = true; }
    }
  }
  return P;
}

// Cut self-intersection loops out of a closed polyline (offsets wider than the
// corner radius fold back on themselves) and drop doubled-back spikes.
function untangle(P, W = 40) {
  for (let pass = 0; pass < 64; pass++) {
    const n = P.length;
    let cut = null;
    for (let k = 0; k < n && !cut; k++) {
      const a = P[k], b = P[(k + 1) % n];
      for (let m = Math.min(W, n - 3); m >= 2; m--) {
        const c = P[(k + m) % n], d = P[(k + m + 1) % n];
        const tt = segIntersect(a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z);
        if (tt !== null) { cut = { k, m, x: lerp(a.x, b.x, tt), z: lerp(a.z, b.z, tt) }; break; }
      }
    }
    let changed = false;
    if (cut) {
      // P[k] -> crossing -> P[k+m+1]: the loop between them goes
      const { k, m } = cut;
      const out = [];
      for (let q = (k + m + 1) % n; ; q = (q + 1) % n) { out.push(P[q]); if (q === k) break; }
      out.push({ ...P[(k + m) % n], x: cut.x, z: cut.z });
      P = out;
      changed = true;
    }
    for (let k = 0; k < P.length && P.length > 3; k++) {
      const n2 = P.length, a = P[(k - 1 + n2) % n2], b = P[k], c = P[(k + 1) % n2];
      const ux = b.x - a.x, uz = b.z - a.z, vx = c.x - b.x, vz = c.z - b.z;
      const lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
      if (lu < 1e-3 || ux * vx + uz * vz < -0.5 * lu * lv) { P.splice(k, 1); k = Math.max(-1, k - 2); changed = true; }
    }
    if (!changed) break;
  }
  return P;
}

// Fold segments shorter than minLen into a neighbour of the same kind (the
// little jogs left where a barrier meets an escape road's side wall).
function dropShort(P, minLen) {
  for (let k = 0; k < P.length && P.length > 3; k++) {
    const n = P.length, a = P[k], b = P[(k + 1) % n];
    if (Math.hypot(b.x - a.x, b.z - a.z) >= minLen) continue;
    if (b.k === a.k) P.splice((k + 1) % n, 1);
    else if (P[(k - 1 + n) % n].k === a.k) P.splice(k, 1);
    else continue;
    k = Math.max(-1, k - 2);
  }
  return P;
}

// even-odd: inside the region bounded by these closed polylines?
function inLoops(loops, x, z) {
  let c = false;
  for (const P of loops) {
    for (let k = 0, n = P.length; k < n; k++) {
      const a = P[k], b = P[(k + 1) % n];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) c = !c;
    }
  }
  return c;
}

// Splice escape e into the barrier loop that crosses its mouth: the stretch of
// barrier inside the escape rectangle is replaced by the rectangle's outline
// on the far side of that barrier (side walls and end wall). course = the
// unspliced loops. Returns false (escape dropped) if no loop takes it cleanly.
function spliceEscape(t, loops, course, e) {
  const N = t.N;
  let mouth = 0;
  for (let i = 0, bd = Infinity; i < N; i++) { const d = (t.px[i] - e.x) ** 2 + (t.pz[i] - e.z) ** 2; if (d < bd) { bd = d; mouth = i; } }
  const loc = (x, z) => [(x - e.x) * e.dx + (z - e.z) * e.dz, (x - e.x) * e.nx + (z - e.z) * e.nz];
  const world = (al, la) => [e.x + e.dx * al + e.nx * la, e.z + e.dz * al + e.nz * la];
  // outline corners (along, lat); edges C0->C1 mouth, C1->C2 side, C2->C3 end, C3->C0 side
  const C = [[0, -e.hw], [0, e.hw], [e.len, e.hw], [e.len, -e.hw]];
  const perim = (p) => {
    const ed = Math.floor(p) % 4, u = p - Math.floor(p), [ca, cl] = C[ed], [da, dl] = C[(ed + 1) % 4];
    return [ca + (da - ca) * u, cl + (dl - cl) * u];
  };
  const heading = Math.atan2(e.dx, e.dz);
  for (const l of loops) {
    const P = l.P, n = P.length;
    const near = (v) => { const d = Math.abs(v.i - mouth); return Math.min(d, N - d) <= 60; };
    let q0 = -1;
    for (let q = 0; q < n; q++) if (near(P[q]) && !near(P[(q - 1 + n) % n])) { q0 = q; break; }
    if (q0 < 0) continue;
    const Q = P.slice(q0).concat(P.slice(0, q0));
    let wn = 0;
    while (wn < n && near(Q[wn])) wn++;
    // first crossing into the outline, last crossing out of it
    let E = null, X = null;
    for (let k = 0; k + 1 < Math.min(wn + 1, n); k++) {
      const [a0, l0] = loc(Q[k].x, Q[k].z), [a1, l1] = loc(Q[k + 1].x, Q[k + 1].z);
      for (let ed = 0; ed < 4; ed++) {
        const [ca, cl] = C[ed], [da, dl] = C[(ed + 1) % 4];
        const tt = segIntersect(a0, l0, a1, l1, ca, cl, da, dl);
        if (tt === null) continue;
        const ia = a0 + (a1 - a0) * tt, il = l0 + (l1 - l0) * tt;
        const u = clamp(ed % 2 === 0 ? (il - cl) / (dl - cl) : (ia - ca) / (da - ca), 0, 0.999999);
        const entering = (a1 - a0) * (dl - cl) - (l1 - l0) * (da - ca) > 0;
        const c = { s: k + tt, k, p: ed + u };
        if (entering) { if (!E || c.s < E.s) E = c; } else if (!X || c.s > X.s) X = c;
      }
    }
    if (!E || !X || X.s <= E.s) continue;
    // the way round the outline from E to X that stays off the course
    const arc = (dir) => {
      const D = (((dir > 0 ? X.p - E.p : E.p - X.p) % 4) + 4) % 4; // perimeter distance E -> X
      const ps = [E.p];
      for (let q = 1; q <= 4; q++) {
        const c = dir > 0 ? Math.floor(E.p) + q : Math.ceil(E.p) - q;
        if ((dir > 0 ? c - E.p : E.p - c) >= D) break;
        ps.push(((c % 4) + 4) % 4);
      }
      ps.push(X.p);
      let inside = 0, total = 0;
      for (let q = 0; q + 1 < ps.length; q++) {
        const [a0, l0] = perim(ps[q]), [a1, l1] = perim(ps[q + 1]);
        const steps = Math.max(1, Math.ceil(Math.hypot(a1 - a0, l1 - l0)));
        for (let r = 0; r < steps; r++) {
          const [x, z] = world(lerp(a0, a1, (r + 0.5) / steps), lerp(l0, l1, (r + 0.5) / steps));
          total++;
          if (inLoops(course, x, z)) inside++;
        }
      }
      return { ps, off: inside / total };
    };
    const A = arc(1), Bk = arc(-1);
    const best = A.off <= Bk.off ? A : Bk;
    if (best.off > 0.25) continue;
    // new loop: ..Q[E.k], E, outline corners, X, Q[X.k + 1]..
    const verts = best.ps.map((p, q) => {
      const [al, la] = perim(p);
      const [x, z] = world(al, la);
      let k = 0;
      if (q + 1 < best.ps.length) {
        const [a1, l1] = perim(best.ps[q + 1]);
        k = (al + a1) / 2 > e.len - 0.01 ? 2 : 1;
      } else k = Q[X.k].k;
      return { x, z, i: q === 0 ? Q[E.k].i : q + 1 === best.ps.length ? Q[(X.k + 1) % n].i : mouth, k, h: k === 1 ? heading : NaN };
    });
    const next = Q.slice(0, E.k + 1).concat(verts, Q.slice(X.k + 1));
    // the detour must not cut through any other barrier
    let clash = false;
    const others = loops.map((o) => (o === l ? next : o.P));
    const v0 = E.k + 1, v1 = E.k + verts.length; // indices of E and X in next
    for (let q = v0; q < v1 && !clash; q++) {
      const a = next[q], b = next[q + 1];
      for (const O of others) {
        for (let r = 0, m = O.length; r < m && !clash; r++) {
          if (O === next && r >= v0 - 1 && r <= v1) continue;
          const c = O[r], d = O[(r + 1) % m];
          if (segIntersect(a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z) !== null) clash = true;
        }
      }
    }
    if (clash) continue;
    l.P = next;
    return true;
  }
  return false;
}

// Merge runs of near-collinear vertices into segments of up to maxLen
// (closed polyline; segment kinds are kept apart).
function thin(P, tol, maxLen) {
  const n = P.length;
  let s0 = 0;
  for (let q = 0; q < n; q++) if (P[q].k !== P[(q - 1 + n) % n].k) { s0 = q; break; }
  const Q = P.slice(s0).concat(P.slice(0, s0));
  const off = (v, a, b) => {
    const vx = b.x - a.x, vz = b.z - a.z;
    const u = clamp(((v.x - a.x) * vx + (v.z - a.z) * vz) / (vx * vx + vz * vz || 1), 0, 1);
    return Math.hypot(v.x - a.x - vx * u, v.z - a.z - vz * u);
  };
  const out = [Q[0]];
  for (let a = 0; a < n;) {
    let b = a + 1;
    while (b < n && Q[b].k === Q[a].k) {
      const c = Q[(b + 1) % n];
      if (Math.hypot(c.x - Q[a].x, c.z - Q[a].z) > maxLen) break;
      let ok = true;
      for (let q = a + 1; q <= b && ok; q++) ok = off(Q[q], Q[a], c) <= tol;
      if (!ok) break;
      b++;
    }
    if (b < n) out.push(Q[b]);
    a = b;
  }
  return out;
}

// Split segments longer than maxLen evenly.
function subdivide(P, maxLen) {
  const out = [];
  for (let k = 0, n = P.length; k < n; k++) {
    const a = P[k], b = P[(k + 1) % n];
    out.push(a);
    const m = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / maxLen);
    for (let q = 1; q < m; q++) out.push({ ...a, x: lerp(a.x, b.x, q / m), z: lerp(a.z, b.z, q / m) });
  }
  return out;
}

function packBarriers(t, loops) {
  let n = 0;
  for (const l of loops) n += l.P.length;
  const f = () => new Float32Array(n);
  const B = {
    loops: [], n, ax: f(), az: f(), bx: f(), bz: f(), nx: f(), nz: f(), len: f(), y: f(), want: f(),
    kind: new Uint8Array(n), convex: new Uint8Array(n), vnx: f(), vnz: f(), over: new Uint8Array(n),
    grid: new Map(), stamp: new Uint32Array(n), qid: 0,
  };
  let s = 0;
  for (const l of loops) {
    const P = l.P, m = P.length, s0 = s;
    const pts = new Float32Array(m * 2), src = new Int32Array(m), kind = new Uint8Array(m);
    for (let k = 0; k < m; k++, s++) {
      const a = P[k], b = P[(k + 1) % m];
      pts[k * 2] = a.x; pts[k * 2 + 1] = a.z; src[k] = a.i; kind[k] = a.k;
      const ux = b.x - a.x, uz = b.z - a.z, L = Math.hypot(ux, uz) || 1e-6;
      B.ax[s] = a.x; B.az[s] = a.z; B.bx[s] = b.x; B.bz[s] = b.z; B.len[s] = L;
      // the drivable side is to the right of a left loop, to the left of a right one
      B.nx[s] = (l.side > 0 ? -uz : uz) / L;
      B.nz[s] = (l.side > 0 ? ux : -ux) / L;
      B.y[s] = (t.py[a.i] + t.py[b.i]) / 2;
      B.kind[s] = a.k;
      B.want[s] = a.k === 0 ? Math.atan2(ux, uz) : a.h;
      for (const c of t.crossings) {
        for (const j of [c.lo, c.hi]) { const d = Math.abs(a.i - j); if (Math.min(d, t.N - d) <= OVER_SPAN) B.over[s] = 1; }
      }
    }
    for (let k = 0; k < m; k++) {
      const p = s0 + ((k - 1 + m) % m), c = s0 + k;
      if ((B.bx[c] - B.ax[c]) * B.nx[p] + (B.bz[c] - B.az[c]) * B.nz[p] >= -0.02 * B.len[c]) continue;
      // a convex corner: it pushes out along the mean of its two faces' normals
      const vx = B.nx[p] + B.nx[c], vz = B.nz[p] + B.nz[c], l = Math.hypot(vx, vz) || 1;
      B.convex[c] = 1;
      B.vnx[c] = vx / l;
      B.vnz[c] = vz / l;
    }
    B.loops.push({ side: l.side, pts, src, kind });
  }
  for (let k = 0; k < n; k++) {
    const x0 = Math.floor(Math.min(B.ax[k], B.bx[k]) / BCELL), x1 = Math.floor(Math.max(B.ax[k], B.bx[k]) / BCELL);
    const z0 = Math.floor(Math.min(B.az[k], B.bz[k]) / BCELL), z1 = Math.floor(Math.max(B.az[k], B.bz[k]) / BCELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = bkey(cx, cz);
        let b = B.grid.get(key);
        if (!b) B.grid.set(key, (b = []));
        b.push(k);
      }
    }
  }
  return B;
}

// Indices of barrier segments that may lie within r of (x, z), into out[];
// returns the count.
export function barriersNear(B, x, z, r, out) {
  const id = ++B.qid;
  let cnt = 0;
  const x0 = Math.floor((x - r) / BCELL), x1 = Math.floor((x + r) / BCELL);
  const z0 = Math.floor((z - r) / BCELL), z1 = Math.floor((z + r) / BCELL);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      const b = B.grid.get(bkey(cx, cz));
      if (!b) continue;
      for (let q = 0; q < b.length; q++) {
        const k = b[q];
        if (B.stamp[k] !== id) { B.stamp[k] = id; out[cnt++] = k; }
      }
    }
  }
  return cnt;
}

// Minimum-curvature-ish racing line via multi-resolution elastic band.
function computeRacingLine(t) {
  const { N, px, pz, nx, nz, roomL, roomR } = t;
  // car edge on the white line (kerbs are a bonus) / clear of the barrier
  const loL = new Float32Array(N), hiL = new Float32Array(N);
  for (let i = 0; i < N; i++) { hiL[i] = roomL[i] - 1.0; loL[i] = -(roomR[i] - 1.0); }
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
        o[i] = clamp(o[i] + delta * 0.6, loL[i], hiL[i]);
      }
    }
  }
  // relax the residual digitising ripple out of the line (a car can't follow it anyway)
  for (let it = 0; it < 30; it++) {
    upd();
    for (let i = 0; i < N; i++) {
      const a = (i - 2 + N) % N, b = (i + 2) % N;
      const mx = (qx[a] + qx[b]) * 0.5, mz = (qz[a] + qz[b]) * 0.5;
      o[i] = clamp(o[i] + ((mx - qx[i]) * nx[i] + (mz - qz[i]) * nz[i]) * 0.5, loL[i] - 0.4, hiL[i] + 0.4);
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
    hw: lerp(t.hw[i0], t.hw[i1], tt),
    edgeL: lerp(t.edgeL[i0], t.edgeL[i1], tt),
    edgeR: lerp(t.edgeR[i0], t.edgeR[i1], tt),
    roomL: lerp(t.roomL[i0], t.roomL[i1], tt),
    roomR: lerp(t.roomR[i0], t.roomR[i1], tt),
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
