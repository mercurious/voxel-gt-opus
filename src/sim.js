// World simulation: cars on a track with surfaces, barriers and car-car contact.
// Pure JS (no rendering) so it can be driven headless by tests.
import { Vehicle, SURFACE } from './physics.js';
import { clamp, lerp } from './util.js';
import { SURF_ID, barriersNear } from './trackCore.js';

const SURF_BY_ID = [SURFACE.asphalt, SURFACE.grass, SURFACE.gravel, { ...SURFACE.asphalt, mu: 0.96, name: 'runoff' }];

export class RaceCar {
  constructor(spec, track, opts = {}) {
    this.spec = spec;
    this.track = track;
    this.veh = new Vehicle(spec);
    this.isPlayer = !!opts.isPlayer;
    this.name = opts.name || spec.brand;
    this.paint = opts.paint || spec.paints[0].hex;
    this.halfLen = spec.model.length / 2;
    this.halfWid = spec.model.width / 2;
    // the rendered body against the barriers: wheelbase centre +- overhangs,
    // measured from the CG along the heading (see carModel.js / game.render)
    this.bodyFront = this.veh.a - this.veh.L / 2 + spec.model.wheelbase / 2 + spec.model.frontOverhang;
    this.bodyRear = spec.model.length - this.bodyFront;
    this.safe = { x: 0, z: 0, h: 0, ok: false }; // last pose clear of the barriers
    this.shoved = false; // pushed by another car this step
    this.hint = -1;
    this.loc = null;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false };
    this.ai = null;
    this.impact = 0; // last impact strength for audio/fx
    this.wallScrape = 0;
    this.surfaceName = 'asphalt';
    this.frozen = false;
    // race progress
    this.lap = 0; // completed laps
    this.lastIdx = 0;
    this.progress = 0; // continuous distance along the race (m)
    this.checkpoint = 0;
    this.lapStart = 0;
    this.lapTimes = [];
    this.bestLap = null;
    this.finished = false;
    this.finishTime = null;
    this.lapInvalid = false;
    this.wrongWay = 0;
    this.stuck = 0;
  }

  placeAt(s, off = 0) {
    const p = this.track.sample(s, off);
    this.veh.reset(p.x, p.z, p.heading, p.y);
    this.hint = p.i;
    this.loc = this.track.locate(p.x, p.z, this.hint);
    this.safe.ok = false;
    this.lastIdx = this.loc.i;
  }
}

function surfaceAt(track, loc, d) {
  const ad = Math.abs(d);
  if (ad <= loc.hw) return SURFACE.asphalt;
  if (ad <= loc.hw + 1.1 && loc.kerb) return SURFACE.kerb;
  const id = d > 0 ? loc.surfL : loc.surfR;
  if (ad <= track.halfW + 1.6 && id !== SURF_ID.grass) return SURF_BY_ID[id];
  return SURF_BY_ID[id];
}

export function stepCar(rc, dt, settings) {
  const track = rc.track;
  const veh = rc.veh;
  let loc = rc.loc || track.locate(veh.x, veh.z, rc.hint);
  const fx = Math.sin(veh.h), fz = Math.cos(veh.h);
  const nxx = loc.tz, nzz = -loc.tx; // left normal at our position
  const fn = fx * nxx + fz * nzz; // forward . normal
  const dF = loc.d + fn * veh.a, dR = loc.d - fn * veh.b;
  const surfF = surfaceAt(track, loc, dF), surfR = surfaceAt(track, loc, dR);
  rc.surfaceName = surfR.name;
  const ft = fx * loc.tx + fz * loc.tz;
  const env = {
    surfF, surfR,
    slope: loc.slope * ft,
    auto: settings.auto, tcs: settings.tcs, asm: settings.asm,
  };
  const inp = rc.frozen ? { throttle: rc.input.throttle, brake: 0, steer: 0 } : rc.input;
  if (rc.frozen) { veh.vx = 0; veh.vy = 0; veh.r = 0; }
  veh.step(dt, inp, env);
  if (rc.frozen) { veh.vx = 0; veh.vy = 0; veh.r = 0; }
  rc.input.shiftUp = rc.input.shiftDown = false;

  loc = track.locate(veh.x, veh.z, loc.i);
  rc.wallScrape = Math.max(0, rc.wallScrape - dt * 4);
  if (collideBarriers(rc)) loc = track.locate(veh.x, veh.z, loc.i);
  veh.y = loc.y;
  rc.loc = loc;
  rc.hint = loc.i;
}

