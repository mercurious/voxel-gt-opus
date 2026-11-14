// Generic city street furniture built from BoxBuilder boxes.
// Frame convention (see BoxBuilder): local +x faces the roadway, local z runs
// along the kerb, y up; every function places its boxes at ground point
// (x, y, z) rotated by `rot`. Sizes are real metres.
// STYLE holds per-city colours/shapes; unknown styles fall back to 'nyc'.
import * as THREE from 'three';
import { rng } from '../util.js';

export const STYLE = {
  nyc: {
    lamp: 'cobra', pole: '#2d3a32', poleBase: '#232d27', lampHead: '#3b4640', bulb: '#ffe1a6',
    signal: 'vertical', signalPole: '#2a2f2c', housing: '#e3b21c', lensRed: '#4c1410', lensAmber: '#4d3812',
    lensGreen: '#47ff9a', pedLit: '#ff7a1c', pedBox: '#2b2b28', streetSign: '#1d6b3a',
  },
  tokyo: {
    lamp: 'cobra', pole: '#a3a8ad', poleBase: '#8a9096', lampHead: '#c9cdd1', bulb: '#eef6ff',
    signal: 'horizontal', signalPole: '#9ba1a6', housing: '#cfd2cc', lensRed: '#4a1616', lensAmber: '#4a3a16',
    lensGreen: '#3dffd0', pedLit: '#ff4a3a', pedBox: '#3a3d40', streetSign: '#2a55a8', taxi: 'jpn', hydrant: false, steam: false,
  },
  madrid: {
    lamp: 'fernandino', pole: '#1c1d1b', poleBase: '#151615', lampHead: '#232421', bulb: '#ffcf80',
    signal: 'vertical', signalPole: '#2a2b2a', housing: '#232323', lensRed: '#4a1410', lensAmber: '#4a3612',
    lensGreen: '#55ff9a', pedLit: '#ff3a2a', pedBox: '#232323', streetSign: '#e8e4d8',
    // white cabs with the red diagonal door stripe, Metro de Madrid rombo signs,
    // yellow Correos post boxes, green kiosks, no hydrants above ground, no manhole steam
    taxi: 'madrid', subway: 'metro', mailbox: 'correos', kiosk: '#2f4b3e', hydrant: false, steam: false,
  },
};
const styleOf = (s) => STYLE[s] || STYLE.nyc;

// Box placer bound to a builder + transform.
const placer = (b, rot, x, y, z) => (x0, y0, z0, x1, y1, z1, c, o) =>
  b.box(x0, y0, z0, x1, y1, z1, c, rot, x, y, z, o);

const _tmp = new THREE.Color();
// Hex colour jittered in brightness by r() in [0,1).
function vary(hex, r, amt = 0.08) {
  _tmp.set(hex).multiplyScalar(1 + (r() * 2 - 1) * amt);
  _tmp.r = Math.min(1, _tmp.r); _tmp.g = Math.min(1, _tmp.g); _tmp.b = Math.min(1, _tmp.b);
  return '#' + _tmp.getHexString();
}
const seeded = (seed) => {
  const r = rng(((Math.floor((seed || 0) * 1009) | 0) ^ 0x2c1b3c6d) >>> 0);
  r();
  return r;
};
const posSeed = (x, z) => Math.floor(x * 7.31) * 131 + Math.floor(z * 5.17);

