// Menu screens rendered into #menu, navigable by mouse, keyboard or gamepad.
import { CARS, carById, carStats } from './cars.js';
import { TRACKS, trackById } from './tracks.js';
import { drawTrackThumb } from './hud.js';
import { formatTime } from './util.js';
import * as store from './storage.js';
import { CAMERA_MODES } from './game.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const SETTING_ROWS = [
  { key: 'auto', label: 'Transmission', opts: [[true, 'Automatic'], [false, 'Manual']] },
  { key: 'tcs', label: 'Traction Control (TCS)', opts: [[true, 'On'], [false, 'Off']] },
  { key: 'asm', label: 'Stability Control (ASM)', opts: [[true, 'On'], [false, 'Off']] },
  { key: 'line', label: 'Driving Line', opts: [[false, 'Off'], [true, 'On']] },
  { key: 'camera', label: 'Default Camera', opts: CAMERA_MODES.map((m, i) => [i, m]) },
  { key: 'units', label: 'Speed Units', opts: [['kmh', 'km/h'], ['mph', 'mph']] },
  { key: 'quality', label: 'Graphics', opts: [['high', 'High'], ['low', 'Performance']] },
  { key: 'volume', label: 'Volume', opts: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((v) => [v, `${Math.round(v * 10)}`]) },
];
const RACE_ROWS = [
  { key: 'laps', label: 'Laps', opts: [1, 2, 3, 4, 5, 8, 10].map((v) => [v, String(v)]) },
  { key: 'difficulty', label: 'Opponents', opts: [['easy', 'Amateur'], ['normal', 'Professional'], ['hard', 'Expert']] },
  { key: 'field', label: 'Grid', opts: [['mixed', 'Mixed garage'], ['onemake', 'One-make race']] },
];

export class UI {
  constructor(handlers, getTrackCore) {
    this.h = handlers;
    this.getTrackCore = getTrackCore;
    this.root = document.getElementById('menu');
    this.screen = null;
    this.focus = 0;
    this.sel = { mode: 'race', car: CARS[1].id, paint: 0, track: TRACKS[0].id };
    const saved = store.load('selection', null);
    if (saved) Object.assign(this.sel, saved);
    this.root.addEventListener('mousemove', (e) => {
      const el = e.target.closest('.nav');
      if (el) { const i = this.navs().indexOf(el); if (i >= 0 && i !== this.focus) { this.focus = i; this.paintFocus(); } }
    });
  }

  get settings() { return this.h.settings(); }

  navs() { return [...this.root.querySelectorAll('.nav')].filter((e) => e.offsetParent !== null); }

  paintFocus() {
    const n = this.navs();
    n.forEach((el, i) => el.classList.toggle('focus', i === this.focus));
    const el = n[this.focus];
    if (el) {
      el.scrollIntoView?.({ block: 'nearest' });
      el.dispatchEvent(new CustomEvent('navfocus', { bubbles: true }));
    }
  }

  setFocus(i) { this.focus = i; this.paintFocus(); }

  handle(ev) {
    if (!this.screen) return;
    const n = this.navs();
    if (!n.length) return;
    const cur = n[this.focus];
    const row = cur && cur.closest('[data-row]');
    const moveRow = (d) => {
      // horizontal groups move within themselves
      if (row && row.dataset.row !== 'v') {
        const items = n.filter((e) => e.closest('[data-row]') === row);
        const k = items.indexOf(cur);
        const nx = items[k + d];
        if (nx) { this.setFocus(n.indexOf(nx)); this.h.click(); }
        return true;
      }
      return false;
    };
    if (ev.has('up')) { this.setFocus(this.vertical(n, -1)); this.h.click(); }
    if (ev.has('down')) { this.setFocus(this.vertical(n, 1)); this.h.click(); }
    if (ev.has('mleft')) { if (cur?.dataset.key) this.cycle(cur, -1); else moveRow(-1); }
    if (ev.has('mright')) { if (cur?.dataset.key) this.cycle(cur, 1); else moveRow(1); }
    if (ev.has('confirm') && cur) { if (cur.dataset.key) this.cycle(cur, 1); else cur.click(); }
    if (ev.has('back')) this.back();
  }

