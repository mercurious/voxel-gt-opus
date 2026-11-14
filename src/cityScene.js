// Builds the rendered world for a city street course from OpenStreetMap data
// (see tools/gen-cities.mjs, src/city/cityData.js): ground following the real
// elevation, streets and plazas, parks and water, the course road with
// markings, kerbs and sidewalks, concrete barriers with catch fences and
// sponsor banners, escape roads, extruded buildings with window facades,
// street furniture from OSM points, and a per-city module (src/city/<id>.js)
// for landmarks. Same interface as buildTrackScene().
import * as THREE from 'three';
import { BoxBuilder } from './voxel.js';
import { hash2, rng } from './util.js';
import { escapeAt } from './trackCore.js';
import {
  lambert, pick, SPONSORS, textTexture, buildSkyAndLights, addStartGrid, buildGantry,
  buildBrakeBoards, buildClouds, makeDrivingLine,
} from './sceneCommon.js';
import { decodeCity } from './city/cityData.js';
import { makeFacadeMaterial, FacadeBuilder, addBuilding, styleFor, STYLE } from './city/buildings.js';
import * as props from './city/props.js';
import { CITY_MODULES } from './city/index.js';
import { courseGround, groundMesh } from './city/ground.js';

const CH = 200; // scenery chunk size (m), for frustum + shadow culling
const SIDEWALK = 4.5;
const KERB_H = 0.15;
const faceRot = (dx, dz) => Math.atan2(-dz, dx); // BoxBuilder rot whose local +x points along (dx, dz)

