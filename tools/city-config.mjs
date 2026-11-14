// Per-city configuration shared by tools/fetch-city.mjs and tools/gen-cities.mjs.
//
// bbox:      [south, west, north, east] around the course. Everything the scene
//            draws (roads, buildings, parks, props) is fetched from here.
// skyline:   wider bbox; only tall buildings (>= skylineMinH m) come from it.
// elevation: opentopodata dataset (bare-earth DEM preferred) sampled on a grid.
// route:     ordered [lat, lon] waypoints in race direction; the generator
//            routes between them on the real OSM road graph. waypoint 0 is the
//            start line. `via` waypoints only steer the path finder.
// roadTypes: OSM highway values the course may use.
// corners:   [lat, lon, name] named corners shown in the menus/HUD.
// defaults:  fallbacks when OSM lacks tags (lane width, kerbside parking width,
//            sidewalk, storey height, course half-width clamp, building height).
export const CITIES = {
  nyc: {
    name: 'New York City (Midtown)',
    bbox: [40.7502, -73.9905, 40.7712, -73.9690],
    skyline: [40.7380, -74.0060, 40.7860, -73.9530],
    skylineMinH: 110,
    elevation: { dataset: 'ned10m', step: 60 },
    route: [
      [40.76290, -73.97380], // 5th Ave @ 58th (start line, southbound)
      [40.75870, -73.97730], // 5th Ave @ 50th (St Patrick's)
      [40.75348, -73.98088], // 5th Ave @ 42nd -> right
      [40.75464, -73.98363], // W 42nd @ 6th Ave (Bryant Park)
      [40.75604, -73.98695], // W 42nd @ 7th Ave -> right
      [40.75796, -73.98553], // 7th Ave @ 45th (Times Square)
      [40.76110, -73.98325], // 7th Ave @ 50th
      [40.76360, -73.98143], // 7th Ave @ 55th
      [40.76480, -73.98058], // 7th Ave @ 57th -> left
      [40.76570, -73.98200], // W 57th @ Broadway -> right
      [40.76669, -73.98182], // Broadway @ 58th
      [40.76768, -73.98188], // Columbus Circle, south
      [40.76810, -73.98239], // Columbus Circle, west
      [40.76840, -73.98168], // Columbus Circle, north
      [40.76810, -73.98140], // Columbus Circle, east
      [40.76760, -73.98079], // Central Park South (west end)
      [40.76568, -73.97624], // Central Park South @ 6th Ave
      [40.76428, -73.97303], // 5th Ave @ 59th (Grand Army Plaza) -> right
    ],
    corners: [
      [40.75348, -73.98088, 'Library Corner'],
      [40.75464, -73.98363, 'Bryant Park'],
      [40.75604, -73.98695, 'Times Square'],
      [40.75900, -73.98480, 'Duffy Square'],
      [40.76480, -73.98058, 'Carnegie Hall'],
      [40.76570, -73.98200, 'Broadway'],
      [40.76810, -73.98239, 'Columbus Circle'],
      [40.76690, -73.97920, 'Central Park South'],
      [40.76428, -73.97303, 'Grand Army Plaza'],
      [40.75870, -73.97730, "St Patrick's"],
    ],
    roadTypes: ['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'trunk', 'primary_link', 'secondary_link'],
    defaults: { laneW: 3.3, parking: 4, sidewalk: 4.5, storey: 3.6, minHalfW: 6.5, maxHalfW: 8.5, buildingH: 22 },
  },
  tokyo: {
    name: 'Tokyo (Aoyama / Akasaka, Route 246)',
    bbox: [35.6665, 139.7140, 35.6930, 139.7425],
    skyline: [35.6480, 139.6950, 35.7100, 139.7650],
    skylineMinH: 110,
    elevation: { dataset: 'srtm30m', step: 60, smooth: 2 },
    route: [
      [35.67300, 139.72700], // Aoyama-dori just east of Aoyama-itchome (start line, eastbound)
      [35.67480, 139.73150], // Aoyama-dori / Takahashi Korekiyo park
      [35.67782, 139.73591], // Akasaka-mitsuke (at grade, before the 246 overpass) -> left
      [35.67950, 139.73590], // Benkei-bashi / Hotel New Otani
      [35.68350, 139.73300], // Sotobori-dori, Kioicho
      [35.68581, 139.72953], // Yotsuya: moat road meets Shinjuku-dori -> left
      [35.68780, 139.72480], // Shinjuku-dori, Yotsuya 2-chome
      [35.68850, 139.72110], // Yotsuya 3-chome -> left
      [35.68420, 139.72080], // Gaien-higashi-dori by the Geihinkan grounds
      [35.68020, 139.72040], // Shinanomachi
      [35.67600, 139.72190], // Gaien-higashi-dori, Gondawara
      [35.67250, 139.72400], // Aoyama-itchome -> left
    ],
    corners: [
      [35.67782, 139.73591, 'Akasaka-mitsuke'],
      [35.67950, 139.73590, 'Benkei-bashi'],
      [35.68581, 139.72953, 'Yotsuya'],
      [35.68850, 139.72110, 'Yotsuya 3-chome'],
      [35.68020, 139.72040, 'Shinanomachi'],
      [35.67600, 139.72190, 'Gondawara'],
      [35.67250, 139.72400, 'Aoyama-itchome'],
    ],
    roadTypes: ['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'trunk_link', 'primary_link'],
    // stay on the real course streets (names as tagged in OSM); others cost 4x
    prefer: ['青山通り', '国道246号', '外堀通り', '紀尾井町通り', '新宿通り', '外苑東通り'],
    defaults: { laneW: 3.2, parking: 2, sidewalk: 4, storey: 3.4, minHalfW: 6.5, maxHalfW: 9.5, buildingH: 24 },
  },
  madrid: {
    name: 'Madrid (Centro)',
    bbox: [40.4108, -3.7192, 40.4272, -3.6885],
    skyline: [40.4000, -3.7350, 40.4400, -3.6750],
    skylineMinH: 70,
    // the DEMs (SRTM / EU-DEM) carry the rooftops of the Gran Vía canyon and blur the
    // escarpment west of Bailén: race on a profile through known spot heights instead
    elevation: {
      dataset: 'eudem25m', step: 50, smooth: 1, maxGrade: 0.055,
      anchors: [
        [40.42290, -3.71180, 625], // Plaza de España
        [40.42041, -3.70615, 645], // Callao
        [40.41993, -3.70130, 650], // Red de San Luis
        [40.41956, -3.69272, 640], // Cibeles
        [40.41550, -3.69422, 630], // Neptuno
        [40.41604, -3.69692, 640], // Las Cortes
        [40.41672, -3.70331, 650], // Puerta del Sol
        [40.41580, -3.70942, 650], // Calle Mayor
        [40.41506, -3.71350, 650], // Almudena
        [40.41850, -3.71305, 645], // Bailén / Palacio Real
      ],
    },
    route: [
      [40.42172, -3.70821], // Gran Vía (start line, eastbound towards Callao)
      [40.42041, -3.70615], // Gran Vía @ Callao
      [40.42007, -3.70236], // Gran Vía @ Telefónica
      [40.41897, -3.69696], // Gran Vía / Alcalá (Metrópolis)
      [40.41904, -3.69535], // Alcalá (Banco de España)
      [40.41951, -3.69328], // Cibeles: north-west, round the fountain
      [40.41956, -3.69271], // Cibeles: north-east
      [40.41859, -3.69311], // Paseo del Prado (east carriageway)
      [40.41697, -3.69345], // Paseo del Prado
      [40.41572, -3.69362], // Neptuno: north-east
      [40.41550, -3.69422], // Neptuno: round the north side of the fountain
      [40.41604, -3.69692], // Carrera de San Jerónimo (Congreso)
      [40.41657, -3.69893], // Carrera de San Jerónimo
      [40.41672, -3.70331], // Puerta del Sol (Casa de Correos)
      [40.41614, -3.70796], // Calle Mayor
      [40.41524, -3.71224], // Calle Mayor (west)
      [40.41506, -3.71350], // Calle Mayor / Bailén
      [40.41606, -3.71335], // Calle de Bailén (Almudena), south end of the Plaza de Oriente section
      [40.42107, -3.71277], // Calle de Bailén (north)
      [40.42239, -3.71274], // Plaza de España
      [40.42330, -3.71069], // Plaza de España -> Gran Vía
    ],
    // Bailén runs in a tunnel under the pedestrianised Plaza de Oriente: race its
    // alignment at street level, past the Palacio Real
    surfaceWays: [4319470, 4319471, 26673417, 854461438, 43410332, 1008751312],
    // the Prado/Recoletos carriageways are a boulevard apart: race the east one
    noCentre: ['Paseo del Prado', 'Paseo de Recoletos', 'Plaza de la Cibeles'],
    removeJogs: true,
    // escape roads straight on at the big corners: Alcalá towards the Puerta de
    // Alcalá, Calle Mayor past Bailén, Calle de los Reyes off Plaza de España
    escapes: [[40.41956, -3.69272, 55], [40.41506, -3.71347, 50], [40.42339, -3.71086, 40]],
    corners: [
      [40.42041, -3.70615, 'Callao'],
      [40.41993, -3.70130, 'Red de San Luis'],
      [40.41897, -3.69696, 'Metrópolis'],
      [40.41956, -3.69271, 'Cibeles'],
      [40.41550, -3.69422, 'Neptuno'],
      [40.41604, -3.69692, 'Las Cortes'],
      [40.41662, -3.70042, 'Puerta del Sol'],
      [40.41580, -3.70942, 'Calle Mayor'],
      [40.41506, -3.71350, 'Almudena'],
      [40.41850, -3.71305, 'Palacio Real'],
      [40.42239, -3.71274, 'Plaza de España'],
      [40.42330, -3.71069, 'Edificio España'],
    ],
    roadTypes: ['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'trunk', 'primary_link', 'secondary_link', 'pedestrian', 'living_street', 'service'],
    defaults: { laneW: 3.2, parking: 2.5, sidewalk: 4, storey: 3.5, minHalfW: 6, maxHalfW: 9, buildingH: 20 },
  },
};