// ---------------------------------------------------------------------------
export function streetLamp(b, glow, x, y, z, rot, style = 'nyc') {
  const S = styleOf(style);
  const p = placer(b, rot, x, y, z);
  const g = placer(glow, rot, x, y, z);
  if (S.lamp === 'fernandino') {
    // cast-iron Fernandino post: column on a pedestal with ring mouldings, a cross
    // arm with a lantern each side under a crown (kept to a dozen boxes: ~300 per lap)
    p(-0.26, 0, -0.26, 0.26, 0.9, 0.26, S.poleBase);
    p(-0.11, 0.9, -0.11, 0.11, 3.5, 0.11, S.pole);
    for (const yy of [1.6, 3.4]) p(-0.16, yy, -0.16, 0.16, yy + 0.1, 0.16, S.lampHead);
    p(-0.07, 3.5, -0.07, 0.07, 4.35, 0.07, S.pole);
    p(-0.6, 3.95, -0.04, 0.6, 4.04, 0.04, S.pole, { skipBottom: true }); // cross arm
    for (const s of [-1, 1]) {
      const lx = s * 0.56;
      g(lx - 0.17, 3.62, -0.17, lx + 0.17, 3.95, 0.17, S.bulb);
      p(lx - 0.24, 3.95, -0.24, lx + 0.24, 4.14, 0.24, S.lampHead);
    }
    p(-0.05, 4.35, -0.05, 0.05, 4.6, 0.05, S.lampHead);
    return;
  }
  if (S.lamp === 'lantern') {
    p(-0.22, 0, -0.22, 0.22, 0.9, 0.22, S.poleBase);
    p(-0.08, 0.9, -0.08, 0.08, 4.2, 0.08, S.pole);
    p(-0.25, 4.2, -0.25, 0.25, 4.3, 0.25, S.lampHead);
    g(-0.21, 4.3, -0.21, 0.21, 4.9, 0.21, S.bulb);
    p(-0.3, 4.9, -0.3, 0.3, 5.05, 0.3, S.lampHead);
    p(-0.05, 5.05, -0.05, 0.05, 5.3, 0.05, S.lampHead);
    return;
  }
  // cobra head on a mast arm reaching over the road
  p(-0.25, 0, -0.25, 0.25, 1.1, 0.25, S.poleBase);
  p(-0.18, 1.1, -0.18, 0.18, 1.25, 0.18, S.poleBase);
  p(-0.11, 1.25, -0.11, 0.11, 9.0, 0.11, S.pole);
  p(-0.14, 9.0, -0.14, 0.14, 9.12, 0.14, S.poleBase);
  p(0.11, 8.72, -0.06, 2.0, 8.86, 0.06, S.pole);
  p(1.8, 8.6, -0.24, 2.9, 8.95, 0.24, S.lampHead);
  g(1.9, 8.54, -0.17, 2.75, 8.6, 0.17, S.bulb);
}

export function trafficSignal(b, glow, x, y, z, rot, armLen, style = 'nyc') {
  const S = styleOf(style);
  const p = placer(b, rot, x, y, z);
  const g = placer(glow, rot, x, y, z);
  const L = Math.max(1.5, armLen || 0);
  const armY = 6.25;
  // pole, base, cap, mast arm + gusset
  p(-0.24, 0, -0.24, 0.24, 0.6, 0.24, S.signalPole);
  p(-0.15, 0.6, -0.15, 0.15, 7.3, 0.15, S.signalPole);
  p(-0.19, 7.3, -0.19, 0.19, 7.42, 0.19, S.signalPole);
  p(0.15, armY, -0.08, L, armY + 0.2, 0.08, S.signalPole);
  p(0.15, armY - 0.45, -0.05, 1.1, armY, 0.05, S.signalPole);
  // signal heads hanging off the arm, lenses facing local -z
  const n = L < 4 ? 1 : L < 9 ? 2 : 3;
  for (let i = 0; i < n; i++) {
    const cx = n === 1 ? L - 0.5 : L * (0.95 - (0.5 * i) / (n - 1));
    if (S.signal === 'horizontal') {
      const top = armY - 0.25;
      p(cx - 0.03, top, -0.03, cx + 0.03, armY, 0.03, S.signalPole);
      p(cx - 0.6, top - 0.42, -0.16, cx + 0.6, top, 0.16, S.housing);
      g(cx - 0.52, top - 0.35, -0.22, cx - 0.24, top - 0.07, -0.16, S.lensGreen);
      p(cx - 0.14, top - 0.35, -0.22, cx + 0.14, top - 0.07, -0.16, S.lensAmber);
      p(cx + 0.24, top - 0.35, -0.22, cx + 0.52, top - 0.07, -0.16, S.lensRed);
    } else {
      const top = armY - 0.15;
      p(cx - 0.05, top, -0.05, cx + 0.05, armY, 0.05, S.signalPole);
      p(cx - 0.2, top - 1.1, -0.18, cx + 0.2, top, 0.18, S.housing);
      p(cx - 0.13, top - 0.33, -0.24, cx + 0.13, top - 0.07, -0.18, S.lensRed);
      p(cx - 0.13, top - 0.68, -0.24, cx + 0.13, top - 0.42, -0.18, S.lensAmber);
      g(cx - 0.13, top - 1.03, -0.24, cx + 0.13, top - 0.77, -0.18, S.lensGreen);
    }
  }
  // pedestrian signal facing across the street (+x)
  p(0.15, 2.6, -0.2, 0.5, 3.1, 0.2, S.pedBox);
  g(0.5, 2.68, -0.14, 0.53, 3.02, 0.14, S.pedLit);
  // street-name blades above the arm
  p(-0.1, 6.7, -0.03, 1.15, 6.95, 0.03, S.streetSign, { flat: true });
  p(-0.03, 7.0, -0.1, 0.03, 7.25, 1.15, S.streetSign, { flat: true });
}

