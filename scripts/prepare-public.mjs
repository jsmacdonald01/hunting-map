// Saves the TPWD public hunting areas (statewide) into one small file the app keeps offline.
// Usage: node scripts/prepare-public.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASE = 'https://tpwd.texas.gov/server/rest/services/Wildlife/TPWD_PublicHuntLocatorMap/MapServer/';

// Areas inside a public property where you may NOT hunt (or that are private).
const NO_HUNT = new Set(['No Hunting Recreation Compartment', 'No Hunt Zone', 'No Hunt Zone (Walk-In Only)',
  'Private In-holdings', 'No Public Access', 'Waterfowl Sanctuary']);
const BOUNDARY = new Set(['Property Boundary', 'State Park Boundary']);

async function layer(id, fields, extra = '') {
  const url = `${BASE}${id}/query?where=Active%3D%27Yes%27&outFields=${fields}&outSR=4326&geometryPrecision=5${extra}&f=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TPWD layer ${id}: HTTP ${res.status}`);
  return (await res.json()).features;
}

const link = html => (/href=([^\s>]+)/.exec(html || '') || [])[1] || '';
const kind = cls => NO_HUNT.has(cls) ? 'nohunt' : BOUNDARY.has(cls) ? 'boundary' : 'area';
const out = [];

for (const f of await layer(9, 'LocName,Name,Class,Acres,PH_UnitNum,KMLDescrip', '&maxAllowableOffset=0.00005')) {
  const p = f.properties;
  out.push({ type: 'Feature', geometry: f.geometry, properties: {
    src: 'Public Hunting Land', name: p.LocName || p.Name || '', cls: p.Class, kind: kind(p.Class),
    acres: p.Acres || null, unit: p.PH_UnitNum || null, booklet: link(p.KMLDescrip) } });
}
for (const f of await layer(5, 'LEASE_NAME,Class,ACRES,LEASE_NUM,KMLDESCRIP', '&maxAllowableOffset=0.00005')) {
  const p = f.properties;
  out.push({ type: 'Feature', geometry: f.geometry, properties: {
    src: 'Dove & Small Game Lease', name: p.LEASE_NAME || '', cls: p.Class, kind: kind(p.Class),
    acres: p.ACRES || null, unit: p.LEASE_NUM || null, booklet: link(p.KMLDESCRIP) } });
}
for (const f of await layer(7, 'LocName,Class,GPS_PntTyp,Name')) {
  const p = f.properties;
  out.push({ type: 'Feature', geometry: f.geometry, properties: {
    src: 'Public Hunting Land', name: p.LocName || '', cls: p.GPS_PntTyp || p.Class || '', kind: 'point' } });
}

const file = path.join(ROOT, 'data', 'public-hunt.geojson');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', fetched: new Date().toISOString(), features: out }));
console.log(`Saved ${out.length} public hunting features (${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);
