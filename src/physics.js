// Vehicle dynamics: two-axle ("bicycle") model with a Pacejka-style lateral
// curve, friction-ellipse combined slip, longitudinal load transfer, engine
// torque curve, gearbox, turbo lag, aero drag/downforce and driver aids.
//
// Frames: world X/Z plane (three.js, y up). Heading h: forward = (sin h, cos h),
// left = (cos h, -sin h). Local velocity vx (forward), vy (left), yaw rate r
// (positive = turning left).
import { clamp, lerp, sign } from './util.js';

export const G = 9.81;
export const TIRE_MU = 1.1; // sports road tyres
const RHO = 1.225;
const DRIVER_EFF = 0.86; // drivetrain efficiency
// Front tyres are a touch softer/less grippy than the rears: mild, stable
// understeer at the limit like a real road car. spec.rearGrip tunes balance.
const PAC_C = 1.5, PAC_BF = 14, PAC_BR = 17;
export const FRONT_MU = 0.97;
const pacF = (a) => Math.sin(PAC_C * Math.atan(PAC_BF * a));
const pacR = (a) => Math.sin(PAC_C * Math.atan(PAC_BR * a));

export const SURFACE = {
  asphalt: { id: 0, mu: 1.0, roll: 0.014, name: 'asphalt' },
  kerb: { id: 1, mu: 0.94, roll: 0.02, name: 'kerb' },
  grass: { id: 2, mu: 0.58, roll: 0.09, name: 'grass' },
  gravel: { id: 3, mu: 0.5, roll: 0.32, name: 'gravel' },
};

export class Vehicle {
  constructor(spec) {
    this.spec = spec;
    this.L = spec.wheelbase;
    this.a = this.L * (1 - spec.wf); // CG -> front axle
    this.b = this.L * spec.wf; // CG -> rear axle
    this.m = spec.mass;
    this.Iz = this.m * Math.pow(0.48 * this.L, 2) * spec.inertia;
    this.R = spec.wheelRadius;
    const psToW = 735.5;
    const wPk = (spec.powerRpm * Math.PI) / 30;
    const tAtP = (spec.powerPS * psToW) / wPk;
    this.curve = [
      [0, spec.torqueNm * 0.45],
      [spec.idle, spec.torqueNm * 0.55],
      [spec.torqueRpm, spec.torqueNm],
      [spec.powerRpm, tAtP],
      [spec.redline + 400, tAtP * 0.84],
    ];
    this.revGear = 3.3;
    this.reset(0, 0, 0);
  }

  reset(x, z, h, y = 0) {
    this.x = x; this.z = z; this.y = y; this.h = h;
    this.vx = 0; this.vy = 0; this.r = 0;
    this.gear = 1;
    this.rpm = this.spec.idle;
    this.shiftTimer = 0;
    this.boost = 0;
    this.axF = 0; // filtered longitudinal accel (load transfer)
    this.ayF = 0;
    this.steerAngle = 0;
    this.wheelSpin = [0, 0]; // visual wheel rotation angle front/rear
    this.slipF = 0; this.slipR = 0; // 0..1 how far past grip (for smoke/squeal)
    this.spinning = false;
    this.locked = false;
    this.tcsActive = 0; this.asmActive = 0;
    this.revLimiter = false;
    this.reverseTimer = 0;
    this.load = 0;
    this.pitch = 0; this.roll = 0; this.pitchV = 0; this.rollV = 0;
    this.offroad = 0;
    this.lastShift = 0;
  }

  get speed() {
    return Math.hypot(this.vx, this.vy);
  }
  get fwdX() { return Math.sin(this.h); }
  get fwdZ() { return Math.cos(this.h); }
  get velX() { return this.vx * Math.sin(this.h) + this.vy * Math.cos(this.h); }
  get velZ() { return this.vx * Math.cos(this.h) - this.vy * Math.sin(this.h); }
  setWorldVel(wx, wz) {
    const s = Math.sin(this.h), c = Math.cos(this.h);
    this.vx = wx * s + wz * c;
    this.vy = wx * c - wz * s;
  }

