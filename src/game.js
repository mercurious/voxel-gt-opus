// A race session: cars on a track, countdown, laps, positions, ghost,
// cameras and effects. Modes: 'race', 'timetrial', 'attract'.
import * as THREE from 'three';
import { CARS, carById } from './cars.js';
import { RaceCar, stepCar, collideCars } from './sim.js';
import { AIDriver } from './ai.js';
import { speedProfile } from './trackCore.js';
import { buildCarObject } from './carModel.js';
import { clamp, lerp, hash1, rng } from './util.js';
import * as store from './storage.js';

const STEP = 1 / 120;
const EXTRA_PAINTS = ['#f2f2f2', '#1c1c1e', '#ffcc00', '#2ecc71', '#ff6f00', '#7d3cff'];
// target lap = player-car ideal lap x factor (AI then drives ~5% off its ideal)
const DIFF = { easy: 1.14, normal: 1.07, hard: 1.02 };

function profileTime(track, prof) {
  let t = 0;
  for (let i = 0; i < track.N; i++) t += track.ds / Math.max(prof[i], 1);
  return t;
}

// AI skill that makes this car's ideal lap match a target time.
function skillForTarget(track, spec, target) {
  let lo = 0.7, hi = 0.985;
  if (profileTime(track, speedProfile(track, spec, hi)) >= target) return hi;
  for (let k = 0; k < 9; k++) {
    const mid = (lo + hi) / 2;
    const t = profileTime(track, speedProfile(track, spec, mid));
    if (t > target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
class Particles {
  constructor(scene, max = 500) {
    this.max = max;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.p = [];
    for (let i = 0; i < max; i++) this.p.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1, g: 0 });
    this.next = 0;
    this.col = new THREE.Color();
    this.m4 = new THREE.Matrix4();
    for (let i = 0; i < max; i++) { this.m4.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this.m4); this.mesh.setColorAt(i, this.col.set('#fff')); }
    scene.add(this.mesh);
  }
  spawn(x, y, z, vx, vy, vz, life, size, color, gravity = 0) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const q = this.p[i];
    Object.assign(q, { life, max: life, x, y, z, vx, vy, vz, s: size, g: gravity });
    this.mesh.setColorAt(i, this.col.set(color));
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      const q = this.p[i];
      if (q.life <= 0) continue;
      q.life -= dt;
      q.vy += q.g * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.vx *= 0.97; q.vz *= 0.97;
      const f = Math.max(q.life / q.max, 0);
      const s = q.g < 0 ? q.s * f : q.s * (1.6 - f) * Math.min(1, f * 3);
      this.m4.makeScale(s, s, s).setPosition(q.x, q.y, q.z);
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.parent?.remove(this.mesh); }
}

// ---------------------------------------------------------------------------
export const CAMERA_MODES = ['Chase', 'Chase Far', 'Hood', 'Bumper'];

