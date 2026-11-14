// New York City (Midtown Manhattan) city module: hand-built voxel landmarks and
// NYC-specific dressing for the street course (see cityScene.js for the generic
// city: buildings, roads, barriers, lamps, trees...).
//
// Landmarks are laid out in the Manhattan street grid frame: local +x ("u") runs
// uptown along the avenues (bearing ~29° east of north), local +z ("e") runs east
// along the cross streets. All sizes are real metres. Billboard brands are fictional.
import * as THREE from 'three';

const D2R = Math.PI / 180;
const GRID = 29 * D2R; // Manhattan grid: avenues point ~29° east of true north
const SG = Math.sin(GRID), CG = Math.cos(GRID);
// BoxBuilder rotation that maps local +x to uptown and local +z to east.
const GRID_ROT = Math.atan2(CG, SG);

// Anchors (lat, lon). Outline corners come from the OSM footprints in tools/data/cities/nyc.json.
const LL = {
  nypl: [40.753639, -73.981844], // Schwarzman Building outline, 42nd St corner (main block NE)
  patience: [40.752897, -73.981749],
  fortitude: [40.753051, -73.981642],
  bryant: [40.752846, -73.983061], // Bryant Park outline corner behind the library (40th St side)
  carrousel: [40.753429, -73.983879],
  lowell: [40.753985, -73.984091],
  stpat: [40.758729, -73.976691], // St Patrick's west facade, centre between the towers
  channel: [40.758572, -73.97818], // Channel Gardens west end (south corner)
  prometheus: [40.758705, -73.978578],
  atlas: [40.758948, -73.97718],
  plaza: [40.76455, -73.9745], // inside The Plaza hotel
  pomona: [40.764043, -73.97362], // Pulitzer Fountain (Pomona statue)
  sherman: [40.7647, -73.9732],
  columbus: [40.768074, -73.981902], // Columbus Monument (OSM)
  maine: [40.768, -73.981], // USS Maine Monument, Merchants' Gate (inside the park corner, clear of the circle)
  esb: [40.748491, -73.986501], // Empire State Building lot, SW corner
  chrysler: [40.751489, -73.97585], // Chrysler Building lot, SW corner
  oneTS: [40.756191, -73.986524],
  tkts: [40.759155, -73.984923],
  ts42: [40.75604, -73.98695], // 7th Ave @ 42nd
  ts47: [40.75906, -73.98475], // 7th Ave @ 47th
  cps6: [40.76568, -73.97624], // Central Park South @ 6th Ave
  gap: [40.76428, -73.97303], // Grand Army Plaza (5th Ave @ 59th)
};

// ---------------------------------------------------------------------------
// helpers
function frame(b, x, y, z, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const f = {
    b, x, y, z, rot,
    box(x0, y0, z0, x1, y1, z1, col, opts) {
      b.box(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), col, rot, x, y, z, opts);
    },
    // box around local point (u, e), turned by an extra angle drot
    rbox(u, e, drot, x0, y0, z0, x1, y1, z1, col, opts) {
      b.box(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), col, rot + drot, u * c + e * s + x, y, -u * s + e * c + z, opts);
    },
    wx: (u, e) => u * c + e * s + x,
    wz: (u, e) => -u * s + e * c + z,
    sub(u, dy, e, drot = 0, nb = b) { return frame(nb, u * c + e * s + x, y + dy, -u * s + e * c + z, rot + drot); },
  };
  return f;
}
// octagonal prism of circumradius r around local (u, e)
function oct(f, u, e, y0, y1, r, col, opts) {
  const a = r * 0.924;
  f.rbox(u, e, 0, -a, y0, -a, a, y1, a, col, opts);
  f.rbox(u, e, Math.PI / 4, -a, y0, -a, a, y1, a, col, opts);
}
// horizontal ring of n segments (centre radius R, radial thickness t)
function ring(f, u, e, y0, y1, R, t, n, col, opts) {
  const L = (Math.PI * R) / n * 1.06;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    f.rbox(u + R * Math.cos(a), e + R * Math.sin(a), -a, -t / 2, y0, -L, t / 2, y1, L, col, opts);
  }
}
// vertical ring of cubes; plane 'u' = u/y plane, 'e' = e/y plane
function vring(f, u, y, e, R, n, s, d, col, plane = 'u', a0 = 0, a1 = Math.PI * 2) {
  for (let k = 0; k < n; k++) {
    const a = a0 + ((k + 0.5) / n) * (a1 - a0);
    const h = R * Math.cos(a), v = y + R * Math.sin(a);
    if (plane === 'u') f.box(u + h - s, v - s, e - d, u + h + s, v + s, e + d, col);
    else f.box(u - d, v - s, e + h - s, u + d, v + s, e + h + s, col);
  }
}
// stepped gable roof; ridge along e (alongU=false) or along u
function ridgeRoof(f, a0, a1, b0, b1, y0, rise, n, col, alongU = false) {
  const half = (a1 - a0) / 2, mid = (a0 + a1) / 2, dy = rise / n;
  for (let k = 0; k < n; k++) {
    const w = half * (1 - k / n);
    if (alongU) f.box(b0, y0 + k * dy, mid - w, b1, y0 + (k + 1) * dy, mid + w, col);
    else f.box(mid - w, y0 + k * dy, b0, mid + w, y0 + (k + 1) * dy, b1, col);
  }
}
function pipF(x, z, p) {
  let c = false;
  const n = p.length >> 1;
  for (let a = 0, b = n - 1; a < n; b = a++) {
    const za = p[a * 2 + 1], zb = p[b * 2 + 1];
    if ((za > z) !== (zb > z) && x < ((p[b * 2] - p[a * 2]) * (z - za)) / (zb - za) + p[a * 2]) c = !c;
  }
  return c;
}
function polyArea(p) {
  let s = 0;
  const n = p.length >> 1;
  for (let a = 0; a < n; a++) { const b = (a + 1) % n; s += p[a * 2] * p[b * 2 + 1] - p[b * 2] * p[a * 2 + 1]; }
  return Math.abs(s / 2);
}
// world point -> grid-local (u, e) relative to an origin
function gridLocal(x, z, ox, oz) {
  const dx = x - ox, dz = z - oz;
  return [dx * SG - dz * CG, dx * CG + dz * SG];
}
// rotation aligned with a footprint's longest edge, folded to the nearest grid orientation
function footprintRot(b) {
  const p = b.pts, n = p.length >> 1;
  let best = 0, rot = GRID_ROT;
  for (let k = 0; k < n; k++) {
    const q = (k + 1) % n, dx = p[q * 2] - p[k * 2], dz = p[q * 2 + 1] - p[k * 2 + 1], L = Math.hypot(dx, dz);
    if (L > best) { best = L; rot = Math.atan2(dx, dz); }
  }
  let d = rot - GRID_ROT;
  d -= Math.round(d / (Math.PI / 2)) * (Math.PI / 2);
  return Math.abs(d) < 0.2 ? GRID_ROT + d : GRID_ROT;
}
function nearestSample(track, x, z) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < track.N; i++) {
    const d = (track.px[i] - x) ** 2 + (track.pz[i] - z) ** 2;
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}
const rotToward = (dx, dz) => Math.atan2(dx, dz); // local +z -> direction (dx, dz)

// ---------------------------------------------------------------------------
// small reusable figures (forward = local +z)
function lion(f, hi) {
  const S = '#c9b088', D = '#b59a73', M = '#a98e67', K = '#3f3426';
  f.box(-0.6, 0, -1.9, 0.6, 0.85, -0.5, S); // haunches
  f.box(-0.68, 0.15, -1.75, 0.68, 1.02, -0.7, D); // hips
  f.box(-0.55, 0, -0.6, 0.55, 0.95, 0.45, S); // torso
  f.box(-0.42, 0.95, -1.6, 0.42, 1.06, 0.3, S); // back
  f.box(-0.68, 0, 0.3, 0.68, 1.45, 1.2, D); // chest
  f.box(-0.78, 0.55, 0.4, 0.78, 1.62, 1.15, M); // mane
  f.box(-0.6, 1.62, 0.5, 0.6, 1.85, 1.05, M); // mane crest
  f.box(-0.45, 0.85, 1.1, 0.45, 1.6, 1.75, S); // head
  f.box(-0.28, 0.88, 1.7, 0.28, 1.25, 2.0, S); // muzzle
  f.box(-0.12, 1.12, 1.98, 0.12, 1.24, 2.06, K); // nose
  for (const s of [-1, 1]) {
    f.box(s * 0.16, 1.3, 1.74, s * 0.32, 1.4, 1.77, K); // eye
    f.box(s * 0.28, 1.58, 1.2, s * 0.46, 1.74, 1.4, D); // ear
    f.box(s * 0.12, 0, 1.0, s * 0.5, 0.32, 2.3, S); // foreleg
    f.box(s * 0.14, 0, 2.3, s * 0.48, 0.24, 2.45, D); // paw
    f.box(s * 0.6, 0.05, -1.6, s * 0.74, 0.62, -0.45, D); // hind thigh
    f.box(s * 0.42, 0, -0.6, s * 0.7, 0.25, 0.2, S); // hind paw
  }
  f.box(-0.1, 0, -2.3, 0.75, 0.16, -2.05, S); // tail
  f.box(0.6, 0, -2.05, 0.78, 0.16, -1.1, S);
  f.box(0.62, 0, -1.1, 0.8, 0.22, -0.8, M); // tail tuft
  if (hi) {
    for (const s of [-1, 1]) {
      f.box(s * 0.62, 1.2, 0.3, s * 0.86, 1.5, 0.75, M); // mane curls
      f.box(s * 0.55, 0.3, 0.35, s * 0.8, 0.6, 0.85, M);
      f.box(s * 0.35, 1.7, 0.35, s * 0.62, 1.95, 0.7, D);
      f.box(s * 0.45, 0.32, -1.5, s * 0.66, 0.9, -0.8, S); // flank
    }
    f.box(-0.18, 0.86, 1.95, 0.18, 0.95, 2.02, K); // mouth line
  }
}
function horse(f, col, dark, pose = 0) {
  f.box(-0.32, 0.95, -0.85, 0.32, 1.6, 0.75, col); // body
  const lift = pose === 1;
  for (const s of [-1, 1]) {
    f.box(s * 0.1, 0, -0.78, s * 0.3, 1.0, -0.52, col); // hind legs
    if (lift && s > 0) f.box(s * 0.1, 0.45, 0.62, s * 0.3, 1.0, 0.95, col);
    else f.box(s * 0.1, 0, 0.42, s * 0.3, 1.0, 0.68, col);
    f.box(s * 0.08, 2.05, 1.0, s * 0.16, 2.25, 1.1, col); // ear
  }
  f.box(-0.2, 1.35, 0.55, 0.2, 2.05, 1.0, col); // neck
  f.box(-0.15, 1.72, 0.95, 0.15, 2.12, 1.55, col); // head
  f.box(-0.06, 1.85, 0.5, 0.06, 2.12, 0.98, dark); // mane
  f.box(-0.08, 0.75, -1.05, 0.08, 1.52, -0.85, dark); // tail
}
function figure(f, h, col, armUp = 0) {
  const k = h / 1.8;
  f.box(-0.2 * k, 0, -0.12 * k, 0.2 * k, 0.85 * k, 0.12 * k, col); // legs
  f.box(-0.24 * k, 0.85 * k, -0.14 * k, 0.24 * k, 1.5 * k, 0.14 * k, col); // torso
  f.box(-0.11 * k, 1.5 * k, -0.11 * k, 0.11 * k, 1.8 * k, 0.11 * k, col); // head
  f.box(-0.34 * k, 0.8 * k, -0.08 * k, -0.24 * k, 1.45 * k, 0.08 * k, col); // arm
  if (armUp) f.box(0.24 * k, 1.35 * k, -0.08 * k, 0.34 * k, 2.15 * k, 0.08 * k, col);
  else f.box(0.24 * k, 0.8 * k, -0.08 * k, 0.34 * k, 1.45 * k, 0.08 * k, col);
}
function flag(f, u, e, y, len, h, cols, drot = 0) {
  // flag hangs off a pole at (u, e) along local direction drot, top edge at y
  const n = cols.length, sh = h / n;
  for (let k = 0; k < n; k++) f.rbox(u, e, drot, -0.03, y - (k + 1) * sh, 0.08, 0.03, y - k * sh, 0.08 + len, cols[k]);
}
function waterTower(b, x, y, z, rot, hi, seed) {
  const f = frame(b, x, y, z, rot);
  const wood = ['#7b5a3d', '#6f5038', '#86654a', '#5f4a39'][Math.floor(seed * 4) % 4];
  const steel = '#34363a', roof = seed > 0.5 ? '#3e3f42' : '#5a4636';
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(sx * 1.35, -0.3, sz * 1.35, sx * 1.55, 3.0, sz * 1.55, steel);
  f.box(-2.25, 3.0, -2.25, 2.25, 3.25, 2.25, steel);
  oct(f, 0, 0, 3.25, 7.6, 2.1, wood);
  if (hi) oct(f, 0, 0, 5.2, 5.4, 2.16, '#2b2b2d');
  oct(f, 0, 0, 7.6, 8.1, 2.25, roof);
  f.box(-1.45, 8.1, -1.45, 1.45, 8.7, 1.45, roof);
  f.box(-0.7, 8.7, -0.7, 0.7, 9.2, 0.7, roof);
  f.box(-0.08, 9.2, -0.08, 0.08, 9.8, 0.08, steel);
}
function bistroSet(b, x, y, z, rot, n) {
  const f = frame(b, x, y, z, rot), G = '#2f5c3c', T = '#33503c';
  f.box(-0.05, 0, -0.05, 0.05, 0.72, 0.05, T);
  f.box(-0.33, 0.72, -0.33, 0.33, 0.76, 0.33, G);
  for (let k = 0; k < n; k++) {
    const c = f.sub(0, 0, 0, (k / n) * Math.PI * 2 + 0.4);
    c.box(-0.2, 0.44, 0.48, 0.2, 0.49, 0.88, G);
    c.box(-0.2, 0.49, 0.84, 0.2, 0.9, 0.88, G);
    c.box(-0.03, 0, 0.66, 0.03, 0.44, 0.7, G);
  }
}
function carriage(b, x, y, z, rot, seed, hi) {
  const f = frame(b, x, y, z, rot);
  const K = '#151619', R = '#7a1d24', W = '#2b2b2e';
  for (const s of [-1, 1]) {
    f.box(s * 0.84, 0, -2.0, s * 0.96, 1.3, -0.8, W); // rear wheel
    f.box(s * 0.8, 0, 0.35, s * 0.9, 0.9, 1.1, W); // front wheel
    f.box(s * 0.44, 0.9, 1.0, s * 0.5, 1.0, 2.9, '#4a3a28'); // shafts
  }
  f.box(-0.72, 0.55, -2.0, 0.72, 0.75, 1.3, K);
  f.box(-0.8, 0.75, -1.9, 0.8, 1.45, 0.2, K);
  f.box(-0.72, 1.2, -1.6, 0.72, 1.26, 0.1, R); // seat
  f.box(-0.82, 1.45, -2.25, 0.82, 2.05, -1.5, K); // folded hood
  f.box(-0.6, 0.75, 0.2, 0.6, 1.7, 0.9, K); // driver box
  if (hi) {
    f.box(-0.22, 1.7, 0.3, 0.22, 2.35, 0.7, '#2c2f3a'); // driver
    f.box(-0.12, 2.35, 0.4, 0.12, 2.6, 0.62, '#d6b08e');
    f.box(-0.14, 2.6, 0.38, 0.14, 2.88, 0.64, K); // top hat
    for (const s of [-1, 1]) f.box(s * 0.82, 1.5, 0.15, s * 0.92, 1.72, 0.3, '#e8c86a');
  }
  const hc = ['#f1ece2', '#6b4a32', '#2a2420', '#a8a29a', '#8a5a36'][Math.floor(seed * 5) % 5];
  horse(f.sub(0, 0, 3.0), hc, hc === '#2a2420' ? '#111' : '#3a2a1e');
  f.box(-0.34, 1.15, 2.1, 0.34, 1.32, 2.35, K); // harness
}