export function hydrant(b, x, y, z, rot, style = 'nyc') {
  if (styleOf(style).hydrant === false) return;
  const p = placer(b, rot, x, y, z);
  const red = '#c4231c', silver = '#c9cdd2';
  p(-0.2, 0, -0.2, 0.2, 0.08, 0.2, red);
  p(-0.15, 0.08, -0.15, 0.15, 0.6, 0.15, red);
  p(-0.17, 0.6, -0.17, 0.17, 0.68, 0.17, red);
  p(-0.11, 0.68, -0.11, 0.11, 0.8, 0.11, silver);
  p(-0.04, 0.8, -0.04, 0.04, 0.87, 0.04, silver);
  p(-0.06, 0.38, -0.27, 0.06, 0.5, 0.27, silver);
  p(0.15, 0.34, -0.08, 0.28, 0.52, 0.08, silver);
}

export function subwayEntrance(b, glow, x, y, z, rot, style = 'nyc') {
  const metro = styleOf(style).subway === 'metro';
  const p = placer(b, rot, x, y, z);
  const g = placer(glow, rot, x, y, z);
  const stone = metro ? '#a39d92' : '#8b8a84', rail = metro ? '#8e959c' : '#24513a', dark = '#121314';
  const W = 0.9, LEN = 5;
  // stair opening: dark well with step nosings fading into the dark (faked depth)
  p(-W, 0, 0, W, 0.025, LEN, dark, { flat: true });
  for (let i = 0; i < 6; i++) {
    const k = 0.62 - i * 0.09;
    const c = '#' + _tmp.setRGB(k * 0.62, k * 0.62, k * 0.6).getHexString();
    p(-W + 0.05, 0.025, 0.25 + i * 0.4, W - 0.05, 0.035, 0.37 + i * 0.4, c, { flat: true });
  }
  // knee-high stone parapet with green railing on three sides (open at z = 0)
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -W - 0.25 : W, x1 = s < 0 ? -W : W + 0.25;
    p(x0, 0, 0, x1, 0.55, LEN + 0.25, stone);
    p(x0 + 0.08, 1.0, 0, x1 - 0.08, 1.08, LEN + 0.25, rail);
    for (const zz of [0.05, LEN * 0.5, LEN + 0.1])
      p(x0 + 0.09, 0.55, zz - 0.04, x1 - 0.09, 1.0, zz + 0.04, rail);
  }
  p(-W, 0, LEN, W, 0.55, LEN + 0.25, stone);
  p(-W, 1.0, LEN + 0.08, W, 1.08, LEN + 0.17, rail);
  p(-0.04, 0.55, LEN + 0.08, 0.04, 1.0, LEN + 0.17, rail);
  if (metro) {
    // Metro de Madrid: red rombo with the blue band on a post at the open end
    const cx = W + 0.125, yc = 3.3;
    p(cx - 0.06, 0.55, -0.06, cx + 0.06, yc - 0.55, 0.06, '#3a3d40');
    for (let k = -3; k <= 3; k++) {
      const w = 0.62 * (1 - Math.abs(k) / 3.6);
      g(cx - w, yc + k * 0.16 - 0.08, -0.04, cx + w, yc + k * 0.16 + 0.08, 0.04, '#d0182f');
    }
    g(cx - 0.7, yc - 0.13, -0.05, cx + 0.7, yc + 0.13, 0.05, '#2245a6');
    g(cx - 0.42, yc - 0.03, -0.06, cx + 0.42, yc + 0.03, 0.06, '#f2f2f2');
    return;
  }
  // lamp posts with green globes at the open end
  for (const s of [-1, 1]) {
    const cx = s * (W + 0.125);
    p(cx - 0.07, 0.55, -0.07, cx + 0.07, 2.4, 0.07, rail);
    g(cx - 0.18, 2.4, -0.18, cx + 0.18, 2.76, 0.18, '#3dff7a');
    p(cx - 0.1, 2.76, -0.1, cx + 0.1, 2.84, 0.1, rail);
  }
}

