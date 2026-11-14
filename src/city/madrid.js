// Madrid (Centro) city module: hand-built voxel landmarks and Madrid dressing for
// the street course (see cityScene.js for the generic city: buildings, roads,
// barriers, lamps, trees...). The OSM extract already carries detailed
// building:parts for the big landmarks, so this module mostly decorates them
// (domes, statues, towers, signs) and builds the free-standing monuments.
//
// Facades: Madrid plaster in cream / ochre / almagre with wrought-iron
// balconies (buildings.js stucco styles), slate mansards along Gran Vía and in
// the Plaza Mayor, terracotta tiles in the old town. Every brand is fictional.
// All sizes are real metres; figures face local +z.
import * as THREE from 'three';
import { hash2 } from '../util.js';
import { STYLE } from './buildings.js';

// Anchors (lat, lon), from the OSM extract in tools/data/cities/madrid.json.
const LL = {
  metroTip: [40.41888, -3.69745], // Edificio Metrópolis, the rotunda at the Gran Vía / Alcalá point
  telefonica: [40.42026, -3.70194],
  carrion: [40.42030, -3.70640], // Edificio Carrión prow (rooftop sign)
  callao: [40.42010, -3.70560],
  edEspana: [40.42405, -3.71109],
  torreMadrid: [40.42443, -3.71224],
  cibeles: [40.41934, -3.69309], // Fuente de Cibeles (OSM fountain centroid)
  cibelesPal: [40.41884, -3.69238], // Palacio de Cibeles (Comunicaciones)
  apolo: [40.41721, -3.69390], // Fuente de Apolo on the Prado boulevard
  neptuno: [40.41526, -3.69415],
  congreso: [40.41615, -3.69670], // Puerta de los Leones
  cortes: [40.41574, -3.69648], // Cervantes statue, Plaza de las Cortes
  correosClock: [40.41652, -3.70358],
  km0: [40.41663, -3.70381],
  oso: [40.41702, -3.70312],
  carlos3: [40.41693, -3.70372],
  mariblanca: [40.41686, -3.70456],
  solSign: [40.41681, -3.70484],
  arco: [40.41592, -3.70776], // arch from Calle Mayor into the Plaza Mayor (Ciudad Rodrigo)
  plazaMayor: [40.41544, -3.70736], // Felipe III
  almudenaDome: [40.41560, -3.71455],
  palacio: [40.41790, -3.71450],
  felipeIV: [40.41833, -3.71220],
  cervantes: [40.42317, -3.71264],
  cervantesPond: [40.42325, -3.71250],
};
// Plaza Mayor: the arcaded almagre-red ring of buildings and its four slate spires
const PLAZA_MAYOR = [40.41478, -3.70815, 40.41606, -3.70655];
const SPIRES = [[40.41583, -3.70746], [40.41583, -3.70686], [40.41497, -3.70758], [40.41497, -3.70700]];
const PALACIO_BOX = [40.41650, -3.71600, 40.41920, -3.71330];

const GRANITE = '#b9b2a5', BRONZE = '#4d4535', BRONZE_D = '#3a3328', GOLD = '#d9ab3e', WATER = '#5d8fb5', SLATE = '#3f4650';

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
// scaled view of a frame (statues built at unit size)
function scaled(f, k) {
  return { box: (x0, y0, z0, x1, y1, z1, col) => f.box(x0 * k, y0 * k, z0 * k, x1 * k, y1 * k, z1 * k, col) };
}
// octagonal prism of circumradius r around local (u, e)
function oct(f, u, e, y0, y1, r, col, opts) {
  const a = r * 0.924;
  f.rbox(u, e, 0, -a, y0, -a, a, y1, a, col, opts);
  f.rbox(u, e, Math.PI / 4, -a, y0, -a, a, y1, a, col, opts);
}
// horizontal ring of n segments (centre radius R, radial thickness t)
function ring(f, u, e, y0, y1, R, t, n, col) {
  const L = (Math.PI * R) / n * 1.06;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    f.rbox(u + R * Math.cos(a), e + R * Math.sin(a), -a, -t / 2, y0, -L, t / 2, y1, L, col);
  }
}
// stepped dome: n octagonal tiers from radius r0 at y0 up to height h
function dome(f, u, e, y0, r0, h, n, col, ribCol) {
  for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1) / n;
    const r = r0 * Math.cos(t0 * Math.PI * 0.5 * 0.95);
    oct(f, u, e, y0 + h * Math.sin(t0 * Math.PI / 2), y0 + h * Math.sin(t1 * Math.PI / 2) + 0.02, r, col);
  }
  if (ribCol) {
    for (let j = 0; j < 8; j++) {
      const a = (j / 8) * Math.PI * 2; // on the octagon's faces
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const r = r0 * Math.cos(t0 * Math.PI * 0.5 * 0.95) * 0.924 + 0.15;
        f.rbox(u + Math.cos(a) * r, e + Math.sin(a) * r, -a, -0.3, y0 + h * Math.sin(t0 * Math.PI / 2), -0.3, 0.3, y0 + h * Math.sin(t1 * Math.PI / 2) + 0.05, 0.3, ribCol);
      }
    }
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
const rotToward = (dx, dz) => Math.atan2(dx, dz); // local +z -> direction (dx, dz)
const inLL = (ll, box) => ll[0] >= box[0] && ll[0] <= box[2] && ll[1] >= box[1] && ll[1] <= box[3];

// small reusable figures (forward = local +z), unit-ish sizes
function figure(f, h, col, armUp = 0) {
  const k = h / 1.8;
  f.box(-0.2 * k, 0, -0.12 * k, 0.2 * k, 0.85 * k, 0.12 * k, col); // legs
  f.box(-0.24 * k, 0.85 * k, -0.14 * k, 0.24 * k, 1.5 * k, 0.14 * k, col); // torso
  f.box(-0.11 * k, 1.5 * k, -0.11 * k, 0.11 * k, 1.8 * k, 0.11 * k, col); // head
  f.box(-0.34 * k, 0.8 * k, -0.08 * k, -0.24 * k, 1.45 * k, 0.08 * k, col); // arm
  if (armUp) f.box(0.24 * k, 1.35 * k, -0.08 * k, 0.34 * k, 2.15 * k, 0.08 * k, col);
  else f.box(0.24 * k, 0.8 * k, -0.08 * k, 0.34 * k, 1.45 * k, 0.08 * k, col);
}
function seated(f, h, col) {
  const k = h / 1.3;
  f.box(-0.25 * k, 0, -0.1 * k, 0.25 * k, 0.45 * k, 0.45 * k, col); // shins + feet
  f.box(-0.25 * k, 0.35 * k, -0.25 * k, 0.25 * k, 0.55 * k, 0.4 * k, col); // lap
  f.box(-0.26 * k, 0.55 * k, -0.25 * k, 0.26 * k, 1.05 * k, 0.05 * k, col); // torso
  f.box(-0.11 * k, 1.05 * k, -0.18 * k, 0.11 * k, 1.3 * k, 0.04 * k, col); // head
  f.box(-0.36 * k, 0.6 * k, -0.15 * k, -0.26 * k, 1.0 * k, 0.25 * k, col); // arms
  f.box(0.26 * k, 0.6 * k, -0.15 * k, 0.36 * k, 1.0 * k, 0.25 * k, col);
}
function lion(f, S, D, M, K) {
  f.box(-0.6, 0, -1.9, 0.6, 0.85, -0.5, S); // haunches
  f.box(-0.68, 0.15, -1.75, 0.68, 1.02, -0.7, D);
  f.box(-0.55, 0, -0.6, 0.55, 0.95, 0.45, S); // torso
  f.box(-0.68, 0, 0.3, 0.68, 1.45, 1.2, D); // chest
  f.box(-0.78, 0.55, 0.4, 0.78, 1.62, 1.15, M); // mane
  f.box(-0.6, 1.62, 0.5, 0.6, 1.85, 1.05, M);
  f.box(-0.45, 0.85, 1.1, 0.45, 1.6, 1.75, S); // head
  f.box(-0.28, 0.88, 1.7, 0.28, 1.25, 2.0, S); // muzzle
  f.box(-0.12, 1.12, 1.98, 0.12, 1.24, 2.06, K);
  for (const s of [-1, 1]) {
    f.box(s * 0.16, 1.3, 1.74, s * 0.32, 1.4, 1.77, K); // eye
    f.box(s * 0.12, 0, 1.0, s * 0.5, 0.32, 2.3, S); // foreleg
    f.box(s * 0.6, 0.05, -1.6, s * 0.74, 0.62, -0.45, D); // hind thigh
  }
  f.box(0.6, 0, -2.05, 0.78, 0.16, -1.1, S); // tail
}
function horse(f, col, dark, pose = 0) {
  const rear = pose === 2;
  const body = rear ? 0.35 : 0;
  f.box(-0.32, 0.95, -0.85, 0.32, 1.6 + body, 0.75, col); // body
  for (const s of [-1, 1]) {
    f.box(s * 0.1, 0, -0.78, s * 0.3, 1.0, -0.52, col); // hind legs
    if (rear) f.box(s * 0.1, 1.2, 0.6, s * 0.3, 1.55, 1.15, col); // front legs pawing the air
    else if (pose === 1 && s > 0) f.box(s * 0.1, 0.45, 0.62, s * 0.3, 1.0, 0.95, col);
    else f.box(s * 0.1, 0, 0.42, s * 0.3, 1.0, 0.68, col);
    f.box(s * 0.08, 2.05 + body * 2, 1.0, s * 0.16, 2.25 + body * 2, 1.1, col); // ear
  }
  f.box(-0.2, 1.35, 0.55, 0.2, 2.05 + body * 2, 1.0, col); // neck
  f.box(-0.15, 1.72 + body * 2, 0.95, 0.15, 2.12 + body * 2, 1.55, col); // head
  f.box(-0.06, 1.85, 0.5, 0.06, 2.12 + body * 2, 0.98, dark); // mane
  f.box(-0.08, 0.75, -1.05, 0.08, 1.52, -0.85, dark); // tail
}
function rider(f, col, cloak) {
  f.box(-0.25, 1.6, -0.35, 0.25, 2.5, 0.1, col); // torso
  f.box(-0.15, 2.5, -0.25, 0.15, 2.78, 0.02, col); // head
  f.box(-0.42, 1.35, -0.3, -0.3, 1.75, 0.15, col); // legs
  f.box(0.3, 1.35, -0.3, 0.42, 1.75, 0.15, col);
  f.box(0.25, 2.2, -0.05, 0.38, 2.9, 0.08, col); // baton raised
  if (cloak) f.box(-0.3, 1.9, -0.6, 0.3, 2.45, -0.3, cloak);
}
// flag hanging off a pole at (u, e) along local direction drot, top edge at y
function flag(f, u, e, y, len, h, cols, drot = 0) {
  const n = cols.length, sh = h / n;
  for (let k = 0; k < n; k++) f.rbox(u, e, drot, -0.03, y - (k + 1) * sh, 0.08, 0.03, y - k * sh, 0.08 + len, cols[k]);
}
const SPAIN = ['#c60b1e', '#ffc400', '#ffc400', '#c60b1e'];

