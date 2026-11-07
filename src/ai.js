// AI driver: pure-pursuit steering along the optimised racing line, a
// per-car speed profile for throttle/brake, and simple traffic avoidance.
import { clamp, lerp } from './util.js';
import { speedProfile } from './trackCore.js';

export class AIDriver {
  constructor(rc, opts = {}) {
    this.rc = rc;
    this.track = rc.track;
    this.skill = opts.skill ?? 0.95; // fraction of the car's limit used in corners
    this.pace = opts.pace ?? 1.0; // straight-line throttle discipline
    this.profile = speedProfile(this.track, rc.spec, this.skill);
    this.passOff = 0;
    this.passTarget = 0;
    this.mistake = 0;
    this.seed = Math.random() * 1000;
    this.stuckT = 0;
  }

  update(dt, cars, time) {
    const rc = this.rc, veh = rc.veh, tr = this.track;
    const loc = rc.loc;
    if (!loc) return;
    const N = tr.N, ds = tr.ds;
    const v = Math.max(veh.vx, 0);

    // ---- traffic: look for a car just ahead and pick a side -------------
    let blocker = null, bestGap = 1e9;
    for (const o of cars) {
      if (o === rc || !o.loc) continue;
      let gap = o.loc.s - loc.s;
      if (gap < -tr.length / 2) gap += tr.length;
      if (gap > tr.length / 2) gap -= tr.length;
      if (gap > 1 && gap < 28 + v * 0.4 && Math.abs(o.loc.d - loc.d) < 3.2) {
        const closing = v - o.veh.vx;
        if ((closing > -1 || gap < 9) && gap < bestGap) { bestGap = gap; blocker = o; }
      }
    }
    if (blocker) {
      const room = tr.halfW - 1.4;
      const od = blocker.loc.d;
      // go to whichever side has more space
      const leftSpace = room - od, rightSpace = od + room;
      const want = leftSpace > rightSpace ? od + 2.6 : od - 2.6;
      this.passTarget = clamp(want - tr.lineOff[loc.i], -room * 2, room * 2);
    } else this.passTarget *= Math.pow(0.4, dt);
    this.passOff = lerp(this.passOff, this.passTarget, 1 - Math.exp(-dt * 2.2));

    // ---- steering: pure pursuit -------------------------------------------
    const look = clamp(7 + v * 0.42, 9, 42);
    const iT = (loc.i + Math.round(look / ds)) % N;
    const lim = tr.halfW - 1.1;
    const off = clamp(tr.lineOff[iT] + this.passOff, -lim, lim);
    const txp = tr.px[iT] + tr.nx[iT] * off, tzp = tr.pz[iT] + tr.nz[iT] * off;
    const dx = txp - veh.x, dz = tzp - veh.z;
    const fx = Math.sin(veh.h), fz = Math.cos(veh.h);
    const lf = dx * fx + dz * fz;
    const ll = dx * fz - dz * fx;
    const alpha = Math.atan2(ll, lf);
    const ld = Math.hypot(dx, dz);
    let steerAng = Math.atan((2 * veh.L * Math.sin(alpha)) / Math.max(ld, 4));
    // damp yaw a little to avoid weaving at speed, and catch slides
    steerAng -= (veh.r - (v * Math.tan(veh.steerAngle)) / veh.L) * 0.02;
    const beta = Math.atan2(veh.vy, Math.max(Math.abs(veh.vx), 1));
    if (Math.abs(beta) > 0.06) steerAng += beta * 0.8;
    rc.input.steer = clamp(steerAng / Math.max(veh.maxSteer(1, steerAng), 0.05), -1, 1);

    // ---- speed -------------------------------------------------------------
    // Brake on the deceleration needed to meet the profile anywhere in the
    // next stretch of track, not just at one look-ahead point.
    const capDecel = 9.81 * rc.spec.grip * 1.1 * 0.82 * rc.spec.brake;
    let vt = this.profile[(loc.i + Math.round((2 + v * 0.1) / ds)) % N];
    let need = 0;
    const scan = Math.round((20 + v * v / 14) / ds);
    for (let k = 2; k <= scan; k += 2) {
      const vp = this.profile[(loc.i + k) % N] * this.pace;
      if (vp < v) need = Math.max(need, (v * v - vp * vp) / (2 * k * ds));
    }
    if (this.passOff !== 0 && Math.abs(this.passOff) > 1.5) vt *= 0.985;
    if (blocker && bestGap < 10 && Math.abs(blocker.loc.d - loc.d) < 2.2) vt = Math.min(vt, blocker.veh.vx - 0.5);
    const offTrack = Math.abs(loc.d) > tr.halfW + 0.5;
    if (offTrack) vt = Math.min(vt, 22);
    vt *= this.pace;
    const err = vt - v;
    if (need > capDecel * 0.78 || err < -1.5) {
      rc.input.throttle = 0;
      rc.input.brake = clamp(Math.max((need / capDecel) * 1.05, -err / 6), 0.15, 1);
    } else {
      rc.input.brake = 0;
      rc.input.throttle = clamp(0.35 + err / 2.5, 0, 1);
      // ease off when sliding
      const slide = Math.abs(veh.vy) / Math.max(v, 5);
      if (slide > 0.08) rc.input.throttle *= clamp(1 - (slide - 0.08) * 6, 0.2, 1);
    }
    rc.input.handbrake = false;

    // ---- recovery: reverse out if stuck -------------------------------------
    if (time > 6 && v < 1.5 && !rc.frozen) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.stuckT > 3) {
      this.stuckT = 0;
      rc.placeAt(loc.s, clamp(tr.lineOff[loc.i], -3, 3));
    }
  }
}
