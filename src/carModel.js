// Procedural voxel cars. Each car in cars.js supplies side-profile polylines
// (hood/beltline + roof), a plan-view taper, and painted/added details; this
// module voxelises that description at 8 cm and meshes it with AO.
import * as THREE from 'three';
import { VoxelGrid, meshGrid } from './voxel.js';
import { CAR_COLORS } from './cars.js';
import { smoothstep, lerp, clamp } from './util.js';

const VS = 0.08; // voxel size (m)

function interp(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const t = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
      return lerp(pts[i - 1][1], pts[i][1], t);
    }
  }
  return pts[pts.length - 1][1];
}

class Palette {
  constructor() { this.list = []; this.map = new Map(); }
  get(color, group = 0) {
    const key = color + '|' + group;
    let i = this.map.get(key);
    if (i == null) { this.list.push({ color, group }); i = this.list.length; this.map.set(key, i); }
    return i;
  }
}

function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return '#' + c.getHexString();
}

export function buildCarGrid(spec, paint) {
  const M = spec.model;
  const W = M.width, Lc = M.length;
  const nx = Math.ceil((W + 0.3) / VS) + 1, ny = Math.ceil(1.45 / VS), nz = Math.ceil((Lc + 0.1) / VS) + 1;
  const g = new VoxelGrid(nx, ny, nz);
  const type = new Uint8Array(nx * ny * nz); // 1 body, 2 greenhouse
  const pal = new Palette();
  const xOff = (nx * VS) / 2; // lateral center
  const zFront = Lc; // x_from_front = zFront - zpos
  const U = (gx) => (gx + 0.5) * VS - xOff; // signed lateral, + = left
  const H = (gy) => (gy + 0.5) * VS;
  const XF = (gz) => zFront - (gz + 0.5) * VS; // distance from the front bumper
  const roofX0 = M.roof[0][0], roofX1 = M.roof[M.roof.length - 1][0];
  const roofMax = Math.max(...M.roof.map((p) => p[1]));
  const wheels = [M.frontOverhang, M.frontOverhang + M.wheelbase];
  const archInner = M.track / 2 - M.wheelW / 2 - 0.06;

  const hoodAt = (x, au, hw) => {
    let h = interp(M.hood, x);
    if (M.fender) for (const f of M.fender) {
      if (x > f.x[0] && x < f.x[1]) {
        const along = Math.sin(((x - f.x[0]) / (f.x[1] - f.x[0])) * Math.PI);
        h += f.h * along * smoothstep(hw * 0.35, hw * 0.75, au);
      }
    }
    h -= M.edgeRound * smoothstep(hw - 0.2, hw, au) * 1.6;
    return h;
  };

  // pass 1: occupancy
  for (let gz = 0; gz < nz; gz++) {
    const x = XF(gz);
    if (x < 0 || x > Lc) continue;
    const hw = (W / 2) * interp(M.plan, x);
    const roofH = x >= roofX0 && x <= roofX1 ? interp(M.roof, x) : -1;
    for (let gx = 0; gx < nx; gx++) {
      const u = U(gx), au = Math.abs(u);
      if (au > hw) continue;
      const top = hoodAt(x, au, hw);
      for (let gy = 0; gy < ny; gy++) {
        const h = H(gy);
        let t = 0;
        // underside rounds up at the bumpers
        const bottom = M.clearance + 0.12 * (1 - smoothstep(0, 0.25, x)) + 0.1 * (1 - smoothstep(0, 0.3, Lc - x));
        if (h >= bottom && h <= top) t = 1;
        else if (roofH > 0 && h > top && h <= roofH) {
          const belt = top;
          const f = clamp((h - belt) / Math.max(roofMax - belt, 0.05), 0, 1);
          const gw = hw - lerp(M.tumble[0], M.tumble[1], f);
          if (au <= gw) t = 2;
        }
        if (!t) continue;
        // wheel arches
        if (au > archInner) {
          for (const wx of wheels) {
            const d = Math.hypot(x - wx, h - M.wheelR);
            if (d < M.wheelR + 0.07) { t = 0; break; }
          }
        }
        if (t) type[g.idx(gx, gy, gz)] = t;
      }
    }
  }
  const T = (gx, gy, gz) => (g.inside(gx, gy, gz) ? type[g.idx(gx, gy, gz)] : 0);

  // pass 2: base colours
  // A paint entry may carry its own contrast roof / stripe colour (MINI).
  const P = (spec.paints || []).find((p) => p.hex === paint) || {};
  const roofCol = P.roof !== undefined ? P.roof : M.roofColor;
  // colour tokens usable in features/boxes
  const tok = (c) => (c === 'paint' ? paint : c === 'paintDark' ? shade(paint, 0.82) : c === 'paintLight' ? shade(paint, 1.16)
    : c === 'roof' ? roofCol || paint : c === 'stripe' ? P.stripe || null : c);
  const paintI = pal.get(paint);
  const paintLow = pal.get(shade(paint, 0.82));
  const darkI = pal.get(CAR_COLORS.dark);
  const blackI = pal.get(CAR_COLORS.black);
  const glassI = pal.get(CAR_COLORS.glass);
  const roofI = pal.get(roofCol || paint);
  const rearGlassI = pal.get(M.rearGlass || CAR_COLORS.glass);
  const louverI = pal.get('#0e0f11');
  const pillarI = { a: M.aPillarColor && pal.get(M.aPillarColor), b: M.bPillarColor && pal.get(M.bPillarColor), c: M.cPillarColor && pal.get(M.cPillarColor) };
  const archI = pal.get(M.archColor || CAR_COLORS.black);
  for (let gz = 0; gz < nz; gz++) {
    const x = XF(gz);
    const hwz = (W / 2) * interp(M.plan, x);
    for (let gy = 0; gy < ny; gy++) {
      const h = H(gy);
      for (let gx = 0; gx < nx; gx++) {
        const t = T(gx, gy, gz);
        if (!t) continue;
        const u = U(gx), au = Math.abs(u);
        let c = paintI;
        if (t === 1) {
          if (h < M.clearance + 0.07) c = darkI;
          else if (h < M.clearance + 0.14) c = paintLow;
          // arch liners (not on the top skin, which would show from above),
          // plus optional wider trims on the outer skin
          if (au > archInner - 0.04 && h < hoodAt(x, au, hwz) - 0.12) for (const wx of wheels) {
            const r = Math.hypot(x - wx, h - M.wheelR);
            if (r < M.wheelR + 0.15) c = blackI;
            else if (M.archTrim && r < M.wheelR + M.archTrim && au > hwz - 0.12 && h < interp(M.hood, x) - 0.1) c = archI;
          }
        } else {
          const above = T(gx, gy + 1, gz) !== 2;
          const sideOut = T(gx + 1, gy, gz) === 0 || T(gx - 1, gy, gz) === 0;
          const flat0 = M.roofFlat[0], flat1 = M.roofFlat[1];
          const rgEnd = M.rearGlassEnd ?? 1e9;
          if (!sideOut) {
            // windscreen / roof / rear glass bands (whole band so step risers match)
            if (x < flat0) c = glassI;
            else if (x <= flat1) c = above ? roofI : (roofCol ? roofI : paintI);
            else if (x <= rgEnd) c = M.louvers ? ((gz % 2) ? louverI : paintI) : rearGlassI;
            else c = paintI;
          } else {
            // A-pillar: everything ahead of the windscreen top by default; with
            // aPillarX (raked screens) side glass starts there and the pillar is
            // the strip along the screen edge
            const nearPillarA = M.aPillarX != null ? x < M.aPillarX || (x < flat0 + 0.02 && h > interp(M.roof, x) - VS * 1.5) : x < flat0 + 0.02;
            const cPillar = x > (M.cPillarX ?? Math.min(flat1 + 0.2, rgEnd));
            const bP = M.bPillar != null && Math.abs(x - M.bPillar) < 0.05;
            // roof edge: the top row only (tumblehome steps lower down stay glass)
            const roofRow = x >= flat0 && x <= flat1 && T(gx, gy + 1, gz) === 0 && h > interp(M.roof, x) - VS * 1.5;
            if (nearPillarA || cPillar || bP || roofRow) {
              c = roofCol && !nearPillarA && !cPillar ? roofI : paintI;
              const pil = nearPillarA ? pillarI.a : bP ? pillarI.b : cPillar ? pillarI.c : null;
              if (pil) c = roofRow ? roofI : pil; // blacked-out pillars under a floating roof
            } else c = glassI;
            // optional upper DLO edge (a side window tapering under the roof)
            if (c === glassI && M.windowTop && x >= M.windowTop[0][0] && h > interp(M.windowTop, x)) c = paintI;
            if (H(gy) < (M.windowLine ? interp(M.windowLine, x) : interp(M.hood, x) + 0.05)) c = paintI;
          }
        }
        g.set(gx, gy, gz, c);
      }
    }
  }

  // pass 3: added boxes (wings, mirrors, exhausts...)
  const hwFull = W / 2;
  for (const b of M.boxes || []) {
    const col = tok(b.color);
    if (!col) continue;
    const ci = pal.get(col, b.group === 'tail' ? 1 : 0);
    const sides = b.mirror === false ? [1] : [1, -1];
    for (let gz = 0; gz < nz; gz++) {
      const x = XF(gz);
      if (x < b.x[0] || x > b.x[1]) continue;
      for (let gx = 0; gx < nx; gx++) {
        const u = U(gx);
        let inU = false;
        for (const sd of sides) { const uu = u * sd; if (uu >= b.u[0] * hwFull - VS * 0.5 && uu <= b.u[1] * hwFull) inU = true; }
        if (!inU) continue;
        for (let gy = 0; gy < ny; gy++) {
          const h = H(gy);
          if (h >= b.z[0] && h <= b.z[1]) { g.set(gx, gy, gz, ci); type[g.idx(gx, gy, gz)] = 3; }
        }
      }
    }
  }

  // pass 4: painted features on surfaces
  const groupOf = (f) => (f.group === 'tail' ? 1 : f.group === 'head' ? 2 : 0);
  const solid = (gx, gy, gz) => g.get(gx, gy, gz) !== 0;
  for (const f of M.features || []) {
    const col = tok(f.color);
    if (!col) continue;
    const ci = pal.get(col, groupOf(f));
    const inUZ = (u, h) => {
      const au = Math.abs(u);
      if (f.circle) {
        const [uc, zc, r] = f.circle;
        return (au - uc * hwFull) ** 2 + (h - zc) ** 2 <= r * r;
      }
      return au >= f.u[0] * hwFull - VS * 0.5 && au <= f.u[1] * hwFull && h >= f.z[0] && h <= f.z[1];
    };
    if (f.face === 'front' || f.face === 'rear') {
      for (let gx = 0; gx < nx; gx++) for (let gy = 0; gy < ny; gy++) {
        if (!inUZ(U(gx), H(gy))) continue;
        if (f.face === 'front') { for (let gz = nz - 1; gz >= 0; gz--) if (solid(gx, gy, gz)) { g.set(gx, gy, gz, ci); break; } }
        else { for (let gz = 0; gz < nz; gz++) if (solid(gx, gy, gz)) { g.set(gx, gy, gz, ci); break; } }
      }
    } else if (f.face === 'top') {
      for (let gz = 0; gz < nz; gz++) {
        const x = XF(gz);
        if (x < f.x[0] || x > f.x[1]) continue;
        for (let gx = 0; gx < nx; gx++) {
          const au = Math.abs(U(gx));
          if (au < f.u[0] * hwFull - VS * 0.5 || au > f.u[1] * hwFull) continue;
          for (let gy = ny - 1; gy >= 0; gy--) if (solid(gx, gy, gz)) { if (type[g.idx(gx, gy, gz)] === 1) g.set(gx, gy, gz, ci); break; }
        }
      }
    } else if (f.face === 'side') {
      for (let gz = 0; gz < nz; gz++) {
        const x = XF(gz);
        if (x < f.x[0] || x > f.x[1]) continue;
        for (let gy = 0; gy < ny; gy++) {
          const h = H(gy);
          if (h < f.z[0] || h > f.z[1]) continue;
          for (let gx = 0; gx < nx; gx++) if (solid(gx, gy, gz)) { g.set(gx, gy, gz, ci); break; }
          for (let gx = nx - 1; gx >= 0; gx--) if (solid(gx, gy, gz)) { g.set(gx, gy, gz, ci); break; }
        }
      }
    }
  }

  // reference: origin at wheelbase centre on the ground, +z forward, +x left
  const cFromFront = M.frontOverhang + M.wheelbase / 2;
  const offset = [-xOff / VS, 0, -(Lc - cFromFront) / VS];

  // lamp clusters (per light group and side) for night lighting
  const box = () => ({ x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, z0: 1e9, z1: -1e9 });
  const acc = { 1: [box(), box()], 2: [box(), box()] };
  for (let gz = 0; gz < nz; gz++) for (let gy = 0; gy < ny; gy++) for (let gx = 0; gx < nx; gx++) {
    const v = g.data[g.idx(gx, gy, gz)];
    if (!v) continue;
    const grp = pal.list[v - 1].group;
    if (grp !== 1 && grp !== 2) continue;
    const b = acc[grp][U(gx) > 0 ? 0 : 1];
    b.x0 = Math.min(b.x0, gx); b.x1 = Math.max(b.x1, gx);
    b.y0 = Math.min(b.y0, gy); b.y1 = Math.max(b.y1, gy);
    b.z0 = Math.min(b.z0, gz); b.z1 = Math.max(b.z1, gz);
  }
  const lampOf = (b, front) => b.x1 < b.x0 ? null : {
    x: ((b.x0 + b.x1 + 1) / 2 + offset[0]) * VS,
    y: ((b.y0 + b.y1 + 1) / 2) * VS,
    z: ((front ? b.z1 + 1 : b.z0) + offset[2]) * VS,
    w: (b.x1 - b.x0 + 1) * VS,
    h: (b.y1 - b.y0 + 1) * VS,
  };
  const lamps = { head: acc[2].map((b) => lampOf(b, true)).filter(Boolean), tail: acc[1].map((b) => lampOf(b, false)).filter(Boolean), popups: [] };
  if (M.popups) {
    // pop-up headlamps: pods that stand up out of the bonnet when lit
    const p = M.popups, xm = (p.x[0] + p.x[1]) / 2;
    for (const sd of [1, -1]) {
      const pod = { x: sd * ((p.u[0] + p.u[1]) / 2) * hwFull, y: interp(M.hood, xm) - 0.02, z: cFromFront - p.x[0], w: (p.u[1] - p.u[0]) * hwFull, d: (p.x[1] - p.x[0]) * 0.5, h: p.h ?? 0.15 };
      lamps.popups.push(pod);
      lamps.head.push({ x: pod.x, y: pod.y + pod.h * 0.55, z: pod.z + 0.01, w: pod.w, h: pod.h * 0.7 });
    }
  }
  if (!lamps.head.length) for (const sd of [1, -1]) lamps.head.push({ x: sd * hwFull * 0.65, y: 0.6, z: cFromFront, w: 0.2, h: 0.1 });
  return {
    grid: g, palette: pal.list, lamps,
    // grid z increases toward the front; local z = gz*VS - (Lc - cFromFront)
    offset,
  };
}

