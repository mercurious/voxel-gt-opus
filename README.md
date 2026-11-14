# VOXEL GT

A voxel touring-car racing game in the browser: eight road cars based on real
models, three circuits built from real track centrelines, three street courses
(New York, Tokyo by night, Madrid) voxelised from real OpenStreetMap city data,
a semi-simulation handling model, AI opponents, time trial with ghosts, and a
GT-style garage.


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
| MINI Cooper S John Cooper Works (R53) '02 | FF | 200 PS | 1215 kg | Supercharged (whine, no lag), darty, lift-off tuck-in |
| Mazda3 Turbo Hatchback (BP) '20 | 4WD | 253 PS | 1615 kg | Heavy and composed; 434 Nm, front-biased AWD, 6-speed auto, 216 km/h limiter |
| SEAT Ibiza Cupra (6L) '04 | FF | 180 PS | 1252 kg | Turbo lag then a torque wave; torque steer and power understeer |

Each car has its own torque curve, gear ratios, final drive, weight
distribution, CG height, drag/downforce, tyre balance and (for the GT-R, F40,
Mazda3 and Cupra) turbo lag. Measured in the sim (`node tests/accel.mjs`):

| Car | 0–100 km/h | 1/4 mile | Top speed |
| --- | --- | --- | --- |
| MX-5 | 8.7 s | 16.4 s | 196 km/h |
| GT-R | 4.6 s | 12.9 s | 273 km/h |
| NSX-R | 5.1 s | 13.3 s | 257 km/h |
| 911 RS | 5.2 s | 13.4 s | 268 km/h |
| F40 | 4.5 s | 12.1 s | 326 km/h |
| MINI JCW | 6.8 s | 14.9 s | 227 km/h |
| Mazda3 Turbo | 5.9 s | 14.1 s | 215 km/h (limited) |
| Ibiza Cupra | 7.2 s | 15.6 s | 229 km/h |

