// Ground height around a street course, shared by the city scene (terrain,
// side streets, escape roads, barriers, buildings, props) and the tests: the
// real elevation (city DEM), pulled onto the course height near the course.
// Escape roads lie at the height the car drives at there (the course height,
// track.locate().y), easing back into the terrain beyond their walls, so the
// road, its barriers and the car always agree. groundMesh() is the paved
// ground drawn under all of it. No three.js: runs headless.
import { smoothstep, lerp } from '../util.js';

const ESC_BLEND = 20; // m beyond an escape road's walls back to the terrain
const PULL0 = 25, PULL1 = 110; // m from the course: on its height, back on the terrain
const SEAM = 20; // m: easing between stretches of course that pull to different heights

export function courseGround(track, demAt) {
  const { N, px, pz, py } = track;
  const SC = 24;
  const grid = new Map();
  const key = (a, b) => a * 73856093 ^ b * 19349663;
  for (let i = 0; i < N; i++) {
    const k = key(Math.floor(px[i] / SC), Math.floor(pz[i] / SC));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  // nearest course sample within r metres, or -1
  const nearest = (x, z, r) => {
    let best = -1, bd = r * r;
    const c0 = Math.floor((x - r) / SC), c1 = Math.floor((x + r) / SC), d0 = Math.floor((z - r) / SC), d1 = Math.floor((z + r) / SC);
    for (let a = c0; a <= c1; a++) for (let b = d0; b <= d1; b++) {
      const cell = grid.get(key(a, b));
      if (cell) for (const i of cell) { const d = (px[i] - x) ** 2 + (pz[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    }
    return best;
  };
  // 1 on an escape road, easing to 0 ESC_BLEND m beyond its walls and end
  const escapeWeight = (x, z) => {
    let w = 0;
    for (const e of track.escapes) {
      const rx = x - e.x, rz = z - e.z;
      const along = rx * e.dx + rz * e.dz, lat = rx * e.nx + rz * e.nz;
      const d = Math.hypot(Math.max(0, -along, along - e.len), Math.max(0, Math.abs(lat) - e.hw));
      w = Math.max(w, 1 - smoothstep(1, ESC_BLEND, d));
    }
    return w;
  };
  // Near the course the ground is pulled from the terrain onto the course's
  // height: by its offset from the terrain (off) at the nearest samples, fully
  // within PULL0 m, fading out by PULL1 m. Where two stretches of the course
  // pass near each other (either side of a corner, a block apart) at
  // different offsets, taking the nearest sample's alone would leave a cliff
  // where the nearest one switches stretch; instead every sample within SEAM
  // m of the nearest distance counts, fading with the excess, so the ground
  // eases from one to the other across the seam.
  const off = new Float32Array(N);
  for (let i = 0; i < N; i++) off[i] = py[i] - demAt(px[i], pz[i]);
  const cand = [], cd = [];
  const groundY = (x, z) => {
    let y = demAt(x, z);
    const r = PULL1 + SEAM;
    let dmin = Infinity, n = 0, hint = -1;
    const c0 = Math.floor((x - r) / SC), c1 = Math.floor((x + r) / SC), d0 = Math.floor((z - r) / SC), d1 = Math.floor((z + r) / SC);
    for (let a = c0; a <= c1; a++) for (let b = d0; b <= d1; b++) {
      const cell = grid.get(key(a, b));
      if (cell) for (const i of cell) {
        const d = Math.hypot(px[i] - x, pz[i] - z);
        if (d >= r) continue;
        cand[n] = i; cd[n++] = d;
        if (d < dmin) { dmin = d; hint = i; }
      }
    }
    if (dmin >= PULL1) return y;
    let sw = 0, so = 0;
    for (let k = 0; k < n; k++) {
      const w = 1 - smoothstep(0, SEAM, cd[k] - dmin);
      sw += w; so += w * off[cand[k]];
    }
    y += (so / sw) * (1 - smoothstep(PULL0, PULL1, dmin));
    const w = escapeWeight(x, z);
    return w > 0 ? lerp(y, track.locate(x, z, hint).y, w) : y;
  };
  return { nearest, groundY };
}

// The paved ground between the streets: a grid of 40 m cells over the city
// and a wide margin, groundY less 0.9 m within 30 m of the course (under the
// road) and 0.3 m elsewhere (under the side streets and plazas, drawn on
// groundY). Two triangles per cell can't follow groundY where it bends inside
// a cell, as it does where the course runs metres below the terrain and the
// ground climbs from the course height back to it, or beside an escape road:
// they cut through the road there, or sink under the streets on the slope and
// leave them floating. Those cells are split into 2x2, 4x4 or 8x8 (5 m)
// squares until within ~0.12 m of groundY. An edge shared by cells split
// differently only bends at the coarser cell's vertices (the finer cell's
// extra ones lie on its straight segments), so there are no cracks.
// shade(i, j, x, z) gives the colour [r, g, b] of grid corner (i, j) at (x, z);
// split cells blend their corners' colours.
// Returns flat position, colour and index arrays.
export function groundMesh(bounds, { nearest, groundY }, shade) {
  const [bx0, bz0, bx1, bz1] = bounds;
  const M = 1300, C = 40, F = 8; // margin, cell size, finest split
  const x0 = bx0 - M, z0 = bz0 - M, nxg = Math.ceil((bx1 - bx0 + 2 * M) / C), nzg = Math.ceil((bz1 - bz0 + 2 * M) / C);
  const h = (x, z) => groundY(x, z) - (nearest(x, z, 30) >= 0 ? 0.9 : 0.3);
  // split per cell, from how far groundY strays from the cell's two triangles
  // (beyond the course's reach groundY is the smooth DEM)
  const S = new Uint8Array(nxg * nzg).fill(1);
  const L = 5;
  for (let j = 0; j < nzg; j++) for (let i = 0; i < nxg; i++) {
    const cx = x0 + i * C, cz = z0 + j * C;
    if (nearest(cx + C / 2, cz + C / 2, 140) < 0) continue;
    const A = groundY(cx, cz), B = groundY(cx + C, cz), D = groundY(cx, cz + C), E = groundY(cx + C, cz + C);
    let dev = 0;
    for (let b = 0; b <= L; b++) for (let a = 0; a <= L; a++) {
      const u = a / L, w = b / L;
      const lin = u + w <= 1 ? A + (B - A) * u + (D - A) * w : E + (D - E) * (1 - u) + (B - E) * (1 - w);
      dev = Math.max(dev, Math.abs(groundY(cx + u * C, cz + w * C) - lin));
    }
    // the error of a linear fit falls with the square of the split
    S[j * nxg + i] = dev <= 0.25 ? 1 : dev <= 0.12 * 4 ? 2 : dev <= 0.12 * 16 ? 4 : 8;
  }
  const split = (i, j) => (i < 0 || j < 0 || i >= nxg || j >= nzg ? 1 : S[j * nxg + i]);
  // height of lattice vertex (I, J), in 5 m steps from (x0, z0)
  const hv = (I, J) => {
    const x = x0 + (I * C) / F, z = z0 + (J * C) / F;
    const onX = I % F === 0, onZ = J % F === 0;
    if (!onX && !onZ) return h(x, z);
    let st, r;
    if (onX && onZ) st = F, r = 0; // cell corner
    else if (onX) { const j = Math.floor(J / F); st = F / Math.min(split(I / F - 1, j), split(I / F, j)); r = J % st; }
    else { const i = Math.floor(I / F); st = F / Math.min(split(i, J / F - 1), split(i, J / F)); r = I % st; }
    if (r === 0) return h(x, z);
    return onX ? lerp(hv(I, J - r), hv(I, J - r + st), r / st) : lerp(hv(I - r, J), hv(I - r + st, J), r / st);
  };
  const corner = new Map();
  const cc = (i, j) => {
    const k = i * 65536 + j;
    let c = corner.get(k);
    if (!c) corner.set(k, (c = shade(i, j, x0 + i * C, z0 + j * C)));
    return c;
  };
  const pos = [], col = [], idx = [], vid = new Map();
  const v = (I, J) => {
    const k = I * 1048576 + J;
    let n = vid.get(k);
    if (n === undefined) {
      n = pos.length / 3;
      vid.set(k, n);
      pos.push(x0 + (I * C) / F, hv(I, J), z0 + (J * C) / F);
      const i = Math.floor(I / F), j = Math.floor(J / F), u = (I % F) / F, w = (J % F) / F;
      const a = cc(i, j), b = u ? cc(i + 1, j) : a, d = w ? cc(i, j + 1) : a, e = u && w ? cc(i + 1, j + 1) : a;
      for (let q = 0; q < 3; q++) col.push((a[q] * (1 - u) + b[q] * u) * (1 - w) + (d[q] * (1 - u) + e[q] * u) * w);
    }
    return n;
  };
  for (let j = 0; j < nzg; j++) for (let i = 0; i < nxg; i++) {
    const st = F / S[j * nxg + i];
    for (let J = j * F; J < (j + 1) * F; J += st) for (let I = i * F; I < (i + 1) * F; I += st) {
      const a = v(I, J), b = v(I + st, J), d = v(I, J + st), e = v(I + st, J + st);
      idx.push(a, d, b, b, d, e);
    }
  }
  return { pos, col, idx };
}
