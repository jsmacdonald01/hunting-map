// Turns a county's TxGIO land-parcel file into small map pieces ("vector tiles")
// the app can save on the phone. Usage: node scripts/prepare-county.mjs walker
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import shapefile from 'shapefile';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import { COUNTIES } from './counties.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const MIN_Z = 12, MAX_Z = 14;

// Rough area in acres from the shape itself, for parcels the county left at 0.
function shapeAcres(g) {
  const R = 6378137, rad = Math.PI / 180;
  const ringArea = ring => {
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      a += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad));
    }
    return Math.abs(a * R * R / 2);
  };
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let m2 = 0;
  for (const p of polys) p.forEach((ring, i) => { m2 += i ? -ringArea(ring) : ringArea(ring); });
  return m2 / 4046.86;
}

// The list the Download panel shows: one short entry per prepared county.
function writeCountyList() {
  const dir = path.join(ROOT, 'data', 'counties');
  const list = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
    const { parcelTiles, ...summary } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    return { ...summary, parcelTileCount: parcelTiles.length };
  }).sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(ROOT, 'data', 'counties.json'), JSON.stringify(list));
}

if (process.argv[2] === '--list-only') { writeCountyList(); process.exit(0); }

const key = process.argv[2];
const county = COUNTIES[key];
if (!county) { console.error('Unknown county. Choices: ' + Object.keys(COUNTIES).join(', ')); process.exit(1); }

const rawDir = path.join(ROOT, 'data', 'raw', county.fips);
const zipPath = path.join(ROOT, 'data', 'raw', county.fips + '.zip');
fs.mkdirSync(rawDir, { recursive: true });

if (!fs.existsSync(zipPath)) {
  console.log(`Downloading ${county.name} County land file...`);
  const res = await fetch(county.zip, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
}
let shpFile = fs.readdirSync(rawDir).find(f => f.endsWith('.shp'));
if (!shpFile) {
  // Windows 11 ships tar.exe, which can read zip files.
  execFileSync('tar', ['-xf', zipPath, '-C', rawDir, '--strip-components=1', 'shp/*']);
  shpFile = fs.readdirSync(rawDir).find(f => f.endsWith('.shp'));
}

const clean = s => (typeof s === 'string' ? s.replace(/\u0000/g, '').replace(/^[\s,]+|[\s,]+$/g, '').replace(/\s+/g, ' ') : '');

console.log(`Reading ${county.name} County parcels...`);
const source = await shapefile.open(path.join(rawDir, shpFile), undefined, { encoding: 'utf-8' });
const features = [];
let blankOwners = 0;
const bbox = [180, 90, -180, -90];
for (;;) {
  const r = await source.read();
  if (r.done) break;
  const p = r.value.properties;
  const g = r.value.geometry;
  if (!g) continue;
  const owner = clean(p.OWNER_NAME);
  if (!owner) blankOwners++;
  const legal = Number(p.LEGAL_AREA) || 0;
  const gis = Number(p.GIS_AREA) || shapeAcres(g);
  features.push({
    type: 'Feature',
    geometry: g,
    properties: {
      owner,
      acres: Math.round((legal > 0 ? legal : gis) * 100) / 100,
      acresSource: legal > 0 ? 'appraisal' : 'mapped',
      county: county.name,
      addr: clean(p.SITUS_ADDR),
      value: Number(p.MKT_VALUE) || 0,
      legal: clean(p.LEGAL_DESC).slice(0, 120),
      id: clean(String(p.PROP_ID ?? '')),
    },
  });
  const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
  for (const ring of rings) for (const [x, y] of ring) {
    if (x < bbox[0]) bbox[0] = x; if (y < bbox[1]) bbox[1] = y;
    if (x > bbox[2]) bbox[2] = x; if (y > bbox[3]) bbox[3] = y;
  }
}
console.log(`  ${features.length} parcels, ${blankOwners} with no owner name`);

console.log('Cutting into map pieces...');
const index = geojsonvt({ type: 'FeatureCollection', features }, { maxZoom: MAX_Z, indexMaxZoom: 8, tolerance: 3, buffer: 64 });

const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };

const outDir = path.join(ROOT, 'data', 'parcels', key);
fs.rmSync(outDir, { recursive: true, force: true });
const tiles = [];
let bytes = 0;
for (let z = MIN_Z; z <= MAX_Z; z++) {
  for (let x = lon2x(bbox[0], z); x <= lon2x(bbox[2], z); x++) {
    for (let y = lat2y(bbox[3], z); y <= lat2y(bbox[1], z); y++) {
      const t = index.getTile(z, x, y);
      if (!t || !t.features.length) continue;
      // Owner details only ride along at the closest zoom (where you tap); farther out it's just lines.
      const layer = z < MAX_Z ? { ...t, features: t.features.map(f => ({ ...f, tags: {} })) } : t;
      const buf = Buffer.from(vtpbf.fromGeojsonVt({ parcels: layer }, { version: 2 }));
      fs.mkdirSync(path.join(outDir, String(z), String(x)), { recursive: true });
      fs.writeFileSync(path.join(outDir, String(z), String(x), y + '.pbf'), buf);
      tiles.push(`${z}/${x}/${y}`);
      bytes += buf.length;
    }
  }
}

const manifest = {
  key, name: county.name, fips: county.fips,
  bbox: bbox.map(n => Math.round(n * 1e5) / 1e5),
  parcels: features.length, blankOwners,
  parcelTiles: tiles, parcelBytes: bytes,
  prepared: new Date().toISOString(),
};
fs.mkdirSync(path.join(ROOT, 'data', 'counties'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'counties', key + '.json'), JSON.stringify(manifest));
writeCountyList();
console.log(`Done: ${tiles.length} pieces, ${(bytes / 1e6).toFixed(1)} MB`);