export function mailbox(b, x, y, z, rot, style = 'nyc') {
  const p = placer(b, rot, x, y, z);
  if (styleOf(style).mailbox === 'correos') {
    // Correos buzón: yellow pillar box with a domed top and the blue post-horn badge
    const Y = '#f2c100', D = '#c99a00';
    p(-0.26, 0, -0.26, 0.26, 0.08, 0.26, '#3a3a3a');
    p(-0.24, 0.08, -0.24, 0.24, 1.0, 0.24, Y);
    p(-0.2, 1.0, -0.2, 0.2, 1.1, 0.2, Y);
    p(-0.12, 1.1, -0.12, 0.12, 1.15, 0.12, D);
    p(0.24, 0.82, -0.14, 0.26, 0.88, 0.14, '#1d1d1d', { flat: true });
    p(0.24, 0.5, -0.1, 0.26, 0.7, 0.1, '#1d4296', { flat: true });
    return;
  }
  const blue = '#2b4f9e', dark = '#1a2f5e';
  p(-0.26, 0, -0.27, -0.18, 0.25, 0.27, dark);
  p(0.18, 0, -0.27, 0.26, 0.25, 0.27, dark);
  p(-0.27, 0.25, -0.28, 0.27, 1.05, 0.28, blue);
  p(-0.2, 1.05, -0.28, 0.2, 1.17, 0.28, blue);
  p(0.27, 0.82, -0.18, 0.31, 0.95, 0.18, dark);
  p(0.27, 0.45, -0.12, 0.29, 0.62, 0.12, '#d9dde3', { flat: true });
}

export function newsstand(b, x, y, z, rot, style = 'nyc') {
  const p = placer(b, rot, x, y, z);
  const r = seeded(posSeed(x, z));
  const green = styleOf(style).kiosk || '#2f6b4a', silver = '#b9bdc1';
  p(-0.8, 0, -1.5, 0.3, 2.4, 1.5, green);
  p(0.3, 0, -1.5, 0.8, 0.9, 1.5, green);
  p(0.3, 2.0, -1.5, 0.85, 2.4, 1.5, '#1d3a2a');
  p(-0.9, 2.4, -1.6, 1.15, 2.56, 1.6, silver);
  const mags = ['#e63946', '#f4d35e', '#2a9df4', '#ffffff', '#f77f00', '#8e44ad', '#2ec4b6', '#ff5fa2', '#111111'];
  const pick = () => mags[Math.floor(r() * mags.length)];
  for (const [y0, y1] of [[1.1, 1.45], [1.55, 1.9]])
    for (let i = 0; i < 6; i++) {
      const z0 = -1.4 + i * 0.47;
      p(0.3, y0 + r() * 0.05, z0, 0.36, y1, z0 + 0.38, pick(), { flat: true });
    }
  for (let i = 0; i < 5; i++) {
    const z0 = -1.4 + i * 0.56;
    p(0.38, 0.9, z0, 0.76, 0.93 + r() * 0.12, z0 + 0.46, pick(), { flat: true });
  }
}

export function trashCan(b, x, y, z) {
  const p = placer(b, 0, x, y, z);
  const mesh = '#3a463d';
  p(-0.22, 0, -0.22, 0.22, 0.08, 0.22, '#262b27');
  p(-0.3, 0.08, -0.3, 0.3, 0.88, 0.3, mesh);
  p(-0.33, 0.88, -0.33, 0.33, 0.95, 0.33, '#4c5a50');
  p(-0.27, 0.9, -0.27, 0.27, 0.955, 0.27, '#141614', { flat: true });
}