// ---------------------------------------------------------------------------
// textures
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
function fitText(g, text, x, y, maxW, size, fg, font = 'bold', align = 'center') {
  g.fillStyle = fg;
  g.textAlign = align;
  g.textBaseline = 'middle';
  let s = size;
  g.font = `${font} ${s}px Arial, sans-serif`;
  const w = (g.measureText && g.measureText(text).width) || 0;
  if (w > maxW) { s = Math.max(8, Math.floor((s * maxW) / w)); g.font = `${font} ${s}px Arial, sans-serif`; }
  g.fillText(text, x, y);
}
// Accumulates textured quads for one canvas (one draw call).
function quadGroup(ctx, canvas, { lit = false, double = false, alphaTest = 0, pixel = false } = {}) {
  const tex = texOf(ctx, canvas, pixel);
  const pos = [], uv = [], nor = [], idx = [];
  return {
    tex,
    // quad facing (nx, nz) from bottom-centre (mx, y0, mz); uvr = [u0, v0, u1, v1] (v up)
    quad(mx, y0, mz, nx, nz, W, H, uvr = [0, 0, 1, 1]) {
      const rx = nz, rz = -nx, hw = W / 2;
      const vi = pos.length / 3;
      pos.push(mx - rx * hw, y0, mz - rz * hw, mx + rx * hw, y0, mz + rz * hw, mx + rx * hw, y0 + H, mz + rz * hw, mx - rx * hw, y0 + H, mz - rz * hw);
      uv.push(uvr[0], uvr[1], uvr[2], uvr[1], uvr[2], uvr[3], uvr[0], uvr[3]);
      for (let k = 0; k < 4; k++) nor.push(nx, 0, nz);
      idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    },
    flush() {
      if (!idx.length) return null;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const o = { map: tex, side: double ? THREE.DoubleSide : THREE.FrontSide, alphaTest, transparent: alphaTest > 0 };
      const mat = lit ? new THREE.MeshLambertMaterial(o) : new THREE.MeshBasicMaterial(o);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      ctx.keep(geo); ctx.keep(mat);
      ctx.add(mesh);
      return mesh;
    },
  };
}

// ---------------------------------------------------------------------------
// state shared between prepare(), the style hooks and build()
let S = null;

function analyse(ctx) {
  const city = ctx.city, track = ctx.track;
  const P = (k) => ctx.project(...LL[k]);
  const s = { city, removed: new Set(), dome: null, mercado: null, gv: [], granVia: null, courseDist: (x, z) => ctx.courseAt(x, z).dist };
  const o = city.origin;
  s.ll = (x, z) => [o.lat - z / o.ky, o.lon + x / o.kx];
  // Almudena: OSM drum + lantern replaced by a modelled dome
  const [ax, az] = P('almudenaDome');
  for (const b of city.buildings) {
    if (b.part && b.h >= 55 && Math.hypot(b.cx - ax, b.cz - az) < 20) {
      s.removed.add(b);
      if (!s.dome || b.area > s.dome.area) s.dome = b;
    }
    if (b.name === 'Mercado de San Miguel') { s.removed.add(b); s.mercado = b; }
    if (b.name === 'Monumento a Felipe IV') s.removed.add(b);
  }
  // Gran Vía samples (start -> Alcalá, and the run in from Plaza de España): styling
  for (let i = 0; i < track.N; i += 4) {
    const u = i / track.N;
    if (u < 0.215 || u > 0.94) s.gv.push(track.px[i], track.pz[i]);
  }
  s.granVia = (x, z, r) => {
    for (let k = 0; k < s.gv.length; k += 2) if (Math.abs(s.gv[k] - x) < r && Math.abs(s.gv[k + 1] - z) < r && Math.hypot(s.gv[k] - x, s.gv[k + 1] - z) < r) return true;
    return false;
  };
  const near = (k, r) => { const [x, z] = P(k); return (b) => Math.hypot(b.cx - x, b.cz - z) < r; };
  s.isEdEspana = near('edEspana', 32);
  s.isTorre = near('torreMadrid', 30);
  s.isTelef = near('telefonica', 28);
  s.isMetro = near('metroTip', 34);
  s.isCibPal = near('cibelesPal', 75);
  s.isCongreso = near('congreso', 55);
  s.isCorreos = near('correosClock', 30);
  s.isAlmudena = near('almudenaDome', 65);
  return s;
}
function state(ctx) {
  if (!S || S.city !== ctx.city || S.track !== ctx.track) { S = analyse(ctx); S.track = ctx.track; }
  return S;
}

// facade style per building (cityScene's mod.styleFor hook)
function styleFor(b, k) {
  if (!S || b.far) return undefined;
  const ll = S.ll(b.cx, b.cz);
  const r = hash2(k, 13, 7);
  if (S.isTelef(b)) return STYLE.limestone;
  if (b.h > 70) {
    if (S.isTorre(b)) return STYLE.white;
    if (S.isEdEspana(b)) return STYLE.brick;
    return undefined;
  }
  if (S.isAlmudena(b)) return STYLE.limestone;
  if (inLL(ll, PALACIO_BOX) || S.isCongreso(b) || S.isCibPal(b) || S.isMetro(b)) return STYLE.stuccoB;
  if (S.isCorreos(b)) return STYLE.brick;
  if (b.church) return STYLE.limestone;
  if (inLL(ll, PLAZA_MAYOR)) return STYLE.stucco;
  if (S.granVia(b.cx, b.cz, 45) && b.h > 28) return r < 0.25 ? STYLE.limestone : r < 0.9 ? STYLE.stuccoB : STYLE.white;
  return r < 0.62 ? STYLE.stucco : r < 0.86 ? STYLE.stuccoB : r < 0.95 ? STYLE.brick : STYLE.limestone;
}
// roofs, tints and cornices (cityScene's mod.buildingOpts hook)
function buildingOpts(b, k, st, { hi, near }) {
  if (!S || b.far) return {};
  const ll = S.ll(b.cx, b.cz);
  const o = { cornice: false };
  const plaster = st === STYLE.stucco || st === STYLE.stuccoB || st === STYLE.limestone;
  // Madrid's footprints are detailed (~2x New York's wall edges): keep the
  // triangle count down by spending detail only where the course sees it.
  const dist = S.courseDist(b.cx, b.cz);
  if (!b.part && dist > 70) o.shop = false;
  // cornices only on walls that face the course, on the street frontage
  if (hi && plaster && near && b.h < 90 && dist < 45) {
    o.cornice = (ax, az, bx, bz, n) => {
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      return S.courseDist(mx + n[0] * 6, mz + n[2] * 6) < S.courseDist(mx, mz) - 2;
    };
  }
  const mansardOk = dist < 120;
  const r = hash2(k, 17, 5);
  if (inLL(ll, PLAZA_MAYOR)) { o.tint = r < 0.5 ? '#b5543c' : '#a94b34'; o.roof = mansardOk ? 'mansard' : 'tiles'; return o; }
  if (inLL(ll, PALACIO_BOX)) { o.tint = '#f4f1ea'; return o; }
  if (S.isCibPal(b)) { o.tint = '#fbfaf6'; return o; }
  if (S.isEdEspana(b)) { o.tint = '#d98b6c'; return o; }
  if (S.isCongreso(b)) { o.tint = '#e9dcc4'; return o; }
  if (S.isCorreos(b)) { o.tint = '#e19a78'; return o; }
  if (S.isMetro(b)) { o.tint = '#f6f2ea'; return o; }
  if (b.h > 60 || b.part) return o;
  if (S.granVia(b.cx, b.cz, 45)) { if (r < 0.55 && mansardOk) o.roof = 'mansard'; return o; }
  o.roof = r < 0.5 ? 'tiles' : r < 0.72 && mansardOk ? 'mansard' : undefined;
  return o;
}

// ---------------------------------------------------------------------------
// shared lookups for build(): buildings by position, roofs, facades, course frame
function lookups(ctx) {
  const grid = new Map(), C = 40;
  for (const b of ctx.city.buildings) {
    if (b.base == null || b.far) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < b.pts.length; k += 2) { x0 = Math.min(x0, b.pts[k]); x1 = Math.max(x1, b.pts[k]); z0 = Math.min(z0, b.pts[k + 1]); z1 = Math.max(z1, b.pts[k + 1]); }
    for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(z0 / C); j <= Math.floor(z1 / C); j++) {
      const key = i * 100003 + j;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(b);
    }
  }
  // tallest drawn building containing (x, z), or null
  S.buildingAt = (x, z, minH = 0) => {
    const l = grid.get(Math.floor(x / C) * 100003 + Math.floor(z / C));
    let best = null;
    if (l) for (const b of l) if (b.h >= minH && pipF(x, z, b.pts) && (!best || b.base + b.h > best.base + best.h)) best = b;
    return best;
  };
  S.roofAt = (x, z, fallback) => { const b = S.buildingAt(x, z); return b ? b.base + b.h : fallback; };
  const t = ctx.track;
  S.sample = (x, z) => ctx.courseAt(x, z).i;
  // first building wall met walking out from course sample i on side (+1 left, -1 right)
  S.facade = (i, side, maxD = 40, minH = 8) => {
    const w = side > 0 ? t.wallL[i] : t.wallR[i];
    for (let d = w + 0.5; d < maxD; d += 0.5) {
      const x = t.px[i] + t.nx[i] * side * d, z = t.pz[i] + t.nz[i] * side * d;
      const b = S.buildingAt(x, z, minH);
      if (b) {
        // back off to just outside the wall
        const xo = t.px[i] + t.nx[i] * side * (d - 0.45), zo = t.pz[i] + t.nz[i] * side * (d - 0.45);
        return { x: xo, z: zo, d, b, y: ctx.groundY(xo, zo), top: b.base + b.h, nx: -t.nx[i] * side, nz: -t.nz[i] * side };
      }
    }
    return null;
  };
  // push (x, z) out of the course so a monument of radius r clears the barriers
  S.clear = (x, z, r) => {
    const c = ctx.courseAt(x, z);
    const w = c.d > 0 ? c.wallL : c.wallR, need = w + 1 + r;
    if (Math.abs(c.d) >= need || c.dist > 60) return [x, z];
    const sg = c.d >= 0 ? 1 : -1, push = need - Math.abs(c.d);
    return [x + t.nx[c.i] * sg * push, z + t.nz[c.i] * sg * push];
  };
  // room between the course barrier and (x, z)
  S.room = (x, z) => {
    const c = ctx.courseAt(x, z);
    return c.dist > 60 ? 60 : Math.abs(c.d) - (c.d > 0 ? c.wallL : c.wallR) - 0.8;
  };
}