  torqueAt(rpm) {
    const c = this.curve;
    if (rpm <= c[0][0]) return c[0][1];
    for (let i = 1; i < c.length; i++) {
      if (rpm <= c[i][0]) {
        const t = (rpm - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
        return lerp(c[i - 1][1], c[i][1], t);
      }
    }
    return c[c.length - 1][1];
  }

  ratio(g = this.gear) {
    if (g === -1) return -this.revGear * this.spec.final;
    if (g <= 0) return 0;
    return this.spec.gears[g - 1] * this.spec.final;
  }

  wheelRpm(g = this.gear) {
    return (Math.abs(this.vx) / this.R) * Math.abs(this.ratio(g)) * (30 / Math.PI);
  }

  shift(to) {
    const n = this.spec.gears.length;
    to = clamp(to, -1, n);
    if (to === this.gear) return;
    this.gear = to;
    this.shiftTimer = to === -1 || this.gear === 0 ? 0.25 : this.spec.shiftTime;
    this.lastShift = performance_now();
  }

  // Max road-wheel angle, speed sensitive so a keyboard can't instantly
  // overwhelm the front tyres at speed. Opens up when the car is sliding so
  // counter-steer is always possible.
  // dir: sign of the requested steer; extra lock is only granted for
  // counter-steer (steering toward where the car is actually travelling).
  maxSteer(mu = 1, dir = 0) {
    const v = Math.max(Math.abs(this.vx), 1);
    const beta = Math.atan2(this.vy, Math.abs(this.vx) + 0.5);
    const counter = dir !== 0 && Math.sign(dir) === Math.sign(beta) ? Math.abs(beta) * 0.9 : 0;
    return Math.min(this.spec.steerLock, (this.L * mu * G * this.spec.grip * TIRE_MU) / (v * v) + 0.11 + counter);
  }

  /**
   * input: {throttle 0..1, brake 0..1, steer -1..1 (+left), handbrake bool,
   *         shiftUp, shiftDown (edge-triggered bools)}
   * env:   {surfF, surfR (SURFACE entries), slope (dy/ds along car heading), auto, tcs, asm}
   */
  step(dt, input, env) {
    const s = this.spec;
    const m = this.m;
    let throttle = clamp(input.throttle || 0, 0, 1);
    let brake = clamp(input.brake || 0, 0, 1);
    const nG = s.gears.length;

    // ---- gear selection -------------------------------------------------
    if (env.auto) {
      // auto reverse: hold brake at standstill
      if (this.gear >= 1 && Math.abs(this.vx) < 0.6 && brake > 0.5 && throttle < 0.1) {
        this.reverseTimer += dt;
        if (this.reverseTimer > 0.35) { this.shift(-1); this.reverseTimer = 0; }
      } else if (this.gear === -1 && this.vx > -0.6 && throttle > 0.3 && brake < 0.1) {
        this.shift(1);
      } else this.reverseTimer = 0;
      if (this.gear === -1) { const t = throttle; throttle = brake; brake = t; }
      else if (this.shiftTimer <= 0 && this.gear >= 1) {
        const rpmW = this.wheelRpm();
        if (this.gear < nG && rpmW > s.redline - 180 && throttle > 0.2) this.shift(this.gear + 1);
        else if (this.gear > 1) {
          const lower = rpmW * (s.gears[this.gear - 2] / s.gears[this.gear - 1]);
          if (lower < s.redline * (throttle > 0.5 ? 0.84 : 0.72)) this.shift(this.gear - 1);
        }
      }
    } else {
      if (input.shiftUp) this.shift(this.gear === -1 ? 1 : this.gear + 1);
      if (input.shiftDown) {
        if (this.gear > 1) this.shift(this.gear - 1);
        else if (this.gear === 1 && Math.abs(this.vx) < 2) this.shift(-1);
      }
      if (this.gear === -1) { const t = throttle; throttle = brake; brake = t; }
    }
    if (this.shiftTimer > 0) this.shiftTimer -= dt;

    // ---- surfaces & normal loads ------------------------------------------
    const muF = env.surfF.mu * s.grip * TIRE_MU * FRONT_MU, muR = env.surfR.mu * s.grip * TIRE_MU * (s.rearGrip || 1.05);
    const v = this.speed;
    const down = 0.5 * RHO * s.clA * v * v;
    const h = s.cgHeight;
    let Fzf = m * G * s.wf + down * s.frontDown - (m * this.axF * h) / this.L;
    let Fzr = m * G * (1 - s.wf) + down * (1 - s.frontDown) + (m * this.axF * h) / this.L;
    Fzf = Math.max(Fzf, m * G * 0.08);
    Fzr = Math.max(Fzr, m * G * 0.08);
    const capF = muF * Fzf, capR = muR * Fzr;

    // ---- engine ---------------------------------------------------------
    const engaged = this.gear !== 0 && this.shiftTimer <= 0;
    const rpmW = this.wheelRpm();
    const launchRpm = Math.min(s.torqueRpm, s.redline * 0.55);
    let targetRpm;
    if (engaged) targetRpm = Math.max(rpmW, s.idle + throttle * (launchRpm - s.idle) * (rpmW < launchRpm ? 1 : 0));
    else targetRpm = s.idle + throttle * (s.redline - s.idle);
    targetRpm = Math.max(targetRpm, rpmW * (engaged ? 1 : 0), s.idle);
    this.rpm = lerp(this.rpm, Math.min(targetRpm, s.redline + 150), 1 - Math.exp(-dt * (engaged ? 30 : 8)));

    if (s.turbo) {
      const tgt = throttle * clamp((this.rpm - s.turbo.minRpm) / 1800, 0, 1);
      this.boost += (tgt - this.boost) * clamp(dt / (tgt > this.boost ? s.turbo.lag : 0.12), 0, 1);
    }
    this.revLimiter = this.rpm >= s.redline;
    let engT = 0;
    if (engaged) {
      const tq = this.torqueAt(this.rpm) * (s.turbo ? 0.62 + 0.38 * this.boost : 1);
      engT = this.revLimiter ? 0 : tq * throttle;
      engT -= (1 - throttle) * s.torqueNm * 0.14 * (this.rpm / s.redline); // engine braking
    }
    this.load = engaged ? throttle : 0;

    // ---- longitudinal forces per axle ----------------------------------
    const ratio = this.ratio();
    let Fdrive = engaged ? (engT * ratio * DRIVER_EFF) / this.R : 0;
    // ASM: cut throttle when the rear is stepping out
    if (env.asm && this.asmActive > 0.2 && Fdrive > 0) Fdrive *= 1 - clamp(this.asmActive, 0, 0.7);
    let FdF = Fdrive * s.driveFront, FdR = Fdrive * (1 - s.driveFront);

    const brakeTotal = brake * s.brake * 1.35 * m * G;
    // EBD: split braking by the axles' current load so neither end saturates first
    const bias = clamp(Fzf / (Fzf + Fzr) + 0.03, 0.5, 0.85);
    const dirF = sign(this.vx), dirR = sign(this.vx);
    const lowSpd = clamp(Math.abs(this.vx) / 0.6, 0, 1);
    let FbF = -dirF * brakeTotal * bias * lowSpd;
    let FbR = -dirR * brakeTotal * (1 - bias) * lowSpd;
    // ABS: never exceed ~peak
    if (Math.abs(FbF) > capF * 0.97) FbF = sign(FbF) * capF * 0.97;
    if (Math.abs(FbR) > capR * 0.97) FbR = sign(FbR) * capR * 0.97;
    let handbrakeR = false;
    if (input.handbrake && Math.abs(this.vx) > 0.5) {
      FbR = -dirR * capR * 0.85;
      handbrakeR = true;
      FdR = 0;
    }

    let FxF = FdF + FbF, FxR = FdR + FbR;
    let spinF = false, spinR = false;
    this.tcsActive = Math.max(0, this.tcsActive - dt * 4);
    const tcsLimit = 0.78;
    if (Math.abs(FxF) > capF * (env.tcs ? tcsLimit : 0.98)) {
      if (env.tcs && FdF !== 0 && Math.sign(FdF) === Math.sign(FxF)) { FxF = sign(FxF) * capF * tcsLimit; this.tcsActive = 1; }
      else { FxF = sign(FxF) * capF * 0.9; spinF = true; }
    }
    if (Math.abs(FxR) > capR * (env.tcs ? tcsLimit : 0.98)) {
      if (env.tcs && FdR !== 0 && Math.sign(FdR) === Math.sign(FxR)) { FxR = sign(FxR) * capR * tcsLimit; this.tcsActive = 1; }
      else { FxR = sign(FxR) * capR * 0.9; spinR = true; }
    }
    if (handbrakeR) spinR = true;

    // ---- steering --------------------------------------------------------
    const maxSt = this.maxSteer(env.surfF.mu, input.steer || 0);
    const targetSteer = clamp(input.steer || 0, -1, 1) * maxSt;
    const rate = 3.2; // rad/s rack speed
    this.steerAngle += clamp(targetSteer - this.steerAngle, -rate * dt, rate * dt);
    const d = this.steerAngle;

    // ---- slip angles & lateral forces -----------------------------------
    const vxa = Math.max(Math.abs(this.vx), 3.0);
    const vyF = this.vy + this.a * this.r;
    const vyR = this.vy - this.b * this.r;
    const cd = Math.cos(d), sd = Math.sin(d);
    const vxwF = this.vx * cd + vyF * sd;
    const vywF = -this.vx * sd + vyF * cd;
    const aF = Math.atan2(vywF, Math.max(Math.abs(vxwF), 3.0));
    const aR = Math.atan2(vyR, vxa);
    const ellF = Math.sqrt(Math.max(0.0, 1 - (FxF / capF) ** 2));
    const ellR = Math.sqrt(Math.max(0.0, 1 - (FxR / capR) ** 2));
    let FyF = -capF * pacF(aF) * ellF * (spinF ? 0.8 : 1);
    let FyR = -capR * pacR(aR) * ellR * (spinR ? (handbrakeR ? 0.55 : 0.8) : 1);

    // force on car body
    const FxFc = FxF * cd - FyF * sd;
    const FyFc = FxF * sd + FyF * cd;

    // ---- resistances -------------------------------------------------------
    const drag = 0.5 * RHO * s.cd * s.area * v * v;
    const rollRes = ((env.surfF.roll + env.surfR.roll) * 0.5) * m * G;
    const resist = (drag + rollRes) * clamp(Math.abs(this.vx) / 0.5, 0, 1);
    const gravity = -m * G * (env.slope || 0);

    let Fx = FxFc + FxR - sign(this.vx) * resist + gravity;
    let Fy = FyFc + FyR;
    let Mz = this.a * FyFc - this.b * FyR;

    // ---- ASM (stability management) ---------------------------------------
    // Acts only on genuine oversteer: rear slip angle running past the front's.
    this.asmActive = Math.max(0, this.asmActive - dt * 3);
    if (env.asm && this.vx > 6) {
      const over = Math.abs(aR) - Math.max(Math.abs(aF), 0.085);
      if (over > 0.012) {
        const k = clamp(over * 12, 0, 1);
        const corr = sign(aR) * k * 0.45 * m * G * 0.75; // one-side braking moment
        Mz += corr;
        Fx -= sign(this.vx) * k * 0.12 * m * G;
        this.asmActive = Math.max(this.asmActive, k);
      }
      // yaw-rate ceiling: no road car can sustain more than ~mu*g/v
      const rCap = (Math.min(muF, muR) * G * 1.12) / this.vx;
      const excess = Math.abs(this.r) - rCap;
      if (excess > 0) {
        Mz -= sign(this.r) * clamp(excess * this.Iz * 6, 0, 0.5 * m * G * 0.75);
        this.asmActive = Math.max(this.asmActive, clamp(excess * 3, 0, 1));
      }
    }

    // ---- integrate (semi-implicit Euler in the body frame) ------------------
    const ax = Fx / m + this.vy * this.r;
    const ay = Fy / m - this.vx * this.r;
    this.vx += ax * dt;
    this.vy += ay * dt;
    this.r += (Mz / this.Iz) * dt;

    // stop creeping
    if (Math.abs(this.vx) < 0.08 && throttle < 0.05 && Math.abs(Fdrive) < 1) {
      this.vx *= 0.5;
    }
    if (brake > 0.2 && Math.abs(this.vx) < 0.35 && throttle < 0.05) {
      this.vx *= 0.6; this.vy *= 0.6; this.r *= 0.6;
    }

    // low speed: blend toward kinematic steering to avoid slip-angle blow-up
    const sp = this.speed;
    const kin = 1 - clamp((sp - 1.5) / 4.5, 0, 1);
    if (kin > 0) {
      const rK = (this.vx * Math.tan(d)) / this.L;
      this.r = lerp(this.r, rK, kin);
      this.vy = lerp(this.vy, this.vx * Math.tan(d) * (this.b / this.L), kin * 0.6);
    }
    this.r = clamp(this.r, -5, 5);

    // filtered accelerations for load transfer & visual body motion
    const axBody = Fx / m;
    this.axF += (axBody - this.axF) * clamp(dt * 8, 0, 1);
    const ayBody = Fy / m;
    this.ayF += (ayBody - this.ayF) * clamp(dt * 8, 0, 1);

    // world integration
    const sh = Math.sin(this.h), ch = Math.cos(this.h);
    this.x += (this.vx * sh + this.vy * ch) * dt;
    this.z += (this.vx * ch - this.vy * sh) * dt;
    this.h += this.r * dt;

    // ---- telemetry for effects -------------------------------------------
    const pkA = 0.11;
    this.slipF = clamp((Math.abs(aF) - pkA) / 0.25, 0, 1) + (spinF ? 0.6 : 0);
    this.slipR = clamp((Math.abs(aR) - pkA) / 0.25, 0, 1) + (spinR ? 0.8 : 0);
    this.spinning = spinR || spinF;
    this.locked = handbrakeR;
    const wF = this.vx / this.R, wR = spinR && !handbrakeR ? (this.vx + 6 * sign(FxR)) / this.R : handbrakeR ? 0 : this.vx / this.R;
    this.wheelSpin[0] = (this.wheelSpin[0] + wF * dt) % (Math.PI * 2);
    this.wheelSpin[1] = (this.wheelSpin[1] + wR * dt) % (Math.PI * 2);

    // visual suspension (spring-damper toward accel-induced angles)
    const pitchT = clamp(-this.axF * 0.0045, -0.05, 0.05);
    const rollT = clamp(-this.ayF * 0.006, -0.07, 0.07);
    this.pitchV += ((pitchT - this.pitch) * 120 - this.pitchV * 14) * dt;
    this.rollV += ((rollT - this.roll) * 120 - this.rollV * 14) * dt;
    this.pitch += this.pitchV * dt;
    this.roll += this.rollV * dt;
  }
}

// performance.now() isn't guaranteed in every runtime the sim runs in.
function performance_now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
