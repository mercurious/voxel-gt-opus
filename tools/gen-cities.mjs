// Generates src/cityData.generated.js from the committed OpenStreetMap extracts
// in tools/data/cities/<id>.json (see tools/fetch-city.mjs). No network.
// Map data (c) OpenStreetMap contributors, ODbL 1.0.
//
// Pipeline per city:
//   lat/lon -> local metres (x east, z south; origin = bbox centre)
//   route waypoints -> shortest paths on the OSM road graph -> closed polyline
//   -> dual-carriageway centring -> Douglas-Peucker -> corner fillets (radius
//   from street width) -> 4 m resample, index 0 = start line
//   -> per point: street width (OSM width/lanes) and DEM elevation
//   -> corridor rectangles (barrier limits), escape roads, intersections
//   -> nearby buildings/parts, streets, parks, water, trees, POIs, DEM grid
// Bulky geometry is packed as base64 Int16 streams (0.5 m units).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES } from './city-config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const STEP = 4;
const NEAR = 220; // m: buildings/props kept within this distance of the course
const Q = 2; // quantisation: units per metre

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function genCity(id, cfg) {
  const file = path.join(here, 'data/cities', `${id}.json`);
  if (!fs.existsSync(file)) { console.log(`skip ${id}: no ${file} (run npm run fetch:city ${id})`); return null; }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const D = cfg.defaults;
  const [S, W, N, E] = cfg.bbox;
  const lat0 = (S + N) / 2, lon0 = (W + E) / 2;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  const P = (ll) => [(ll[1] - lon0) * kx, -(ll[0] - lat0) * ky];
  const bx0 = (W - lon0) * kx, bx1 = (E - lon0) * kx, bz0 = -(N - lat0) * ky, bz1 = -(S - lat0) * ky;

  // ---- DEM ---------------------------------------------------------------
  // SRTM is a surface model: in dense cities it picks up building roofs.
  // cfg.elevation.smooth = passes of a 3x3 median (despike) + 3x3 mean.
  const dem = { ...raw.elevation, values: raw.elevation.values.map((v) => v ?? 0) };
  for (let pass = 0; pass < (cfg.elevation.smooth || 0); pass++) {
    for (const op of ['median', 'mean']) {
      const src = dem.values, out = new Array(src.length);
      for (let j = 0; j < dem.ny; j++) for (let i = 0; i < dem.nx; i++) {
        const w = [];
        for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) w.push(src[clamp(j + b, 0, dem.ny - 1) * dem.nx + clamp(i + a, 0, dem.nx - 1)]);
        w.sort((p, q) => p - q);
        out[j * dem.nx + i] = op === 'median' ? w[4] : w.reduce((s, v) => s + v, 0) / 9;
      }
      dem.values = out;
    }
  }
  const demAt = (x, z) => {
    const lon = lon0 + x / kx, lat = lat0 - z / ky;
    const fx = clamp(((lon - dem.bbox[1]) / (dem.bbox[3] - dem.bbox[1])) * (dem.nx - 1), 0, dem.nx - 1.001);
    const fy = clamp(((lat - dem.bbox[0]) / (dem.bbox[2] - dem.bbox[0])) * (dem.ny - 1), 0, dem.ny - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const g = (a, b) => dem.values[b * dem.nx + a] ?? 0;
    return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v;
  };

  const els = raw.osm.elements;
  const ways = els.filter((e) => e.t === 'w');
  const roadW = (tags) => {
    let w = parseFloat(tags.width);
    if (!(w > 0)) {
      const lanes = parseInt(tags.lanes, 10) || 2;
      w = lanes * D.laneW + D.parking; // OSM lanes exclude kerbside parking/loading
    }
    return clamp(w, 2 * D.minHalfW, 2 * D.maxHalfW);
  };

  // ---- road graph ----------------------------------------------------------
  const nodePos = new Map();
  const adj = new Map(); // node -> [{to, way, len}]
  // cfg.surfaceWays: tunnel way ids raced at street level (the street above was pedestrianised)
  const isRoad = (w) => cfg.roadTypes.includes(w.tags.highway) && w.tags.area !== 'yes' && (!w.tags.tunnel || !!cfg.surfaceWays?.includes(w.id));
  const DRIVE = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian)(_link)?$/;
  for (const w of ways) {
    if (!w.tags.highway) continue;
    w.g.forEach((ll, k) => { if (ll) nodePos.set(w.nodes[k], P(ll)); });
    if (!DRIVE.test(w.tags.highway) || w.tags.area === 'yes') continue;
    for (let k = 0; k + 1 < w.nodes.length; k++) {
      const a = w.nodes[k], b = w.nodes[k + 1];
      if (!w.g[k] || !w.g[k + 1]) continue;
      const pa = P(w.g[k]), pb = P(w.g[k + 1]);
      const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      for (const [f, t] of [[a, b], [b, a]]) {
        if (!adj.has(f)) adj.set(f, []);
        adj.get(f).push({ to: t, way: w, len, road: isRoad(w) });
      }
    }
  }
  // cfg.prefer: street names the course should stick to; other named streets and
  // minor unnamed ones cost 4x (unnamed main roads are fine: many are untagged)
  const preferred = (w) => !cfg.prefer || (w.tags.name ? cfg.prefer.some((n) => w.tags.name.includes(n)) : /^(trunk|primary|secondary|tertiary)(_link)?$/.test(w.tags.highway));
  const snap = (ll) => {
    const [x, z] = P(ll);
    let best = null, bd = 1e9;
    for (const [id2, edges] of adj) {
      if (!edges.some((e) => e.road && preferred(e.way))) continue;
      const p = nodePos.get(id2);
      const d = Math.hypot(p[0] - x, p[1] - z);
      if (d < bd) { bd = d; best = id2; }
    }
    if (bd > 40) console.warn(`  waypoint ${ll} snapped ${bd.toFixed(0)} m away`);
    return best;
  };
  const dijkstra = (src, dst) => {
    const dist = new Map([[src, 0]]), prev = new Map(), done = new Set();
    const open = [src];
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (dist.get(open[k]) < dist.get(open[bi])) bi = k;
      const u = open[bi];
      open[bi] = open[open.length - 1]; open.pop();
      if (u === dst) break;
      if (done.has(u)) continue;
      done.add(u);
      for (const e of adj.get(u) || []) {
        if (!e.road) continue;
        const nd = dist.get(u) + e.len * (preferred(e.way) ? 1 : 4);
        if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, { from: u, way: e.way }); open.push(e.to); }
      }
    }
    if (!prev.has(dst)) throw new Error(`${id}: no path ${src} -> ${dst}`);
    const out = [];
    for (let v = dst; v !== src; v = prev.get(v).from) out.push({ node: v, way: prev.get(v).way });
    return out.reverse();
  };
  const wp = cfg.route.map(snap);
  let path0 = [];
  for (let k = 0; k < wp.length; k++) path0.push(...dijkstra(wp[k], wp[(k + 1) % wp.length]));
  // vertex k: node, way of the segment arriving at it
  let V = path0.map((p) => ({ node: p.node, x: nodePos.get(p.node)[0], z: nodePos.get(p.node)[1], w: roadW(p.way.tags), way: p.way }));
  // drop immediate back-tracks (A B A) from waypoint snapping
  for (let changed = true; changed;) {
    changed = false;
    for (let k = 0; k < V.length; k++) {
      const a = V[(k - 1 + V.length) % V.length], c = V[(k + 1) % V.length];
      if (a.node === c.node) { V.splice(k, 2); changed = true; break; }
    }
  }
  const courseWays = new Set(V.map((v) => v.way.id));

  // ---- dual carriageways: centre between the two one-way halves ------------
  const oneways = ways.filter((w) => isRoad(w) && w.tags.oneway === 'yes' && w.tags.name);
  for (const v of V) {
    // cfg.noCentre: one-way streets raced on one carriageway (halves too far apart, boulevards)
    if (v.way.tags.oneway !== 'yes' || !v.way.tags.name || cfg.noCentre?.includes(v.way.tags.name)) continue;
    const k = V.indexOf(v), nb = V[(k + 1) % V.length], pv = V[(k - 1 + V.length) % V.length];
    let dx = nb.x - pv.x, dz = nb.z - pv.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    let best = null, bd = 30;
    for (const w of oneways) {
      if (w.id === v.way.id || w.tags.name !== v.way.tags.name || courseWays.has(w.id)) continue;
      for (let j = 0; j + 1 < w.g.length; j++) {
        const a = P(w.g[j]), b = P(w.g[j + 1]);
        let ux = b[0] - a[0], uz = b[1] - a[1];
        const L = Math.hypot(ux, uz); if (L < 1) continue;
        ux /= L; uz /= L;
        if (ux * dx + uz * dz > -0.85) continue; // must run the other way
        const t = clamp(((v.x - a[0]) * ux + (v.z - a[1]) * uz) / L, 0, 1);
        const qx = a[0] + ux * L * t, qz = a[1] + uz * L * t;
        const d = Math.hypot(qx - v.x, qz - v.z);
        if (d > 4 && d < bd) { bd = d; best = [qx, qz]; }
      }
    }
    if (best) { v.x = (v.x + best[0]) / 2; v.z = (v.z + best[1]) / 2; v.w = clamp(v.w + bd * 0.5, 2 * D.minHalfW, 2 * D.maxHalfW + 2); v.dual = true; }
  }
  // cfg.removeJogs: centring only some vertices of a junction can leave short
  // back-and-forth jogs: drop runs of up to 3 vertices whose short detour
  // (< 30 m) nearly doubles back on itself
  for (let changed = !!cfg.removeJogs; changed;) {
    changed = false;
    for (let w = 1; w <= 3 && !changed; w++) {
      for (let k = 1; k + w < V.length && !changed; k++) {
        let len = 0;
        for (let j = k - 1; j < k + w; j++) len += Math.hypot(V[j + 1].x - V[j].x, V[j + 1].z - V[j].z);
        const direct = Math.hypot(V[k + w].x - V[k - 1].x, V[k + w].z - V[k - 1].z);
        if (len < 30 && direct < 0.55 * len) { V.splice(k, w); changed = true; }
      }
    }
  }

  // ---- simplify (closed Douglas-Peucker) -----------------------------------
  const dp = (pts, tol) => {
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const st = [[0, pts.length - 1]];
    while (st.length) {
      const [a, b] = st.pop();
      let bi = -1, bd = tol;
      const ax = pts[a].x, az = pts[a].z, ux = pts[b].x - ax, uz = pts[b].z - az, L = Math.hypot(ux, uz) || 1;
      for (let k = a + 1; k < b; k++) {
        const d = Math.abs((pts[k].x - ax) * uz - (pts[k].z - az) * ux) / L;
        if (d > bd) { bd = d; bi = k; }
      }
      if (bi >= 0) { keep[bi] = 1; st.push([a, bi], [bi, b]); }
    }
    return pts.filter((_, k) => keep[k]);
  };
  // open the loop at the vertex farthest from vertex 0 so both halves simplify cleanly
  V.forEach((v, k) => { v.idx = k; });
  let far = 0, fd = 0;
  V.forEach((v, k) => { const d = Math.hypot(v.x - V[0].x, v.z - V[0].z); if (d > fd) { fd = d; far = k; } });
  const half1 = dp(V.slice(0, far + 1), 0.8), half2 = dp([...V.slice(far), V[0]], 0.8);
  let Pl = [...half1, ...half2.slice(1, -1)];
  // merge vertices closer than 3 m
  Pl = Pl.filter((v, k) => k === 0 || Math.hypot(v.x - Pl[k - 1].x, v.z - Pl[k - 1].z) > 3);
  const n = Pl.length;
  // width of each simplified segment: length-weighted over the OSM edges it covers
  const segW = Pl.map((v, k) => {
    const ib = Pl[(k + 1) % n].idx;
    let sw = 0, sl = 0;
    for (let j = v.idx; j !== ib;) {
      const j1 = (j + 1) % V.length;
      const l = Math.hypot(V[j1].x - V[j].x, V[j1].z - V[j].z);
      sw += V[j1].w * l; sl += l;
      j = j1;
    }
    return sl > 0 ? sw / sl : v.w;
  });

  // ---- corridor + intersections + escapes (on the real street geometry) ----
  const seg = (k) => { const a = Pl[k], b = Pl[(k + 1) % n]; return { a, b, w: segW[k], len: Math.hypot(b.x - a.x, b.z - a.z) }; };
  const corridor = [];
  for (let k = 0; k < n; k++) {
    const s = seg(k);
    corridor.push(+s.a.x.toFixed(1), +s.a.z.toFixed(1), +s.b.x.toFixed(1), +s.b.z.toFixed(1), +(s.w / 2).toFixed(2));
  }

  // ---- fillets ---------------------------------------------------------------
  const out = []; // {x, z, w}
  const turn = (k) => {
    const a = Pl[(k - 1 + n) % n], b = Pl[k], c = Pl[(k + 1) % n];
    const h0 = Math.atan2(b.x - a.x, b.z - a.z), h1 = Math.atan2(c.x - b.x, c.z - b.z);
    let d = h1 - h0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  };
  const fil = [];
  for (let k = 0; k < n; k++) {
    const th = Math.abs(turn(k));
    const wv = Math.max(segW[(k - 1 + n) % n], segW[k]);
    let R = th > 0.9 ? wv / 2 + 7 : th > 0.35 ? 45 : 140;
    const lp = seg((k - 1 + n) % n).len, ln = seg(k).len;
    const tmax = 0.5 * Math.min(lp, ln);
    if (th > 0.01) R = Math.min(R, tmax / Math.tan(th / 2));
    fil.push({ th, R, T: th > 0.01 ? R * Math.tan(th / 2) : 0 });
  }
  for (let k = 0; k < n; k++) {
    const a = Pl[(k - 1 + n) % n], b = Pl[k], c = Pl[(k + 1) % n];
    const { T, th } = fil[k];
    const l0 = Math.hypot(b.x - a.x, b.z - a.z), l1 = Math.hypot(c.x - b.x, c.z - b.z);
    const u0 = [(b.x - a.x) / l0, (b.z - a.z) / l0], u1 = [(c.x - b.x) / l1, (c.z - b.z) / l1];
    const wIn = segW[(k - 1 + n) % n], wOut = segW[k];
    if (T < 0.05) { out.push({ x: b.x, z: b.z, w: wIn, k }, { x: b.x, z: b.z, w: wOut, k }); continue; }
    const p0 = [b.x - u0[0] * T, b.z - u0[1] * T], p1 = [b.x + u1[0] * T, b.z + u1[1] * T];
    // quadratic-ish arc via circular interpolation of the tangent direction
    const steps = Math.max(2, Math.ceil((th * fil[k].R) / 1.5));
    const h0 = Math.atan2(u0[0], u0[1]), dh = turn(k);
    let x = p0[0], z = p0[1];
    const arcLen = th * fil[k].R, dsA = arcLen / steps;
    for (let s = 0; s <= steps; s++) {
      out.push({ x, z, w: s < steps / 2 ? wIn : wOut, k });
      const h = h0 + dh * ((s + 0.5) / steps);
      x += Math.sin(h) * dsA; z += Math.cos(h) * dsA;
    }
    // snap the arc end onto the exact tangent point
    out[out.length - 1].x = p1[0]; out[out.length - 1].z = p1[1];
  }

  // ---- resample at STEP -------------------------------------------------------
  const m = out.length;
  const cum = [0];
  for (let k = 1; k <= m; k++) cum.push(cum[k - 1] + Math.hypot(out[k % m].x - out[k - 1].x, out[k % m].z - out[k - 1].z));
  const L = cum[m];
  const NP = Math.round(L / STEP);
  let pts = [];
  for (let k = 0, j = 0; k < NP; k++) {
    const s = (k * L) / NP;
    while (cum[j + 1] < s) j++;
    const t = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    const A = out[j], B = out[(j + 1) % m];
    pts.push({ x: A.x + (B.x - A.x) * t, z: A.z + (B.z - A.z) * t, w: A.w + (B.w - A.w) * t });
  }
  // start line = point nearest waypoint 0
  const [sx, sz] = P(cfg.route[0]);
  let i0 = 0, bd0 = 1e9;
  pts.forEach((p, k) => { const d = Math.hypot(p.x - sx, p.z - sz); if (d < bd0) { bd0 = d; i0 = k; } });
  pts = [...pts.slice(i0), ...pts.slice(0, i0)];
  // course elevation: the DEM under each point, or, with cfg.elevation.anchors
  // ([[lat, lon, metres], ...] spot heights; for cities whose DEMs are too noisy
  // to race on), a smooth profile through the anchors with the grade capped at
  // cfg.elevation.maxGrade (default 6%). The DEM grid is then shifted to sit on
  // the anchored profile on average, so the surrounding ground still matches.
  let courseY = pts.map((p) => demAt(p.x, p.z)), demShift = 0;
  if (cfg.elevation.anchors) {
    const np = pts.length, segL = pts.map((p, k) => Math.hypot(pts[(k + 1) % np].x - p.x, pts[(k + 1) % np].z - p.z));
    const an = cfg.elevation.anchors.map(([la, lo, m]) => {
      const [x, z] = P([la, lo]);
      let bk = 0, bd = Infinity;
      pts.forEach((p, k) => { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; bk = k; } });
      return [bk, m];
    }).sort((a, b) => a[0] - b[0]);
    // piecewise linear between anchors around the loop
    for (let a = 0; a < an.length; a++) {
      const [k0, m0] = an[a], [k1w, m1] = an[(a + 1) % an.length];
      const k1 = a + 1 < an.length ? k1w : k1w + np;
      for (let k = k0; k < k1; k++) courseY[k % np] = m0 + ((m1 - m0) * (k - k0)) / (k1 - k0 || 1);
    }
    // round off the kinks (~60 m moving average, 3 passes)
    const r = Math.max(1, Math.round(30 / STEP));
    for (let pass = 0; pass < 3; pass++) {
      const src = courseY.slice();
      for (let k = 0; k < np; k++) { let s = 0; for (let j = -r; j <= r; j++) s += src[(k + j + np) % np]; courseY[k] = s / (2 * r + 1); }
    }
    // cap the grade: relax any step steeper than maxGrade symmetrically
    const g = cfg.elevation.maxGrade ?? 0.06;
    for (let pass = 0, changed = true; changed && pass < 2000; pass++) {
      changed = false;
      for (let k = 0; k < np; k++) {
        const k1 = (k + 1) % np, d = courseY[k1] - courseY[k], lim = g * segL[k];
        if (Math.abs(d) > lim + 1e-6) { const e = ((Math.abs(d) - lim) / 2) * Math.sign(d); courseY[k] += e; courseY[k1] -= e; changed = true; }
      }
    }
    demShift = pts.reduce((s, p, k) => s + demAt(p.x, p.z) - courseY[k], 0) / np;
  }
  const y0 = courseY[0];

  // spatial index of course points for "near the course" tests
  const cell = 50, cgrid = new Map();
  pts.forEach((p, k) => {
    const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
    if (!cgrid.has(key)) cgrid.set(key, []);
    cgrid.get(key).push(k);
  });
  const courseDist = (x, z, r = NEAR) => {
    let bd = Infinity;
    const c0 = Math.floor((x - r) / cell), c1 = Math.floor((x + r) / cell), d0 = Math.floor((z - r) / cell), d1 = Math.floor((z + r) / cell);
    for (let a = c0; a <= c1; a++) for (let b = d0; b <= d1; b++) {
      for (const k of cgrid.get(`${a},${b}`) || []) bd = Math.min(bd, Math.hypot(pts[k].x - x, pts[k].z - z));
    }
    return bd;
  };
  const uOf = (x, z) => {
    let bk = 0, bd = 1e9;
    pts.forEach((p, k) => { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; bk = k; } });
    return bk / pts.length;
  };

  // intersections along the course: cross streets leaving each path node
  const pathNodes = new Set(V.map((v) => v.node));
  const inter = [];
  const seenInter = new Set();
  for (const v of V) {
    const edges = (adj.get(v.node) || []).filter((e) => !pathNodes.has(e.to) && e.way.tags.highway !== 'service');
    if (!edges.length) continue;
    const p = nodePos.get(v.node);
    if (courseDist(p[0], p[1], 40) > 12) continue; // dual-carriageway twin etc.
    const key = `${Math.round(p[0] / 8)},${Math.round(p[1] / 8)}`;
    if (seenInter.has(key)) continue;
    seenInter.add(key);
    const dirs = [];
    for (const e of edges) {
      const q = nodePos.get(e.to);
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      dirs.push([+((q[0] - p[0]) / l).toFixed(3), +((q[1] - p[1]) / l).toFixed(3), +(roadW(e.way.tags) / 2).toFixed(1), e.way.tags.highway === 'pedestrian' || e.way.tags.highway === 'living_street' ? 1 : 0]);
    }
    inter.push({ x: +p[0].toFixed(1), z: +p[1].toFixed(1), dirs });
  }

  // escape roads: at sharp corners where the approach street carries on
  const escapes = [];
  for (let k = 0; k < n; k++) {
    if (fil[k].th < 0.9) continue;
    const a = Pl[(k - 1 + n) % n], b = Pl[k];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    const dx = (b.x - a.x) / l, dz = (b.z - a.z) / l;
    let best = null;
    for (const e of adj.get(b.node) || []) {
      if (!DRIVE.test(e.way.tags.highway) || e.way.tags.highway === 'service') continue;
      const q = nodePos.get(e.to);
      const ll = Math.hypot(q[0] - b.x, q[1] - b.z);
      if ((q[0] - b.x) / ll * dx + (q[1] - b.z) / ll * dz < 0.93) continue;
      // walk on while the street stays straight
      let len = ll, cur = e.to, prevN = b.node;
      while (len < 70) {
        const nx = (adj.get(cur) || []).find((f) => f.to !== prevN && f.way.id === e.way.id);
        if (!nx) break;
        const r = nodePos.get(nx.to), c = nodePos.get(cur);
        const sl = Math.hypot(r[0] - c[0], r[1] - c[1]) || 1;
        if ((r[0] - c[0]) / sl * dx + (r[1] - c[1]) / sl * dz < 0.97) break;
        len += sl; prevN = cur; cur = nx.to;
      }
      if (!best || len > best.len) best = { len, w: roadW(e.way.tags) };
    }
    if (best && best.len > 30) {
      escapes.push({
        x: +b.x.toFixed(1), z: +b.z.toFixed(1), dx: +dx.toFixed(4), dz: +dz.toFixed(4),
        hw: +(Math.min(best.w, segW[(k - 1 + n) % n]) / 2 - 0.6).toFixed(1), len: +Math.min(60, best.len - 6).toFixed(0),
      });
    }
  }
  // cfg.escapes: [lat, lon, len] extra escape roads straight on from the course
  // vertex nearest (lat, lon), down a real street the auto-detection misses
  // (dual-carriageway junctions split the corner over several vertices)
  for (const [la, lo, len] of cfg.escapes || []) {
    const [x, z] = P([la, lo]);
    let k = 0, bd = Infinity;
    Pl.forEach((v, j) => { const d = Math.hypot(v.x - x, v.z - z); if (d < bd) { bd = d; k = j; } });
    const a = Pl[(k - 1 + n) % n], b = Pl[k], l = Math.hypot(b.x - a.x, b.z - a.z);
    escapes.push({
      x: +b.x.toFixed(1), z: +b.z.toFixed(1), dx: +((b.x - a.x) / l).toFixed(4), dz: +((b.z - a.z) / l).toFixed(4),
      hw: +(segW[(k - 1 + n) % n] / 2 - 0.6).toFixed(1), len,
    });
  }

  // ---- buildings ---------------------------------------------------------------
  const ringArea = (r) => { let s = 0; for (let k = 0; k < r.length; k++) { const p = r[k], q = r[(k + 1) % r.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };
  const pip = (x, z, r) => {
    let c = false;
    for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
      if ((r[a][1] > z) !== (r[b][1] > z) && x < ((r[b][0] - r[a][0]) * (z - r[a][1])) / (r[b][1] - r[a][1]) + r[a][0]) c = !c;
    }
    return c;
  };
  // closed ring simplification: split at the vertex farthest from vertex 0
  const dpRing = (ring, tol) => {
    let r = ring;
    const f = r[0], l = r[r.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 0.1) r = r.slice(0, -1);
    if (r.length < 5) return r;
    let far = 0, fd = 0;
    r.forEach((p, k) => { const d = Math.hypot(p[0] - r[0][0], p[1] - r[0][1]); if (d > fd) { fd = d; far = k; } });
    const pts2 = r.map(([x, z]) => ({ x, z }));
    const a = dp(pts2.slice(0, far + 1), tol), b = dp([...pts2.slice(far), pts2[0]], tol);
    return [...a, ...b.slice(1, -1)].map((p) => [p.x, p.z]);
  };
  // join relation member ways into closed rings
  const assemble = (members) => {
    const segs2 = members.map((m2) => m2.g.filter(Boolean).map(P)).filter((g) => g.length > 1);
    const rings = [];
    const same = (p, q) => Math.abs(p[0] - q[0]) < 0.05 && Math.abs(p[1] - q[1]) < 0.05;
    while (segs2.length) {
      let ring = segs2.shift();
      for (let guard = 0; guard < 500 && !same(ring[0], ring[ring.length - 1]); guard++) {
        const last = ring[ring.length - 1];
        const k = segs2.findIndex((s) => same(s[0], last) || same(s[s.length - 1], last));
        if (k < 0) break;
        const s = segs2.splice(k, 1)[0];
        ring = ring.concat(same(s[0], last) ? s.slice(1) : s.reverse().slice(1));
      }
      if (ring.length > 3) rings.push(ring);
    }
    return rings;
  };
  const num = (v) => { const f = parseFloat(String(v || '').replace(',', '.')); return Number.isFinite(f) ? f : null; };
  const MAT = { glass: 1, brick: 2, stone: 3, limestone: 3, sandstone: 3, granite: 3, marble: 3, concrete: 4, metal: 5, steel: 5, plaster: 6, render: 6, wood: 7 };
  const shapes = [];
  const addShape = (ring, tags, isPart, osmId) => {
    if (!ring || ring.length < 4) return;
    let r = ring.slice();
    const f = r[0], l = r[r.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 0.1) r.pop();
    if (r.length < 3) return;
    if (ringArea(r) < 0) r.reverse(); // CCW in x/z (z south) = CW on the map
    if (Math.abs(ringArea(r)) < 10) return;
    let h = num(tags.height), mh = num(tags.min_height);
    const lv = num(tags['building:levels']), mlv = num(tags['building:min_level']);
    if (h == null && lv != null) h = lv * D.storey + 1.5;
    if (mh == null && mlv != null) mh = mlv * D.storey;
    if (tags.building === 'roof' || tags['building:part'] === 'roof') { if (mh == null) return; }
    if ((num(tags.layer) ?? 0) < 0 || /train_station|underground/.test(tags.building || '')) return;
    const cx = r.reduce((s, p) => s + p[0], 0) / r.length, cz = r.reduce((s, p) => s + p[1], 0) / r.length;
    const dist = courseDist(cx, cz, NEAR + 60);
    const tall = (h ?? 0) >= cfg.skylineMinH;
    if (dist > NEAR && !tall) return;
    shapes.push({ r, h, mh: mh || 0, tags, isPart, cx, cz, dist, id: osmId });
  };
  for (const e of els) {
    const t = e.tags;
    if (!(t.building || t['building:part'])) continue;
    const part = !!t['building:part'] && !t.building;
    if (e.t === 'w') addShape(e.g.filter(Boolean).map(P), t, part, e.id);
    else if (e.t === 'r') for (const ring of assemble(e.members.filter((mm) => mm.role !== 'inner'))) addShape(ring, t, part, e.id);
  }
  // outlines that contain parts are drawn by their parts instead
  const parts = shapes.filter((s) => s.isPart);
  const pgrid = new Map();
  for (const p of parts) { const key = `${Math.floor(p.cx / 60)},${Math.floor(p.cz / 60)}`; if (!pgrid.has(key)) pgrid.set(key, []); pgrid.get(key).push(p); }
  const hasParts = (s) => {
    const minx = Math.min(...s.r.map((p) => p[0])), maxx = Math.max(...s.r.map((p) => p[0]));
    const minz = Math.min(...s.r.map((p) => p[1])), maxz = Math.max(...s.r.map((p) => p[1]));
    for (let a = Math.floor(minx / 60); a <= Math.floor(maxx / 60); a++) for (let b = Math.floor(minz / 60); b <= Math.floor(maxz / 60); b++) {
      for (const p of pgrid.get(`${a},${b}`) || []) if (pip(p.cx, p.cz, s.r)) return true;
    }
    return false;
  };
  const blds = shapes.filter((s) => s.isPart || !hasParts(s));
  const bStream = [];
  const names = [];
  let nb = 0;
  for (const s of blds) {
    const r = dpRing(s.r, s.dist > NEAR ? 1.5 : 0.6);
    if (r.length < 3) continue;
    let h = s.h ?? (s.tags.building === 'church' ? 30 : D.buildingH * (0.6 + 0.8 * (((s.id * 2654435761) >>> 0) / 4294967296)));
    if (h <= s.mh + 0.5) continue;
    let col = -1;
    const c = String(s.tags['building:colour'] || s.tags['roof:colour'] || '');
    const mt = /^#?([0-9a-f]{6})$/i.exec(c);
    if (mt) { const v = parseInt(mt[1], 16); col = (((v >> 19) & 31) << 10) | (((v >> 11) & 31) << 5) | ((v >> 3) & 31); }
    const mat = MAT[String(s.tags['building:material'] || '').toLowerCase()] || 0;
    const roof = /pyramid|hipped|dome|spire|gabled/.test(s.tags['roof:shape'] || '') ? 1 : 0;
    const flags = (s.isPart ? 1 : 0) | (roof << 1) | (s.dist > NEAR ? 4 : 0) | (s.tags.building === 'church' || s.tags.amenity === 'place_of_worship' ? 8 : 0);
    bStream.push(r.length, Math.round(h * Q), Math.round(s.mh * Q), mat, col, flags);
    let px = Math.round(r[0][0] * Q), pz = Math.round(r[0][1] * Q);
    bStream.push(px, pz);
    for (let k = 1; k < r.length; k++) {
      const qx = Math.round(r[k][0] * Q), qz = Math.round(r[k][1] * Q);
      bStream.push(qx - px, qz - pz); px = qx; pz = qz;
    }
    if (s.tags.name && (s.h ?? 0) > 0) names.push([nb, s.tags.name]);
    nb++;
  }

  // ---- streets (drawn), plazas, parks, water --------------------------------------
  const inBox = (p, pad = 0) => p[0] > bx0 - pad && p[0] < bx1 + pad && p[1] > bz0 - pad && p[1] < bz1 + pad;
  const sStream = [];
  let ns = 0;
  for (const w of ways) {
    const t = w.tags;
    if (!t.highway || t.tunnel || t.area === 'yes') continue;
    // kind: 0 road, 1 pedestrian/living street, 2 service, 3 elevated expressway (viaduct)
    const layer = clamp(Math.round(num(t.layer) ?? (t.bridge ? 1 : 0)), 0, 7);
    let kind;
    if (/^motorway(_link)?$/.test(t.highway)) {
      if (!t.bridge && layer < 1) continue; // at-grade or sunken expressway: not drawn
      kind = 3;
    } else if (/^(trunk|primary|secondary|tertiary|unclassified|residential)(_link)?$/.test(t.highway)) kind = 0;
    else if (/^(pedestrian|living_street)$/.test(t.highway)) kind = 1;
    else if (t.highway === 'service' && !t.service) kind = 2;
    else continue;
    const g = w.g.filter(Boolean).map(P);
    const reach = kind === 3 ? 600 : NEAR + 60; // viaducts read from far away
    if (!g.some((p) => inBox(p, kind === 3 ? 400 : 0) && courseDist(p[0], p[1], reach + 20) < reach)) continue;
    const r = dp(g.map(([x, z]) => ({ x, z })), 0.8);
    const wd = kind === 0 || kind === 3 ? roadW(t) : kind === 1 ? clamp(num(t.width) || 8, 4, 14) : 5;
    sStream.push(r.length, Math.round(wd * Q), kind | (courseWays.has(w.id) ? 4 : 0) | (kind === 3 ? Math.max(1, layer) << 3 : 0));
    let px = Math.round(r[0].x * Q), pz = Math.round(r[0].z * Q);
    sStream.push(px, pz);
    for (let k = 1; k < r.length; k++) { const qx = Math.round(r[k].x * Q), qz = Math.round(r[k].z * Q); sStream.push(qx - px, qz - pz); px = qx; pz = qz; }
    ns++;
  }
  // polygon areas: 0 park/grass, 1 water, 2 plaza (pedestrian area / square), 3 wood
  const clipRect = (ring, pad) => {
    let poly = ring;
    const edges = [[0, bx0 - pad, 1], [0, bx1 + pad, -1], [1, bz0 - pad, 1], [1, bz1 + pad, -1]];
    for (const [ax, v, sg] of edges) {
      const o = [];
      for (let k = 0; k < poly.length; k++) {
        const p = poly[k], q = poly[(k + 1) % poly.length];
        const pin = (p[ax] - v) * sg >= 0, qin = (q[ax] - v) * sg >= 0;
        if (pin) o.push(p);
        if (pin !== qin) { const t = (v - p[ax]) / (q[ax] - p[ax]); o.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
      }
      poly = o;
      if (poly.length < 3) return null;
    }
    return poly;
  };
  const aStream = [];
  let na = 0;
  const addArea = (ring, kind) => {
    // big parks (Central Park) reach well past the bbox so the horizon stays green
    let r = clipRect(ring, Math.abs(ringArea(ring)) > 200000 ? 700 : 50);
    if (!r) return;
    r = dpRing(r, 1.5);
    if (r.length < 3 || Math.abs(ringArea(r)) < 30) return;
    if (ringArea(r) < 0) r.reverse();
    const cx = r.reduce((s, p) => s + p[0], 0) / r.length, cz = r.reduce((s, p) => s + p[1], 0) / r.length;
    if (Math.abs(ringArea(r)) < 200000 && courseDist(cx, cz, NEAR + 400) > NEAR + 150) return;
    aStream.push(r.length, kind);
    let px = Math.round(r[0][0] * Q), pz = Math.round(r[0][1] * Q);
    aStream.push(px, pz);
    for (let k = 1; k < r.length; k++) { const qx = Math.round(r[k][0] * Q), qz = Math.round(r[k][1] * Q); aStream.push(qx - px, qz - pz); px = qx; pz = qz; }
    na++;
  };
  const areaKind = (t) => {
    if (t.natural === 'water' || t.amenity === 'fountain') return 1;
    if ((t.highway === 'pedestrian' && t.area === 'yes') || t.place === 'square') return 2;
    if (t.natural === 'wood' || t.landuse === 'forest') return 3;
    if (t.leisure || t.landuse || t.natural) return 0;
    return -1;
  };
  for (const e of els) {
    if (e.t === 'n') continue;
    const k = areaKind(e.tags);
    if (k < 0 || e.tags.building) continue;
    if (e.t === 'w') { const g = e.g.filter(Boolean).map(P); if (g.length > 3) addArea(g, k); }
    else for (const ring of assemble(e.members.filter((mm) => mm.role !== 'inner'))) addArea(ring, k);
  }

  // ---- point features --------------------------------------------------------------
  const POI = { tree: 0, subway: 1, hydrant: 2, postbox: 3, fountain: 4, artwork: 5, signals: 6, bench: 7 };
  const pStream = [];
  let np = 0;
  for (const e of els) {
    if (e.t !== 'n') continue;
    const t = e.tags;
    const k = t.natural === 'tree' ? POI.tree : t.railway === 'subway_entrance' ? POI.subway : t.emergency === 'fire_hydrant' ? POI.hydrant
      : t.amenity === 'post_box' ? POI.postbox : t.amenity === 'fountain' ? POI.fountain : t.tourism === 'artwork' || t.historic === 'memorial' ? POI.artwork
        : t.highway === 'traffic_signals' ? POI.signals : t.amenity === 'bench' ? POI.bench : -1;
    if (k < 0) continue;
    const p = P(e.ll);
    if (courseDist(p[0], p[1], NEAR + 60) > (k === POI.tree ? NEAR + 40 : NEAR)) continue;
    pStream.push(k, Math.round(p[0] * Q), Math.round(p[1] * Q));
    np++;
  }

  // ---- DEM grid (decimetres relative to the start line) ---------------------------
  const demStream = dem.values.map((v) => Math.round(((v ?? y0) - demShift - y0) * 10));

  const b64 = (arr) => {
    const i16 = Int16Array.from(arr.map((v) => clamp(Math.round(v), -32768, 32767)));
    for (let k = 0; k < arr.length; k++) if (Math.abs(arr[k]) > 32767) throw new Error(`${id}: int16 overflow ${arr[k]}`);
    return Buffer.from(i16.buffer).toString('base64');
  };

  const lenM = pts.reduce((s, p, k) => s + Math.hypot(pts[(k + 1) % pts.length].x - p.x, pts[(k + 1) % pts.length].z - p.z), 0);
  console.log(`${id}: ${pts.length} pts, ${lenM.toFixed(0)} m, ${n} polyline vertices, ${inter.length} intersections, ${escapes.length} escapes, ${nb} buildings, ${ns} streets, ${na} areas, ${np} pois`);
  return {
    origin: { lat: lat0, lon: lon0, kx, ky },
    bounds: [bx0, bz0, bx1, bz1].map((v) => Math.round(v)),
    length: Math.round(lenM),
    points: pts.flatMap((p) => [+p.x.toFixed(2), +p.z.toFixed(2)]),
    pointW: pts.map((p) => +p.w.toFixed(1)),
    pointY: courseY.map((v) => +(v - y0).toFixed(2)),
    corridor,
    escapes,
    intersections: inter.map((it) => [it.x, it.z, ...it.dirs.flat()]),
    corners: (cfg.corners || []).map(([la, lo, name]) => [+uOf(...P([la, lo])).toFixed(4), name]).sort((a, b) => a[0] - b[0]),
    dem: { nx: dem.nx, ny: dem.ny, bbox: dem.bbox, base: +y0.toFixed(2), data: b64(demStream) },
    buildings: { count: nb, data: b64(bStream), names },
    streets: { count: ns, data: b64(sStream) },
    areas: { count: na, data: b64(aStream) },
    pois: { count: np, data: b64(pStream) },
    osmTimestamp: raw.osm.timestamp,
  };
}

const only = process.argv[2];
const outData = {};
for (const [id, cfg] of Object.entries(CITIES)) {
  if (only && id !== only) continue;
  const d = genCity(id, cfg);
  if (d) outData[id] = d;
}
// keep previously generated cities when regenerating one
const outFile = path.join(here, '../src/cityData.generated.js');
if (only && fs.existsSync(outFile)) {
  const prev = fs.readFileSync(outFile, 'utf8');
  for (const m of prev.matchAll(/^ {2}"?([a-z0-9]+)"?: (\{.*\}),$/gm)) if (!(m[1] in outData)) outData[m[1]] = JSON.parse(m[2]);
}
let js = '// AUTO-GENERATED by tools/gen-cities.mjs - do not edit.\n';
js += '// Street-course data derived from OpenStreetMap: (c) OpenStreetMap contributors, ODbL 1.0\n';
js += '// (https://www.openstreetmap.org/copyright). Elevation: opentopodata.org (USGS NED 10 m for New York,\n';
js += '// SRTM 30 m for Tokyo; EU-DEM 25 m for Madrid, (c) European Union, Copernicus Land Monitoring Service).\n';
js += '// points: [x0, z0, x1, z1, ...] metres (x east, z south), ~4 m spacing, race direction,\n';
js += '// index 0 = start line. Geometry streams are base64 Int16 in 0.5 m units (see src/city/cityData.js).\n';
js += 'export const CITY_DATA = {\n';
// config order, so the file is identical whichever city was regenerated last
const order = [...Object.keys(CITIES), ...Object.keys(outData).filter((id) => !(id in CITIES))];
for (const id of order) if (outData[id]) js += `  ${id}: ${JSON.stringify(outData[id])},\n`;
js += '};\n';
fs.writeFileSync(outFile, js);
for (const [id, d] of Object.entries(outData)) console.log(`  ${id}: ${(JSON.stringify(d).length / 1024).toFixed(1)} KB`);
console.log('wrote src/cityData.generated.js', (js.length / 1024).toFixed(1), 'KB');