// ---------------------------------------------------------------------------
// state shared between prepare() and build()
let S = null;

function analyse(ctx) {
  const city = ctx.city;
  const s = { city, removed: new Set(), plazaBase: null, stpatRot: GRID_ROT, oneTS: null, tkts: null };
  const [px, pz] = ctx.project(...LL.plaza);
  for (const b of city.buildings) {
    if (b.area > 3000 && b.h >= 45 && b.h <= 70 && pipF(px, pz, b.pts) && (!s.plazaBase || b.h > s.plazaBase.h)) s.plazaBase = b;
  }
  const [sx, sz] = ctx.project(...LL.stpat);
  const spire = city.buildings.find((b) => b.part && b.h > 60 && Math.hypot(b.cx - sx, b.cz - sz) < 25);
  if (spire) s.stpatRot = footprintRot(spire);
  const [ox, oz] = ctx.project(...LL.oneTS);
  let bd = 30;
  for (const b of city.buildings) {
    const d = Math.hypot(b.cx - ox, b.cz - oz);
    if (b.h > 80 && d < bd) { bd = d; s.oneTS = b; }
  }
  return s;
}
function state(ctx) {
  if (!S || S.city !== ctx.city) S = analyse(ctx);
  return S;
}

// Footprints replaced by hand-built landmarks.
function replaced(ctx, s, b) {
  const P = (k) => ctx.project(...LL[k]);
  const inRect = (k, u0, u1, e0, e1) => {
    const [ox, oz] = P(k);
    const [u, e] = gridLocal(b.cx, b.cz, ox, oz);
    return u >= u0 && u <= u1 && e >= e0 && e <= e1;
  };
  if (inRect('nypl', -114, 1, -48.5, 40)) return true; // library and its parts
  if (b.part && b.h > 30 && inRect('stpat', -24, 24, -6, 90)) return true; // cathedral spires (outline already dropped)
  if (inRect('esb', -1, 60.5, -1, 130.5)) return true;
  if (inRect('chrysler', -1, 63.5, -1, 65)) return true;
  const near = (k, r) => { const [x, z] = P(k); return Math.hypot(b.cx - x, b.cz - z) < r; };
  if (b.h <= 8 && near('tkts', 6)) return true;
  if (b.h < 30 && near('columbus', 6)) return true;
  const pb = s.plazaBase;
  if (pb && b !== pb && b.h > pb.h + 2 && pipF(b.cx, b.cz, pb.pts)) return true; // OSM mansard blocks
  return false;
}

// ---------------------------------------------------------------------------
// 1. New York Public Library (Stephen A. Schwarzman Building)
function buildLibrary(ctx) {
  const hi = ctx.hi;
  const [ox, oz] = ctx.project(...LL.nypl);
  const f0 = frame(null, ox, 0, oz, GRID_ROT);
  const cx = f0.wx(-56, -5), cz = f0.wz(-56, -5);
  const b = ctx.boxes(cx, cz);
  const y = ctx.groundY(f0.wx(-56, 40), f0.wz(-56, 40));
  const f = frame(b, ox, y, oz, GRID_ROT);
  // warm Vermont marble with real contrast: shadowed recesses, darker roofs and bronze
  const MB = '#dcd2bc', MS = '#c4b9a2', ML = '#f0e9d9', RF = '#5d646c', WN = '#262a31', DK = '#1c1a19', GR = '#b9b09f', BZ = '#6e5a3a';
  const RU = '#b8ad97'; // rustication joints

  // main block, rusticated base, cornice, parapet, attic roof
  f.box(-113.3, 0, -47.5, 0, 22, 32.7, MB);
  f.box(-113.6, 0, -47.8, 0.3, 5, 33.0, MS);
  f.box(-113.9, 22, -48.1, 0.6, 23.2, 33.3, ML);
  f.box(-113.3, 23.2, -47.5, 0, 24.4, 32.7, MB);
  f.box(-110, 24.4, -44.5, -3.3, 26.4, 29.7, RF);
  // Rose Main Reading Room block over the west half
  f.box(-104, 22, -44, -10, 31, -14, MB);
  f.box(-104.5, 31, -44.5, -9.5, 32.4, -13.5, RF);
  for (let u = -100; u <= -16; u += 6) {
    f.box(u, 24, -44.15, u + 2.6, 29.4, -43.95, WN);
    f.box(u + 0.4, 29.4, -44.15, u + 2.2, 30.1, -43.95, WN);
    if (hi) f.box(u, 24, -14.05, u + 2.6, 29.4, -13.85, WN);
  }
  // end pavilions on 5th Ave
  for (const [u0, u1] of [[-113.7, -97], [-16.3, 0.4]]) {
    const c = (u0 + u1) / 2;
    f.box(u0, 0, 30, u1, 24, 34.6, MB);
    f.box(u0 - 0.3, 24, 29.7, u1 + 0.3, 25.2, 34.9, ML);
    f.box(c - 2.5, 7, 34.6, c + 2.5, 16, 34.75, WN);
    f.box(c - 1.8, 16, 34.6, c + 1.8, 16.8, 34.75, WN);
    f.box(c - 1, 16.8, 34.6, c + 1, 17.4, 34.75, WN);
    for (const du of [-6.2, -4.6, 4.6, 6.2]) f.box(c + du - 0.5, 5, 34.6, c + du + 0.5, 21, 35.5, ML);
    f.box(c - 7, 21, 34.6, c + 7, 22.4, 35.7, ML);
  }
  // windows on the 5th Ave wings
  for (const [u0, u1] of [[-96, -73], [-43.5, -17]]) {
    for (let u = u0 + 1; u + 2 <= u1; u += 4.5) {
      f.box(u, 7.5, 32.7, u + 2, 15.5, 32.85, WN);
      f.box(u + 0.4, 15.5, 32.7, u + 1.6, 16.2, 32.85, WN);
      if (hi) f.box(u + 0.3, 2.2, 32.95, u + 1.7, 4.2, 33.1, WN);
      if (hi) f.box(u + 2.6, 5, 32.7, u + 3.4, 21.5, 33.2, ML); // pilaster
    }
  }
  // north facade on 42nd St (faces the course) and south facade on 40th St
  for (const [uf, d] of [[0, 1], [-113.3, -1]]) {
    if (d < 0 && !hi) continue;
    for (let e = -43; e <= 28; e += 5) {
      const a = uf + (d > 0 ? 0.3 : -0.3), o = a + d * 0.15;
      f.box(a, 2.2, e, o, 4.4, e + 2, WN);
      f.box(a, 8, e, o, 14.5, e + 2, WN);
      f.box(a, 14.5, e + 0.4, o, 15.2, e + 1.6, WN);
      if (hi) f.box(a, 17.5, e + 0.2, o, 20.2, e + 1.8, WN);
    }
  }
  // rusticated base courses and pilasters between the 42nd St windows, so the long
  // facade along the course reads as Beaux-Arts stonework rather than a plain box
  for (let yy = 0.6; yy < 5; yy += 0.75) {
    f.box(-113.5, yy, 32.75, 0.2, yy + 0.12, 32.95, RU); // 5th Ave front
    f.box(0.02, yy, -47.6, 0.25, yy + 0.12, 32.8, RU); // 42nd St side
  }
  for (let e = -45.5; e <= 30; e += 5) f.box(0, 5, e, 0.55, 21.5, e + 0.9, ML);
  f.box(0, 16.2, -47.5, 0.5, 16.6, 32.7, ML); // string course
  // balustrade along the roof edge
  if (hi) for (let e = -47; e < 32.5; e += 1.1) f.box(-0.5, 23.2, e, -0.1, 24.1, e + 0.45, ML);
  // stack-building back toward Bryant Park: narrow vertical windows
  if (hi) for (let u = -108; u <= -6; u += 3) f.box(u, 3, -48.0, u + 1, 20.5, -47.8, WN);

  // central portico: three arches, paired end columns, attic with statues
  f.box(-72.5, 0, 32.7, -44.1, 1.8, 39.6, GR);
  for (const [u0, u1] of [[-72.2, -67.4], [-63.0, -60.5], [-56.1, -53.7], [-49.3, -44.4]]) f.box(u0, 1.8, 33, u1, 15, 37.3, MB);
  for (const [u0, u1] of [[-67.4, -63.0], [-60.5, -56.1], [-53.7, -49.3]]) {
    f.box(u0, 11.6, 33, u1, 15, 37.3, MB);
    f.box(u0, 10.4, 33, u0 + 0.7, 11.6, 37.3, MB);
    f.box(u1 - 0.7, 10.4, 33, u1, 11.6, 37.3, MB);
    f.box(u0, 1.8, 31.6, u1, 10.4, 33, DK); // deep arch recess
    f.box(u0 + 0.9, 1.8, 32.8, u1 - 0.9, 7.5, 33.1, BZ); // bronze doors
  }
  for (const u of [-71.0, -68.6, -61.75, -54.9, -48.0, -45.6]) {
    if (hi) oct(f, u, 38.1, 1.8, 14.6, 0.75, ML);
    else f.box(u - 0.7, 1.8, 37.4, u + 0.7, 14.6, 38.8, ML);
    f.box(u - 0.95, 1.8, 37.15, u + 0.95, 2.3, 39.05, MS);
    f.box(u - 0.95, 13.8, 37.15, u + 0.95, 14.6, 39.05, ML);
  }
  f.box(-72.6, 14.6, 32.7, -44.0, 16.6, 39.3, MB);
  f.box(-72.9, 16.6, 32.7, -43.7, 17.3, 39.6, ML);
  f.box(-72.2, 17.3, 32.7, -44.4, 21.5, 38.6, MB);
  f.box(-70, 21.5, 33, -46.6, 22.6, 38, ML);
  for (const u of [-69.8, -61.75, -54.9, -46.8]) {
    figure(f.sub(u, 17.3, 38.9), 2.8, '#ede7da');
    if (hi && (u === -69.8 || u === -46.8)) figure(f.sub(u + (u < -60 ? 2.3 : -2.3), 17.3, 38.9), 2.8, '#ede7da');
  }

  // terrace, balustrade, front steps
  f.box(-110, 0, 39.1, -6, 1.8, 45.4, GR);
  for (const [u0, u1] of [[-110, -66.6], [-50.6, -6]]) {
    f.box(u0, 0, 45.4, u1, 1.8, 46, MS);
    if (hi) {
      for (let u = u0 + 0.3; u < u1; u += 1.2) f.box(u, 1.8, 45.5, u + 0.35, 2.6, 45.9, ML);
      f.box(u0, 2.6, 45.4, u1, 2.9, 46, ML);
    } else f.box(u0, 1.8, 45.5, u1, 2.9, 45.9, ML);
  }
  for (let k = 0; k < 9; k++) f.box(-66.6, 0, 42 + k * 0.9, -50.6, 1.8 - k * 0.2, 42 + (k + 1) * 0.9, k % 2 ? GR : MS);

  // the lions, Patience (south) and Fortitude (north), facing 5th Ave
  for (const k of ['patience', 'fortitude']) {
    const [lx, lz] = ctx.project(...LL[k]);
    const [u, e] = gridLocal(lx, lz, ox, oz);
    f.box(u - 0.95, 0, e - 2.5, u + 0.95, 2.1, e + 2.7, '#d6cebd');
    f.box(u - 1.05, 2.1, e - 2.6, u + 1.05, 2.3, e + 2.8, ML);
    lion(f.sub(u, 2.3, e + 0.1), hi);
  }

  // flagpoles on the terrace
  for (const u of [-84, -32]) {
    f.box(u - 0.6, 1.8, 42, u + 0.6, 3.4, 43.2, BZ);
    f.box(u - 0.12, 3.4, 42.48, u + 0.12, 19.5, 42.72, '#d8d8d0');
    f.box(u - 0.22, 19.5, 42.38, u + 0.22, 19.9, 42.82, '#d4a940');
    flag(f, u, 42.6, 19.3, 3.0, 1.9, ['#1d4fa8', '#f4f1ea', '#e57a24'], Math.PI / 2 + 0.5);
  }
}

