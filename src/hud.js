// In-race HUD: tachometer canvas, speed/gear, timing, standings, minimap.
import { formatTime, formatDelta, clamp } from './util.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.root = $('hud');
    this.tach = $('tach').getContext('2d');
    this.mini = $('minimap');
    this.miniCtx = this.mini.getContext('2d');
    this.miniBase = null;
    this.units = 'kmh';
    this.lastMsgKey = '';
    this.el = {
      pos: $('hPos'), posT: $('hPosT'), lap: $('hLap'), time: $('hTime'), best: $('hBest'), last: $('hLast'),
      delta: $('hDelta'), speed: $('hSpeed'), unit: $('hUnit'), gear: $('hGear'), tcs: $('hTcs'), asm: $('hAsm'),
      center: $('hCenter'), warn: $('hWarn'), stand: $('hStand'), posBox: $('hPosBox'), cam: $('hCam'),
      bestLabel: $('hBestLabel'), boost: $('hBoost'), boostBar: $('hBoostBar'),
    };
  }

  show(on) { this.root.classList.toggle('hidden', !on); }

  setTrack(track) {
    // pre-render the circuit outline, north-up, fitted to the canvas
    const c = document.createElement('canvas');
    const W = this.mini.width, H = this.mini.height;
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < track.N; i++) {
      minX = Math.min(minX, track.px[i]); maxX = Math.max(maxX, track.px[i]);
      minZ = Math.min(minZ, track.pz[i]); maxZ = Math.max(maxZ, track.pz[i]);
    }
    const pad = 14;
    const sc = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
    const ox = (W - (maxX - minX) * sc) / 2, oz = (H - (maxZ - minZ) * sc) / 2;
    this.map = (x, z) => [ox + (x - minX) * sc, oz + (z - minZ) * sc];
    const path = () => {
      g.beginPath();
      for (let i = 0; i <= track.N; i += 2) {
        const [x, y] = this.map(track.px[i % track.N], track.pz[i % track.N]);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
    };
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 9; path(); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 4; path(); g.stroke();
    // start line
    const [sx, sy] = this.map(track.px[0], track.pz[0]);
    g.fillStyle = '#ff8a00';
    g.fillRect(sx - 4, sy - 4, 8, 8);
    this.miniBase = c;
  }

  update(h, settings) {
    const e = this.el;
    const kmh = settings.units !== 'mph';
    const sp = h.speed * (kmh ? 3.6 : 2.23694);
    e.speed.textContent = Math.round(sp);
    e.unit.textContent = kmh ? 'km/h' : 'mph';
    e.gear.textContent = h.gear === -1 ? 'R' : h.gear === 0 ? 'N' : String(h.gear);
    e.gear.classList.toggle('shift', h.rpm > h.redline - 350);
    e.tcs.classList.toggle('on', h.tcs);
    e.asm.classList.toggle('on', h.asm);
    e.tcs.classList.toggle('off', !settings.tcs);
    e.asm.classList.toggle('off', !settings.asm);
    if (h.boost != null) {
      e.boost.classList.remove('hidden');
      e.boostBar.style.width = `${Math.round(h.boost * 100)}%`;
    } else e.boost.classList.add('hidden');

    const race = h.mode === 'race';
    e.posBox.classList.toggle('hidden', !race);
    e.pos.textContent = h.pos;
    e.posT.textContent = h.total;
    e.lap.textContent = race ? `${h.lap}/${h.laps}` : `${h.lap}`;
    e.time.textContent = formatTime(h.lapTime);
    e.best.textContent = formatTime(h.bestLap ?? (h.mode === 'timetrial' ? h.ghostTime : null));
    e.bestLabel.textContent = h.bestLap == null && h.mode === 'timetrial' && h.ghostTime != null ? 'GHOST' : 'BEST';
    e.last.textContent = formatTime(h.lastLap);
    e.time.classList.toggle('invalid', !!h.invalid);
    e.cam.textContent = h.camMode;

    // center: countdown + messages
    let center = '';
    if (h.countdown != null && h.mode === 'race') {
      const n = Math.ceil(h.countdown - 0.6);
      if (n >= 1 && n <= 3) center = `<div class="count">${n}</div>`;
    }
    center += h.messages.map((m) => `<div class="msg ${m.cls}">${m.text}</div>`).join('');
    if (center !== this.lastMsgKey) { e.center.innerHTML = center; this.lastMsgKey = center; }
    e.warn.classList.toggle('hidden', !h.wrongWay);

    // standings
    if (race) {
      const html = h.standings.map((s, i) => `<li class="${s.player ? 'me' : ''}"><b>${i + 1}</b><i style="background:${s.color}"></i>${s.name}</li>`).join('');
      if (html !== this.lastStand) { e.stand.innerHTML = html; this.lastStand = html; }
      e.stand.classList.remove('hidden');
    } else e.stand.classList.add('hidden');

    this.drawTach(h);
    this.drawMini(h);
  }

  drawTach(h) {
    const g = this.tach, W = g.canvas.width, H = g.canvas.height;
    g.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2 + 10, R = W * 0.42;
    const maxR = Math.ceil((h.redline + 800) / 1000) * 1000;
    const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2;
    const ang = (r) => a0 + (a1 - a0) * clamp(r / maxR, 0, 1);
    // backing
    g.lineCap = 'butt';
    g.beginPath(); g.arc(cx, cy, R, a0, a1); g.strokeStyle = 'rgba(10,14,24,0.6)'; g.lineWidth = 22; g.stroke();
    // redline band
    g.beginPath(); g.arc(cx, cy, R, ang(h.redline), a1); g.strokeStyle = '#e0302a'; g.lineWidth = 22; g.stroke();
    // fill
    const shift = h.rpm > h.redline - 350;
    g.beginPath(); g.arc(cx, cy, R, a0, ang(h.rpm)); g.strokeStyle = shift ? '#ff4b3a' : '#ffb000'; g.lineWidth = 12; g.stroke();
    // ticks
    g.fillStyle = '#e8ecf3';
    g.font = '600 15px "Chakra Petch", system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let r = 0; r <= maxR; r += 500) {
      const a = ang(r), major = r % 1000 === 0;
      const r0 = R - (major ? 18 : 13), r1 = R + 11;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.strokeStyle = r >= h.redline ? '#ff8a80' : 'rgba(232,236,243,0.9)';
      g.lineWidth = major ? 3 : 1.5;
      g.stroke();
      if (major) g.fillText(String(r / 1000), cx + Math.cos(a) * (R - 32), cy + Math.sin(a) * (R - 32));
    }
    // needle
    const a = ang(h.rpm);
    g.beginPath();
    g.moveTo(cx - Math.cos(a) * 12, cy - Math.sin(a) * 12);
    g.lineTo(cx + Math.cos(a) * (R + 6), cy + Math.sin(a) * (R + 6));
    g.strokeStyle = '#ffffff'; g.lineWidth = 4; g.lineCap = 'round'; g.stroke();
  }

  drawMini(h) {
    const g = this.miniCtx;
    g.clearRect(0, 0, this.mini.width, this.mini.height);
    if (!this.miniBase) return;
    g.drawImage(this.miniBase, 0, 0);
    // others first, player on top
    const cars = h.cars.slice().sort((a, b) => (a.player ? 1 : 0) - (b.player ? 1 : 0));
    for (const c of cars) {
      const [x, y] = this.map(c.x, c.z);
      g.beginPath();
      g.arc(x, y, c.player ? 6 : 4.5, 0, Math.PI * 2);
      g.fillStyle = c.player ? '#ff8a00' : c.color;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = c.player ? '#fff' : 'rgba(0,0,0,0.7)';
      g.stroke();
    }
  }
}

export function drawTrackThumb(canvas, track, color = '#fff') {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.N; i++) {
    minX = Math.min(minX, track.px[i]); maxX = Math.max(maxX, track.px[i]);
    minZ = Math.min(minZ, track.pz[i]); maxZ = Math.max(maxZ, track.pz[i]);
  }
  const pad = 12;
  const sc = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
  const ox = (W - (maxX - minX) * sc) / 2, oz = (H - (maxZ - minZ) * sc) / 2;
  g.beginPath();
  for (let i = 0; i <= track.N; i += 2) {
    const x = ox + (track.px[i % track.N] - minX) * sc, y = oz + (track.pz[i % track.N] - minZ) * sc;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.lineJoin = 'round';
  g.strokeStyle = color; g.lineWidth = 4; g.stroke();
  const sx = ox + (track.px[0] - minX) * sc, sy = oz + (track.pz[0] - minZ) * sc;
  g.fillStyle = '#ff8a00'; g.fillRect(sx - 5, sy - 5, 10, 10);
}
