// VOXEL GT bootstrap: renderer, scenes, menus, race lifecycle and main loop.
import * as THREE from 'three';
import { TRACKS, trackById } from './tracks.js';
import { CARS, carById } from './cars.js';
import { buildTrack } from './trackCore.js';
import { buildTrackScene } from './trackScene.js';
import { buildCityScene } from './cityScene.js';
import { buildCarObject } from './carModel.js';
import { Race } from './game.js';
import { AIDriver } from './ai.js';
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { Hud } from './hud.js';
import { UI } from './ui.js';
import { BoxBuilder } from './voxel.js';
import { loadSettings, saveSettings } from './storage.js';

const settings = loadSettings();
const canvas = document.getElementById('gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  document.getElementById('fatal').classList.remove('hidden');
  throw e;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const camera = new THREE.PerspectiveCamera(60, 1, 0.25, 14000);

function applyQuality() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.quality === 'high' ? 1.75 : 1));
}
function resize() {
  applyQuality();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const input = new Input();
const audio = new AudioSys();
audio.setVolume(settings.volume);
const unlockAudio = () => audio.init();
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);
input.onAnyInput = () => { if (!audio.ready) audio.init(); };
const hud = new Hud();
input.bindTouch(document.getElementById('touch'));
if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

// ---------------------------------------------------------------- tracks
const cores = new Map();
function getTrackCore(id) {
  if (!cores.has(id)) cores.set(id, buildTrack(trackById(id)));
  return cores.get(id);
}

const world = new THREE.Scene();
let worldTrack = null; // { id, quality, core, scene }
function loadWorld(id) {
  if (worldTrack && worldTrack.id === id && worldTrack.quality === settings.quality) return worldTrack;
  if (worldTrack) { world.remove(worldTrack.scene.group); worldTrack.scene.dispose(); }
  const core = getTrackCore(id);
  const t0 = performance.now();
  const scene = (core.def.street ? buildCityScene : buildTrackScene)(core, { quality: settings.quality });
  console.info(`[voxel-gt] built ${id} in ${(performance.now() - t0).toFixed(0)} ms`);
  world.add(scene.group);
  world.fog = scene.fog;
  world.background = scene.background;
  worldTrack = { id, quality: settings.quality, core, scene };
  return worldTrack;
}

// ---------------------------------------------------------------- showroom
const showroom = new THREE.Scene();
let showCar = null, showKey = '';
{
  showroom.background = new THREE.Color('#0b1020');
  showroom.fog = new THREE.Fog('#0b1020', 18, 46);
  const hemi = new THREE.HemisphereLight('#cfe0ff', '#1a1e2a', 1.4);
  const key = new THREE.DirectionalLight('#ffffff', 2.6);
  key.position.set(5, 9, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
  const rim = new THREE.DirectionalLight('#ff9a3c', 1.4);
  rim.position.set(-6, 3, -6);
  showroom.add(hemi, key, rim);
  // voxel turntable + floor tiles
  const b = new BoxBuilder();
  for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) {
    const r = Math.hypot(x, z);
    if (r > 14) continue;
    const plate = r < 4.2;
    const c = plate ? ((x + z) & 1 ? '#2a3146' : '#262c40') : ((x + z) & 1 ? '#141a2b' : '#111626');
    b.box(x - 0.5, plate ? -0.2 : -0.35, z - 0.5, x + 0.5, plate ? 0 : -0.15, z + 0.5, c, 0, 0, 0, 0, { flat: true });
  }
  for (let k = 0; k < 96; k++) {
    const a = (k / 96) * Math.PI * 2;
    b.box(-0.1, -0.2, -0.06, 0.1, 0.01, 0.06, k % 3 ? '#9a5200' : '#ff8a00', -a, Math.cos(a) * 4.25, 0, Math.sin(a) * 4.25, { flat: true });
  }
  const floor = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  floor.receiveShadow = true;
  showroom.add(floor);
}
function previewCar(sel) {
  const spec = carById(sel.car);
  const paint = spec.paints[sel.paint % spec.paints.length].hex;
  const key = spec.id + paint;
  if (key === showKey) return;
  const rot = showCar ? showCar.root.rotation.y : -0.6;
  if (showCar) { showroom.remove(showCar.root); showCar.dispose(); }
  showCar = buildCarObject(spec, paint);
  showCar.root.rotation.y = rot;
  showCar.setBrake(false);
  showroom.add(showCar.root);
  showKey = key;
}

// ---------------------------------------------------------------- app state
let app = 'menu'; // menu | loading | race | paused | results
let race = null;
let lastConfig = null;
let showroomOn = false;

function disposeRace() {
  if (race) { race.dispose(); race = null; }
}