// 2. Bryant Park: plane-tree allées, lawn hedges, Le Carrousel, Lowell Fountain, bistro chairs
function buildBryantPark(ctx) {
  const hi = ctx.hi, props = ctx.props;
  const [ox, oz] = ctx.project(...LL.bryant);
  const W = (u, e) => [ox + u * SG + e * CG, oz - u * CG + e * SG];
  const [carX, carZ] = ctx.project(...LL.carrousel);
  const [fx, fz] = ctx.project(...LL.lowell);
  const [cu, ce] = gridLocal(carX, carZ, ox, oz);
  const [fu, fe] = gridLocal(fx, fz, ox, oz);
  const blocked = (x, z, r) => Math.hypot(x - carX, z - carZ) < r + 7 || Math.hypot(x - fx, z - fz) < r + 6 || S.buildingAt(x, z, 0);
  let seed = 1;
  const tree = (u, e, big) => {
    const [x, z] = W(u, e);
    seed++;
    if (blocked(x, z, 2)) return;
    const b = ctx.boxes(x, z), y = ctx.groundY(x, z), h = ctx.hash2(Math.round(u * 10), Math.round(e * 10), 11);
    if (big && props.parkTree) props.parkTree(b, x, y, z, seed, 0.95 + h * 0.2);
    else props.streetTree(b, x, y, z, seed, 1.1 + h * 0.2);
  };
  const step = hi ? 8.5 : 12.75;
  // allées: double rows along the 40th and 42nd St sides of the lawn
  for (const u of [21, 29.5, 107, 115.5]) for (let e = -128; e <= -40; e += step) tree(u, e, true);
  // 6th Ave edge and the upper terrace behind the library
  for (let u = 12; u <= 126; u += hi ? 9 : 13.5) { tree(u, -160, true); if (hi) tree(u + 4.5, -152, false); }
  for (const u of [10, 126]) for (let e = -32; e <= -8; e += hi ? 8 : 12) tree(u, e, false);

  // central lawn: low boxwood hedges on its edge (gaps at the middle of each side)
  const lu0 = 38, lu1 = 98, le0 = -127, le1 = -42;
  const hedge = (u0, e0, u1, e1) => {
    const [x, z] = W((u0 + u1) / 2, (e0 + e1) / 2);
    const f = frame(ctx.boxes(x, z), ox, ctx.groundY(x, z), oz, GRID_ROT);
    f.box(u0, 0, e0, u1, 0.8, e1, '#2f5a2c');
    if (hi) f.box(u0 + 0.15, 0.8, e0 + 0.15, u1 - 0.15, 0.95, e1 - 0.15, '#3d6d36');
  };
  const mu = (lu0 + lu1) / 2, me = (le0 + le1) / 2;
  for (const u of [lu0 - 1, lu1]) { hedge(u, le0, u + 1, me - 3); hedge(u, me + 3, u + 1, le1); }
  for (const e of [le0 - 1, le1]) { hedge(lu0, e, mu - 3, e + 1); hedge(mu + 3, e, lu1, e + 1); }

  // Le Carrousel
  {
    const b = ctx.boxes(carX, carZ), y = ctx.groundY(carX, carZ);
    const f = frame(b, carX, y, carZ, GRID_ROT);
    const CR = '#f1e6c8', RD = '#b8323a', AU = '#d8b04a';
    oct(f, 0, 0, 0, 0.6, 4.4, '#8d7a62');
    oct(f, 0, 0, 0.6, 3.5, 0.9, AU);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      f.box(Math.cos(a) * 4.0 - 0.1, 0.6, Math.sin(a) * 4.0 - 0.1, Math.cos(a) * 4.0 + 0.1, 3.2, Math.sin(a) * 4.0 + 0.1, AU);
      if (hi) {
        const hf = f.sub(Math.cos(a) * 2.7, 0.9, Math.sin(a) * 2.7, -a);
        hf.box(-0.03, 0, -0.03, 0.03, 2.3, 0.03, AU);
        horse(hf.sub(0, -0.2, 0, 0, b), ['#f4efe6', '#c9a46a', '#e4d2b0', '#8e5e3a'][k % 4], '#5a3d2a', k % 2);
      } else {
        const hx = Math.cos(a) * 2.7, hz = Math.sin(a) * 2.7;
        f.box(hx - 0.3, 1.0, hz - 0.3, hx + 0.3, 1.8, hz + 0.3, '#f4efe6');
      }
    }
    oct(f, 0, 0, 3.2, 3.9, 4.7, RD);
    oct(f, 0, 0, 3.9, 4.6, 3.5, CR);
    oct(f, 0, 0, 4.6, 5.3, 2.1, RD);
    oct(f, 0, 0, 5.3, 6.0, 0.9, CR);
    f.box(-0.08, 6.0, -0.08, 0.08, 7.2, 0.08, AU);
    f.box(0.08, 6.6, -0.03, 0.9, 7.1, 0.03, RD);
    if (hi) { const g = frame(ctx.boxes(carX, carZ, 'glow'), carX, y, carZ, GRID_ROT); ring(g, 0, 0, 3.3, 3.45, 4.75, 0.08, 16, '#ffe2a0'); }
  }

  // Josephine Shaw Lowell Fountain
  {
    const b = ctx.boxes(fx, fz), y = ctx.groundY(fx, fz);
    const f = frame(b, fx, y, fz, GRID_ROT);
    const GN = '#b9b2a5';
    oct(f, 0, 0, 0, 0.42, 4.3, '#5d8fb5');
    ring(f, 0, 0, 0, 0.7, 4.6, 0.6, hi ? 16 : 10, GN);
    oct(f, 0, 0, 0, 1.6, 0.9, GN);
    oct(f, 0, 0, 1.6, 2.0, 1.9, GN);
    oct(f, 0, 0, 1.75, 2.05, 1.6, '#5d8fb5');
    oct(f, 0, 0, 2.0, 2.6, 0.5, GN);
    f.box(-0.12, 2.6, -0.12, 0.12, 3.5, 0.12, '#e3f2fb');
  }

  // green bistro chairs and tables along the allées and on the upper terrace
  const sets = hi ? 34 : 12;
  for (let k = 0; k < sets; k++) {
    const h1 = ctx.hash2(k, 3, 41), h2 = ctx.hash2(k, 7, 41);
    let u, e;
    if (k % 3 === 0) { u = 14 + h1 * 108; e = -28 + h2 * 22; } else { u = k % 3 === 1 ? 25.25 : 111.25; e = -124 + h2 * 82; u += (h1 - 0.5) * 3; }
    const [x, z] = W(u, e);
    if (blocked(x, z, 1)) continue;
    bistroSet(ctx.boxes(x, z), x, ctx.groundY(x, z), z, h1 * 6, 2 + (k % 2));
  }
}