Paints with a contrast roof (the MINI's white or black roof, bonnet stripes)
are set per paint in `cars.js`.

## The circuits

* **Monza** (5.76 km): flat-out park circuit with chicanes, Lesmos and the Parabolica, plus a nod to the old banking.
* **Suzuka** (5.80 km): figure of eight. The back straight crosses the lap on a real bridge over the Degner exit. Ferris wheel included.
* **Spa-Francorchamps** (6.95 km): Eau Rouge/Raidillon, Kemmel, Pouhon, Blanchimont, with ~75 m of elevation through an overcast Ardennes forest.

Layouts come from real centrelines. Elevation profiles, run-off, kerbs, walls,
grandstands, pits, gantry, brake boards and scenery are generated from that
geometry.

## The city courses

Street circuits in the Gran Turismo tradition, routed over the real street
network and voxelised from OpenStreetMap data:

* **New York — Midtown Manhattan** (4.45 km, golden hour): start on Fifth
  Avenue at 58th St, flat out down Fifth past St Patrick's and Rockefeller
  Center, the *Library Corner* right onto 42nd St past the Public Library
  lions and Bryant Park, right into *Times Square* up Seventh Avenue, left at
  *Carnegie Hall* onto 57th, right up *Broadway*, clockwise round *Columbus
  Circle*, then the long blast along *Central Park South* and a right at
  *Grand Army Plaza* back onto Fifth. Real street widths and real elevation
  (~10 m of rise and fall), concrete barriers with catch fences, escape roads
  down the side streets at the 90° corners, about 3,900 real building
  footprints with window facades, ground-floor shopfronts and rooftop water
  towers, plus hand-built landmarks (Library + lions, St Patrick's, Plaza
  Hotel, Pulitzer Fountain, Columbus Circle, Empire State and Chrysler on the
  skyline) and animated Times Square billboards for fictional brands.

* **Tokyo — Aoyama & Akasaka, Route 246** (5.27 km, night): in the spirit of
  GT's *Tokyo R246*. Down Aoyama-dori (Route 246) from Aoyama-itchome, a
  ~15 m drop to *Akasaka-mitsuke* under the elevated Shuto expressway, left up
  past *Benkei-bashi* and the Hotel New Otani along the outer moat to
  *Yotsuya*, west on Shinjuku-dori to *Yotsuya 3-chome*, then south down
  Gaien-higashi-dori beside the Akasaka Palace grounds through *Shinanomachi*
  and *Gondawara* back to *Aoyama-itchome*. Night lighting: star field and
  moon, lit windows (warm/cool/dark), glowing shopfronts, street-light pools,
  car headlights (the focus car casts real spotlights), vertical neon signs,
  konbini, vending machines, footbridges, a floodlit Akasaka Palace and an
  orange Tokyo Tower on the skyline, all with fictional names.

* **Madrid — Gran Vía & Madrid de los Austrias** (4.86 km, late afternoon):
  in the spirit of GT5's Madrid. Start on the *Gran Vía* below Plaza de España,
  climb past the theatres to *Callao* (the Edificio Carrión's rooftop neon) and
  the Telefónica tower, down through *Red de San Luis* to the *Metrópolis* dome
  and its Winged Victory, along Alcalá and right round the *Cibeles* fountain,
  south down the plane trees of the Paseo del Prado, round the top of
  *Neptuno*, west up Carrera de San Jerónimo past the Congreso lions (*Las
  Cortes*), through the *Puerta del Sol* (Casa de Correos clock, Kilómetro Cero,
  the Bear and the Strawberry Tree, a fictional rooftop neon bottle), along
  narrow *Calle Mayor* past the Plaza Mayor arch, right at *Almudena* (the
  cathedral dome) and north up Bailén beneath the *Palacio Real* and the kings
  of Plaza de Oriente, raced at street level over the Bailén tunnel, to *Plaza
  de España* (the Cervantes monument) and back onto the Gran Vía. Elevation
  follows spot heights (~25 m: 625 m at Plaza de España, 650 m at Red de San
  Luis, Sol and Calle Mayor, 630 m at Neptuno; grades ≤ 5.5%), escape roads down
  Alcalá, Calle Mayor and Calle de los Reyes, about 4,000 OSM buildings and
  parts in cream, ochre and almagre plaster with wrought-iron balconies, slate
  mansards and terracotta roofs, Fernandino lamps, Metro rombos, Correos post
  boxes, green kiosks, azulejo street-name tiles and white taxis with the red
  door stripe. Every brand and show name is fictional.

Elevated expressways come straight from OSM (`motorway` + `bridge`/`layer`),
so any city gets its viaducts. Streets the generator should stick to can be
named in `prefer` (OSM names, e.g. 青山通り), which keeps the router off
parallel side streets and one-way carriageway pairs. Madrid adds a few more
per-city switches: `surfaceWays` (tunnel ways raced at street level, for
Bailén under the pedestrianised Plaza de Oriente), `noCentre` (one-way pairs
raced on one carriageway, e.g. the Prado boulevard), `removeJogs` (drop short
back-and-forth jogs left by partial carriageway centring), `escapes`
(`[lat, lon, len]` escape roads straight on at corners the auto-detection
misses) and `elevation.anchors` (`[lat, lon, metres]` spot heights: the course
profile is interpolated through them, smoothed and capped at
`elevation.maxGrade`, with the DEM shifted onto it; for DEMs too noisy to race
on). City modules can also pick facade styles, roofs and per-wall cornices
(`styleFor` / `buildingOpts`; the atlas has plaster-with-balconies, slate
mansard and terracotta rows), and `theme.treeLod` swaps trees beyond that
distance from the course for single-crown ones.

## How it works

```
src/
  trackData.generated.js  circuit centrelines (from tools/gen-tracks.mjs)
  cityData.generated.js   street-course data (from tools/gen-cities.mjs)
  tracks.js               track metadata: width, elevation, stands, theme
  trackCore.js            spline, elevation, auto-bridges, walls/run-off,
                          street corridors + escape roads, racing line
                          optimiser, speed profiles, locate()
  physics.js              vehicle dynamics (see below)
  sim.js                  surfaces, wall + escape-road + car-car collisions
  ai.js                   pure-pursuit AI with brake-point planning, overtaking
  cars.js                 car specs + voxel model descriptions
  carModel.js             procedural voxeliser (8 cm voxels, AO) + wheels
  voxel.js                culled-face mesher with ambient occlusion, BoxBuilder
  sceneCommon.js          sky, sun, gantry, grid, brake boards, driving line
  trackScene.js           circuits: road ribbon, terrain LOD, trees, stands...
  cityScene.js            city courses: ground on the real DEM, streets,
                          parks, course road + markings, kerbs, barriers,
                          fences, banners, buildings, street furniture
  city/cityData.js        decoder for the packed city data
  city/buildings.js       footprint extrusion + window-facade atlas shader
  city/props.js           street furniture (lamps, signals, cabs, subway...)
  city/nyc.js             New York landmarks, billboards, water towers
  city/tokyo.js           Tokyo neon signs, konbini, vending machines,
                          footbridges, Akasaka Palace, Tokyo Tower
  city/madrid.js          Madrid landmarks: Metrópolis, Cibeles, Neptuno,
                          Congreso, Sol, Plaza Mayor, Almudena, Palacio Real,
                          Cervantes, rooftop neon, theatre signs, azulejos
  city/index.js           per-city module registry (CITY_MODULES by city id)
  game.js                 race session: grid, countdown, laps, ghost, cameras
  hud.js / ui.js          HUD and menus
  audio.js                synthesised engine, turbo, tyres, wind (Web Audio)
  input.js                keyboard / gamepad / touch
  main.js                 bootstrap + main loop
  storage.js              guarded localStorage: settings, best laps, ghosts
  util.js                 small math / noise helpers shared by sim and render
```

**City pipeline (offline, reproducible):**

```bash
npm run fetch:city nyc   # Overpass + opentopodata -> tools/data/cities/nyc.json (committed)
npm run gen:cities       # -> src/cityData.generated.js (no network)
```

`tools/city-config.mjs` holds each city's bbox, route waypoints, named corners
and defaults. `fetch-city` makes one Overpass query per city (roads, buildings
and building parts, parks, water, trees, subway entrances, hydrants, mailboxes,
named POIs, plus tall buildings from a wider skyline box) and samples a
bare-earth DEM grid. `gen-cities` routes the waypoints over the OSM road graph
(Dijkstra), centres dual carriageways, simplifies, fillets the corners with a
radius taken from the street width, resamples to 4 m with index 0 on the
start line, and records per-point street width (OSM `width`/`lanes`) and
elevation. It also emits the course's street *corridor* (the real street
rectangles, so barriers sit on the kerb along straights and open up to the
full intersection box in 90° corners), escape roads where the approach
street carries on past a corner, intersections for crosswalks and signals,
and packs nearby buildings (within 220 m, outlines replaced by their
`building:part`s), streets, parks, water, trees and POIs as base64 Int16
streams in 0.5 m units (~255 KB for New York).

**Physics:** a two-axle model at 120 Hz with Pacejka-style lateral tyre
curves, friction-ellipse combined slip, longitudinal load transfer, dynamic
brake distribution (EBD) and ABS. It also models engine torque curves with
clutch slip at launch, an auto/manual gearbox (torque-converter automatics
multiply torque at launch and keep pulling through shifts), turbo boost lag,
speed governors, aero drag and downforce, rolling resistance per surface
(asphalt, kerb, grass, gravel), and gravity on slopes. Front-drive cars carry
their drive through the steered, unloading front axle: power understeer,
torque steer and lift-off rotation fall out of that; front-biased AWD sends
drive rearward as the fronts run out of grip. TCS (steering-aware on a driven
front axle) and ASM (stability control) can be switched off.

**AI:** the racing line is optimised once per track (multi-resolution elastic
band, minimising curvature within the track limits). Each car gets its own
friction-circle speed profile. Opponents pick their pace from the player's car
and the difficulty, so races stay close in a mixed field. There is also a
one-make race option.

## Tests

```bash
npm test                    # every car laps every track under AI; full-garage races
node tests/accel.mjs        # 0-100, 0-200, 1/4 mile, top speed, braking
node tests/skidpad.mjs      # steady-state lateral grip vs theory
node tests/handling.mjs     # keyboard full-lock flicks: no spins with aids on
npm run build && node tests/browser.mjs   # headless menus/race/cameras + screenshots
npm run build && node tests/flow.mjs      # race to results; time trial ghost save
npm run build && node tests/views.mjs tests/out/nyc nyc   # scenic camera views of a course
node tests/carshots.mjs [id,id]           # close-up car renders (3/4 front/rear, side, night) -> tests/out/cars
```

The browser tests use `playwright-core` with a cached Chromium
(`~/.cache/ms-playwright/chromium-*/chrome-linux/chrome`, or set `CHROME=`).

## Credits

* Circuit centrelines: [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits),
  MIT License, © Tomislav Bacinger (see `tools/data/LICENSE-f1-circuits.md`).
* City streets, buildings, parks and street furniture positions: map data
  © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors,
  available under the Open Database License (ODbL 1.0). The extracts in
  `tools/data/cities/` and the derived `src/cityData.generated.js` are
  ODbL-licensed databases.
* Elevation: [OpenTopoData](https://www.opentopodata.org) (USGS NED 10 m for New York,
  SRTM 30 m for Tokyo, despiked with a median filter; EU-DEM 25 m for Madrid,
  © European Union, Copernicus Land Monitoring Service).
* Rendering: [three.js](https://threejs.org) (MIT).
* Car makes, model names, circuit, street and landmark names belong to their
  respective owners and are used only to identify the real cars and places
  these are based on. All sponsor boards and billboard brands are fictional.