// ---------------------------------------------------------------------------
// 1. Gran Vía: Metrópolis dome + Winged Victory, Telefónica mast, Edificio Carrión
//    rooftop sign, theatre blade signs, Callao screens
function buildMetropolis(ctx) {
  const hi = ctx.hi;
  const [tx, tz] = ctx.project(...LL.metroTip);
  // the drum: a round part near the tip of the wedge
  let drum = null;
  for (const b of ctx.city.buildings) {
    if (b.base == null || !b.part || b.area < 60 || b.area > 320 || b.h < 25) continue;
    const d = Math.hypot(b.cx - tx, b.cz - tz);
    if (d < 30 && (!drum || d < Math.hypot(drum.cx - tx, drum.cz - tz))) drum = b;
  }
  const cx = drum ? drum.cx : tx, cz = drum ? drum.cz : tz;
  const r = drum ? Math.min(7.5, Math.sqrt(drum.area / Math.PI)) : 6.2;
  const y0 = drum ? drum.base + drum.h : ctx.groundY(cx, cz) + 37;
  const b = ctx.boxes(cx, cz);
  const f = frame(b, cx, y0, cz, 0);
  // colonnaded drum ring, cornice, black slate dome with gilded garlands, lantern
  oct(f, 0, 0, 0, 0.6, r + 0.3, '#efe9dd');
  if (hi) for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; f.rbox(Math.cos(a) * (r - 0.2), Math.sin(a) * (r - 0.2), -a, -0.3, 0.6, -0.3, 0.3, 4.2, 0.3, '#f4efe4'); }
  oct(f, 0, 0, 0.6, 4.2, r - 0.6, '#3a4048');
  oct(f, 0, 0, 4.2, 5.0, r + 0.2, '#efe9dd');
  dome(f, 0, 0, 5.0, r - 0.2, r * 0.95, hi ? 7 : 5, '#1f2328', GOLD);
  const top = 5.0 + r * 0.95;
  ring(f, 0, 0, 5.8, 6.3, r - 0.1, 0.3, hi ? 20 : 12, GOLD);
  oct(f, 0, 0, top - 0.3, top + 1.6, 1.3, '#1f2328');
  oct(f, 0, 0, top + 1.6, top + 2.0, 1.6, GOLD);
  oct(f, 0, 0, top + 2.0, top + 3.0, 0.9, '#2a2e33');
  // La Victoria alada: bronze figure, arms raised, gilded wings
  const yv = y0 + top + 3.0;
  const facing = rotToward(-(ctx.track.tx[S.sample(cx, cz)]), -(ctx.track.tz[S.sample(cx, cz)])); // towards the oncoming Gran Vía
  const v = frame(b, cx, yv, cz, facing);
  figure(v, 5.2, BRONZE, 1);
  v.box(-0.95, 0.3, -0.25, -0.65, 3.4, 0.25, BRONZE); // raised arm with wreath
  v.box(-1.3, 3.4, -0.1, -0.4, 3.9, 0.1, GOLD);
  v.box(-0.6, 0, -0.5, 0.6, 2.4, 0.5, BRONZE_D); // robe
  const W = frame(ctx.boxes(cx, cz), cx, yv, cz, facing);
  for (const s of [-1, 1]) {
    W.box(s * 0.3, 2.6, -0.7, s * 2.1, 3.4, -0.45, GOLD); // wings
    W.box(s * 0.6, 3.4, -0.75, s * 2.6, 4.6, -0.5, GOLD);
    W.box(s * 1.2, 4.6, -0.8, s * 2.9, 5.6, -0.55, GOLD);
    W.box(s * 1.9, 5.6, -0.85, s * 3.0, 6.3, -0.6, '#e8c45a');
  }
  S.metropolis = { x: cx, z: cz, y: y0 };
}

function buildTelefonica(ctx) {
  const [x0, z0] = ctx.project(...LL.telefonica);
  let top = null;
  for (const b of ctx.city.buildings) if (b.base != null && b.h > 60 && Math.hypot(b.cx - x0, b.cz - z0) < 30 && (!top || b.h > top.h)) top = b;
  if (!top) return;
  const y = top.base + top.h;
  const f = frame(ctx.boxes(top.cx, top.cz), top.cx, y, top.cz, 0);
  f.box(-2.2, 0, -2.2, 2.2, 2.4, 2.2, '#ddd3c0'); // crowning lantern
  f.box(-1.6, 2.4, -1.6, 1.6, 3.2, 1.6, '#c9bea9');
  f.box(-0.2, 3.2, -0.2, 0.2, 14, 0.2, '#7d8288'); // radio mast
  for (const yy of [6, 9, 12]) f.box(-0.9, yy, -0.06, 0.9, yy + 0.12, 0.06, '#7d8288');
  frame(ctx.boxes(top.cx, top.cz, 'glow'), top.cx, y, top.cz, 0).box(-0.25, 14, -0.25, 0.25, 14.4, 0.25, '#ff3b30');
  flag(f, 0.25, 0, 3.2 + 4.5, 2.2, 1.5, SPAIN);
}

// rooftop neon on the Carrión prow, lit letter by letter (a nod to the famous one)
function drawCarrion(g, w, h, fr) {
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(10,14,38,0.92)'; g.fillRect(0, 0, w, h);
  const word = 'TÓNICA', n = word.length;
  const step = fr % 40, lit = step < 24 ? Math.min(n, Math.floor(step / 3)) : step < 32 ? (step % 2 ? n : 0) : n;
  g.font = `bold ${Math.round(h * 0.52)}px Arial, sans-serif`;
  g.textBaseline = 'middle'; g.textAlign = 'left';
  const total = (g.measureText && g.measureText(word).width) || w * 0.8;
  let x = (w - total) / 2;
  for (let k = 0; k < n; k++) {
    const ch = word[k], cw = (g.measureText && g.measureText(ch).width) || total / n;
    g.fillStyle = k < lit ? '#ffd23a' : '#4a3d14';
    g.fillText(ch, x, h * 0.4);
    x += cw;
  }
  g.fillStyle = step >= 24 && step < 32 && step % 2 === 0 ? '#3a2a10' : '#ff8a1c';
  g.font = `bold ${Math.round(h * 0.2)}px Arial, sans-serif`;
  g.textAlign = 'center';
  g.fillText('CUBO  ·  SINCE 1933', w / 2, h * 0.84);
  // bubbles
  for (let k = 0; k < 6; k++) {
    g.fillStyle = (k + fr) % 3 ? '#9fe6ff' : '#ffffff';
    g.beginPath(); g.arc(w * (0.06 + 0.045 * (k % 2)), h * (0.85 - k * 0.13), h * 0.035, 0, Math.PI * 2); g.fill();
  }
}
// theatre blade signs (vertical, two-sided) + marquees for fictional shows
const THEATRES = [
  ['TEATRO PÍXEL', '#b3122a', '#ffe08a'], ['CINE VÓXEL', '#14306e', '#9fe6ff'],
  ['COLISEO CÚBICO', '#1d1d1f', '#ff5fb0'], ['TEATRO BLOQUE', '#5a1a6b', '#ffd23a'],
];
const SHOWS = [['EL REY CUBO', 'EL MUSICAL', '#f2c230', '#2a0f4a'], ['LOS 8 BITS', 'ÚLTIMAS SEMANAS', '#ffffff', '#b3122a']];
function drawTheatres(g) {
  THEATRES.forEach(([name, bg, fg], k) => {
    const x = k * 64;
    g.fillStyle = bg; g.fillRect(x, 0, 64, 320);
    g.fillStyle = fg; g.fillRect(x + 3, 3, 58, 3); g.fillRect(x + 3, 314, 58, 3);
    g.font = 'bold 34px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const letters = name.replace(' ', '').split('');
    const step = 300 / letters.length;
    letters.forEach((ch, j) => { g.fillStyle = fg; g.fillText(ch, x + 32, 14 + step * (j + 0.5)); });
  });
  SHOWS.forEach(([a, b2, fg, bg], k) => {
    const y = 320 + k * 96;
    g.fillStyle = bg; g.fillRect(0, y, 512, 96);
    for (let j = 0; j < 32; j++) { g.fillStyle = j % 2 ? '#fff6c8' : fg; g.fillRect(j * 16 + 4, y + 2, 6, 6); g.fillRect(j * 16 + 4, y + 88, 6, 6); }
    fitText(g, a, 256, y + 40, 480, 46, fg);
    fitText(g, b2, 256, y + 74, 400, 20, '#ffffff');
  });
}
// Callao screen: cycling fictional ads
const CALLAO_ADS = [['VOXA COLA', '#c8102e', '#ffffff'], ['BYTEPHONE 9', '#0b0b10', '#5ff2ff'], ['GRAN PREMIO DE MADRID', '#ffc400', '#c60b1e'], ['CHURROS CUBO', '#f4e1b0', '#7a3b12']];
function drawCallao(g, w, h, fr) {
  const k = Math.floor(fr / 40) % CALLAO_ADS.length, t = (fr % 40) / 40;
  const [name, bg, fg] = CALLAO_ADS[k];
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  for (let j = 0; j < 8; j++) g.fillRect(((j * 40 + fr * 3) % (w + 40)) - 40, h * 0.12, 20, 6);
  fitText(g, name, w / 2, h * 0.5, w * 0.9, Math.round(h * 0.28 * (0.9 + 0.1 * Math.sin(t * Math.PI))), fg);
  fitText(g, 'EN DIRECTO · LIVE', w / 2, h * 0.82, w * 0.8, Math.round(h * 0.11), fg);
}