  // vertical move skips over siblings in the same horizontal row
  vertical(n, d) {
    const cur = n[this.focus];
    const row = cur && cur.closest('[data-row]');
    let i = this.focus;
    do { i += d; } while (i >= 0 && i < n.length && row && row.dataset.row !== 'v' && n[i].closest('[data-row]') === row);
    if (i < 0) i = n.length - 1;
    if (i >= n.length) i = 0;
    // land on the selected item of a horizontal row if there is one
    const r2 = n[i].closest('[data-row]');
    if (r2 && r2.dataset.row !== 'v') {
      const sel = n.find((e) => e.closest('[data-row]') === r2 && e.classList.contains('sel'));
      if (sel) return n.indexOf(sel);
    }
    return i;
  }

  cycle(el, d) {
    const key = el.dataset.key;
    const rows = el.dataset.set === 'race' ? RACE_ROWS : SETTING_ROWS;
    const row = rows.find((r) => r.key === key);
    const s = this.settings;
    let k = row.opts.findIndex(([v]) => v === s[key]);
    k = (k + d + row.opts.length) % row.opts.length;
    s[key] = row.opts[k][0];
    el.querySelector('.val').textContent = row.opts[k][1];
    this.h.settingsChanged(key);
    this.h.click();
  }

  back() {
    const map = { main: 'title', car: 'main', track: 'car', settings: this.settingsReturn || 'main', records: 'main', garage: 'main' };
    if (this.screen === 'pause') return this.h.resume();
    if (this.screen === 'settings' && this.settingsReturn === 'pause') return this.show('pause');
    const to = map[this.screen];
    if (to) { this.h.click(); this.show(to); }
  }

  hide() { this.root.innerHTML = ''; this.root.className = 'hidden'; this.screen = null; this.h.screenChanged(null); }

  show(name, data) {
    this.screen = name;
    this.focus = 0;
    this.root.className = 'screen-' + name;
    const fn = this['s_' + name];
    this.root.innerHTML = fn.call(this, data);
    this.bind(name, data);
    this.h.screenChanged(name, this.sel);
    // initial focus
    const n = this.navs();
    const pre = n.findIndex((e) => e.classList.contains('sel') || e.dataset.default);
    this.setFocus(Math.max(0, pre));
  }

  // ---------------------------------------------------------------- screens
  s_title() {
    return `
      <div class="title-wrap">
        <div class="logo"><span class="vox">VOXEL</span><span class="gt">GT</span></div>
        <div class="tagline">Five legends. Three great circuits. Every block hand-placed by physics.</div>
        <button class="nav press" data-act="start">Press <kbd>Enter</kbd> or <kbd>A</kbd> to start</button>
      </div>`;
  }

  s_main() {
    const items = [
      ['race', 'Arcade Race', 'Race four rivals over a few laps. Standing start, gantry lights, no mercy.'],
      ['timetrial', 'Time Trial', 'Just you, the clock and a ghost of your best lap.'],
      ['garage', 'Garage', 'Walk around the five cars and pick your paint.'],
      ['records', 'Records', 'Your best laps on every circuit.'],
      ['settings', 'Settings', 'Driving aids, transmission, camera, units and graphics.'],
    ];
    return `
      <div class="panel main-menu">
        <div class="logo small"><span class="vox">VOXEL</span><span class="gt">GT</span></div>
        <ul class="menu-list" data-row="v">
          ${items.map(([k, t, d], i) => `<li><button class="nav big" data-act="${k}" ${i === 0 ? 'data-default="1"' : ''}><span>${t}</span><small>${d}</small></button></li>`).join('')}
        </ul>
        ${controlsHelp()}
      </div>`;
  }

  s_car(data) {
    const garage = data && data.garage;
    const modeLabel = garage ? 'Garage' : this.sel.mode === 'race' ? 'Arcade Race · Choose your car' : 'Time Trial · Choose your car';
    return `
      <div class="car-screen">
        <div class="crumb">${modeLabel}</div>
        <div class="car-list" data-row="v">
          ${CARS.map((c) => `<button class="nav car-item ${c.id === this.sel.car ? 'sel' : ''}" data-car="${c.id}"><small>${esc(c.brand)} · ${c.year}</small><span>${esc(c.name)}</span></button>`).join('')}
        </div>
        <div class="spec-card" id="specCard"></div>
        <div class="paint-row" data-row="h" id="paintRow"></div>
        <div class="btn-row" data-row="h">
          <button class="nav ghost-btn" data-act="back">Back</button>
          <button class="nav cta" data-act="next" data-default="1">${garage ? 'Done' : 'Choose Circuit ›'}</button>
        </div>
      </div>`;
  }