// 3. St Patrick's Cathedral
function buildStPatricks(ctx) {
  const hi = ctx.hi, rot = S.stpatRot;
  const [ox, oz] = ctx.project(...LL.stpat);
  const f0 = frame(null, ox, 0, oz, rot);
  const cx = f0.wx(0, 40), cz = f0.wz(0, 40);
  const y = ctx.groundY(f0.wx(0, -5), f0.wz(0, -5));
  const f = frame(ctx.boxes(cx, cz), ox, y, oz, rot);
  const fg = frame(ctx.boxes(cx, cz, 'glow'), ox, y, oz, rot);
  const ST = '#dcd8ce', SH = '#c7c2b7', SL = '#5c6b66', DK = '#2a2c33', BR = '#4e3d2b', AU = '#d8b24a';

  // nave, aisles, transept, choir, Lady Chapel
  f.box(-8.5, 0, -1, 8.5, 31, 61.6, ST);
  f.box(-7.5, 0, 61.6, 7.5, 31, 78, ST);
  f.box(-18.9, 0, -1, 18.9, 17, 38.6, SH);
  for (const s of [-1, 1]) { f.box(s * 8.5, 17, -0.5, s * 19.2, 18.5, 38.6, SL); f.box(s * 8.5, 18.5, -0.5, s * 14, 20, 38.6, SL); }
  f.box(-22.7, 0, 41.6, 23.3, 31, 58.6, ST);
  f.box(-22.7, 0, 38.6, 23.3, 17, 61.6, SH);
  f.box(-22.9, 17, 38.4, 23.5, 18.4, 61.8, SL);
  ridgeRoof(f, -8.9, 8.9, -0.5, 78.2, 31, 9.5, hi ? 6 : 4, SL);
  ridgeRoof(f, 41.2, 59, -23.1, 23.7, 31, 9.5, hi ? 6 : 4, SL, true);
  f.box(-6.8, 0, 78, 6.8, 22, 84, ST);
  oct(f, 0, 83.4, 0, 22, 6.3, ST);
  ridgeRoof(f, -7, 7, 78, 84, 22, 5, 3, SL);
  oct(f, 0, 83.4, 22, 23.5, 5.6, SL);
  oct(f, 0, 83.4, 23.5, 25.5, 3.4, SL);
  oct(f, 0, 83.4, 25.5, 27, 1.4, SL);

  // west front: gable, portal, rose window
  f.box(-9.3, 0, -4.3, 9.3, 36, -1, ST);
  for (const [w, y0, y1] of [[7.4, 36, 39], [5.6, 39, 41.5], [3.8, 41.5, 43.5], [2, 43.5, 45.2], [0.7, 45.2, 46.5]]) f.box(-w, y0, -4.3, w, y1, -1.5, ST);
  f.box(-0.3, 46.5, -3.2, 0.3, 49, -2.6, ST);
  f.box(-4.4, 0, -5.6, 4.4, 13, -4.3, SH);
  f.box(-2.6, 0, -5.75, 2.6, 7.5, -5.6, BR);
  f.box(-2.0, 7.5, -5.75, 2.0, 9.2, -5.6, DK);
  f.box(-1.2, 9.2, -5.75, 1.2, 10.4, -5.6, DK);
  f.box(-0.5, 10.4, -5.75, 0.5, 11.2, -5.6, DK);
  for (const [w, y0, y1] of [[4.4, 13, 14.2], [3.3, 14.2, 15.6], [2.2, 15.6, 17], [1.1, 17, 18.2], [0.4, 18.2, 19.4]]) f.box(-w, y0, -5.6, w, y1, -4.3, SH);
  const rose = (plane, cu, ce, yc, R, face, d) => {
    // plane 'e': window on a face normal to e (west front); 'u': on a face normal to u (transept ends)
    const pal = ['#ffd36b', '#d93a4a', '#3a63d9', '#8e3ad9', '#2f9fd9', '#3aa86b'];
    const cell = 0.9, n = Math.floor(R / cell);
    const put = (a0, y0, a1, y1, col) => {
      if (plane === 'e') fg.box(cu + a0, y0, face, cu + a1, y1, face + d, col);
      else fg.box(face, y0, ce + a0, face + d, y1, ce + a1, col);
    };
    if (!hi) {
      put(-R, yc - R * 0.5, R, yc + R * 0.5, pal[2]);
      put(-R * 0.5, yc - R, R * 0.5, yc + R, pal[2]);
      put(-R * 0.72, yc - R * 0.72, R * 0.72, yc + R * 0.72, pal[1]);
      put(-R * 0.25, yc - R * 0.25, R * 0.25, yc + R * 0.25, pal[0]);
      return;
    }
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const r = Math.hypot(i, j) * cell;
      if (r > R) continue;
      const spoke = i === 0 || j === 0 || Math.abs(i) === Math.abs(j);
      const col = r < 0.6 ? pal[0] : spoke ? '#f3e2b0' : pal[1 + (Math.floor(r / 1.15) % 5)];
      put(i * cell - 0.42, yc + j * cell - 0.42, i * cell + 0.42, yc + j * cell + 0.42, col);
    }
    if (plane === 'e') vring(f, cu, yc, face + d / 2, R + 0.45, 20, 0.35, 0.25, SH, 'u');
    else vring(f, face + d / 2, yc, ce, R + 0.45, 20, 0.35, 0.25, SH, 'e');
  };
  rose('e', 0, 0, 25.5, 4.3, -4.48, 0.2);

  // twin towers with octagonal spires (to 100.5 m)
  for (const s of [-1, 1]) {
    const cu = s * 14.2, ce = 0.9;
    f.box(cu - 4.9, 0, -4.3, cu + 4.9, 58, 6.1, ST);
    f.box(cu - 5.3, 56, -4.7, cu + 5.3, 58, 6.5, SH);
    for (const sx of [-1, 1]) for (const se of [-1, 1]) {
      const pu = cu + sx * 4.9, pe = se < 0 ? -4.3 : 6.1;
      f.box(pu - 0.9, 0, pe - 0.9, pu + 0.9, 52, pe + 0.9, SH);
      f.box(pu - 0.6, 52, pe - 0.6, pu + 0.6, 61, pe + 0.6, ST);
      if (hi) f.box(pu - 0.3, 61, pe - 0.3, pu + 0.3, 65, pe + 0.3, ST);
    }
    // belfry lancets and lower windows (west + outer faces)
    for (const du of [-2, 2]) {
      f.box(cu + du - 0.8, 40, -4.45, cu + du + 0.8, 53, -4.3, DK);
      f.box(cu + du - 0.45, 53, -4.45, cu + du + 0.45, 54.2, -4.3, DK);
      f.box(cu + du - 0.6, 22, -4.45, cu + du + 0.6, 30, -4.3, DK);
    }
    for (const de of [-0.8, 2.6]) {
      f.box(cu + s * 4.9, 40, de - 0.8, cu + s * 5.05, 53, de + 0.8, DK);
      f.box(cu + s * 4.9, 53, de - 0.45, cu + s * 5.05, 54.2, de + 0.45, DK);
    }
    f.box(cu - 2.6, 0, -5.0, cu + 2.6, 9, -4.3, SH);
    f.box(cu - 1.4, 0, -5.1, cu + 1.4, 5.5, -5.0, BR);
    f.box(cu - 0.8, 5.5, -5.1, cu + 0.8, 6.6, -5.0, DK);
    const n = hi ? 12 : 7, top = 100.5;
    for (let k = 0; k < n; k++) {
      const y0 = 58 + (k * (top - 58)) / n, y1 = 58 + ((k + 1) * (top - 58)) / n;
      oct(f, cu, ce, y0, y1, 4.6 * (1 - k / n) + 0.25, k % 2 ? ST : SH);
    }
    if (hi) for (const [du, de] of [[0, -4.0], [0, 5.8], [-4.0, ce], [4.0, ce]]) f.box(cu + du - 0.7, 58, de - 0.7, cu + du + 0.7, 63.5, de + 0.7, ST); // lucarnes
    f.box(cu - 0.12, top, ce - 0.12, cu + 0.12, top + 2.6, ce + 0.12, AU);
    f.box(cu - 0.7, top + 1.6, ce - 0.12, cu + 0.7, top + 1.9, ce + 0.12, AU);
  }

  // transept end fronts: gables, rose windows, corner turrets
  for (const [uf, s] of [[23.3, 1], [-22.7, -1]]) {
    const fin = uf - s * 0.8;
    for (const [w, y0, y1] of [[8.5, 31, 34], [6.5, 34, 36.5], [4.5, 36.5, 38.5], [2.5, 38.5, 40], [0.8, 40, 41.5]]) f.box(fin, y0, 50.1 - w, uf, y1, 50.1 + w, ST);
    rose('u', 0, 50.1, 22, 3.6, s > 0 ? uf : uf - 0.2, 0.2);
    f.box(uf, 0, 47.4, uf + s * 1.2, 11, 52.8, SH);
    f.box(uf + s * 1.2, 0, 48.6, uf + s * 1.35, 7, 51.6, BR);
    for (const e of [41.6, 58.6]) {
      oct(f, uf - s * 0.3, e, 0, 38, 1.4, SH);
      oct(f, uf - s * 0.3, e, 38, 41, 0.9, ST);
      oct(f, uf - s * 0.3, e, 41, 45, 0.45, ST);
    }
  }

  // flying buttresses, pinnacles, windows along the nave
  for (let e = 4; e < 37; e += 6.5) {
    const em = e + 3.25;
    for (const s of [-1, 1]) {
      if (em < 38) f.box(s * 18.9, 4, em - 1.1, s * 19.05, 13, em + 1.1, DK);
      if (!hi) continue;
      f.box(s * 18.9, 0, e - 0.7, s * 20.4, 22, e + 0.7, SH);
      f.box(s * 19.25, 22, e - 0.4, s * 20.05, 26.5, e + 0.4, ST);
      f.box(s * 15.4, 21, e - 0.35, s * 18.9, 22.6, e + 0.35, SH);
      f.box(s * 12, 22.6, e - 0.35, s * 15.4, 24.2, e + 0.35, SH);
      f.box(s * 8.5, 24.2, e - 0.35, s * 12, 25.8, e + 0.35, SH);
      f.box(s * 8.1, 31, e - 0.35, s * 8.9, 34.5, e + 0.35, ST);
      if (em < 38) f.box(s * 8.5, 20.5, em - 1, s * 8.65, 28.5, em + 1, DK);
    }
  }
  if (hi) for (let e = 64; e < 78; e += 5) for (const s of [-1, 1]) f.box(s * 7.5, 6, e - 1, s * 7.65, 26, e + 1, DK);
}

// 4. Rockefeller Center: Channel Gardens, lower plaza + Prometheus + flags, Atlas
function buildRockefeller(ctx) {
  const hi = ctx.hi;
  const [ox, oz] = ctx.project(...LL.channel);
  const f0 = frame(null, ox, 0, oz, GRID_ROT);
  const pcx = f0.wx(-3, -20), pcz = f0.wz(-3, -20);
  const y = ctx.groundY(pcx, pcz);
  const b = ctx.boxes(pcx, pcz);
  const f = frame(b, ox, y, oz, GRID_ROT);
  const GN = '#a69e91', GD = '#e0b040';
  const flowers = ['#e8c547', '#d94a6a', '#f2f0ea', '#b55ad6', '#f08a3c', '#e05b4b'];

  // Channel Gardens: six granite planters with flower beds and fountain heads
  for (let k = 0; k < 6; k++) {
    const e0 = 2.5 + k * 6.9, e1 = e0 + 5.6;
    f.box(-5.9, 0, e0, -0.2, 0.55, e1, GN);
    f.box(-5.5, 0.55, e0 + 0.4, -0.6, 0.62, e1 - 0.4, '#4b6b33');
    const n = hi ? 6 : 2;
    for (let j = 0; j < n; j++) {
      const ea = e0 + 0.5 + (j * (e1 - e0 - 1)) / n, eb = ea + (e1 - e0 - 1) / n - 0.1;
      f.box(-5.3, 0.62, ea, -3.15, 0.95, eb, flowers[(k + j) % 6]);
      f.box(-2.95, 0.62, ea, -0.8, 0.95, eb, flowers[(k + j + 3) % 6]);
    }
    if (hi) f.box(-3.35, 0.55, e0 - 0.3, -2.75, 1.4, e0 + 0.2, '#6b5a35');
  }

  // lower plaza: rink, rim, railing and ring of flags at street level
  const u0 = -15.5, u1 = 8.5, e0 = -40.5, e1 = -1.5;
  f.box(u0, 0, e0, u1, 0.04, e1, '#a59d90');
  f.box(-12.5, 0.04, -33, 5.5, 0.12, -5, '#e9eff3');
  f.box(-12.7, 0, -33.2, 5.7, 0.6, -32.9, '#f3f3f3');
  f.box(-12.7, 0, -5.1, 5.7, 0.6, -4.8, '#f3f3f3');
  f.box(-12.8, 0, -33.2, -12.5, 0.6, -4.8, '#f3f3f3');
  f.box(5.5, 0, -33.2, 5.8, 0.6, -4.8, '#f3f3f3');
  const rail = (a0, b0, a1, b1) => {
    f.box(a0, 1.0, b0, a1, 1.12, b1, '#3d3a34');
    if (hi) {
      const L = Math.hypot(a1 - a0, b1 - b0), n = Math.max(1, Math.round(L / 2));
      for (let k = 0; k <= n; k++) { const t = k / n, a = a0 + (a1 - a0) * t, c = b0 + (b1 - b0) * t; f.box(a - 0.05, 0, c - 0.05, a + 0.05, 1.0, c + 0.05, '#3d3a34'); }
    }
  };
  rail(u0, e0, u1, e0 + 0.1);
  rail(u0, e0, u0 + 0.1, e1);
  rail(u1 - 0.1, e0, u1, e1);
  rail(u0, e1 - 0.1, -6.5, e1);
  rail(0.4, e1 - 0.1, u1, e1);
  // ~30 flagpoles around the plaza (plain colour flags, no national flags)
  const flagCols = ['#c8102e', '#1d4fa8', '#f2c230', '#2f8f4e', '#f4f1ea', '#e57a24', '#6a2c91', '#1aa3c4', '#d94a8a', '#222'];
  const per = [];
  const addSide = (ua, ea, ub, eb, n) => { for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; per.push([ua + (ub - ua) * t, ea + (eb - ea) * t]); } };
  addSide(u0 - 0.6, e0 - 0.6, u0 - 0.6, e1 + 0.6, 10);
  addSide(u1 + 0.6, e0 - 0.6, u1 + 0.6, e1 + 0.6, 10);
  addSide(u0 - 0.6, e0 - 0.6, u1 + 0.6, e0 - 0.6, 6);
  addSide(u0, e1 + 0.6, -7, e1 + 0.6, 2);
  addSide(1, e1 + 0.6, u1, e1 + 0.6, 2);
  per.forEach(([u, e], k) => {
    f.box(u - 0.07, 0, e - 0.07, u + 0.07, 9.5, e + 0.07, '#d9d9d4');
    f.box(u - 0.12, 9.5, e - 0.12, u + 0.12, 9.75, e + 0.12, GD);
    const c1 = flagCols[k % flagCols.length], c2 = flagCols[(k * 3 + 1) % flagCols.length];
    flag(f, u, e, 9.4, 1.7, 1.1, hi ? [c1, c2, c1] : [c1], -Math.PI / 2 + 0.25);
  });
  if (hi) for (let k = 0; k < 8; k++) {
    const u = -11 + ctx.hash2(k, 1, 77) * 15, e = -31 + ctx.hash2(k, 2, 77) * 24;
    const col = flagCols[k % flagCols.length];
    f.box(u - 0.2, 0.12, e - 0.15, u + 0.2, 1.1, e + 0.15, '#2e3340');
    f.box(u - 0.22, 1.1, e - 0.17, u + 0.22, 1.55, e + 0.17, col);
    f.box(u - 0.1, 1.55, e - 0.1, u + 0.1, 1.8, e + 0.1, '#d6b08e');
  }

  // Prometheus: gilded figure in flight through the zodiac ring, over a fountain
  {
    const [px, pz] = ctx.project(...LL.prometheus);
    const p = frame(ctx.boxes(px, pz), px, y, pz, GRID_ROT);
    p.box(-9, 0, -3.5, 9, 7, -1.5, '#8f8578');
    p.box(-9.3, 7, -3.7, 9.3, 7.4, -1.3, '#9d9486');
    p.box(-8, 0, -1.5, 8, 0.7, 3.2, GN);
    p.box(-7.6, 0.7, -1.3, 7.6, 0.75, 2.8, '#5d8fb5');
    p.box(-3, 0.7, -1.5, 3, 2.5, 1, '#7c7468');
    p.box(-1.8, 2.5, -1.2, 1.8, 3.4, 0.6, '#7c7468');
    vring(p, 0, 5.3, -0.2, 3.0, hi ? 22 : 12, 0.24, 0.14, GD, 'u');
    if (hi) for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; p.box(Math.cos(a) * 3 - 0.3, 5.3 + Math.sin(a) * 3 - 0.3, -0.3, Math.cos(a) * 3 + 0.3, 5.3 + Math.sin(a) * 3 + 0.3, -0.1, '#c8963a'); }
    p.box(-1.6, 4.6, -0.5, 1.0, 5.3, 0.2, GD); // torso
    p.box(1.0, 4.85, -0.4, 1.55, 5.45, 0.15, GD); // head
    p.box(-3.0, 4.3, -0.45, -1.6, 4.8, 0.05, GD); // legs
    p.box(-2.8, 4.9, -0.3, -1.6, 5.3, 0.15, GD);
    p.box(0.55, 5.3, -0.3, 0.9, 6.4, 0.0, GD); // raised arm
    p.box(-0.8, 4.2, -0.3, -0.4, 4.6, 0.0, GD);
    const pg = frame(ctx.boxes(px, pz, 'glow'), px, y, pz, GRID_ROT);
    pg.box(0.42, 6.4, -0.4, 1.05, 6.95, 0.1, '#ff7a1a');
    pg.box(0.58, 6.95, -0.3, 0.88, 7.35, 0.0, '#ffd04a');
  }

  // Atlas (International Building courtyard, facing 5th Ave)
  {
    const [ax, az] = ctx.project(...LL.atlas);
    const ay = ctx.groundY(ax, az);
    const a = frame(ctx.boxes(ax, az), ax, ay, az, GRID_ROT);
    const BZ = '#6b5434', GB = '#c9a24a';
    a.box(-2.6, 0, -2.6, 2.6, 0.8, 2.6, '#8c8378');
    a.box(-2.1, 0.8, -2.1, 2.1, 4.2, 2.1, '#978e82');
    a.box(-2.3, 4.2, -2.3, 2.3, 4.6, 2.3, '#a59c90');
    const t = a.sub(0, 4.6, 0);
    t.box(-0.95, 0, -0.1, -0.35, 2.3, 0.5, BZ); // striding legs
    t.box(0.35, 0, -0.9, 0.95, 2.1, -0.3, BZ);
    t.box(-0.95, 2.1, -0.6, 0.95, 2.9, 0.4, BZ); // hips
    t.box(-1.0, 2.9, -0.35, 1.0, 4.7, 0.6, BZ); // torso (bent forward)
    t.box(-1.35, 4.3, -0.4, 1.35, 4.95, 0.55, BZ); // shoulders
    t.box(-0.35, 4.2, 0.45, 0.35, 4.95, 1.05, BZ); // bowed head
    for (const s of [-1, 1]) { t.box(s * 1.0, 4.8, -0.3, s * 1.5, 6.8, 0.3, BZ); t.box(s * 0.9, 6.8, -0.3, s * 1.4, 7.4, 0.3, BZ); }
    const yc = 7.6 + 2.9, R = 3.0, n = hi ? 20 : 12;
    ring(t, 0, 0, yc - 0.15, yc + 0.15, R, 0.3, n, GB);
    vring(t, 0, yc, 0, R, n, 0.17, 0.12, BZ, 'u');
    vring(t, 0, yc, 0, R, n, 0.17, 0.12, BZ, 'e');
    if (hi) for (let k = 0; k < 14; k++) {
      const q = (k / 14) * Math.PI * 2, h = R * Math.cos(q), v = R * Math.sin(q);
      t.box(h * 0.707 - 0.17, yc + v - 0.17, h * 0.707 - 0.17, h * 0.707 + 0.17, yc + v + 0.17, h * 0.707 + 0.17, GB); // tilted ecliptic band
    }
    t.box(-0.1, yc - R - 0.7, -0.1, 0.1, yc + R + 0.7, 0.1, BZ);
  }
}