function buildGranVia(ctx) {
  const hi = ctx.hi, track = ctx.track;
  // Edificio Carrión rooftop sign: two faces, one for each direction of the Gran Vía
  {
    const [x, z] = ctx.project(...LL.carrion);
    const i = S.sample(x, z);
    const y = S.roofAt(x, z, ctx.groundY(x, z) + 54);
    const W = 15, H = 6.5, lift = 3.2;
    const c = makeCanvas(512, 224), g = c.getContext('2d');
    drawCarrion(g, c.width, c.height, 0);
    const grp = quadGroup(ctx, c, { double: false });
    const tx = track.tx[i], tz = track.tz[i];
    grp.quad(x - tx * 0.35, y + lift, z - tz * 0.35, -tx, -tz, W, H); // facing traffic from Plaza de España
    grp.quad(x + tx * 0.35, y + lift, z + tz * 0.35, tx, tz, W, H);
    grp.flush();
    // steel lattice frame
    const f = frame(ctx.boxes(x, z), x, y, z, rotToward(tx, tz) + Math.PI / 2);
    for (let u = -W / 2; u <= W / 2 + 0.01; u += W / 6) {
      f.box(u - 0.12, 0, -0.3, u + 0.12, lift + H + 0.3, 0.3, '#2b2f36');
      if (hi) for (let yy = 0.8; yy < lift; yy += 0.8) f.box(u - 0.04, yy, -0.32, u + 0.04 + W / 6 * 0.98 * (u < W / 2 - 0.1 ? 1 : 0), yy + 0.06, 0.32, '#3a3f47');
    }
    f.box(-W / 2 - 0.2, lift - 0.25, -0.32, W / 2 + 0.2, lift, 0.32, '#2b2f36');
    f.box(-W / 2 - 0.2, lift + H, -0.32, W / 2 + 0.2, lift + H + 0.25, 0.32, '#2b2f36');
    const tex = grp.tex;
    let acc = 0, fr = 0;
    ctx.animate((time, dt) => {
      acc += dt || 0;
      if (acc < 0.12) return;
      acc = 0; fr++;
      drawCarrion(g, c.width, c.height, fr);
      tex.needsUpdate = true;
    });
  }
  // theatre blade signs + marquees between Callao and Red de San Luis
  {
    const c = makeCanvas(512, 512), g = c.getContext('2d');
    drawTheatres(g);
    const blades = quadGroup(ctx, c, { double: true });
    const marq = quadGroup(ctx, makeCanvasCopy(c), {});
    const spots = [[0.052, 1], [0.075, -1], [0.098, 1], [0.118, -1]];
    spots.forEach(([u, side], k) => {
      const i = Math.floor(u * track.N);
      const h = S.facade(i, side, 30, 12);
      if (!h) return;
      const tx = track.tx[i], tz = track.tz[i];
      const out = 1.3;
      const bx = h.x + h.nx * out, bz = h.z + h.nz * out;
      // blade sticks out of the facade: its faces look up and down the street
      blades.quad(bx, h.y + 7, bz, tx, tz, 2.2, 11, [k / 8, 1 - 320 / 512, (k + 1) / 8, 1]);
      const f = frame(ctx.boxes(bx, bz), bx, h.y + 7, bz, rotToward(tx, tz));
      f.box(-1.25, -0.25, -0.12, 1.25, 0, 0.12, '#1c1d22');
      f.box(-1.25, 11, -0.12, 1.25, 11.25, 0.12, '#1c1d22');
      if (k < 2) {
        // marquee over the entrance with bulbs
        const mx = h.x + h.nx * 0.3, mz = h.z + h.nz * 0.3;
        marq.quad(mx, h.y + 4.4, mz, h.nx, h.nz, 12, 2.25, [0, (1 - k) * 96 / 512, 1, ((1 - k) * 96 + 96) / 512]);
        const m = frame(ctx.boxes(mx, mz), mx, h.y + 4.4, mz, rotToward(h.nx, h.nz));
        m.box(-6.2, -0.35, -0.6, 6.2, 0, 1.6, '#1c1d22');
      }
    });
    blades.flush(); marq.flush();
  }
  // Callao: big screen on the corner block
  {
    const i = Math.floor(0.05 * track.N);
    const h = S.facade(i, 1, 40, 15) || S.facade(i, -1, 40, 15);
    if (h) {
      const c = makeCanvas(256, 144), g = c.getContext('2d');
      drawCallao(g, 256, 144, 0);
      const grp = quadGroup(ctx, c, {});
      grp.quad(h.x + h.nx * 0.25, h.y + 12, h.z + h.nz * 0.25, h.nx, h.nz, 14, 7.9);
      grp.flush();
      const f = frame(ctx.boxes(h.x, h.z), h.x, h.y + 12, h.z, rotToward(h.nx, h.nz));
      f.box(-7.3, -0.3, -0.25, 7.3, 8.2, 0.2, '#16171b');
      let acc = 0, fr = 0;
      ctx.animate((time, dt) => {
        acc += dt || 0;
        if (acc < 0.1) return;
        acc = 0; fr++;
        drawCallao(g, 256, 144, fr);
        grp.tex.needsUpdate = true;
      });
    }
  }
}
function makeCanvasCopy(src) {
  const c = makeCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

// ---------------------------------------------------------------------------
// 2. Cibeles: the fountain (Cybele on her lion chariot), Palacio de Cibeles
//    pinnacles + race banner, Fuente de Apolo on the Prado
function buildCibeles(ctx) {
  const hi = ctx.hi;
  const [x, z] = ctx.project(...LL.cibeles);
  const R = Math.max(6, Math.min(13, S.room(x, z) - 0.5));
  const y = ctx.groundY(x, z);
  const b = ctx.boxes(x, z);
  // the goddess looks west, down Alcalá towards the approaching cars
  const f = frame(b, x, y, z, -Math.PI / 2);
  oct(f, 0, 0, -0.3, 0.25, R, WATER);
  ring(f, 0, 0, -0.3, 0.75, R, 0.7, hi ? 28 : 16, '#d6cfbf');
  // rocky mound and the chariot
  f.box(-4.2, 0, -3.2, 4.2, 1.4, 3.2, '#a99d86');
  f.box(-3.2, 1.4, -2.4, 3.2, 2.2, 2.4, '#b8ad97');
  const MAR = '#e7e1d4', MAR_D = '#cfc7b6';
  f.box(-1.4, 2.2, -2.3, 1.4, 3.6, 0.6, MAR); // chariot body
  f.box(-1.5, 3.6, -2.4, 1.5, 3.8, 0.7, MAR_D);
  for (const s of [-1, 1]) {
    // wheels
    const w = f.sub(s * 1.55, 0, -1.0);
    for (let k = 0; k < (hi ? 12 : 8); k++) {
      const a = (k / (hi ? 12 : 8)) * Math.PI * 2;
      w.box(-0.12, 2.9 + Math.sin(a) * 1.0 - 0.18, Math.cos(a) * 1.0 - 0.18, 0.12, 2.9 + Math.sin(a) * 1.0 + 0.18, Math.cos(a) * 1.0 + 0.18, MAR_D);
    }
    w.box(-0.14, 2.75, -0.15, 0.14, 3.05, 0.15, MAR_D);
  }
  // Cybele seated, crown of towers, sceptre and key
  const c = f.sub(0, 3.8, -1.1);
  seated(c, 3.0, MAR);
  c.box(-0.3, 3.0, -0.35, 0.3, 3.35, 0.15, MAR_D);
  for (const s of [-1, 1]) c.box(s * 0.22 - 0.06, 3.35, -0.1, s * 0.22 + 0.06, 3.5, 0.0, MAR_D);
  c.box(0.6, 0.9, 0.3, 0.7, 3.4, 0.4, MAR_D); // sceptre
  // the two lions pulling the chariot
  const LS = '#ddd5c4', LD = '#cbc2ae', LM = '#bdb39d', LK = '#6b6152';
  for (const s of [-1, 1]) lion(scaled(f.sub(s * 1.1, 2.2, 3.0), 1.25), LS, LD, LM, LK);
  // jets
  if (hi) {
    const g = frame(ctx.boxes(x, z, 'glow'), x, y, z, 0);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2, rr = R - 2.2;
      g.box(Math.cos(a) * rr - 0.08, 0.25, Math.sin(a) * rr - 0.08, Math.cos(a) * rr + 0.08, 1.9, Math.sin(a) * rr + 0.08, '#e8f6ff');
    }
  }
  // Palacio de Cibeles: pinnacles on the towers, spire on the tallest, race banner
  const [px0, pz0] = ctx.project(...LL.cibelesPal);
  const parts = ctx.city.buildings.filter((p) => p.base != null && !p.far && Math.hypot(p.cx - px0, p.cz - pz0) < 75);
  let tallest = null;
  for (const p of parts) {
    if (p.h >= 28 && p.area < 200) {
      const pf = frame(ctx.boxes(p.cx, p.cz), p.cx, p.base + p.h, p.cz, 0);
      const r = Math.sqrt(p.area) * 0.5;
      pf.box(-r * 0.8, 0, -r * 0.8, r * 0.8, 1.2, r * 0.8, '#f6f4ee');
      pf.box(-r * 0.5, 1.2, -r * 0.5, r * 0.5, 2.6, r * 0.5, '#efece4');
      pf.box(-0.25, 2.6, -0.25, 0.25, 5.5, 0.25, '#f6f4ee');
      if (hi) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) pf.box(sx * r * 0.85 - 0.15, 0, sz * r * 0.85 - 0.15, sx * r * 0.85 + 0.15, 2.4, sz * r * 0.85 + 0.15, '#f6f4ee');
    }
    if (!tallest || p.h > tallest.h) tallest = p;
  }
  if (tallest) {
    const tf = frame(ctx.boxes(tallest.cx, tallest.cz), tallest.cx, tallest.base + tallest.h, tallest.cz, 0);
    tf.box(-3, 0, -3, 3, 3, 3, '#f4f1ea');
    tf.box(-2.2, 3, -2.2, 2.2, 6, 2.2, '#ece8de');
    tf.box(-1.4, 6, -1.4, 1.4, 8, 1.4, '#e4dfd3');
    tf.box(-0.2, 8, -0.2, 0.2, 13, 0.2, '#d8d2c4');
    flag(tf, 0.2, 0, 12.6, 3, 2, SPAIN);
  }
  // race banner down the facade facing the course
  {
    const i = S.sample(px0, pz0);
    const side = (px0 - ctx.track.px[i]) * ctx.track.nx[i] + (pz0 - ctx.track.pz[i]) * ctx.track.nz[i] > 0 ? 1 : -1;
    const h = S.facade(i, side, 80, 15);
    if (h) {
      const cv = makeCanvas(128, 512), g = cv.getContext('2d');
      g.fillStyle = '#c60b1e'; g.fillRect(0, 0, 128, 512);
      g.fillStyle = '#ffc400'; g.fillRect(0, 120, 128, 272);
      g.save(); g.translate(64, 256); g.rotate(-Math.PI / 2);
      fitText(g, 'GRAN PREMIO DE MADRID', 0, -18, 440, 34, '#7a0a14');
      fitText(g, 'VOXEL GT', 0, 26, 300, 40, '#111111');
      g.restore();
      const grp = quadGroup(ctx, cv, { lit: true });
      grp.quad(h.x + h.nx * 0.2, h.y + 5, h.z + h.nz * 0.2, h.nx, h.nz, 5, 20);
      grp.flush();
    }
  }
  // Fuente de Apolo on the Prado boulevard
  {
    const [ax, az] = ctx.project(...LL.apolo);
    if (S.room(ax, az) > 6) {
      const ay = ctx.groundY(ax, az);
      const af = frame(ctx.boxes(ax, az), ax, ay, az, Math.PI);
      oct(af, 0, 0, 0, 0.3, 5.5, WATER);
      ring(af, 0, 0, 0, 0.7, 5.5, 0.5, 14, '#d6cfbf');
      af.box(-1.6, 0, -1.6, 1.6, 2.2, 1.6, '#cfc7b6');
      af.box(-1.1, 2.2, -1.1, 1.1, 5.4, 1.1, '#ddd6c6');
      af.box(-1.4, 5.4, -1.4, 1.4, 5.8, 1.4, '#cfc7b6');
      figure(af.sub(0, 5.8, 0), 2.6, '#e8e2d6', 1);
    }
  }
}

