// Keyboard, gamepad (standard mapping) and touch input, merged into one
// driving state plus edge-triggered menu/navigation events.
import { approach, clamp } from './util.js';

const KEYMAP = {
  throttle: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  handbrake: ['Space'],
  shiftUp: ['KeyE', 'ShiftLeft', 'ShiftRight'],
  shiftDown: ['KeyQ', 'ControlLeft', 'ControlRight'],
  camera: ['KeyC'],
  reset: ['KeyR'],
  pause: ['Escape', 'KeyP'],
  look: ['KeyB'],
  line: ['KeyL'],
  mute: ['KeyM'],
  // menus
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  mleft: ['ArrowLeft', 'KeyA'],
  mright: ['ArrowRight', 'KeyD'],
  confirm: ['Enter', 'NumpadEnter', 'Space'],
  back: ['Escape', 'Backspace'],
};

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set(); // edge events since last poll
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.lastPad = null;
    this.padPrev = {};
    this.usingPad = false;
    this.touch = { left: false, right: false, gas: false, brake: false };
    this.onAnyInput = null;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (this.isMenuKey(e.code)) this.pressed.add(e.code); }
      else this.pressed.add(e.code);
      this.down.add(e.code);
      this.usingPad = false;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) && !(e.target && e.target.tagName === 'INPUT')) e.preventDefault();
      this.onAnyInput?.();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('gamepadconnected', () => { this.usingPad = true; });
  }

  isMenuKey(code) {
    return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(code);
  }

  key(name) { return KEYMAP[name].some((k) => this.down.has(k)); }

  bindTouch(root) {
    const btn = (sel, prop) => {
      const el = root.querySelector(sel);
      if (!el) return;
      const on = (e) => { e.preventDefault(); this.touch[prop] = true; el.classList.add('on'); this.onAnyInput?.(); };
      const off = (e) => { e.preventDefault(); this.touch[prop] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    };
    btn('[data-touch=left]', 'left');
    btn('[data-touch=right]', 'right');
    btn('[data-touch=gas]', 'gas');
    btn('[data-touch=brake]', 'brake');
  }

  readPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') return p;
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Returns {drive:{throttle,brake,steer,handbrake}, events:Set<string>} */
  poll(dt) {
    const ev = new Set();
    const edge = (name) => KEYMAP[name].some((k) => this.pressed.has(k));
    for (const n of ['shiftUp', 'shiftDown', 'camera', 'reset', 'pause', 'look', 'line', 'mute', 'up', 'down', 'mleft', 'mright', 'confirm', 'back']) if (edge(n)) ev.add(n);
    this.pressed.clear();

    // ---- keyboard / touch driving ----
    const kThr = this.key('throttle') || this.touch.gas;
    const kBrk = this.key('brake') || this.touch.brake;
    const kL = this.key('left') || this.touch.left;
    const kR = this.key('right') || this.touch.right;
    const st = this.state;
    st.throttle = approach(st.throttle, kThr ? 1 : 0, kThr ? 5 : 8, dt);
    st.brake = approach(st.brake, kBrk ? 1 : 0, kBrk ? 6 : 10, dt);
    const target = (kL ? 1 : 0) - (kR ? 1 : 0);
    const rate = target === 0 ? 6 : Math.sign(target) !== Math.sign(st.steer) && st.steer !== 0 ? 7 : 2.6;
    st.steer = approach(st.steer, target, rate, dt);
    st.handbrake = this.key('handbrake');
    let drive = { throttle: st.throttle, brake: st.brake, steer: st.steer, handbrake: st.handbrake, analog: false };

    // ---- gamepad ----
    const p = this.readPad();
    if (p) {
      const b = (i) => (p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
      const prev = this.padPrev;
      const pe = (i, name) => { const v = b(i) > 0.5; if (v && !prev[i]) ev.add(name); prev[i] = v; };
      pe(0, 'confirm'); pe(1, 'back'); pe(3, 'camera'); pe(4, 'shiftDown'); pe(5, 'shiftUp');
      pe(9, 'pause'); pe(8, 'reset'); pe(12, 'up'); pe(13, 'down'); pe(14, 'mleft'); pe(15, 'mright'); pe(11, 'look');
      // stick as menu nav (with hysteresis)
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      const dirNow = Math.abs(ay) > 0.6 ? (ay < 0 ? 'up' : 'down') : Math.abs(ax) > 0.6 ? (ax < 0 ? 'mleft' : 'mright') : null;
      if (dirNow && dirNow !== this.stickDir) ev.add(dirNow);
      this.stickDir = dirNow;
      let sx = Math.abs(ax) < 0.08 ? 0 : (ax - Math.sign(ax) * 0.08) / 0.92;
      sx = Math.sign(sx) * Math.pow(Math.abs(sx), 1.35);
      const thr = Math.max(b(7), b(0) * 1);
      const brk = Math.max(b(6), b(2));
      const any = Math.abs(sx) > 0 || thr > 0.02 || brk > 0.02 || b(1) > 0.5;
      if (any) this.usingPad = true;
      if (this.usingPad && (any || !(kThr || kBrk || kL || kR))) {
        drive = { throttle: thr, brake: brk, steer: -sx, handbrake: b(1) > 0.5, analog: true };
        if (any) this.onAnyInput?.();
      }
      this.lastPad = p;
    }
    if (this.touch.left || this.touch.right || this.touch.gas || this.touch.brake) drive.analog = false;
    drive.steer = clamp(drive.steer, -1, 1);
    const lookHeld = this.key('look') || !!(p && p.buttons[11] && p.buttons[11].pressed);
    return { drive, events: ev, lookHeld };
  }
}
