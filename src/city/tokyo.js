// Tokyo (Aoyama / Akasaka, "Route 246") city module: night dressing for the
// street course (see cityScene.js for the generic city: buildings with lit
// windows, streets, barriers, lamps, signals, parked cars, the Shuto viaduct).
//
// Adds vertical neon signs and rooftop boards on the facades along the course,
// konbini storefronts, vending machines, green pedestrian footbridges, road
// closure barricades, Toyokawa Inari lanterns, the lit wall of the Akasaka
// Estate, the floodlit Akasaka Palace (Geihinkan) and Tokyo Tower on the skyline.
// All brands and footbridge names are fictional. Sizes are real metres.
import * as THREE from 'three';
import { BoxBuilder } from '../voxel.js';
import { STYLE } from './buildings.js';
import { hash2 } from '../util.js';
import { escapeAt } from '../trackCore.js';

const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",sans-serif';

const LL = {
  aoyama: [35.6748, 139.7315], // Aoyama-dori by Takahashi Korekiyo park
  mitsuke: [35.67782, 139.73591], // Akasaka-mitsuke
  yotsuya: [35.68581, 139.72953], // Yotsuya (moat road meets Shinjuku-dori)
  yotsuya3: [35.6885, 139.7211], // Yotsuya 3-chome
  shinano: [35.6802, 139.7204], // Shinanomachi
  aoyama1: [35.6725, 139.724], // Aoyama-itchome
  toyokawa: [35.67653, 139.73281], // Toyokawa Inari Tokyo Betsuin (OSM shrine outline)
  hodokyo: [35.67951, 139.7197], // Shinanomachi-ekimae footbridge (OSM)
  palace: [35.680311, 139.72877], // Akasaka Palace main building, footprint centre (OSM relation)
  tower: [35.65858, 139.74543], // Tokyo Tower
  otani: [35.68093, 139.73402], // Hotel New Otani main building
};
// Akasaka Palace grid: local +x runs east (tilted ~6° to the south), local -z faces the forecourt (north)
const PAL_ROT = -0.105;
const PAL_HX = 62, PAL_HZ = 46;

// ---------------------------------------------------------------------------
// helpers
function frame(b, x, y, z, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return {
    b, x, y, z, rot,
    box(x0, y0, z0, x1, y1, z1, col, opts) {
      b.box(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), col, rot, x, y, z, opts);
    },
    wx: (u, e) => u * c + e * s + x,
    wz: (u, e) => -u * s + e * c + z,
  };
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
const faceRot = (dx, dz) => Math.atan2(-dz, dx); // rot whose local +x points along (dx, dz)

function figure(f, u, e, y, h, col) {
  const k = h / 1.8;
  f.box(u - 0.2 * k, y, e - 0.12 * k, u + 0.2 * k, y + 0.85 * k, e + 0.12 * k, col);
  f.box(u - 0.26 * k, y + 0.85 * k, e - 0.15 * k, u + 0.26 * k, y + 1.5 * k, e + 0.15 * k, col);
  f.box(u - 0.11 * k, y + 1.5 * k, e - 0.11 * k, u + 0.11 * k, y + 1.82 * k, e + 0.11 * k, col);
  f.box(u + 0.26 * k, y + 1.3 * k, e - 0.07 * k, u + 0.36 * k, y + 2.3 * k, e + 0.07 * k, col); // raised spear arm
}

// Shared lookups for one build: course sidewalks, building / street hit tests,
// facade marching and a sidewalk occupancy list so items do not overlap.
function setup(ctx) {
  const track = ctx.track, N = track.N, ds = track.ds || 2, hi = ctx.hi;
  const { px, pz, nx, nz } = track;
  const wrap = (i) => ((i % N) + N) % N;
  const fwd = (a, b) => wrap(b - a);
  const inRange = (i, a, b) => fwd(a, i) <= fwd(a, b);
  const idx = (ll) => ctx.courseAt(...ctx.project(ll[0], ll[1])).i;
  const wall = (i, s) => (s > 0 ? track.wallL[i] : track.wallR[i]);
  const inner = (i, s) => wall(i, s) + 0.6; // sidewalk behind the barrier
  const outer = (i, s) => Math.max(inner(i, s) + 2.2, track.hw[i] + 4.5);
  const at = (i, s, o) => [px[i] + nx[i] * s * o, pz[i] + nz[i] * s * o];
  const tan = (i) => [track.tx[i], track.tz[i]];

  // buildings that cityScene will actually draw
  const C = 40, grid = new Map(), key = (a, b) => a * 100003 + b;
  const kept = [];
  for (const b of ctx.city.buildings) {
    if (b.removed || b.far) continue;
    if (!hi && b.h < 40 && ctx.courseAt(b.cx, b.cz).dist > 70) continue; // low quality drops the back rows
    kept.push(b);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < b.pts.length; k += 2) { x0 = Math.min(x0, b.pts[k]); x1 = Math.max(x1, b.pts[k]); z0 = Math.min(z0, b.pts[k + 1]); z1 = Math.max(z1, b.pts[k + 1]); }
    for (let a = Math.floor(x0 / C); a <= Math.floor(x1 / C); a++) for (let c = Math.floor(z0 / C); c <= Math.floor(z1 / C); c++) {
      const kk = key(a, c);
      if (!grid.has(kk)) grid.set(kk, []);
      grid.get(kk).push(b);
    }
  }
  // building containing (x, z); ground = only footprints that reach the ground
  const buildingAt = (x, z, minH = 0, ground = false) => {
    const l = grid.get(key(Math.floor(x / C), Math.floor(z / C)));
    if (l) for (const b of l) if (b.h >= minH && (!ground || b.minH <= 1) && pipF(x, z, b.pts)) return b;
    return null;
  };

  // side streets (ground level) and Shuto viaducts
  const SC = 30;
  const mkGrid = () => ({ cells: new Map(), segs: [] });
  const streets = mkGrid(), viaducts = mkGrid();
  for (const s of ctx.city.streets) {
    if (s.course || s.kind === 2) continue;
    const G = s.kind === 3 ? viaducts : streets, p = s.pts;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5) continue;
      const si = G.segs.length;
      G.segs.push({ ax, az, ux: (bx - ax) / L, uz: (bz - az) / L, L, h: s.w / 2 });
      for (let t = 0; t <= L + SC / 2; t += SC / 2) {
        const q = Math.min(t, L), kk = key(Math.floor((ax + G.segs[si].ux * q) / SC), Math.floor((az + G.segs[si].uz * q) / SC));
        if (!G.cells.has(kk)) G.cells.set(kk, new Set());
        G.cells.get(kk).add(si);
      }
    }
  }
  // inside a street (+pad); t = optional course tangent: ignore streets running parallel to it
  const segHit = (G, x, z, pad, t) => {
    const c0 = Math.floor(x / SC), d0 = Math.floor(z / SC);
    for (let a = c0 - 1; a <= c0 + 1; a++) for (let b = d0 - 1; b <= d0 + 1; b++) {
      const cell = G.cells.get(key(a, b));
      if (cell) for (const si of cell) {
        const s = G.segs[si];
        if (t && Math.abs(s.ux * t[0] + s.uz * t[1]) > 0.8) continue;
        const rx = x - s.ax, rz = z - s.az, al = rx * s.ux + rz * s.uz, lat = rz * s.ux - rx * s.uz;
        if (al >= -s.h && al <= s.L + s.h && Math.abs(lat) <= s.h + pad) return true;
      }
    }
    return false;
  };
  const inStreet = (x, z, pad = 0, t = null) => segHit(streets, x, z, pad, t);
  const nearViaduct = (x, z, pad = 0) => segHit(viaducts, x, z, pad, null);
  const nearInter = (x, z, r) => ctx.city.intersections.some((it) => (it.x - x) ** 2 + (it.z - z) ** 2 < r * r);
  const escape = (x, z, m = 1) => !!escapeAt(track, x, z, m);

  // march sideways from sample i until hitting a building facade
  const march = (i, s, minH = 0, maxO = 40) => {
    const o0 = inner(i, s) + 0.4;
    for (let o = o0; o < maxO; o += 1) {
      const [x, z] = at(i, s, o);
      const b = buildingAt(x, z, minH, true);
      if (!b) continue;
      if (o === o0) return null; // OSM footprint overhangs the barrier: no usable facade here
      let lo = o - 1, h2 = o;
      for (let k = 0; k < 5; k++) {
        const m = (lo + h2) / 2, [mx, mz] = at(i, s, m);
        if (buildingAt(mx, mz, minH, true) === b) h2 = m; else lo = m;
      }
      return { o: (lo + h2) / 2, b };
    }
    return null;
  };
  // facade at sample i with its outward (street-facing) normal
  const facade = (i, s, minH = 0, maxO = 40) => {
    const h = march(i, s, minH, maxO);
    if (!h) return null;
    const ia = wrap(i - 1), ic = wrap(i + 1);
    const a = march(ia, s, minH, maxO), c = march(ic, s, minH, maxO);
    let n = [-nx[i] * s, -nz[i] * s], straight = false;
    if (a && c && a.b === h.b && c.b === h.b && Math.abs(a.o - c.o) < 2.5) {
      const A = at(ia, s, a.o), B = at(ic, s, c.o), L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (L > 0.5) {
        let m = [-(B[1] - A[1]) / L, (B[0] - A[0]) / L];
        if (m[0] * n[0] + m[1] * n[1] < 0) m = [-m[0], -m[1]];
        n = m;
        straight = true;
      }
    }
    return { o: h.o, b: h.b, F: at(i, s, h.o), n, straight };
  };

  // sidewalk occupancy: [side, from, to] sample ranges
  const occ = [];
  const free = (s, a, b) => {
    a = wrap(a); b = wrap(b);
    for (const [s2, c, d] of occ) if (s2 === s && (inRange(a, c, d) || inRange(c, a, b))) return false;
    return true;
  };
  const claim = (s, a, b) => occ.push([s, wrap(a), wrap(b)]);

  return {
    track, N, ds, hi, wrap, fwd, inRange, idx, wall, inner, outer, at, tan, kept,
    buildingAt, inStreet, nearViaduct, nearInter, escape, march, facade, free, claim,
    walkY: (i) => track.py[i] + 0.15,
  };
}

