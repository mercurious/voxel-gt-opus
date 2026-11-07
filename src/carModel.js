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
  const paintI = pal.get(paint);
  const paintLow = pal.get(shade(paint, 0.82));
  const darkI = pal.get(CAR_COLORS.dark);
  const blackI = pal.get(CAR_COLORS.black);
  const glassI = pal.get(CAR_COLORS.glass);
  const roofI = pal.get(M.roofColor || paint);
  const rearGlassI = pal.get(M.rearGlass || CAR_COLORS.glass);
  const louverI = pal.get('#0e0f11');
  for (let gz = 0; gz < nz; gz++) {
    const x = XF(gz);
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
          // arch liners
          if (au > archInner - 0.04) for (const wx of wheels) {
            if (Math.hypot(x - wx, h - M.wheelR) < M.wheelR + 0.15) c = blackI;
          }
        } else {
          const above = T(gx, gy + 1, gz) !== 2;
          const sideOut = T(gx + 1, gy, gz) === 0 || T(gx - 1, gy, gz) === 0;
          const flat0 = M.roofFlat[0], flat1 = M.roofFlat[1];
          const rgEnd = M.rearGlassEnd ?? 1e9;
          if (!sideOut) {
            // windscreen / roof / rear glass bands (whole band so step risers match)
            if (x < flat0) c = glassI;
            else if (x <= flat1) c = above ? roofI : (M.roofColor ? roofI : paintI);
            else if (x <= rgEnd) c = M.louvers ? ((gz % 2) ? louverI : paintI) : rearGlassI;
            else c = paintI;
          } else {
            const nearPillarA = x < flat0 + 0.02;
            const cPillar = x > Math.min(flat1 + 0.2, rgEnd);
            const bP = M.bPillar != null && Math.abs(x - M.bPillar) < 0.05;
            const roofEdge = !above ? false : true;
            if (nearPillarA || cPillar || bP || (roofEdge && x >= flat0 && x <= flat1 && T(gx, gy + 1, gz) === 0)) c = M.roofColor && !nearPillarA && !cPillar ? roofI : paintI;
            else c = glassI;
            if (H(gy) < interp(M.hood, x) + 0.05) c = paintI;
          }
        }
        g.set(gx, gy, gz, c);
      }
    }
  }

  // pass 3: added boxes (wings, mirrors, exhausts...)
  const hwFull = W / 2;
  for (const b of M.boxes || []) {
    const ci = b.color === 'paint' ? paintI : pal.get(b.color, b.group === 'tail' ? 1 : 0);
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
    const ci = pal.get(f.color, groupOf(f));
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
  return {
    grid: g, palette: pal.list,
    // grid z increases toward the front; local z = gz*VS - (Lc - cFromFront)
    offset: [-xOff / VS, 0, -(Lc - cFromFront) / VS],
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

/**
 * Returns a THREE.Group for the car plus handles for animation.
 * opts.ghost -> translucent material
 */
export function buildCarObject(spec, paint, opts = {}) {
  const key = spec.id + paint;
  let geos = geoCache.get(key);
  if (!geos) {
    const { grid, palette, offset } = buildCarGrid(spec, paint);
    const [body, tail, head] = meshGrid(grid, palette, { scale: VS, offset, groups: 3 });
    geos = { body, tail, head, wheel: buildWheelGeometry(spec.model) };
    geoCache.set(key, geos);
  }
  const ghost = !!opts.ghost;
  const bodyMat = ghost
    ? new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.32, depthWrite: false })
    : new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: 0x2a2a2a });
  const tailMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: ghost, opacity: ghost ? 0.32 : 1 });
  const headMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: ghost, opacity: ghost ? 0.32 : 1 });
  tailMat.color.setScalar(0.55);

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
  // headlight glow / shadow blob are handled by the scene
  return {
    root, bodyPivot, wheels, tailMat, headMat, bodyMat, meshes,
    setBrake(on) { tailMat.color.setScalar(on ? 1.6 : 0.55); },
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
    },
  };
}

export const CAR_VOXEL = VS;
