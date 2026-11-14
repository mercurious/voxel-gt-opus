// Per-city scenery modules (landmarks, signature props, billboards), looked up
// by track.def.city. Each module: { id, prepare?(ctx), build?(ctx), styleFor?(b, k),
// buildingOpts?(b, k, style, { hi, near }) } — see src/cityScene.js for the ctx it receives.
import nyc from './nyc.js';
import tokyo from './tokyo.js';
import madrid from './madrid.js';

export const CITY_MODULES = { nyc, tokyo, madrid };