// Barrier contact against track.barriers, the same lines the scene draws. The
// car is its rendered body box. Each corner is swept from the last pose that
// was clear of the barriers, so it can't tunnel through at any speed or be
// shoved through by another car; convex barrier corners (kerb corners on the
// inside of a turn) are kept out of the body's flanks. Contacts resolve
// deepest first along the barrier normal (sliding along the last face when
// wedged into an acute corner) with the usual bounce and scrub.
// Returns true if the car was moved.
const near = [];
const cx = new Float64Array(4), cz = new Float64Array(4), sx = new Float64Array(4), sz = new Float64Array(4);
function bodyCorners(rc, x, z, h, ox, oz) {
  const fx = Math.sin(h), fz = Math.cos(h), F = rc.bodyFront, R = rc.bodyRear, W = rc.halfWid;
  ox[0] = x + fx * F + fz * W; oz[0] = z + fz * F - fx * W;
  ox[1] = x + fx * F - fz * W; oz[1] = z + fz * F + fx * W;
  ox[2] = x - fx * R - fz * W; oz[2] = z - fz * R + fx * W;
  ox[3] = x - fx * R + fz * W; oz[3] = z - fz * R - fx * W;
}
function collideBarriers(rc) {
  const B = rc.track.barriers, veh = rc.veh, safe = rc.safe;
  const W = rc.halfWid, mid = (rc.bodyFront - rc.bodyRear) / 2, hl = (rc.bodyFront + rc.bodyRear) / 2;
  if (safe.ok) bodyCorners(rc, safe.x, safe.z, safe.h, sx, sz);
  const travel = safe.ok ? Math.hypot(veh.x - safe.x, veh.z - safe.z) : 0;
  const cnt = barriersNear(B, veh.x + Math.sin(veh.h) * mid, veh.z + Math.cos(veh.h) * mid, Math.hypot(hl, W) + travel + 1.5, near);
  let moved = false, clear = false, pnx = 0, pnz = 0; // (pnx, pnz): the last push's normal
  for (let it = 0; it < 8 && !clear; it++) {
    bodyCorners(rc, veh.x, veh.z, veh.h, cx, cz);
    let best = 0, bnx = 0, bnz = 0, bwant = NaN; // deepest contact; (bnx, bnz) = way out
    for (let c = 0; c < 4; c++) {
      let cT = 2, cD = 0, cnx = 0, cnz = 0, cw = NaN; // first face crossed this step
      let sD = 0.75, snx = 0, snz = 0, sw = NaN; // else: shallowest face it is just behind
      for (let q = 0; q < cnt; q++) {
        const s = near[q];
        if (B.over[s] && Math.abs(B.y[s] - veh.y) > 3) continue; // the other level at a bridge
        const nx = B.nx[s], nz = B.nz[s];
        const d = (cx[c] - B.ax[s]) * nx + (cz[c] - B.az[s]) * nz;
        if (d >= 0) continue;
        const ux = (B.bx[s] - B.ax[s]) / B.len[s], uz = (B.bz[s] - B.az[s]) / B.len[s];
        const d0 = safe.ok ? (sx[c] - B.ax[s]) * nx + (sz[c] - B.az[s]) * nz : -1;
        if (d0 >= -0.01) {
          // was in front of the face line: did it cross within the segment?
          const t = d0 <= 0 ? 0 : d0 / (d0 - d);
          const u = (sx[c] + (cx[c] - sx[c]) * t - B.ax[s]) * ux + (sz[c] + (cz[c] - sz[c]) * t - B.az[s]) * uz;
          if (u >= -0.01 && u <= B.len[s] + 0.01 && t < cT) { cT = t; cD = -d; cnx = nx; cnz = nz; cw = B.want[s]; }
          continue;
        }
        const u = (cx[c] - B.ax[s]) * ux + (cz[c] - B.az[s]) * uz;
        if (u >= 0 && u <= B.len[s] && -d < sD) { sD = -d; snx = nx; snz = nz; sw = B.want[s]; }
      }
      if (cT > 1 && sD < 0.75) { cD = sD; cnx = snx; cnz = snz; cw = sw; }
      if (cD > best) { best = cD; bnx = cnx; bnz = cnz; bwant = cw; }
    }
    // convex barrier corners inside the body: the shortest way out that moves
    // the car off the corner (along the corner's normal, or straight sideways
    // or fore/aft when that is shorter and also away from it)
    const fx = Math.sin(veh.h), fz = Math.cos(veh.h);
    const bx = veh.x + fx * mid, bz = veh.z + fz * mid;
    for (let q = 0; q < cnt; q++) {
      const s = near[q];
      if (!B.convex[s] || (B.over[s] && Math.abs(B.y[s] - veh.y) > 3)) continue;
      const rx = B.ax[s] - bx, rz = B.az[s] - bz;
      const a = rx * fx + rz * fz, b = rx * fz - rz * fx;
      const da = hl - Math.abs(a), db = W - Math.abs(b);
      if (da <= 0 || db <= 0) continue;
      const vx = B.vnx[s], vz = B.vnz[s];
      const vf = vx * fx + vz * fz, vl = vx * fz - vz * fx; // the normal in body axes
      let d = Infinity, px = vx, pz = vz;
      if (vf > 1e-6) d = (hl + a) / vf; else if (vf < -1e-6) d = (hl - a) / -vf;
      if (vl > 1e-6) d = Math.min(d, (W + b) / vl); else if (vl < -1e-6) d = Math.min(d, (W - b) / -vl);
      const sl = -Math.sign(b), sf = -Math.sign(a);
      if (db < d && sl * vl > 0) { d = db; px = sl * fz; pz = -sl * fx; }
      if (da < d && sf * vf > 0) { d = da; px = sf * fx; pz = sf * fz; }
      if (d <= best) continue;
      best = d; bnx = px; bnz = pz; bwant = NaN;
    }
    if (best <= 0.001) { clear = true; break; }
    let mx = bnx, mz = bnz, d = best + 0.002;
    if (bnx * pnx + bnz * pnz < -0.05) {
      // wedged between two faces: slide along the last one, not back into it
      let tx = -pnz, tz = pnx, tn = tx * bnx + tz * bnz;
      if (tn < 0) { tx = -tx; tz = -tz; tn = -tn; }
      if (tn > 0.1) { mx = tx; mz = tz; d = Math.min(d / tn, 1); }
    }
    veh.x += mx * d;
    veh.z += mz * d;
    wallHit(rc, -bnx, -bnz, Number.isNaN(bwant) ? null : bwant);
    pnx = bnx; pnz = bnz;
    moved = true;
  }
  if (clear || !safe.ok) {
    safe.x = veh.x; safe.z = veh.z; safe.h = veh.h; safe.ok = true;
  } else {
    // jammed (rare): back to the last clear pose, velocity already scrubbed
    veh.x = safe.x; veh.z = safe.z; veh.h = safe.h;
    moved = true;
  }
  return moved;
}