  s_track() {
    const s = this.settings;
    const car = carById(this.sel.car);
    const race = this.sel.mode === 'race';
    return `
      <div class="track-screen">
        <div class="crumb">${race ? 'Arcade Race' : 'Time Trial'} · ${esc(car.brand)} ${esc(car.name)}</div>
        <div class="track-cards" data-row="h">
          ${TRACKS.map((t) => {
            const best = store.bestLap(t.id, car.id);
            const any = store.bestLapAny(t.id);
            return `<button class="nav track-card ${t.id === this.sel.track ? 'sel' : ''}" data-track="${t.id}">
              <canvas width="260" height="170" data-thumb="${t.id}"></canvas>
              <span class="tname">${esc(t.short)}</span>
              <small>${esc(t.location)}</small>
              <div class="tmeta"><b>${(this.getTrackCore(t.id).length / 1000).toFixed(3)} km</b><b>${t.corners.length} named corners</b><b>${esc(t.theme.time)}</b></div>
              <div class="tbest">Your best (this car): <b>${formatTime(best)}</b>${any ? `<br>Track record: <b>${formatTime(any.time)}</b> · ${esc(carById(any.car).brand)}` : ''}</div>
            </button>`;
          }).join('')}
        </div>
        <div class="track-blurb" id="trackBlurb"></div>
        ${race ? `<div class="opts" data-row="v">${RACE_ROWS.map((r) => optRow(r, s, 'race')).join('')}</div>` : ''}
        <div class="btn-row" data-row="h">
          <button class="nav ghost-btn" data-act="back">Back</button>
          <button class="nav cta" data-act="go">${race ? 'Start Race' : 'Start Time Trial'}</button>
        </div>
      </div>`;
  }

  s_settings() {
    const s = this.settings;
    return `
      <div class="panel settings">
        <h2>Settings</h2>
        <div class="opts" data-row="v">${SETTING_ROWS.map((r) => optRow(r, s, 'settings')).join('')}</div>
        <p class="hint">Use <kbd>←</kbd> <kbd>→</kbd> or click to change. Aids help keep the car pointing the right way; turning them off is faster in the right hands.</p>
        <div class="btn-row" data-row="h"><button class="nav cta" data-act="back">Done</button></div>
      </div>`;
  }