class CameraRig {
  constructor(camera, track) {
    this.camera = camera;
    this.track = track;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.inited = false;
    this.tv = [];
    const spacing = 140;
    const n = Math.floor(track.length / spacing);
    for (let k = 0; k < n; k++) {
      const s = k * spacing + 30;
      const i = Math.floor(s / track.ds) % track.N;
      const side = hash1(k, 3) < 0.5 ? 1 : -1;
      const wall = side > 0 ? track.wallL[i] : track.wallR[i];
      const off = (wall + 4) * side;
      const p = track.sample(s, off);
      this.tv.push({ s, x: p.x, y: p.y + 3 + hash1(k, 9) * 7, z: p.z });
    }
  }
  reset() { this.inited = false; }
  update(dt, rc, mode, lookBack = false) {
    const cam = this.camera, v = rc.veh;
    const fx = Math.sin(v.h), fz = Math.cos(v.h);
    const sp = v.speed;
    const slope = rc.loc ? rc.loc.slope * (fx * rc.loc.tx + fz * rc.loc.tz) : 0;
    const cx = v.x + fx * (v.a - v.L / 2), cz = v.z + fz * (v.a - v.L / 2), cy = v.y;
    const back = lookBack ? -1 : 1;
    if (mode === 'tv') {
      const s = rc.loc ? rc.loc.s : 0;
      let best = this.tv[0], bd = 1e9;
      for (const t of this.tv) {
        let d = t.s - s;
        if (d < -this.track.length / 2) d += this.track.length;
        if (d > this.track.length / 2) d -= this.track.length;
        const score = d < -50 ? 1e9 : Math.abs(d - 30);
        if (score < bd) { bd = score; best = t; }
      }
      cam.position.set(best.x, best.y, best.z);
      this.look.lerp(new THREE.Vector3(cx, cy + 0.8, cz), this.inited ? 1 - Math.exp(-dt * 10) : 1);
      cam.lookAt(this.look);
      const dist = cam.position.distanceTo(this.look);
      cam.fov = clamp((2 * Math.atan(7 / dist) * 180) / Math.PI, 6, 55);
      cam.updateProjectionMatrix();
      this.inited = true;
      return;
    }
    if (mode === 'Hood' || mode === 'Bumper') {
      const hood = mode === 'Hood';
      const M = rc.spec.model;
      const cFront = M.frontOverhang + M.wheelbase / 2;
      const xs = M.roof[0][0] - 0.12; // just ahead of the windscreen base
      let hoodH = M.hood[0][1];
      for (let k = 1; k < M.hood.length; k++) if (M.hood[k][0] >= xs) { const a = M.hood[k - 1], b = M.hood[k]; hoodH = a[1] + (b[1] - a[1]) * ((xs - a[0]) / (b[0] - a[0])); break; }
      const fwdOff = hood ? cFront - xs : M.length / 2 - 0.2;
      const hgt = hood ? hoodH + 0.34 : 0.62;
      const px = cx + fx * fwdOff, pz = cz + fz * fwdOff;
      cam.position.set(px, cy + hgt + Math.sin(v.pitch) * 0.2, pz);
      cam.up.set(Math.sin(v.roll) * Math.cos(v.h) * 0.4, 1, -Math.sin(v.roll) * Math.sin(v.h) * 0.4).normalize();
      this.look.set(px + fx * 20 * back, cy + hgt + slope * 20 - 0.6 - v.pitch * 8, pz + fz * 20 * back);
      cam.lookAt(this.look);
      cam.up.set(0, 1, 0);
      cam.fov = lerp(cam.fov, 70 + clamp(sp * 0.12, 0, 12), 0.1);
      cam.updateProjectionMatrix();
      this.inited = false;
      return;
    }
    const far = mode === 'Chase Far';
    const dist = (far ? 9.8 : 6.7) + clamp(sp * 0.02, 0, 1.5);
    const height = far ? 3.3 : 2.35;
    // heading of the camera lags the car heading a little
    if (!this.inited) { this.camH = v.h; }
    let dh = v.h - this.camH;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.camH += dh * (1 - Math.exp(-dt * 6));
    const ch = this.camH + (lookBack ? Math.PI : 0);
    const want = new THREE.Vector3(cx - Math.sin(ch) * dist, cy + height + slope * -dist * 0.6, cz - Math.cos(ch) * dist);
    if (!this.inited) { this.pos.copy(want); this.inited = true; }
    this.pos.lerp(want, 1 - Math.exp(-dt * 12));
    // keep above the road surface
    this.pos.y = Math.max(this.pos.y, cy + 0.9);
    cam.position.copy(this.pos);
    this.look.set(cx + Math.sin(ch) * 4, cy + 1.15 + slope * 4, cz + Math.cos(ch) * 4);
    cam.lookAt(this.look);
    cam.fov = lerp(cam.fov, 60 + clamp(sp * 0.16, 0, 16), 1 - Math.exp(-dt * 4));
    cam.updateProjectionMatrix();
  }
}

