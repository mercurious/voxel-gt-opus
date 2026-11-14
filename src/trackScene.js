// Builds the rendered world for a track: road ribbon, kerbs, run-off, walls,
// voxel terrain (near + far LOD), trees, grandstands, pits, gantry with start
// lights, brake boards, sponsor boards, landmarks, sky, clouds and mountains.
import * as THREE from 'three';
import { BoxBuilder } from './voxel.js';
import { hash2, hash1, fbm, smoothstep, clamp, lerp, rng } from './util.js';
import { SURF_ID } from './trackCore.js';
import {
  lambert, pick, SPONSORS, textTexture, buildSkyAndLights, addStartGrid, buildGantry,
  buildBrakeBoards, buildClouds, makeDrivingLine,
} from './sceneCommon.js';

const UP = [0, 1, 0];

// ---------------------------------------------------------------------------
export function buildTrackScene(track, opts = {}) {
  const def = track.def, th = def.theme;
  const quality = opts.quality || 'high';
  const hi = quality === 'high';
  const group = new THREE.Group();
  const N = track.N, ds = track.ds;
  const { px, pz, py, nx, nz, tx, tz, halfW } = track;
  const disposables = [];
  const animated = [];
  const keep = (o) => { disposables.push(o); return o; };

  // ---- sky, sun, lights ---------------------------------------------------
  const env = buildSkyAndLights(group, def, hi, keep);

  // ---- road ribbon ---------------------------------------------------------
  const CHUNK = 150; // samples per road/wall chunk, so they frustum-cull
  const roadMat = keep(lambert());
  let roadB = new BoxBuilder();
  const flushRoad = () => {
    if (!roadB.count) return;
    const m = new THREE.Mesh(keep(roadB.build()), roadMat);
    m.receiveShadow = true;
    group.add(m);
    roadB = new BoxBuilder();
  };
  const asphalt = th.asphalt;
  const runoffCols = th.runoffPaint;
  for (let i = 0; i < N; i++) {
    if (i % CHUNK === 0) flushRoad();
    const j = (i + 1) % N;
    const y0 = py[i], y1 = py[j];
    const slope = (y1 - y0) / ds;
    const nrm = new THREE.Vector3(-tx[i] * slope, 1, -tz[i] * slope).normalize().toArray();
    const P = (k, off, lift = 0) => (k === 0
      ? [px[i] + nx[i] * off, y0 + lift, pz[i] + nz[i] * off]
      : [px[j] + nx[j] * off, y1 + lift, pz[j] + nz[j] * off]);
    const strip = (a0, a1, b0, b1, col, lift0 = 0, lift1 = 0) => {
      // offsets a (at i) and b (at j), from inner to outer; side sign baked in
      const p0 = P(0, a0, lift0), p1 = P(0, a1, lift1), p2 = P(1, b1, lift1), p3 = P(1, b0, lift0);
      // orientation: ensure CCW from above
      const ax = p1[0] - p0[0], az = p1[2] - p0[2], bx = p3[0] - p0[0], bz = p3[2] - p0[2];
      if (ax * bz - az * bx < 0) roadB.quad(p0, p1, p2, p3, col, nrm);
      else roadB.quad(p0, p3, p2, p1, col, nrm);
    };
    const tile = Math.floor(i / 3);
    for (const side of [1, -1]) {
      const wall0 = side > 0 ? track.wallL[i] : track.wallR[i];
      const wall1 = side > 0 ? track.wallL[j] : track.wallR[j];
      const sOf = (o) => o * side;
      const hA = hash2(tile, side * 7 + 1, 3), hB = hash2(tile, side * 7 + 2, 3);
      // asphalt lanes
      strip(0, sOf(halfW * 0.5), 0, sOf(halfW * 0.5), pick(asphalt, hA));
      strip(sOf(halfW * 0.5), sOf(halfW - 0.5), sOf(halfW * 0.5), sOf(halfW - 0.5), pick(asphalt, hB));
      strip(sOf(halfW - 0.5), sOf(halfW - 0.2), sOf(halfW - 0.5), sOf(halfW - 0.2), '#e9e9e4');
      strip(sOf(halfW - 0.2), sOf(halfW), sOf(halfW - 0.2), sOf(halfW), pick(asphalt, hA));
      // kerb or verge
      const kerb = track.kerb[i] & (side > 0 ? 1 : 2);
      const surf = side > 0 ? track.surfL[i] : track.surfR[i];
      if (kerb) {
        const red = (Math.floor(i / 1) % 2) === 0;
        strip(sOf(halfW), sOf(halfW + 1.1), sOf(halfW), sOf(halfW + 1.1), red ? '#d42a2a' : '#f2f2ee', 0.02, 0.09);
      } else {
        strip(sOf(halfW), sOf(halfW + 1.1), sOf(halfW), sOf(halfW + 1.1), surf === SURF_ID.runoff ? pick(runoffCols, hB) : pick(th.grass, hash2(i, side, 9)), -0.02, -0.02);
      }
      // run-off bands to the wall
      const r0 = halfW + 1.1;
      const bands = 3;
      for (let b = 0; b < bands; b++) {
        const a0 = lerp(r0, wall0 + 0.3, b / bands), a1 = lerp(r0, wall0 + 0.3, (b + 1) / bands);
        const c0 = lerp(r0, wall1 + 0.3, b / bands), c1 = lerp(r0, wall1 + 0.3, (b + 1) / bands);
        const hh = hash2(Math.floor(i / 2), b + side * 11, 5);
        let col;
        if (surf === SURF_ID.gravel && b < 2) col = pick(th.gravel, hh);
        else if (surf === SURF_ID.runoff && b < 2) col = b === 0 ? pick(runoffCols, hh) : pick(asphalt, hh);
        else col = pick(th.grass, hh);
        strip(sOf(a0), sOf(a1), sOf(c0), sOf(c1), col, -0.03, -0.03);
      }
    }
  }
  flushRoad();

  // ---- start/finish line, grid boxes ---------------------------------------
  const decoB = new BoxBuilder();
  addStartGrid(track, decoB);

  // ---- walls ----------------------------------------------------------------
  const wallMat = keep(lambert());
  let wallB = new BoxBuilder();
  const flushWall = () => {
    if (!wallB.count) return;
    const m = new THREE.Mesh(keep(wallB.build()), wallMat);
    m.receiveShadow = true;
    m.castShadow = hi;
    group.add(m);
    wallB = new BoxBuilder();
  };
  const wallStyle = th.wall;
  for (let i = 0; i < N; i++) {
    if (i % CHUNK === 0) flushWall();
    const j = (i + 1) % N;
    for (const side of [1, -1]) {
      const w0 = side > 0 ? track.wallL[i] : track.wallR[i];
      const w1 = side > 0 ? track.wallL[j] : track.wallR[j];
      const ax = px[i] + nx[i] * w0 * side, az = pz[i] + nz[i] * w0 * side;
      const bx = px[j] + nx[j] * w1 * side, bz = pz[j] + nz[j] * w1 * side;
      const len = Math.hypot(bx - ax, bz - az) + 0.08;
      const rot = Math.atan2(bx - ax, bz - az);
      const cx = (ax + bx) / 2, cz = (az + bz) / 2, cy = (py[i] + py[j]) / 2;
      // W(a, b, ...): box from a to b metres outward of the wall line
      const W = (a, b, y0, y1, col) => wallB.box(side > 0 ? a : -b, y0, -len / 2, side > 0 ? b : -a, y1, len / 2, col, rot, cx, cy, cz);
      if (wallStyle === 'armco') {
        W(0.05, 0.4, -1.4, 0.45, '#6f7276');
        W(0, 0.12, 0.42, 0.85, '#c9ccd0');
        if (i % 2 === 0) wallB.box(side > 0 ? 0.12 : -0.3, -0.5, -0.08, side > 0 ? 0.3 : -0.12, 0.8, 0.08, '#8b8f94', rot, cx, cy, cz);
      } else if (wallStyle === 'tyres') {
        const band = Math.floor(i / 3) % 4 === 0;
        W(0, 0.6, -1.4, 0.5, band ? '#e9e9e9' : '#1e1e20');
        W(0, 0.6, 0.5, 1.0, band ? '#d32f2f' : '#28282a');
        W(0.6, 1.1, -1.4, 1.6, '#8a8f84');
      } else {
        const panel = Math.floor(i / 6) % 5;
        W(0, 0.4, -1.4, 1.0, '#b9bcbf');
        if (panel === 0) W(-0.02, 0, 0.2, 0.8, '#2c5aa0');
        if (panel === 3) W(-0.02, 0, 0.2, 0.8, '#c0392b');
        if (i % 3 === 0) W(0.3, 0.38, 1.0, 3.4, '#6d7378'); // catch-fence posts
        W(0.32, 0.36, 3.2, 3.32, '#7d8388'); // top rail
      }
    }
  }
  flushWall();

  // ---- terrain --------------------------------------------------------------
  const terr = buildTerrain(track, th, quality);
  for (const m of terr.meshes) group.add(m);
  disposables.push(...terr.disposables);

  // ---- bridges (track crossings) -------------------------------------------
  const propB = new BoxBuilder();
  for (const c of track.crossings) {
    const i = c.hi;
    const span = Math.ceil((Math.max(track.wallL[c.lo], track.wallR[c.lo]) + 4) / ds);
    for (let k = -span; k <= span; k++) {
      const a = (i + k + N) % N;
      const h = Math.atan2(tx[a], tz[a]);
      const wl = track.wallL[a], wr = track.wallR[a];
      propB.box(-wr - 0.5, -1.4, -ds / 2 - 0.05, wl + 0.5, -0.06, ds / 2 + 0.05, '#9a9a96', h, px[a], py[a], pz[a]);
      // parapets
      propB.box(wl, -0.06, -ds / 2, wl + 0.5, 1.1, ds / 2, '#c7c7c2', h, px[a], py[a], pz[a]);
      propB.box(-wr - 0.5, -0.06, -ds / 2, -wr, 1.1, ds / 2, '#c7c7c2', h, px[a], py[a], pz[a]);
    }
    // abutments along the lower road
    for (const sd of [1, -1]) {
      for (let k = -4; k <= 4; k++) {
        const a = (c.lo + k + N) % N;
        const w = (sd > 0 ? track.wallL[a] : track.wallR[a]) + 0.6;
        const h = Math.atan2(tx[a], tz[a]);
        const xx = px[a] + nx[a] * w * sd, zz = pz[a] + nz[a] * w * sd;
        propB.box(-0.8, -1, -ds / 2 - 0.05, 0.8, py[i] - py[a] - 0.2, ds / 2 + 0.05, '#8e8e8a', h, xx, py[a], zz);
      }
    }
  }

  // ---- grandstands -------------------------------------------------------------
  const crowdCols = ['#e63946', '#f1faee', '#457b9d', '#1d3557', '#ffb703', '#fb8500', '#2a9d8f', '#e9c46a', '#8338ec', '#ff006e', '#222'];
  for (const st of def.stands || []) {
    const ic = Math.round(st.u * N) % N;
    let side = st.side === 'L' ? 1 : st.side === 'R' ? -1 : 0;
    if (!side) {
      // outside of the nearby corner
      let acc = 0;
      for (let k = -20; k <= 20; k++) acc += track.curv[(ic + k + N) % N];
      side = acc > 0 ? -1 : 1;
    }
    const half = Math.round(st.len / 2 / ds);
    const rows = st.main ? 12 : 8;
    for (let k = -half; k < half; k += 3) {
      const a = (ic + k + N) % N;
      const wall = side > 0 ? track.wallL[a] : track.wallR[a];
      const base = wall + 2.5;
      const h = Math.atan2(tx[a], tz[a]);
      const ox = px[a] + nx[a] * base * side, oz = pz[a] + nz[a] * base * side, oy = py[a];
      const len = ds * 3 + 0.05;
      const sx = (x) => x * side; // local x outward
      const B = (x0, y0, x1, y1, z0, z1, col) => propB.box(Math.min(sx(x0), sx(x1)), y0, z0, Math.max(sx(x0), sx(x1)), y1, z1, col, h, ox, oy, oz);
      B(0, -3, rows * 0.9 + 1, 0.4, -len / 2, len / 2, '#8d8f93');
      for (let r = 0; r < rows; r++) {
        const y = 0.4 + r * 0.62;
        B(r * 0.9, -1, (r + 1) * 0.9, y, -len / 2, len / 2, r % 2 ? '#b8bcc2' : '#a7abb1');
        // crowd
        for (let q = 0; q < 6; q++) {
          const hh = hash2(a * 13 + q, r, 77);
          if (hh < 0.18) continue;
          const z0 = -len / 2 + (q + 0.15) * (len / 6);
          B(r * 0.9 + 0.3, y, r * 0.9 + 0.75, y + 0.55 + hh * 0.2, z0, z0 + len / 6 * 0.6, crowdCols[Math.floor(hh * crowdCols.length)]);
        }
      }
      B(rows * 0.9, -1, rows * 0.9 + 0.6, rows * 0.62 + 3.4, -len / 2, len / 2, '#6c7076');
      if (st.main || rows >= 8) {
        B(-0.5, rows * 0.62 + 3.4, rows * 0.9 + 0.6, rows * 0.62 + 3.8, -len / 2, len / 2, st.main ? '#d8dbe0' : '#c33');
        if (k % 9 === 0) B(-0.3, 0.4, 0, rows * 0.62 + 3.4, -0.15, 0.15, '#55595f');
      }
    }
  }

  // ---- pit building ------------------------------------------------------------
  if (def.pits) {
    const p = def.pits;
    const ic = Math.round(p.u * N) % N;
    const side = p.side === 'L' ? 1 : -1;
    const half = Math.round(p.len / 2 / ds);
    for (let k = -half; k < half; k += 2) {
      const a = (ic + k + N) % N;
      const wall = side > 0 ? track.wallL[a] : track.wallR[a];
      const h = Math.atan2(tx[a], tz[a]);
      const base = wall + 12; // pit lane between wall and garages
      const ox = px[a] + nx[a] * base * side, oz = pz[a] + nz[a] * base * side, oy = py[a];
      const len = ds * 2 + 0.05;
      const B = (x0, y0, x1, y1, col) => propB.box(Math.min(x0 * side, x1 * side), y0, -len / 2, Math.max(x0 * side, x1 * side), y1, len / 2, col, h, ox, oy, oz);
      const bay = Math.floor((k + half) / 4);
      B(0, -2, 16, 7.5, '#e7e7e2');
      B(-0.05, 0.2, 0.05, 4, bay % 2 ? '#2a2d34' : '#3b3f47'); // garage doors
      B(-0.06, 4.6, 0.06, 6.6, '#2b3a4a'); // glass strip
      B(-1.6, 7.5, 16, 8.0, '#c8102e');
      // pit lane surface + wall
      const pl = wall + 1;
      const B2 = (x0, y0, x1, y1, col) => propB.box(Math.min(x0 * side, x1 * side), y0, -len / 2, Math.max(x0 * side, x1 * side), y1, len / 2, col, h, px[a] + nx[a] * pl * side, oy, pz[a] + nz[a] * pl * side);
      B2(0, -1, 11, 0.01, '#4a4d52');
      B2(4.6, 0.01, 4.8, 0.02, '#f0f0f0');
    }
    // control tower
    const a = ic;
    const h = Math.atan2(tx[a], tz[a]);
    const wall = side > 0 ? track.wallL[a] : track.wallR[a];
    const ox = px[a] + nx[a] * (wall + 20) * side, oz = pz[a] + nz[a] * (wall + 20) * side;
    propB.box(-5, 0, -5, 5, 22, 5, '#dfe2e6', h, ox, py[a], oz);
    propB.box(-5.4, 16, -5.4, 5.4, 20, 5.4, '#2b3a4a', h, ox, py[a], oz);
    propB.box(-5.6, 22, -5.6, 5.6, 23, 5.6, '#c8102e', h, ox, py[a], oz);
  }

  // ---- start gantry + brake boards -------------------------------------------------
  const setLights = buildGantry(track, propB, group, keep);
  buildBrakeBoards(track, propB, group, keep);

  // ---- sponsor boards on straights -----------------------------------------------
  {
    const mats = SPONSORS.map(([t, bg, fg]) => keep(new THREE.MeshLambertMaterial({ map: keep(textTexture(t, bg, fg)) })));
    const geo = keep(new THREE.PlaneGeometry(10, 2.5));
    const R = rng(def.id.length * 977);
    let count = 0;
    for (let i = 0; i < N; i += Math.round(60 / ds)) {
      if (Math.abs(track.curv[i]) > 0.002 || R() < 0.45) continue;
      const side = R() < 0.5 ? 1 : -1;
      const wall = side > 0 ? track.wallL[i] : track.wallR[i];
      if (wall > halfW + 14) continue;
      const h = Math.atan2(tx[i], tz[i]);
      const off = wall + 1.2;
      const bx = px[i] + nx[i] * off * side, bz = pz[i] + nz[i] * off * side;
      const m = new THREE.Mesh(geo, mats[count++ % mats.length]);
      m.position.set(bx, py[i] + 2.6, bz);
      m.rotation.y = h + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      group.add(m);
      propB.box(-0.15, -1, -5, 0.15, 1.35, 5, '#2b2b2b', h, bx + nx[i] * side * 0.25, py[i], bz + nz[i] * side * 0.25);
    }
  }

  // ---- landmarks ---------------------------------------------------------------------
  if ((def.landmarks || []).includes('ferris')) {
    const a = Math.round(0.955 * N);
    const off = 150;
    const cx = px[a] + nx[a] * off, cz = pz[a] + nz[a] * off;
    const baseY = terr.heightAt(cx, cz);
    const R = 30;
    const wheel = new THREE.Group();
    const wb = new BoxBuilder();
    const segs = 48;
    for (let k = 0; k < segs; k++) {
      const ang = (k / segs) * Math.PI * 2;
      const x = Math.cos(ang) * R, y = Math.sin(ang) * R;
      wb.box(-1.2, -1.2, -0.8, 1.2, 1.2, 0.8, k % 2 ? '#f2f2f2' : '#e63946', 0, 0, 0, 0);
      // move: rebuild via matrix below
      const last = wb.pos.length - 24 * 3;
      for (let v = last; v < wb.pos.length; v += 3) { wb.pos[v] += x; wb.pos[v + 1] += y; }
    }
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * Math.PI * 2;
      for (let r = 2; r < R; r += 2) {
        const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
        wb.box(-0.35, -0.35, -0.35, 0.35, 0.35, 0.35, '#d9d9d9', 0, 0, 0, 0);
        const last = wb.pos.length - 24 * 3;
        for (let v = last; v < wb.pos.length; v += 3) { wb.pos[v] += x; wb.pos[v + 1] += y; }
      }
    }
    const wheelMesh = new THREE.Mesh(keep(wb.build()), keep(lambert()));
    wheel.add(wheelMesh);
    const gondolas = [];
    const gGeo = keep(new THREE.BoxGeometry(2.6, 2.6, 2.6));
    const gCols = ['#ffb703', '#219ebc', '#8ecae6', '#fb8500', '#e63946', '#2a9d8f'];
    for (let k = 0; k < 16; k++) {
      const m = new THREE.Mesh(gGeo, keep(new THREE.MeshLambertMaterial({ color: gCols[k % gCols.length] })));
      group.add(m);
      gondolas.push(m);
    }
    const hub = new THREE.Group();
    hub.position.set(cx, baseY + R + 6, cz);
    const ang0 = Math.atan2(tx[a], tz[a]);
    hub.rotation.y = ang0;
    hub.add(wheel);
    group.add(hub);
    // A-frame legs
    for (const sd of [-1, 1]) for (const lg of [-1, 1]) {
      const legB = new BoxBuilder();
      const steps = 14;
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        legB.box(-0.6, 0, -0.6, 0.6, (R + 6) / steps + 0.1, 0.6, '#cfd3d8', 0, lg * 12 * (1 - t), (R + 6) * t, sd * 3);
      }
      const leg = new THREE.Mesh(keep(legB.build()), keep(lambert()));
      leg.position.set(cx, baseY, cz);
      leg.rotation.y = ang0;
      group.add(leg);
    }
    const tmp = new THREE.Vector3();
    animated.push((t) => {
      wheel.rotation.z = t * 0.05;
      gondolas.forEach((g, k) => {
        const ang = (k / 16) * Math.PI * 2 + t * 0.05;
        tmp.set(Math.cos(ang) * R, Math.sin(ang) * R - 2.4, 0);
        tmp.applyEuler(hub.rotation).add(hub.position);
        g.position.copy(tmp);
        g.rotation.y = ang0;
      });
    });
  }
  if ((def.landmarks || []).includes('banking')) {
    // remains of the old high-speed oval, standing in the park
    const a = Math.round(0.58 * N);
    const inward = -1;
    const cx = px[a] + nx[a] * 260 * inward, cz = pz[a] + nz[a] * 260 * inward;
    const R = 190, base = terr.heightAt(cx, cz);
    const a0 = Math.atan2(px[a] - cx, pz[a] - cz);
    for (let k = -22; k <= 22; k++) {
      const ang = a0 + (k / 22) * 1.1;
      const x = cx + Math.sin(ang) * R, z = cz + Math.cos(ang) * R;
      for (let r = 0; r < 7; r++) {
        propB.box(-1.6, -2, -4.5, 1.6, 1.2 + r * 1.7, 4.5, r % 3 === 0 ? '#9fa19c' : '#b5b7b1', ang + Math.PI / 2, x + Math.sin(ang) * r * 1.6, base, z + Math.cos(ang) * r * 1.6);
      }
      if (k % 4 === 0) propB.box(-0.8, -2, -0.8, 0.8, 1.5, 0.8, '#7d7f7a', 0, x - Math.sin(ang) * 2, base, z - Math.cos(ang) * 2);
    }
  }

  const props = new THREE.Mesh(keep(propB.build()), keep(lambert()));
  props.castShadow = hi;
  props.receiveShadow = true;
  group.add(props);
  const deco = new THREE.Mesh(keep(decoB.build()), keep(lambert()));
  deco.receiveShadow = true;
  group.add(deco);

  // ---- trees ---------------------------------------------------------------------
  const trees = buildTrees(track, th, terr, quality);
  for (const m of trees.meshes) group.add(m);
  disposables.push(...trees.disposables);

  // ---- mountains + clouds ----------------------------------------------------------
  const far = new BoxBuilder();
  {
    const mt = th.mountains;
    const R = rng(def.id.length * 31 + 7);
    const cxm = terr.center[0], czm = terr.center[1];
    const baseR = terr.radius + mt.dist * 0.5;
    const col = new THREE.Color(mt.color).lerp(new THREE.Color(th.fog), 0.35);
    for (let k = 0; k < mt.count; k++) {
      const ang = (k / mt.count) * Math.PI * 2 + R() * 0.3;
      const dist = baseR + R() * mt.dist * 0.6;
      const H = mt.height * (0.45 + R() * 0.8);
      const W = H * (1.6 + R() * 1.4);
      const mx = cxm + Math.sin(ang) * dist, mz = czm + Math.cos(ang) * dist;
      const layers = 7;
      for (let l = 0; l < layers; l++) {
        const f = 1 - l / layers;
        const c = col.clone().multiplyScalar(0.85 + 0.15 * (l / layers));
        let hex = '#' + c.getHexString();
        if (mt.snow && l >= layers - 2) hex = '#f4f6f8';
        far.box(-W * f / 2, (H * l) / layers - 40, -W * f / 2, W * f / 2, (H * (l + 1)) / layers - 40, W * f / 2, hex, ang, mx, terr.minY, mz, { skipBottom: true });
      }
    }
  }
  const mountainMat = keep(new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }));
  const mountains = new THREE.Mesh(keep(far.build()), mountainMat);
  group.add(mountains);

  const clouds = buildClouds(def, keep, terr.center, terr.radius, terr.maxY);
  group.add(clouds);

  // ---- driving line --------------------------------------------------------------------
  const line = makeDrivingLine(track, group, keep);

  // ---- per-frame update -----------------------------------------------------------------
  let time = 0;
  const update = (dt, camera, focus) => {
    time += dt;
    env.update(camera, focus);
    mountains.position.set(0, 0, 0);
    clouds.position.x = Math.sin(time * 0.01) * 60;
    for (const f of animated) f(time);
  };

  return {
    group, update, setLights, setDrivingLine: line.set,
    fog: new THREE.Fog(th.fog, th.fogNear, th.fogFar * (hi ? 1 : 0.7)),
    background: new THREE.Color(th.fog),
    heightAt: terr.heightAt,
    dispose() {
      line.dispose();
      for (const d of disposables) d.dispose?.();
    },
  };
}