function buildWheelGeometry(M) {
  const R = M.wheelR, w = M.wheelW;
  const n = Math.ceil((2 * R) / VS) | 1, nw = Math.max(2, Math.round(w / VS));
  const g = new VoxelGrid(nw, n, n);
  const pal = new Palette();
  const tire = pal.get('#1b1b1d'), side = pal.get('#2a2a2d'), rim = pal.get(M.rim), hub = pal.get(shade(M.rim, 0.7)), disc = pal.get('#55585e'), gap = pal.get('#0c0c0e');
  const c = n / 2;
  const spokes = { five: 5, six: 6, spokes: 8, cup: 5 }[M.rimStyle] || 5;
  const spokeW = M.rimStyle === 'cup' ? 0.5 : M.rimStyle === 'spokes' ? 0.22 : 0.32;
  const rimR = R * 0.64;
  for (let gz = 0; gz < n; gz++) for (let gy = 0; gy < n; gy++) {
    const dy = (gy + 0.5 - c) * VS, dz = (gz + 0.5 - c) * VS;
    const rho = Math.hypot(dy, dz);
    if (rho > R) continue;
    const ang = Math.atan2(dz, dy);
    const sp = Math.abs(((ang / (Math.PI * 2)) * spokes + 100) % 1 - 0.5) * 2; // 1 at spoke centre? (0..1)
    const isSpoke = sp > 1 - spokeW;
    for (let gx = 0; gx < nw; gx++) {
      const outer = gx === nw - 1;
      let col;
      if (rho > rimR) col = outer && rho < rimR + 0.05 ? side : tire;
      else if (outer) {
        if (rho < R * 0.16) col = hub;
        else if (rho > rimR - 0.035) col = rim;
        else if (isSpoke) col = rim;
        else col = 0; // see-through gap
      } else if (gx === nw - 2) col = rho < R * 0.45 ? disc : gap;
      else col = rho < R * 0.5 ? disc : tire;
      if (col) g.set(gx, gy, gz, col);
    }
  }
  const [geo] = meshGrid(g, pal.list, { scale: VS, offset: [-nw / 2, -c, -c] });
  return geo;
}