// ---------------------------------------------------------------------------
export class Race {
  /**
   * opts: { scene, camera, track, trackScene, audio, settings, mode,
   *         playerSpec, playerPaint, laps, difficulty, field }
   */
  constructor(opts) {
    Object.assign(this, opts);
    const { track, mode } = this;
    this.cars = [];
    this.objs = new Map();
    this.time = 0; // race clock (since GO)
    this.clock = 0; // wall clock for the session
    this.acc = 0;
    this.state = mode === 'attract' ? 'race' : 'countdown';
    this.countdown = mode === 'timetrial' ? 1.6 : 4.2;
    this.lastBeep = -1;
    this.messages = [];
    this.camMode = this.settings.camera || 0;
    this.lookBack = false;
    this.rig = new CameraRig(this.camera, track);
    this.fx = new Particles(this.scene);
    this.finishTimer = 0;
    this.results = null;
    this.wrongTimer = 0;
    this.lapsTotal = mode === 'race' ? this.laps : Infinity;
    const R = rng(Date.now() & 0xffff);

    // ---- build the field -------------------------------------------------
    const entries = [];
    if (mode === 'attract') {
      const order = CARS.slice().sort(() => R() - 0.5);
      order.forEach((spec) => entries.push({ spec, paint: spec.paints[Math.floor(R() * spec.paints.length)].hex, skill: 0.9 + R() * 0.07 }));
    } else if (mode === 'race') {
      const pSpec = this.playerSpec;
      const ref = profileTime(track, speedProfile(track, pSpec, 0.97));
      const factor = DIFF[this.difficulty] || DIFF.normal;
      const spreads = [-0.012, 0, 0.01, 0.022].sort(() => R() - 0.5);
      let rivals;
      if (this.field === 'onemake') {
        const paints = pSpec.paints.map((p) => p.hex).concat(EXTRA_PAINTS).filter((h) => h !== this.playerPaint);
        rivals = [0, 1, 2, 3].map((k) => ({ spec: pSpec, paint: paints[k] }));
      } else {
        rivals = CARS.filter((c) => c.id !== pSpec.id).map((spec) => ({ spec, paint: spec.paints[Math.floor(R() * spec.paints.length)].hex }));
        rivals.sort(() => R() - 0.5);
      }
      rivals.forEach((r, k) => {
        r.skill = skillForTarget(track, r.spec, ref * factor * (1 + spreads[k]));
        entries.push(r);
      });
      entries.push({ spec: pSpec, paint: this.playerPaint, player: true });
    } else {
      entries.push({ spec: this.playerSpec, paint: this.playerPaint, player: true });
    }

    entries.forEach((e, k) => {
      const rc = new RaceCar(e.spec, track, { isPlayer: !!e.player, paint: e.paint, name: e.player ? 'You' : `${e.spec.brand}` });
      if (mode === 'timetrial') rc.placeAt(track.length - 160, 0);
      else rc.placeAt(track.length - 12 - k * 8, k % 2 ? -3 : 3);
      rc.lastIdx = rc.loc.i;
      rc.started = false;
      rc.cp = 0;
      rc.crossedBack = 0;
      if (!e.player) rc.ai = new AIDriver(rc, { skill: e.skill ?? 0.92 });
      if (mode !== 'attract') rc.frozen = this.state === 'countdown';
      this.cars.push(rc);
      const obj = buildCarObject(e.spec, e.paint);
      obj.root.rotation.order = 'YXZ';
      this.scene.add(obj.root);
      this.objs.set(rc, obj);
      if (e.player) this.player = rc;
    });
    if (!this.player) this.player = this.cars[0];
    this.focus = this.player;

    // ---- driving line ----------------------------------------------------
    this.playerProfile = speedProfile(track, this.player.spec, 0.95);
    this.trackScene.setDrivingLine(this.settings.line && mode !== 'attract' ? this.playerProfile : null);

    // ---- ghost (time trial) ------------------------------------------------
    this.ghost = null;
    this.ghostObj = null;
    this.rec = [];
    this.recT = 0;
    if (mode === 'timetrial') this.loadGhost();

    // ---- audio -------------------------------------------------------------
    this.voice = this.audio.engine(this.player.spec, mode === 'attract' ? 0.12 : 1);
    this.oppVoices = new Map();
    this.trackScene.setLights(mode === 'race' ? 0 : 'off');
  }

  loadGhost() {
    const g = store.loadGhost(this.track.def.id);
    if (this.ghostObj) { this.scene.remove(this.ghostObj.root); this.ghostObj.dispose(); this.ghostObj = null; }
    this.ghost = g && g.data && g.data.length > 8 ? g : null;
    if (this.ghost) {
      const spec = carById(this.ghost.car);
      this.ghostObj = buildCarObject(spec, this.ghost.paint, { ghost: true });
      this.ghostObj.root.rotation.order = 'YXZ';
      this.ghostObj.root.visible = false;
      this.scene.add(this.ghostObj.root);
    }
  }

  msg(text, dur = 2.5, cls = '') {
    this.messages.push({ text, t: dur, cls });
    if (this.messages.length > 3) this.messages.shift();
  }

