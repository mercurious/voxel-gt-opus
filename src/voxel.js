// Voxel meshing utilities.
//  - VoxelGrid + meshGrid(): culled-face mesher with per-vertex ambient
//    occlusion, one BufferGeometry per material group (cars, wheels, props).
//  - BoxBuilder: merges many oriented boxes into one geometry (scenery).
import * as THREE from 'three';

const _c = new THREE.Color();

export class VoxelGrid {
  constructor(nx, ny, nz) {
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.data = new Uint16Array(nx * ny * nz); // 0 = empty, else palette index + 1
  }
  idx(x, y, z) { return x + this.nx * (y + this.ny * z); }
  inside(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz; }
  get(x, y, z) { return this.inside(x, y, z) ? this.data[this.idx(x, y, z)] : 0; }
  set(x, y, z, v) { if (this.inside(x, y, z)) this.data[this.idx(x, y, z)] = v; }
}

// Palette: [{color: '#hex' | THREE.Color, group: 0..}]
const FACES = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], shade: 0.86 },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], shade: 0.86 },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0], shade: 1.0 },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], shade: 0.55 },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], shade: 0.93 },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0], shade: 0.93 },
];
const AO = [0.5, 0.68, 0.84, 1.0];

/**
 * @param grid VoxelGrid
 * @param palette array of {color, group}
 * @param opts {scale, offset:[x,y,z], groups:number}
 * @returns array of BufferGeometry (index = group), entries may be null
 */
export function meshGrid(grid, palette, opts = {}) {
  const s = opts.scale ?? 1;
  const off = opts.offset ?? [0, 0, 0];
  const nGroups = opts.groups ?? 1;
  const out = [];
  for (let g = 0; g < nGroups; g++) out.push({ pos: [], nor: [], col: [], idx: [] });
  const cols = palette.map((p) => {
    _c.set(p.color);
    return [_c.r, _c.g, _c.b];
  });
  const solid = (x, y, z) => grid.get(x, y, z) !== 0;
  const { nx, ny, nz } = grid;
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const v = grid.data[x + nx * (y + ny * z)];
        if (!v) continue;
        const pal = palette[v - 1];
        const g = out[pal.group || 0];
        const base = cols[v - 1];
        for (const f of FACES) {
          const [dx, dy, dz] = f.n;
          if (solid(x + dx, y + dy, z + dz)) continue;
          // face center on the voxel boundary
          const cx = x + 0.5 + dx * 0.5, cy = y + 0.5 + dy * 0.5, cz = z + 0.5 + dz * 0.5;
          const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
          const ao = [];
          const vi = g.pos.length / 3;
          for (const [su, sv] of corners) {
            const px = cx + (f.u[0] * su + f.v[0] * sv) * 0.5;
            const py = cy + (f.u[1] * su + f.v[1] * sv) * 0.5;
            const pz = cz + (f.u[2] * su + f.v[2] * sv) * 0.5;
            g.pos.push((px + off[0]) * s, (py + off[1]) * s, (pz + off[2]) * s);
            g.nor.push(dx, dy, dz);
            const ox = x + dx, oy = y + dy, oz = z + dz;
            const s1 = solid(ox + f.u[0] * su, oy + f.u[1] * su, oz + f.u[2] * su) ? 1 : 0;
            const s2 = solid(ox + f.v[0] * sv, oy + f.v[1] * sv, oz + f.v[2] * sv) ? 1 : 0;
            const cr = solid(ox + f.u[0] * su + f.v[0] * sv, oy + f.u[1] * su + f.v[1] * sv, oz + f.u[2] * su + f.v[2] * sv) ? 1 : 0;
            const a = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
            ao.push(a);
            const k = AO[a] * (opts.faceShade === false ? 1 : 0.15 + 0.85 * f.shade);
            g.col.push(base[0] * k, base[1] * k, base[2] * k);
          }
          // check winding: (u x v) should equal n for CCW front faces
          const cxp = f.u[1] * f.v[2] - f.u[2] * f.v[1], cyp = f.u[2] * f.v[0] - f.u[0] * f.v[2], czp = f.u[0] * f.v[1] - f.u[1] * f.v[0];
          const ccw = cxp * dx + cyp * dy + czp * dz > 0;
          const flip = ao[0] + ao[2] < ao[1] + ao[3];
          let tri = flip ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3];
          if (!ccw) tri = [tri[0], tri[2], tri[1], tri[3], tri[5], tri[4]];
          for (const t of tri) g.idx.push(vi + t);
        }
      }
  return out.map((g) => {
    if (!g.idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
    geo.setIndex(g.idx);
    geo.computeBoundingSphere();
    return geo;
  });
}

// ---------------------------------------------------------------------------
// BoxBuilder: axis-aligned boxes in a local frame, optionally rotated about Y
// and translated, merged into one indexed geometry with vertex colors.
export class BoxBuilder {
  constructor() {
    this.pos = []; this.nor = []; this.col = []; this.idx = [];
  }
  get count() { return this.idx.length / 3; }

  /**
   * Box spanning [x0,x1]x[y0,y1]x[z0,z1] in local coords, colour hex/Color,
   * placed with rotation `rot` (about Y) and translation (tx,ty,tz).
   * opts.skipBottom, opts.shade (top/side multipliers)
   */
  box(x0, y0, z0, x1, y1, z1, color, rot = 0, tx = 0, ty = 0, tz = 0, opts = {}) {
    _c.set(color);
    const r = _c.r, g = _c.g, b = _c.b;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const T = (x, y, z) => [x * cs + z * sn + tx, y + ty, -x * sn + z * cs + tz];
    const N = (x, y, z) => [x * cs + z * sn, y, -x * sn + z * cs];
    const faces = [
      // normal, 4 corners (CCW seen from outside)
      [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], 0.85],
      [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], 0.85],
      [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], 1.0],
      [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], 0.6],
      [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 0.93],
      [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], 0.93],
    ];
    for (let fi = 0; fi < 6; fi++) {
      if (fi === 3 && opts.skipBottom) continue;
      if (fi === 2 && opts.skipTop) continue;
      const [n, cs4, sh] = faces[fi];
      const k = opts.flat ? 1 : 0.2 + 0.8 * sh;
      const tint = opts.topColor && fi === 2 ? new THREE.Color(opts.topColor) : null;
      const vi = this.pos.length / 3;
      const nn = N(...n);
      for (const c of cs4) {
        this.pos.push(...T(...c));
        this.nor.push(...nn);
        if (tint) this.col.push(tint.r, tint.g, tint.b);
        else this.col.push(r * k, g * k, b * k);
      }
      this.idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    }
  }

  // Generic quad (4 world-space points, CCW from the visible side).
  quad(p0, p1, p2, p3, color, normal) {
    _c.set(color);
    const vi = this.pos.length / 3;
    for (const p of [p0, p1, p2, p3]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(normal[0], normal[1], normal[2]);
      this.col.push(_c.r, _c.g, _c.b);
    }
    this.idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  }

  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.pos.length / 3 > 65535) geo.setIndex(new THREE.Uint32BufferAttribute(this.idx, 1));
    else geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    return geo;
  }
}
