// Decodes the packed street-course data in cityData.generated.js (see
// tools/gen-cities.mjs) into plain objects for the city scene.
// Geometry streams are base64 Int16 in 0.5 m units; polygons and polylines
// are stored as an absolute first vertex followed by deltas.
import * as THREE from 'three';
import { CITY_DATA } from '../cityData.generated.js';

const Q = 2;

function int16(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Int16Array(u8.buffer);
}

// reads n delta-coded vertices starting at a[k]; returns [Float32Array, nextK]
function readPts(a, k, n) {
  const pts = new Float32Array(n * 2);
  let x = a[k], z = a[k + 1];
  pts[0] = x / Q; pts[1] = z / Q;
  k += 2;
  for (let j = 1; j < n; j++) {
    x += a[k]; z += a[k + 1]; k += 2;
    pts[j * 2] = x / Q; pts[j * 2 + 1] = z / Q;
  }
  return [pts, k];
}

function centroid(pts) {
  let cx = 0, cz = 0, A = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const x0 = pts[i * 2], z0 = pts[i * 2 + 1], x1 = pts[((i + 1) % n) * 2], z1 = pts[((i + 1) % n) * 2 + 1];
    const c = x0 * z1 - x1 * z0;
    A += c; cx += (x0 + x1) * c; cz += (z0 + z1) * c;
  }
  if (Math.abs(A) < 1e-6) return [pts[0], pts[1], 0];
  return [cx / (3 * A), cz / (3 * A), Math.abs(A / 2)];
}

const cache = new Map();

export function decodeCity(id) {
  if (cache.has(id)) return cache.get(id);
  const d = CITY_DATA[id];
  const out = { id, origin: d.origin, bounds: d.bounds, buildings: [], streets: [], areas: [], pois: [], intersections: [] };

  const names = new Map(d.buildings.names);
  let a = int16(d.buildings.data);
  for (let k = 0, idx = 0; k < a.length; idx++) {
    const n = a[k], h = a[k + 1] / Q, minH = a[k + 2] / Q, mat = a[k + 3], col = a[k + 4], flags = a[k + 5];
    let pts;
    [pts, k] = readPts(a, k + 6, n);
    const [cx, cz, area] = centroid(pts);
    let colour = null;
    if (col >= 0) colour = new THREE.Color(((col >> 10) & 31) / 31, ((col >> 5) & 31) / 31, (col & 31) / 31);
    out.buildings.push({
      pts, h, minH, mat, colour, cx, cz, area,
      part: !!(flags & 1), roof: !!(flags & 2), far: !!(flags & 4), church: !!(flags & 8),
      name: names.get(idx) || '',
    });
  }

  a = int16(d.streets.data);
  for (let k = 0; k < a.length;) {
    const n = a[k], w = a[k + 1] / Q, f = a[k + 2];
    let pts;
    [pts, k] = readPts(a, k + 3, n);
    out.streets.push({ pts, w, kind: f & 3, course: !!(f & 4), layer: (f >> 3) & 7 });
  }

  a = int16(d.areas.data);
  for (let k = 0; k < a.length;) {
    const n = a[k], kind = a[k + 1];
    let pts;
    [pts, k] = readPts(a, k + 2, n);
    out.areas.push({ pts, kind });
  }

  a = int16(d.pois.data);
  for (let k = 0; k < a.length; k += 3) out.pois.push({ kind: a[k], x: a[k + 1] / Q, z: a[k + 2] / Q });

  for (const it of d.intersections) {
    const dirs = [];
    for (let k = 2; k < it.length; k += 4) dirs.push({ dx: it[k], dz: it[k + 1], hw: it[k + 2], ped: !!it[k + 3] });
    out.intersections.push({ x: it[0], z: it[1], dirs });
  }

  // DEM: decimetres relative to the start line, row-major from the SW corner
  const dem = d.dem, dv = int16(dem.data);
  const { lat: lat0, lon: lon0, kx, ky } = d.origin;
  out.project = (lat, lon) => [(lon - lon0) * kx, -(lat - lat0) * ky];
  out.demAt = (x, z) => {
    const lon = lon0 + x / kx, lat = lat0 - z / ky;
    const fx = Math.min(Math.max(((lon - dem.bbox[1]) / (dem.bbox[3] - dem.bbox[1])) * (dem.nx - 1), 0), dem.nx - 1.001);
    const fy = Math.min(Math.max(((lat - dem.bbox[0]) / (dem.bbox[2] - dem.bbox[0])) * (dem.ny - 1), 0), dem.ny - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const g = (p, q) => dv[q * dem.nx + p] / 10;
    return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v;
  };
  cache.set(id, out);
  return out;
}