  // ---- lap & progress bookkeeping ------------------------------------------
  checkLine(rc) {
    const N = this.track.N, i = rc.loc.i, L = this.track.length;
    if (rc.lastIdx > N * 0.8 && i < N * 0.2) this.onCross(rc);
    else if (rc.lastIdx < N * 0.2 && i > N * 0.8) rc.crossedBack++;
    const u = i / N;
    if (u > 0.3 && u < 0.45) rc.cp |= 1;
    if (u > 0.6 && u < 0.75) rc.cp |= 2;
    rc.lastIdx = i;
    const lapsDone = rc.started && !rc.startCross ? rc.lap : -1;
    let s = rc.loc.s;
    if ((!rc.started || rc.startCross) && s < L * 0.5) s += L; // just past the line before it registered
    rc.progress = lapsDone * L + s;
    // track limits for time trial: all four wheels off
    if (rc.isPlayer && Math.abs(rc.loc.d) > this.track.halfW + 1.1 + rc.halfWid) {
      if (!rc.lapInvalid && rc.started && this.mode === 'timetrial') { rc.lapInvalid = true; this.msg('LAP INVALIDATED', 1.8, 'warn'); }
    }
  }

  onCross(rc) {
    if (rc.crossedBack > 0) { rc.crossedBack--; return; }
    if (rc.startCross) { rc.startCross = false; rc.cp = 0; return; }
    const now = this.time;
    if (!rc.started) {
      rc.started = true;
      rc.lap = 0;
      rc.lapStart = now;
      rc.cp = 0;
      rc.lapInvalid = false;
      if (rc.isPlayer) { this.rec = []; this.recT = 0; }
      return;
    }
    if (rc.cp !== 3) { rc.cp = 0; rc.lapStart = now; rc.lapInvalid = false; return; }
    const lt = now - rc.lapStart;
    rc.lapTimes.push(lt);
    const pb = rc.bestLap == null || lt < rc.bestLap;
    if (!rc.lapInvalid && pb) rc.bestLap = lt;
    rc.lap++;
    rc.lapStart = now;
    rc.cp = 0;
    if (rc.isPlayer) {
      const tid = this.track.def.id;
      const valid = !rc.lapInvalid;
      let record = false;
      if (valid && this.mode !== 'attract') record = store.recordLap(tid, rc.spec.id, lt);
      if (this.mode === 'timetrial') {
        if (valid && (!this.ghost || lt < this.ghost.time)) {
          const data = this.rec.map((v) => Math.round(v * 100) / 100);
          store.saveGhost(tid, { car: rc.spec.id, paint: rc.paint, time: lt, dt: 0.05, data });
          this.loadGhost();
        }
        this.msg(`${valid ? '' : 'INVALID  '}LAP ${fmt(lt)}`, 3, record ? 'record' : valid ? '' : 'warn');
        if (record) this.msg('NEW RECORD', 3, 'record');
      } else {
        if (rc.lap === this.lapsTotal - 1) this.msg('FINAL LAP', 2.5, 'final');
        else if (rc.lap < this.lapsTotal) this.msg(`LAP ${fmt(lt)}`, 2.5, pb ? 'pb' : '');
      }
      this.rec = []; this.recT = 0;
      rc.lapInvalid = false;
    }
    if (this.mode === 'race' && rc.lap >= this.lapsTotal && !rc.finished) {
      rc.finished = true;
      rc.finishTime = now;
      if (rc.isPlayer) this.onPlayerFinish();
    }
  }

  onPlayerFinish() {
    const pos = this.positions().indexOf(this.player) + 1;
    this.state = 'finish';
    this.finishTimer = 0;
    this.msg(pos === 1 ? 'YOU WIN!' : `FINISHED P${pos}`, 5, pos === 1 ? 'record' : 'final');
    this.player.ai = new AIDriver(this.player, { skill: 0.86 });
  }

  positions() {
    return this.cars.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
  }

  buildResults() {
    const L = this.track.length;
    const order = this.positions();
    const winner = order[0];
    const rows = order.map((rc, k) => {
      let total = rc.finishTime;
      if (!rc.finished) {
        // estimate: remaining distance at the car's average pace
        const done = Math.max(rc.progress, 1);
        const avg = done / Math.max(this.time, 1);
        total = this.time + (this.lapsTotal * L - rc.progress) / Math.max(avg, 5);
      }
      return { pos: k + 1, name: rc.isPlayer ? 'YOU' : rc.spec.brand, car: `${rc.spec.brand} ${rc.spec.name}`, paint: rc.paint, total, best: rc.bestLap, player: rc.isPlayer };
    });
    rows.sort((a, b) => a.total - b.total).forEach((r, k) => (r.pos = k + 1));
    const t0 = rows[0].total;
    rows.forEach((r) => (r.gap = r.total - t0));
    return { rows, track: this.track.def, mode: this.mode, laps: this.lapsTotal, winner };
  }