// ===========================================================================
// Terrain: near voxel field (fine cells) + far LOD ring.
function buildTerrain(track, th, quality) {
  const hi = quality === 'high';
  const { N, px, pz, py, nx, nz, tx, tz } = track;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < N; i++) {
    minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i]);
    minZ = Math.min(minZ, pz[i]); maxZ = Math.max(maxZ, pz[i]);
    minY = Math.min(minY, py[i]); maxY = Math.max(maxY, py[i]);
  }
  const band = th.trees.band + 60;
  const meshes = [], disposables = [];
  const mat = lambert();
  disposables.push(mat);

  // generic distance transform on a grid -> nearest track sample per cell
  function nearestField(x0, z0, C, gw, gh) {
    const near = new Int32Array(gw * gh).fill(-1);
    const d2 = new Float32Array(gw * gh).fill(1e18);
    for (let i = 0; i < N; i++) {
      const cx = Math.floor((px[i] - x0) / C), cz = Math.floor((pz[i] - z0) / C);
      if (cx < 0 || cz < 0 || cx >= gw || cz >= gh) continue;
      const k = cx + cz * gw;
      const ccx = x0 + (cx + 0.5) * C, ccz = z0 + (cz + 0.5) * C;
      const dd = (px[i] - ccx) ** 2 + (pz[i] - ccz) ** 2;
      if (dd < d2[k]) { d2[k] = dd; near[k] = i; }
    }
    const relax = (cx, cz, k, ox, oz) => {
      const ax = cx + ox, az = cz + oz;
      if (ax < 0 || az < 0 || ax >= gw || az >= gh) return;
      const j = near[ax + az * gw];
      if (j < 0) return;
      const ccx = x0 + (cx + 0.5) * C, ccz = z0 + (cz + 0.5) * C;
      const dd = (px[j] - ccx) ** 2 + (pz[j] - ccz) ** 2;
      if (dd < d2[k]) { d2[k] = dd; near[k] = j; }
    };
    for (let pass = 0; pass < 2; pass++) {
      for (let cz = 0; cz < gh; cz++) for (let cx = 0; cx < gw; cx++) {
        const k = cx + cz * gw;
        relax(cx, cz, k, -1, 0); relax(cx, cz, k, 0, -1); relax(cx, cz, k, -1, -1); relax(cx, cz, k, 1, -1);
      }
      for (let cz = gh - 1; cz >= 0; cz--) for (let cx = gw - 1; cx >= 0; cx--) {
        const k = cx + cz * gw;
        relax(cx, cz, k, 1, 0); relax(cx, cz, k, 0, 1); relax(cx, cz, k, 1, 1); relax(cx, cz, k, -1, 1);
      }
    }
    return { near, d2 };
  }
  function boxBlur(src, gw, gh, r) {
    const tmp = new Float32Array(gw * gh), out = new Float32Array(gw * gh);
    for (let z = 0; z < gh; z++) {
      let acc = 0, n = 0;
      for (let x = -r; x <= r; x++) if (x >= 0 && x < gw) { acc += src[x + z * gw]; n++; }
      for (let x = 0; x < gw; x++) {
        tmp[x + z * gw] = acc / n;
        const xa = x - r, xb = x + r + 1;
        if (xa >= 0) { acc -= src[xa + z * gw]; n--; }
        if (xb < gw) { acc += src[xb + z * gw]; n++; }
      }
    }
    for (let x = 0; x < gw; x++) {
      let acc = 0, n = 0;
      for (let z = -r; z <= r; z++) if (z >= 0 && z < gh) { acc += tmp[x + z * gw]; n++; }
      for (let z = 0; z < gh; z++) {
        out[x + z * gw] = acc / n;
        const za = z - r, zb = z + r + 1;
        if (za >= 0) { acc -= tmp[x + za * gw]; n--; }
        if (zb < gh) { acc += tmp[x + zb * gw]; n++; }
      }
    }
    return out;
  }
  const noise = (x, z) => fbm(x * th.terrainScale, z * th.terrainScale, 4, 11);

  // ---------------- near field ----------------
  const C = hi ? 5 : 7;
  const x0 = minX - band, z0 = minZ - band;
  const gw = Math.ceil((maxX - minX + band * 2) / C), gh = Math.ceil((maxZ - minZ + band * 2) / C);
  const { near, d2 } = nearestField(x0, z0, C, gw, gh);
  const roadH = new Float32Array(gw * gh);
  for (let k = 0; k < gw * gh; k++) roadH[k] = near[k] >= 0 ? py[near[k]] : 0;
  const blurH = boxBlur(boxBlur(roadH, gw, gh, Math.round(80 / C)), gw, gh, Math.round(80 / C));
  const H = new Float32Array(gw * gh).fill(NaN);
  const info = new Uint8Array(gw * gh); // 1 corridor, 2 near-wall
  const crossCells = track.crossings.map((c) => [c.x, c.z]);
  for (let cz = 0; cz < gh; cz++) for (let cx = 0; cx < gw; cx++) {
    const k = cx + cz * gw;
    const j = near[k];
    if (j < 0) continue;
    const dist = Math.sqrt(d2[k]);
    if (dist > band) continue;
    const wx = x0 + (cx + 0.5) * C, wz = z0 + (cz + 0.5) * C;
    const lat = (wx - px[j]) * nx[j] + (wz - pz[j]) * nz[j];
    const wall = lat > 0 ? track.wallL[j] : track.wallR[j];
    // lowest road height across the cell's reach
    let rmin = py[j];
    for (let q = -4; q <= 4; q++) rmin = Math.min(rmin, py[(j + q + N) % N]);
    let h;
    const inCorr = Math.abs(lat) < wall + C * 0.75;
    if (inCorr) { h = rmin - 0.45; info[k] = 1; }
    else {
      const t = smoothstep(wall + 2, wall + 70, Math.abs(lat));
      const natural = blurH[k] + noise(wx, wz) * th.terrainAmp * smoothstep(0, 140, Math.abs(lat) - wall) + th.terrainBase;
      h = lerp(rmin - 0.45, natural, t);
      // never let ground rise above the road right next to the wall
      if (Math.abs(lat) < wall + 10) h = Math.min(h, rmin - 0.2);
      if (Math.abs(lat) < wall + 14) info[k] = 2;
    }
    // under/over-pass: the lower road must stay open
    for (const [cxw, czw] of crossCells) {
      if ((wx - cxw) ** 2 + (wz - czw) ** 2 < 70 * 70) {
        for (let i = 0; i < N; i += 1) {
          const ddx = wx - px[i], ddz = wz - pz[i];
          if (ddx * ddx + ddz * ddz > 40 * 40) continue;
          const l2 = ddx * nx[i] + ddz * nz[i], a2 = ddx * tx[i] + ddz * tz[i];
          const w2 = (l2 > 0 ? track.wallL[i] : track.wallR[i]) + C * 0.75;
          if (Math.abs(l2) < w2 && Math.abs(a2) < C) h = Math.min(h, py[i] - 0.45);
        }
      }
    }
    H[k] = Math.floor(h * 2) / 2; // 0.5 m voxel steps
  }
  const heightAt = (x, z) => {
    const cx = Math.floor((x - x0) / C), cz = Math.floor((z - z0) / C);
    if (cx < 0 || cz < 0 || cx >= gw || cz >= gh) return farHeight(x, z);
    const h = H[cx + cz * gw];
    return Number.isNaN(h) ? farHeight(x, z) : h;
  };

  // emit near field in chunks
  const CH = 40;
  const grass = th.grass.map((c) => new THREE.Color(c));
  const dirt = new THREE.Color('#7a5a3a'), rock = new THREE.Color('#8b8b84'), dark = new THREE.Color('#3e6b2c');
  for (let bz = 0; bz < gh; bz += CH) for (let bx = 0; bx < gw; bx += CH) {
    const pos = [], nor = [], col = [], idx = [];
    const quad = (a, b, c, d, n, cl) => {
      const v = pos.length / 3;
      pos.push(...a, ...b, ...c, ...d);
      for (let q = 0; q < 4; q++) { nor.push(...n); col.push(cl.r, cl.g, cl.b); }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    };
    for (let cz = bz; cz < Math.min(gh, bz + CH); cz++) for (let cx = bx; cx < Math.min(gw, bx + CH); cx++) {
      const k = cx + cz * gw;
      const h = H[k];
      if (Number.isNaN(h)) continue;
      const X0 = x0 + cx * C, Z0 = z0 + cz * C, X1 = X0 + C, Z1 = Z0 + C;
      const r = hash2(cx, cz, 21);
      let top = grass[Math.floor(r * grass.length)];
      if (info[k] === 0) {
        const steep = Math.max(...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([ox, oz]) => {
          const hn = H[cx + ox + (cz + oz) * gw];
          return Number.isNaN(hn) ? 0 : Math.abs(hn - h);
        }));
        if (steep > 2.5) top = rock;
        else if (r > 0.94) top = dirt;
        else if (r < 0.2 && th.trees.density > 0.7) top = dark;
      }
      quad([X0, h, Z1], [X1, h, Z1], [X1, h, Z0], [X0, h, Z0], UP, top);
      // sides where the neighbour is lower (or missing)
      const sides = [
        [1, 0, [X1, Z1], [X1, Z0], [1, 0, 0]],
        [-1, 0, [X0, Z0], [X0, Z1], [-1, 0, 0]],
        [0, 1, [X0, Z1], [X1, Z1], [0, 0, 1]],
        [0, -1, [X1, Z0], [X0, Z0], [0, 0, -1]],
      ];
      for (const [ox, oz, a, b, n] of sides) {
        const ax = cx + ox, az = cz + oz;
        let hn = ax < 0 || az < 0 || ax >= gw || az >= gh ? NaN : H[ax + az * gw];
        if (Number.isNaN(hn)) hn = h - 6;
        if (hn >= h) continue;
        const cl = h - hn > 1.5 ? (top === rock ? rock : dirt) : top.clone().multiplyScalar(0.8);
        quad([a[0], hn, a[1]], [b[0], hn, b[1]], [b[0], h, b[1]], [a[0], h, a[1]], n, cl);
      }
    }
    if (!idx.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : idx);
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    meshes.push(m);
    disposables.push(geo);
  }

  // ---------------- far field ----------------
  const FC = 40;
  const ext = 2600;
  const fx0 = minX - ext, fz0 = minZ - ext;
  const fgw = Math.ceil((maxX - minX + ext * 2) / FC), fgh = Math.ceil((maxZ - minZ + ext * 2) / FC);
  const ff = nearestField(fx0, fz0, FC, fgw, fgh);
  const fRoad = new Float32Array(fgw * fgh);
  for (let k = 0; k < fgw * fgh; k++) fRoad[k] = ff.near[k] >= 0 ? py[ff.near[k]] : (minY + maxY) / 2;
  const fBlur = boxBlur(boxBlur(fRoad, fgw, fgh, 3), fgw, fgh, 3);
  const FH = new Float32Array(fgw * fgh);
  const hill = th.terrainAmp * 2.2 + 8;
  for (let cz = 0; cz < fgh; cz++) for (let cx = 0; cx < fgw; cx++) {
    const k = cx + cz * fgw;
    const wx = fx0 + (cx + 0.5) * FC, wz = fz0 + (cz + 0.5) * FC;
    const dist = Math.sqrt(ff.d2[k]);
    const rise = smoothstep(band, band + 1600, dist) * hill + smoothstep(band + 800, ext, dist) * hill * 1.5;
    FH[k] = Math.floor(fBlur[k] + noise(wx, wz) * th.terrainAmp + th.terrainBase + rise - 1.5);
  }
  function farHeight(x, z) {
    const cx = clamp(Math.floor((x - fx0) / FC), 0, fgw - 1), cz = clamp(Math.floor((z - fz0) / FC), 0, fgh - 1);
    return FH[cx + cz * fgw];
  }
  {
    const pos = [], nor = [], col = [], idx = [];
    const quad = (a, b, c, d, n, cl) => {
      const v = pos.length / 3;
      pos.push(...a, ...b, ...c, ...d);
      for (let q = 0; q < 4; q++) { nor.push(...n); col.push(cl.r, cl.g, cl.b); }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    };
    for (let cz = 0; cz < fgh; cz++) for (let cx = 0; cx < fgw; cx++) {
      const k = cx + cz * fgw;
      const X0 = fx0 + cx * FC, Z0 = fz0 + cz * FC, X1 = X0 + FC, Z1 = Z0 + FC;
      // skip cells fully covered by the near field
      const nearCov = Math.sqrt(ff.d2[k]) < band - FC;
      if (nearCov) continue;
      const h = FH[k];
      const r = hash2(cx, cz, 5);
      const g = grass[Math.floor(r * grass.length)].clone().multiplyScalar(th.trees.density > 0.7 ? 0.62 : 0.85);
      quad([X0, h, Z1], [X1, h, Z1], [X1, h, Z0], [X0, h, Z0], UP, g);
      for (const [ox, oz, a, b, n] of [[1, 0, [X1, Z1], [X1, Z0], [1, 0, 0]], [-1, 0, [X0, Z0], [X0, Z1], [-1, 0, 0]], [0, 1, [X0, Z1], [X1, Z1], [0, 0, 1]], [0, -1, [X1, Z0], [X0, Z0], [0, 0, -1]]]) {
        const ax = cx + ox, az = cz + oz;
        const hn = ax < 0 || az < 0 || ax >= fgw || az >= fgh ? h - 20 : FH[ax + az * fgw];
        if (hn >= h) continue;
        quad([a[0], hn - 4, a[1]], [b[0], hn - 4, b[1]], [b[0], h, b[1]], [a[0], h, a[1]], n, g.clone().multiplyScalar(0.75));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    meshes.push(new THREE.Mesh(geo, mat));
    disposables.push(geo);
  }

  return {
    meshes, disposables, heightAt,
    near: { x0, z0, C, gw, gh, H, info, nearIdx: near, d2 },
    center: [(minX + maxX) / 2, (minZ + maxZ) / 2],
    radius: Math.hypot(maxX - minX, maxZ - minZ) / 2,
    minY: minY - 30, maxY,
    band,
  };
}

// ===========================================================================
// Trees: chunky block trees (a handful of boxes each), merged into ~400 m
// spatial chunks so both the camera and the shadow pass can cull them.
const LEAF = {
  pine: ['#1f4d2b', '#24583a', '#1a4226', '#2a5e33'],
  oak: ['#2f6b2a', '#3a7d31', '#285c24', '#447f2e'],
  poplar: ['#4f8f2f', '#5d9c37', '#467f2a'],
  round: ['#4f8f2f', '#5d9c37', '#3f7a2a', '#6aa23c'],
};
function addTree(b, kind, x, y, z, sc, rot, seed) {
  const L = LEAF[kind] || LEAF.oak;
  const c = (k) => L[(seed + k) % L.length];
  const T = '#5a3d26';
  const bx = (w, y0, y1, d, col, ox = 0, oz = 0) => b.box(-w / 2 * sc + ox * sc, y0 * sc, -d / 2 * sc + oz * sc, w / 2 * sc + ox * sc, y1 * sc, d / 2 * sc + oz * sc, col, rot, x, y, z, { skipBottom: true });
  if (kind === 'pine') {
    bx(0.7, -0.5, 3, 0.7, T);
    bx(5.2, 2.2, 4.0, 5.2, c(0));
    bx(4.0, 4.0, 5.8, 4.0, c(1));
    bx(2.9, 5.8, 7.6, 2.9, c(2));
    bx(1.8, 7.6, 9.4, 1.8, c(0));
    bx(0.8, 9.4, 10.6, 0.8, c(1));
  } else if (kind === 'poplar') {
    bx(0.7, -0.5, 3, 0.7, T);
    bx(2.6, 2.5, 10.5, 2.6, c(0));
    bx(1.6, 10.5, 12.5, 1.6, c(1));
  } else if (kind === 'round') {
    bx(0.7, -0.5, 3, 0.7, T);
    bx(4.4, 2.6, 6.2, 4.4, c(0));
    bx(2.8, 6.2, 7.4, 2.8, c(1));
    bx(1.4, 3.4, 5.4, 1.4, c(2), 2.3, 0.4);
  } else {
    bx(0.9, -0.5, 4.2, 0.9, T);
    bx(6.4, 3.8, 7.4, 6.4, c(0));
    bx(3.6, 7.4, 8.8, 3.6, c(1), 0.6, -0.4);
    bx(2.6, 4.6, 7.0, 2.4, c(2), 3.6, 0.8);
    bx(2.4, 4.2, 6.6, 2.6, c(3), -0.6, -3.5);
  }
}

function buildTrees(track, th, terr, quality) {
  const hi = quality === 'high';
  const kinds = th.trees.kinds;
  const { x0, z0, C, gw, gh, H, info, nearIdx, d2 } = terr.near;
  const { px, pz, nx, nz } = track;
  const maxTrees = hi ? 8000 : 3000;
  const dens = th.trees.density * (hi ? 1 : 0.6);
  const band = th.trees.band;
  const CHUNK = 400;
  const chunks = new Map();
  const cand = [];
  for (let cz = 0; cz < gh; cz++) for (let cx = 0; cx < gw; cx++) {
    const k = cx + cz * gw;
    if (info[k] !== 0 || Number.isNaN(H[k])) continue;
    const j = nearIdx[k];
    if (j < 0) continue;
    const dist = Math.sqrt(d2[k]);
    const wx = x0 + (cx + 0.5) * C, wz = z0 + (cz + 0.5) * C;
    const lat = Math.abs((wx - px[j]) * nx[j] + (wz - pz[j]) * nz[j]);
    const wall = Math.max(track.wallL[j], track.wallR[j]);
    if (lat < wall + 16 || dist > band) continue;
    // clumpy forests via low-frequency noise
    const clump = fbm(wx * 0.006, wz * 0.006, 2, 3) * 0.5 + 0.5;
    const p = dens * smoothstep(0.25, 0.75, clump) * (1 - smoothstep(band * 0.7, band, dist)) * 0.55;
    if (hash2(cx, cz, 99) > p) continue;
    cand.push(k);
  }
  // thin evenly (not in scan order) so the cap never leaves half the map bare
  const keep = Math.min(1, maxTrees / Math.max(cand.length, 1));
  let count = 0;
  for (const k of cand) {
    const cx = k % gw, cz = (k / gw) | 0;
    if (keep < 1 && hash2(cx, cz, 1234) > keep) continue;
    const wx = x0 + (cx + 0.5) * C, wz = z0 + (cz + 0.5) * C;
    const kind = kinds[Math.floor(hash2(cx, cz, 7) * kinds.length)];
    const jx = (hash2(cx, cz, 1) - 0.5) * C * 0.6, jz = (hash2(cx, cz, 2) - 0.5) * C * 0.6;
    const key = Math.floor((wx + jx) / CHUNK) + ',' + Math.floor((wz + jz) / CHUNK);
    let b = chunks.get(key);
    if (!b) chunks.set(key, (b = new BoxBuilder()));
    addTree(b, kind, wx + jx, H[k], wz + jz, 0.8 + hash2(cx, cz, 3) * 0.55, Math.floor(hash2(cx, cz, 4) * 4) * (Math.PI / 2), Math.floor(hash2(cx, cz, 5) * 8));
    count++;
  }
  const meshes = [], disposables = [];
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  disposables.push(mat);
  for (const b of chunks.values()) {
    const geo = b.build();
    disposables.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = hi;
    meshes.push(m);
  }
  return { meshes, disposables, count };
}
