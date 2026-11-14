// Voxel-style city buildings from OSM footprints: extruded walls with a
// procedural window-facade atlas (one material for every building), a
// shopfront band on the ground floor, flat roofs and cornices.
//
// The atlas holds one 64x64 px tile per facade style (4 bays x 4 floors, or
// one storey of shopfronts). A shader patch picks the style row per vertex
// and wraps the tile with fract(), so a single draw call per chunk can mix
// styles. theme.night adds an emissive atlas of lit windows.
import * as THREE from 'three';
import { hash2 } from '../util.js';

// stucco/stuccoB: rendered plaster with French windows and wrought-iron balconies
// (tinted per building); mansard: slate roof band with dormers; tiles: terracotta roof.
export const STYLE = { glass: 0, limestone: 1, brick: 2, brownstone: 3, dark: 4, white: 5, shop: 6, roof: 7, stucco: 8, stuccoB: 9, mansard: 10, tiles: 11 };
const ROWS = 12, TILE = 64;
// metres per tile: [width (4 bays), height (4 floors)]
const TILE_M = [[12, 15.6], [12, 14.4], [11, 13.6], [11, 13.6], [12, 15.6], [12, 14.4], [16, 4.6], [8, 8], [12.4, 14.4], [13.2, 15.2], [14, 3.2], [6, 6]];

function px(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }

function drawTile(g, s, oy, night) {
  const R = (a, b, k) => hash2(a, b, s * 31 + k);
  const base = ['#7d93a8', '#d6ccb6', '#9c4f3c', '#74503f', '#353b42', '#e2ddd2', '#5c5650', '#8d8c88', '#f2ece2', '#f3ede3', '#59606a', '#b15d3b'][s];
  px(g, 0, oy, TILE, TILE, night ? '#000' : base);
  for (let fy = 0; fy < 4 && s < STYLE.shop; fy++) {
    for (let bx = 0; bx < 4; bx++) {
      const x0 = bx * 16, y0 = oy + fy * 16;
      const lit = R(bx, fy, 1) < 0.45;
      const win = night ? (lit ? (R(bx, fy, 2) < 0.3 ? '#cfe4ff' : '#ffd38a') : '#000') : null;
      if (s === STYLE.glass) {
        if (night) { px(g, x0 + 1, y0 + 4, 15, 11, lit ? win : '#000'); continue; }
        px(g, x0, y0, 16, 16, R(bx, fy, 3) < 0.5 ? '#6f879e' : '#7b93aa');
        px(g, x0, y0 + 4, 16, 5, '#93aac0');
        px(g, x0, y0, 1, 16, '#4b5a68');
        px(g, x0, y0 + 15, 16, 1, '#4b5a68');
        px(g, x0, y0 + 13, 16, 2, '#5a6b7b');
      } else if (s === STYLE.dark) {
        if (night) { px(g, x0 + 1, y0 + 2, 15, 12, lit ? win : '#000'); continue; }
        px(g, x0 + 1, y0 + 2, 15, 12, R(bx, fy, 3) < 0.5 ? '#45525f' : '#4d5a67');
        px(g, x0 + 1, y0 + 2, 15, 3, '#5d6c7a');
        px(g, x0, y0, 1, 16, '#9aa3ab');
      } else if (s === STYLE.white) {
        if (night) { px(g, x0, y0 + 5, 16, 7, lit ? win : '#000'); continue; }
        px(g, x0, y0 + 5, 16, 7, '#4a5663');
        px(g, x0, y0 + 5, 16, 2, '#647282');
        px(g, x0, y0 + 12, 16, 1, '#f3f0ea');
      } else {
        // punched windows in masonry (limestone, brick, brownstone)
        if (night) { px(g, x0 + 5, y0 + 3, 7, 10, lit ? win : '#000'); continue; }
        if (s !== STYLE.limestone) {
          for (let r = 0; r < 4; r++) px(g, x0, y0 + r * 4 + 3, 16, 1, s === STYLE.brick ? '#86412f' : '#5f4133');
        } else px(g, x0, y0 + 15, 16, 1, '#c5baa3');
        px(g, x0 + 4, y0 + 2, 9, 12, s === STYLE.limestone ? '#bfb39c' : '#e9e2d6');
        px(g, x0 + 5, y0 + 3, 7, 10, R(bx, fy, 3) < 0.5 ? '#36414d' : '#2e3843');
        px(g, x0 + 5, y0 + 3, 7, 3, '#4f5d6b');
        px(g, x0 + 5, y0 + 8, 7, 1, '#c9c1b2');
        px(g, x0 + 4, y0 + 14, 9, 1, '#efe9de');
      }
    }
  }
  if (s === STYLE.shop) {
    // one storey of shopfronts: display glass, door, sign band, awnings
    const awn = ['#b8312f', '#2f6d4e', '#24408e', '#d9a21b', '#3d3d3d', '#7b2d6b'];
    for (let bx = 0; bx < 4; bx++) {
      const x0 = bx * 16;
      const lit = night || R(bx, 9, 4) < 0.3;
      if (!night) px(g, x0, oy, 16, TILE, '#4d4945');
      px(g, x0 + 1, oy + 22, 14, 34, night ? (R(bx, 2, 5) < 0.75 ? '#ffe2a8' : '#000') : lit ? '#c9d6dd' : '#5b6d7a');
      if (!night) px(g, x0 + 1, oy + 22, 14, 6, '#8ba0ad');
      px(g, x0 + 10, oy + 30, 4, 26, night ? '#d8b878' : '#2a2a2a');
      const sign = R(bx, 3, 6);
      px(g, x0 + 1, oy + 8, 14, 9, night ? (sign < 0.6 ? awn[Math.floor(sign * 10) % awn.length] : '#000') : awn[Math.floor(sign * 10) % awn.length]);
      if (!night) {
        px(g, x0 + 3, oy + 11, 10, 3, '#f0ece2');
        if (R(bx, 4, 7) < 0.6) for (let k = 0; k < 4; k++) px(g, x0 + k * 4, oy + 17 + (k % 2), 4, 4, k % 2 ? '#f2efe6' : awn[(bx + 2) % awn.length]);
      }
      px(g, x0, oy, 1, TILE, night ? '#000' : '#2f2c29');
    }
    if (!night) px(g, 0, oy + 60, TILE, 4, '#6f6a64');
  }
  if (s === STYLE.roof && !night) {
    for (let k = 0; k < 90; k++) px(g, Math.floor(R(k, 1, 8) * TILE), oy + Math.floor(R(k, 2, 8) * TILE), 2, 2, R(k, 3, 8) < 0.5 ? '#7f7e7a' : '#9a9994');
  }
  if (s === STYLE.stucco || s === STYLE.stuccoB) {
    // fy = 3 is the bottom floor of the tile: the first floor above the shops (planta noble)
    const B = s === STYLE.stuccoB;
    for (let fy = 0; fy < 4; fy++) for (let bx = 0; bx < 4; bx++) {
      const x0 = bx * 16, y0 = oy + fy * 16;
      const lit = R(bx, fy, 1) < 0.5;
      const glass = night ? (lit ? (R(bx, fy, 2) < 0.25 ? '#ffe9c4' : '#ffc977') : '#000') : R(bx, fy, 3) < 0.5 ? '#323840' : '#2b3138';
      if (!night) {
        px(g, x0, y0 + 15, 16, 1, '#e3dccf'); // impost band
        if (B) px(g, x0, y0, 2, 16, '#e6dfd2'); // pilasters
        px(g, x0 + 4, y0 + (B ? 0 : 1), 8, B ? 13 : 12, '#fbf8f3'); // stone surround
        if (B) px(g, x0 + 3, y0, 10, 2, '#fdfbf7'); // cornice over the window
      }
      px(g, x0 + 5, y0 + 3, 6, 10, glass);
      if (!night) {
        px(g, x0 + 5, y0 + 3, 6, 2, '#58626d');
        const blind = R(bx, fy, 4);
        if (blind < 0.55) px(g, x0 + 5, y0 + 3, 6, 2 + Math.floor(blind * 9), blind < 0.25 ? '#5d6e50' : '#8a7356'); // persianas
        px(g, x0 + 7, y0 + 3, 1, 10, '#e9e3d8'); // door mullion
      }
      // wrought-iron balcony: stone slab + railing (continuous on the planta noble)
      const wide = fy === 3 && (B || R(bx, 7, 5) < 0.4);
      const a = wide ? x0 : x0 + 3, w = wide ? 16 : 10;
      if (!night) px(g, a, y0 + 13, w, 1, '#cfc8bb');
      if (fy === 0 && !B && !wide && R(bx, 0, 6) < 0.5) continue; // top floor: plain windows
      px(g, a, y0 + 9, w, 1, '#222426');
      for (let k = a; k < a + w; k += 2) px(g, k, y0 + 9, 1, 4, '#26282b');
    }
  }
  if (s === STYLE.mansard) {
    // slate band with a dormer every other bay (one tile = one storey of roof)
    if (!night) for (let y = 3; y < TILE; y += 5) px(g, 0, oy + y, TILE, 1, '#4c535c');
    for (let bx = 0; bx < 4; bx += 2) {
      const x0 = bx * 16 + 8;
      if (!night) {
        px(g, x0 + 2, oy + 9, 12, 5, '#3f454d');
        px(g, x0 + 3, oy + 14, 10, 40, '#ebe6dc');
      }
      px(g, x0 + 5, oy + 17, 6, 34, night ? (R(bx, 1, 9) < 0.5 ? '#ffd38a' : '#000') : '#2c323a');
    }
  }
  if (s === STYLE.tiles && !night) {
    // terracotta courses with staggered tile highlights
    for (let r = 0; r < 16; r++) {
      px(g, 0, oy + r * 4 + 3, TILE, 1, '#8c452e');
      for (let x = (r % 2) * 2; x < TILE; x += 4) px(g, x, oy + r * 4, 1, 3, R(x, r, 10) < 0.5 ? '#c4704a' : '#a4532f');
    }
  }
}