// ---------------------------------------------------------------------------
// sign textures: two static atlases + three animated canvases, one mesh each
const VSIGNS = [
  ['カラオケ館キューブ', '#ffe600', '#d1001c', '#d1001c'], ['居酒屋四角', '#1a0f0a', '#ffcf6b', '#c23a1e'],
  ['ラーメン立方', '#d6261c', '#ffffff', '#ffffff'], ['焼肉ボクセル', '#0d0d0d', '#ff5a2a', '#ff5a2a'],
  ['ピクセル歯科', '#ffffff', '#1b5fd1', '#1b5fd1'], ['麻雀ブロック', '#0b6b3a', '#ffffff', '#ffe14a'],
  ['英会話ドット', '#ff7a00', '#ffffff', '#ffffff'], ['漫画喫茶角', '#1c2a8c', '#ffffff', '#7fd2ff'],
  ['ホテル方形', '#2a0838', '#ff7bf0', '#ff7bf0'], ['寿司ドット', '#f6efe0', '#151515', '#a3121c'],
  ['くすりキューブ堂', '#ffd400', '#0a2a8a', '#0a2a8a'], ['質立方屋', '#ffffff', '#c8102e', '#c8102e'],
  ['スナック積木', '#3a0a24', '#ffd0f0', '#ff6fb5'], ['珈琲ボックス', '#3b2414', '#f5deb3', '#f5deb3'],
  ['整体直角院', '#e8f6ff', '#0b6b3a', '#0b6b3a'], ['ゲームセンター角', '#000000', '#40f0ff', '#40f0ff'],
];
const HSIGNS = [
  ['ボクセル生命', 'VOXEL LIFE', '#0a1f5c', '#ffffff', '#4fa3ff'], ['キューブ電機', 'QUBE DENKI', '#d1001c', '#ffffff', '#ffffff'],
  ['ピクセル銀行', 'PIXEL BANK', '#00694a', '#ffffff', '#9df0c8'], ['立方ビール', 'RIPPO BEER', '#f2b800', '#2a1400', '#2a1400'],
  ['ブロック証券', 'BLOCK SECURITIES', '#111111', '#ff9a1a', '#ff9a1a'], ['ドット航空', 'DOT AIRWAYS', '#ffffff', '#1b4dd6', '#1b4dd6'],
  ['QUBE MART', 'キューブマート', '#ffffff', '#11924a', '#ff8a00'], ['ブロックマート', 'BLOCK MART', '#ffffff', '#1f5fd6', '#2fb2ff'],
  ['DOT 24', 'ドットストア', '#ffffff', '#e0262e', '#e0262e'], ['ぼくせる坂歩道橋', 'BOKUSERU-ZAKA FOOTBRIDGE', '#1d4f9c', '#ffffff', '#ffffff'],
  ['きゅーぶ通り歩道橋', 'KYUBU-DORI FOOTBRIDGE', '#1d4f9c', '#ffffff', '#ffffff'], null, // 11: direction sign
  ['HOTEL NEW VOXANI', 'ホテルニューボクサニ', '#070a18', '#ff3b30', '#070a18'], ['カラオケ ボクセル', 'KARAOKE VOXEL', '#ff2f8a', '#ffffff', '#ffe14a'],
  ['パチンコ 立方', 'PACHINKO RIPPO', '#ffe600', '#d1001c', '#d1001c'], ['ピクセル製薬', 'PIXEL PHARMA', '#4a1a7c', '#ffffff', '#c9a6ff'],
];
const ROOF_TILES = [0, 1, 2, 3, 4, 5, 13, 14, 15];
const KONBINI = [
  { tile: 6, band: '#f7fbff', s1: '#11924a', s2: '#ff8a00' },
  { tile: 7, band: '#f4f8ff', s1: '#1f5fd6', s2: '#2fb2ff' },
  { tile: 8, band: '#fffaf6', s1: '#e0262e', s2: '#ff9a9a' },
];
const NEONS = ['#ff3fb4', '#3ff2ff', '#ffe23f', '#7dff5a', '#ff7a1a', '#b46bff'];
const LED_TEXT = [...'営業中★ボクセルGP★東京R246★夜間レース開催★'];
const TICKER = '  ★ VOXEL GT 東京R246 ナイトレース開催中 ★ 青山 → 赤坂見附 → 四谷 → 信濃町 ★ ボクセル生命 ★ QUBE MART 24H ★ キューブ電機 ★ 本日のベストラップ 2:41.806 ★  ';

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
  g.font = `bold ${s}px ${FONT}`;
  const m = g.measureText ? g.measureText(text) : null;
  const w = m && m.width ? m.width : 0;
  if (w > maxW) { s = Math.max(8, Math.floor((s * maxW) / w)); g.font = `bold ${s}px ${FONT}`; }
  g.fillText(text, x, y);
}
function border(g, x, y, w, h, t, col) {
  g.fillStyle = col;
  g.fillRect(x, y, w, t); g.fillRect(x, y + h - t, w, t); g.fillRect(x, y, t, h); g.fillRect(x + w - t, y, t, h);
}
// vertical (tategaki) sign: characters stacked top to bottom; cols = per-char colours (flicker)
function drawV(g, x, y, w, h, text, bg, fg, edge, cols = null) {
  g.fillStyle = bg; g.fillRect(x, y, w, h);
  border(g, x + 2, y + 2, w - 4, h - 4, 3, edge);
  const ch = [...text], n = ch.length, cell = (h - 18) / n;
  const size = Math.floor(Math.min(w * 0.72, cell * 0.92));
  g.font = `bold ${size}px ${FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let k = 0; k < n; k++) {
    g.fillStyle = cols ? cols[k] : fg;
    g.fillText(ch[k] === 'ー' ? '｜' : ch[k], x + w / 2, y + 9 + (k + 0.5) * cell);
  }
}
function drawH(g, x, y, w, h, spec) {
  const [jp, en, bg, fg, edge] = spec;
  g.fillStyle = bg; g.fillRect(x, y, w, h);
  border(g, x + 2, y + 2, w - 4, h - 4, 3, edge);
  fitText(g, jp, x + w / 2, y + h * 0.42, w * 0.88, Math.round(h * 0.5), fg);
  fitText(g, en, x + w / 2, y + h * 0.82, w * 0.8, Math.round(h * 0.18), fg);
}
function drawDirection(g, x, y, w, h) {
  g.fillStyle = '#1f4fa0'; g.fillRect(x, y, w, h);
  border(g, x + 3, y + 3, w - 6, h - 6, 2, '#ffffff');
  fitText(g, '← 四谷', x + w * 0.26, y + h * 0.4, w * 0.44, Math.round(h * 0.42), '#ffffff');
  fitText(g, 'Yotsuya', x + w * 0.26, y + h * 0.78, w * 0.4, Math.round(h * 0.2), '#ffffff');
  fitText(g, '赤坂 →', x + w * 0.74, y + h * 0.4, w * 0.44, Math.round(h * 0.42), '#ffffff');
  fitText(g, 'Akasaka', x + w * 0.74, y + h * 0.78, w * 0.4, Math.round(h * 0.2), '#ffffff');
  g.fillStyle = '#ffffff'; g.fillRect(x + w / 2 - 1, y + 10, 2, h - 20);
}
// animated: colour-cycling pachinko sign (left) + flickering snack-bar neon (right), 128x256
function drawV2(g, w, h, fr) {
  const hue = (fr * 14) % 360;
  drawV(g, 0, 0, 64, h, 'パチンコ大立方', `hsl(${hue},90%,42%)`, '#ffffff', `hsl(${(hue + 180) % 360},90%,60%)`);
  for (let k = 0, p = 0; p < 2 * (64 + h); k++, p += 12) {
    const on = (k + fr) % 3 === 0;
    let x, y;
    if (p < 64) { x = p; y = 0; } else if (p < 64 + h) { x = 60; y = p - 64; } else if (p < 128 + h) { x = 124 + h - p; y = h - 4; } else { x = 0; y = 2 * h + 128 - p; }
    g.fillStyle = on ? '#fff8c0' : '#5a4a10';
    g.fillRect(Math.max(0, Math.min(60, x)), Math.max(0, Math.min(h - 4, y)), 4, 4);
  }
  const blackout = hash2(fr, 3, 9) < 0.05;
  const ch = [...'スナック夜光'];
  const cols = ch.map((_, k) => (blackout || hash2(k, fr >> 1, 77) > (k === 3 ? 0.55 : 0.97) ? '#3a1430' : '#ff6ad5'));
  drawV(g, 64, 0, 64, h, 'スナック夜光', '#0a0612', '#ff6ad5', blackout ? '#3a1430' : '#ff6ad5', cols);
}
// animated: scrolling dot-matrix LED (vertical), 64x256
function drawLED(g, w, h, fr) {
  g.fillStyle = '#050505'; g.fillRect(0, 0, w, h);
  const cell = 44, n = LED_TEXT.length, off = (fr * 5) % (n * cell);
  g.font = `bold 38px ${FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let k = Math.floor(off / cell); k * cell - off < h + cell; k++) {
    const c = LED_TEXT[k % n];
    g.fillStyle = c === '★' ? '#7dff5a' : k % n < 3 ? '#ff4040' : '#ffa31a';
    g.fillText(c, w / 2, k * cell - off + cell / 2);
  }
  g.fillStyle = 'rgba(0,0,0,0.6)';
  for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
}
// animated: rooftop LED ticker, 512x64
function drawTicker(g, w, h, fr) {
  g.fillStyle = '#04060a'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#c8102e'; g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3);
  g.font = `bold ${Math.round(h * 0.6)}px ${FONT}`;
  g.textBaseline = 'middle'; g.textAlign = 'left';
  const tw = (g.measureText && g.measureText(TICKER).width) || 2400;
  const off = (fr * 8) % tw;
  g.fillStyle = '#ffb21a';
  g.fillText(TICKER, -off, h / 2 + 1);
  g.fillText(TICKER, tw - off, h / 2 + 1);
  g.fillStyle = 'rgba(0,0,0,0.55)';
  for (let x = 0; x < w; x += 3) g.fillRect(x, 0, 1, h);
  for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
}