const geoCache = new Map();

// ---- night lights: shared textures/geometry, created on first use ----------
let LIGHT_RES = null;
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function lightResources() {
  if (LIGHT_RES) return LIGHT_RES;
  const glow = canvasTex(64, 64, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.6)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
  });
  // road light pool: canvas top = at the bumper, bottom = far end of the beams
  const pool = canvasTex(128, 256, (ctx, w, h) => {
    const lobe = (cx, cy, rx, ry, a) => {
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(rx / ry, 1);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.5, `rgba(255,255,255,${a * 0.35})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, ry, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    };
    ctx.globalCompositeOperation = 'lighter';
    lobe(w * 0.5, h * 0.1, w * 0.46, h * 0.16, 0.75); // near spill
    lobe(w * 0.34, h * 0.42, w * 0.3, h * 0.42, 0.55);
    lobe(w * 0.66, h * 0.42, w * 0.3, h * 0.42, 0.55);
  });
  const additive = (map, color, opacity) => new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  LIGHT_RES = {
    quad: new THREE.PlaneGeometry(1, 1),
    flat: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    headGlow: additive(glow, '#fff1cf', 0.9),
    tailGlow: additive(glow, '#ff2a14', 0.6),
    pool: Object.assign(additive(pool, '#ffe6b8', 0.55), { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    tailPool: Object.assign(additive(glow, '#ff1a0a', 0.22), { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  return LIGHT_RES;
}

/**
 * Returns a THREE.Group for the car plus handles for animation.
 * opts.ghost -> translucent material
 */
export function buildCarObject(spec, paint, opts = {}) {
  const key = spec.id + paint;
  let geos = geoCache.get(key);
  if (!geos) {
    const { grid, palette, offset, lamps } = buildCarGrid(spec, paint);
    const [body, tail, head] = meshGrid(grid, palette, { scale: VS, offset, groups: 3 });
    geos = { body, tail, head, lamps, wheel: buildWheelGeometry(spec.model) };
    geoCache.set(key, geos);
  }
  const ghost = !!opts.ghost;
  const bodyMat = ghost
    ? new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.32, depthWrite: false })
    : new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: 0x2a2a2a });
  const tailMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: ghost, opacity: ghost ? 0.32 : 1 });
  const headMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: ghost, opacity: ghost ? 0.32 : 1 });
  const TAIL_OFF = 0.75; // unlit lens: glossy red, a step brighter than red paint in shade
  tailMat.color.setScalar(TAIL_OFF);

  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);
  const meshes = [];
  const add = (geo, mat) => {
    if (!geo) return null;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = !ghost;
    m.receiveShadow = false;
    bodyPivot.add(m);
    meshes.push(m);
    return m;
  };
  add(geos.body, bodyMat);
  add(geos.tail, tailMat);
  add(geos.head, headMat);

  const M = spec.model;
  const wheelMat = ghost ? bodyMat : new THREE.MeshLambertMaterial({ vertexColors: true });
  const wheels = [];
  const zF = M.wheelbase / 2, zR = -M.wheelbase / 2;
  for (const [z, front] of [[zF, true], [zR, false]]) {
    for (const side of [1, -1]) {
      const steer = new THREE.Group();
      steer.position.set(side * (M.track / 2), M.wheelR, z);
      const spin = new THREE.Group();
      const wm = new THREE.Mesh(geos.wheel, wheelMat);
      wm.castShadow = !ghost;
      if (side < 0) wm.rotation.y = Math.PI; // outer face outward
      spin.add(wm);
      steer.add(spin);
      root.add(steer);
      wheels.push({ steer, spin, front, side });
    }
  }
  // ---- lights (built lazily on the first setLights(true)) -----------------
  let lightsOn = false, braking = false, lightRig = null, spots = null;
  const lamps = geos.lamps;
  const applyTail = () => {
    tailMat.color.setScalar(braking ? 1.6 : lightsOn ? 1.1 : TAIL_OFF);
    if (lightRig) lightRig.tailGlow.opacity = braking ? 0.95 : 0.5;
  };
  const buildRig = () => {
    const R = lightResources();
    const group = new THREE.Group(); // lamp glows, follow the body
    const ground = new THREE.Group(); // road decals, follow the chassis
    const tailGlow = R.tailGlow.clone();
    const disposables = [tailGlow];
    for (const p of lamps.popups) {
      const geo = new THREE.BoxGeometry(p.w, p.h, p.d).translate(0, p.h / 2, -p.d / 2);
      const lid = new THREE.MeshLambertMaterial({ color: paint }), lens = new THREE.MeshBasicMaterial({ color: '#fff6e0' });
      const pod = new THREE.Mesh(geo, [lid, lid, lid, lid, lens, lid]);
      pod.position.set(p.x, p.y, p.z);
      group.add(pod);
      disposables.push(geo, lid, lens);
    }
    for (const l of lamps.head) {
      const q = new THREE.Mesh(R.quad, R.headGlow);
      q.position.set(l.x, l.y, l.z + 0.03);
      q.scale.set(l.w * 2.4 + 0.25, l.h * 2.4 + 0.25, 1);
      group.add(q);
    }
    for (const l of lamps.tail) {
      const q = new THREE.Mesh(R.quad, tailGlow);
      q.position.set(l.x, l.y, l.z - 0.03);
      q.rotation.y = Math.PI;
      q.scale.set(l.w * 2 + 0.2, l.h * 2 + 0.2, 1);
      group.add(q);
    }
    const front = Math.max(...lamps.head.map((l) => l.z));
    const back = lamps.tail.length ? Math.min(...lamps.tail.map((l) => l.z)) : -M.wheelbase / 2 - 0.8;
    const pool = new THREE.Mesh(R.flat, R.pool);
    pool.position.set(0, 0.05, front + 8.6);
    pool.scale.set(M.track * 3.6, 1, 18);
    const tailPool = new THREE.Mesh(R.flat, R.tailPool);
    tailPool.position.set(0, 0.05, back - 0.9);
    tailPool.scale.set(M.width * 1.6, 1, 2.4);
    ground.add(pool, tailPool);
    for (const o of [...group.children, pool, tailPool]) o.renderOrder = 2;
    bodyPivot.add(group);
    root.add(ground);
    lightRig = { group, ground, tailGlow, disposables };
  };
  const setSpots = (on) => {
    if (on && !spots) {
      spots = lamps.head.slice(0, 2).map((l) => {
        const sp = new THREE.SpotLight('#fff1d6', 240, 90, 0.42, 0.6, 1.5);
        sp.position.set(l.x, l.y, l.z);
        sp.target.position.set(l.x * 1.5, 0, l.z + 24);
        bodyPivot.add(sp, sp.target);
        return sp;
      });
    } else if (!on && spots) {
      for (const sp of spots) { bodyPivot.remove(sp, sp.target); sp.dispose(); }
      spots = null;
    }
  };
  return {
    root, bodyPivot, wheels, tailMat, headMat, bodyMat, meshes,
    get lightsOn() { return lightsOn; },
    setBrake(on) { if (on !== braking) { braking = on; applyTail(); } },
    /**
     * Night lighting. on: lamps lit (head/tail glow, pop-ups raised, road
     * light pool). opts.spot: also add two real SpotLights (costly: use for
     * the player car only).
     */
    setLights(on, { spot = false } = {}) {
      lightsOn = !!on;
      if (lightsOn && !lightRig) buildRig();
      if (lightRig) lightRig.group.visible = lightRig.ground.visible = lightsOn;
      setSpots(lightsOn && spot);
      applyTail();
    },
    update(veh) {
      bodyPivot.rotation.x = veh.pitch;
      bodyPivot.rotation.z = -veh.roll;
      for (const w of wheels) {
        if (w.front) w.steer.rotation.y = veh.steerAngle;
        w.spin.rotation.x = w.front ? veh.wheelSpin[0] : veh.wheelSpin[1];
      }
    },
    dispose() {
      bodyMat.dispose(); tailMat.dispose(); headMat.dispose(); if (wheelMat !== bodyMat) wheelMat.dispose();
      setSpots(false);
      if (lightRig) for (const d of lightRig.disposables) d.dispose();
    },
  };
}

export const CAR_VOXEL = VS;