function makeAtlas(night) {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE * ROWS;
  const g = c.getContext('2d');
  // style s lives in canvas row (ROWS-1-s) so that uv.y in [s/ROWS, (s+1)/ROWS] (flipY)
  for (let s = 0; s < ROWS; s++) drawTile(g, s, (ROWS - 1 - s) * TILE, night);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 8;
  return t;
}

// Lambert material that samples the atlas row given by the aStyle attribute.
export function makeFacadeMaterial(theme, keep) {
  const map = keep(makeAtlas(false));
  const opts = { vertexColors: true, map };
  if (theme.night) { opts.emissiveMap = keep(makeAtlas(true)); opts.emissive = new THREE.Color('#ffffff'); }
  const mat = new THREE.MeshLambertMaterial(opts);
  const sample = (tex) => `textureGrad(${tex}, vec2(fract(vMapUv.x), (vStyle + fract(vMapUv.y)) / ${ROWS}.0), dFdx(vMapUv) * vec2(1.0, ${1 / ROWS}), dFdy(vMapUv) * vec2(1.0, ${1 / ROWS}))`;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aStyle;\nvarying float vStyle;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvStyle = aStyle;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vStyle;')
      .replace('#include <map_fragment>', `#ifdef USE_MAP\n  diffuseColor *= ${sample('map')};\n#endif`)
      .replace('#include <emissivemap_fragment>', `#ifdef USE_EMISSIVEMAP\n  totalEmissiveRadiance *= ${sample('emissiveMap')}.rgb;\n#endif`);
  };
  mat.customProgramCacheKey = () => 'facade-atlas';
  return mat;
}