  s_records() {
    const rows = TRACKS.map((t) => `<tr><th>${esc(t.short)}</th>${CARS.map((c) => {
      const b = store.bestLap(t.id, c.id);
      return `<td>${b ? formatTime(b) : '—'}</td>`;
    }).join('')}</tr>`).join('');
    return `
      <div class="panel records">
        <h2>Records</h2>
        <table><thead><tr><th></th>${CARS.map((c) => `<th>${esc(c.brand)}<br><small>${esc(c.name.split(' (')[0])}</small></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
        <div class="btn-row" data-row="h"><button class="nav cta" data-act="back">Back</button></div>
      </div>`;
  }

  s_pause() {
    return `
      <div class="panel pause">
        <h2>Paused</h2>
        <ul class="menu-list" data-row="v">
          <li><button class="nav big" data-act="resume"><span>Resume</span></button></li>
          <li><button class="nav big" data-act="restart"><span>Restart</span></button></li>
          <li><button class="nav big" data-act="settings"><span>Settings</span></button></li>
          <li><button class="nav big" data-act="quit"><span>Quit to Menu</span></button></li>
        </ul>
        ${controlsHelp()}
      </div>`;
  }

  s_results(r) {
    if (r.mode === 'timetrial') {
      return `<div class="panel results"><h2>Session Complete</h2>
        <div class="btn-row" data-row="h">
          <button class="nav cta" data-act="restart">Go Again</button>
          <button class="nav ghost-btn" data-act="change">Change Car / Circuit</button>
          <button class="nav ghost-btn" data-act="quit">Main Menu</button>
        </div></div>`;
    }
    const me = r.rows.find((x) => x.player);
    const head = me.pos === 1 ? 'Victory' : `Finished P${me.pos}`;
    return `
      <div class="panel results">
        <div class="crumb">${esc(r.track.name)} · ${r.laps} lap${r.laps > 1 ? 's' : ''}</div>
        <h2 class="${me.pos === 1 ? 'win' : ''}">${head}</h2>
        <table>
          <thead><tr><th>Pos</th><th>Driver</th><th>Car</th><th>Time</th><th>Best lap</th></tr></thead>
          <tbody>
            ${r.rows.map((x) => `<tr class="${x.player ? 'me' : ''}"><td>${x.pos}</td><td><i class="chip" style="background:${x.paint}"></i>${esc(x.name)}</td><td>${esc(x.car)}</td><td>${x.pos === 1 ? formatTime(x.total) : '+' + x.gap.toFixed(3)}</td><td>${formatTime(x.best)}</td></tr>`).join('')}
          </tbody>
        </table>
        <div class="btn-row" data-row="h">
          <button class="nav cta" data-act="restart">Race Again</button>
          <button class="nav ghost-btn" data-act="change">Change Car / Circuit</button>
          <button class="nav ghost-btn" data-act="quit">Main Menu</button>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------- behaviour
  bind(name, data) {
    const R = this.root;
    const act = (a, fn) => R.querySelectorAll(`[data-act="${a}"]`).forEach((b) => b.addEventListener('click', () => { this.h.click(); fn(); }));
    R.querySelectorAll('[data-key]').forEach((el) => el.addEventListener('click', (e) => {
      const left = e.offsetX < el.offsetWidth * 0.45 && e.target.classList.contains('arrow-l');
      this.cycle(el, left ? -1 : 1);
    }));
    act('back', () => this.back());
    if (name === 'title') act('start', () => this.show('main'));
    if (name === 'main') {
      act('race', () => { this.sel.mode = 'race'; this.show('car'); });
      act('timetrial', () => { this.sel.mode = 'timetrial'; this.show('car'); });
      act('garage', () => this.show('car', { garage: true }));
      act('records', () => this.show('records'));
      act('settings', () => { this.settingsReturn = 'main'; this.show('settings'); });
    }
    if (name === 'car') {
      const garage = data && data.garage;
      const renderCar = () => {
        const c = carById(this.sel.car);
        const st = carStats(c);
        const s = this.settings;
        const top = estTop(c);
        R.querySelector('#specCard').innerHTML = `
          <div class="brand">${esc(c.brand)}</div>
          <div class="model">${esc(c.name)} <span>${c.year}</span></div>
          <p>${esc(c.blurb)}</p>
          <dl>
            <dt>Engine</dt><dd>${esc(c.engine)}${c.turbo ? '' : ''}</dd>
            <dt>Power</dt><dd>${c.powerPS} PS @ ${c.powerRpm} rpm</dd>
            <dt>Torque</dt><dd>${c.torqueNm} Nm @ ${c.torqueRpm} rpm</dd>
            <dt>Drivetrain</dt><dd>${c.layout} · ${c.gears.length}-speed</dd>
            <dt>Weight</dt><dd>${c.mass} kg · ${st.kgPerPS.toFixed(2)} kg/PS</dd>
            <dt>Top speed</dt><dd>${s.units === 'mph' ? Math.round(top / 1.609) + ' mph' : top + ' km/h'} (est.)</dd>
          </dl>
          ${bar('Power', st.barPower)}${bar('Lightness', st.barWeight)}${bar('Grip', st.barGrip)}${bar('Braking', st.barBrake)}`;
        R.querySelector('#paintRow').innerHTML = `<span class="lbl">Paint</span>` + c.paints.map((p, i) => `<button class="nav swatch ${i === this.sel.paint ? 'sel' : ''}" data-paint="${i}" title="${esc(p.name)}"><i style="background:${p.hex}"></i><small>${esc(p.name)}</small></button>`).join('');
        R.querySelectorAll('[data-paint]').forEach((b) => {
          const pick = () => {
            this.sel.paint = +b.dataset.paint;
            R.querySelectorAll('[data-paint]').forEach((x) => x.classList.toggle('sel', x === b));
            this.h.preview(this.sel);
          };
          b.addEventListener('click', pick);
          b.addEventListener('navfocus', pick);
        });
        this.h.preview(this.sel);
      };
      R.querySelectorAll('[data-car]').forEach((b) => {
        const pick = () => {
          if (this.sel.car === b.dataset.car) return;
          this.sel.car = b.dataset.car;
          this.sel.paint = 0;
          R.querySelectorAll('[data-car]').forEach((x) => x.classList.toggle('sel', x === b));
          renderCar();
        };
        b.addEventListener('click', () => { pick(); const n = this.navs(); this.setFocus(n.findIndex((e) => e.dataset.act === 'next')); });
        b.addEventListener('navfocus', pick);
      });
      renderCar();
      act('next', () => { store.save('selection', this.sel); if (garage) this.show('main'); else this.show('track'); });
    }
    if (name === 'track') {
      R.querySelectorAll('[data-thumb]').forEach((c) => drawTrackThumb(c, this.getTrackCore(c.dataset.thumb)));
      const blurb = () => {
        const t = trackById(this.sel.track);
        R.querySelector('#trackBlurb').innerHTML = `<b>${esc(t.name)}</b> — ${esc(t.blurb)}`;
      };
      R.querySelectorAll('[data-track]').forEach((b) => {
        const pick = () => {
          this.sel.track = b.dataset.track;
          R.querySelectorAll('[data-track]').forEach((x) => x.classList.toggle('sel', x === b));
          blurb();
        };
        b.addEventListener('click', () => { pick(); const n = this.navs(); this.setFocus(n.findIndex((e) => e.dataset.act === 'go')); });
        b.addEventListener('navfocus', pick);
      });
      blurb();
      act('go', () => { store.save('selection', this.sel); this.h.start(this.sel); });
    }
    if (name === 'pause') {
      act('resume', () => this.h.resume());
      act('restart', () => this.h.restart());
      act('settings', () => { this.settingsReturn = 'pause'; this.show('settings'); });
      act('quit', () => this.h.quit());
    }
    if (name === 'results') {
      act('restart', () => this.h.restart());
      act('change', () => this.h.change());
      act('quit', () => this.h.quit());
    }
  }
}

function optRow(r, s, set) {
  const cur = r.opts.find(([v]) => v === s[r.key]) || r.opts[0];
  return `<div class="nav opt" data-key="${r.key}" data-set="${set}"><span class="lbl">${esc(r.label)}</span><span class="ctl"><i class="arrow-l">‹</i><span class="val">${esc(cur[1])}</span><i class="arrow-r">›</i></span></div>`;
}

function bar(label, v) {
  return `<div class="bar"><span>${label}</span><i><b style="width:${Math.round(Math.max(0.04, v) * 100)}%"></b></i></div>`;
}

function estTop(c) {
  // drag-limited top speed (bisection), capped by gearing at the redline
  const P = c.powerPS * 735.5 * 0.86;
  let lo = 10, hi = 150;
  for (let k = 0; k < 50; k++) {
    const v = (lo + hi) / 2;
    const need = (0.5 * 1.225 * c.cd * c.area * v * v + 0.014 * c.mass * 9.81) * v;
    if (need < P) lo = v; else hi = v;
  }
  const vg = ((c.redline * Math.PI) / 30) * c.wheelRadius / (c.gears[c.gears.length - 1] * c.final);
  return Math.round((Math.min(lo, vg) * 3.6) / 5) * 5;
}

function controlsHelp() {
  return `<div class="controls">
    <div><b>Drive</b> <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> / WASD · Gamepad RT/LT + stick</div>
    <div><b>Shift</b> <kbd>E</kbd>/<kbd>Q</kbd> (manual) · RB/LB  &nbsp; <b>Handbrake</b> <kbd>Space</kbd> · B</div>
    <div><b>Camera</b> <kbd>C</kbd> · Y &nbsp; <b>Look back</b> <kbd>B</kbd> &nbsp; <b>Reset car</b> <kbd>R</kbd> · View &nbsp; <b>Line</b> <kbd>L</kbd> &nbsp; <b>Pause</b> <kbd>Esc</kbd> · Start</div>
  </div>`;
}