// Bounce/scrub the car's velocity off a wall with outward normal (wnx, wnz);
// glancing hits steer it toward heading `want`.
function wallHit(rc, wnx, wnz, want) {
  const veh = rc.veh;
  let wx = veh.velX, wz = veh.velZ;
  const vn = wx * wnx + wz * wnz; // into the wall
  if (vn > 0) {
    const vtX = wx - wnx * vn, vtZ = wz - wnz * vn;
    const fric = clamp(1 - 0.06 - 0.03 * vn, 0.55, 1);
    wx = vtX * fric - wnx * vn * 0.3;
    wz = vtZ * fric - wnz * vn * 0.3;
    veh.setWorldVel(wx, wz);
    veh.r *= 0.55;
    // nudge heading toward the wall direction on glancing hits
    if (want !== null) {
      let dh = want - veh.h;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      if (Math.abs(dh) < 1.2) veh.h += dh * clamp(vn * 0.02, 0, 0.25);
    }
    rc.impact = Math.max(rc.impact, vn);
  }
  rc.wallScrape = 1;
}

// Car-car contact using three circles per car. A car shoved into a barrier is
// put back out of it straight away (sim invariant: after a step no car is
// inside a barrier).
export function collideCars(cars) {
  for (let i = 0; i < cars.length; i++) {
    const A = cars[i];
    for (let j = i + 1; j < cars.length; j++) {
      const B = cars[j];
      const va = A.veh, vb = B.veh;
      const dx0 = vb.x - va.x, dz0 = vb.z - va.z;
      if (dx0 * dx0 + dz0 * dz0 > 49 || Math.abs(va.y - vb.y) > 3) continue;
      let best = null;
      const ra = A.halfWid * 0.95, rb = B.halfWid * 0.95;
      const offA = A.halfLen - ra, offB = B.halfLen - rb;
      for (const ka of [-1, 0, 1]) {
        const ax = va.x + Math.sin(va.h) * offA * ka, az = va.z + Math.cos(va.h) * offA * ka;
        for (const kb of [-1, 0, 1]) {
          const bx = vb.x + Math.sin(vb.h) * offB * kb, bz = vb.z + Math.cos(vb.h) * offB * kb;
          const dx = bx - ax, dz = bz - az;
          const dist = Math.hypot(dx, dz);
          const pen = ra + rb - dist;
          if (pen > 0 && (!best || pen > best.pen)) best = { pen, nx: dx / (dist || 1), nz: dz / (dist || 1), ax, az, bx, bz };
        }
      }
      if (!best) continue;
      const { pen, nx, nz } = best;
      const ima = A.frozen ? 0 : 1 / va.m, imb = B.frozen ? 0 : 1 / vb.m;
      if (ima + imb === 0) continue;
      // contact point midway
      const cx = (best.ax + best.bx) / 2, cz = (best.az + best.bz) / 2;
      const oax = cx - va.x, oaz = cz - va.z, obx = cx - vb.x, obz = cz - vb.z;
      // positional correction
      const corr = pen / (ima + imb);
      va.x -= nx * corr * ima; va.z -= nz * corr * ima;
      vb.x += nx * corr * imb; vb.z += nz * corr * imb;
      if (ima) A.shoved = true;
      if (imb) B.shoved = true;
      // velocities at contact (rotation contributes r * (oz, -ox))
      const vax = va.velX + va.r * oaz, vaz = va.velZ - va.r * oax;
      const vbx = vb.velX + vb.r * obz, vbz = vb.velZ - vb.r * obx;
      const vrel = (vbx - vax) * nx + (vbz - vaz) * nz;
      if (vrel >= 0) continue;
      const ta = oaz * nx - oax * nz, tb = obz * nx - obx * nz;
      const e = 0.15;
      const den = ima + imb + (ima ? (ta * ta) / va.Iz : 0) + (imb ? (tb * tb) / vb.Iz : 0);
      const jimp = (-(1 + e) * vrel) / den;
      const jx = nx * jimp, jz = nz * jimp;
      if (ima) {
        va.setWorldVel(va.velX - jx * ima, va.velZ - jz * ima);
        va.r -= (ta * jimp) / va.Iz * 0.6;
      }
      if (imb) {
        vb.setWorldVel(vb.velX + jx * imb, vb.velZ + jz * imb);
        vb.r += (tb * jimp) / vb.Iz * 0.6;
      }
      const strength = Math.abs(vrel);
      A.impact = Math.max(A.impact, strength);
      B.impact = Math.max(B.impact, strength);
    }
  }
  for (const c of cars) if (c.shoved) { c.shoved = false; collideBarriers(c); }
}