// Geometry accumulator with the facade attributes.
export class FacadeBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = []; this.sty = []; this.idx = []; }
  get count() { return this.idx.length / 3; }
  // quad p0..p3 (world xyz), uv corners, style, colour; winding fixed to face `n`
  quad(p, uv, n, style, c) {
    const vi = this.pos.length / 3;
    for (let k = 0; k < 4; k++) {
      this.pos.push(p[k][0], p[k][1], p[k][2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(c.r, c.g, c.b);
      this.uv.push(uv[k][0], uv[k][1]);
      this.sty.push(style);
    }
    const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2];
    const bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) this.idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    else this.idx.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
  }
  tri(p, uv, n, style, c) {
    const vi = this.pos.length / 3;
    for (let k = 0; k < 3; k++) {
      this.pos.push(p[k][0], p[k][1], p[k][2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(c.r, c.g, c.b);
      this.uv.push(uv[k][0], uv[k][1]);
      this.sty.push(style);
    }
    this.idx.push(vi, vi + 1, vi + 2);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aStyle', new THREE.Float32BufferAttribute(this.sty, 1));
    if (this.pos.length / 3 > 65535) g.setIndex(new THREE.Uint32BufferAttribute(this.idx, 1));
    else g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const TINTS = {
  [STYLE.glass]: ['#ffffff', '#e8f0f8', '#dfe6ee', '#f0f4f0'],
  [STYLE.limestone]: ['#ffffff', '#f4ece0', '#ece6dc', '#fff6e8'],
  [STYLE.brick]: ['#ffffff', '#f0dcd0', '#e8d2c4', '#ffe9dc'],
  [STYLE.brownstone]: ['#ffffff', '#e9dccf', '#f2e4d6'],
  [STYLE.dark]: ['#ffffff', '#e2e6ea', '#d8dde3'],
  [STYLE.white]: ['#ffffff', '#f6f2ea', '#eef0f2'],
  // Madrid plaster: cream, ochre, almagre terracotta, peach, white, salmon
  [STYLE.stucco]: ['#f7e8c9', '#f0d39c', '#e8bb80', '#dc946a', '#f4ddc2', '#fbf6ec', '#ecc4a2', '#d9a671', '#efe0c4'],
  [STYLE.stuccoB]: ['#f3d9a4', '#ecc98d', '#f7ecd6', '#e2ad7a', '#f1e3c9'],
};
const MAT_STYLE = { 1: STYLE.glass, 2: STYLE.brick, 3: STYLE.limestone, 4: STYLE.white, 5: STYLE.dark, 6: STYLE.white, 7: STYLE.brownstone };

export function styleFor(b, seed) {
  if (b.church) return STYLE.limestone;
  if (MAT_STYLE[b.mat] != null) return MAT_STYLE[b.mat];
  const r = hash2(seed, 7, 3);
  if (b.h > 120) return r < 0.62 ? STYLE.glass : r < 0.85 ? STYLE.dark : STYLE.white;
  if (b.h > 45) return r < 0.3 ? STYLE.glass : r < 0.6 ? STYLE.limestone : r < 0.75 ? STYLE.white : r < 0.88 ? STYLE.brick : STYLE.dark;
  return r < 0.35 ? STYLE.brick : r < 0.6 ? STYLE.limestone : r < 0.8 ? STYLE.brownstone : r < 0.9 ? STYLE.white : STYLE.glass;
}

const _c = new THREE.Color(), _t = new THREE.Color();

// Adds one building to FacadeBuilder fb. base: ground height under it.
// opts: { shop: bool (ground-floor shopfronts), cornice: bool | (ax, az, bx, bz, nrm) => bool (per edge),
//         seed, tint (overrides the style's tints),
//         roof: 'mansard' (slate band with dormers inside the top 3 m) | 'tiles' (terracotta) | flat }
export function addBuilding(fb, b, base, opts) {
  const pts = b.pts, n = pts.length / 2;
  const style = opts.style;
  const tints = TINTS[style] || TINTS[STYLE.limestone];
  _c.set(opts.tint || tints[Math.floor(hash2(opts.seed, 3, 9) * tints.length)]);
  if (b.colour) { _t.copy(b.colour); _c.lerp(_t.lerp(new THREE.Color(1, 1, 1), 0.35), 0.5); }
  const roofC = _t.set('#ffffff').multiplyScalar(0.92 + 0.08 * hash2(opts.seed, 5, 9)).clone();
  const y0 = base + b.minH - (b.minH > 0 ? 0 : 1.5), y1 = base + b.h;
  const shopTop = opts.shop ? base + 4.6 : -1e9;
  const [tw, th] = TILE_M[style];
  const u0 = Math.floor(hash2(opts.seed, 11, 9) * 4) / 4; // window phase per building
  // orientation: signed area > 0 means vertices run so that (dz, -dx) points outward
  let A = 0;
  for (let k = 0; k < n; k++) A += pts[k * 2] * pts[((k + 1) % n) * 2 + 1] - pts[((k + 1) % n) * 2] * pts[k * 2 + 1];
  const sgn = A > 0 ? 1 : -1;
  // mansard: the walls stop short of the top and a slate band leans in to an inset roof
  let mh = 0, ins = 0, inset = null;
  if (opts.roof === 'mansard' && y1 - Math.max(y0, shopTop) > 9 && Math.abs(A) > 160) {
    mh = Math.min(3.2, (y1 - y0) * 0.22); ins = mh * 0.55;
    const en = [];
    for (let k = 0; k < n; k++) {
      const dx = pts[((k + 1) % n) * 2] - pts[k * 2], dz = pts[((k + 1) % n) * 2 + 1] - pts[k * 2 + 1], L = Math.hypot(dx, dz);
      en.push(L < 1e-3 ? null : [(dz / L) * sgn, (-dx / L) * sgn]);
    }
    inset = new Float32Array(n * 2);
    let Ai = 0;
    for (let k = 0; k < n; k++) {
      const e0 = en[(k - 1 + n) % n] || en[k] || [0, 0], e1 = en[k] || e0;
      const sx = e0[0] + e1[0], sz = e0[1] + e1[1], s2 = Math.max(sx * sx + sz * sz, 0.5);
      inset[k * 2] = pts[k * 2] - (sx * 2 * ins) / s2;
      inset[k * 2 + 1] = pts[k * 2 + 1] - (sz * 2 * ins) / s2;
    }
    for (let k = 0; k < n; k++) Ai += inset[k * 2] * inset[((k + 1) % n) * 2 + 1] - inset[((k + 1) % n) * 2] * inset[k * 2 + 1];
    if (Ai * A <= 0 || Math.abs(Ai) < Math.abs(A) * 0.35) { mh = 0; inset = null; } // too small / narrow: flat roof
  }
  const yw = y1 - mh; // top of the walls
  const lip = opts.cornice ? 0.15 : 0;
  for (let k = 0; k < n; k++) {
    const ax = pts[k * 2], az = pts[k * 2 + 1], bx = pts[((k + 1) % n) * 2], bz = pts[((k + 1) % n) * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.3) continue;
    const nrm = [((bz - az) / len) * sgn, 0, (-(bx - ax) / len) * sgn];
    // whole bays per edge so windows never get cut at corners
    const bays = Math.max(1, Math.round(len / (tw / 4))) / 4;
    const ua = u0, ub = u0 + bays;
    if (opts.shop && yw > shopTop + 2) {
      const sb = Math.max(1, Math.round(len / (TILE_M[STYLE.shop][0] / 4))) / 4;
      fb.quad([[ax, y0, az], [bx, y0, bz], [bx, shopTop, bz], [ax, shopTop, az]], [[0, -0.33], [sb, -0.33], [sb, 1], [0, 1]], nrm, STYLE.shop, _c);
      fb.quad([[ax, shopTop, az], [bx, shopTop, bz], [bx, yw, bz], [ax, yw, az]], [[ua, 0], [ub, 0], [ub, (yw - shopTop) / th], [ua, (yw - shopTop) / th]], nrm, style, _c);
    } else {
      const vb = (y0 - base - b.minH) / th;
      fb.quad([[ax, y0, az], [bx, y0, bz], [bx, yw, bz], [ax, yw, az]], [[ua, vb], [ub, vb], [ub, (yw - base - b.minH) / th], [ua, (yw - base - b.minH) / th]], nrm, style, _c);
    }
    if (opts.cornice && (typeof opts.cornice !== 'function' || opts.cornice(ax, az, bx, bz, nrm))) {
      // projecting cornice: top, front and underside of a 0.45 m lip
      const o = 0.45, cy0 = yw - 0.7, cy1 = yw + lip;
      const ox = nrm[0] * o, oz = nrm[2] * o;
      const cc = _t.copy(_c).multiplyScalar(0.94);
      fb.quad([[ax + ox, cy0, az + oz], [bx + ox, cy0, bz + oz], [bx + ox, cy1, bz + oz], [ax + ox, cy1, az + oz]], [[0, 0.1], [0.1, 0.1], [0.1, 0.15], [0, 0.15]], nrm, STYLE.roof, cc);
      fb.quad([[ax, cy1, az], [bx, cy1, bz], [bx + ox, cy1, bz + oz], [ax + ox, cy1, az + oz]], [[0, 0.1], [0.1, 0.1], [0.1, 0.15], [0, 0.15]], [0, 1, 0], STYLE.roof, cc);
      fb.quad([[ax, cy0, az], [bx, cy0, bz], [bx + ox, cy0, bz + oz], [ax + ox, cy0, az + oz]], [[0, 0.1], [0.1, 0.1], [0.1, 0.15], [0, 0.15]], [0, -1, 0], STYLE.roof, cc.multiplyScalar(0.7));
    }
    if (inset) {
      // slate band leaning in from the wall top to the inset roof edge
      const q = (k + 1) % n, Ls = Math.hypot(mh, ins);
      const sn = [(nrm[0] * mh) / Ls, ins / Ls, (nrm[2] * mh) / Ls];
      const mb = Math.max(1, Math.round(len / (TILE_M[STYLE.mansard][0] / 4))) / 4;
      fb.quad([[ax, yw + lip, az], [bx, yw + lip, bz], [inset[q * 2], y1 + lip, inset[q * 2 + 1]], [inset[k * 2], y1 + lip, inset[k * 2 + 1]]],
        [[0, 0], [mb, 0], [mb, 1], [0, 1]], sn, STYLE.mansard, roofC);
    }
  }
  // roof: flat (gravel / zinc on mansards) or terracotta tiles
  const rp = inset || pts;
  const contour = [];
  for (let k = 0; k < n; k++) contour.push(new THREE.Vector2(pts[k * 2], pts[k * 2 + 1]));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const tiles = opts.roof === 'tiles';
  const rs = tiles ? STYLE.tiles : STYLE.roof, us = tiles ? 6 : 8;
  const rc = inset ? _t.copy(roofC).multiplyScalar(0.78) : roofC;
  for (const [a, bb, c] of tris) {
    const P = [a, bb, c].map((k) => [rp[k * 2], y1 + lip, rp[k * 2 + 1]]);
    const U = [a, bb, c].map((k) => [rp[k * 2] / us, rp[k * 2 + 1] / us]);
    // keep the triangle facing up
    const cr = (P[1][0] - P[0][0]) * (P[2][2] - P[0][2]) - (P[1][2] - P[0][2]) * (P[2][0] - P[0][0]);
    if (cr < 0) fb.tri(P, U, [0, 1, 0], rs, rc);
    else fb.tri([P[0], P[2], P[1]], [U[0], U[2], U[1]], [0, 1, 0], rs, rc);
  }
  return { top: y1 };
}
