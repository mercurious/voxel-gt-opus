// localStorage wrappers. Storage can be unavailable (private mode, blocked
// site data), so every access is guarded and the game works without it.
const PREFIX = 'voxelgt.';

export function load(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_SETTINGS = {
  auto: true,
  tcs: true,
  asm: true,
  line: false,
  units: 'kmh',
  quality: 'high',
  volume: 0.7,
  camera: 0,
  laps: 3,
  difficulty: 'normal',
  field: 'mixed',
};

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...load('settings', {}) };
}
export function saveSettings(s) {
  save('settings', s);
}

// best laps: { [trackId]: { [carId]: seconds } }
export function bestLap(trackId, carId) {
  const all = load('best', {});
  return all[trackId]?.[carId] ?? null;
}
export function bestLapAny(trackId) {
  const all = load('best', {})[trackId] || {};
  let best = null, car = null;
  for (const [c, t] of Object.entries(all)) if (best == null || t < best) { best = t; car = c; }
  return best == null ? null : { time: best, car };
}
export function recordLap(trackId, carId, t) {
  const all = load('best', {});
  all[trackId] = all[trackId] || {};
  const prev = all[trackId][carId];
  if (prev == null || t < prev) {
    all[trackId][carId] = t;
    save('best', all);
    return true;
  }
  return false;
}

// ghost: compact sampled lap { car, paint, time, dt, data: [x,y,z,h,...] }
export function loadGhost(trackId) {
  return load('ghost.' + trackId, null);
}
export function saveGhost(trackId, ghost) {
  return save('ghost.' + trackId, ghost);
}