// 5. The Plaza: copper mansard roof with dormers, corner turrets, flags over the entrance
function buildPlaza(ctx) {
  const pb = S.plazaBase;
  if (!pb) return;
  const hi = ctx.hi;
  const p = pb.pts, n = p.length >> 1;
  const b = ctx.boxes(pb.cx, pb.cz), g = ctx.boxes(pb.cx, pb.cz, 'glow');
  const gy = ctx.groundY(pb.cx, pb.cz);
  const y0 = gy + pb.h;
  const CU = '#72a690', CS = '#5f9380', CT = '#87b8a2', CR = '#e7e0cf', WN = '#2c3138';
  const tiers = [[0.3, 1.8, 7], [1.8, 3.2, 11], [3.2, 4.6, 14.2], [4.6, 6.2, 15.6]];
  const P = (k) => [p[(k % n) * 2], p[(k % n) * 2 + 1]];
  const dirs = [];
  for (let k = 0; k < n; k++) {
    const [ax, az] = P(k), [bx, bz] = P(k + 1), L = Math.hypot(bx - ax, bz - az);
    dirs.push(L > 1e-3 ? [(bx - ax) / L, (bz - az) / L, L] : [1, 0, 0]);
  }
  const convex = (k) => {
    k %= n;
    const [vx, vz] = P(k), a = dirs[(k - 1 + n) % n], c = dirs[k];
    let bx = c[0] - a[0], bz = c[1] - a[1];
    const l = Math.hypot(bx, bz) || 1;
    bx /= l; bz /= l;
    return { convex: pipF(vx + bx * 0.7, vz + bz * 0.7, p), bx, bz, v: [vx, vz], ok: a[2] >= 9 && c[2] >= 9 };
  };
  let entrance = null, best = -1;
  for (let k = 0; k < n; k++) {
    const [dx, dz, L] = dirs[k];
    if (L < 2.5) continue;
    const [ax, az] = P(k);
    const rot = Math.atan2(dx, dz);
    // local +x = (dz, -dx); pick the inward side
    const mx = ax + dx * L * 0.5, mz = az + dz * L * 0.5;
    const sx = pipF(mx + dz * 1.5, mz - dx * 1.5, p) ? 1 : -1;
    const f = frame(b, ax, y0, az, rot);
    const ext0 = convex(k).convex ? 0 : 6.2, ext1 = convex(k + 1).convex ? 0 : 6.2;
    for (const [a0, a1, h] of tiers) f.box(sx * a0, 0, -ext0 * (a1 / 6.2), sx * a1, h, L + ext1 * (a1 / 6.2), CU);
    f.box(sx * 4.5, 15.6, -ext0, sx * 6.4, 16.0, L + ext1, CT); // copper crest
    f.box(sx * -0.2, -0.6, 0, sx * 0.4, 0.2, L, CR); // cornice
    if (hi && L > 7) {
      for (let z = 2.6; z < L - 2; z += 4.2) {
        f.box(sx * 0.6, 7, z - 0.8, sx * 2.6, 10, z + 0.8, CR);
        f.box(sx * 0.45, 7.4, z - 0.5, sx * 0.6, 9.4, z + 0.5, WN);
        f.box(sx * 0.5, 10, z - 0.95, sx * 2.7, 10.5, z + 0.95, CS);
      }
    }
    // entrance: longest edge whose outside faces Grand Army Plaza (east)
    const ox = -sx * dz, oz = sx * dx; // outward normal
    const score = (ox * CG + oz * SG) * (L > 20 ? 1 : 0);
    if (score > best) { best = score; entrance = { ax, az, dx, dz, L, ox, oz }; }
  }
  // flat roof inside the mansard (rasterised in the grid frame)
  {
    let umin = Infinity, umax = -Infinity, emin = Infinity, emax = -Infinity;
    for (let k = 0; k < n; k++) { const [u, e] = gridLocal(p[k * 2], p[k * 2 + 1], pb.cx, pb.cz); umin = Math.min(umin, u); umax = Math.max(umax, u); emin = Math.min(emin, e); emax = Math.max(emax, e); }
    const f = frame(b, pb.cx, y0, pb.cz, GRID_ROT), c = 3;
    for (let u = umin + c / 2; u < umax; u += c) {
      let run = null;
      for (let e = emin + c / 2; e < emax + c; e += c) {
        const inside = e < emax && pipF(f.wx(u, e), f.wz(u, e), p);
        if (inside && run === null) run = e;
        if (!inside && run !== null) { f.box(u - c / 2, 15.0, run - c / 2, u + c / 2, 15.5, e - c / 2, '#56605a'); run = null; }
      }
    }
  }
  // corner turrets
  for (let k = 0; k < n; k++) {
    const c = convex(k);
    if (!c.convex || !c.ok) continue;
    const tx = c.v[0] + c.bx * 4.2, tz = c.v[1] + c.bz * 4.2;
    const f = frame(b, tx, y0, tz, GRID_ROT);
    oct(f, 0, 0, 0, 17.5, 3.2, CU);
    oct(f, 0, 0, 17.5, 20.5, 2.5, CS);
    oct(f, 0, 0, 20.5, 23, 1.6, CU);
    oct(f, 0, 0, 23, 25, 0.8, CT);
    f.box(-0.12, 25, -0.12, 0.12, 27, 0.12, '#d8b24a');
    if (hi) for (let q = 0; q < 4; q++) f.rbox(0, 0, (q * Math.PI) / 2 + Math.PI / 4, 2.9, 12, -0.5, 3.4, 14.5, 0.5, CR);
  }
  // flags over the main entrance
  if (entrance) {
    const { ax, az, dx, dz, L, ox, oz } = entrance;
    const mx = ax + dx * L * 0.5, mz = az + dz * L * 0.5;
    const rot = Math.atan2(ox, oz); // local +z = outward
    const fy = ctx.groundY(mx, mz);
    const cols = [['#c8102e', '#f4f1ea'], ['#1d4fa8', '#f2c230'], ['#2f8f4e', '#f4f1ea']];
    for (let k = -1; k <= 1; k++) {
      const f = frame(b, mx + dx * k * 4.5, fy + 8, mz + dz * k * 4.5, rot);
      for (let j = 0; j < 5; j++) f.box(-0.08, j * 0.55, j * 0.75, 0.08, j * 0.55 + 0.6, j * 0.75 + 0.8, '#d6d3c8');
      f.box(-0.15, 2.75, 3.75, 0.15, 3.0, 4.0, '#d8b24a');
      f.box(-0.04, 0.6, 3.9, 0.04, 2.7, 3.95, cols[k + 1][0]);
      f.box(-0.04, 0.6, 2.4, 0.04, 2.0, 3.9, cols[k + 1][1]);
    }
    // marquee lights
    const f = frame(g, mx, fy, mz, rot);
    f.box(-0.5, 4.2, 0.1, 0.5, 4.5, 2.6, '#ffe3a6');
  }
}

// 6. Grand Army Plaza: Pulitzer Fountain (Pomona) and the gilded Sherman Monument
function buildGrandArmyPlaza(ctx) {
  const hi = ctx.hi;
  {
    const [x, z] = ctx.project(...LL.pomona);
    const y = ctx.groundY(x, z);
    const f = frame(ctx.boxes(x, z), x, y, z, GRID_ROT);
    const GN = '#c9c3b6', WA = '#5d8fb5';
    const tiers = [[10.5, 0, 0.6], [7.2, 0.6, 1.25], [4.8, 1.25, 1.95], [3.1, 1.95, 2.7], [1.9, 2.7, 3.5]];
    tiers.forEach(([r, y0, y1], k) => {
      oct(f, 0, 0, y0, y1, r, GN);
      oct(f, 0, 0, y1, y1 + 0.04, r - 0.45, WA);
      if (hi && k < 2) ring(f, 0, 0, y1, y1 + 0.25, r - 0.2, 0.4, 16, GN);
    });
    oct(f, 0, 0, 3.5, 5.2, 0.9, GN);
    oct(f, 0, 0, 5.2, 5.5, 1.1, GN);
    const P = f.sub(0, 5.5, 0, Math.PI);
    figure(P, 2.4, '#4f7a62', 1);
    P.box(-0.45, 0, -0.35, 0.45, 0.9, 0.35, '#4f7a62'); // draped skirt
    P.box(-0.6, 1.6, -0.25, -0.3, 1.9, 0.25, '#4f7a62'); // basket of fruit
    if (hi) for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; f.box(Math.cos(a) * 6 - 0.08, 1.25, Math.sin(a) * 6 - 0.08, Math.cos(a) * 6 + 0.08, 2.2, Math.sin(a) * 6 + 0.08, '#e3f2fb'); }
  }
  {
    const [x, z] = ctx.project(...LL.sherman);
    const y = ctx.groundY(x, z);
    const rot = GRID_ROT + Math.PI / 2; // local +z = downtown (statue faces south down 5th Ave)
    const f = frame(ctx.boxes(x, z), x, y, z, rot);
    const PG = '#b59a91', AU = '#d9a93a', AD = '#b88a2a';
    f.box(-2.2, 0, -4.2, 2.2, 0.6, 4.2, '#9d958a');
    f.box(-1.7, 0.6, -3.6, 1.7, 3.9, 3.6, PG);
    f.box(-1.9, 3.9, -3.8, 1.9, 4.3, 3.8, '#c4aaa0');
    const h = f.sub(0, 4.3, -0.6);
    const H = { box: (x0, y0, z0, x1, y1, z1, c) => h.box(x0 * 1.7, y0 * 1.7, z0 * 1.7, x1 * 1.7, y1 * 1.7, z1 * 1.7, c) };
    horse(H, AU, AD, 1);
    H.box(-0.25, 1.6, -0.35, 0.25, 2.5, 0.1, AU); // General Sherman
    H.box(-0.15, 2.5, -0.25, 0.15, 2.75, 0.02, AU);
    H.box(-0.42, 1.35, -0.3, -0.3, 1.75, 0.15, AU);
    H.box(0.3, 1.35, -0.3, 0.42, 1.75, 0.15, AU);
    H.box(-0.3, 2.0, -0.6, 0.3, 2.45, -0.3, AD); // cape
    const v = f.sub(0, 4.3, 2.3);
    figure(v, 2.7, AU, 1); // Victory leading the horse
    if (hi) for (const s of [-1, 1]) v.box(s * 0.25, 1.1, -0.5, s * 0.95, 2.6, -0.2, AD); // wings
    v.box(0.3, 2.3, -0.1, 0.45, 3.4, 0.05, AU); // palm frond
  }
}

