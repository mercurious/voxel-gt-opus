// Web Audio synthesis: engine (rpm-tracking oscillators through a waveshaper
// and filter), turbo whistle + blow-off, tyre squeal, wind, impacts, beeps.
import { clamp } from './util.js';

function noiseBuffer(ctx, seconds = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

class EngineVoice {
  constructor(audio, spec, gainScale = 1) {
    const ctx = audio.ctx;
    this.audio = audio;
    this.spec = spec;
    this.gainScale = gainScale;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 2.5;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 2.2); }
    shaper.curve = curve;
    this.oscs = [];
    const mk = (type, mult, g) => {
      const o = ctx.createOscillator();
      o.type = type;
      const gn = ctx.createGain();
      gn.gain.value = g;
      o.connect(gn).connect(shaper);
      o.start();
      this.oscs.push({ o, mult, gn });
    };
    // firing frequency is rpm/60 * cylinders/2; add a sub and a harmonic
    mk('sawtooth', 1, 0.5);
    mk('square', 0.5, 0.35);
    mk('sawtooth', 2.01, 0.16);
    mk('triangle', 0.25, 0.4);
    shaper.connect(this.filter).connect(this.out).connect(audio.engineBus);
    // turbo
    if (spec.turbo) {
      this.whistle = ctx.createOscillator();
      this.whistle.type = 'sine';
      this.wGain = ctx.createGain();
      this.wGain.gain.value = 0;
      this.whistle.connect(this.wGain).connect(audio.engineBus);
      this.whistle.start();
      this.lastBoost = 0;
    }
  }
  update(veh, throttle, distGain = 1) {
    const ctx = this.audio.ctx, t = ctx.currentTime;
    const s = this.spec;
    const rpm = veh.rpm;
    const f = (rpm / 60) * (s.cylinders / 2);
    for (const { o, mult } of this.oscs) o.frequency.setTargetAtTime(f * mult, t, 0.015);
    const load = clamp(veh.load, 0, 1);
    const r = rpm / s.redline;
    this.filter.frequency.setTargetAtTime(250 + r * 2400 * (0.45 + 0.55 * load) + 150, t, 0.03);
    let g = (0.1 + 0.16 * load + 0.08 * r) * this.gainScale * distGain;
    if (veh.revLimiter) g *= 0.4 + 0.6 * Math.random();
    this.out.gain.setTargetAtTime(g, t, 0.03);
    if (this.whistle) {
      this.whistle.frequency.setTargetAtTime(2400 + veh.boost * 4200, t, 0.05);
      this.wGain.gain.setTargetAtTime(veh.boost * 0.025 * this.gainScale * distGain, t, 0.05);
      if (this.lastBoost - veh.boost > 0.25 && this.gainScale > 0.5) this.audio.blowOff(this.lastBoost);
      this.lastBoost = veh.boost * 0.9 + this.lastBoost * 0.1;
    }
  }
  stop() {
    const t = this.audio.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(() => {
      for (const { o } of this.oscs) o.stop();
      if (this.whistle) this.whistle.stop();
      this.out.disconnect();
      if (this.wGain) this.wGain.disconnect();
    }, 300);
  }
}

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.muted = false;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 0.9;
    this.engineBus.connect(this.master);
    this.noise = noiseBuffer(ctx);
    // tyre squeal: band-passed noise
    const sq = ctx.createBufferSource();
    sq.buffer = this.noise; sq.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 6;
    this.squealGain = ctx.createGain(); this.squealGain.gain.value = 0;
    sq.connect(bp).connect(this.squealGain).connect(this.master);
    sq.start();
    this.squealFilter = bp;
    // wind / road
    const wn = ctx.createBufferSource();
    wn.buffer = this.noise; wn.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 500;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    wn.connect(lp).connect(this.windGain).connect(this.master);
    wn.start();
    this.windFilter = lp;
    // off-road rumble
    const rb = ctx.createBufferSource();
    rb.buffer = this.noise; rb.loop = true;
    const rlp = ctx.createBiquadFilter();
    rlp.type = 'lowpass'; rlp.frequency.value = 180;
    this.rumbleGain = ctx.createGain(); this.rumbleGain.gain.value = 0;
    rb.connect(rlp).connect(this.rumbleGain).connect(this.master);
    rb.start();
  }
  get ready() { return !!this.ctx; }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = this.muted ? 0 : v; }
  toggleMute() { this.muted = !this.muted; this.setVolume(this.volume); return this.muted; }
  engine(spec, gainScale = 1) { return this.ctx ? new EngineVoice(this, spec, gainScale) : null; }

  updateEnv({ squeal = 0, speed = 0, rumble = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.squealGain.gain.setTargetAtTime(clamp(squeal, 0, 1) * 0.16, t, 0.05);
    this.squealFilter.frequency.setTargetAtTime(900 + squeal * 500, t, 0.1);
    this.windGain.gain.setTargetAtTime(clamp(speed / 90, 0, 1) ** 2 * 0.12, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(300 + speed * 12, t, 0.1);
    this.rumbleGain.gain.setTargetAtTime(clamp(rumble, 0, 1) * 0.35, t, 0.05);
  }
  silenceEnv() { this.updateEnv({}); }

  burst(gain, freq, dur, type = 'lowpass') {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }
  impact(strength) { this.burst(clamp(strength / 12, 0.1, 0.9), 400 + strength * 30, 0.25 + strength * 0.01); }
  blowOff(boost) { this.burst(0.12 * boost, 2500, 0.35, 'highpass'); }
  beep(freq = 440, dur = 0.18, gain = 0.25) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  click() { this.beep(1400, 0.04, 0.06); }
}