function makeSigns(ctx) {
  const atlasA = makeCanvas(512, 512), atlasB = makeCanvas(512, 512);
  const ga = atlasA.getContext('2d'), gb = atlasB.getContext('2d');
  VSIGNS.forEach(([t, bg, fg, edge], k) => drawV(ga, (k % 8) * 64, Math.floor(k / 8) * 256, 64, 256, t, bg, fg, edge));
  HSIGNS.forEach((s, k) => {
    const x = (k % 2) * 256, y = Math.floor(k / 2) * 64;
    if (s) drawH(gb, x, y, 256, 64, s); else drawDirection(gb, x, y, 256, 64);
  });
  const anim = {
    V: { c: makeCanvas(128, 256), draw: drawV2 },
    L: { c: makeCanvas(64, 256), draw: drawLED },
    T: { c: makeCanvas(512, 64), draw: drawTicker },
  };
  for (const a of Object.values(anim)) { a.g = a.c.getContext('2d'); a.draw(a.g, a.c.width, a.c.height, 0); }
  const groups = {
    A: { c: atlasA, tiles: [8, 2] }, B: { c: atlasB, tiles: [2, 8] },
    V: { c: anim.V.c, tiles: [2, 1] }, L: { c: anim.L.c, tiles: [1, 1], pixel: true }, T: { c: anim.T.c, tiles: [1, 1], pixel: true },
  };
  for (const gr of Object.values(groups)) { gr.pos = []; gr.uv = []; gr.idx = []; }
  let quads = 0;
  return {
    // textured quad facing (nx, nz), bottom edge centred at (mx, y0, mz)
    quad(gname, tile, mx, y0, mz, nx, nz, W, H) {
      const gr = groups[gname];
      const [tc, tr] = gr.tiles, col = tile % tc, row = Math.floor(tile / tc) % tr;
      const eu = 0.5 / gr.c.width, ev = 0.5 / gr.c.height; // half-texel inset against atlas bleeding
      const u0 = col / tc + eu, u1 = (col + 1) / tc - eu, v1 = 1 - row / tr - ev, v0 = 1 - (row + 1) / tr + ev;
      const rx = nz, rz = -nx, hw = W / 2;
      const vi = gr.pos.length / 3;
      gr.pos.push(mx - rx * hw, y0, mz - rz * hw, mx + rx * hw, y0, mz + rz * hw, mx + rx * hw, y0 + H, mz + rz * hw, mx - rx * hw, y0 + H, mz - rz * hw);
      gr.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      gr.idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      quads++;
    },
    get quads() { return quads; },
    // one mesh per texture; animated canvases redrawn at ~8 fps. Returns draw calls added.
    finish() {
      let calls = 0;
      const live = [];
      for (const [name, gr] of Object.entries(groups)) {
        if (!gr.idx.length) continue;
        const tex = texOf(ctx, gr.c, gr.pixel);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(gr.pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(gr.uv, 2));
        geo.setIndex(gr.idx);
        geo.computeBoundingSphere();
        const mat = new THREE.MeshBasicMaterial({ map: tex });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.matrixAutoUpdate = false;
        ctx.keep(geo); ctx.keep(mat);
        ctx.add(mesh);
        calls++;
        if (anim[name]) live.push({ ...anim[name], tex });
      }
      if (live.length) {
        let acc = 0, fr = 0;
        ctx.animate((time, dt) => {
          acc += dt || 0;
          if (acc < 0.12) return;
          acc = 0; fr++;
          for (const a of live) { a.draw(a.g, a.c.width, a.c.height, fr); a.tex.needsUpdate = true; }
        });
      }
      return calls;
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Neon signs: vertical blade signs, flat facade signs, rooftop boards
function buildSigns(ctx, T) {
  const { N, ds, hi, wrap, idx, inRange, inner, facade, march } = T;
  const Q = T.signs, rnd = ctx.rng(2460);
  const iY = idx(LL.yotsuya);
  const zones = [
    [wrap(idx(LL.aoyama) - 60), wrap(idx(LL.mitsuke) + 25), 1], // Aoyama-dori down to Akasaka-mitsuke
    [wrap(iY - 75), wrap(iY + 75), 1], // around Yotsuya station
    [iY, wrap(idx(LL.yotsuya3) + 10), 0.85], // Shinjuku-dori
  ];
  const dens = (i) => {
    for (const [a, b, d] of zones) if (inRange(i, a, b)) return d;
    return 0.3;
  };
  const roofUsed = new Set();
  const steel = '#3a3d42', dark = '#1d1e22';
  const pickV = (r) => (r < 0.1 ? ['V', 0] : r < 0.18 ? ['V', 1] : r < 0.25 ? ['L', 0] : ['A', Math.floor(hash2(Math.floor(r * 1e6), 5, 3) * VSIGNS.length)]);

  for (const s of [1, -1]) {
    for (let i = s > 0 ? 0 : 3; i < N;) {
      const d = dens(i), dense = d >= 0.8;
      const step = Math.max(2, Math.round((dense ? 5 + rnd() * 9 : 16 + rnd() * 28) / ds));
      if (rnd() > d) { i += step; continue; }
      const h = facade(i, s, 9);
      if (!h || h.o > T.outer(i, s) + 12) { i += 2; continue; }
      const { b, F, n } = h;
      const gy = ctx.groundY(F[0], F[1]);
      const topRel = (b.base ?? gy) + b.h - gy; // building top above the sidewalk here
      const room = h.o - inner(i, s) - 0.6; // free space between facade and barrier
      const rot = faceRot(n[0], n[1]); // local +x = out of the facade, local +z along it
      const f = frame(ctx.boxes(F[0], F[1]), F[0], gy, F[1], rot);
      const g = frame(ctx.boxes(F[0], F[1], 'glow'), F[0], gy, F[1], rot);
      const t = [-n[1], n[0]];
      const r = rnd();
      if (r < 0.13 && h.straight && !roofUsed.has(b) && b.h > 10 && b.h < 70) {
        // rooftop board, set back from the parapet, on a steel frame
        const W = 7 + rnd() * 7;
        const ia = wrap(i - Math.round(W / 2 / ds)), ib = wrap(i + Math.round(W / 2 / ds));
        const ha = march(ia, s, 9), hb = march(ib, s, 9);
        if (ha && hb && ha.b === b && hb.b === b && Math.abs(ha.o - h.o) < 3 && Math.abs(hb.o - h.o) < 3) {
          roofUsed.add(b);
          const ticker = rnd() < 0.18;
          const H = ticker ? W / 8 : W / 4, y0 = topRel + 1.4, back = -1.6;
          for (let k = 0; k <= 3; k++) {
            const z = -W / 2 + 0.3 + (k * (W - 0.6)) / 3;
            f.box(back - 0.9, topRel, z - 0.1, back - 0.7, y0 + H * 0.9, z + 0.1, steel);
            if (hi) f.box(back - 0.9, topRel, z - 0.08, back - 0.1, topRel + 0.2, z + 0.08, steel);
          }
          f.box(back - 0.35, y0 - 0.15, -W / 2 - 0.1, back - 0.03, y0 + H + 0.1, W / 2 + 0.1, dark);
          if (hi) g.box(back - 0.04, y0 - 0.25, -W / 2 - 0.15, back, y0 - 0.15, W / 2 + 0.15, NEONS[Math.floor(rnd() * NEONS.length)]);
          const mx = F[0] + n[0] * back, mz = F[1] + n[1] * back;
          if (ticker) Q.quad('T', 0, mx, gy + y0, mz, n[0], n[1], W, H);
          else Q.quad('B', ROOF_TILES[Math.floor(rnd() * ROOF_TILES.length)], mx, gy + y0, mz, n[0], n[1], W, H);
          i += step;
          continue;
        }
      }
      let blade = r < 0.75 && room > 2.0;
      let W = blade ? Math.min(1.2 + rnd() * 1.3, room - 0.7) : 1.3 + rnd() * 1.1;
      if (blade) {
        // a skewed facade can aim the blade at the road: keep its tip behind the barrier
        const tip = 0.4 + W + 0.2, c = ctx.courseAt(F[0] + n[0] * tip, F[1] + n[1] * tip);
        if (Math.abs(c.d) < (c.d > 0 ? c.wallL : c.wallR) + 0.8) { blade = false; W = 1.3 + rnd() * 1.1; }
      }
      const y0 = 4 + rnd() * 2;
      const H = Math.min(Math.max(5, W * (3.6 + rnd() * 2)), 14, topRel - y0 - 0.6);
      if (H < 3.5 || W < 1.1 || (!blade && !h.straight)) { i += 2; continue; }
      const [gname, tile] = pickV(rnd());
      const neon = hi && rnd() < 0.5 ? NEONS[Math.floor(rnd() * NEONS.length)] : null;
      if (blade) {
        // projecting blade sign, readable from both directions along the street
        const x0 = 0.4, x1 = 0.4 + W;
        f.box(x0 - 0.08, y0 - 0.12, -0.07, x1 + 0.08, y0 + H + 0.12, 0.07, dark);
        f.box(0, y0 + 0.4, -0.05, x0, y0 + 0.55, 0.05, steel);
        f.box(0, y0 + H - 0.55, -0.05, x0, y0 + H - 0.4, 0.05, steel);
        if (neon) {
          g.box(x1 + 0.08, y0 - 0.12, -0.09, x1 + 0.16, y0 + H + 0.12, 0.09, neon);
          if (hi) g.box(x0 - 0.08, y0 + H + 0.12, -0.09, x1 + 0.16, y0 + H + 0.2, 0.09, neon);
        }
        const cx = F[0] + n[0] * (x0 + W / 2), cz = F[1] + n[1] * (x0 + W / 2);
        Q.quad(gname, tile, cx + t[0] * 0.075, gy + y0, cz + t[1] * 0.075, t[0], t[1], W, H);
        Q.quad(gname, tile, cx - t[0] * 0.075, gy + y0, cz - t[1] * 0.075, -t[0], -t[1], W, H);
      } else {
        // flat on the facade
        f.box(-0.05, y0 - 0.12, -W / 2 - 0.12, 0.16, y0 + H + 0.12, W / 2 + 0.12, dark);
        if (neon) g.box(0.1, y0 - 0.2, -W / 2 - 0.2, 0.18, y0 - 0.12, W / 2 + 0.2, neon);
        Q.quad(gname, tile, F[0] + n[0] * 0.17, gy + y0, F[1] + n[1] * 0.17, n[0], n[1], W, H);
      }
      i += step;
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Konbini storefronts
function bicycle(f, u, e, rotK, col) {
  // length along local x (perpendicular to the shop front), at (u, e)
  const B = (a0, y0, b0, a1, y1, b1, c) => f.box(u + a0, y0, e + b0, u + a1, y1, e + b1, c);
  const tyre = '#18181a';
  for (const c of [-0.55, 0.55]) {
    B(c - 0.2, 0.05, -0.025, c + 0.2, 0.61, 0.025, tyre);
    B(c - 0.28, 0.13, -0.025, c + 0.28, 0.53, 0.025, tyre);
  }
  B(-0.45, 0.45, -0.03, 0.4, 0.52, 0.03, col);
  B(-0.32, 0.5, -0.03, -0.26, 0.82, 0.03, col);
  B(-0.42, 0.82, -0.07, -0.18, 0.88, 0.07, '#222222');
  B(0.42, 0.45, -0.03, 0.48, 0.95, 0.03, col);
  B(0.38, 0.95, -0.28, 0.46, 1.0, 0.28, '#a9adb2');
  B(0.5, 0.72, -0.18, 0.82, 0.95, 0.18, rotK ? '#c8cbd0' : '#3a3d42'); // basket (mamachari)
}
function buildKonbini(ctx, T) {
  const { N, hi, wrap, march, inner, outer, at, track } = T;
  const cands = [];
  for (let i = 0; i < N; i += 7) for (const s of [1, -1]) {
    const h1 = march(i, s, 6, 30);
    if (!h1 || h1.o > outer(i, s) + 3 || h1.o - inner(i, s) < 1.6) continue;
    if (h1.b.h > 60 || /ホテル|hotel/i.test(h1.b.name || '')) continue; // shops sit in mid-rise blocks, not hotel towers
    const i2 = wrap(i + 5), hm = march(wrap(i + 2), s, 6, 30), h2 = march(i2, s, 6, 30);
    if (!h2 || !hm || h2.b !== h1.b || hm.b !== h1.b || Math.abs(h1.o - h2.o) > 0.8 || Math.abs(hm.o - h1.o) > 0.8) continue;
    const A = at(i, s, h1.o), B = at(i2, s, h2.o);
    if (T.escape((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, 2)) continue;
    cands.push({ i, s, h1, h2, A, B, r: hash2(i, s + 2, 818) });
  }
  cands.sort((a, b) => a.r - b.r);
  const picked = [], minGap = Math.round(320 / T.ds);
  for (const c of cands) {
    if (picked.length >= 8) break;
    if (picked.some((p) => Math.min(T.fwd(p.i, c.i), T.fwd(c.i, p.i)) < minGap)) continue;
    if (!T.free(c.s, c.i - 1, c.i + 6)) continue;
    picked.push(c);
  }
  picked.forEach((c, k) => {
    const { A, B, s, i } = c;
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    let n = [-(B[1] - A[1]) / L, (B[0] - A[0]) / L];
    if (n[0] * (track.px[i] - A[0]) + n[1] * (track.pz[i] - A[1]) < 0) n = [-n[0], -n[1]];
    const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2, W = Math.min(L, 10.5) - 0.6;
    const y = T.walkY(wrap(i + 2));
    const rot = faceRot(n[0], n[1]);
    const p = frame(ctx.boxes(mx, mz), mx, y, mz, rot), g = frame(ctx.boxes(mx, mz, 'glow'), mx, y, mz, rot);
    const br = KONBINI[k % KONBINI.length];
    const hw = W / 2;
    // lit glass front, mullions, door frame
    g.box(0.02, 0.06, -hw + 0.25, 0.09, 2.55, hw - 0.25, '#e4f2ff');
    p.box(0, -0.2, -hw, 0.14, 0.08, hw, '#8d9298');
    p.box(0, 2.55, -hw, 0.16, 2.72, hw, '#c9ced3');
    for (let z = -hw + 0.25; z <= hw - 0.2; z += 1.6) p.box(0.09, 0.06, z - 0.05, 0.15, 2.55, z + 0.05, '#9aa1a8');
    p.box(0.09, 2.1, -1.0, 0.15, 2.18, 1.0, '#9aa1a8'); // automatic door header
    if (hi) {
      // shelves and magazine rack seen through the glass
      for (const yy of [0.55, 1.05, 1.55]) g.box(0.09, yy, -hw + 1.3, 0.1, yy + 0.07, hw - 1.3, '#9db0c2');
      g.box(0.09, 0.06, -hw + 0.3, 0.12, 0.9, -1.2, '#c9b9a0');
      for (let z = -hw + 0.4; z < -1.4; z += 0.32) g.box(0.12, 0.62, z, 0.14, 0.88, z + 0.24, NEONS[Math.floor(hash2(z * 10, k, 5) * NEONS.length)]);
    }
    // fascia band with brand stripes + logo
    g.box(0, 2.72, -hw - 0.1, 0.42, 3.6, hw + 0.1, br.band);
    g.box(0.42, 2.76, -hw - 0.1, 0.44, 2.86, hw + 0.1, br.s1);
    g.box(0.42, 2.86, -hw - 0.1, 0.44, 2.94, hw + 0.1, br.s2);
    T.signs.quad('B', br.tile, mx + n[0] * 0.45, y + 2.97, mz + n[1] * 0.45, n[0], n[1], 2.4, 0.6);
    if (hi) {
      // recycling bins beside the door
      p.box(0.2, 0, hw - 1.1, 0.65, 0.9, hw - 0.65, '#3b6fc4');
      p.box(0.2, 0, hw - 0.6, 0.65, 0.9, hw - 0.15, '#e6e8ea');
      p.box(0.18, 0.9, hw - 1.12, 0.67, 0.96, hw - 0.13, '#2a2d31');
      // a couple of parked bicycles (perpendicular to the front) if the sidewalk is deep enough
      const depth = c.h1.o - inner(i, s);
      if (depth >= 2.6) {
        const nb = 1 + (k % 2);
        for (let q = 0; q < nb; q++) bicycle(p, 1.15, -hw - 0.6 - q * 0.7, q, ['#c8242c', '#e9ecef', '#2357b8', '#1f1f1f', '#d9b23a'][(k + q) % 5]);
      }
    }
    T.claim(s, i - 1, i + 6);
  });
}

// ---------------------------------------------------------------------------
// 3. Vending machines (jidouhanbaiki) in clusters along the sidewalks
const VEND_BODY = ['#c8242c', '#e9ecef', '#2357b8', '#d22630', '#f2f3f5', '#1f4fa8', '#2e8b57', '#efe9e0'];
const CANS = ['#d7263d', '#1b4dd6', '#f2f2f2', '#2e8b57', '#ff8a00', '#6b3a1e', '#ffd23f', '#111111'];
function vendingMachine(p, g, z, body, hi, seed) {
  p.box(0, 0, z - 0.5, 0.78, 1.83, z + 0.5, body);
  p.box(0.78, 0.12, z - 0.38, 0.83, 0.38, z + 0.38, '#16181b'); // dispenser
  g.box(0.78, 0.98, z - 0.44, 0.8, 1.72, z + 0.44, '#eaf6ff'); // display window
  if (!hi) return;
  g.box(0.78, 0.82, z - 0.42, 0.8, 0.92, z + 0.42, '#6fd0ff'); // button row
  g.box(0.78, 1.74, z - 0.46, 0.8, 1.8, z + 0.46, '#ffffff'); // top light strip
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
    const zz = z - 0.4 + c * 0.135;
    g.box(0.8, 1.04 + r * 0.22, zz + 0.02, 0.84, 1.18 + r * 0.22, zz + 0.115, CANS[Math.floor(hash2(seed, r * 7 + c, 61) * CANS.length)]);
  }
}
function buildVending(ctx, T) {
  const { N, ds, hi, wrap, inner, outer, at, march, track } = T;
  const rnd = ctx.rng(7310);
  let i = Math.round(70 / ds), n = 0;
  while (i < N - 6) {
    let done = false;
    const sides = rnd() < 0.5 ? [1, -1] : [-1, 1];
    for (let k = 0; k < 30 && !done; k += 2) for (const s of sides) {
      if (done) break;
      const j = wrap(i + k), cnt = 2 + Math.floor(rnd() * 3), len = cnt * 1.05 + 0.8;
      const m = Math.ceil(len / ds), jc = wrap(j + Math.round(m / 2));
      if (!T.free(s, j - 1, j + m + 1)) continue;
      const h = march(jc, s, 0, outer(jc, s) + 4);
      const back = h ? Math.min(h.o - 0.05, outer(jc, s) - 0.05) : outer(jc, s) - 0.05;
      if (back - 0.85 < inner(jc, s) + 0.9) continue;
      let ok = true;
      for (let q = 0; q <= m && ok; q++) {
        const jj = wrap(j + q), t = T.tan(jj);
        if (Math.abs(track.curv[jj]) > 0.012) ok = false;
        for (const o of [back - 0.8, back - 0.1]) {
          const [x, z] = at(jj, s, o);
          if (T.buildingAt(x, z) || T.inStreet(x, z, 0.6, t) || T.escape(x, z, 1)) ok = false;
        }
      }
      const [cx, cz] = at(jc, s, back);
      if (!ok || T.nearInter(cx, cz, 12)) continue;
      const rot = faceRot(-track.nx[jc] * s, -track.nz[jc] * s); // local +x toward the road
      const y = T.walkY(jc);
      const p = frame(ctx.boxes(cx, cz), cx, y, cz, rot), g = frame(ctx.boxes(cx, cz, 'glow'), cx, y, cz, rot);
      for (let q = 0; q < cnt; q++) {
        const z = (q - (cnt - 1) / 2) * 1.05;
        vendingMachine(p, g, z, VEND_BODY[Math.floor(rnd() * VEND_BODY.length)], hi, n * 7 + q);
      }
      if (hi) {
        const ze = ((cnt - 1) / 2) * 1.05 + 0.75;
        p.box(0.1, 0, ze - 0.22, 0.55, 0.8, ze + 0.22, '#3b6fc4');
        p.box(0.08, 0.8, ze - 0.24, 0.57, 0.86, ze + 0.24, '#d9dde2');
      }
      T.claim(s, j - 1, j + m + 1);
      n++;
      done = true;
    }
    i += Math.round((120 + rnd() * 80) / ds);
  }
}

// ---------------------------------------------------------------------------
// 4. Pedestrian footbridges (hodōkyō)
function findBridgeSpot(T, ia, ib, pref, avoid) {
  const { wrap, fwd, track, at } = T;
  let best = -1, bs = Infinity;
  const span = fwd(ia, ib);
  for (let k = 0; k <= span; k++) {
    const i = wrap(ia + k);
    let cm = 0;
    for (let q = -12; q <= 12; q++) cm = Math.max(cm, Math.abs(track.curv[wrap(i + q)]));
    if (cm > 0.008) continue;
    const x = track.px[i], z = track.pz[i];
    if (T.nearInter(x, z, 32) || T.nearViaduct(x, z, 30)) continue;
    if (avoid.some(([a, r]) => Math.min(fwd(a, i), fwd(i, a)) < r)) continue;
    let bad = false;
    for (const s of [1, -1]) for (let q = -8; q <= 8 && !bad; q += 2) {
      const jj = wrap(i + q), [sx, sz] = at(jj, s, T.inner(jj, s) + 1.3);
      if (T.escape(sx, sz, 1) || T.buildingAt(sx, sz) || T.inStreet(sx, sz, 0.5, T.tan(jj))) bad = true;
    }
    if (bad) continue;
    const sc = cm * 1000 + Math.abs(k - pref) * 0.05;
    if (sc < bs) { bs = sc; best = i; }
  }
  return best;
}
function footbridge(ctx, T, i, plate) {
  const { track, hi, wrap } = T;
  const nx = track.nx[i], nz = track.nz[i];
  const rot = faceRot(nx, nz); // local +x = left of the race direction, local z along the course
  const zs = Math.sign(-nz * track.tx[i] + nx * track.tz[i]) || 1; // local +z = race direction?
  const x0 = track.px[i], z0 = track.pz[i], y = track.py[i];
  const p = frame(ctx.boxes(x0, z0), x0, y, z0, rot), g = frame(ctx.boxes(x0, z0, 'glow'), x0, y, z0, rot);
  const green = '#3c7a50', dkGreen = '#2c6040', rail = '#4c8e60';
  const xl = T.inner(i, 1) + 1.3, xr = -(T.inner(i, -1) + 1.3); // stair centre lines on both sidewalks
  const yW = 0.15, yD = 6.4; // sidewalk, deck walking level
  // deck girder + walking surface + parapets
  p.box(xr - 0.85, 5.5, -1.3, xl + 0.85, yD - 0.05, 1.3, green);
  p.box(xr - 0.85, yD - 0.05, -1.2, xl + 0.85, yD, 1.2, '#7b807c', { skipBottom: true });
  for (const zz of [-1, 1]) {
    p.box(xr - 0.85, yD, zz * 1.2, xl + 0.85, yD + 1.15, zz * 1.3, rail);
    if (hi) p.box(xr - 0.85, yD + 1.15, zz * 1.18, xl + 0.85, yD + 1.22, zz * 1.32, '#d9dcd6');
  }
  for (const xe of [xr - 0.85, xl + 0.85]) p.box(xe - 0.1 * Math.sign(xe), yD, -1.3, xe, yD + 1.15, 1.3, rail);
  // piers behind the barriers
  for (const xp of [T.wall(i, 1) + 0.45, -(T.wall(i, -1) + 0.45)]) for (const zz of [-0.85, 0.85]) {
    p.box(xp - 0.22, yW, zz - 0.22, xp + 0.22, 5.5, zz + 0.22, dkGreen);
  }
  // stairs down along each sidewalk, in opposite directions
  const nSteps = hi ? 22 : 8, rise = (yD - yW) / nSteps, Ls = 10.6, run = Ls / nSteps;
  for (const [xc, dir] of [[xl, 1], [xr, -1]]) {
    for (let k = 0; k < nSteps; k++) {
      const za = dir * (1.3 + k * run), zb = dir * (1.3 + (k + 1) * run), yt = yD - (k + 1) * rise;
      if (hi) {
        p.box(xc - 0.7, yt - 0.16, za, xc + 0.7, yt, zb, '#8a8f8b');
        for (const sx of [-1, 1]) p.box(xc + sx * 0.7, yt - 0.4, za, xc + sx * 0.8, yt + 1.05, zb, rail);
      } else {
        p.box(xc - 0.8, yW, za, xc + 0.8, yt, zb, k % 2 ? green : rail);
      }
    }
    // landing under the deck end and a column under the lower flight
    p.box(xc - 0.8, yD - 0.4, -1.3, xc + 0.8, yD, 1.3, green);
    if (hi) p.box(xc - 0.15, yW, dir * (1.3 + Ls * 0.45) - 0.15, xc + 0.15, yD - 0.45 * (yD - yW) - 0.4, dir * (1.3 + Ls * 0.45) + 0.15, dkGreen);
  }
  // lamps under the deck
  if (hi) for (const xx of [-track.hw[i] * 0.5, 0, track.hw[i] * 0.5]) g.box(xx - 0.3, 5.42, -0.15, xx + 0.3, 5.5, 0.15, '#f4f8ff');
  // name plates (both faces) + a blue direction sign facing the oncoming cars
  for (const zz of [-1, 1]) {
    const wx = Math.sin(rot) * zz, wz = Math.cos(rot) * zz; // world direction of local +z * zz
    const off = (u) => [x0 + Math.cos(rot) * u + wx * 1.32, z0 - Math.sin(rot) * u + wz * 1.32];
    const facingCars = zz === -zs;
    const [ax, az] = off(facingCars ? 2.8 : 0);
    T.signs.quad('B', plate, ax, y + 5.75, az, wx, wz, 5, 1.25);
    if (facingCars) {
      const [bx, bz] = off(-2.8);
      T.signs.quad('B', 11, bx, y + 5.75, bz, wx, wz, 5, 1.25);
    }
  }
  const m = Math.ceil(13 / T.ds);
  T.claim(1, i - m, i + m);
  T.claim(-1, i - m, i + m);
  return wrap(i);
}
function buildFootbridges(ctx, T) {
  const { wrap, fwd, idx } = T;
  const placed = [];
  const iT = idx(LL.toyokawa);
  const tryRange = (ia, ib, pref, plate) => {
    if (fwd(ia, ib) > T.N / 2) return;
    const i = findBridgeSpot(T, ia, ib, pref, [...placed.map((q) => [q, 150]), [iT, 40]]);
    if (i >= 0) placed.push(footbridge(ctx, T, i, plate));
  };
  // Gaien-higashi-dori at Shinanomachi station (real footbridge position)
  const iS = idx(LL.hodokyo);
  tryRange(wrap(iS - 40), wrap(iS + 40), 40, 10);
  // Aoyama-dori, on the straight between Aoyama-itchome and Akasaka-mitsuke
  {
    const ia = wrap(idx(LL.aoyama1) + 40), ib = wrap(idx(LL.mitsuke) - 45);
    tryRange(ia, ib, Math.round(fwd(ia, ib) * 0.4), 9);
  }
  // Gaien-higashi-dori by the palace grounds (Yotsuya 3-chome -> Shinanomachi)
  {
    const ia = wrap(idx(LL.yotsuya3) + 40), ib = wrap(idx(LL.shinano) - 20);
    tryRange(ia, ib, Math.round(fwd(ia, ib) * 0.5), 9);
  }
}

// ---------------------------------------------------------------------------
// 5. Tokyo Tower: own fog-free mesh (it stands ~2.3 km away, beyond the fog far plane);
// colours are pre-hazed toward the fog colour instead.
function buildTokyoTower(ctx) {
  const hi = ctx.hi;
  const [x, z] = ctx.project(...LL.tower);
  const y = ctx.groundY(x, z);
  const fogC = new THREE.Color(ctx.theme.fog || '#151d3a');
  const pal = {};
  const C = (hex, k = 0.24) => pal[hex + k] || (pal[hex + k] = new THREE.Color(hex).lerp(fogC, k));
  const b = new BoxBuilder();
  const f = frame(b, x, y, z, 0.35);
  const R = (h) => 4 + 36 * Math.pow(Math.max(0, 1 - h / 262), 1.7); // leg half-spread
  const band = (h) => (Math.floor(h / 21) % 2 ? C('#ffb35c') : C('#ff7a1c'));
  // legs
  const dy = hi ? 5 : 10;
  for (let h = 0; h < 250; h += dy) {
    const r = R(h + dy / 2), a = 0.8 + 2.4 * (1 - h / 250);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(sx * r - a, h, sz * r - a, sx * r + a, h + dy, sz * r + a, band(h));
  }
  // horizontal girders + stepped X bracing
  const gstep = hi ? 15 : 30;
  for (let h = 45; h < 246; h += gstep) {
    const r = R(h), t = 0.45 + 0.6 * (1 - h / 250);
    f.box(-r, h, -r - t, r, h + t * 1.6, -r + t, band(h)); f.box(-r, h, r - t, r, h + t * 1.6, r + t, band(h));
    f.box(-r - t, h, -r, -r + t, h + t * 1.6, r, band(h)); f.box(r - t, h, -r, r + t, h + t * 1.6, r, band(h));
    if (!hi || h + gstep > 246) continue;
    const m = 5;
    for (let q = 0; q < m; q++) {
      const ya = h + (q / m) * gstep, yb = h + ((q + 1) / m) * gstep, rm = R((ya + yb) / 2);
      const ua = -rm + (q / m) * 2 * rm, ub = -rm + ((q + 1) / m) * 2 * rm, th = 0.35;
      for (const dd of [1, -1]) {
        const u0 = dd > 0 ? ua : -ub, u1 = dd > 0 ? ub : -ua;
        f.box(u0, ya, -rm - th, u1, yb * 0.5 + ya * 0.5 + 0.6, -rm + th, C('#e8661a'));
        f.box(u0, ya, rm - th, u1, yb * 0.5 + ya * 0.5 + 0.6, rm + th, C('#e8661a'));
        f.box(-rm - th, ya, u0, -rm + th, yb * 0.5 + ya * 0.5 + 0.6, u1, C('#e8661a'));
        f.box(rm - th, ya, u0, rm + th, yb * 0.5 + ya * 0.5 + 0.6, u1, C('#e8661a'));
      }
    }
  }
  // base arches between the legs
  const na = hi ? 9 : 5;
  for (let q = 0; q < na; q++) {
    const u0 = -1 + (2 * q) / na, u1 = -1 + (2 * (q + 1)) / na, um = (u0 + u1) / 2;
    const ya = 42 * Math.sqrt(Math.max(0, 1 - um * um)), r = R(ya);
    const s0 = u0 * r, s1 = u1 * r, t = 0.9;
    f.box(s0, ya - 1.6, -r - t, s1, ya, -r + t, C('#ff7a1c')); f.box(s0, ya - 1.6, r - t, s1, ya, r + t, C('#ff7a1c'));
    f.box(-r - t, ya - 1.6, s0, -r + t, ya, s1, C('#ff7a1c')); f.box(r - t, ya - 1.6, s0, r + t, ya, s1, C('#ff7a1c'));
  }
  // Foot Town building between the legs, with lit window bands
  f.box(-30, -2, -30, 30, 18, 30, C('#2a2f3d', 0.15));
  for (const wy of [4, 9, 14]) f.box(-30.1, wy, -30.1, 30.1, wy + 1.2, 30.1, C('#ffd8a0', 0.2));
  // main deck (150 m) and top deck (250 m)
  const white = C('#fff1e0', 0.18), win = C('#ffd890', 0.18);
  f.box(-16, 142, -16, 16, 150, 16, white);
  f.box(-16.15, 144, -16.15, 16.15, 148, 16.15, win);
  f.box(-14.5, 150, -14.5, 14.5, 157, 14.5, white);
  f.box(-14.65, 151.5, -14.65, 14.65, 155, 14.65, win);
  f.box(-15, 157, -15, 15, 158.2, 15, C('#ff7a1c'));
  f.box(-6.5, 244, -6.5, 6.5, 252, 6.5, white);
  f.box(-6.65, 246, -6.65, 6.65, 250, 6.65, win);
  // antenna mast, alternating bands
  const segs = [[252, 270, 3.0], [270, 290, 2.2], [290, 310, 1.5], [310, 325, 0.9], [325, 333, 0.45]];
  segs.forEach(([a, c, r], k) => f.box(-r, a, -r, r, c, r, k % 2 ? white : C('#ff7a1c')));
  // aircraft warning lights
  const red = new THREE.Color('#ff2a2a');
  f.box(-0.5, 333, -0.5, 0.5, 334.2, 0.5, red);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    f.box(sx * 16 - 0.4, 158.2, sz * 16 - 0.4, sx * 16 + 0.4, 159, sz * 16 + 0.4, red);
    f.box(sx * 6.5 - 0.3, 252, sz * 6.5 - 0.3, sx * 6.5 + 0.3, 252.7, sz * 6.5 + 0.3, red);
  }
  const geo = b.build();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  ctx.keep(geo); ctx.keep(mat);
  ctx.add(mesh);
}

// ---------------------------------------------------------------------------
// 6. Akasaka Palace (Geihinkan): floodlit neo-baroque palace + forecourt gate and fence
function buildPalace(ctx, T) {
  const hi = ctx.hi;
  const [ox, oz] = ctx.project(...LL.palace);
  const f0 = frame(null, ox, 0, oz, PAL_ROT);
  let by = Infinity;
  for (const [u, e] of [[-PAL_HX, -PAL_HZ], [PAL_HX, -PAL_HZ], [-PAL_HX, PAL_HZ], [PAL_HX, PAL_HZ], [0, 0]]) by = Math.min(by, ctx.groundY(f0.wx(u, e), f0.wz(u, e)));
  const lit = ctx.theme.night ? 'glow' : 'props';
  const L = frame(ctx.boxes(ox, oz, lit), ox, by, oz, PAL_ROT);
  const stone = '#e6dcc4', plinth = '#b9ae98', cornice = '#f3ead6', copper = '#5d9a86', copperL = '#86c2ab', gold = '#f0c75a';
  const winLit = '#ffd27a', winDim = '#7c6e52', bronze = '#55705f';
  const blocks = [
    [-46, 46, -16, 36, 19], [-15, 15, -24, 40, 22.5],
    [-62, -40, -40, 36, 19], [40, 62, -40, 36, 19],
    [-64, -38, -48, -34, 21], [38, 64, -48, -34, 21],
  ];
  for (const [x0, x1, z0, z1, h] of blocks) {
    L.box(x0 - 0.4, -1, z0 - 0.4, x1 + 0.4, 3.6, z1 + 0.4, plinth);
    L.box(x0, 3.6, z0, x1, h, z1, stone);
    L.box(x0 - 0.6, h, z0 - 0.6, x1 + 0.6, h + 0.9, z1 + 0.6, cornice);
    if (hi) L.box(x0 - 0.3, h + 0.9, z0 - 0.3, x1 + 0.3, h + 1.8, z1 + 0.3, '#ece2cb'); // balustrade
    // mansard roof in copper
    const steps = 3;
    for (let k = 0; k < steps; k++) {
      const ins = 1.3 + k * 1.9, ya = h + 1.8 + k * 1.7;
      if (x1 - x0 - 2 * ins < 2 || z1 - z0 - 2 * ins < 2) break;
      L.box(x0 + ins, ya, z0 + ins, x1 - ins, ya + 1.7, z1 - ins, k === steps - 1 ? copperL : copper);
    }
  }
  // central pavilion: tall copper roof, crown and the armoured warrior statues
  for (let k = 0; k < 5; k++) {
    const ins = 2 + k * 2.4, ya = 24.3 + k * 2.1;
    L.box(-15 + ins, ya, -24 + ins, 15 - ins, ya + 2.1, 10 - ins, k % 2 ? copperL : copper); // over the front half
  }
  L.box(-1.2, 34.8, -10.2, 1.2, 37.2, -7.8, gold);
  figure(L, -11, -24.6, 24.3, 3.4, bronze);
  figure(L, 11, -24.6, 24.3, 3.4, bronze);
  L.box(-3, 24.3, -25.2, 3, 26.5, -23.8, bronze); // central armillary group plinth
  L.box(-1.2, 26.5, -25, 1.2, 28.6, -24, gold);
  // wing-end pavilions: stepped copper domes with finials
  for (const sx of [-51, 51]) {
    for (let k = 0; k < 3; k++) L.box(sx - 9 + k * 2.6, 22.8 + k * 2, -45 + k * 2.6, sx + 9 - k * 2.6, 24.8 + k * 2, -37 - k * 2.6, k === 2 ? copperL : copper);
    L.box(sx - 0.3, 28.8, -41.3, sx + 0.3, 31, -40.7, gold);
  }
  // portico columns and porte-cochère on the forecourt side
  for (let x = -13; x <= 13.01; x += 3.72) L.box(x - 0.45, 3.6, -24.9, x + 0.45, 21.5, -24.1, cornice);
  L.box(-8, -1, -31, 8, 4.2, -24.5, plinth);
  for (const x of [-7.4, 7.4]) L.box(x - 0.5, 4.2, -30.8, x + 0.5, 7.5, -29.8, cornice);
  L.box(-8.2, 7.5, -31.2, 8.2, 8.4, -24.5, cornice);
  // windows: two piano nobile rows, most of them lit
  let wk = 0;
  const win = (axis, fixed, from, to, dir) => {
    for (let a = from + 2.2; a <= to - 2.2; a += 4.2) for (const [y0, y1] of [[5.8, 10.6], [12.2, 16.8]]) {
      const col = hash2(wk++, 3, 19) < 0.62 ? winLit : winDim;
      if (axis === 'x') L.box(a - 0.85, y0, fixed, a + 0.85, y1, fixed + dir * 0.08, col);
      else L.box(fixed, y0, a - 0.85, fixed + dir * 0.08, y1, a + 0.85, col);
      if (hi) {
        if (axis === 'x') L.box(a - 1.15, y1 + 0.25, fixed, a + 1.15, y1 + 0.65, fixed + dir * 0.18, cornice);
        else L.box(fixed, y1 + 0.25, a - 1.15, fixed + dir * 0.18, y1 + 0.65, a + 1.15, cornice);
      }
    }
  };
  win('x', -16, -40, -15, -1); win('x', -16, 15, 40, -1); // forecourt facade
  win('z', -40, -40, -16, 1); win('z', 40, -40, -16, -1); // wing inner faces
  win('x', -48, -64, -38, -1); win('x', -48, 38, 64, -1); // wing pavilion ends
  if (hi) {
    win('x', 36, -62, 62, 1); // garden facade
    win('z', -62, -34, 36, -1); win('z', 62, -34, 36, 1);
    // statues and urns along the forecourt roofline
    for (let x = -44; x <= 44; x += 6) {
      if (Math.abs(x) < 16) continue;
      L.box(x - 0.35, 20.8, -16.6, x + 0.35, 21.5, -15.9, cornice);
      L.box(x - 0.25, 21.5, -16.5, x + 0.25, 22.4, -16.0, '#f6f0e2');
    }
    // floodlights at the foot of the forecourt facade
    for (let x = -60; x <= 60; x += 10) L.box(x - 0.3, -0.2, -52, x + 0.3, 0.3, -51.4, '#fff6dc');
  }

  // forecourt: iron fence with gold-tipped posts and the main gate, pines along the sides
  const gz = -205, gcx = f0.wx(0, gz), gcz = f0.wz(0, gz);
  if (!T.buildingAt(gcx, gcz)) {
    const gy = ctx.groundY(gcx, gcz);
    const G = frame(ctx.boxes(gcx, gcz), gcx, gy, gcz, PAL_ROT);
    const GL = frame(ctx.boxes(gcx, gcz, 'glow'), gcx, gy, gcz, PAL_ROT);
    const GS = frame(ctx.boxes(gcx, gcz, lit), gcx, gy, gcz, PAL_ROT);
    const iron = '#1c1e21';
    for (const sx of [-1, 1]) {
      const a = sx * 6.5, c = sx * 70;
      G.box(a, -0.6, -0.45, c, 0.9, 0.45, '#bcb3a2');
      G.box(a, 1.2, -0.05, c, 1.32, 0.05, iron);
      G.box(a, 2.9, -0.05, c, 3.02, 0.05, iron);
      for (let x = 7.5; x <= 70.01; x += 3) {
        const xx = sx * x;
        G.box(xx - 0.13, 0.9, -0.13, xx + 0.13, 3.25, 0.13, iron);
        GL.box(xx - 0.1, 3.25, -0.1, xx + 0.1, 3.55, 0.1, gold);
      }
      if (hi) for (let x = 7.0; x < 70; x += 0.5) G.box(sx * x - 0.03, 0.9, -0.03, sx * x + 0.03, 3.0, 0.03, iron);
      // gate piers with lanterns
      GS.box(a - sx * 2.4, -0.6, -1.2, a, 7, 1.2, '#e2d7bf');
      GS.box(a - sx * 2.6, 7, -1.35, a + sx * 0.2, 7.5, 1.35, cornice);
      GL.box(a - sx * 1.65, 7.5, -0.45, a - sx * 0.75, 8.8, 0.45, '#ffe2a0');
      G.box(a - sx * 1.8, 8.8, -0.55, a - sx * 0.6, 9.1, 0.55, iron);
    }
    // gate leaves: bars rising to an arch, gold crest
    const nb = hi ? 31 : 9;
    for (let q = 0; q < nb; q++) {
      const x = -4.0 + (8.0 * (q + 0.5)) / nb, top = 4.6 + 1.2 * Math.cos((x / 4.1) * Math.PI / 2);
      G.box(x - 0.04, 0, -0.04, x + 0.04, top, 0.04, iron);
      if (hi) GL.box(x - 0.06, top, -0.06, x + 0.06, top + 0.18, 0.06, gold);
    }
    G.box(-4.1, 0.9, -0.06, 4.1, 1.05, 0.06, iron);
    G.box(-4.1, 4.4, -0.06, 4.1, 4.55, 0.06, iron);
    GL.box(-0.7, 5.6, -0.12, 0.7, 7.0, 0.12, gold);
    if (hi) {
      for (let e = -70; e > gz + 15; e -= 22) for (const u of [-58, 58]) {
        const tx = f0.wx(u, e), tz = f0.wz(u, e);
        if (!T.buildingAt(tx, tz)) ctx.props.parkTree(ctx.boxes(tx, tz), tx, ctx.groundY(tx, tz), tz, hash2(u, e, 7), 0.9);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Akasaka Estate / palace grounds wall along Gaien-higashi-dori and Aoyama-dori
function buildEstateWall(ctx, T) {
  const { hi, wrap, fwd, idx, track, at, outer } = T;
  const [pcx, pcz] = ctx.project(...LL.palace);
  const lit = ctx.theme.night ? 'glow' : 'props';
  const ranges = [
    [wrap(idx(LL.yotsuya3) + 14), wrap(idx(LL.aoyama1) - 12)],
    [wrap(idx(LL.aoyama1) + 12), wrap(idx(LL.toyokawa) - 25)],
  ];
  for (const [ia, ib] of ranges) {
    const span = fwd(ia, ib);
    if (span > T.N / 2) continue;
    for (let k = 0; k + 2 <= span; k += 2) {
      const i = wrap(ia + k), j = wrap(i + 2);
      const s = (pcx - track.px[i]) * track.nx[i] + (pcz - track.pz[i]) * track.nz[i] > 0 ? 1 : -1; // toward the grounds
      const oi = outer(i, s) + 0.6, oj = outer(j, s) + 0.6;
      let ok = true;
      for (const [q, o] of [[i, oi], [j, oj]]) for (const d of [-0.4, 1.0, 5]) {
        const [x, z] = at(q, s, o + d);
        if (T.buildingAt(x, z) || T.inStreet(x, z, 1.0, T.tan(q)) || T.escape(x, z, 1.5)) ok = false;
      }
      if (!ok) continue;
      const A = at(i, s, oi), B = at(j, s, oj), L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (L < 0.5) continue;
      const rot = Math.atan2(B[0] - A[0], B[1] - A[1]); // local +z from A to B
      const y = ctx.groundY(A[0], A[1]);
      const w = frame(ctx.boxes(A[0], A[1], lit), A[0], y, A[1], rot);
      const p = frame(ctx.boxes(A[0], A[1]), A[0], y, A[1], rot);
      w.box(-0.3, -0.5, -0.02, 0.3, 1.45, L + 0.02, '#615b50');
      w.box(-0.38, 1.45, -0.04, 0.38, 1.65, L + 0.04, '#7f786a');
      p.box(-0.04, 2.45, 0, 0.04, 2.53, L, '#1e2124');
      if (hi) for (const z of [0.4, L / 2 + 0.4]) p.box(-0.04, 1.65, z - 0.04, 0.04, 2.6, z + 0.04, '#1e2124');
      if (k % 12 === 0) {
        w.box(-0.48, -0.5, -0.48, 0.48, 2.3, 0.48, '#7a7466');
        frame(ctx.boxes(A[0], A[1], 'glow'), A[0], y, A[1], rot).box(-0.22, 2.3, -0.22, 0.22, 2.78, 0.22, '#ffe0a0');
        p.box(-0.3, 2.78, -0.3, 0.3, 2.9, 0.3, '#2a2c2f');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Toyokawa Inari: lantern rack, nobori banners and a small torii on Aoyama-dori
function buildShrine(ctx, T) {
  const { hi, wrap, track, at, outer } = T;
  const [sx, sz] = ctx.project(...LL.toyokawa);
  const c = ctx.courseAt(sx, sz);
  if (c.dist > 90) return;
  const s = c.d > 0 ? 1 : -1, i0 = c.i;
  if (!T.free(s, i0 - 11, i0 + 11)) return;
  const red = '#b0201c';
  let n = 0;
  for (let k = -10; k < 10; k += 2) {
    const i = wrap(i0 + k), j = wrap(i + 2);
    const A = at(i, s, outer(i, s) - 0.35), B = at(j, s, outer(j, s) - 0.35);
    if (T.buildingAt(A[0], A[1]) || T.inStreet(A[0], A[1], 0.3, T.tan(i)) || T.escape(A[0], A[1], 1)) continue;
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]), rot = Math.atan2(B[0] - A[0], B[1] - A[1]);
    const y = T.walkY(i);
    const p = frame(ctx.boxes(A[0], A[1]), A[0], y, A[1], rot), g = frame(ctx.boxes(A[0], A[1], 'glow'), A[0], y, A[1], rot);
    p.box(-0.08, 0, -0.08, 0.08, 2.9, 0.08, red);
    p.box(-0.07, 2.65, 0, 0.07, 2.8, L, red);
    for (const z of [L * 0.3, L * 0.75]) {
      g.box(-0.22, 1.85, z - 0.22, 0.22, 2.45, z + 0.22, n++ % 2 ? '#fff0d0' : '#ff5a3a');
      if (hi) { p.box(-0.18, 2.45, z - 0.18, 0.18, 2.52, z + 0.18, '#1b1b1b'); p.box(-0.18, 1.78, z - 0.18, 0.18, 1.85, z + 0.18, '#1b1b1b'); }
    }
    if (hi) {
      // nobori banner on its own pole
      p.box(-0.03, 0, L * 0.5 - 0.03, 0.03, 3.3, L * 0.5 + 0.03, '#d8d2c4');
      p.box(-0.02, 0.6, L * 0.5 + 0.03, 0.02, 3.1, L * 0.5 + 0.6, '#c8231e');
      p.box(-0.025, 2.6, L * 0.5 + 0.03, 0.025, 2.75, L * 0.5 + 0.6, '#f4efe6');
    }
  }
  // torii at the entrance, just behind the sidewalk
  const o = outer(i0, s) + 1.6, [tx, tz] = at(i0, s, o);
  const ok = [-2.2, 0, 2.2].every((dz) => {
    const q = wrap(i0 + Math.round(dz / T.ds)), [x, z] = at(q, s, o);
    return !T.buildingAt(x, z) && !T.inStreet(x, z, 0.3, T.tan(q));
  });
  if (ok) {
    const rot = faceRot(-track.nx[i0] * s, -track.nz[i0] * s); // gateway faces the road
    const p = frame(ctx.boxes(tx, tz), tx, ctx.groundY(tx, tz), tz, rot);
    for (const zz of [-1.6, 1.6]) p.box(-0.2, -0.3, zz - 0.2, 0.2, 4.0, zz + 0.2, '#d1301f');
    p.box(-0.18, 3.25, -2.0, 0.18, 3.5, 2.0, '#d1301f');
    p.box(-0.3, 4.0, -2.5, 0.3, 4.3, 2.5, '#d1301f');
    p.box(-0.34, 4.3, -2.7, 0.34, 4.5, 2.7, '#1b1b1b');
    if (hi) p.box(-0.06, 3.5, -0.35, 0.06, 4.0, 0.35, '#1b1b1b');
  }
  T.claim(s, i0 - 11, i0 + 11);
}

// ---------------------------------------------------------------------------
// 9. Hotel New Otani: fictional rooftop sign on the tallest hotel tower
function buildHotelSign(ctx, T) {
  const [hx, hz] = ctx.project(...LL.otani);
  let best = null;
  for (const b of T.kept) {
    if (Math.hypot(b.cx - hx, b.cz - hz) > 220 || b.h < 40) continue;
    const named = /ニューオータニ/.test(b.name || '');
    const score = b.h + (named ? 200 : 0);
    if (!best || score > best.score) best = { b, score };
  }
  if (!best) return;
  const b = best.b, top = (b.base ?? ctx.groundY(b.cx, b.cz)) + b.h;
  const c = ctx.courseAt(b.cx, b.cz);
  let dx = T.track.px[c.i] - b.cx, dz = T.track.pz[c.i] - b.cz;
  const dl = Math.hypot(dx, dz) || 1;
  dx /= dl; dz /= dl;
  let e = 0;
  while (e < 120 && pipF(b.cx + dx * (e + 1), b.cz + dz * (e + 1), b.pts)) e += 1;
  const W = Math.max(10, Math.min(28, 2 * e)), H = W / 4;
  const mx = b.cx + dx * Math.max(0, e - 3), mz = b.cz + dz * Math.max(0, e - 3);
  const rot = faceRot(dx, dz);
  const p = frame(ctx.boxes(mx, mz), mx, top, mz, rot);
  for (let k = 0; k <= 4; k++) {
    const z = -W / 2 + 0.4 + (k * (W - 0.8)) / 4;
    p.box(-0.9, 0, z - 0.15, -0.6, 1.6 + H * 0.9, z + 0.15, '#2f3237');
  }
  p.box(-0.45, 1.4, -W / 2 - 0.1, -0.05, 1.6 + H + 0.1, W / 2 + 0.1, '#0c0f1c');
  T.signs.quad('B', 12, mx, top + 1.6, mz, dx, dz, W, H);
  T.signs.quad('B', 12, mx - dx * 0.5, top + 1.6, mz - dz * 0.5, -dx, -dz, W, H);
}

// ---------------------------------------------------------------------------
// 10. Red/white road-closure barricades across the side streets at the course
function buildBarricades(ctx, T) {
  const { hi } = T;
  for (const it of ctx.city.intersections) {
    const c0 = ctx.courseAt(it.x, it.z);
    if (c0.dist > 30) continue;
    const t = T.tan(c0.i);
    for (const d of it.dirs) {
      if (d.ped || Math.abs(d.dx * t[0] + d.dz * t[1]) > 0.75) continue;
      let s = 6, x = 0, z = 0;
      for (; s < 40; s += 1) {
        x = it.x + d.dx * s; z = it.z + d.dz * s;
        const c = ctx.courseAt(x, z), w = c.d > 0 ? c.wallL : c.wallR;
        if (Math.abs(c.d) > Math.max(w + 3.4, c.hw + 6.8)) break;
      }
      if (s >= 40) continue;
      s += 1.5; x = it.x + d.dx * s; z = it.z + d.dz * s;
      if (!T.inStreet(x, z) || T.escape(x, z, 2) || T.buildingAt(x, z)) continue;
      const span = Math.max(0, d.hw - 2.4); // keep clear of the kerbside parking lanes
      const cnt = Math.min(hi ? 4 : 3, Math.max(1, Math.floor((2 * span) / 2.0)));
      const rot = faceRot(-d.dx, -d.dz); // local +x toward the course, local z across the side street
      const y = ctx.groundY(x, z);
      const p = frame(ctx.boxes(x, z), x, y, z, rot), g = frame(ctx.boxes(x, z, 'glow'), x, y, z, rot);
      for (let q = 0; q < cnt; q++) {
        const zc = (q - (cnt - 1) / 2) * 2.0;
        for (const e of [-0.85, 0.85]) {
          p.box(-0.35, 0, zc + e - 0.05, 0.35, 0.06, zc + e + 0.05, '#2a2a2a');
          p.box(-0.04, 0, zc + e - 0.04, 0.04, 1.05, zc + e + 0.04, '#d9d9d9');
        }
        for (const [ya, yb] of [[0.78, 0.98], [0.38, 0.58]]) {
          if (hi) for (let m = 0; m < 4; m++) p.box(-0.05, ya, zc - 0.9 + m * 0.45, 0.05, yb, zc - 0.45 + m * 0.45, m % 2 ? '#f2f2f0' : '#d42a1e');
          else p.box(-0.05, ya, zc - 0.9, 0.05, yb, zc + 0.9, ya > 0.6 ? '#f2f2f0' : '#d42a1e');
        }
        if (hi && (q === 0 || q === cnt - 1)) g.box(-0.08, 1.05, zc - 0.08, 0.08, 1.2, zc + 0.08, '#ffb52e');
      }
    }
  }
}

// ---------------------------------------------------------------------------
export const ITEMS = [
  ['footbridges', buildFootbridges], ['shrine', buildShrine], ['konbini', buildKonbini], ['vending', buildVending],
  ['signs', buildSigns], ['hotelSign', buildHotelSign], ['estateWall', buildEstateWall], ['barricades', buildBarricades],
  ['palace', buildPalace], ['tokyoTower', buildTokyoTower],
];

// facade style mix: white/grey tile and concrete, dark glass for the towers, almost no brick
const MAT_STYLE = { 1: STYLE.glass, 2: STYLE.limestone, 3: STYLE.limestone, 4: STYLE.white, 5: STYLE.dark, 6: STYLE.white, 7: STYLE.limestone };

export default {
  id: 'tokyo',
  styleFor(b, k) {
    if (b.church) return STYLE.limestone;
    if (MAT_STYLE[b.mat] != null) return MAT_STYLE[b.mat];
    const r = hash2(k, 7, 46);
    if (b.h > 90) return r < 0.5 ? STYLE.dark : r < 0.88 ? STYLE.glass : STYLE.white;
    if (b.h > 35) return r < 0.32 ? STYLE.white : r < 0.55 ? STYLE.dark : r < 0.75 ? STYLE.glass : r < 0.98 ? STYLE.limestone : STYLE.brick;
    return r < 0.46 ? STYLE.white : r < 0.76 ? STYLE.limestone : r < 0.87 ? STYLE.dark : r < 0.98 ? STYLE.glass : STYLE.brick;
  },
  buildingOpts() {
    return { cornice: false }; // flat-topped concrete, no NYC cornices
  },
  prepare(ctx) {
    const [px, pz] = ctx.project(...LL.palace), [tx, tz] = ctx.project(...LL.tower);
    const c = Math.cos(PAL_ROT), s = Math.sin(PAL_ROT);
    ctx.removeBuildings((b) => {
      if (Math.hypot(b.cx - tx, b.cz - tz) < 60) return true; // OSM Tokyo Tower outline (skyline footprint)
      const dx = b.cx - px, dz = b.cz - pz;
      const u = dx * c - dz * s, e = dx * s + dz * c;
      return Math.abs(u) < PAL_HX + 3 && Math.abs(e) < PAL_HZ + 3; // Akasaka Palace main building
    });
  },
  build(ctx) {
    const T = setup(ctx);
    T.signs = makeSigns(ctx);
    for (const [, fn] of ITEMS) fn(ctx, T);
    T.signs.finish();
  },
};