export function buildCityScene(track, opts = {}) {
  const def = track.def, th = def.theme;
  const quality = opts.quality || 'high';
  const hi = quality === 'high';
  const group = new THREE.Group();
  const disposables = [];
  const animated = [];
  const keep = (o) => { disposables.push(o); return o; };
  const { N, ds, px, pz, py, nx, nz, tx, tz } = track;
  const city = decodeCity(def.city);
  const mod = CITY_MODULES[def.city] || {};
  const style = def.city;

  const env = buildSkyAndLights(group, def, hi, keep);
  // night: a star field riding on the sky dome, and pools of light under the lamps
  const pools = [];
  if (th.night) {
    const R = rng(97), sp = [];
    for (let k = 0; k < 1400; k++) {
      const u = R() * Math.PI * 2, v = 0.06 + R() * 0.94;
      const r = Math.sqrt(1 - v * v) * 8500;
      sp.push(Math.cos(u) * r, v * 8500, Math.sin(u) * r);
    }
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    env.sky.add(new THREE.Points(g, keep(new THREE.PointsMaterial({ color: '#dfe8ff', size: 1.6, sizeAttenuation: false, fog: false, depthWrite: false }))));
  }
  // the sun disc doubles as the moon: smaller and pale
  if (th.moon) { env.sun.scale.setScalar(0.32); env.sun.material.color.set('#f2f0e4'); }

  // ---- course lookups ---------------------------------------------------------
  // nearest(x, z, r): nearest course sample within r metres, or -1;
  // groundY(x, z): ground / sidewalk level (city/ground.js)
  const { nearest, groundY } = courseGround(track, city.demAt);
  const courseAt = (x, z) => {
    let i = nearest(x, z, 160);
    if (i < 0) i = track.locate(x, z).i;
    const d = (x - px[i]) * nx[i] + (z - pz[i]) * nz[i];
    return { i, d, dist: Math.hypot(x - px[i], z - pz[i]), wallL: track.wallL[i], wallR: track.wallR[i], hw: track.hw[i], heading: Math.atan2(tx[i], tz[i]) };
  };
  // on the course's road (out to its barrier line) or an escape road, plus margin?
  const onRoad = (x, z, margin = 0) => {
    const i = nearest(x, z, 40);
    if (i < 0) return false;
    const rx = x - px[i], rz = z - pz[i];
    const along = rx * tx[i] + rz * tz[i], d = rx * nx[i] + rz * nz[i];
    return Math.abs(along) <= ds * 1.5 && d <= track.roadL[i] + margin && -d <= track.roadR[i] + margin;
  };
  const inCourse = (x, z, margin = 0) => onRoad(x, z, margin) || !!escapeAt(track, x, z, margin);

  // ---- scenery chunks ----------------------------------------------------------
  const chunks = new Map();
  const CHQ = hi ? CH : CH * 1.6; // fewer, bigger chunks (draw calls) on low
  const chunk = (x, z, size = CHQ) => {
    const a = Math.floor(x / size), b = Math.floor(z / size), k = `${a},${b},${size}`;
    let c = chunks.get(k);
    if (!c) chunks.set(k, (c = { props: new BoxBuilder(), deco: new BoxBuilder(), glow: new BoxBuilder(), fac: new FacadeBuilder() }));
    return c;
  };
  const boxes = (x, z, layer = 'props') => chunk(x, z)[layer];

  // street rectangles (for sidewalk gaps at cross streets)
  const skey = (a, b) => a * 73856093 ^ b * 19349663;
  const streetSegs = [];
  const stGrid = new Map();
  for (const s of city.streets) {
    if (s.kind >= 2) continue; // service lanes and viaducts never cut the sidewalks
    const p = s.pts;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5) continue;
      const si = streetSegs.length;
      streetSegs.push({ ax, az, ux: (bx - ax) / L, uz: (bz - az) / L, L, h: s.w / 2, kind: s.kind });
      for (let t = 0; t <= L + 30; t += 30) {
        const q = Math.min(t, L);
        const kk = skey(Math.floor((ax + streetSegs[si].ux * q) / 40), Math.floor((az + streetSegs[si].uz * q) / 40));
        if (!stGrid.has(kk)) stGrid.set(kk, new Set());
        stGrid.get(kk).add(si);
      }
    }
  }
  const inStreet = (x, z, pad = 0) => {
    const c0 = Math.floor(x / 40), d0 = Math.floor(z / 40);
    for (let a = c0 - 1; a <= c0 + 1; a++) for (let b = d0 - 1; b <= d0 + 1; b++) {
      const cell = stGrid.get(skey(a, b));
      if (!cell) continue;
      for (const si of cell) {
        const s = streetSegs[si];
        const rx = x - s.ax, rz = z - s.az;
        const al = rx * s.ux + rz * s.uz, lat = rz * s.ux - rx * s.uz;
        if (al >= -s.h && al <= s.L + s.h && Math.abs(lat) <= s.h + pad) return true;
      }
    }
    return false;
  };

  // ---- materials -------------------------------------------------------------------
  const roadMat = keep(lambert());
  const propsMat = keep(lambert());
  const glowMat = keep(new THREE.MeshBasicMaterial({ vertexColors: true }));
  const facadeMat = keep(makeFacadeMaterial(th, keep));
  const sideMat = keep(lambert({ polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
  const asphalt = th.asphalt, walk = th.sidewalk || ['#b9b3a8'];
  // pavement between streets (plazas, lots, the city beyond the data) and street paint
  const pave = th.ground || walk, plaza = th.plaza || pave;
  const paint = th.night ? '#cfcfc8' : '#e8e6df', centreLine = th.centreLine || paint;

  // ---- ground: one draped grid (concrete), lowered under the course (city/ground.js) ----
  {
    const [bx0, bz0, bx1, bz1] = city.bounds;
    const c = new THREE.Color();
    const shade = (i, j, x, z) => {
      c.set(pick(pave, hash2(i, j, 4))).multiplyScalar(x > bx0 && x < bx1 && z > bz0 && z < bz1 ? 0.92 : 0.78);
      return [c.r, c.g, c.b];
    };
    const { pos, col, idx } = groundMesh(city.bounds, { nearest, groundY }, shade);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(keep(g), roadMat);
    m.receiveShadow = true;
    group.add(m);
  }

  // ---- parks, water, plazas (subdivided so they drape over the DEM) -----------------
  const drape = (pts, color, lift, b, maxEdge = 18) => {
    const n = pts.length / 2;
    const contour = [];
    for (let k = 0; k < n; k++) contour.push(new THREE.Vector2(pts[k * 2], pts[k * 2 + 1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const out = [];
    const split = (a, bb, c, depth) => {
      const lab = Math.hypot(a[0] - bb[0], a[1] - bb[1]), lbc = Math.hypot(bb[0] - c[0], bb[1] - c[1]), lca = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const m = Math.max(lab, lbc, lca);
      // finer near the course so the dip under the road (see below) stays tight
      const lim = maxEdge > 7 && nearest((a[0] + bb[0] + c[0]) / 3, (a[1] + bb[1] + c[1]) / 3, 30) >= 0 ? 6 : maxEdge;
      if (m <= lim || depth > 12) { out.push(a, bb, c); return; }
      if (m === lab) { const q = [(a[0] + bb[0]) / 2, (a[1] + bb[1]) / 2]; split(a, q, c, depth + 1); split(q, bb, c, depth + 1); }
      else if (m === lbc) { const q = [(bb[0] + c[0]) / 2, (bb[1] + c[1]) / 2]; split(a, bb, q, depth + 1); split(a, q, c, depth + 1); }
      else { const q = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2]; split(a, bb, q, depth + 1); split(q, bb, c, depth + 1); }
    };
    for (const [a, bb, c] of tris) split([pts[a * 2], pts[a * 2 + 1]], [pts[bb * 2], pts[bb * 2 + 1]], [pts[c * 2], pts[c * 2 + 1]], 0);
    for (let k = 0; k < out.length; k += 3) {
      // areas never cover the course: vertices inside the barriers dip under the road
      const P = [out[k], out[k + 1], out[k + 2]].map(([x, z]) => [x, (typeof lift === 'function' ? lift(x, z) : groundY(x, z) + (inCourse(x, z, 0.8) ? -0.6 : lift)), z]);
      // up-facing winding
      const cr = (P[1][0] - P[0][0]) * (P[2][2] - P[0][2]) - (P[1][2] - P[0][2]) * (P[2][0] - P[0][0]);
      const col = typeof color === 'function' ? color(P[0][0], P[0][2]) : color;
      if (cr < 0) b.tri(P[0], P[1], P[2], col, [0, 1, 0]);
      else b.tri(P[0], P[2], P[1], col, [0, 1, 0]);
    }
  };
  const grassB = new BoxBuilder();
  const parkPolys = [];
  for (const a of city.areas) {
    if (a.kind === 1) {
      // water sits a little below the surrounding ground, with a stone rim
      let minY = Infinity;
      for (let k = 0; k < a.pts.length; k += 2) minY = Math.min(minY, groundY(a.pts[k], a.pts[k + 1]));
      drape(a.pts, '#4d7d98', () => minY - 0.25, grassB, 60);
    } else if (a.kind === 2) {
      drape(a.pts, (x, z) => pick(plaza, hash2(Math.floor(x / 3), Math.floor(z / 3), 5)), 0.04, grassB);
    } else {
      const g = th.grass;
      drape(a.pts, (x, z) => pick(g, hash2(Math.floor(x / 6), Math.floor(z / 6), 2)), a.kind === 3 ? 0.06 : 0.05, grassB);
      parkPolys.push(a);
    }
  }

  // ---- side streets (everything outside the course barriers) --------------------------
  // asphalt ribbons with simple paint near the course: dashed centre line, zebra
  // crossings at the street ends; viaducts (kind 3) are built further down
  const streetB = new BoxBuilder(), markB = new BoxBuilder();
  const flatQuad = (b, cx, cz, ux, uz, a0, a1, w0, w1, y, col) => {
    // rectangle along (ux, uz) from a0..a1, across from w0..w1, CCW from above
    const P = (a, w) => [cx + ux * a - uz * w, y, cz + uz * a + ux * w];
    b.quad(P(a0, w1), P(a1, w1), P(a1, w0), P(a0, w0), col, [0, 1, 0]);
  };
  for (const s of city.streets) {
    if (s.kind === 3) continue;
    const p = s.pts;
    const col = s.kind === 0 ? pick(asphalt, hash2(p.length, Math.floor(p[0]), 7)) : s.kind === 1 ? pick(plaza, 0.5) : asphalt[0];
    const h = s.w / 2;
    const marked = s.kind === 0 && s.w >= 7.5;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.2) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, qx = -uz * h, qz = ux * h;
      const steps = Math.max(1, Math.ceil(L / 8));
      for (let t = 0; t < steps; t++) {
        const s0 = (t / steps) * L - (t === 0 ? h * 0.7 : 0), s1 = ((t + 1) / steps) * L + (t === steps - 1 ? h * 0.7 : 0);
        const mx = ax + ux * (s0 + s1) / 2, mz = az + uz * (s0 + s1) / 2;
        if (inCourse(mx, mz, 0.4)) continue;
        const cx0 = ax + ux * s0, cz0 = az + uz * s0, cx1 = ax + ux * s1, cz1 = az + uz * s1;
        const y0 = groundY(cx0, cz0) + (inCourse(cx0, cz0, 0.3) ? -0.5 : 0.02), y1 = groundY(cx1, cz1) + (inCourse(cx1, cz1, 0.3) ? -0.5 : 0.02);
        streetB.quad([cx0 + qx, y0, cz0 + qz], [cx0 - qx, y0, cz0 - qz], [cx1 - qx, y1, cz1 - qz], [cx1 + qx, y1, cz1 + qz], col, [0, 1, 0]);
        // dashed centre line (3 m of paint per 8 m piece), only near the course
        if (marked && nearest(mx, mz, 150) >= 0 && !inCourse(mx, mz, 3)) flatQuad(markB, mx, mz, ux, uz, -1.5, 1.5, -0.08, 0.08, groundY(mx, mz) + 0.05, centreLine);
      }
    }
    // zebra crossing + stop line where a marked street ends near the course (its junctions)
    if (marked) {
      const n = p.length / 2;
      for (const k of [0, n - 1]) {
        const ex = p[k * 2], ez = p[k * 2 + 1], o = k === 0 ? 1 : n - 2;
        if (nearest(ex, ez, 150) < 0) continue;
        let ux = p[o * 2] - ex, uz = p[o * 2 + 1] - ez;
        const L = Math.hypot(ux, uz);
        if (L < 12) continue;
        ux /= L; uz /= L;
        const a = 4 + h * 0.6, cx = ex + ux * a, cz = ez + uz * a;
        if (inCourse(cx, cz, 2)) continue;
        const y = groundY(cx, cz) + 0.05;
        for (let w = -h + 0.6; w < h - 0.4; w += 1.2) flatQuad(markB, cx, cz, ux, uz, -1.6, 1.6, w, w + 0.6, y, paint);
        flatQuad(markB, cx, cz, ux, uz, 2.4, 2.8, -h + 0.3, 0, y, paint);
      }
    }
  }
  {
    const m = new THREE.Mesh(keep(grassB.build()), sideMat);
    m.receiveShadow = true;
    group.add(m);
    const m2 = new THREE.Mesh(keep(streetB.build()), sideMat);
    m2.receiveShadow = true;
    m2.renderOrder = 1;
    group.add(m2);
    const m3 = new THREE.Mesh(keep(markB.build()), sideMat);
    m3.renderOrder = 2;
    group.add(m3);
  }

  // ---- elevated expressways (OSM motorway bridges): deck, parapets, piers, lamps ----
  for (const s of city.streets) {
    if (s.kind !== 3) continue;
    const p = s.pts, h = s.w / 2, H = 8.5 + 3 * (Math.max(1, s.layer) - 1);
    let run = 0;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, rot = Math.atan2(ux, uz);
      const steps = Math.max(1, Math.ceil(L / 10));
      for (let t = 0; t < steps; t++) {
        const s0 = (t / steps) * L, s1 = ((t + 1) / steps) * L, len = s1 - s0 + 0.06;
        const mx = ax + ux * (s0 + s1) / 2, mz = az + uz * (s0 + s1) / 2;
        const gy = groundY(mx, mz), y = gy + H;
        const b = boxes(mx, mz), g = boxes(mx, mz, 'glow');
        b.box(-h, y - 1.4, -len / 2, h, y, len / 2, '#85888c', rot, mx, 0, mz, { topColor: asphalt[1] });
        for (const sd of [-1, 1]) b.box(sd > 0 ? h - 0.35 : -h, y, -len / 2, sd > 0 ? h : -h + 0.35, y + 1.2, len / 2, '#9a9da1', rot, mx, 0, mz);
        if (Math.floor((run + s1 - s0) / 32) !== Math.floor(run / 32)) {
          // T-pier: column + cap beam
          b.box(-1.1, gy - 0.5, -1.1, 1.1, y - 1.4, 1.1, '#7d8084', rot, mx, 0, mz);
          b.box(-h + 0.5, y - 2.6, -1.2, h - 0.5, y - 1.4, 1.2, '#7d8084', rot, mx, 0, mz);
        }
        if (Math.floor((run + s1 - s0) / 40) !== Math.floor(run / 40)) {
          // lamp on the median-side parapet; amber head is lit
          b.box(h - 0.3, y + 1.2, -0.08, h - 0.15, y + 9, 0.08, '#6f7377', rot, mx, 0, mz);
          b.box(h - 2.2, y + 8.8, -0.12, h - 0.15, y + 9, 0.12, '#6f7377', rot, mx, 0, mz);
          g.box(h - 2.2, y + 8.55, -0.25, h - 1.4, y + 8.8, 0.25, th.night ? '#ffc070' : '#d9d2c0', rot, mx, 0, mz);
        }
        if (th.night) for (const sd of [-1, 1]) g.box(sd * (h - 0.37) - 0.02, y + 0.5, -0.12, sd * (h - 0.37) + 0.02, y + 0.62, 0.12, '#ff9c3a', rot, mx, 0, mz);
        run += s1 - s0;
      }
    }
  }

  // ---- course road, kerbs, sidewalks ------------------------------------------------------
  const CHUNK = 150;
  let roadB = new BoxBuilder();
  const flushRoad = () => {
    if (!roadB.count) return;
    const m = new THREE.Mesh(keep(roadB.build()), roadMat);
    m.receiveShadow = true;
    group.add(m);
    roadB = new BoxBuilder();
  };
  const inner = (i, side) => (side > 0 ? track.roadL[i] : track.roadR[i]) + 0.6; // behind the barrier
  const outer = (i, side) => Math.max(inner(i, side) + 2.2, track.hw[i] + SIDEWALK);
  const sideGap = new Uint8Array(N * 2); // 1 = cross street / escape at this sidewalk sample
  for (let i = 0; i < N; i++) for (const [k, side] of [[0, 1], [1, -1]]) {
    const o = (inner(i, side) + outer(i, side)) / 2;
    const x = px[i] + nx[i] * o * side, z = pz[i] + nz[i] * o * side;
    if (inStreet(x, z) || escapeAt(track, x, z, 0.5)) sideGap[i * 2 + k] = 1;
  }
  for (let i = 0; i < N; i++) {
    if (i % CHUNK === 0) flushRoad();
    const j = (i + 1) % N;
    const slope = (py[j] - py[i]) / ds;
    const nrm = new THREE.Vector3(-tx[i] * slope, 1, -tz[i] * slope).normalize().toArray();
    const P = (k, off, lift = 0) => (k === 0
      ? [px[i] + nx[i] * off, py[i] + lift, pz[i] + nz[i] * off]
      : [px[j] + nx[j] * off, py[j] + lift, pz[j] + nz[j] * off]);
    const strip = (a0, a1, b0, b1, col, lift = 0, n = nrm) => {
      const p0 = P(0, a0, lift), p1 = P(0, a1, lift), p2 = P(1, b1, lift), p3 = P(1, b0, lift);
      const ax = p1[0] - p0[0], az = p1[2] - p0[2], bx = p3[0] - p0[0], bz = p3[2] - p0[2];
      if (ax * bz - az * bx < 0) roadB.quad(p0, p1, p2, p3, col, n);
      else roadB.quad(p0, p3, p2, p1, col, n);
    };
    const tile = Math.floor(i / 4);
    for (const [k, side] of [[0, 1], [1, -1]]) {
      const s = (o) => o * side;
      const w0 = inner(i, side), w1 = inner(j, side);
      strip(0, s(w0), 0, s(w1), pick(asphalt, hash2(tile, side, 3)));
      if (sideGap[i * 2 + k] && sideGap[j * 2 + k]) continue;
      const o0 = outer(i, side), o1 = outer(j, side);
      const wc = pick(walk, hash2(Math.floor(i / 2), side, 8));
      strip(s(w0), s(o0), s(w1), s(o1), wc, KERB_H);
      // kerb face (vertical, facing the road)
      const a = P(0, s(w0)), b = P(1, s(w1));
      const fn = [-nx[i] * side, 0, -nz[i] * side];
      const q = [[a[0], a[1] - 0.3, a[2]], [b[0], b[1] - 0.3, b[2]], [b[0], b[1] + KERB_H, b[2]], [a[0], a[1] + KERB_H, a[2]]];
      const ex = q[1][0] - q[0][0], ez = q[1][2] - q[0][2];
      if (ex * fn[2] - ez * fn[0] > 0) roadB.quad(q[0], q[1], q[2], q[3], '#8f8b85', fn);
      else roadB.quad(q[1], q[0], q[3], q[2], '#8f8b85', fn);
    }
  }
  flushRoad();
  // escape roads: asphalt over the whole road, on the ground they lie at
  // (city/ground.js), where the course road doesn't already cover it, and on
  // under the side walls (the barrier line can run a little outside the
  // escape's rectangle where it meets the course barrier)
  for (const e of track.escapes) {
    const W = e.hw + 0.6, nA = Math.ceil(e.len / 2), nL = Math.ceil(W), cA = e.len / nA, cL = (2 * W) / nL;
    const at = (a, l) => { const x = e.x + e.dx * a + e.nx * l, z = e.z + e.dz * a + e.nz * l; return [x, groundY(x, z) + 0.03, z]; };
    for (let a = 0; a < nA; a++) {
      for (let l = 0; l < nL; l++) {
        const a0 = a * cA, a1 = a0 + cA, l0 = -W + l * cL, l1 = l0 + cL;
        const c = [at(a0, l0), at(a1, l0), at(a1, l1), at(a0, l1)];
        if (c.every((p) => onRoad(p[0], p[2], -0.1))) continue;
        const ux = c[1][0] - c[0][0], uz = c[1][2] - c[0][2], vx = c[3][0] - c[0][0], vz = c[3][2] - c[0][2];
        const col = pick(asphalt, hash2(a >> 1, l, 13));
        if (ux * vz - uz * vx < 0) roadB.quad(c[0], c[1], c[2], c[3], col, [0, 1, 0]);
        else roadB.quad(c[0], c[3], c[2], c[1], col, [0, 1, 0]);
      }
    }
  }
  flushRoad();

  // ---- markings: lane lines, crosswalks, stop lines, start grid ----------------------------
  const decoAt = (i) => boxes(px[i], pz[i], 'deco');
  // flat painted rectangle [x0,x1]x[z0,z1] in a frame rotated by rot at (tx, ty, tz)
  const decal = (b, x0, z0, x1, z1, col, rot, tx, ty, tz) => {
    const cs = Math.cos(rot), sn = Math.sin(rot), y = ty + 0.02;
    const T = (x, z) => [x * cs + z * sn + tx, y, -x * sn + z * cs + tz];
    b.quad(T(x0, z1), T(x1, z1), T(x1, z0), T(x0, z0), col, [0, 1, 0]);
  };
  {
    const head = (i) => Math.atan2(tx[i], tz[i]);
    // intersection influence along the course: no lane lines across junctions
    const junction = new Float32Array(N);
    const crossings = [];
    for (const it of city.intersections) {
      const i = nearest(it.x, it.z, 30);
      if (i < 0) continue;
      let span = 0;
      for (const d of it.dirs) span = Math.max(span, d.hw);
      crossings.push({ i, span });
      const r = Math.ceil((span + 4) / ds);
      for (let k = -r; k <= r; k++) junction[(i + k + N) % N] = 1;
    }
    for (let i = 0; i < N; i++) if (Math.abs(track.curv[i]) > 0.02) junction[i] = 1;
    // dashed lane lines
    for (let i = 0; i < N; i += 1) {
      if (junction[i] || i % 6 >= 3) continue;
      const hw = track.hw[i], lanes = Math.max(2, Math.round((2 * hw) / 3.4));
      const lw = (2 * hw) / lanes;
      for (let l = 1; l < lanes; l++) {
        const off = -hw + l * lw;
        decal(decoAt(i), -0.07, -ds * 1.5, 0.07, ds * 1.5, '#e8e6df', head(i), px[i] + nx[i] * off, py[i], pz[i] + nz[i] * off);
      }
    }
    // edge lines
    for (let i = 0; i < N; i += 2) {
      if (junction[i]) continue;
      for (const side of [1, -1]) {
        const off = (track.hw[i] - 0.9) * side;
        decal(decoAt(i), -0.06, -ds, 0.06, ds, '#e8e6df', head(i), px[i] + nx[i] * off, py[i], pz[i] + nz[i] * off);
      }
    }
    // zebra crosswalks + stop lines either side of each junction
    for (const c of crossings) {
      for (const dir of [-1, 1]) {
        const a = (c.i + dir * Math.round((c.span + 2.5) / ds) + N) % N;
        const h = head(a), hw = Math.max(track.wallL[a], track.wallR[a]);
        for (let o = -hw + 0.3; o < hw - 0.3; o += 1.2) {
          decal(decoAt(a), -0.3, -1.6, 0.3, 1.6, '#eeece6', h, px[a] + nx[a] * o, py[a], pz[a] + nz[a] * o);
        }
        const b = (a - dir * 2 + N) % N;
        decal(decoAt(b), -hw, -0.3, hw, 0.3, '#eeece6', head(b), px[b], py[b], pz[b]);
      }
    }
    addStartGrid(track, decoAt(0));
  }

  // ---- barriers, catch fence, sponsor banners --------------------------------------------
  const fencePos = [], fenceUv = [], fenceIdx = [];
  const banPos = [], banUv = [], banIdx = [];
  const ROWS = SPONSORS.length;
  const fenceQuad = (a, b, y0, y1, u0, u1) => {
    const v = fencePos.length / 3;
    fencePos.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1]);
    fenceUv.push(u0, 0, u1, 0, u1, (y1 - y0) / 1.5, u0, (y1 - y0) / 1.5);
    fenceIdx.push(v, v + 1, v + 2, v, v + 2, v + 3);
  };
  const bannerQuad = (p0, p1, y0, y1, row) => {
    const v = banPos.length / 3;
    banPos.push(p0[0], y0, p0[1], p1[0], y0, p1[1], p1[0], y1, p1[1], p0[0], y1, p0[1]);
    const v0 = 1 - (row + 1) / ROWS, v1 = 1 - row / ROWS;
    banUv.push(0, v0, 1, v0, 1, v1, 0, v1);
    banIdx.push(v, v + 1, v + 2, v, v + 2, v + 3);
  };
  // The barrier lines are track.barriers (trackCore), the same lines the cars
  // collide with: concrete blocks with a catch fence along the course, plain
  // blocks down the escape roads and a tyre wall across each escape's end.
  // One block per segment; W(a0, a1, ...) spans a0..a1 m behind the face.
  let ucum = 0;
  for (const { side, pts, src, kind } of track.barriers.loops) {
    const m = src.length;
    const V = (k) => [pts[(k % m) * 2], pts[(k % m) * 2 + 1]];
    // outward unit normal at vertex k (mean of the adjacent segments')
    const segOut = (k) => {
      const [ax, az] = V(k), [bx, bz] = V(k + 1), l = Math.hypot(bx - ax, bz - az) || 1;
      return [((bz - az) / l) * side, (-(bx - ax) / l) * side];
    };
    const vOut = (k) => {
      const a = segOut((k - 1 + m) % m), b = segOut(k), l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1;
      return [(a[0] + b[0]) / l, (a[1] + b[1]) / l];
    };
    const off = (k, o) => { const [x, z] = V(k), [ox, oz] = vOut(k % m); return [x + ox * o, z + oz * o]; };
    let bannerRun = 0;
    for (let k = 0; k < m; k++) {
      const [ax, az] = V(k), [bx, bz] = V(k + 1);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const len = Math.hypot(bx - ax, bz - az) + 0.06;
      const rot = Math.atan2(bx - ax, bz - az);
      const cy = kind[k] === 0 ? (py[src[k]] + py[src[(k + 1) % m]]) / 2 : groundY(mx, mz);
      const b = boxes(mx, mz);
      const W = (a0, a1, y0, y1, col, z0 = -len / 2, z1 = len / 2) => b.box(side > 0 ? a0 : -a1, y0, z0, side > 0 ? a1 : -a0, y1, z1, col, rot, mx, cy, mz);
      if (kind[k] === 2) {
        const n = Math.max(1, Math.round(len / 0.9));
        for (let q = 0; q < n; q++) {
          for (let r = 0; r < 3; r++) {
            const z0 = -len / 2 + (q * len) / n;
            W(0, 0.84, r * 0.36, r * 0.36 + 0.34, (q + r + k) % 4 === 0 ? '#e8e8e8' : '#1d1d1f', z0 + 0.03, z0 + len / n - 0.03);
          }
        }
        bannerRun = 0;
        continue;
      }
      if (kind[k] === 1) {
        W(0, 0.62, -0.3, 0.32, '#c9c6be');
        W(0.12, 0.5, 0.32, 1.02, '#c9c6be');
        bannerRun = 0;
        continue;
      }
      const blockCol = k % 2 ? '#cfccc4' : '#c4c1b9';
      W(0, 0.62, -0.3, 0.32, blockCol);
      W(0.12, 0.5, 0.32, 1.02, blockCol);
      if (hi || k % 2 === 0) {
        // fence posts + rail on top of the barrier
        if (k % 2 === 0) W(0.28, 0.4, 1.02, 4.1, '#5c6166', -len / 2, -len / 2 + 0.12);
        W(0.3, 0.38, 3.98, 4.08, '#6c7176');
      }
      if (hi) fenceQuad(off(k, 0.34), off(k + 1, 0.34), cy + 1.02, cy + 4.0, ucum, ucum + len / 1.2);
      ucum += len / 1.2;
      // sponsor banners on the road face along straights, three blocks long
      bannerRun = Math.abs(track.curv[src[k]]) < 0.004 ? bannerRun + 1 : 0;
      if (bannerRun >= 3 && k % 6 === 0) {
        const p0 = off(k - 2 + m, -0.03), p1 = off(k + 1, -0.03);
        // orient so the banner reads left-to-right from the road
        const row = Math.floor(hash2(k, side, 21) * ROWS);
        if (side > 0) bannerQuad(p0, p1, cy + 0.05, cy + 0.95, row);
        else bannerQuad(p1, p0, cy + 0.05, cy + 0.95, row);
      }
    }
  }
  if (fencePos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(fencePos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(fenceUv, 2));
    g.setIndex(fenceIdx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const cg = c.getContext('2d');
    cg.strokeStyle = 'rgba(70,74,78,1)'; cg.lineWidth = 2;
    cg.beginPath(); cg.moveTo(0, 0); cg.lineTo(32, 32); cg.moveTo(32, 0); cg.lineTo(0, 32); cg.stroke();
    const tex = keep(new THREE.CanvasTexture(c));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 2);
    const mat = keep(new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, opacity: 0.85 }));
    const m = new THREE.Mesh(keep(g), mat);
    group.add(m);
  }
  if (banPos.length) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 96 * ROWS;
    const cg = c.getContext('2d');
    SPONSORS.forEach(([t, bg, fg], r) => {
      cg.fillStyle = bg; cg.fillRect(0, r * 96, 512, 96);
      cg.fillStyle = fg; cg.font = 'bold 64px "Chakra Petch", Arial, sans-serif';
      cg.textAlign = 'center'; cg.textBaseline = 'middle';
      cg.fillText(t, 256, r * 96 + 51);
    });
    const tex = keep(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(banPos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(banUv, 2));
    g.setIndex(banIdx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    group.add(new THREE.Mesh(keep(g), keep(new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }))));
  }

  // ---- start gantry, brake boards, paddock ---------------------------------------------------
  const startB = boxes(px[0], pz[0]);
  const setLights = buildGantry(track, startB, group, keep, { span: Math.max(track.wallL[4], track.wallR[4]) + 0.9, colors: ['#3a3f46', '#1f2328'] });
  {
    // sponsor panel on the gantry
    const a = 4, h = Math.atan2(tx[a], tz[a]);
    const span = Math.max(track.wallL[a], track.wallR[a]) + 0.9;
    startB.box(-span, 7.6, -0.45, span, 9.0, 0.45, '#d7263d', h, px[a], py[a], pz[a]);
    startB.box(-span + 0.3, 7.8, -0.5, span - 0.3, 8.8, 0.5, '#f4f4f0', h, px[a], py[a], pz[a]);
  }
  buildBrakeBoards(track, startB, group, keep, { wallOff: 1.2 });
  if (def.paddock) {
    // team tents and transporters on an open plaza beside the start straight
    const p = def.paddock, side = p.side === 'L' ? 1 : -1;
    for (let s = p.from; s < p.to; s += 9) {
      const q = track.sample(((s % track.length) + track.length) % track.length, 0);
      const i = q.i, wall = side > 0 ? track.wallL[i] : track.wallR[i];
      const h = Math.atan2(tx[i], tz[i]);
      for (let row = 0; row < 2; row++) {
        const off = (wall + p.offset + row * 7) * side;
        const x = px[i] + nx[i] * off, z = pz[i] + nz[i] * off, y = groundY(x, z);
        const b = boxes(x, z);
        const k = Math.floor(hash2(Math.floor(s), row, 33) * SPONSORS.length);
        const [, bg, fg] = SPONSORS[k];
        if (row === 0) {
          // pop-up tent: four legs + canopy in team colours
          for (const [lx, lz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) b.box(lx - 0.05, 0, lz - 0.05, lx + 0.05, 2.6, lz + 0.05, '#cfd2d6', h, x, y, z);
          b.box(-2.8, 2.6, -2.8, 2.8, 2.9, 2.8, bg, h, x, y, z);
          b.box(-1.6, 2.9, -1.6, 1.6, 3.4, 1.6, fg, h, x, y, z);
          b.box(-1.2, 0, -0.5, 1.2, 0.9, 0.5, '#2e3136', h, x, y, z);
        } else {
          // transporter trailer
          b.box(-1.25, 0.45, -5, 1.25, 4.0, 5, bg, h, x, y, z);
          b.box(-1.27, 2.0, -5, 1.27, 2.6, 5, fg, h, x, y, z);
          b.box(-1.2, 0, -4.5, 1.2, 0.45, -3.2, '#1b1b1d', h, x, y, z);
          b.box(-1.2, 0, 3.2, 1.2, 0.45, 4.5, '#1b1b1d', h, x, y, z);
        }
      }
    }
  }

  // ---- city module: prepare (may drop OSM buildings replaced by landmarks) -------------------
  const ctx = {
    track, def, theme: th, quality, hi, city,
    project: (lat, lon) => city.project(lat, lon),
    groundY, courseAt, boxes,
    add: (o) => group.add(o), keep, animate: (fn) => animated.push(fn),
    textTexture, SPONSORS, props, hash2, rng,
    removeBuildings: (pred) => { for (const b of city.buildings) if (pred(b)) b.removed = true; },
  };
  // the decoded city is cached across rebuilds (quality changes): clear per-build flags
  for (const b of city.buildings) { b.removed = false; b.base = undefined; }
  mod.prepare?.(ctx);

  // ---- buildings ---------------------------------------------------------------------------------
  const pip = (x, z, pts) => {
    let c = false;
    const n = pts.length / 2;
    for (let a = 0, b = n - 1; a < n; b = a++) {
      const ax = pts[a * 2], az = pts[a * 2 + 1], bx = pts[b * 2], bz = pts[b * 2 + 1];
      if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) c = !c;
    }
    return c;
  };
  const shown = city.buildings.map((b) => {
    if (b.removed) return false;
    if (!hi && b.far && b.h < 160) return false;
    // low: drop the low-rise back rows (mostly hidden behind the street frontage)
    if (!hi && !b.far && b.h < 40 && nearest(b.cx, b.cz, 70) < 0) return false;
    // never inside the course: footprints from OSM sometimes overhang the kerb line
    if (!b.far && inCourse(b.cx, b.cz, 0.5)) return false;
    return true;
  });
  // Building parts that start above the ground (min_height) stand on other
  // parts. Where those aren't drawn the part would float: its supports were
  // dropped above (low quality, kerb overhang), or never fetched (the skyline
  // beyond the course only has the tall parts of its towers). Such a part is
  // drawn down to the ground instead. Parts with no support in the data near
  // the course (arcades, canopies) stay as they are; buildings a city module
  // replaced with a landmark still count as support.
  const grounded = new Set();
  {
    const G = 60, grid = new Map();
    const cellsOf = (b) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let q = 0; q < b.pts.length; q += 2) { x0 = Math.min(x0, b.pts[q]); x1 = Math.max(x1, b.pts[q]); z0 = Math.min(z0, b.pts[q + 1]); z1 = Math.max(z1, b.pts[q + 1]); }
      const out = [];
      for (let a = Math.floor(x0 / G); a <= Math.floor(x1 / G); a++) for (let c = Math.floor(z0 / G); c <= Math.floor(z1 / G); c++) out.push(skey(a, c));
      return out;
    };
    city.buildings.forEach((b, k) => {
      for (const key of cellsOf(b)) {
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(k);
      }
    });
    const overlaps = (P, S) => {
      if (pip(P.cx, P.cz, S.pts) || pip(S.cx, S.cz, P.pts)) return true;
      for (let q = 0; q < P.pts.length; q += 2) if (pip(P.pts[q], P.pts[q + 1], S.pts)) return true;
      return false;
    };
    // does a building ok(k) stand under part P (index kp), up to within 2 m of its underside?
    const supported = (P, kp, ok) => cellsOf(P).some((key) => (grid.get(key) || []).some((k) => {
      const S = city.buildings[k];
      return k !== kp && ok(k) && S.minH < P.minH && S.h >= P.minH - 2 && overlaps(P, S);
    }));
    city.buildings.forEach((b, k) => {
      if (!shown[k] || b.minH <= 0.5) return;
      if (supported(b, k, (s) => shown[s] || city.buildings[s].removed)) return;
      if (b.far || supported(b, k, () => true)) grounded.add(k);
    });
  }
  let nBld = 0;
  city.buildings.forEach((b, k) => {
    if (!shown[k]) return;
    const near = nearest(b.cx, b.cz, 130) >= 0;
    let base = Infinity;
    for (let q = 0; q < b.pts.length; q += 2) base = Math.min(base, groundY(b.pts[q], b.pts[q + 1]));
    // city modules may pick facade styles and roofs (mod.styleFor / mod.buildingOpts)
    const st = mod.styleFor?.(b, k) ?? styleFor(b, k);
    addBuilding(chunk(b.cx, b.cz, b.far ? CH * 4 : CHQ).fac, grounded.has(k) ? { ...b, minH: 0 } : b, base, {
      style: st, seed: k,
      shop: !b.part && b.minH === 0 && b.h > 9 && (hi ? near : nearest(b.cx, b.cz, 45) >= 0) && !b.church,
      cornice: hi && near && b.h < 90 && (st === STYLE.limestone || st === STYLE.brick || st === STYLE.brownstone || st === STYLE.white),
      ...mod.buildingOpts?.(b, k, st, { hi, near }),
    });
    b.base = base;
    nBld++;
  });

  // ---- trees: real OSM trees, then generated park trees ----------------------------------------
  const treeCells = new Set();
  const tkey = (x, z) => `${Math.floor(x / 7)},${Math.floor(z / 7)}`;
  const plantStreetTree = (x, z, seed, park) => {
    if (inCourse(x, z, 1.0)) return;
    treeCells.add(tkey(x, z));
    const y = groundY(x, z);
    const sc = park ? 0.85 + hash2(seed, 1, 3) * 0.5 : 0.85 + hash2(seed, 1, 3) * 0.35;
    // theme.treeLod (m): beyond it trees get one merged crown (cities with dense tree maps)
    if (th.treeLod && nearest(x, z, th.treeLod) < 0) props.simpleTree(boxes(x, z), x, y, z, seed, sc * (park ? 1.25 : 1));
    else if (park) props.parkTree(boxes(x, z), x, y, z, seed, sc);
    else props.streetTree(boxes(x, z), x, y, z, seed, sc);
  };
  const inPark = (x, z) => parkPolys.some((a) => pip(x, z, a.pts));
  city.pois.forEach((p, k) => {
    if (p.kind !== 0) return;
    if (nearest(p.x, p.z, hi ? 150 : 60) < 0) return;
    plantStreetTree(p.x, p.z, k + 0.5, inPark(p.x, p.z));
  });
  {
    const spacing = hi ? 14 : 22, reach = hi ? 170 : 90;
    for (const a of parkPolys) {
      let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
      for (let q = 0; q < a.pts.length; q += 2) { minx = Math.min(minx, a.pts[q]); maxx = Math.max(maxx, a.pts[q]); minz = Math.min(minz, a.pts[q + 1]); maxz = Math.max(maxz, a.pts[q + 1]); }
      for (let x = minx; x < maxx; x += spacing) for (let z = minz; z < maxz; z += spacing) {
        const jx = x + (hash2(Math.floor(x), Math.floor(z), 41) - 0.5) * spacing * 0.8, jz = z + (hash2(Math.floor(x), Math.floor(z), 42) - 0.5) * spacing * 0.8;
        if (treeCells.has(tkey(jx, jz))) continue;
        if (nearest(jx, jz, reach) < 0) continue;
        if (!pip(jx, jz, a.pts)) continue;
        if (inStreet(jx, jz, 1) || city.areas.some((w) => w.kind === 1 && pip(jx, jz, w.pts))) continue;
        plantStreetTree(jx, jz, jx * 0.37 + jz * 0.11, true);
      }
    }
    // distant canopy: one chunky block per cell over the big parks beyond the
    // individually modelled trees, so Central Park reads as a forest to the horizon
    const cell = hi ? 34 : 50;
    for (const a of parkPolys) {
      let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
      for (let q = 0; q < a.pts.length; q += 2) { minx = Math.min(minx, a.pts[q]); maxx = Math.max(maxx, a.pts[q]); minz = Math.min(minz, a.pts[q + 1]); maxz = Math.max(maxz, a.pts[q + 1]); }
      if ((maxx - minx) * (maxz - minz) < 150000) continue;
      for (let x = minx; x < maxx; x += cell) for (let z = minz; z < maxz; z += cell) {
        const h1 = hash2(Math.floor(x), Math.floor(z), 51), h2 = hash2(Math.floor(x), Math.floor(z), 52);
        const jx = x + (h1 - 0.5) * cell * 0.6, jz = z + (h2 - 0.5) * cell * 0.6;
        if (nearest(jx, jz, reach) >= 0 || !pip(jx, jz, a.pts)) continue;
        if (inStreet(jx, jz, 4) || city.areas.some((w) => w.kind === 1 && pip(jx, jz, w.pts))) continue;
        const y = groundY(jx, jz), s = cell * (0.42 + h1 * 0.18), hgt = 9 + h2 * 7;
        chunk(jx, jz, CH * 4).props.box(-s, 2.5, -s, s, 2.5 + hgt, s, pick(['#3f6e2c', '#4a7a33', '#36622a', '#55843a'], h1), h2 * 1.5, jx, y, jz, { skipBottom: true });
      }
    }
  }

  // ---- street furniture along the course ---------------------------------------------------------
  {
    const R = rng(def.id.length * 4099);
    const placeOnWalk = (i, side, off) => {
      const o = inner(i, side) + off;
      const x = px[i] + nx[i] * o * side, z = pz[i] + nz[i] * o * side;
      return { x, z, y: py[i] + KERB_H, rot: faceRot(-nx[i] * side, -nz[i] * side), ok: !sideGap[i * 2 + (side > 0 ? 0 : 1)] };
    };
    // lamps
    const lampStep = Math.round(34 / ds);
    for (const side of [1, -1]) {
      for (let i = (side > 0 ? 0 : lampStep >> 1); i < N; i += lampStep) {
        const p = placeOnWalk(i, side, 0.5);
        if (!p.ok || Math.abs(track.curv[i]) > 0.02) continue;
        props.streetLamp(boxes(p.x, p.z), boxes(p.x, p.z, 'glow'), p.x, p.y, p.z, p.rot, style);
        if (th.night) {
          const o = inner(i, side) - 3;
          pools.push([px[i] + nx[i] * o * side, py[i] + 0.04, pz[i] + nz[i] * o * side]);
        }
      }
    }
    // traffic signals + corner furniture at each junction
    for (const it of city.intersections) {
      const i0 = nearest(it.x, it.z, 30);
      if (i0 < 0) continue;
      let span = 0;
      for (const d of it.dirs) span = Math.max(span, d.hw);
      for (const side of [1, -1]) {
        const i = (i0 - side * Math.round((span + 3) / ds) + N) % N;
        const p = placeOnWalk(i, side, 0.6);
        if (!p.ok) continue;
        const rot = side < 0 ? Math.atan2(tx[i], tz[i]) : Math.atan2(-tx[i], -tz[i]);
        const arm = Math.min(9, (side > 0 ? track.wallL[i] : track.wallR[i]) + 0.6);
        props.trafficSignal(boxes(p.x, p.z), boxes(p.x, p.z, 'glow'), p.x, p.y, p.z, rot, arm, style);
        const r = R();
        const q = placeOnWalk((i - side * 2 + N) % N, side, 1.6);
        if (!q.ok) continue;
        if (r < 0.25) props.trashCan(boxes(q.x, q.z), q.x, q.y, q.z);
        else if (r < 0.4) props.newsstand(boxes(q.x, q.z), q.x, q.y, q.z, q.rot, style);
      }
    }
    // OSM points near the course, snapped onto the sidewalk
    for (const p of city.pois) {
      if (p.kind < 1 || p.kind > 3) continue;
      const c = courseAt(p.x, p.z);
      if (c.dist > 28) continue;
      const side = c.d > 0 ? 1 : -1;
      const off = p.kind === 1 ? 1.9 : p.kind === 2 ? 0.45 : 1.0;
      const q = placeOnWalk(c.i, side, off);
      if (!q.ok) continue;
      const b = boxes(q.x, q.z);
      if (p.kind === 1) {
        // subway stairs run along the kerb: local z along the course
        props.subwayEntrance(b, boxes(q.x, q.z, 'glow'), q.x, q.y + 0.01, q.z, q.rot, style);
      } else if (p.kind === 2) props.hydrant(b, q.x, q.y, q.z, q.rot, style);
      else props.mailbox(b, q.x, q.y, q.z, q.rot, style);
    }
    // parked cabs and cars down the side streets
    let carSeed = 1;
    for (const it of city.intersections) {
      if (nearest(it.x, it.z, 30) < 0) continue;
      for (const d of it.dirs) {
        if (d.ped || !hi) continue;
        for (let s = 16; s < 52; s += 6.2) {
          if (R() < 0.35) continue;
          for (const sd of [1, -1]) {
            if (R() < 0.4) continue;
            const off = (d.hw - 1.3) * sd;
            const x = it.x + d.dx * s - d.dz * off, z = it.z + d.dz * s + d.dx * off;
            if (inCourse(x, z, 3) || escapeAt(track, x, z, 2) || !inStreet(x, z)) continue;
            const rot = Math.atan2(d.dx, d.dz) + (sd > 0 ? 0 : Math.PI);
            const y = groundY(x, z) + 0.02;
            if (R() < 0.6) props.taxi(boxes(x, z), x, y, z, rot, carSeed++, style);
            else props.parkedCar(boxes(x, z), x, y, z, rot, carSeed++, style);
          }
        }
      }
    }
    // steam from manholes on the course and in side streets
    const steamPts = [];
    for (let k = 0; k < (props.STYLE[style]?.steam === false ? 0 : hi ? 14 : 6); k++) {
      const i = Math.floor(R() * N);
      if (Math.abs(track.curv[i]) > 0.01 || i < 40 || i > N - 60) continue;
      const off = (R() - 0.5) * track.hw[i];
      const x = px[i] + nx[i] * off, z = pz[i] + nz[i] * off;
      boxes(x, z, 'deco').box(-0.45, 0, -0.45, 0.45, 0.025, 0.45, '#2d2b29', 0, x, py[i], z, { flat: true });
      steamPts.push([x, py[i], z]);
    }
    if (steamPts.length) {
      const steam = props.makeSteam(steamPts, keep);
      group.add(steam.object);
      animated.push((t) => steam.update(t));
    }
  }

  // ---- city module: landmarks / dressing --------------------------------------------------------
  mod.build?.(ctx);

  // ---- flush chunk geometry ----------------------------------------------------------------------
  let calls = 0;
  for (const c of chunks.values()) {
    if (c.fac.count) {
      const m = new THREE.Mesh(keep(c.fac.build()), facadeMat);
      m.castShadow = hi; m.receiveShadow = true;
      group.add(m); calls++;
    }
    if (c.props.count) {
      const m = new THREE.Mesh(keep(c.props.build()), propsMat);
      m.castShadow = hi; m.receiveShadow = true;
      group.add(m); calls++;
    }
    if (c.deco.count) {
      const m = new THREE.Mesh(keep(c.deco.build()), sideMat);
      m.receiveShadow = true; m.renderOrder = 2;
      group.add(m); calls++;
    }
    if (c.glow.count) { group.add(new THREE.Mesh(keep(c.glow.build()), glowMat)); calls++; }
  }

  // ---- night: lamp light pools ------------------------------------------------------------------
  if (pools.length) {
    // soft additive discs of lamp light on the road (one draw call)
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const cg = c.getContext('2d');
    const grd = cg.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,214,150,0.6)'); grd.addColorStop(0.55, 'rgba(255,200,130,0.22)'); grd.addColorStop(1, 'rgba(255,200,130,0)');
    cg.fillStyle = grd; cg.fillRect(0, 0, 64, 64);
    const tex = keep(new THREE.CanvasTexture(c));
    // each pool is a small grid draped on the course surface: a flat square on
    // a sloping street floats above the road on the downhill side and its cut
    // line through the asphalt shows as a hard-edged band of light
    const pos = [], uv = [], idx = [];
    const G = 4, r = 11;
    for (const [x, , z] of pools) {
      const v = pos.length / 3;
      let hint = -1;
      for (let b = 0; b <= G; b++) for (let a = 0; a <= G; a++) {
        const vx = x - r + (2 * r * a) / G, vz = z - r + (2 * r * b) / G;
        const loc = track.locate(vx, vz, hint);
        hint = loc.i;
        pos.push(vx, loc.y + 0.04, vz);
        uv.push(a / G, b / G);
      }
      for (let b = 0; b < G; b++) for (let a = 0; a < G; a++) {
        const q = v + b * (G + 1) + a;
        idx.push(q, q + G + 1, q + 1, q + 1, q + G + 1, q + G + 2);
      }
    }
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, keep(new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 })));
    m.renderOrder = 3;
    group.add(m);
  }
  // ---- clouds, driving line -------------------------------------------------------------------------
  const [bx0, bz0, bx1, bz1] = city.bounds;
  const clouds = buildClouds(def, keep, [(bx0 + bx1) / 2, (bz0 + bz1) / 2], Math.hypot(bx1 - bx0, bz1 - bz0) / 2, 260);
  group.add(clouds);
  const line = makeDrivingLine(track, group, keep);
  if (typeof window !== 'undefined') console.log(`voxel-gt city ${def.id}: ${nBld} buildings, ${chunks.size} chunks, ${calls} chunk meshes`);

  let time = 0;
  const update = (dt, camera, focus) => {
    time += dt;
    env.update(camera, focus);
    clouds.position.x = Math.sin(time * 0.01) * 60;
    for (const f of animated) f(time, dt);
  };

  return {
    group, update, setLights, setDrivingLine: line.set,
    fog: new THREE.Fog(th.fog, th.fogNear, th.fogFar * (hi ? 1 : 0.7)),
    background: new THREE.Color(th.fog),
    heightAt: groundY,
    dispose() {
      line.dispose();
      for (const d of disposables) d.dispose?.();
    },
  };
}