// 7. Columbus Circle monument, fountain ring, benches; USS Maine Monument
function buildColumbusCircle(ctx) {
  const hi = ctx.hi;
  const [x, z] = ctx.project(...LL.columbus);
  const y = ctx.groundY(x, z);
  const b = ctx.boxes(x, z);
  const f = frame(b, x, y, z, 0);
  const GR = '#9d968b', GL = '#b4ada2', BZ = '#5f4a2e', MW = '#ece8de', WA = '#5d8fb5';
  oct(f, 0, 0, 0, 1.0, 5.6, GR);
  oct(f, 0, 0, 1.0, 2.2, 4.3, GL);
  oct(f, 0, 0, 2.2, 7.5, 3.0, GR);
  oct(f, 0, 0, 7.5, 8.2, 3.4, GL);
  if (hi) for (let k = 0; k < 4; k++) f.rbox(0, 0, (k * Math.PI) / 2, -1.2, 3.5, 2.75, 1.2, 6, 2.95, BZ);
  figure(f.sub(0, 2.2, 3.4), 2.6, MW, 1); // angel / genius figure
  oct(f, 0, 0, 8.2, 21.5, 1.15, GL);
  for (let k = 0; k < 3; k++) {
    const yy = 11.5 + k * 3;
    for (const side of [0, Math.PI]) {
      const r = (k * Math.PI) / 3 + side;
      f.rbox(0, 0, r, -0.35, yy, 1.0, 0.35, yy + 0.7, 2.6, BZ);
      f.rbox(0, 0, r, -0.12, yy + 0.35, 2.6, 0.12, yy + 0.55, 3.2, BZ);
    }
  }
  oct(f, 0, 0, 21.5, 22.3, 1.6, GL);
  const c = f.sub(0, 22.3, 0, 0.6);
  figure(c, 3.7, MW, 1);
  c.box(-0.75, 1.1, -0.3, 0.75, 2.8, 0.3, MW); // cloak
  // fountain ring and benches
  oct(f, 0, 0, 0, 0.3, 13.8, WA);
  oct(f, 0, 0, 0, 0.34, 9.6, '#b9b3a8');
  ring(f, 0, 0, 0, 0.6, 14.1, 0.6, hi ? 32 : 20, GL);
  ring(f, 0, 0, 0, 0.6, 9.6, 0.6, hi ? 24 : 14, GL);
  if (hi) for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; f.box(Math.cos(a) * 11.9 - 0.09, 0.3, Math.sin(a) * 11.9 - 0.09, Math.cos(a) * 11.9 + 0.09, 1.7, Math.sin(a) * 11.9 + 0.09, '#e3f2fb'); }
  const nb = hi ? 12 : 6;
  for (let k = 0; k < nb; k++) {
    const a = ((k + 0.5) / nb) * Math.PI * 2, rx = Math.cos(a), rz = Math.sin(a);
    ctx.props.bench(b, x + rx * 17.5, y, z + rz * 17.5, Math.atan2(rz, -rx));
  }

  // USS Maine National Monument (Merchants' Gate)
  const [mx, mz] = ctx.project(...LL.maine);
  const my = ctx.groundY(mx, mz);
  const m = frame(ctx.boxes(mx, mz), mx, my, mz, rotToward(x - mx, z - mz));
  const LS = '#d9d3c4', AU = '#d9a93a';
  m.box(-5, 0, -4, 5, 0.6, 7, GR);
  m.box(-4.5, 0.6, 2.8, 4.5, 1.3, 6.4, LS);
  m.box(-4.0, 1.25, 3.2, 4.0, 1.32, 6.0, WA);
  m.box(-3.6, 0.6, -3, 3.6, 2.6, 3, LS);
  m.box(-2.4, 2.6, -1.8, 2.4, 12, 1.8, LS);
  m.box(-2.0, 12, -1.5, 2.0, 13.5, 1.5, LS);
  m.box(-2.6, 13.5, -2.1, 2.6, 14.2, 2.1, LS);
  m.box(-1.6, 14.2, -1.2, 1.6, 15.2, 1.2, AU); // shell chariot
  const col = m.sub(0, 15.2, -0.2);
  figure(col, 3.0, AU, 1); // Columbia Triumphant
  for (const u of [-1.1, 0, 1.1]) {
    m.box(u - 0.22, 14.4, 1.2, u + 0.22, 15.4, 2.2, AU); // sea horses
    m.box(u - 0.15, 15.2, 1.9, u + 0.15, 15.9, 2.5, AU);
  }
  figure(m.sub(-1.6, 1.3, 3.4), 2.2, BZ);
  figure(m.sub(1.6, 1.3, 3.4), 2.2, BZ);
  if (hi) { m.box(-0.8, 6, 1.8, 0.8, 9, 1.95, BZ); m.box(-2.6, 2.6, -2.0, 2.6, 3.2, 2.0, '#cfc8b8'); }
}

// 8. Skyline: Empire State Building and Chrysler Building at true height
function slab(f, cu, ce, hu, he, y0, y1, col) { f.box(cu - hu, y0, ce - he, cu + hu, y1, ce + he, col); }
function stripes(f, cu, ce, hu, he, y0, y1, sp, col) {
  // vertical window/spandrel strips on all four faces
  for (let e = -he + sp / 2; e < he - sp / 4; e += sp) for (const s of [-1, 1]) f.box(cu + s * hu, y0, ce + e - 0.45, cu + s * (hu + 0.15), y1, ce + e + 0.45, col);
  for (let u = -hu + sp / 2; u < hu - sp / 4; u += sp) for (const s of [-1, 1]) f.box(cu + u - 0.45, y0, ce + s * he, cu + u + 0.45, y1, ce + s * (he + 0.15), col);
}
function buildEmpireState(ctx) {
  const hi = ctx.hi;
  const [ox, oz] = ctx.project(...LL.esb);
  const f0 = frame(null, ox, 0, oz, GRID_ROT);
  const cu = 29.7, ce = 64.6, x = f0.wx(cu, ce), z = f0.wz(cu, ce);
  const y = ctx.groundY(x, z);
  const f = frame(ctx.boxes(x, z), ox, y, oz, GRID_ROT);
  const fg = frame(ctx.boxes(x, z, 'glow'), ox, y, oz, GRID_ROT);
  const LS = '#d8cdb5', LT = '#e2d8c2', SP = '#8b9097', DK = '#5a5f66';
  slab(f, cu, ce, 29.7, 64.6, 0, 24, LS);
  slab(f, cu, ce, 26.5, 52, 24, 80, LT);
  slab(f, cu, ce, 23.5, 40, 80, 100, LS);
  slab(f, cu, ce, 20, 32, 100, 125, LT);
  for (const [a, b, c, d, y0, y1] of [[13, 28.5, 18, 20, 125, 255], [11, 25, 16, 19, 255, 290], [10, 21, 14, 16, 290, 310]]) {
    slab(f, cu, ce, a, b, y0, y1, LS);
    slab(f, cu, ce, c, d, y0, y1, LT);
    if (hi) { stripes(f, cu, ce, a, b, y0 + 2, y1 - 1, 3.6, SP); stripes(f, cu, ce, c, d, y0 + 2, y1 - 1, 3.6, DK); }
  }
  if (hi) { stripes(f, cu, ce, 26.5, 52, 26, 78, 4.5, SP); stripes(f, cu, ce, 20, 32, 102, 123, 4, SP); }
  slab(f, cu, ce, 12, 18, 310, 320, LT);
  slab(f, cu, ce, 11.4, 14.4, 320, 321, '#c9c2b0'); // 86th floor deck parapet
  slab(f, cu, ce, 11, 14, 321, 326, LS);
  slab(f, cu, ce, 9, 11.5, 326, 333, LT);
  slab(fg, cu, ce, 9.15, 11.65, 328, 330.5, '#ffd27a');
  for (const [r, y0, y1, c] of [[7, 333, 345, LS], [6, 345, 360, LT], [5, 360, 373, LS], [3.5, 373, 378, LT], [2.2, 378, 381, '#c9c2b0']]) oct(f, cu, ce, y0, y1, r, c);
  if (hi) for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; fg.rbox(cu + Math.cos(a) * 6.05, ce + Math.sin(a) * 6.05, -a, -0.1, 347, -0.5, 0.1, 358, 0.5, '#ffe2a0'); }
  slab(f, cu, ce, 1.2, 1.2, 381, 400, '#b9bcc0');
  slab(f, cu, ce, 0.7, 0.7, 400, 425, '#c9cbcf');
  slab(f, cu, ce, 0.35, 0.35, 425, 441, '#d9dbde');
  slab(fg, cu, ce, 0.45, 0.45, 441, 443, '#ff3b30');
}
function buildChrysler(ctx) {
  const hi = ctx.hi;
  const [ox, oz] = ctx.project(...LL.chrysler);
  const f0 = frame(null, ox, 0, oz, GRID_ROT);
  const cu = 32, ce = 32.2, x = f0.wx(cu, ce), z = f0.wz(cu, ce);
  const y = ctx.groundY(x, z);
  const f = frame(ctx.boxes(x, z), ox, y, oz, GRID_ROT);
  const fg = frame(ctx.boxes(x, z, 'glow'), ox, y, oz, GRID_ROT);
  const BR = '#ddd7ca', BS = '#cfc8ba', SS = '#d4d9de', SH = '#eef2f5', DK = '#4b4f57';
  f.box(1, 0, 1, 62, 60, 62.5, BR);
  slab(f, cu, ce, 25, 25, 60, 75, BS);
  slab(f, cu, ce, 21, 21, 75, 85, BR);
  slab(f, cu, ce, 14.7, 11.5, 85, 200, BR);
  slab(f, cu, ce, 11.5, 14.7, 85, 200, BR);
  if (hi) { stripes(f, cu, ce, 14.7, 11.5, 87, 198, 2.6, DK); stripes(f, cu, ce, 11.5, 14.7, 87, 198, 2.6, DK); }
  for (let k = 0; k < 5; k++) slab(f, cu, ce, 14.85, 14.85, 95 + k * 21, 96.2 + k * 21, '#9a9aa0'); // grey brick bands
  for (const [h, yy, len] of [[200, 196, 3.2], [85, 83, 2.6]]) {
    for (let q = 0; q < 4; q++) {
      const a = (q * Math.PI) / 2 + Math.PI / 4, r = h === 200 ? 15.5 : 27;
      f.rbox(cu + Math.cos(a) * r, ce + Math.sin(a) * r, -a, -len / 2, yy, -0.5, len / 2, yy + 1.4, 0.5, SS);
    }
  }
  // stepped stainless crown with triangular sunburst windows
  const tiers = 6, nwin = hi ? 7 : 4;
  for (let k = 0; k < tiers; k++) {
    const w = 11.5 - 1.6 * k, yk = 200 + 12 * k;
    slab(f, cu, ce, w, w, yk, yk + 7, SS);
    slab(f, cu, ce, w - 0.6, w - 0.6, yk + 7, yk + 9, SH);
    slab(f, cu, ce, w - 1.4, w - 1.4, yk + 9, yk + 10.5, SS);
    slab(f, cu, ce, w - 2.4, w - 2.4, yk + 10.5, yk + 12, SH);
    for (let j = 0; j < nwin; j++) {
      const t = -0.8 + (1.6 * j) / (nwin - 1), a = t * (w - 0.8), yb = yk + 1.5 + 4.2 * (1 - t * t);
      for (let q = 0; q < 4; q++) {
        const ax = q < 2 ? 'u' : 'e', s = q % 2 ? -1 : 1, face = s * w;
        const tri = hi ? [[0.55, 0], [0.36, 0.55], [0.16, 1.1]] : [[0.4, 0]];
        for (const [hw, dy] of tri) {
          const y0 = yb + dy, y1 = y0 + (hi ? 0.55 : 1.4);
          if (ax === 'u') fg.box(cu + face, y0, ce + a - hw, cu + face + s * 0.12, y1, ce + a + hw, '#fff1c8');
          else fg.box(cu + a - hw, y0, ce + face, cu + a + hw, y1, ce + face + s * 0.12, '#fff1c8');
        }
      }
    }
  }
  oct(f, cu, ce, 272, 282, 1.7, SS);
  oct(f, cu, ce, 282, 292, 1.2, SH);
  oct(f, cu, ce, 292, 302, 0.8, SS);
  slab(f, cu, ce, 0.45, 0.45, 302, 311, SH);
  slab(f, cu, ce, 0.2, 0.2, 311, 319, SH);
}