function startAttract() {
  disposeRace();
  const id = worldTrack ? worldTrack.id : TRACKS[Math.floor(Math.random() * TRACKS.length)].id;
  const wt = loadWorld(id);
  race = new Race({ scene: world, camera, track: wt.core, trackScene: wt.scene, audio, settings, mode: 'attract' });
  // skip the standing start so the menu backdrop is already racing
  for (let k = 0; k < 60 * 25; k++) race.update(1 / 60, null);
}

const loadingEl = document.getElementById('loading');
function startRace(sel) {
  lastConfig = { ...sel };
  app = 'loading';
  ui.hide();
  hud.show(false);
  const t = trackById(sel.track);
  loadingEl.querySelector('.lt').textContent = t.name;
  loadingEl.querySelector('.ls').textContent = sel.mode === 'race' ? `Arcade Race · ${settings.laps} lap${settings.laps > 1 ? 's' : ''}` : 'Time Trial';
  loadingEl.classList.remove('hidden');
  setTimeout(() => {
    disposeRace();
    const wt = loadWorld(sel.track);
    const spec = carById(sel.car);
    race = new Race({
      scene: world, camera, track: wt.core, trackScene: wt.scene, audio, settings,
      mode: sel.mode, playerSpec: spec, playerPaint: spec.paints[sel.paint % spec.paints.length].hex,
      laps: settings.laps, difficulty: settings.difficulty, field: settings.field,
    });
    hud.setTrack(wt.core);
    hud.show(true);
    loadingEl.classList.add('hidden');
    app = 'race';
    showroomOn = false;
  }, 40);
}

const handlers = {
  settings: () => settings,
  settingsChanged(key) {
    saveSettings(settings);
    if (key === 'volume') audio.setVolume(settings.volume);
    if (key === 'quality') resize();
    if (key === 'line' && race && race.mode !== 'attract') race.trackScene.setDrivingLine(settings.line ? race.playerProfile : null);
    if (key === 'camera' && race && race.mode !== 'attract') race.camMode = settings.camera;
  },
  click: () => audio.click(),
  screenChanged(name, sel) {
    showroomOn = name === 'car';
    if (showroomOn && sel) previewCar(sel);
  },
  preview: (sel) => previewCar(sel),
  start: (sel) => startRace(sel),
  resume() {
    ui.hide();
    app = 'race';
    hud.show(true);
    audio.ctx?.resume();
  },
  restart() {
    audio.ctx?.resume();
    startRace(lastConfig);
  },
  quit() {
    audio.ctx?.resume();
    hud.show(false);
    app = 'menu';
    startAttract();
    ui.show('main');
  },
  change() {
    audio.ctx?.resume();
    hud.show(false);
    app = 'menu';
    startAttract();
    ui.sel.mode = lastConfig.mode;
    ui.show('car');
  },
};
const ui = new UI(handlers, getTrackCore);

// ---------------------------------------------------------------- loop
let last = performance.now();
let fpsAcc = 0, fpsN = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const inp = input.poll(dt);
  if (inp.events.has('mute')) audio.toggleMute();

  if (app === 'race') {
    if (inp.events.has('pause')) {
      app = 'paused';
      ui.show('pause');
      audio.ctx?.suspend();
    } else {
      race.update(dt, inp);
      hud.update(race.hud(), settings);
      if (race.state === 'results' || (race.mode === 'timetrial' && false)) {
        app = 'results';
        hud.show(false);
        ui.show('results', race.results);
      }
    }
    renderer.render(world, camera);
  } else if (app === 'paused') {
    ui.handle(inp.events);
    renderer.render(world, camera);
  } else if (app === 'results') {
    ui.handle(inp.events);
    race.update(dt, null);
    renderer.render(world, camera);
  } else if (app === 'menu') {
    ui.handle(inp.events);
    if (showroomOn && showCar) {
      showCar.root.rotation.y += dt * 0.35;
      camera.position.set(0, 2.6, 12.5);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0.45, 0);
      camera.fov = 32;
      camera.updateProjectionMatrix();
      renderer.render(showroom, camera);
    } else if (race) {
      race.update(dt, null);
      renderer.render(world, camera);
    }
  } else {
    if (race) renderer.render(world, camera);
  }

  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1) { window.__fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
}

// boot: build an attract race behind the title screen
loadingEl.querySelector('.lt').textContent = 'VOXEL GT';
loadingEl.querySelector('.ls').textContent = 'Laying the blocks…';
setTimeout(() => {
  startAttract();
  loadingEl.classList.add('hidden');
  ui.show('title');
  requestAnimationFrame((t) => { last = t; frame(t); });
}, 30);

// debug hooks for automated checks
window.__vgt = { get race() { return race; }, get app() { return app; }, ui, input, settings, startRace, renderer, camera, AIDriver };
