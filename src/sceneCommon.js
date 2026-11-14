// Scenery pieces shared by the circuit scene (trackScene.js) and the city
// scene (cityScene.js): sky + sun + lights, start line and grid, start gantry
// with lights, brake boards, clouds, the driving-line overlay and the
// fictional sponsor textures.
import * as THREE from 'three';
import { rng } from './util.js';
import { BoxBuilder } from './voxel.js';

export function lambert(opts = {}) {
  return new THREE.MeshLambertMaterial({ vertexColors: true, ...opts });
}

export function pick(arr, h) {
  return arr[Math.min(arr.length - 1, Math.floor(h * arr.length))];
}

// ---------------------------------------------------------------------------
// Canvas textures (fictional sponsors, brake boards)
export const SPONSORS = [
  ['CUBEFUEL', '#ffd23f', '#1b1b1b'], ['BLOK TYRES', '#141414', '#ffffff'], ['VOXELINE', '#d7263d', '#ffffff'],
  ['PIXELUBE', '#1b4dd6', '#ffffff'], ['QUBIT OIL', '#0f7a3d', '#ffe86b'], ['8-BIT BRAKES', '#ffffff', '#d7263d'],
  ['STAK RACING', '#ff7b00', '#141414'], ['GRIDLOCK', '#2b2d42', '#8ecae6'],
];
export function textTexture(text, bg, fg, w = 512, h = 128, font = 'bold 76px "Chakra Petch", Arial, sans-serif') {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------------------
// Sky dome, sun disc, hemisphere + shadow-casting sun. update() keeps the sky
// on the camera and the shadow frustum on the focus car.
export function buildSkyAndLights(group, def, hi, keep) {
  const th = def.theme;
  const skyGeo = new THREE.SphereGeometry(9000, 32, 16);
  {
    const cTop = new THREE.Color(th.skyTop), cHor = new THREE.Color(th.skyHorizon), cFog = new THREE.Color(th.fog);
    const col = [];
    const p = skyGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 9000;
      const c = y > 0 ? cHor.clone().lerp(cTop, Math.pow(y, 0.6)) : cFog.clone();
      col.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }
  const sky = new THREE.Mesh(keep(skyGeo), keep(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
  sky.renderOrder = -10;
  group.add(sky);

  // sun disc
  const sunDir = new THREE.Vector3(...th.sunDir).normalize();
  const sun = new THREE.Mesh(keep(new THREE.PlaneGeometry(420, 420)), keep(new THREE.MeshBasicMaterial({ color: th.sunColor, fog: false, transparent: true, opacity: def.id === 'spa' ? 0.25 : 0.95, depthWrite: false })));
  sun.renderOrder = -9;
  group.add(sun);

  const hemi = new THREE.HemisphereLight(th.hemiSky, th.hemiGround, th.hemiIntensity);
  group.add(hemi);
  const dir = new THREE.DirectionalLight(th.sunColor, th.sunIntensity);
  dir.castShadow = true;
  const sh = hi ? 2048 : 1024;
  dir.shadow.mapSize.set(sh, sh);
  const S = 70;
  Object.assign(dir.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 10, far: 600 });
  dir.shadow.bias = -0.0004;
  dir.shadow.normalBias = 0.04;
  group.add(dir, dir.target);

  const update = (camera, focus) => {
    sky.position.copy(camera.position);
    sun.position.copy(camera.position).addScaledVector(sunDir, 6000);
    sun.lookAt(camera.position);
    if (focus) {
      dir.target.position.set(focus.x, focus.y, focus.z);
      dir.position.set(focus.x + sunDir.x * 300, focus.y + sunDir.y * 300, focus.z + sunDir.z * 300);
      dir.target.updateMatrixWorld();
    }
  };
  return { sky, sun, sunDir, hemi, dir, update };
}

// ---------------------------------------------------------------------------
// Chequered start/finish line and grid boxes (flat decals).
export function addStartGrid(track, decoB) {
  const { px, pz, py, nx, nz, tx, tz } = track;
  const halfW = track.hw[0];
  const i = 0, h = Math.atan2(tx[i], tz[i]);
  const sq = halfW * 2 / 16;
  for (let r = 0; r < 2; r++) for (let c = 0; c < 16; c++) {
    const off = -halfW + (c + 0.5) * sq;
    const xx = px[i] + nx[i] * off, zz = pz[i] + nz[i] * off;
    decoB.box(-sq / 2, 0, r * sq - sq, sq / 2, 0.03, r * sq, (r + c) % 2 ? '#111' : '#f4f4f4', h, xx, py[i], zz, { flat: true });
  }
  for (let k = 0; k < 8; k++) {
    const s = track.length - (12 + k * 8);
    const p = track.sample(s, k % 2 ? -3 : 3);
    decoB.box(-1.2, 0, 2.2, 1.2, 0.025, 2.4, '#f0f0f0', p.heading, p.x, p.y, p.z, { flat: true });
    decoB.box(-1.2, 0, -2.4, -1.05, 0.025, 2.4, '#f0f0f0', p.heading, p.x, p.y, p.z, { flat: true });
    decoB.box(1.05, 0, -2.4, 1.2, 0.025, 2.4, '#f0f0f0', p.heading, p.x, p.y, p.z, { flat: true });
  }
}

// ---------------------------------------------------------------------------
// Start gantry over the line with 5x2 lamp pods; returns setLights(state).
// opts.span: half span between the legs; opts.colors: [legs, beam]
export function buildGantry(track, propB, group, keep, opts = {}) {
  const { px, pz, py, tx, tz } = track;
  const lamps = [];
  const a = 4;
  const h = Math.atan2(tx[a], tz[a]);
  const span = opts.span ?? track.hw[a] + 1.5;
  const [legCol, beamCol] = opts.colors || ['#5d6168', '#2c2f35'];
  const ox = px[a], oz = pz[a], oy = py[a];
  propB.box(span, 0, -0.4, span + 0.8, 7.6, 0.4, legCol, h, ox, oy, oz);
  propB.box(-span - 0.8, 0, -0.4, -span, 7.6, 0.4, legCol, h, ox, oy, oz);
  propB.box(-span - 0.8, 6.2, -0.5, span + 0.8, 7.6, 0.5, beamCol, h, ox, oy, oz);
  // lamp pods (5 columns x 2 rows) as separate meshes so they can light up
  const lampGeo = keep(new THREE.BoxGeometry(0.55, 0.55, 0.2));
  for (let c = 0; c < 5; c++) {
    const col = [];
    for (let r = 0; r < 2; r++) {
      const mat = keep(new THREE.MeshBasicMaterial({ color: '#2a0d0d' }));
      const m = new THREE.Mesh(lampGeo, mat);
      const lx = (c - 2) * 1.5, ly = 6.55 + r * 0.7;
      const cs = Math.cos(h), sn = Math.sin(h);
      m.position.set(ox + lx * cs + -0.55 * sn, oy + ly, oz - lx * sn + -0.55 * cs);
      m.rotation.y = h;
      group.add(m);
      col.push(mat);
    }
    lamps.push(col);
  }
  return (state) => {
    // state: number of red columns lit (0..5), 'green', or 'off'
    lamps.forEach((col, c) => col.forEach((mat) => {
      if (state === 'green') mat.color.set('#25ff5a');
      else if (typeof state === 'number' && c < state) mat.color.set('#ff2020');
      else mat.color.set('#2a0d0d');
    }));
  };
}

// ---------------------------------------------------------------------------
// 150/100/50 m boards before heavy braking zones, on the outside of the turn.
// opts.maxOff: max lateral offset from the centreline (default halfW + 4)
export function buildBrakeBoards(track, propB, group, keep, opts = {}) {
  const { N, ds, px, pz, py, nx, nz, tx, tz } = track;
  const boardTex = {};
  for (const n of [150, 100, 50]) boardTex[n] = keep(textTexture(String(n), '#f6f6f2', '#111', 128, 128, 'bold 64px Arial, sans-serif'));
  // find heavy braking zones from the line curvature
  const vRef = new Float32Array(N);
  for (let i = 0; i < N; i++) vRef[i] = Math.min(85, Math.sqrt(11 / Math.max(Math.abs(track.lineCurv[i]), 1e-4)));
  const boardMats = {};
  for (const n of [150, 100, 50]) boardMats[n] = keep(new THREE.MeshLambertMaterial({ map: boardTex[n] }));
  const boardGeo = keep(new THREE.PlaneGeometry(1.4, 1.4));
  let lastZone = -9999;
  for (let i = 0; i < N; i++) {
    // corner entry: speed falls to < 60% of the speed 200 m earlier
    const back = (i - Math.round(200 / ds) + N) % N;
    if (vRef[i] < 30 && vRef[back] > vRef[i] / 0.6 && i - lastZone > 300 / ds) {
      lastZone = i;
      const turn = Math.sign(track.curv[(i + 5) % N]) || 1;
      const side = -turn; // boards on the outside
      for (const n of [150, 100, 50]) {
        const a = (i - Math.round(n / ds) + N) % N;
        const wall = side > 0 ? track.wallL[a] : track.wallR[a];
        const off = opts.wallOff != null ? wall + opts.wallOff : Math.min(wall - 1.0, track.hw[a] + 4);
        const h = Math.atan2(tx[a], tz[a]);
        const bx = px[a] + nx[a] * off * side, bz = pz[a] + nz[a] * off * side;
        propB.box(-0.06, 0, -0.06, 0.06, 1.4, 0.06, '#777', h, bx, py[a], bz);
        const m = new THREE.Mesh(boardGeo, boardMats[n]);
        m.position.set(bx, py[a] + 1.9, bz);
        m.rotation.y = h + Math.PI; // face oncoming cars
        group.add(m);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Flat-shaded block clouds around `center` within `radius`, above `baseY`.
export function buildClouds(def, keep, center, radius, baseY) {
  const th = def.theme;
  const cloudB = new BoxBuilder();
  const R = rng(def.id.length * 131);
  const cc = th.cloudColor || '#ffffff';
  for (let k = 0; k < th.clouds; k++) {
    const ang = R() * Math.PI * 2, dist = 200 + R() * (radius + 1500);
    const x = center[0] + Math.sin(ang) * dist, z = center[1] + Math.cos(ang) * dist;
    const y = baseY + (th.lowClouds ? 90 : 160) + R() * 120;
    const puffs = 4 + Math.floor(R() * 6);
    for (let p = 0; p < puffs; p++) {
      const w = 30 + R() * 60, hgt = 10 + R() * 14, d = 20 + R() * 40;
      const ox = (R() - 0.5) * 90, oz = (R() - 0.5) * 50, oy = R() * 12;
      cloudB.box(-w / 2, 0, -d / 2, w / 2, hgt, d / 2, cc, 0, x + ox, y + oy, z + oz, { flat: true });
    }
  }
  return new THREE.Mesh(keep(cloudB.build()), keep(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.88, fog: false })));
}

// ---------------------------------------------------------------------------
// Driving line overlay coloured by the speed profile; returns setDrivingLine.
export function makeDrivingLine(track, group, keep) {
  const { N, px, pz, py, nx, nz } = track;
  let lineMesh = null;
  const lineMat = keep(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const set = (profile) => {
    if (lineMesh) { group.remove(lineMesh); lineMesh.geometry.dispose(); }
    if (!profile) { lineMesh = null; return; }
    const pos = [], col = [], idx = [];
    const cG = new THREE.Color('#2bd46a'), cY = new THREE.Color('#f5d33b'), cR = new THREE.Color('#ff3b3b');
    for (let i = 0; i <= N; i++) {
      const a = i % N;
      const o = track.lineOff[a];
      const cx = px[a] + nx[a] * o, cz = pz[a] + nz[a] * o, cy = py[a] + 0.04;
      pos.push(cx + nx[a] * 0.45, cy, cz + nz[a] * 0.45, cx - nx[a] * 0.45, cy, cz - nz[a] * 0.45);
      const b = (a + 6) % N;
      const dv = profile[b] - profile[a];
      // red: braking zone, yellow: holding speed through a corner, green: accelerate / flat out
      const c = dv < -0.6 ? cR : dv < 0.1 && Math.abs(track.lineCurv[a]) > 0.004 ? cY : cG;
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (i < N) { const v = i * 2; idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    lineMesh = new THREE.Mesh(g, lineMat);
    lineMesh.renderOrder = 1;
    group.add(lineMesh);
  };
  return { set, dispose() { if (lineMesh) lineMesh.geometry.dispose(); } };
}