export function bench(b, x, y, z, rot) {
  const p = placer(b, rot, x, y, z);
  const metal = '#2b302d', wood = '#8a5a32';
  for (const s of [-1, 1]) {
    const zc = s * 0.75;
    p(-0.27, 0, zc - 0.03, 0.25, 0.43, zc + 0.03, metal);
    p(-0.33, 0.43, zc - 0.03, -0.27, 0.9, zc + 0.03, metal);
  }
  p(-0.27, 0.43, -0.9, -0.01, 0.48, 0.9, wood);
  p(0.02, 0.43, -0.9, 0.27, 0.48, 0.9, wood);
  p(-0.33, 0.56, -0.9, -0.28, 0.68, 0.9, wood);
  p(-0.33, 0.73, -0.9, -0.28, 0.86, 0.9, wood);
}

// ---------------------------------------------------------------------------
// Cars: length along local z (front = +z), width along x.
const CAR_SHAPES = {
  sedan:   { bodyH: 0.95, cab0: -1.15, cab1: 0.95, cabH: 1.45, len: 2.45 },
  hatch:   { bodyH: 0.95, cab0: -1.75, cab1: 0.75, cabH: 1.5, len: 2.1 },
  suv:     { bodyH: 1.05, cab0: -2.1, cab1: 0.85, cabH: 1.8, len: 2.4 },
  minivan: { bodyH: 1.05, cab0: -2.2, cab1: 1.35, cabH: 1.85, len: 2.45 },
  jpn:     { bodyH: 1.0, cab0: -1.95, cab1: 1.15, cabH: 1.95, len: 2.25 }, // tall upright Tokyo cab
};

function car(b, x, y, z, rot, r, shape, paint, taxiCab) {
  const p = placer(b, rot, x, y, z);
  const S = CAR_SHAPES[shape];
  const L = S.len, W = 0.92, wx = 0.96;
  const tyre = '#151515', hub = '#b7bcc1', chrome = '#d3d7db', glass = '#1d2731';
  const ax = L - 0.85;
  for (const zc of [-ax, ax])
    for (const s of [-1, 1]) {
      p(s < 0 ? -wx : wx - 0.25, 0, zc - 0.33, s < 0 ? -wx + 0.25 : wx, 0.66, zc + 0.33, tyre);
      p(s < 0 ? -wx - 0.02 : wx, 0.2, zc - 0.13, s < 0 ? -wx : wx + 0.02, 0.46, zc + 0.13, hub);
    }
  p(-W, 0.3, -L, W, S.bodyH, L, paint);
  p(-W + 0.06, S.bodyH, S.cab0, W - 0.06, S.cabH, S.cab1, glass);
  p(-W + 0.1, S.cabH, S.cab0 + 0.1, W - 0.1, S.cabH + 0.07, S.cab1 - 0.12, paint);
  p(-W + 0.05, 0.3, L, W - 0.05, 0.48, L + 0.08, chrome);
  p(-W + 0.05, 0.3, -L - 0.08, W - 0.05, 0.48, -L, chrome);
  p(-W + 0.1, 0.62, L - 0.02, -W + 0.4, 0.78, L + 0.02, '#f4f1de', { flat: true });
  p(W - 0.4, 0.62, L - 0.02, W - 0.1, 0.78, L + 0.02, '#f4f1de', { flat: true });
  p(-W + 0.08, 0.62, -L - 0.02, -W + 0.35, 0.8, -L + 0.02, '#b3171d', { flat: true });
  p(W - 0.35, 0.62, -L - 0.02, W - 0.08, 0.8, -L + 0.02, '#b3171d', { flat: true });
  p(-W - 0.1, S.bodyH, S.cab1 - 0.2, W + 0.1, S.bodyH + 0.1, S.cab1 - 0.08, paint);
  if (taxiCab === 'madrid') {
    // white cab, red diagonal band across the front doors, green "libre" lamp on the roof
    const roof = S.cabH + 0.07;
    p(-0.2, roof, -0.08, 0.2, roof + 0.16, 0.08, '#f2f2ee');
    p(-0.08, roof + 0.16, -0.05, 0.08, roof + 0.24, 0.05, '#2bd94f');
    for (let k = 0; k < 6; k++) {
      const z0 = -0.15 + k * 0.19, y0 = 0.34 + k * 0.1;
      p(-W - 0.012, y0, z0, W + 0.012, Math.min(S.bodyH, y0 + 0.16), z0 + 0.24, '#c8202a');
    }
  } else if (taxiCab === 'jpn') {
    // deep indigo cab, gold pinstripe, glowing andon roof sign
    const roof = S.cabH + 0.07;
    p(-0.28, roof, -0.16, 0.28, roof + 0.3, 0.16, '#ffcf5a', { flat: true });
    p(-0.3, roof + 0.3, -0.18, 0.3, roof + 0.34, 0.18, '#2a2a2a');
    p(-W - 0.01, 0.74, -L + 0.3, W + 0.01, 0.79, L - 0.3, '#c9a24a');
  } else if (taxiCab) {
    const roof = S.cabH + 0.07;
    p(-0.32, roof, -0.12, 0.32, roof + 0.28, 0.12, '#fff3c4');
    p(-0.36, roof + 0.28, -0.14, 0.36, roof + 0.31, 0.14, '#222222');
    if (r() < 0.5) {
      // checker band along both doors
      p(-W - 0.01, 0.62, -1.3, W + 0.01, 0.72, 1.2, '#1b1b1b');
    }
  }
}

