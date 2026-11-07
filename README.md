# VOXEL GT

A voxel touring-car racing game in the browser: five road cars based on real
models, three circuits built from real track centrelines, a semi-simulation
handling model, AI opponents, time trial with ghosts, and a GT-style garage.


## Run it

```bash
npm install
npm run dev          # http://localhost:8080
```

Or build a single self-contained file that runs straight from disk (no server):

```bash
npm run build        # -> dist/voxel-gt.html (three.js bundled in)
```

## Controls

| Action | Keyboard | Gamepad (standard) |
| --- | --- | --- |
| Throttle / brake | ↑ / ↓ (or W / S) | RT / LT (or A / X) |
| Steer | ← / → (or A / D) | Left stick |
| Handbrake | Space | B |
| Shift up / down (manual) | E / Q | RB / LB |
| Change camera | C | Y |
| Look back | B (hold) | R3 |
| Reset car to track | R | View / Back |
| Toggle driving line | L | — |
| Pause | Esc / P | Start |
| Mute | M | — |

Menus work with arrows + Enter/Esc, the d-pad + A/B, or the mouse. Touch
devices get on-screen pedals and steering.

## The garage

| Car | Layout | Power | Weight | Character |
| --- | --- | --- | --- | --- |
| Mazda MX-5 Miata (NA) '89 | FR | 116 PS | 1030 kg | Light, balanced, slow on straights |
| Nissan Skyline GT-R V-spec (R34) '99 | 4WD | 330 PS | 1620 kg | Turbo lag, huge traction |
| Honda NSX Type R (NA1) '92 | MR | 280 PS | 1305 kg | Sharp turn-in, 8,000 rpm |
| Porsche 911 Carrera RS (964) '92 | RR | 260 PS | 1305 kg | Rear-engined; brakes late |
| Ferrari F40 '87 | MR | 478 PS | 1250 kg | Twin-turbo, the fastest car here |

Each car has its own torque curve, gear ratios, final drive, weight
distribution, CG height, drag/downforce, tyre balance and (for the GT-R and
F40) turbo lag. Measured in the sim: MX-5 0–100 km/h in 9.1 s, GT-R 4.9 s,
F40 top speed 326 km/h.

## The circuits

* **Monza** (5.76 km): flat-out park circuit with chicanes, Lesmos and the Parabolica, plus a nod to the old banking.
* **Suzuka** (5.80 km): figure of eight. The back straight crosses the lap on a real bridge over the Degner exit. Ferris wheel included.
* **Spa-Francorchamps** (6.95 km): Eau Rouge/Raidillon, Kemmel, Pouhon, Blanchimont, with ~75 m of elevation through an overcast Ardennes forest.

Layouts come from real centrelines. Elevation profiles, run-off, kerbs, walls,
grandstands, pits, gantry, brake boards and scenery are generated from that
geometry.

## How it works

```
src/
  trackData.generated.js  circuit centrelines (from tools/gen-tracks.mjs)
  tracks.js               circuit metadata: width, elevation, stands, theme
  trackCore.js            spline, elevation, auto-bridges, walls/run-off,
                          racing line optimiser, speed profiles, locate()
  physics.js              vehicle dynamics (see below)
  sim.js                  surfaces, wall + car-car collisions
  ai.js                   pure-pursuit AI with brake-point planning, overtaking
  cars.js                 car specs + voxel model descriptions
  carModel.js             procedural voxeliser (8 cm voxels, AO) + wheels
  voxel.js                culled-face mesher with ambient occlusion, BoxBuilder
  trackScene.js           road ribbon, terrain LOD, trees, stands, sky, ...
  game.js                 race session: grid, countdown, laps, ghost, cameras
  hud.js / ui.js          HUD and menus
  audio.js                synthesised engine, turbo, tyres, wind (Web Audio)
  input.js                keyboard / gamepad / touch
  main.js                 bootstrap + main loop
```

**Physics:** a two-axle model at 120 Hz with Pacejka-style lateral tyre
curves, friction-ellipse combined slip, longitudinal load transfer, dynamic
brake distribution (EBD) and ABS. It also models engine torque curves with
clutch slip at launch, an auto/manual gearbox, turbo boost lag, aero drag and
downforce, rolling resistance per surface (asphalt, kerb, grass, gravel), and
gravity on slopes. TCS and ASM (stability control) can be switched off.

**AI:** the racing line is optimised once per track (multi-resolution elastic
band, minimising curvature within the track limits). Each car gets its own
friction-circle speed profile. Opponents pick their pace from the player's car
and the difficulty, so races stay close in a mixed field. There is also a
one-make race option.

## Tests

```bash
npm test                    # every car laps every track under AI; 5-car races
node tests/accel.mjs        # 0-100, 0-200, 1/4 mile, top speed, braking
node tests/skidpad.mjs      # steady-state lateral grip vs theory
node tests/handling.mjs     # keyboard full-lock flicks: no spins with aids on
npm run build && node tests/browser.mjs   # headless menus/race/cameras + screenshots
npm run build && node tests/flow.mjs      # race to results; time trial ghost save
```

The browser tests use `playwright-core` with a cached Chromium
(`~/.cache/ms-playwright/chromium-*/chrome-linux/chrome`, or set `CHROME=`).

## Credits

* Circuit centrelines: [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits),
  MIT License, © Tomislav Bacinger (see `tools/data/LICENSE-f1-circuits.md`).
* Rendering: [three.js](https://threejs.org) (MIT).
* Car makes, model names and circuit names belong to their respective owners
  and are used only to identify the real cars and places these are based on.
  All sponsor boards are fictional.