// 3. Paseo del Prado: rows of plane trees on the boulevard
function buildPrado(ctx) {
  const t = ctx.track, hi = ctx.hi;
  const i0 = Math.floor(0.292 * t.N), i1 = Math.floor(0.38 * t.N);
  const trees = ctx.city.pois.filter((p) => p.kind === 0);
  const step = Math.round((hi ? 9 : 14) / t.ds);
  for (let i = i0; i < i1; i += step) {
    for (const side of [1, -1]) {
      for (const extra of hi ? [3.2, 10] : [3.2]) {
        const w = (side > 0 ? t.wallL[i] : t.wallR[i]) + extra;
        const x = t.px[i] + t.nx[i] * side * w, z = t.pz[i] + t.nz[i] * side * w;
        if (S.buildingAt(x, z) || trees.some((p) => Math.abs(p.x - x) < 5 && Math.abs(p.z - z) < 5)) continue;
        ctx.props.streetTree(ctx.boxes(x, z), x, ctx.groundY(x, z), z, i * 0.31 + side + extra, 1.45);
      }
    }
  }
}

// 4. Neptuno: Neptune with trident on a shell chariot drawn by sea-horses
function buildNeptuno(ctx) {
  const hi = ctx.hi;
  const [x, z] = ctx.project(...LL.neptuno);
  const R = Math.max(6, Math.min(12, S.room(x, z) - 0.5));
  const y = ctx.groundY(x, z);
  const f = frame(ctx.boxes(x, z), x, y, z, Math.PI); // facing north up the Prado, towards Cibeles
  oct(f, 0, 0, -0.3, 0.25, R, WATER);
  ring(f, 0, 0, -0.3, 0.75, R, 0.7, hi ? 26 : 14, '#d6cfbf');
  const MAR = '#e4ded1', MAR_D = '#c9c1b0', K = 1.5;
  const F = scaled(f, K);
  F.box(-2.6, 0, -2.6, 2.6, 1.0, 2.6, '#b3a892');
  F.box(-1.6, 1.0, -2.0, 1.6, 2.2, 1.0, MAR_D); // shell chariot
  F.box(-1.9, 2.0, -2.3, 1.9, 2.6, -1.5, MAR);
  const n = scaled(f.sub(0, 2.2 * K, -0.6 * K), K);
  figure(n, 3.2, MAR, 1); // Neptune
  n.box(0.35, 1.0, -0.05, 0.47, 4.6, 0.07, '#a39b8a'); // trident
  for (const dx of [-0.25, 0, 0.25]) n.box(0.41 + dx - 0.04, 4.6, -0.04, 0.41 + dx + 0.04, 5.0, 0.06, '#a39b8a');
  // sea-horses: horse fore-quarters ending in a curled fish tail
  for (const s of [-1, 1]) {
    const h = scaled(f.sub(s * 0.8 * K, 1.0 * K, 1.6 * K), K);
    horse(h, MAR, MAR_D, 2);
    h.box(-0.25, 0, -1.6, 0.25, 0.5, -0.8, MAR_D);
    h.box(-0.2, 0.5, -2.0, 0.2, 1.2, -1.6, MAR_D);
  }
  if (hi) {
    const g = frame(ctx.boxes(x, z, 'glow'), x, y, z, 0);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, rr = R - 1.8;
      g.box(Math.cos(a) * rr - 0.07, 0.25, Math.sin(a) * rr - 0.07, Math.cos(a) * rr + 0.07, 1.6, Math.sin(a) * rr + 0.07, '#e8f6ff');
    }
  }
}

// 5. Congreso de los Diputados: portico, pediment, the bronze lions, flags;
//    Cervantes in the Plaza de las Cortes
function buildCongreso(ctx) {
  const hi = ctx.hi, t = ctx.track;
  const [lx, lz] = ctx.project(...LL.congreso);
  const i = S.sample(lx, lz);
  const side = (lx - t.px[i]) * t.nx[i] + (lz - t.pz[i]) * t.nz[i] > 0 ? 1 : -1;
  const h = S.facade(i, side, 60, 6);
  if (!h) return;
  const room = Math.max(4, Math.min(9, h.d - (side > 0 ? t.wallL[i] : t.wallR[i]) - 1.5));
  // local frame: +z out of the facade towards the street, +x along it
  const f = frame(ctx.boxes(h.x, h.z), h.x, h.y, h.z, rotToward(h.nx, h.nz));
  const ST = '#e6dcc8', ST_D = '#d2c6ae';
  const depth = room;
  // steps
  for (let k = 0; k < 5; k++) f.box(-11, 0, 0, 11, 0.35 * (5 - k), depth - k * 0.6, ST_D);
  // six Corinthian columns, entablature, pediment
  const cz = depth - 3.2;
  for (let k = 0; k < 6; k++) {
    const cx = -8.5 + k * 3.4;
    f.box(cx - 0.75, 1.75, cz - 0.75, cx + 0.75, 2.3, cz + 0.75, ST_D);
    f.box(cx - 0.55, 2.3, cz - 0.55, cx + 0.55, 12.3, cz + 0.55, ST);
    f.box(cx - 0.75, 12.3, cz - 0.75, cx + 0.75, 13.0, cz + 0.75, ST_D);
  }
  f.box(-9.6, 13.0, 0, 9.6, 14.8, cz + 0.9, ST);
  f.box(-9.9, 14.8, 0, 9.9, 15.2, cz + 1.1, ST_D);
  for (let k = 0; k < 6; k++) {
    const w = 9.6 * (1 - k / 6);
    f.box(-w, 15.2 + k * 0.6, 0, w, 15.8 + k * 0.6, cz + 0.7, k % 2 ? ST : ST_D);
  }
  if (hi) f.box(-4.5, 15.5, cz + 0.72, 4.5, 16.8, cz + 0.8, '#bfb39b'); // tympanum relief
  f.box(-9.5, 1.75, 0, 9.5, 13, 0.4, '#d9ceb8');
  f.box(-1.6, 1.75, 0.38, 1.6, 6.8, 0.45, '#3d2f22'); // the great door
  // Daoíz and Velarde: bronze lions on pedestals either side of the steps
  for (const s of [-1, 1]) {
    const px = s * 12.6, pz = Math.min(depth - 0.5, 4.5);
    f.box(px - 1.4, 0, pz - 2.8, px + 1.4, 2.0, pz + 2.8, GRANITE);
    lion(scaled(f.sub(px, 2.0, pz - 0.3), 1.1), '#5b4a32', '#4d3f2b', '#433626', '#1d1812');
  }
  // flags on the roof
  for (const s of [-1, 1]) {
    const fx = s * 6;
    f.box(fx - 0.08, 15.2, 0.2, fx + 0.08, 23, 0.36, '#d8d8d8');
    flag(f, fx + 0.08, 0.28, 22.8, 2.8, 1.9, SPAIN, Math.PI / 2);
  }
  // Cervantes in the Plaza de las Cortes
  {
    let [cx2, cz2] = ctx.project(...LL.cortes);
    [cx2, cz2] = S.clear(cx2, cz2, 2.5);
    const cy = ctx.groundY(cx2, cz2);
    const cf = frame(ctx.boxes(cx2, cz2), cx2, cy, cz2, rotToward(h.nx, h.nz) + Math.PI);
    cf.box(-2, 0, -2, 2, 0.5, 2, GRANITE);
    cf.box(-1.2, 0.5, -1.2, 1.2, 4.2, 1.2, '#c9c0ad');
    cf.box(-1.5, 4.2, -1.5, 1.5, 4.6, 1.5, GRANITE);
    figure(cf.sub(0, 4.6, 0), 2.8, BRONZE, 0);
    cf.box(-0.45, 4.6, -0.3, 0.45, 6.3, 0.35, BRONZE_D); // cape
  }
}