export function taxi(b, x, y, z, rot, seed, style = 'nyc') {
  const r = seeded(seed);
  if (styleOf(style).taxi === 'madrid') {
    const v = r();
    car(b, x, y, z, rot, r, v < 0.25 ? 'minivan' : v < 0.5 ? 'hatch' : 'sedan', vary('#f1f1ed', r, 0.03), 'madrid');
    return;
  }
  if (styleOf(style).taxi === 'jpn') {
    car(b, x, y, z, rot, r, 'jpn', vary(r() < 0.8 ? '#1f2846' : '#2c2c30', r, 0.05), 'jpn');
    return;
  }
  const shape = r() < 0.35 ? 'minivan' : 'sedan';
  car(b, x, y, z, rot, r, shape, vary('#f2b705', r, 0.05), true);
}

const PARKED = ['#5a5f66', '#8b8f94', '#2b2d31', '#c9c9c4', '#3b4a5c', '#6b2a2a', '#4a5a4a', '#d8d6ce', '#7a6a55', '#1f2a3a'];
export function parkedCar(b, x, y, z, rot, seed) {
  const r = seeded(seed + 0.5);
  const v = r();
  const shape = v < 0.5 ? 'sedan' : v < 0.75 ? 'hatch' : v < 0.92 ? 'suv' : 'minivan';
  car(b, x, y, z, rot, r, shape, vary(PARKED[Math.floor(r() * PARKED.length)], r, 0.1), false);
}

// ---------------------------------------------------------------------------
const LEAVES = ['#4f7a34', '#5c8a3a', '#3f6b2c', '#6b9a42', '#466f30', '#73a046'];

export function streetTree(b, x, y, z, seed, scale = 1) {
  const r = seeded(seed);
  const s = scale * (0.85 + r() * 0.3);
  const p = placer(b, r() * Math.PI, x, y, z);
  const bark = vary('#5a4632', r, 0.12);
  p(-0.65, 0, -0.65, 0.65, 0.03, 0.65, '#3a2d22', { flat: true });
  const th = 3.0 * s;
  p(-0.14 * s, 0, -0.14 * s, 0.14 * s, th, 0.14 * s, bark);
  p(-0.08 * s, th - 0.6 * s, -0.5 * s, 0.08 * s, th - 0.4 * s, 0.5 * s, bark);
  const n = 3 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r();
    const rad = i === 0 ? 0 : (0.8 + r() * 0.8) * s;
    const cx = Math.cos(a) * rad, cz = Math.sin(a) * rad;
    const hw = (1.0 + r() * 0.7) * s, hh = (0.8 + r() * 0.6) * s;
    const cy = th + (i === 0 ? 1.4 : 0.6 + r() * 1.6) * s;
    p(cx - hw, cy - hh, cz - hw, cx + hw, cy + hh, cz + hw, vary(LEAVES[Math.floor(r() * LEAVES.length)], r, 0.08));
  }
}

