// Gathers the add-on layers for the area around the prepared counties, saved as small files the app keeps offline:
//   data/sightings.geojson  animal sightings (iNaturalist + eBird via GBIF)
//   data/forest-roads.geojson  National Forest roads and trails (Forest Service)
// Usage: node scripts/prepare-extras.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = async url => {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'HuntingMap/1.0 (personal use)' } });
    if (r.ok) return r.json();
    await sleep(2000 * (i + 1));
  }
  throw new Error('Failed: ' + url);
};

// Area = all prepared counties plus a small margin.
const counties = JSON.parse(fs.readFileSync(path.join(DATA, 'counties.json'), 'utf8'));
const pad = 0.05;
const bbox = [
  Math.min(...counties.map(c => c.bbox[0])) - pad, Math.min(...counties.map(c => c.bbox[1])) - pad,
  Math.max(...counties.map(c => c.bbox[2])) + pad, Math.max(...counties.map(c => c.bbox[3])) + pad,
].map(n => Math.round(n * 1000) / 1000);
console.log('Area:', bbox.join(', '));
const SINCE_YEAR = new Date().getFullYear() - 10;

// ---------- Sightings ----------
// key: what the app filters by. inat: iNaturalist taxon ids. gbif: GBIF taxon keys, eBird records only.
const ANIMALS = [
  { key: 'deer', inat: [42223] },
  { key: 'hog', inat: [42134] },
  { key: 'turkey', inat: [906], gbif: [9606290] },
  { key: 'squirrel', inat: [45994] },
  { key: 'rabbit', inat: [43096] },
  { key: 'coyote', inat: [42051] },
  { key: 'duck', inat: [6912], gbif: [2986] },
  { key: 'dove', inat: [3454, 3460, 2969], gbif: ['Zenaida macroura', 'Zenaida asiatica', 'Streptopelia decaocto'] },
  { key: 'quail', inat: [1280], gbif: [9791464] },
  { key: 'woodcock', inat: [3936], gbif: [2481695] },
];
const MAX_PER_SOURCE = 4000;

const features = [];
const add = (lng, lat, a, d, s) => {
  if (lng == null || lat == null) return;
  features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [+lng.toFixed(5), +lat.toFixed(5)] }, properties: { a, d, s } });
};

async function inat(animal) {
  let n = 0, idBelow = '';
  // Only sightings whose exact spot is public (hidden spots are blurred by miles, useless for hunting).
  const base = `https://api.inaturalist.org/v1/observations?taxon_id=${animal.inat.join(',')}&swlng=${bbox[0]}&swlat=${bbox[1]}&nelng=${bbox[2]}&nelat=${bbox[3]}`
    + `&geoprivacy=open&taxon_geoprivacy=open&captive=false&d1=${SINCE_YEAR}-01-01&order_by=id&order=desc&per_page=200`;
  for (;;) {
    const j = await getJson(base + idBelow);
    for (const o of j.results) {
      if (o.location && (o.positional_accuracy == null || o.positional_accuracy < 1000)) {
        const [lat, lng] = (o.location || '').split(',').map(Number);
        add(lng, lat, animal.key, o.observed_on || '', 'iNaturalist');
        n++;
      }
    }
    if (j.results.length < 200 || n >= MAX_PER_SOURCE) break;
    idBelow = '&id_below=' + j.results[j.results.length - 1].id;
    await sleep(1100); // be polite: about 1 request per second
  }
  return n;
}

async function gbif(animal) {
  let n = 0;
  for (let k of animal.gbif || []) {
    if (typeof k === 'string') k = (await getJson('https://api.gbif.org/v1/species/match?name=' + encodeURIComponent(k))).usageKey;
    for (let offset = 0; offset < MAX_PER_SOURCE; offset += 300) {
      const j = await getJson(`https://api.gbif.org/v1/occurrence/search?datasetKey=4fa7b334-ce0d-4e88-aaae-2e0c138d049e&taxonKey=${k}`
        + `&decimalLatitude=${bbox[1]},${bbox[3]}&decimalLongitude=${bbox[0]},${bbox[2]}&year=${SINCE_YEAR},2100&limit=300&offset=${offset}`);
      for (const o of j.results) { add(o.decimalLongitude, o.decimalLatitude, animal.key, (o.eventDate || '').slice(0, 10), 'eBird'); n++; }
      if (j.endOfRecords) break;
      await sleep(300);
    }
  }
  return n;
}

// --roads-only skips the slow sightings step.
if (!process.argv.includes('--roads-only')) {
  for (const a of ANIMALS) {
    const i = await inat(a);
    const e = await gbif(a);
    console.log(`  ${a.key}: ${i} iNaturalist, ${e} eBird`);
  }
  // eBird lists the same spot many times (one record per checklist); keep one per spot per day.
  const seen = new Set();
  const unique = features.filter(f => { const k = f.properties.a + f.geometry.coordinates.join() + f.properties.d; if (seen.has(k)) return false; seen.add(k); return true; });
  fs.writeFileSync(path.join(DATA, 'sightings.geojson'), JSON.stringify({ type: 'FeatureCollection', fetched: new Date().toISOString(), bbox, features: unique }));
  console.log(`Saved ${unique.length} sightings`);
}

// ---------- Forest roads and trails ----------
const env = `geometry=${bbox.join(',')}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outSR=4326&f=geojson`;
const EDW = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/';
const roads = [];
const MVUM_FIELDS = 'id,name,mvum_symbol_name,passengervehicle_datesopen,highclearancevehicle_datesopen,atv_datesopen,seasonal';
for (const [layer, kind, fields] of [['EDW_MVUM_02/MapServer/1', 'road', MVUM_FIELDS + ',surfacetype'], ['EDW_MVUM_02/MapServer/2', 'ohv', MVUM_FIELDS]]) {
  const j = await getJson(`${EDW}${layer}/query?where=1%3D1&outFields=${fields}&${env}`);
  if (!j.features) throw new Error(`Forest Service ${kind} query failed: ${JSON.stringify(j.error || j).slice(0, 200)}`);
  for (const f of j.features) {
    const p = f.properties;
    roads.push({ type: 'Feature', geometry: f.geometry, properties: {
      kind, num: p.id || '', name: p.name || '', use: p.mvum_symbol_name || '', surface: (p.surfacetype || '').replace(/^\w+ - /, '').toLowerCase(),
      open: p.passengervehicle_datesopen || p.highclearancevehicle_datesopen || p.atv_datesopen || '', seasonal: p.seasonal || '' } });
  }
}
const trails = await getJson(`${EDW}EDW_TrailNFSPublish_01/MapServer/0/query?where=1%3D1&outFields=trail_name,segment_length,terra_motorized,trail_surface&${env}`);
for (const f of trails.features) {
  const p = f.properties;
  roads.push({ type: 'Feature', geometry: f.geometry, properties: {
    kind: 'trail', name: p.trail_name || '', miles: p.segment_length || null, use: p.terra_motorized === 'Y' ? 'Motorized trail' : 'Foot trail (no motor vehicles)', surface: (p.trail_surface || '').toLowerCase() } });
}
// About 1 m precision is plenty and keeps the file small.
const round = c => typeof c[0] === 'number' ? [+c[0].toFixed(5), +c[1].toFixed(5)] : c.map(round);
roads.forEach(f => { f.geometry.coordinates = round(f.geometry.coordinates); });
fs.writeFileSync(path.join(DATA, 'forest-roads.geojson'), JSON.stringify({ type: 'FeatureCollection', fetched: new Date().toISOString(), features: roads }));
console.log(`Saved ${roads.length} forest roads and trails`);