// ---------------------------------------------------------------------------
// 6. Puerta del Sol: Casa de Correos clock tower, Kilómetro Cero, the Bear and
//    the Strawberry Tree, Carlos III, the Mariblanca, and the rooftop neon
function drawSolSign(g, w, h, fr) {
  g.clearRect(0, 0, w, h);
  const flick = fr % 50 < 3;
  const N = (c) => (flick ? '#5a2a20' : c);
  // character art on a 32-unit grid, scaled up about the centre line to fill the frame
  const P = (x, y, ww, hh, c) => { g.fillStyle = c; g.fillRect(((x - 16) * 1.45 + 16) * w / 32, y * 1.2 * h / 32, ww * 1.45 * w / 32, hh * 1.2 * h / 32); };
  // the bottle character: wide-brimmed hat, short jacket, guitar
  P(9, 1, 10, 1.4, N('#151515')); P(11.5, 0, 5, 1.2, N('#151515')); // hat
  P(13, 2.4, 2, 2.2, '#2b7a2b'); P(12.6, 4.4, 2.8, 1.2, '#2b7a2b'); // neck
  P(11, 5.5, 6, 13, '#1e5a1e'); // bottle body
  P(10, 6, 8, 6.5, N('#d42a2a')); // jacket
  P(13.5, 7, 1, 5, '#f4f1ea'); // shirt
  P(11.5, 12.6, 5, 4.4, N('#f4e6b0')); // label
  P(12.2, 13.4, 3.6, 0.6, '#b3122a'); P(12.2, 14.6, 3.6, 0.6, '#b3122a');
  // guitar
  P(18, 9, 4.5, 4, N('#f2a33a')); P(18.6, 13, 3.4, 3, N('#f2a33a')); P(19.9, 11.2, 1, 1, '#2b1a0a');
  P(19.2, 4, 0.8, 5, N('#7a4a1c')); P(18.8, 3, 1.6, 1.2, N('#7a4a1c'));
  P(17, 8, 2, 1.2, N('#d42a2a')); // arm round the guitar
  // the lettering
  fitText(g, 'TÍO BLOQUE', w / 2, h * 0.8, w * 0.98, Math.round(h * 0.18), fr % 50 === 7 ? '#5a4a2a' : '#ffe9a8');
  fitText(g, 'SOL DE VÓXEL EMBOTELLADO', w / 2, h * 0.94, w * 0.96, Math.round(h * 0.08), '#ffd23a');
}
function buildSol(ctx) {
  const hi = ctx.hi;
  // Casa de Correos clock tower: stone tower, four clock faces, iron bell cage and the time ball
  {
    const [x, z] = ctx.project(...LL.correosClock);
    const y = S.roofAt(x, z, ctx.groundY(x, z) + 15.5);
    const i = S.sample(x, z);
    const t = ctx.track;
    const facing = rotToward(t.px[i] - x, t.pz[i] - z); // the clock faces the plaza
    const f = frame(ctx.boxes(x, z), x, y, z, facing);
    f.box(-2.6, 0, -2.6, 2.6, 1.2, 2.6, '#e8e1d2');
    f.box(-2.2, 1.2, -2.2, 2.2, 5.6, 2.2, '#e4dccb');
    f.box(-2.5, 5.6, -2.5, 2.5, 6.1, 2.5, '#d4cab6');
    for (let k = 0; k < 4; k++) {
      const c = f.sub(0, 0, 0, (k * Math.PI) / 2);
      c.box(-1.35, 2.0, 2.2, 1.35, 4.7, 2.36, '#f7f4ec'); // dial
      c.box(-0.06, 3.35, 2.36, 0.06, 4.45, 2.42, '#1b1b1b'); // minute hand
      c.box(-0.06, 3.3, 2.36, 0.75, 3.42, 2.42, '#1b1b1b'); // hour hand
      c.box(-1.35, 2.0, 2.36, 1.35, 2.1, 2.4, '#3a3a3a');
    }
    // templete: four iron posts, ogee cap, mast and the golden time ball
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) f.box(sx * 1.6 - 0.1, 6.1, sz * 1.6 - 0.1, sx * 1.6 + 0.1, 8.6, sz * 1.6 + 0.1, '#25272b');
    f.box(-0.5, 6.1, -0.5, 0.5, 7.4, 0.5, '#6b5a3a'); // bell
    f.box(-1.9, 8.6, -1.9, 1.9, 8.9, 1.9, '#25272b');
    f.box(-1.2, 8.9, -1.2, 1.2, 9.6, 1.2, '#25272b');
    f.box(-0.6, 9.6, -0.6, 0.6, 10.1, 0.6, '#25272b');
    f.box(-0.07, 10.1, -0.07, 0.07, 13.2, 0.07, '#25272b');
    oct(f, 0, 0, 11.3, 12.3, 0.55, GOLD);
    flag(f, 0.07, 0, 13.1, 1.6, 1.1, SPAIN, Math.PI / 2);
  }
  // Kilómetro Cero: the plaque set in the pavement in front of the Casa de Correos
  {
    const [x, z] = ctx.project(...LL.km0);
    const c = ctx.courseAt(x, z);
    const onRoad = Math.abs(c.d) < (c.d > 0 ? c.wallL : c.wallR);
    const y = (onRoad ? ctx.track.py[c.i] : ctx.groundY(x, z)) + (onRoad ? 0.025 : 0.17);
    const f = frame(ctx.boxes(x, z, 'deco'), x, y, z, c.heading);
    f.box(-0.7, 0, -0.45, 0.7, 0.012, 0.45, '#d9d2c2', { flat: true });
    f.box(-0.55, 0.012, -0.32, 0.55, 0.02, 0.32, '#8f8778', { flat: true });
    f.box(-0.3, 0.02, -0.18, 0.3, 0.026, 0.18, '#d9a93a', { flat: true });
  }
  // the Bear and the Strawberry Tree
  {
    let [x, z] = ctx.project(...LL.oso);
    [x, z] = S.clear(x, z, 2.2);
    const y = ctx.groundY(x, z);
    const f = frame(ctx.boxes(x, z), x, y, z, Math.PI * 0.75);
    f.box(-1.6, 0, -1.6, 1.6, 1.6, 1.6, '#cfc7b5'); // stone pedestal
    f.box(-1.75, 1.6, -1.75, 1.75, 1.8, 1.75, GRANITE);
    // madroño: trunk and crown with red berries
    f.box(0.4, 1.8, 0.2, 0.75, 4.2, 0.55, '#3d3125');
    f.box(-0.6, 3.6, -0.6, 1.8, 5.2, 1.4, '#3f5a2c');
    f.box(-0.2, 5.2, -0.2, 1.4, 6.0, 1.0, '#4b6a33');
    if (hi) for (let k = 0; k < 10; k++) f.box(-0.5 + (k % 5) * 0.5, 3.7 + Math.floor(k / 5) * 1.6, 1.38, -0.32 + (k % 5) * 0.5, 3.88 + Math.floor(k / 5) * 1.6, 1.46, '#c8202a');
    // the bear, up on its hind legs reaching for the fruit
    const B = '#5a4a36', BD = '#47392a';
    f.box(-0.55, 1.8, -0.75, 0.25, 2.9, 0.05, B); // legs + hips
    f.box(-0.6, 2.9, -0.65, 0.3, 4.1, 0.15, B); // body
    f.box(-0.45, 4.1, -0.45, 0.2, 4.7, 0.25, BD); // head
    f.box(-0.3, 4.2, 0.25, 0.05, 4.5, 0.55, BD); // snout
    f.box(-0.1, 3.6, 0.1, 0.5, 3.85, 0.6, B); // paws on the trunk
  }
  // Carlos III on horseback
  {
    let [x, z] = ctx.project(...LL.carlos3);
    [x, z] = S.clear(x, z, 3.5);
    const y = ctx.groundY(x, z);
    const f = frame(ctx.boxes(x, z), x, y, z, Math.PI / 2);
    f.box(-2.2, 0, -3.6, 2.2, 0.6, 3.6, GRANITE);
    f.box(-1.6, 0.6, -3.0, 1.6, 4.0, 3.0, '#cfc7b5');
    f.box(-1.9, 4.0, -3.3, 1.9, 4.4, 3.3, GRANITE);
    const hf = f.sub(0, 4.4, 0);
    const H = scaled(hf, 1.7);
    horse(H, BRONZE, BRONZE_D, 1);
    rider(H, BRONZE_D, '#3f382b');
  }
  // La Mariblanca on her column
  {
    let [x, z] = ctx.project(...LL.mariblanca);
    [x, z] = S.clear(x, z, 1.2);
    const y = ctx.groundY(x, z);
    const f = frame(ctx.boxes(x, z), x, y, z, 0);
    f.box(-0.9, 0, -0.9, 0.9, 0.8, 0.9, GRANITE);
    oct(f, 0, 0, 0.8, 4.0, 0.45, '#dcd5c6');
    f.box(-0.6, 4.0, -0.6, 0.6, 4.3, 0.6, GRANITE);
    figure(f.sub(0, 4.3, 0), 1.8, '#f2efe8', 1);
  }
  // rooftop neon facing the cars as they come into the Sol from San Jerónimo
  {
    const [x, z] = ctx.project(...LL.solSign);
    const i = S.sample(x, z);
    const t = ctx.track;
    // look back along the course: the sign faces the oncoming traffic
    const j = (i - Math.round(120 / t.ds) + t.N) % t.N;
    let nx = t.px[j] - x, nz = t.pz[j] - z;
    const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    const y = S.roofAt(x, z, ctx.groundY(x, z) + 22);
    const W = 17, H = 17;
    const c = makeCanvas(256, 256), g = c.getContext('2d');
    drawSolSign(g, 256, 256, 0);
    const grp = quadGroup(ctx, c, { alphaTest: 0.5 });
    grp.quad(x + nx * 0.4, y + 1.5, z + nz * 0.4, nx, nz, W, H);
    grp.flush();
    const f = frame(ctx.boxes(x, z), x, y, z, rotToward(nx, nz));
    for (let k = -3; k <= 3; k++) f.box(k * 2 - 0.08, 0, -0.5, k * 2 + 0.08, 1.5 + H * 0.92, 0.3, '#3b3f45');
    for (let yy = 1.5; yy < 1.5 + H; yy += 2.6) f.box(-W / 2, yy, -0.45, W / 2, yy + 0.1, 0.25, '#3b3f45');
    let acc = 0, fr = 0;
    ctx.animate((time, dt) => {
      acc += dt || 0;
      if (acc < 0.12) return;
      acc = 0; fr++;
      drawSolSign(g, 256, 256, fr);
      grp.tex.needsUpdate = true;
    });
  }
}