// 9. Times Square: animated billboards (fictional brands), One Times Square screens, TKTS red steps
const ADS_A = [
  ['VOXA COLA', '#c8102e', '#ffffff'], ['BYTEPHONE 9', '#0b0b10', '#5ff2ff'], ['PIXEL BURGER', '#ffc72c', '#a3121c'], ['THE CUBE KING', '#2a0f4a', '#f2c230'],
  ['NEON NOODLE', '#0f6b6b', '#ffe86b'], ['QUBIT TV', '#1b4dd6', '#ffffff'], ['STAKK KICKS', '#f2f2f2', '#141414'], ['MEGABLOK', '#ff7b00', '#141414'],
];
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function texOf(ctx, c, pixel) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (pixel) t.magFilter = THREE.NearestFilter;
  ctx.keep(t);
  return t;
}
function fitText(g, text, x, y, maxW, size, fg) {
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let s = size;
  g.font = `bold ${s}px Arial, sans-serif`;
  const m = g.measureText ? g.measureText(text) : null;
  const w = m && m.width ? m.width : 0;
  if (w > maxW) { s = Math.max(8, Math.floor((s * maxW) / w)); g.font = `bold ${s}px Arial, sans-serif`; }
  g.fillText(text, x, y);
}
function drawSquareAd(g, k, x, y, w, h) {
  const [name, bg, fg] = ADS_A[k];
  g.fillStyle = bg; g.fillRect(x, y, w, h);
  const P = (px, py, pw, ph, c) => { g.fillStyle = c; g.fillRect(x + px * w / 16, y + py * h / 16, pw * w / 16, ph * h / 16); };
  switch (k) {
    case 0: P(0, 9, 16, 1, '#ffffff'); P(6, 2, 4, 9, '#5a0a14'); P(7, 0.8, 2, 1.4, '#5a0a14'); P(6, 5, 4, 2, '#ffffff'); break;
    case 1: P(5, 1, 6, 10, '#9aa0aa'); P(5.6, 1.8, 4.8, 8.2, '#d23cff'); P(5.6, 1.8, 4.8, 4, '#3cf0ff'); break;
    case 2: P(3, 2, 10, 3, '#d98b2b'); P(2.5, 5, 11, 1, '#3fae3a'); P(3, 6, 10, 2, '#5a2d14'); P(3, 8, 10, 2, '#d98b2b'); break;
    case 3: P(4, 4, 8, 4, '#f2c230'); P(4, 2, 2, 2, '#f2c230'); P(7, 1.5, 2, 2.5, '#f2c230'); P(10, 2, 2, 2, '#f2c230'); P(7.4, 5, 1.2, 1.2, '#d7263d'); break;
    case 4: P(3, 6, 10, 4, '#f4f1ea'); P(4, 4.5, 8, 1.5, '#ffe86b'); P(10, 1, 0.6, 6, '#8a5a36'); P(11.4, 1, 0.6, 6, '#8a5a36'); break;
    case 5: P(2, 1.5, 12, 8, '#111'); P(3, 2.5, 10, 6, '#ff5fb0'); P(3, 2.5, 5, 6, '#ffd23f'); P(6, 9.5, 4, 1, '#111'); break;
    case 6: P(2, 6, 11, 3, '#d7263d'); P(9, 4, 4, 2, '#d7263d'); P(2, 9, 12, 1, '#141414'); P(4, 7, 4, 0.6, '#ffffff'); break;
    default: P(3, 6, 4, 4, '#1b4dd6'); P(7, 6, 4, 4, '#d7263d'); P(5, 2, 4, 4, '#ffd23f'); P(11, 6, 3, 4, '#0f7a3d'); break;
  }
  fitText(g, name, x + w / 2, y + h * 0.82, w * 0.92, Math.round(h * 0.15), fg);
}
function drawWideAd(g, k, x, y, w, h, sponsors) {
  const [name, bg, fg] = sponsors[k % sponsors.length];
  g.fillStyle = bg; g.fillRect(x, y, w, h);
  g.fillStyle = fg; g.fillRect(x, y + h * 0.78, w, h * 0.04);
  fitText(g, name, x + w / 2, y + h * 0.42, w * 0.9, Math.round(h * 0.36), fg);
  fitText(g, ['OFFICIAL PARTNER OF VOXEL GT', 'NOW ON SALE', 'LIVE ON 42ND', 'BUILT BLOCK BY BLOCK'][k % 4], x + w / 2, y + h * 0.9, w * 0.9, Math.round(h * 0.1), fg);
}
const TICKER = '  VOXA COLA 12.40 \u25b2 0.8   BYTEPHONE 88.10 \u25bc 1.2   MEGABLOK 41.05 \u25b2 2.3   QUBIT TV 7.77 \u25b2 0.1   NEON NOODLE 19.90 \u25bc 0.4   VOXEL GT GRAND PRIX \u2014 MIDTOWN CLOSED FOR RACING  ';
function drawTicker(g, w, h, fr) {
  g.fillStyle = '#05070a'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#1b4dd6'; g.fillRect(0, 0, w, 4); g.fillRect(0, h - 4, w, 4);
  g.font = `bold ${Math.round(h * 0.6)}px Arial, sans-serif`;
  g.textBaseline = 'middle'; g.textAlign = 'left';
  const tw = (g.measureText && g.measureText(TICKER).width) || 1800;
  const off = (fr * 9) % tw;
  g.fillStyle = '#ffa31a';
  g.fillText(TICKER, -off, h / 2 + 2);
  g.fillText(TICKER, tw - off, h / 2 + 2);
}
function drawCycle(g, w, h, fr) {
  const hue = (fr * 9) % 360;
  g.fillStyle = `hsl(${hue},85%,45%)`; g.fillRect(0, 0, w, h);
  g.fillStyle = `hsl(${(hue + 40) % 360},90%,60%)`;
  const cx = w / 2, cy = h * 0.45, R = w;
  for (let k = 0; k < 12; k += 2) {
    const a0 = (k / 12) * Math.PI * 2 + fr * 0.08, a1 = a0 + Math.PI / 6;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R); g.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R); g.closePath(); g.fill();
  }
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(cx, cy, w * 0.26 + Math.sin(fr * 0.5) * 6, 0, Math.PI * 2); g.fill();
  fitText(g, 'ZAPP!', cx, cy, w * 0.5, Math.round(h * 0.2), `hsl(${(hue + 180) % 360},80%,35%)`);
  fitText(g, 'ENERGY DRINK', cx, h * 0.86, w * 0.9, Math.round(h * 0.1), '#ffffff');
}
function drawPixel(g, w, h, fr) {
  const B = 4, cols = w / B, rows = h / B;
  g.fillStyle = '#0b1030'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffffff';
  for (let k = 0; k < 14; k++) g.fillRect(((k * 37 + fr) % cols) * B, ((k * 11) % (rows / 2)) * B, B, B);
  for (let c = 0; c < cols; c++) {
    const i = c + Math.floor(fr / 2);
    const hh = 6 + ((i * 7919) % 11);
    g.fillStyle = i % 3 ? '#26305e' : '#33407a';
    g.fillRect(c * B, (rows - 6 - hh) * B, B, hh * B);
  }
  g.fillStyle = '#3d3f46'; g.fillRect(0, (rows - 6) * B, w, 6 * B);
  g.fillStyle = '#f2f2f2';
  for (let c = 0; c < cols; c += 6) g.fillRect(((c - fr) % cols + cols) % cols * B, (rows - 3) * B, 3 * B, B / 2);
  const x = ((fr * 3) % (cols + 20)) - 20, y = rows - 9;
  const car = (dx, dy, dw, dh, c) => { g.fillStyle = c; g.fillRect((x + dx) * B, (y + dy) * B, dw * B, dh * B); };
  car(0, 2, 16, 3, '#d7263d'); car(5, 0, 6, 2, '#d7263d'); car(6, 0.5, 4, 1.5, '#8ecae6'); car(2, 4, 3, 2, '#111'); car(11, 4, 3, 2, '#111'); car(15, 2, 1, 1, '#ffd23f');
  g.fillStyle = '#ffd23f';
  g.font = `bold ${Math.round(h * 0.22)}px Arial, sans-serif`;
  g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillText('VOXEL GT', 10, 8);
  if (fr % 8 < 5) { g.fillStyle = '#5ff2ff'; g.font = `bold ${Math.round(h * 0.11)}px Arial, sans-serif`; g.fillText('RACE TODAY', 12, 8 + h * 0.25); }
}

