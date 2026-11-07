// World simulation: cars on a track with surfaces, walls and car-car contact.
// Pure JS (no rendering) so it can be driven headless by tests.
import { Vehicle, SURFACE } from './physics.js';
import { clamp, lerp } from './util.js';
import { SURF_ID } from './trackCore.js';

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
    this.lastIdx = this.loc.i;
  }
}

function surfaceAt(track, loc, d) {
  const ad = Math.abs(d);
  if (ad <= track.halfW) return SURFACE.asphalt;
  if (ad <= track.halfW + 1.1 && loc.kerb) return SURFACE.kerb;
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
  // ---- walls ----
  const fx2 = Math.sin(veh.h), fz2 = Math.cos(veh.h);
  const nx2 = loc.tz, nz2 = -loc.tx;
  const fn2 = fx2 * nx2 + fz2 * nz2;
  const ft2 = fx2 * loc.tx + fz2 * loc.tz;
  const extent = Math.abs(fn2) * rc.halfLen + Math.abs(ft2) * rc.halfWid;
  rc.wallScrape = Math.max(0, rc.wallScrape - dt * 4);
  for (const side of [1, -1]) {
    const wall = side > 0 ? loc.wallL : loc.wallR;
    const pen = side * loc.d + extent - wall;
    if (pen > 0) {
      veh.x -= nx2 * side * pen;
      veh.z -= nz2 * side * pen;
      let wx = veh.velX, wz = veh.velZ;
      const vn = (wx * nx2 + wz * nz2) * side; // into the wall
      if (vn > 0) {
        const vtX = wx - nx2 * side * vn, vtZ = wz - nz2 * side * vn;
        const fric = clamp(1 - 0.06 - 0.03 * vn, 0.55, 1);
        wx = vtX * fric - nx2 * side * vn * 0.3;
        wz = vtZ * fric - nz2 * side * vn * 0.3;
        veh.setWorldVel(wx, wz);
        veh.r *= 0.55;
        // nudge heading toward the wall direction on glancing hits
        const want = Math.atan2(loc.tx, loc.tz);
        let dh = want - veh.h;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        if (Math.abs(dh) < 1.2) veh.h += dh * clamp(vn * 0.02, 0, 0.25);
        rc.impact = Math.max(rc.impact, vn);
      }
      rc.wallScrape = 1;
      loc = track.locate(veh.x, veh.z, loc.i);
    }
  }
  veh.y = loc.y;
  rc.loc = loc;
  rc.hint = loc.i;
}

// Car-car contact using three circles per car.
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
}