// ---------------------------------------------------------------------------
// 7. Calle Mayor: arch into the Plaza Mayor, the Plaza Mayor spires and Felipe III,
//    Mercado de San Miguel (iron and glass)
function buildPlazaMayor(ctx) {
  const hi = ctx.hi, t = ctx.track;
  // arch on the Calle Mayor facade
  {
    const [x, z] = ctx.project(...LL.arco);
    const i = S.sample(x, z);
    const side = (x - t.px[i]) * t.nx[i] + (z - t.pz[i]) * t.nz[i] > 0 ? 1 : -1;
    const h = S.facade(i, side, 25, 6);
    if (h) {
      const f = frame(ctx.boxes(h.x, h.z), h.x, h.y, h.z, rotToward(h.nx, h.nz));
      f.box(-3.4, 0, -0.1, -2.2, 7.6, 0.35, GRANITE);
      f.box(2.2, 0, -0.1, 3.4, 7.6, 0.35, GRANITE);
      for (let k = 0; k < 5; k++) {
        const w = 2.2 - k * 0.42;
        f.box(-w - 0.4, 5.2 + k * 0.5, -0.1, -w + 0.05, 5.75 + k * 0.5, 0.36, GRANITE);
        f.box(w - 0.05, 5.2 + k * 0.5, -0.1, w + 0.4, 5.75 + k * 0.5, 0.36, GRANITE);
      }
      f.box(-3.4, 7.6, -0.1, 3.4, 8.2, 0.4, '#a8a093');
      f.box(-2.2, 0, -0.12, 2.2, 5.2 + 2.2, 0.3, '#1d1916'); // the passage into the plaza
      f.box(-0.5, 8.2, 0.0, 0.5, 9.3, 0.25, '#d9a93a'); // crest
    }
  }
  // slate spires of the Casa de la Panadería and the Casa de la Carnicería
  for (const ll of SPIRES) {
    const [x, z] = ctx.project(...ll);
    const y = S.roofAt(x, z, ctx.groundY(x, z) + 20);
    const f = frame(ctx.boxes(x, z), x, y, z, 0);
    f.box(-3, 0, -3, 3, 3.2, 3, '#b5543c');
    f.box(-3.2, 3.2, -3.2, 3.2, 3.6, 3.2, '#ddd5c4');
    for (let k = 0; k < 6; k++) { const w = 3 * (1 - k / 6); f.box(-w, 3.6 + k * 1.3, -w, w, 4.9 + k * 1.3, w, SLATE); }
    f.box(-0.15, 11.4, -0.15, 0.15, 14.5, 0.15, '#25272b');
    oct(f, 0, 0, 13.0, 13.6, 0.35, GOLD);
  }
  // Felipe III in the middle of the plaza
  {
    const [x, z] = ctx.project(...LL.plazaMayor);
    if (S.room(x, z) > 5 && !S.buildingAt(x, z)) {
      const y = ctx.groundY(x, z);
      const f = frame(ctx.boxes(x, z), x, y, z, 0);
      f.box(-2, 0, -3.2, 2, 0.5, 3.2, GRANITE);
      f.box(-1.4, 0.5, -2.6, 1.4, 4.0, 2.6, '#cfc7b5');
      const H = scaled(f.sub(0, 4.0, 0), 1.6);
      horse(H, BRONZE, BRONZE_D, 0);
      rider(H, BRONZE_D, null);
    }
  }
  // Mercado de San Miguel: green iron columns, glass walls, ridged glass roof
  if (S.mercado) {
    const m = S.mercado, p = m.pts, n = p.length >> 1;
    let base = Infinity;
    for (let k = 0; k < n; k++) base = Math.min(base, ctx.groundY(p[k * 2], p[k * 2 + 1]));
    const IRON = '#2f4a3a', GLASS = '#a7bcc6', H = 10.5;
    for (let k = 0; k < n; k++) {
      const ax = p[k * 2], az = p[k * 2 + 1], bx = p[((k + 1) % n) * 2], bz = p[((k + 1) % n) * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1) continue;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const f = frame(ctx.boxes(mx, mz), mx, base, mz, rotToward(bx - ax, bz - az));
      f.box(-0.12, 0.4, -L / 2, 0.12, H - 1.2, L / 2, GLASS);
      f.box(-0.25, 0, -L / 2, 0.25, 0.6, L / 2, '#7c776d');
      f.box(-0.3, H - 1.2, -L / 2 - 0.1, 0.3, H, L / 2 + 0.1, IRON);
      f.box(-0.3, 3.6, -L / 2, 0.3, 3.9, L / 2, IRON);
      const nPost = Math.max(1, Math.round(L / 3.2));
      for (let j = 0; j <= nPost; j++) {
        const zz = -L / 2 + (j / nPost) * L;
        f.box(-0.25, 0, zz - 0.15, 0.25, H, zz + 0.15, IRON);
      }
    }
    // roof: glass lid with an iron ridge
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < n; k++) { x0 = Math.min(x0, p[k * 2]); x1 = Math.max(x1, p[k * 2]); z0 = Math.min(z0, p[k * 2 + 1]); z1 = Math.max(z1, p[k * 2 + 1]); }
    const roof = ctx.boxes(m.cx, m.cz);
    for (let x = x0 + 1.5; x < x1; x += 3) for (let z = z0 + 1.5; z < z1; z += 3) {
      if (!pipF(x, z, p)) continue;
      roof.box(-1.55, 0, -1.55, 1.55, 0.2, 1.55, (Math.floor(x / 3) + Math.floor(z / 3)) % 2 ? '#8fa7b3' : '#7f97a3', 0, x, base + H, z);
    }
    if (hi) roof.box(-(x1 - x0) / 2, 0, -0.3, (x1 - x0) / 2, 1.4, 0.3, IRON, 0, m.cx, base + H, m.cz);
  }
}

// ---------------------------------------------------------------------------
// 8. Bailén: Almudena dome, statues on the Palacio Real, Plaza de Oriente kings
//    and Felipe IV
function buildBailen(ctx) {
  const hi = ctx.hi, t = ctx.track;
  if (S.dome) {
    const d = S.dome;
    let base = Infinity;
    for (let k = 0; k < d.pts.length; k += 2) base = Math.min(base, ctx.groundY(d.pts[k], d.pts[k + 1]));
    const r = Math.min(12, Math.sqrt(d.area / Math.PI) * 1.05);
    const y0 = base + Math.max(20, d.minH);
    const f = frame(ctx.boxes(d.cx, d.cz), d.cx, y0, d.cz, 0);
    const ST = '#e6e2da', DOME = '#5d6d7e';
    oct(f, 0, 0, 0, 13, r, ST); // drum
    if (hi) for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; f.rbox(Math.cos(a) * (r * 0.924 + 0.04), Math.sin(a) * (r * 0.924 + 0.04), -a, -0.1, 4, -0.7, 0.1, 10.5, 0.7, '#3a4350'); }
    oct(f, 0, 0, 13, 14, r + 0.5, '#d7d2c8');
    dome(f, 0, 0, 14, r - 0.3, r * 1.05, hi ? 8 : 5, DOME, '#e9e6df');
    const top = 14 + r * 1.05;
    oct(f, 0, 0, top - 0.3, top + 4.2, 1.8, ST); // lantern
    oct(f, 0, 0, top + 4.2, top + 4.8, 2.1, '#d7d2c8');
    dome(f, 0, 0, top + 4.8, 1.9, 2.0, 3, DOME);
    f.box(-0.12, top + 6.6, -0.12, 0.12, top + 9.4, 0.12, GOLD); // cross
    f.box(-0.7, top + 8.3, -0.12, 0.7, top + 8.55, 0.12, GOLD);
  }
  // Palacio Real: white statues and urns along the roof balustrade facing Bailén
  {
    const i0 = Math.floor(0.76 * t.N), i1 = Math.floor(0.88 * t.N);
    const step = Math.round(6 / t.ds);
    let flagDone = false, k = 0;
    for (let i = i0; i < i1; i += step, k++) {
      for (const side of [1, -1]) {
        const h = S.facade(i, side, 110, 14);
        if (!h || !inLL(S.ll(h.x, h.z), PALACIO_BOX)) continue;
        const x = h.x - h.nx * 0.2, z = h.z - h.nz * 0.2;
        const f = frame(ctx.boxes(x, z), x, h.top, z, rotToward(h.nx, h.nz));
        f.box(-3, 0, -0.35, 3, 1.1, 0.0, '#eeebe4'); // balustrade
        f.box(-0.5, 0, -0.5, 0.5, 1.4, 0.5, '#f2efe8');
        if (k % 2) figure(f.sub(0, 1.4, 0), 2.4, '#f5f2ec', k % 4 === 1 ? 1 : 0);
        else { oct(f, 0, 0, 1.4, 2.2, 0.45, '#f2efe8'); oct(f, 0, 0, 2.2, 2.6, 0.25, '#f2efe8'); }
        if (!flagDone && i > (i0 + i1) / 2) {
          f.box(-0.1, 1.4, -6, 0.1, 10, -5.8, '#d8d8d8');
          flag(f, 0.1, -5.9, 9.8, 3.2, 2.1, SPAIN, Math.PI / 2);
          flagDone = true;
        }
      }
    }
  }
  // Plaza de Oriente: row of Gothic kings on pedestals along the gardens
  {
    const i0 = Math.floor(0.775 * t.N), i1 = Math.floor(0.865 * t.N);
    const step = Math.round(13 / t.ds);
    const parks = ctx.city.areas.filter((a) => a.kind === 0 || a.kind === 2);
    let k = 0;
    for (let i = i0; i < i1; i += step) {
      for (const side of [1, -1]) {
        const off = (side > 0 ? t.wallL[i] : t.wallR[i]) + 6;
        const x = t.px[i] + t.nx[i] * side * off, z = t.pz[i] + t.nz[i] * side * off;
        if (S.buildingAt(x, z) || inLL(S.ll(x, z), PALACIO_BOX) || !parks.some((a) => pipF(x, z, a.pts))) continue;
        const y = ctx.groundY(x, z);
        const f = frame(ctx.boxes(x, z), x, y, z, rotToward(-t.nx[i] * side, -t.nz[i] * side));
        f.box(-0.8, 0, -0.8, 0.8, 0.4, 0.8, GRANITE);
        f.box(-0.6, 0.4, -0.6, 0.6, 2.4, 0.6, '#d8d1c2');
        f.box(-0.75, 2.4, -0.75, 0.75, 2.65, 0.75, GRANITE);
        figure(f.sub(0, 2.65, 0), 2.3, '#ebe6db', k % 3 === 0 ? 1 : 0);
        f.box(-0.32, 2.65, -0.2, 0.32, 3.9, 0.22, '#e2dccf'); // robe
        f.box(-0.18, 4.95, -0.14, 0.18, 5.12, 0.14, '#d9a93a'); // crown
        k++;
      }
    }
  }
  // Felipe IV: the rearing horse on its tall pedestal between two fountains
  {
    const [x, z] = ctx.project(...LL.felipeIV);
    if (!S.buildingAt(x, z)) {
      const y = ctx.groundY(x, z);
      const f = frame(ctx.boxes(x, z), x, y, z, -Math.PI / 2);
      f.box(-3.2, 0, -4.4, 3.2, 0.6, 4.4, GRANITE);
      f.box(-2.2, 0.6, -3.4, 2.2, 6.4, 3.4, '#d4ccbb');
      f.box(-2.6, 6.4, -3.8, 2.6, 7.0, 3.8, GRANITE);
      if (hi) for (const s of [-1, 1]) lion(scaled(f.sub(s * 2.9, 0.6, 2.2), 0.8), '#5b4a32', '#4d3f2b', '#433626', '#1d1812');
      const H = scaled(f.sub(0, 7.0, 0), 2.0);
      horse(H, BRONZE, BRONZE_D, 2);
      rider(H, BRONZE_D, '#3f382b');
    }
  }
}