// Far-away tree: trunk and one merged crown (3 boxes instead of ~8).
export function simpleTree(b, x, y, z, seed, scale = 1) {
  const r = seeded(seed + 0.75);
  const s = scale * (0.85 + r() * 0.3);
  const p = placer(b, r() * Math.PI, x, y, z);
  const th = 3.0 * s, hw = (1.8 + r() * 0.6) * s, hh = (1.5 + r() * 0.5) * s;
  const leaf = vary(LEAVES[Math.floor(r() * LEAVES.length)], r, 0.08);
  p(-0.15 * s, 0, -0.15 * s, 0.15 * s, th, 0.15 * s, '#54412f', { skipBottom: true, skipTop: true });
  p(-hw, th, -hw, hw, th + hh * 1.6, hw, leaf);
  p(-hw * 0.6, th + hh * 1.6, -hw * 0.6, hw * 0.6, th + hh * 2.3, hw * 0.6, leaf, { skipBottom: true });
}

export function parkTree(b, x, y, z, seed, scale = 1) {
  const r = seeded(seed + 0.25);
  const s = scale * (0.8 + r() * 0.5);
  const p = placer(b, r() * Math.PI, x, y, z);
  const th = (3.2 + r() * 1.2) * s;
  p(-0.28 * s, 0, -0.28 * s, 0.28 * s, th + 1.0 * s, 0.28 * s, vary('#4e3d2c', r, 0.12));
  const base = Math.floor(r() * 3);
  const n = 5 + Math.floor(r() * 5);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.8;
    const rad = i === 0 ? 0 : (1.4 + r() * 1.6) * s;
    const cx = Math.cos(a) * rad, cz = Math.sin(a) * rad;
    const hw = (1.5 + r() * 1.2) * s, hh = (1.1 + r() * 0.9) * s;
    const cy = th + (i === 0 ? 2.6 : 0.9 + r() * 2.6) * s;
    p(cx - hw, cy - hh, cz - hw, cx + hw, cy + hh, cz + hw,
      vary(LEAVES[(base + Math.floor(r() * 3)) % LEAVES.length], r, 0.1));
  }
}

// ---------------------------------------------------------------------------
// Animated manhole steam: one InstancedMesh of puffs for all points.
export function makeSteam(points, keep) {
  const PER = 8;
  const count = (points?.length || 0) * PER;
  if (!count) return { object: new THREE.Object3D(), update() {} };
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, fog: true });
  keep?.(geo); keep?.(mat);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.renderOrder = 2;
  const white = new THREE.Color(0xffffff), grey = new THREE.Color(0xa8adb3), col = new THREE.Color();
  // per-puff constants: phase, period, drift angle, spin
  const ph = new Float32Array(count), per = new Float32Array(count), ang = new Float32Array(count), spin = new Float32Array(count);
  const r = seeded(points.length * 7.7);
  for (let i = 0; i < count; i++) {
    ph[i] = (i % PER) / PER + r() * 0.08;
    per[i] = 3.2 + r() * 0.8;
    ang[i] = r() * Math.PI * 2;
    spin[i] = r() * Math.PI;
    mesh.setColorAt(i, white);
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  function update(time) {
    for (let i = 0; i < count; i++) {
      const pt = points[(i / PER) | 0];
      const t = (time / per[i] + ph[i]) % 1;
      const drift = t * t * 1.4;
      pos.set(pt[0] + Math.cos(ang[i]) * drift + t * 0.8, pt[1] + 0.15 + t * 6, pt[2] + Math.sin(ang[i]) * drift);
      const s = (0.5 + t * 2.3) * Math.min(1, t * 10) * Math.min(1, (1 - t) * 3);
      sc.set(s, s * 0.8, s);
      q.setFromAxisAngle(up, spin[i] + t * 1.2);
      mesh.setMatrixAt(i, m.compose(pos, q, sc));
      mesh.setColorAt(i, col.copy(white).lerp(grey, t));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }
  update(0);
  return { object: mesh, update };
}
