// Circuit definitions. Layouts come from real centerlines (see
// trackData.generated.js); elevation keys are [lap fraction, meters] and are
// hand-tuned approximations of each venue's profile.
//
// City street courses come from OpenStreetMap (cityData.generated.js, built by
// tools/gen-cities.mjs): centreline, per-point width and real elevation, the
// street corridor that bounds the barriers, escape roads and named corners.
// Their scenery is built by cityScene.js plus a per-city module in src/city/.
import { TRACK_POINTS } from './trackData.generated.js';
import { CITY_DATA } from './cityData.generated.js';

function cityCourse(id, meta) {
  const d = CITY_DATA[id];
  return {
    id, city: id, street: true,
    points: d.points, pointW: d.pointW, pointY: d.pointY,
    corridor: d.corridor, escapes: d.escapes, corners: d.corners,
    width: 14, verge: 0, runoff: 0,
    ...meta,
  };
}

export const TRACKS = [
  {
    id: 'monza',
    name: 'Autodromo Nazionale Monza',
    short: 'Monza',
    location: 'Monza, Italy',
    blurb: 'The Temple of Speed. Long straights through a royal park, broken by tight chicanes. Brake hard, stay flat through Curva Grande.',
    points: TRACK_POINTS.monza,
    width: 12.5, verge: 4.5, runoff: 24, runoffSurface: 'gravel',
    elevation: [[0, 0], [0.12, 0.5], [0.25, 2.5], [0.4, 3.5], [0.55, 2], [0.7, 0.5], [0.85, -0.5]],
    corners: [
      [0.105, 'Variante del Rettifilo'], [0.2, 'Curva Grande'], [0.33, 'Variante della Roggia'],
      [0.4, 'Lesmo 1'], [0.44, 'Lesmo 2'], [0.65, 'Variante Ascari'], [0.9, 'Curva Parabolica'],
    ],
    stands: [
      { u: 0.0, len: 340, side: 'L', main: true },
      { u: 0.105, len: 120 }, { u: 0.65, len: 110 }, { u: 0.9, len: 200 },
    ],
    pits: { u: 0.985, len: 300, side: 'R' },
    landmarks: ['banking'],
    theme: {
      time: 'Midday sun',
      skyTop: '#3d7fd0', skyHorizon: '#b9d6ee', fog: '#bcd4ea', fogNear: 300, fogFar: 2200,
      sunDir: [0.35, 0.85, 0.25], sunColor: '#fff3df', sunIntensity: 2.7,
      hemiSky: '#cfe2ff', hemiGround: '#5e6d3c', hemiIntensity: 1.15,
      grass: ['#5c9a38', '#66a43f', '#548f32', '#6aab46'],
      gravel: ['#d9c99d', '#cdbd8e', '#e2d4aa'],
      runoffPaint: ['#3b3e44', '#43464c'],
      terrainAmp: 2.5, terrainScale: 0.006, terrainBase: -0.6,
      trees: { kinds: ['oak', 'oak', 'poplar', 'round'], density: 0.6, band: 260 },
      mountains: { count: 26, dist: 2600, height: 260, color: '#8fa6c0', snow: true },
      clouds: 18,
      wall: 'armco',
      asphalt: ['#53565b', '#585b60', '#4f5257'],
    },
  },
  {
    id: 'suzuka',
    name: 'Suzuka International Racing Course',
    short: 'Suzuka',
    location: 'Suzuka, Japan',
    blurb: 'A figure-of-eight drivers’ circuit. Rhythm through the Esses, commitment at 130R, and a bridge where the lap crosses itself.',
    points: TRACK_POINTS.suzuka,
    width: 12, verge: 4.5, runoff: 22, runoffSurface: 'gravel', bridgeClearance: 8,
    elevation: [
      [0, 0], [0.06, -3], [0.12, 0], [0.2, 6], [0.28, 13], [0.34, 10], [0.39, 1], [0.43, -1], [0.47, -2],
      [0.55, 3], [0.64, 9], [0.7, 10], [0.76, 8], [0.82, 9], [0.88, 5], [0.93, 2],
    ],
    corners: [
      [0.06, 'First Curve'], [0.16, 'S Curves'], [0.27, 'Dunlop'], [0.34, 'Degner'], [0.47, 'Hairpin'],
      [0.55, '200R'], [0.68, 'Spoon Curve'], [0.88, '130R'], [0.935, 'Casio Triangle'],
    ],
    stands: [
      { u: 0.0, len: 320, side: 'L', main: true },
      { u: 0.06, len: 140 }, { u: 0.16, len: 160 }, { u: 0.47, len: 100 }, { u: 0.935, len: 120 },
    ],
    pits: { u: 0.985, len: 280, side: 'R' },
    landmarks: ['ferris'],
    theme: {
      time: 'Late afternoon',
      skyTop: '#4f78b8', skyHorizon: '#f2d3a6', fog: '#e6cfae', fogNear: 260, fogFar: 2000,
      sunDir: [-0.55, 0.42, 0.45], sunColor: '#ffd9a8', sunIntensity: 2.5,
      hemiSky: '#c8d6f0', hemiGround: '#5a5a32', hemiIntensity: 1.0,
      grass: ['#6d9c3a', '#77a645', '#64913a', '#80ad4a'],
      gravel: ['#c9b48c', '#bba67f', '#d3c09a'],
      runoffPaint: ['#3d4047', '#454850'],
      terrainAmp: 14, terrainScale: 0.004, terrainBase: -0.8,
      trees: { kinds: ['round', 'pine', 'round', 'oak'], density: 0.55, band: 240 },
      mountains: { count: 30, dist: 2400, height: 300, color: '#7f8faa', snow: false },
      clouds: 22,
      wall: 'tyres',
      asphalt: ['#55575c', '#5a5c61', '#505257'],
    },
  },
  {
    id: 'spa',
    name: 'Circuit de Spa-Francorchamps',
    short: 'Spa',
    location: 'Stavelot, Belgium',
    blurb: 'Seven kilometres through the Ardennes forest. Plunge into Eau Rouge, climb Raidillon blind, and keep it pinned to Les Combes.',
    points: TRACK_POINTS.spa,
    width: 13, verge: 4.5, runoff: 22, runoffSurface: 'runoff',
    elevation: [
      [0, 0], [0.035, 2], [0.1, -20], [0.125, -28], [0.155, -8], [0.21, 6], [0.26, 14], [0.3, 6],
      [0.33, -6], [0.4, -24], [0.45, -34], [0.55, -45], [0.68, -60], [0.76, -55], [0.82, -42], [0.9, -24], [0.96, -8],
    ],
    corners: [
      [0.035, 'La Source'], [0.125, 'Eau Rouge'], [0.155, 'Raidillon'], [0.26, 'Les Combes'],
      [0.33, 'Rivage'], [0.45, 'Pouhon'], [0.55, 'Fagnes'], [0.68, 'Stavelot'], [0.83, 'Blanchimont'], [0.955, 'Bus Stop'],
    ],
    stands: [
      { u: 0.0, len: 220, side: 'L', main: true },
      { u: 0.035, len: 140 }, { u: 0.14, len: 160 }, { u: 0.45, len: 120 }, { u: 0.955, len: 140 },
    ],
    pits: { u: 0.975, len: 220, side: 'R' },
    landmarks: [],
    theme: {
      time: 'Overcast',
      skyTop: '#7f8b98', skyHorizon: '#c5ccd2', fog: '#b9c1c8', fogNear: 160, fogFar: 1300,
      sunDir: [0.25, 0.9, -0.3], sunColor: '#eef1f4', sunIntensity: 1.6,
      hemiSky: '#d6dde4', hemiGround: '#4a5a3a', hemiIntensity: 1.55,
      grass: ['#4f8435', '#578d3b', '#4a7c31', '#5e9440'],
      gravel: ['#b9ad92', '#ada087', '#c3b89d'],
      runoffPaint: ['#2f5f9e', '#b9302d', '#3d4046'],
      terrainAmp: 45, terrainScale: 0.0028, terrainBase: -1,
      trees: { kinds: ['pine', 'pine', 'pine', 'oak'], density: 0.85, band: 300 },
      mountains: { count: 34, dist: 2200, height: 220, color: '#6c7a72', snow: false },
      clouds: 36, cloudColor: '#dfe3e7', lowClouds: true,
      wall: 'concrete',
      asphalt: ['#4c4f54', '#515459', '#484b50'],
    },
  },
  cityCourse('nyc', {
    name: 'New York City — Midtown Manhattan',
    short: 'New York',
    location: 'Manhattan, USA',
    blurb: 'Down Fifth Avenue past St Patrick’s to the Library, through the neon canyon of Times Square, round Columbus Circle and back along Central Park South.',
    stands: [],
    // team tents + transporters on the plaza east of 5th Ave between 58th and 59th
    paddock: { from: -150, to: -50, side: 'L', offset: 6 },
    landmarks: [],
    theme: {
      time: 'Golden hour',
      skyTop: '#5a83bf', skyHorizon: '#f4c992', fog: '#e9c9a0', fogNear: 220, fogFar: 1900,
      // low sun straight down the cross streets (a nod to "Manhattanhenge")
      sunDir: [-0.8, 0.36, -0.45], sunColor: '#ffd49a', sunIntensity: 2.5,
      hemiSky: '#cdd9ee', hemiGround: '#7a6550', hemiIntensity: 1.25,
      clouds: 12, cloudColor: '#ffe3c4',
      asphalt: ['#4a4c51', '#4f5156', '#46484d'],
      sidewalk: ['#aeaca6', '#b6b3ad', '#a7a5a0'],
      ground: ['#86878a', '#8c8d90', '#818285'], // pavement / plazas between the streets
      grass: ['#5b8f3a', '#64983f', '#557f35'],
      night: false,
    },
  }),
  cityCourse('tokyo', {
    name: 'Tokyo — Aoyama & Akasaka (Route 246)',
    short: 'Tokyo',
    location: 'Minato & Shinjuku, Japan',
    blurb: 'Night on Route 246: down Aoyama-dori to Akasaka-mitsuke, under the Shuto expressway and up the moat past Benkei-bashi to Yotsuya, then back along the Akasaka Palace grounds through Shinanomachi.',
    stands: [],
    landmarks: [],
    theme: {
      time: 'Night',
      skyTop: '#03071a', skyHorizon: '#1c2850', fog: '#151d3a', fogNear: 140, fogFar: 1500,
      // the "sun" is the moon at night: a pale disc and a weak cool key light
      sunDir: [0.35, 0.5, 0.65], sunColor: '#9fb3e6', sunIntensity: 0.55, moon: true,
      hemiSky: '#45568a', hemiGround: '#2e2620', hemiIntensity: 0.75,
      clouds: 0,
      asphalt: ['#2f3136', '#33353a', '#2c2e33'],
      sidewalk: ['#6a6b6f', '#717276', '#646569'],
      ground: ['#4a4b4f', '#4f5054', '#46474b'],
      grass: ['#2d4a28', '#33522c', '#294424'],
      night: true,
    },
  }),
  cityCourse('madrid', {
    name: 'Madrid — Gran Vía & Madrid de los Austrias',
    short: 'Madrid',
    location: 'Madrid, Spain',
    blurb: 'Down the Gran Vía from Plaza de España to the Metrópolis dome, round Cibeles and Neptuno, past the Congreso lions into the Puerta del Sol, along narrow Calle Mayor and back up Bailén beneath the Royal Palace.',
    stands: [],
    // team tents + transporters in the Plaza de España gardens, beside the run to the start
    paddock: { from: -470, to: -390, side: 'L', offset: 7 },
    landmarks: [],
    theme: {
      time: 'Late afternoon',
      skyTop: '#4d7ec6', skyHorizon: '#f7c88c', fog: '#eec79c', fogNear: 230, fogFar: 1900,
      // low sun in the west-south-west: Gran Vía's facades glow, the Prado sits in shade
      sunDir: [-0.8, 0.4, 0.3], sunColor: '#ffcc8a', sunIntensity: 2.6,
      hemiSky: '#cfdaee', hemiGround: '#8a6a4c', hemiIntensity: 1.2,
      clouds: 10, cloudColor: '#ffe0bd',
      asphalt: ['#4d4c4f', '#525154', '#49484b'],
      sidewalk: ['#c2b7a4', '#cabfac', '#bab09d'],
      ground: ['#b0a690', '#b7ad97', '#a99f8a'], // granite paving between the streets
      grass: ['#62903c', '#6b9a42', '#5a8536'],
      treeLod: 45, // OSM maps nearly every street tree: merged crowns beyond 45 m
      night: false,
    },
  }),
];

export function trackById(id) {
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}