  resetPlayer() {
    const rc = this.player;
    if (!rc.loc || this.state === 'countdown') return;
    rc.placeAt(rc.loc.s, 0);
    rc.hint = rc.loc.i;
    this.rig.reset();
  }

  // ---- main update --------------------------------------------------------------
  update(dt, input) {
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    const ev = input ? input.events : new Set();
    const drive = input ? input.drive : null;
    const pl = this.player;
    const playing = this.mode !== 'attract';

    if (playing) {
      if (ev.has('camera')) { this.camMode = (this.camMode + 1) % CAMERA_MODES.length; this.rig.reset(); }
      if (ev.has('reset') && this.state === 'race') this.resetPlayer();
      if (ev.has('line')) {
        this.settings.line = !this.settings.line;
        this.trackScene.setDrivingLine(this.settings.line ? this.playerProfile : null);
        store.saveSettings(this.settings);
      }
      this.lookBack = !!(input && (input.lookHeld));
    }

    // ---- countdown -------------------------------------------------------------
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const c = this.countdown;
      if (this.mode === 'race') {
        const lit = clamp(Math.floor((4.2 - c) / 0.6), 0, 5);
        if (c > 0.6) this.trackScene.setLights(lit);
        const beat = Math.ceil(c - 0.6);
        if (beat !== this.lastBeep && beat <= 3 && beat >= 1) { this.audio.beep(520, 0.18); this.lastBeep = beat; }
      }
      if (c <= 0.6 && this.mode === 'race' && this.lastBeep !== 0) { this.trackScene.setLights('off'); }
      if (c <= 0) {
        this.state = 'race';
        for (const rc of this.cars) {
          rc.frozen = false;
          if (this.mode === 'race') {
            // lap 1 is timed from the green light; the grid sits behind the line
            rc.started = true; rc.lap = 0; rc.lapStart = 0; rc.startCross = true; rc.cp = 0;
          }
        }
        if (this.mode === 'race') { this.audio.beep(1040, 0.5, 0.3); this.trackScene.setLights('green'); this.greenT = 2.5; }
        this.msg('GO!', 1.2, 'go');
      }
    }
    if (this.greenT > 0) { this.greenT -= dt; if (this.greenT <= 0) this.trackScene.setLights('off'); }

    // ---- player controls -------------------------------------------------------------
    if (playing && drive && !pl.ai) {
      pl.input.throttle = drive.throttle;
      pl.input.brake = drive.brake;
      pl.input.steer = drive.steer;
      pl.input.handbrake = drive.handbrake;
      if (ev.has('shiftUp')) pl.input.shiftUp = true;
      if (ev.has('shiftDown')) pl.input.shiftDown = true;
    }

    // ---- fixed-step simulation -------------------------------------------------------
    this.acc += dt;
    let steps = 0;
    const aiSet = { auto: true, tcs: true, asm: true };
    const plSet = { auto: this.settings.auto, tcs: this.settings.tcs, asm: this.settings.asm };
    while (this.acc >= STEP && steps < 12) {
      this.acc -= STEP;
      steps++;
      if (this.state !== 'countdown') this.time += STEP;
      for (const rc of this.cars) if (rc.ai && !rc.frozen) rc.ai.update(STEP, this.cars, this.time);
      for (const rc of this.cars) stepCar(rc, STEP, rc.ai ? aiSet : plSet);
      collideCars(this.cars);
      for (const rc of this.cars) this.checkLine(rc);
      if (this.mode === 'timetrial' && pl.started) {
        this.recT += STEP;
        const tLap = this.time - pl.lapStart;
        if (tLap >= this.rec.length / 4 * 0.05) this.rec.push(pl.veh.x, pl.veh.y, pl.veh.z, pl.veh.h);
      }
    }
    if (this.acc > STEP * 4) this.acc = 0;

    // ---- wrong way ------------------------------------------------------------------
    if (playing && pl.loc && this.state === 'race') {
      const vt = pl.veh.velX * pl.loc.tx + pl.veh.velZ * pl.loc.tz;
      this.wrongTimer = vt < -2 ? this.wrongTimer + dt : 0;
    }