function buildTimesSquare(ctx) {
  const hi = ctx.hi, track = ctx.track, ds = track.ds || 2;
  const sponsors = ctx.SPONSORS && ctx.SPONSORS.length ? ctx.SPONSORS : [['CUBEFUEL', '#ffd23f', '#1b1b1b'], ['VOXELINE', '#d7263d', '#ffffff']];
  // textures: two static atlases + three animated canvases
  const atlasA = makeCanvas(512, 256), atlasB = makeCanvas(512, 256);
  const ga = atlasA.getContext('2d'), gb = atlasB.getContext('2d');
  for (let k = 0; k < 8; k++) drawSquareAd(ga, k, (k % 4) * 128, Math.floor(k / 4) * 128, 128, 128);
  for (let k = 0; k < 4; k++) drawWideAd(gb, k * 2 + (k > 1 ? 1 : 0), (k % 2) * 256, Math.floor(k / 2) * 128, 256, 128, sponsors);
  const anim = [
    { c: makeCanvas(512, 64), draw: drawTicker }, { c: makeCanvas(256, 256), draw: drawCycle }, { c: makeCanvas(256, 128), draw: drawPixel },
  ];
  for (const a of anim) { a.g = a.c.getContext('2d'); a.draw(a.g, a.c.width, a.c.height, 0); }
  const groups = {
    A: { tex: texOf(ctx, atlasA), tiles: [4, 2] }, B: { tex: texOf(ctx, atlasB), tiles: [2, 2] },
    ticker: { tex: texOf(ctx, anim[0].c), tiles: [1, 1] }, cycle: { tex: texOf(ctx, anim[1].c), tiles: [1, 1] }, pixel: { tex: texOf(ctx, anim[2].c, true), tiles: [1, 1] },
  };
  anim[0].tex = groups.ticker.tex; anim[1].tex = groups.cycle.tex; anim[2].tex = groups.pixel.tex;
  for (const gr of Object.values(groups)) { gr.pos = []; gr.uv = []; gr.idx = []; }
  // quad facing direction (nx, nz); right vector seen from the street
  const quad = (gname, tile, mx, y0, mz, nx, nz, W, H) => {
    const gr = groups[gname];
    const [tc, tr] = gr.tiles, col = tile % tc, row = Math.floor(tile / tc) % tr;
    const u0 = col / tc, u1 = (col + 1) / tc, v1 = 1 - row / tr, v0 = 1 - (row + 1) / tr;
    const rx = nz, rz = -nx, hw = W / 2;
    const vi = gr.pos.length / 3;
    gr.pos.push(mx - rx * hw, y0, mz - rz * hw, mx + rx * hw, y0, mz + rz * hw, mx + rx * hw, y0 + H, mz + rz * hw, mx - rx * hw, y0 + H, mz - rz * hw);
    gr.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    gr.idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  };
  const boardFrame = (mx, y0, mz, nx, nz, W, H, neon) => {
    const rot = Math.atan2(-nz, nx); // local +x = n (toward the street)
    // turned half way round: local +x = -n (into the building), local +z along the board
    const f = frame(ctx.boxes(mx, mz), mx, y0, mz, rot + Math.PI);
    f.box(0.03, -0.3, -W / 2 - 0.3, 1.1, H + 0.3, W / 2 + 0.3, '#1c1d22');
    if (neon) {
      const g = frame(ctx.boxes(mx, mz, 'glow'), mx, y0, mz, rot + Math.PI);
      g.box(-0.12, -0.32, -W / 2 - 0.32, 0.03, -0.18, W / 2 + 0.32, neon);
      g.box(-0.12, H + 0.18, -W / 2 - 0.32, 0.03, H + 0.32, W / 2 + 0.32, neon);
    }
  };
  const neons = ['#ff3fb4', '#3ff2ff', '#ffe23f', '#7dff5a', '#ff7a1a'];
  const pickGroup = (aspect, r) => {
    if (aspect >= 1.6) return r < 0.22 ? ['pixel', 0] : ['B', Math.floor(r * 37) % 4];
    return r < 0.18 ? ['cycle', 0] : ['A', Math.floor(r * 53) % 8];
  };

  // facade search: march sideways from the course until inside a building
  const [tx, tz] = ctx.project(...LL.ts42);
  const [t7x, t7z] = ctx.project(...LL.ts47);
  const tcx = (tx + t7x) / 2, tcz = (tz + t7z) / 2;
  const oneTS = S.oneTS;
  const cand = ctx.city.buildings.filter((b) => b.h >= 12 && !S.removed.has(b) && b !== oneTS && Math.hypot(b.cx - tcx, b.cz - tcz) < 320);
  const hitAt = (x, z) => { for (const b of cand) if (Math.abs(b.cx - x) < 90 && Math.abs(b.cz - z) < 90 && pipF(x, z, b.pts)) return b; return null; };
  const march = (i, s) => {
    const nx = track.nx[i] * s, nz = track.nz[i] * s;
    const w0 = (s > 0 ? track.wallL[i] : track.wallR[i]) + 2;
    for (let o = w0; o < 70; o += 1) {
      const b = hitAt(track.px[i] + nx * o, track.pz[i] + nz * o);
      if (b) {
        let lo = o - 1, hi2 = o;
        for (let k = 0; k < 3; k++) { const m = (lo + hi2) / 2; if (hitAt(track.px[i] + nx * m, track.pz[i] + nz * m)) hi2 = m; else lo = m; }
        return { o: hi2, b };
      }
    }
    return null;
  };
  const i42 = nearestSample(track, tx, tz), i47 = nearestSample(track, t7x, t7z);
  const i43 = i42 + Math.round(80 / ds);
  const iStart = i42 - Math.round(90 / ds), iEnd = i47 + Math.round(15 / ds);
  const rnd = ctx.rng(4242);
  let boards = 0;
  for (const s of [1, -1]) {
    let i = iStart;
    while (i < iEnd) {
      const W = 8 + rnd() * 14;
      let span = Math.max(2, Math.round(W / ds)), j = i + span;
      if (j > iEnd) break;
      const sparse = i < i43 && rnd() < 0.45;
      const h1 = sparse ? null : march(((i % track.N) + track.N) % track.N, s);
      let h2 = h1 ? march(((j % track.N) + track.N) % track.N, s) : null;
      if (h1 && (!h2 || Math.abs(h1.o - h2.o) > 2.5) && span >= 6) {
        // facade breaks within the board: try a narrower one
        span = Math.round(span / 2); j = i + span;
        h2 = march(((j % track.N) + track.N) % track.N, s);
      }
      if (!h1 || !h2 || Math.abs(h1.o - h2.o) > 2.5) { i += 2; continue; }
      const ia = ((i % track.N) + track.N) % track.N, ja = ((j % track.N) + track.N) % track.N;
      const ax = track.px[ia] + track.nx[ia] * s * (h1.o - 0.6), az = track.pz[ia] + track.nz[ia] * s * (h1.o - 0.6);
      const bx = track.px[ja] + track.nx[ja] * s * (h2.o - 0.6), bz = track.pz[ja] + track.nz[ja] * s * (h2.o - 0.6);
      const Wb = Math.hypot(bx - ax, bz - az);
      let nx = -(bz - az) / Wb, nz = (bx - ax) / Wb;
      const tox = track.px[ia] - ax, toz = track.pz[ia] - az;
      if (nx * tox + nz * toz < 0) { nx = -nx; nz = -nz; }
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, gy = ctx.groundY(mx, mz);
      const top = Math.min(60, Math.min(h1.b.h, h2.b.h) - 2);
      let yb = 8 + rnd() * 4, levels = 0;
      while (yb + 5 < top && levels < (i < i43 ? 2 : 5)) {
        const r = rnd();
        if (r < 0.14) { quad('ticker', 0, mx, gy + yb, mz, nx, nz, Wb, Math.min(2.6, Wb / 7)); boardFrame(mx, gy + yb, mz, nx, nz, Wb, Math.min(2.6, Wb / 7), null); yb += 4; levels++; boards++; continue; }
        const H = Math.min(top - yb, 6 + rnd() * 10);
        if (H < 4) break;
        const [gname, tile] = pickGroup(Wb / H, rnd());
        quad(gname, tile, mx, gy + yb, mz, nx, nz, Wb, H);
        boardFrame(mx, gy + yb, mz, nx, nz, Wb, H, hi && rnd() < 0.4 ? neons[Math.floor(rnd() * neons.length)] : null);
        boards++;
        levels++;
        yb += H + 1 + rnd() * 3;
      }
      i = j + 1 + (i < i43 ? Math.round(rnd() * 3) : 0);
    }
  }

  // One Times Square: screens stacked on every face, ticker band
  if (oneTS) {
    const p = oneTS.pts, n = p.length >> 1, gy = ctx.groundY(oneTS.cx, oneTS.cz);
    const top = Math.min(oneTS.h - 12, 98);
    for (let k = 0; k < n; k++) {
      const ax = p[k * 2], az = p[k * 2 + 1], bx = p[((k + 1) % n) * 2], bz = p[((k + 1) % n) * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 5) continue;
      let nx = -(bz - az) / L, nz = (bx - ax) / L;
      const mx0 = (ax + bx) / 2, mz0 = (az + bz) / 2;
      if (nx * (mx0 - oneTS.cx) + nz * (mz0 - oneTS.cz) < 0) { nx = -nx; nz = -nz; }
      const mx = mx0 + nx * 0.5, mz = mz0 + nz * 0.5, W = L - 0.8;
      quad('ticker', 0, mx, gy + 9, mz, nx, nz, W, 2.4);
      boardFrame(mx, gy + 9, mz, nx, nz, W, 2.4, null);
      let yb = 13, q = k;
      while (yb + 6 < top) {
        const H = 8 + ((q * 7) % 5);
        const opts = [['A', q % 8], ['B', q % 4], ['cycle', 0], ['pixel', 0], ['A', (q + 3) % 8]];
        const [gname, tile] = opts[q % opts.length];
        quad(gname, tile, mx, gy + yb, mz, nx, nz, W, Math.min(H, top - yb));
        boardFrame(mx, gy + yb, mz, nx, nz, W, Math.min(H, top - yb), null);
        yb += H + 1;
        q++;
        boards++;
      }
    }
  }

  // TKTS red glass steps (Duffy Square)
  const [kx, kz] = ctx.project(...LL.tkts);
  const tk = ctx.city.buildings.find((b) => S.removed.has(b) && b.h <= 8 && Math.hypot(b.cx - kx, b.cz - kz) < 6);
  {
    const ccx = tk ? tk.cx : kx, ccz = tk ? tk.cz : kz, rot = tk ? footprintRot(tk) : GRID_ROT;
    let u0 = -8, u1 = 8, e0 = -4.5, e1 = 4.5;
    if (tk) {
      u0 = e0 = Infinity; u1 = e1 = -Infinity;
      const c = Math.cos(rot), s = Math.sin(rot);
      for (let k = 0; k < tk.pts.length; k += 2) {
        const dx = tk.pts[k] - ccx, dz = tk.pts[k + 1] - ccz, u = dx * c - dz * s, e = dx * s + dz * c;
        u0 = Math.min(u0, u); u1 = Math.max(u1, u); e0 = Math.min(e0, e); e1 = Math.max(e1, e);
      }
      u0 += 0.5; u1 -= 0.5; e0 += 0.8; e1 -= 0.8;
    }
    // rows rise toward the side that points uptown
    const up = Math.cos(rot - GRID_ROT) >= 0 ? 1 : -1;
    const y = ctx.groundY(ccx, ccz);
    const f = frame(ctx.boxes(ccx, ccz), ccx, y, ccz, rot);
    const g = frame(ctx.boxes(ccx, ccz, 'glow'), ccx, y, ccz, rot);
    const N = hi ? 14 : 8, H = 5, du = (u1 - u0) / N, dh = H / N;
    for (let k = 0; k < N; k++) {
      const a = up > 0 ? u0 + k * du : u1 - k * du;
      const ub = up > 0 ? u1 : u0;
      f.box(a, k * dh, e0, ub, (k + 1) * dh - 0.06, e1, '#8e1424');
      g.box(a, (k + 1) * dh - 0.06, e0, a + up * du, (k + 1) * dh + 0.02, e1, '#ff3048');
      if (hi) for (const e of [e0 - 0.08, e1 + 0.08]) f.box(a, (k + 1) * dh, e - 0.04, a + up * du, (k + 1) * dh + 1.0, e + 0.04, '#9fd6e6');
    }
    const ub = up > 0 ? u1 : u0;
    g.box(ub - up * 1.2, 0.2, e0 + 0.6, ub - up * 0.2, 4.2, e1 - 0.6, '#ff6b7d'); // booth glow behind the glass
  }

  // meshes: one draw call per texture group
  for (const gr of Object.values(groups)) {
    if (!gr.idx.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(gr.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(gr.uv, 2));
    geo.setIndex(gr.idx);
    geo.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial({ map: gr.tex });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    ctx.keep(geo); ctx.keep(mat);
    ctx.add(mesh);
  }
  // animation: three canvases redrawn at ~9 fps
  let acc = 0, fr = 0;
  ctx.animate((time, dt) => {
    acc += dt || 0;
    if (acc < 0.11) return;
    acc = 0; fr++;
    for (const a of anim) { a.draw(a.g, a.c.width, a.c.height, fr); a.tex.needsUpdate = true; }
  });
  S.billboards = boards;
}

// 10. Rooftop water towers
function buildWaterTowers(ctx) {
  const hi = ctx.hi;
  let n = 0;
  for (const b of ctx.city.buildings) {
    // b.base is set by cityScene for every building it actually drew
    if (b.base == null || b.part || b.far || b.roof || S.removed.has(b) || b.h < 15 || b.h > 80 || b.area < 120 || b === S.plazaBase) continue;
    const ix = Math.round(b.cx), iz = Math.round(b.cz);
    if (ctx.hash2(ix, iz, 77) >= 0.15) continue;
    const c = ctx.courseAt(b.cx, b.cz);
    if (c.dist > (hi ? 200 : 80)) continue;
    const p = b.pts, k = Math.floor(ctx.hash2(ix, iz, 78) * (p.length >> 1));
    let x = b.cx + (p[k * 2] - b.cx) * 0.45, z = b.cz + (p[k * 2 + 1] - b.cz) * 0.45;
    if (!pipF(x, z, p)) { x = b.cx; z = b.cz; }
    const y = b.base + b.h;
    waterTower(ctx.boxes(x, z), x, y, z, GRID_ROT + ctx.hash2(ix, iz, 79) * 0.3, hi, ctx.hash2(ix, iz, 80));
    n++;
  }
  S.waterTowers = n;
}

// 11. Central Park: stone wall on the park edge near the course, horse carriages on Central Park South
function buildCentralPark(ctx) {
  const hi = ctx.hi, track = ctx.track;
  const parks = ctx.city.areas.filter((a) => (a.kind === 0 || a.kind === 3) && polyArea(a.pts) > 100000);
  const inters = ctx.city.intersections || [];
  const nearInter = (x, z, r) => inters.some((it) => Math.hypot(it.x - x, it.z - z) < r);
  const WC = '#8f8b83', CAP = '#a6a299';
  for (const park of parks) {
    const p = park.pts, n = p.length >> 1;
    for (let k = 0; k < n; k++) {
      const ax = p[k * 2], az = p[k * 2 + 1], bx = p[((k + 1) % n) * 2], bz = p[((k + 1) % n) * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 4) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L;
      let inx = -dz, inz = dx;
      if (!pipF(ax + dx * L * 0.5 + inx * 2, az + dz * L * 0.5 + inz * 2, p)) { inx = -inx; inz = -inz; }
      const step = 6, pts = [];
      for (let t = 0; t <= L; t += step) {
        let x = ax + dx * t, z = az + dz * t;
        const c = ctx.courseAt(x, z);
        if (c.dist > 55) { pts.push(null); continue; }
        const req = c.hw + 4.5;
        if (c.dist < req) { x += inx * (req - c.dist); z += inz * (req - c.dist); }
        const gap = nearInter(x, z, 16) || (t % 110) < 6;
        pts.push(gap ? null : [x, z]);
      }
      for (let j = 0; j + 1 < pts.length; j++) {
        const a = pts[j], b = pts[j + 1];
        if (!a || !b) {
          const e = a || b;
          if (e && hi) { const y = ctx.groundY(e[0], e[1]); frame(ctx.boxes(e[0], e[1]), e[0], y, e[1], 0).box(-0.5, 0, -0.5, 0.5, 1.5, 0.5, CAP); }
          continue;
        }
        const sl = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (sl < 0.5 || sl > 12) continue;
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, y = ctx.groundY(mx, mz);
        const f = frame(ctx.boxes(mx, mz), mx, y, mz, rotToward(b[0] - a[0], b[1] - a[1]));
        f.box(-0.3, -0.2, -sl / 2 - 0.05, 0.3, 0.85, sl / 2 + 0.05, WC);
        f.box(-0.38, 0.85, -sl / 2 - 0.05, 0.38, 1.0, sl / 2 + 0.05, CAP);
      }
    }
  }
  // horse carriages lined up along the park side of Central Park South (6th Ave -> 5th Ave)
  if (!parks.length) return;
  const [ax, az] = ctx.project(...LL.cps6), [bx, bz] = ctx.project(...LL.gap);
  const ia = nearestSample(track, ax, az) + 8, ib = nearestSample(track, bx, bz) - 14;
  const maxN = hi ? 12 : 6;
  let placed = 0;
  for (let i = ia; i < ib && placed < maxN; i += 5) {
    const px = track.px[i], pz = track.pz[i];
    const s = parks.some((pk) => pipF(px + track.nx[i] * 20, pz + track.nz[i] * 20, pk.pts)) ? 1 : -1;
    const hw = track.hw[i] ?? 7.8;
    const x = px + track.nx[i] * s * (hw + 1.2), z = pz + track.nz[i] * s * (hw + 1.2);
    if (nearInter(x, z, 18)) continue;
    const t = ctx.track.tx ? [track.tx[i], track.tz[i]] : [track.nz[i], -track.nx[i]];
    carriage(ctx.boxes(x, z), x, ctx.groundY(x, z), z, rotToward(t[0], t[1]), ctx.hash2(i, 5, 31), hi);
    placed++;
  }
  S.carriages = placed;
}

// ---------------------------------------------------------------------------
export const LANDMARKS = [
  ['library', buildLibrary], ['bryantPark', buildBryantPark], ['stPatricks', buildStPatricks], ['rockefeller', buildRockefeller],
  ['plaza', buildPlaza], ['grandArmyPlaza', buildGrandArmyPlaza], ['columbusCircle', buildColumbusCircle],
  ['empireState', buildEmpireState], ['chrysler', buildChrysler], ['timesSquare', buildTimesSquare],
  ['waterTowers', buildWaterTowers], ['centralPark', buildCentralPark],
];

export default {
  id: 'nyc',
  prepare(ctx) {
    S = analyse(ctx);
    const s = S;
    ctx.removeBuildings((b) => {
      const r = replaced(ctx, s, b);
      if (r) s.removed.add(b);
      return r;
    });
  },
  build(ctx) {
    state(ctx);
    // spatial lookup for "is this point inside a (kept) building"
    const grid = new Map(), C = 40;
    for (const b of ctx.city.buildings) {
      if (S.removed.has(b) || b.far) continue;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let k = 0; k < b.pts.length; k += 2) { x0 = Math.min(x0, b.pts[k]); x1 = Math.max(x1, b.pts[k]); z0 = Math.min(z0, b.pts[k + 1]); z1 = Math.max(z1, b.pts[k + 1]); }
      for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(z0 / C); j <= Math.floor(z1 / C); j++) {
        const key = i * 100003 + j;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(b);
      }
    }
    S.buildingAt = (x, z, minH = 0) => {
      const l = grid.get(Math.floor(x / C) * 100003 + Math.floor(z / C));
      return !!l && l.some((b) => b.h >= minH && pipF(x, z, b.pts));
    };
    for (const [, fn] of LANDMARKS) fn(ctx);
  },
};