// ---------------------------------------------------------------------------
// 9. Plaza de España: the Cervantes monument with Don Quixote and Sancho Panza
function buildPlazaEspana(ctx) {
  const hi = ctx.hi;
  const [x, z] = ctx.project(...LL.cervantes);
  const [px, pz] = ctx.project(...LL.cervantesPond);
  const y = ctx.groundY(x, z);
  const f = frame(ctx.boxes(x, z), x, y, z, rotToward(px - x, pz - z)); // facing the pond
  const ST = '#cdc4b0', ST_L = '#ddd5c3';
  f.box(-7, 0, -5, 7, 1.0, 4, ST);
  f.box(-5.5, 1.0, -4, 5.5, 2.2, 1.5, ST_L);
  f.box(-3.6, 2.2, -3.4, 3.6, 12, 0.5, ST); // the tower
  f.box(-4.0, 12, -3.8, 4.0, 13, 0.9, ST_L);
  f.box(-2.6, 13, -2.8, 2.6, 18.5, -0.2, ST);
  f.box(-3.0, 18.5, -3.2, 3.0, 19.2, 0.2, ST_L);
  // figures holding the globe at the top
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    figure(f.sub(Math.cos(a) * 1.6, 19.2, -1.5 + Math.sin(a) * 1.6, -a), 2.2, ST_L, 1);
  }
  oct(f, 0, -1.5, 21.4, 23.6, 1.3, '#9aa0a3');
  oct(f, 0, -1.5, 21.8, 23.2, 1.6, '#8e9497');
  // Cervantes seated in stone before the tower
  seated(f.sub(0, 2.2, 1.0), 3.0, '#e4ddcc');
  f.box(-2.2, 2.2, 0.6, 2.2, 2.6, 2.2, ST_L);
  // in bronze at the front: Don Quixote on Rocinante (tall, thin, lance) and Sancho on his donkey
  const q = f.sub(-2.2, 1.0, 5.2);
  q.box(-1.5, -0.2, -2.0, 1.5, 0.6, 2.0, ST);
  const QH = scaled(q.sub(0, 0.6, 0), 1.25);
  horse(QH, BRONZE, BRONZE_D, 0);
  QH.box(-0.15, 1.6, -0.25, 0.15, 3.0, 0.05, BRONZE_D); // the knight: tall and thin
  QH.box(-0.11, 3.0, -0.18, 0.11, 3.3, 0.0, BRONZE_D);
  QH.box(0.2, 2.2, -0.1, 0.27, 2.3, 2.6, BRONZE_D); // lance
  const s = f.sub(2.4, 1.0, 5.0);
  s.box(-1.3, -0.2, -1.7, 1.3, 0.6, 1.7, ST);
  const SH = scaled(s.sub(0, 0.6, 0), 0.9);
  horse(SH, '#4a4234', BRONZE_D, 0);
  SH.box(-0.4, 1.6, -0.35, 0.4, 2.4, 0.2, BRONZE_D); // Sancho: short and round
  SH.box(-0.17, 2.4, -0.22, 0.17, 2.7, 0.08, BRONZE_D);
  if (hi) {
    // the pond's low stone rim
    oct(f, 0, 9.5, -0.2, 0.45, 8.5, '#bfb6a2');
    oct(f, 0, 9.5, -0.2, 0.5, 7.9, WATER);
  }
}

// ---------------------------------------------------------------------------
// 10. Azulejo street-name tiles on the corners along the course
const STREETS = [
  [0.0, 'GRAN VÍA', 0], [0.215, 'C. DE ALCALÁ', 1], [0.29, 'PASEO DEL PRADO', 2], [0.395, 'CRA. DE S. JERÓNIMO', 3],
  [0.49, 'PUERTA DEL SOL', 4], [0.55, 'CALLE MAYOR', 5], [0.735, 'CALLE DE BAILÉN', 6], [0.895, 'PLAZA DE ESPAÑA', 7], [0.945, 'GRAN VÍA', 0],
];
function drawAzulejos(g) {
  const pics = [
    (x, y) => { g.fillStyle = '#c47a2c'; g.fillRect(x + 18, y + 22, 92, 34); g.fillStyle = '#2d55a5'; g.fillRect(x + 50, y + 8, 28, 18); }, // Gran Vía dome
    (x, y) => { g.fillStyle = '#2d55a5'; for (let k = 0; k < 3; k++) g.fillRect(x + 22 + k * 30, y + 18, 18, 36); g.fillRect(x + 16, y + 12, 96, 8); }, // gate
    (x, y) => { g.fillStyle = '#3d7a3a'; for (let k = 0; k < 4; k++) g.fillRect(x + 14 + k * 26, y + 14, 20, 26); g.fillStyle = '#7a4a1c'; for (let k = 0; k < 4; k++) g.fillRect(x + 22 + k * 26, y + 40, 4, 14); }, // trees
    (x, y) => { g.fillStyle = '#c47a2c'; g.fillRect(x + 30, y + 30, 70, 24); g.fillStyle = '#2d55a5'; g.fillRect(x + 40, y + 14, 50, 16); }, // lions
    (x, y) => { g.fillStyle = '#d9a21b'; g.beginPath(); g.arc(x + 64, y + 40, 18, 0, Math.PI * 2); g.fill(); g.fillStyle = '#2d55a5'; g.fillRect(x + 20, y + 52, 88, 4); }, // sun
    (x, y) => { g.fillStyle = '#2d55a5'; g.fillRect(x + 16, y + 14, 96, 40); g.fillStyle = '#f5f1e6'; for (let k = 0; k < 5; k++) g.fillRect(x + 22 + k * 19, y + 28, 10, 26); }, // arcades
    (x, y) => { g.fillStyle = '#2d55a5'; g.fillRect(x + 14, y + 26, 100, 28); g.fillStyle = '#c47a2c'; g.fillRect(x + 54, y + 10, 20, 16); }, // palace
    (x, y) => { g.fillStyle = '#c47a2c'; g.fillRect(x + 56, y + 8, 16, 46); g.fillStyle = '#2d55a5'; g.fillRect(x + 24, y + 30, 22, 24); g.fillRect(x + 82, y + 30, 22, 24); }, // towers
  ];
  const names = ['GRAN VÍA', 'C. DE ALCALÁ', 'PASEO DEL PRADO', 'CRA. DE S. JERÓNIMO', 'PUERTA DEL SOL', 'CALLE MAYOR', 'CALLE DE BAILÉN', 'PLAZA DE ESPAÑA'];
  names.forEach((name, k) => {
    const x = (k % 4) * 128, y = Math.floor(k / 4) * 128;
    g.fillStyle = '#f5f1e6'; g.fillRect(x, y, 128, 128);
    g.fillStyle = '#2d55a5'; g.fillRect(x + 4, y + 4, 120, 4); g.fillRect(x + 4, y + 120, 120, 4); g.fillRect(x + 4, y + 4, 4, 120); g.fillRect(x + 120, y + 4, 4, 120);
    g.fillStyle = '#d9a21b'; g.fillRect(x + 10, y + 10, 108, 2); g.fillRect(x + 10, y + 116, 108, 2);
    pics[k](x, y + 6);
    g.fillStyle = 'rgba(45,85,165,0.25)'; g.fillRect(x + 32, y + 64, 64, 1);
    fitText(g, name, x + 64, y + 90, 104, 22, '#1d3f8a');
    // tile joints
    g.fillStyle = 'rgba(120,120,120,0.35)'; g.fillRect(x + 64, y, 1, 128); g.fillRect(x, y + 64, 128, 1);
  });
}
function buildAzulejos(ctx) {
  const t = ctx.track;
  const c = makeCanvas(512, 256), g = c.getContext('2d');
  drawAzulejos(g);
  const grp = quadGroup(ctx, c, { lit: true });
  const tileOf = (u) => { let k = 0; for (const s of STREETS) if (u >= s[0]) k = s[2]; return k; };
  const step = Math.round((ctx.hi ? 70 : 140) / t.ds);
  let n = 0;
  for (let i = 0; i < t.N; i += step) {
    const side = n % 2 ? 1 : -1;
    const h = S.facade(i, side, 22, 8);
    n++;
    if (!h) continue;
    const k = tileOf(i / t.N);
    const u0 = (k % 4) / 4, v1 = 1 - Math.floor(k / 4) / 2;
    grp.quad(h.x + h.nx * 0.42, h.y + 3.6, h.z + h.nz * 0.42, h.nx, h.nz, 1.1, 1.1, [u0, v1 - 0.5, u0 + 0.25, v1]);
  }
  grp.flush();
}

// ---------------------------------------------------------------------------
export const LANDMARKS = [
  ['metropolis', buildMetropolis], ['telefonica', buildTelefonica], ['granVia', buildGranVia], ['cibeles', buildCibeles],
  ['prado', buildPrado], ['neptuno', buildNeptuno], ['congreso', buildCongreso], ['sol', buildSol],
  ['plazaMayor', buildPlazaMayor], ['bailen', buildBailen], ['plazaEspana', buildPlazaEspana],
  ['azulejos', buildAzulejos],
];

export default {
  id: 'madrid',
  prepare(ctx) {
    S = null;
    const s = state(ctx);
    ctx.removeBuildings((b) => s.removed.has(b));
  },
  styleFor,
  buildingOpts,
  build(ctx) {
    state(ctx);
    lookups(ctx);
    for (const [, fn] of LANDMARKS) fn(ctx);
  },
};