    // ---- finish -------------------------------------------------------------------------
    if (this.state === 'finish') {
      this.finishTimer += dt;
      const allDone = this.cars.every((c) => c.finished);
      if ((allDone && this.finishTimer > 4) || this.finishTimer > 14) {
        this.state = 'results';
        this.results = this.buildResults();
      }
    }

    // attract: rotate the focus car
    if (this.mode === 'attract') {
      if (!this.focusT || this.clock > this.focusT) {
        this.focus = this.cars[Math.floor(Math.random() * this.cars.length)];
        this.focusT = this.clock + 14;
        this.rig.reset();
      }
    }

    // ---- messages ----
    for (const m of this.messages) m.t -= dt;
    this.messages = this.messages.filter((m) => m.t > 0);

    this.render(dt);
  }

  render(dt) {
    for (const rc of this.cars) {
      const obj = this.objs.get(rc);
      const v = rc.veh;
      const fx = Math.sin(v.h), fz = Math.cos(v.h);
      const off = v.a - v.L / 2;
      obj.root.position.set(v.x + fx * off, v.y, v.z + fz * off);
      const slope = rc.loc ? rc.loc.slope * (fx * rc.loc.tx + fz * rc.loc.tz) : 0;
      obj.root.rotation.set(-Math.atan(slope), v.h, 0);
      obj.update(v);
      obj.setBrake(rc.input.brake > 0.05 || (v.gear === -1 && rc.input.throttle > 0.05));
      this.effects(rc, dt);
    }
    // ghost playback
    if (this.ghostObj) {
      const pl = this.player;
      const g = this.ghost;
      const t = this.time - pl.lapStart;
      const n = g.data.length / 4;
      const f = t / g.dt;
      if (pl.started && f < n - 1 && this.state !== 'countdown') {
        const i = Math.floor(f), u = f - i, d = g.data;
        const a = i * 4, b = a + 4;
        let dh = d[b + 3] - d[a + 3];
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        this.ghostObj.root.position.set(lerp(d[a], d[b], u), lerp(d[a + 1], d[b + 1], u), lerp(d[a + 2], d[b + 2], u));
        this.ghostObj.root.rotation.set(0, d[a + 3] + dh * u, 0);
        const dx = this.ghostObj.root.position.x - pl.veh.x, dz = this.ghostObj.root.position.z - pl.veh.z;
        this.ghostObj.root.visible = dx * dx + dz * dz > 9;
      } else this.ghostObj.root.visible = false;
    }
    this.fx.update(dt);

    // camera
    const mode = this.mode === 'attract' || this.state === 'finish' || this.state === 'results' ? 'tv' : CAMERA_MODES[this.camMode];
    const target = this.mode === 'attract' ? this.focus : this.player;
    this.rig.update(dt, target, mode, this.lookBack);
    // car body visibility for interior cams
    const plObj = this.objs.get(this.player);
    const hide = mode === 'Bumper';
    for (const m of plObj.meshes) m.visible = !hide;
    for (const w of plObj.wheels) w.steer.visible = !hide;
    this.trackScene.update(dt, this.camera, target.veh);

    this.updateAudio(target);
  }

  effects(rc, dt) {
    const v = rc.veh;
    const sp = v.speed;
    const surf = rc.surfaceName;
    const offRoad = surf === 'grass' || surf === 'gravel';
    const fx = Math.sin(v.h), fz = Math.cos(v.h);
    const lx = Math.cos(v.h), lz = -Math.sin(v.h);
    const M = rc.spec.model;
    const smoke = Math.max(v.slipR, v.slipF * 0.7);
    const rate = offRoad && sp > 4 ? sp * 0.6 : smoke > 0.35 && sp > 3 ? smoke * 26 : 0;
    rc.fxAcc = (rc.fxAcc || 0) + rate * dt;
    while (rc.fxAcc >= 1) {
      rc.fxAcc -= 1;
      const side = Math.random() < 0.5 ? 1 : -1;
      const off = v.a - v.L / 2 - M.wheelbase / 2;
      const x = v.x + fx * off + lx * side * M.track / 2, z = v.z + fz * off + lz * side * M.track / 2;
      const col = offRoad ? (surf === 'gravel' ? '#cbb994' : '#8a7a55') : '#e8e8e8';
      this.fx.spawn(x, v.y + 0.3, z, -fx * sp * 0.15 + (Math.random() - 0.5), 0.6 + Math.random() * 0.8, -fz * sp * 0.15 + (Math.random() - 0.5), offRoad ? 0.9 : 1.6, offRoad ? 0.5 : 0.8, col);
    }
    if (rc.impact > 3) {
      for (let k = 0; k < Math.min(20, rc.impact * 1.5); k++) {
        this.fx.spawn(v.x + (Math.random() - 0.5) * 2, v.y + 0.5, v.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 8, 2 + Math.random() * 4, (Math.random() - 0.5) * 8, 0.5, 0.12, '#ffb52e', -18);
      }
      const d = Math.hypot(v.x - this.camera.position.x, v.z - this.camera.position.z);
      if (rc === this.player || d < 40) this.audio.impact(rc.impact * (rc === this.player ? 1 : 0.5));
    }
    rc.impact = 0;
  }

  updateAudio(target) {
    if (!this.audio.ready) return;
    const v = target.veh;
    if (this.voice) this.voice.update(v, target.input.throttle);
    const surf = target.surfaceName;
    const squeal = surf === 'asphalt' || surf === 'kerb' ? clamp(Math.max(v.slipR, v.slipF) - 0.2, 0, 1) * clamp(v.speed / 8, 0, 1) : 0;
    const rumble = surf === 'kerb' ? 0.5 : surf === 'grass' || surf === 'gravel' ? 0.9 : 0;
    const scale = this.mode === 'attract' ? 0.12 : 1;
    this.audio.updateEnv({ squeal: squeal * scale, speed: v.speed * (this.mode === 'attract' ? 0.5 : 1), rumble: rumble * clamp(v.speed / 15, 0, 1) * scale });
    // nearest opponent engine
    if (this.mode === 'race') {
      let near = null, nd = 1e9;
      for (const rc of this.cars) {
        if (rc === target) continue;
        const d = Math.hypot(rc.veh.x - v.x, rc.veh.z - v.z);
        if (d < nd) { nd = d; near = rc; }
      }
      if (near) {
        if (this.oppSpec !== near.spec.id) {
          if (this.oppVoice) this.oppVoice.stop();
          this.oppVoice = this.audio.engine(near.spec, 0.55);
          this.oppSpec = near.spec.id;
        }
        this.oppVoice?.update(near.veh, near.input.throttle, clamp(1 - nd / 70, 0, 1));
      }
    }
  }

  hud() {
    const pl = this.player, v = pl.veh;
    const order = this.positions();
    return {
      mode: this.mode,
      state: this.state,
      speed: v.speed,
      rpm: v.rpm,
      redline: pl.spec.redline,
      gear: v.gear,
      tcs: v.tcsActive > 0.1,
      asm: v.asmActive > 0.1,
      lap: pl.started ? Math.min(pl.lap + 1, this.lapsTotal) : 1,
      laps: this.lapsTotal,
      pos: order.indexOf(pl) + 1,
      total: this.cars.length,
      lapTime: pl.started && this.state !== 'countdown' ? this.time - pl.lapStart : 0,
      raceTime: this.time,
      lastLap: pl.lapTimes.length ? pl.lapTimes[pl.lapTimes.length - 1] : null,
      bestLap: pl.bestLap,
      ghostTime: this.ghost ? this.ghost.time : null,
      countdown: this.state === 'countdown' ? this.countdown : null,
      messages: this.messages,
      wrongWay: this.wrongTimer > 1,
      invalid: pl.lapInvalid,
      camMode: CAMERA_MODES[this.camMode],
      cars: this.cars.map((rc) => ({ x: rc.veh.x, z: rc.veh.z, player: rc.isPlayer, color: rc.paint })),
      standings: order.map((rc) => ({ name: rc.isPlayer ? 'YOU' : rc.spec.brand, player: rc.isPlayer, color: rc.paint })),
      boost: pl.spec.turbo ? v.boost : null,
    };
  }

  dispose() {
    for (const [, obj] of this.objs) { this.scene.remove(obj.root); obj.dispose(); }
    if (this.ghostObj) { this.scene.remove(this.ghostObj.root); this.ghostObj.dispose(); }
    this.fx.dispose();
    if (this.voice) this.voice.stop();
    if (this.oppVoice) this.oppVoice.stop();
    this.audio.silenceEnv();
  }
}

function fmt(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}
