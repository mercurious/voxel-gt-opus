// The garage: five road cars based on real models. Physics numbers are
// period-correct approximations (power in PS, torque in Nm, mass incl. driver).
// `model` drives the procedural voxel builder in carModel.js (all meters).

const C = {
  glass: '#1d2733',
  black: '#141416',
  dark: '#26282c',
  chrome: '#c9ccd1',
  tail: '#d01818',
  amber: '#ff9a1a',
  head: '#f4f1df',
  plate: '#f2f2ea',
  plateY: '#f2d34a',
};

export const CARS = [
  {
    id: 'mx5',
    brand: 'Mazda',
    name: 'MX-5 Miata (NA)',
    year: 1989,
    country: 'Japan',
    blurb: 'A featherweight roadster with perfect balance. Slow on the straights, a joy everywhere else.',
    engine: '1.6 L inline-4',
    cylinders: 4,
    layout: 'FR',
    powerPS: 116, powerRpm: 6500,
    torqueNm: 136, torqueRpm: 5500,
    idle: 850, redline: 7200,
    mass: 1030, wf: 0.52, cgHeight: 0.46, wheelbase: 2.265,
    gears: [3.136, 1.888, 1.33, 1.0, 0.814], final: 4.3, shiftTime: 0.16,
    wheelRadius: 0.282, cd: 0.38, area: 1.72, clA: 0, frontDown: 0.5,
    rearGrip: 1.03, grip: 0.97, brake: 1.0, driveFront: 0, inertia: 0.95, steerLock: 0.62,
    turbo: null,
    paints: [
      { name: 'Classic Red', hex: '#c8102e' },
      { name: 'Mariner Blue', hex: '#1d3f8f' },
      { name: 'Crystal White', hex: '#efeee8' },
    ],
    model: {
      length: 3.97, width: 1.68, wheelbase: 2.265, frontOverhang: 0.78,
      track: 1.42, wheelR: 0.29, wheelW: 0.2, clearance: 0.13,
      rim: '#c8cbd0', rimStyle: 'spokes',
      hood: [[0, 0.36], [0.06, 0.52], [0.3, 0.62], [1.0, 0.72], [1.48, 0.79], [2.95, 0.83], [3.72, 0.84], [3.9, 0.78], [3.97, 0.5]],
      plan: [[0, 0.74], [0.18, 0.92], [0.5, 1], [3.5, 1], [3.82, 0.94], [3.97, 0.84]],
      roof: [[1.46, 0.8], [1.9, 1.2], [2.5, 1.21], [2.95, 0.86]],
      roofFlat: [1.92, 2.5], roofColor: '#2b2b2e', rearGlass: '#3a3f46',
      tumble: [0.1, 0.24], bPillar: null,
      edgeRound: 0.07,
      features: [
        { face: 'front', u: [0, 0.32], z: [0.18, 0.32], color: C.black }, // the smile
        { face: 'front', u: [0.55, 0.78], z: [0.26, 0.32], color: C.amber },
        { face: 'top', x: [0.18, 0.5], u: [0.42, 0.7], color: '#9aa0a8', mirror: true, thin: true }, // pop-up lid seams
        { face: 'rear', u: [0.48, 0.82], z: [0.55, 0.68], color: C.tail, group: 'tail' },
        { face: 'rear', u: [0.08, 0.3], z: [0.42, 0.56], color: C.plate },
        { face: 'side', x: [0.62, 0.7], z: [0.5, 0.56], color: C.amber },
      ],
      boxes: [
        { x: [1.42, 1.52], u: [0.86, 0.98], z: [0.84, 0.92], color: C.black, mirror: true }, // mirrors
        { x: [3.86, 3.97], u: [0.42, 0.52], z: [0.16, 0.24], color: C.chrome, mirror: false }, // exhaust
      ],
    },
  },
  {
    id: 'gtr34',
    brand: 'Nissan',
    name: 'Skyline GT-R V-spec (R34)',
    year: 1999,
    country: 'Japan',
    blurb: 'Twin-turbo straight-six and a clever all-wheel-drive brain. Heavy, but devastating out of slow corners.',
    engine: '2.6 L twin-turbo inline-6',
    cylinders: 6,
    layout: '4WD',
    powerPS: 330, powerRpm: 6800,
    torqueNm: 400, torqueRpm: 4400,
    idle: 900, redline: 8000,
    mass: 1620, wf: 0.56, cgHeight: 0.5, wheelbase: 2.665,
    gears: [3.827, 2.36, 1.685, 1.312, 1.0, 0.793], final: 3.545, shiftTime: 0.2,
    wheelRadius: 0.326, cd: 0.34, area: 2.0, clA: 0.18, frontDown: 0.45,
    rearGrip: 1.07, grip: 1.03, brake: 1.05, driveFront: 0.32, inertia: 1.05, steerLock: 0.58,
    turbo: { lag: 0.55, minRpm: 2600 },
    paints: [
      { name: 'Bayside Blue', hex: '#1f5cc4' },
      { name: 'Midnight Purple III', hex: '#3b1f52' },
      { name: 'Sonic Silver', hex: '#b8bdc3' },
    ],
    model: {
      length: 4.6, width: 1.79, wheelbase: 2.665, frontOverhang: 0.88,
      track: 1.5, wheelR: 0.33, wheelW: 0.25, clearance: 0.14,
      rim: '#7c8188', rimStyle: 'six',
      hood: [[0, 0.38], [0.05, 0.6], [0.2, 0.7], [1.5, 0.8], [1.72, 0.85], [3.6, 0.97], [4.45, 0.99], [4.56, 0.96], [4.6, 0.55]],
      plan: [[0, 0.88], [0.12, 0.97], [0.3, 1], [4.4, 1], [4.6, 0.95]],
      roof: [[1.68, 0.87], [2.4, 1.34], [3.3, 1.34], [3.92, 1.0]],
      roofFlat: [2.42, 3.32], roofColor: null,
      tumble: [0.12, 0.28], bPillar: 2.8,
      edgeRound: 0.05,
      features: [
        { face: 'front', u: [0, 0.4], z: [0.2, 0.52], color: C.black }, // grille + intake
        { face: 'front', u: [0.48, 0.86], z: [0.5, 0.62], color: C.head, group: 'head' },
        { face: 'front', u: [0.5, 0.82], z: [0.22, 0.32], color: C.black },
        { face: 'top', x: [0.35, 0.75], u: [0, 0.22], color: C.dark, thin: true }, // hood vent
        { face: 'rear', circle: [0.68, 0.76, 0.075], color: C.tail, group: 'tail' },
        { face: 'rear', circle: [0.42, 0.76, 0.075], color: C.tail, group: 'tail' },
        { face: 'rear', u: [0, 0.22], z: [0.5, 0.64], color: C.plate },
        { face: 'side', x: [0.55, 0.85], z: [0.48, 0.56], color: C.dark },
      ],
      boxes: [
        { x: [4.2, 4.5], u: [0, 0.95], z: [1.1, 1.15], color: 'paint' }, // wing blade
        { x: [4.28, 4.42], u: [0.62, 0.72], z: [0.96, 1.1], color: 'paint', mirror: true }, // wing stands
        { x: [1.62, 1.74], u: [0.88, 1.0], z: [0.9, 0.98], color: 'paint', mirror: true },
        { x: [4.5, 4.6], u: [0.5, 0.62], z: [0.16, 0.26], color: C.chrome, mirror: false },
        { x: [-0.02, 0.06], u: [0, 0.9], z: [0.12, 0.17], color: C.dark }, // front lip
      ],
    },
  },
  {
    id: 'nsxr',
    brand: 'Honda',
    name: 'NSX Type R (NA1)',
    year: 1992,
    country: 'Japan',
    blurb: 'Mid-engined, all-aluminium and stripped of 120 kg. Razor-sharp turn-in with an 8,000 rpm V6.',
    engine: '3.0 L V6 VTEC',
    cylinders: 6,
    layout: 'MR',
    powerPS: 280, powerRpm: 7300,
    torqueNm: 294, torqueRpm: 5400,
    idle: 900, redline: 8000,
    mass: 1305, wf: 0.42, cgHeight: 0.43, wheelbase: 2.53,
    gears: [3.066, 1.956, 1.428, 1.125, 0.86], final: 4.235, shiftTime: 0.15,
    wheelRadius: 0.31, cd: 0.32, area: 1.8, clA: 0.12, frontDown: 0.42,
    rearGrip: 1.05, grip: 1.04, brake: 1.03, driveFront: 0, inertia: 0.84, steerLock: 0.6,
    turbo: null,
    paints: [
      { name: 'Championship White', hex: '#f1eee2' },
      { name: 'Formula Red', hex: '#c4161c' },
      { name: 'Indy Yellow', hex: '#f0c419' },
    ],
    model: {
      length: 4.43, width: 1.81, wheelbase: 2.53, frontOverhang: 0.93,
      track: 1.52, wheelR: 0.31, wheelW: 0.23, clearance: 0.12,
      rim: '#d8d8d4', rimStyle: 'five',
      hood: [[0, 0.36], [0.06, 0.5], [0.4, 0.6], [1.35, 0.72], [1.62, 0.77], [2.95, 0.9], [4.25, 0.98], [4.38, 0.94], [4.43, 0.56]],
      plan: [[0, 0.8], [0.2, 0.95], [0.5, 1], [4.2, 1], [4.43, 0.94]],
      roof: [[1.56, 0.79], [2.15, 1.16], [2.85, 1.17], [3.05, 1.08], [3.45, 0.93]],
      roofFlat: [2.17, 2.85], roofColor: '#151515', rearGlass: C.glass,
      tumble: [0.14, 0.3], bPillar: null,
      edgeRound: 0.06,
      features: [
        { face: 'front', u: [0, 0.6], z: [0.16, 0.28], color: C.black },
        { face: 'front', u: [0.62, 0.84], z: [0.3, 0.38], color: C.amber },
        { face: 'rear', u: [0, 0.92], z: [0.74, 0.86], color: C.tail, group: 'tail' },
        { face: 'rear', u: [0, 0.2], z: [0.5, 0.64], color: C.plate },
        { face: 'side', x: [2.92, 3.25], z: [0.55, 0.72], color: C.black }, // side intakes
        { face: 'side', x: [1.66, 3.0], z: [0.46, 0.5], color: '#9a9a96' }, // body crease
      ],
      boxes: [
        { x: [4.3, 4.43], u: [0, 0.92], z: [0.98, 1.03], color: 'paint' }, // ducktail lip
        { x: [1.55, 1.66], u: [0.88, 1.0], z: [0.84, 0.92], color: C.black, mirror: true },
        { x: [4.36, 4.45], u: [0.15, 0.3], z: [0.18, 0.26], color: C.chrome, mirror: true },
      ],
    },
  },
  {
    id: 'rs964',
    brand: 'Porsche',
    name: '911 Carrera RS (964)',
    year: 1992,
    country: 'Germany',
    blurb: 'Lightweight, rear-engined and unfiltered. Brakes late, turns in on the nose, punishes lift-off mid-corner.',
    engine: '3.6 L flat-6',
    cylinders: 6,
    layout: 'RR',
    powerPS: 260, powerRpm: 6100,
    torqueNm: 325, torqueRpm: 4800,
    idle: 900, redline: 6800,
    mass: 1305, wf: 0.38, cgHeight: 0.46, wheelbase: 2.272,
    gears: [3.154, 1.947, 1.407, 1.086, 0.868], final: 3.444, shiftTime: 0.18,
    wheelRadius: 0.315, cd: 0.32, area: 1.85, clA: 0.08, frontDown: 0.35,
    rearGrip: 1.08, grip: 1.03, brake: 1.08, driveFront: 0, inertia: 1.0, steerLock: 0.6,
    turbo: null,
    paints: [
      { name: 'Guards Red', hex: '#c50d1f' },
      { name: 'Grand Prix White', hex: '#efede4' },
      { name: 'Riviera Blue', hex: '#1d9ad6' },
    ],
    model: {
      length: 4.27, width: 1.66, wheelbase: 2.272, frontOverhang: 0.86,
      track: 1.4, wheelR: 0.31, wheelW: 0.22, clearance: 0.12,
      rim: '#b8bcc2', rimStyle: 'cup',
      hood: [[0, 0.38], [0.06, 0.52], [0.3, 0.56], [1.25, 0.72], [1.42, 0.8], [2.9, 0.84], [3.9, 0.84], [4.18, 0.8], [4.27, 0.52]],
      fender: [{ x: [0.1, 1.3], h: 0.11, peak: 0.45 }, { x: [2.6, 3.9], h: 0.06, peak: 3.2 }],
      plan: [[0, 0.78], [0.2, 0.92], [0.55, 1], [3.9, 1], [4.27, 0.9]],
      roof: [[1.4, 0.82], [1.95, 1.27], [2.55, 1.27], [3.3, 1.02], [4.1, 0.86]],
      roofFlat: [1.97, 2.55], roofColor: null, rearGlassEnd: 3.15,
      tumble: [0.12, 0.3], bPillar: 2.6,
      edgeRound: 0.08,
      features: [
        { face: 'front', circle: [0.66, 0.66, 0.085], color: C.head, group: 'head' },
        { face: 'front', u: [0, 0.5], z: [0.16, 0.26], color: C.black },
        { face: 'front', u: [0.6, 0.8], z: [0.3, 0.36], color: C.amber },
        { face: 'top', x: [3.55, 3.9], u: [0, 0.4], color: C.black, thin: true }, // engine lid grille
        { face: 'rear', u: [0, 0.94], z: [0.62, 0.7], color: C.tail, group: 'tail' },
        { face: 'rear', u: [0, 0.2], z: [0.42, 0.56], color: C.plate },
      ],
      boxes: [
        { x: [1.38, 1.5], u: [0.86, 0.98], z: [0.86, 0.94], color: 'paint', mirror: true },
        { x: [4.2, 4.3], u: [0.4, 0.55], z: [0.16, 0.24], color: C.chrome, mirror: false },
      ],
    },
  },
  {
    id: 'f40',
    brand: 'Ferrari',
    name: 'F40',
    year: 1987,
    country: 'Italy',
    blurb: 'Twin turbos, no assists, Kevlar everywhere. Wild boost and the fastest thing in the garage.',
    engine: '2.9 L twin-turbo V8',
    cylinders: 8,
    layout: 'MR',
    powerPS: 478, powerRpm: 7000,
    torqueNm: 577, torqueRpm: 4000,
    idle: 1000, redline: 7750,
    mass: 1250, wf: 0.42, cgHeight: 0.42, wheelbase: 2.45,
    gears: [2.769, 1.722, 1.227, 0.963, 0.767], final: 2.727, shiftTime: 0.2,
    wheelRadius: 0.32, cd: 0.34, area: 1.85, clA: 0.45, frontDown: 0.38,
    rearGrip: 1.04, grip: 1.06, brake: 1.06, driveFront: 0, inertia: 0.86, steerLock: 0.58,
    turbo: { lag: 0.75, minRpm: 3000 },
    paints: [
      { name: 'Rosso Corsa', hex: '#cf0a0a' },
      { name: 'Giallo Modena', hex: '#f4c20d' },
      { name: 'Nero Daytona', hex: '#17171a' },
    ],
    model: {
      length: 4.36, width: 1.97, wheelbase: 2.45, frontOverhang: 0.93,
      track: 1.6, wheelR: 0.33, wheelW: 0.28, clearance: 0.11,
      rim: '#b9bcc2', rimStyle: 'five',
      hood: [[0, 0.34], [0.08, 0.44], [1.0, 0.6], [1.5, 0.7], [1.66, 0.74], [2.95, 0.9], [4.1, 0.95], [4.3, 0.92], [4.36, 0.56]],
      plan: [[0, 0.78], [0.25, 0.94], [0.6, 1], [4.2, 1], [4.36, 0.96]],
      roof: [[1.58, 0.76], [2.15, 1.12], [2.62, 1.13], [3.0, 1.02], [4.0, 0.96]],
      roofFlat: [2.17, 2.62], roofColor: null, rearGlassEnd: 3.98, louvers: true,
      tumble: [0.18, 0.36], bPillar: null,
      edgeRound: 0.05,
      features: [
        { face: 'front', u: [0.48, 0.9], z: [0.38, 0.46], color: C.head, group: 'head' },
        { face: 'front', u: [0, 0.42], z: [0.16, 0.3], color: C.black },
        { face: 'front', u: [0.5, 0.88], z: [0.18, 0.26], color: C.black },
        { face: 'top', x: [0.45, 0.8], u: [0.0, 0.3], color: C.black, thin: true }, // NACA ducts
        { face: 'rear', circle: [0.72, 0.8, 0.07], color: C.tail, group: 'tail' },
        { face: 'rear', circle: [0.52, 0.8, 0.07], color: C.tail, group: 'tail' },
        { face: 'rear', u: [0, 0.34], z: [0.3, 0.6], color: C.black }, // rear mesh
        { face: 'side', x: [2.95, 3.35], z: [0.6, 0.78], color: C.black }, // side intakes
        { face: 'side', x: [3.5, 3.75], z: [0.3, 0.45], color: C.black },
      ],
      boxes: [
        { x: [4.0, 4.36], u: [0, 1.0], z: [1.1, 1.15], color: 'paint' }, // the wing
        { x: [3.98, 4.36], u: [0.95, 1.0], z: [0.9, 1.15], color: 'paint', mirror: true }, // end plates
        { x: [1.56, 1.68], u: [0.9, 1.02], z: [0.8, 0.88], color: 'paint', mirror: true },
        { x: [4.3, 4.4], u: [0.0, 0.14], z: [0.3, 0.42], color: C.chrome, mirror: true }, // triple exhaust
        { x: [-0.02, 0.1], u: [0, 0.94], z: [0.1, 0.15], color: C.dark },
      ],
    },
  },
];

export const CAR_COLORS = C;

export function carById(id) {
  return CARS.find((c) => c.id === id) || CARS[0];
}

// Derived figures for the spec sheet.
export function carStats(c) {
  const kw = c.powerPS * 0.7355;
  return {
    kgPerPS: c.mass / c.powerPS,
    power: c.powerPS,
    // 0..1 bars relative to the garage
    barPower: Math.min(1, c.powerPS / 480),
    barWeight: Math.min(1, 1 - (c.mass - 950) / 800),
    barGrip: Math.min(1, (c.grip - 0.9) / 0.18),
    barBrake: Math.min(1, (c.brake - 0.9) / 0.2),
    kw,
  };
}
