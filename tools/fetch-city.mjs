// Downloads the OpenStreetMap extract (and a DEM grid) for one city course and
// stores a compact copy in tools/data/cities/<id>.json, so builds never need
// network access. Data (c) OpenStreetMap contributors, ODbL.
//
// Usage: node tools/fetch-city.mjs <id> [--osm-only|--elev-only]
//
// One Overpass query per city (retried with backoff on 429/5xx/timeouts) and
// small batched requests to opentopodata for elevation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES } from './city-config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [id, flag] = process.argv.slice(2);
const cfg = CITIES[id];
if (!cfg) {
  console.error(`usage: node tools/fetch-city.mjs <${Object.keys(CITIES).join('|')}>`);
  process.exit(1);
}
const outFile = path.join(here, 'data/cities', `${id}.json`);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const UA = 'voxel-gt-city-fetch/1.0 (offline game asset build; one query per city)';
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(makeReq, label, tries = 6) {
  let wait = 10000;
  for (let k = 0; k < tries; k++) {
    try {
      const res = await makeReq(k);
      if (res.ok) return res;
      console.log(`  ${label}: HTTP ${res.status}, retry in ${wait / 1000}s`);
    } catch (e) {
      console.log(`  ${label}: ${e.message}, retry in ${wait / 1000}s`);
    }
    await sleep(wait);
    wait = Math.min(wait * 2, 120000);
  }
  throw new Error(`${label}: giving up after ${tries} tries`);
}

function overpassQuery() {
  const b = cfg.bbox.join(',');
  const s = cfg.skyline.join(',');
  const tall = `(if: number(t["height"]) >= ${cfg.skylineMinH})`;
  return `[out:json][timeout:240][maxsize:536870912];
(
  way["highway"](${b});
  way["building"](${b});
  way["building:part"](${b});
  relation["building"](${b});
  relation["building:part"](${b});
  way["leisure"~"^(park|garden|playground|pitch|dog_park)$"](${b});
  relation["leisure"="park"](${b});
  way["landuse"~"^(grass|recreation_ground|forest|village_green)$"](${b});
  way["natural"~"^(water|wood|scrub|grassland)$"](${b});
  relation["natural"="water"](${b});
  way["place"="square"](${b});
  way["amenity"="fountain"](${b});
  node["natural"="tree"](${b});
  node["railway"="subway_entrance"](${b});
  node["highway"~"^(traffic_signals|street_lamp)$"](${b});
  node["amenity"~"^(fountain|post_box|bench|bicycle_rental)$"](${b});
  node["emergency"="fire_hydrant"](${b});
  node["tourism"~"^(attraction|artwork|museum|hotel)$"](${b});
  node["historic"](${b});
  way["building"]["height"]${tall}(${s});
  way["building:part"]["height"]${tall}(${s});
);
out body geom qt;`;
}

const KEEP_TAGS = /^(highway|name|lanes|width|oneway|junction|area|building|building:part|building:levels|building:min_level|height|min_height|roof:shape|roof:height|roof:colour|roof:levels|building:colour|building:material|leisure|landuse|natural|place|amenity|railway|tourism|historic|emergency|layer|bridge|tunnel|service|footway|sidewalk|parking:lane:both|cycleway|bus:lanes|wikidata|man_made|denotation|type|leaf_type|start_date)$/;
const r6 = (v) => Math.round(v * 1e6) / 1e6;

function compact(osm) {
  const out = [];
  for (const e of osm.elements) {
    const tags = {};
    for (const [k, v] of Object.entries(e.tags || {})) if (KEEP_TAGS.test(k)) tags[k] = v;
    if (e.type === 'node') out.push({ t: 'n', id: e.id, ll: [r6(e.lat), r6(e.lon)], tags });
    // node ids are only needed to build the road graph
    else if (e.type === 'way') out.push({ t: 'w', id: e.id, nodes: tags.highway ? e.nodes : undefined, g: (e.geometry || []).map((p) => (p ? [r6(p.lat), r6(p.lon)] : null)), tags });
    else if (e.type === 'relation') {
      const members = (e.members || []).filter((m) => m.type === 'way' && m.geometry).map((m) => ({ role: m.role, g: m.geometry.map((p) => (p ? [r6(p.lat), r6(p.lon)] : null)) }));
      out.push({ t: 'r', id: e.id, members, tags });
    }
  }
  return out;
}

async function fetchOsm() {
  const q = overpassQuery();
  console.log(`overpass: querying ${id} bbox ${cfg.bbox.join(',')}`);
  const res = await fetchWithRetry((k) => fetch(ENDPOINTS[k % ENDPOINTS.length], {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: 'data=' + encodeURIComponent(q),
    signal: AbortSignal.timeout(300000),
  }), 'overpass');
  const json = await res.json();
  if (json.remark) console.log('  remark:', json.remark);
  const els = compact(json);
  const count = {};
  for (const e of els) count[e.t] = (count[e.t] || 0) + 1;
  console.log(`  ${json.elements.length} elements`, count, 'osm3s', json.osm3s?.timestamp_osm_base);
  return { timestamp: json.osm3s?.timestamp_osm_base, elements: els };
}

// DEM grid over the bbox, row-major from the south-west corner.
async function fetchElevation() {
  const [S, W, N, E] = cfg.bbox;
  const lat0 = (S + N) / 2;
  const mLat = 110540, mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const step = cfg.elevation.step;
  const nx = Math.ceil(((E - W) * mLon) / step) + 1, ny = Math.ceil(((N - S) * mLat) / step) + 1;
  const dLat = (N - S) / (ny - 1), dLon = (E - W) / (nx - 1);
  const pts = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pts.push([r6(S + j * dLat), r6(W + i * dLon)]);
  console.log(`elevation: ${nx}x${ny} grid (${pts.length} points) from ${cfg.elevation.dataset}`);
  const vals = [];
  for (let k = 0; k < pts.length; k += 100) {
    const batch = pts.slice(k, k + 100);
    const url = `https://api.opentopodata.org/v1/${cfg.elevation.dataset}?locations=${batch.map((p) => p.join(',')).join('|')}`;
    const res = await fetchWithRetry(() => fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) }), 'opentopodata');
    const json = await res.json();
    if (json.status !== 'OK') throw new Error('opentopodata: ' + JSON.stringify(json).slice(0, 200));
    for (const r of json.results) vals.push(r.elevation == null ? null : Math.round(r.elevation * 10) / 10);
    process.stdout.write(`  ${vals.length}/${pts.length}\r`);
    await sleep(1100); // public API: 1 request / second
  }
  console.log();
  return { dataset: cfg.elevation.dataset, bbox: cfg.bbox, nx, ny, values: vals };
}

const prev = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
const data = {
  id,
  source: 'OpenStreetMap via Overpass API; (c) OpenStreetMap contributors, ODbL 1.0. Elevation: opentopodata.org',
  bbox: cfg.bbox,
  skyline: cfg.skyline,
  fetched: new Date().toISOString().slice(0, 10),
  osm: prev.osm,
  elevation: prev.elevation,
};
if (flag !== '--elev-only') data.osm = await fetchOsm();
if (flag !== '--osm-only') data.elevation = await fetchElevation();
fs.writeFileSync(outFile, JSON.stringify(data));
console.log(`wrote ${path.relative(process.cwd(), outFile)} ${(fs.statSync(outFile).size / 1024 / 1024).toFixed(2)} MB`);
