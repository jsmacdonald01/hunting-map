// Downloading counties onto the device, and removing them again.
import { db } from './db.js';

export const TILES = 'tiles-v1'; // must match sw.js
export const IMG_MAX = 16;  // satellite saved down to about 2.4 m per pixel
export const TOPO_MAX = 15; // topo saved down to about 5 m per pixel
const MIN_Z = 8;
const AVG_TILE_BYTES = 20000;

export const USGS = {
  usgsimg: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile',
  usgstopo: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile',
};

// Ground heights for the 3D view and hill shading (free public data hosted by Amazon, no key needed).
export const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
export const DEM_MAX = 13; // about 16 m per pixel, plenty for creeks and ridges
const AVG_DEM_BYTES = 80000;

// Texas state aerial photos (free from the Texas Geographic Information Office). The server draws each square on
// request, so we always ask for the same squares in the same way: that lets saved copies be found again offline.
const TX_SERVER = 'https://imagery.geographic.texas.gov/server/rest/services';
export const TX_PHOTOS = {
  tx22: { path: 'NAIP/NAIP22_NCCIR_60cm', label: 'Summer 2022', credit: 'Aerial photo: TxGIO / USDA NAIP 2022' },
  tx15: { path: 'TOP/TOP15_NCCIR_50cm', label: 'Winter 2015', credit: 'Aerial photo: TxGIO Texas Orthoimagery Program 2015' },
};
const HALF = 20037508.342789244; // half the width of the world in map meters
export function txPhotoUrl(key, z, x, y) {
  const span = 2 * HALF / 2 ** z, left = -HALF + x * span, top = HALF - y * span;
  const bbox = [left, top - span, left + span, top].map(v => v.toFixed(2)).join(',');
  return `${TX_SERVER}/${TX_PHOTOS[key].path}/ImageServer/exportImage?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=512,512`
    + '&format=jpg&compressionQuality=80&bandIds=0,1,2&interpolation=RSP_BilinearInterpolation&f=image';
}
export const SHARP_Z = 16; // "extra sharp" offline photos: about 1 m per pixel, twice the detail of the standard download
const AVG_SHARP_BYTES = 75000;

const abs = p => new URL(p, location.href).href;
export const parcelTileUrl = key => abs(`data/parcels/${key}/`) + '{z}/{x}/{y}.pbf';

// Every map picture covering the county: parents of the county's close-up property tiles, plus their children.
function rasterTiles(z14, max) {
  const out = new Set();
  for (const [x, y] of z14) {
    for (let z = MIN_Z; z <= 14; z++) out.add(`${z}/${x >> (14 - z)}/${y >> (14 - z)}`);
    for (let z = 15; z <= max; z++) {
      const n = 2 ** (z - 14);
      for (let dx = 0; dx < n; dx++) for (let dy = 0; dy < n; dy++) out.add(`${z}/${x * n + dx}/${y * n + dy}`);
    }
  }
  return out;
}

// Each entry: where it's saved on the phone (key) and where to download it from (from).
export function countyFiles(m, { sharp = false } = {}) {
  const z14 = m.parcelTiles.filter(t => t.startsWith('14/')).map(t => t.split('/').slice(1).map(Number));
  const list = [{ key: abs(`data/counties/${m.key}.json`), from: abs(`data/counties/${m.key}.json`) }];
  for (const t of m.parcelTiles) list.push({ key: abs(`data/parcels/${m.key}/${t}.pbf`), from: abs(`data/parcels/${m.key}/${t}.pbf`) });
  for (const [layer, max] of [['usgsimg', IMG_MAX], ['usgstopo', TOPO_MAX]]) {
    for (const t of rasterTiles(z14, max)) {
      const [z, x, y] = t.split('/');
      const url = `${USGS[layer]}/${z}/${y}/${x}`;
      list.push({ key: url, from: url });
    }
  }
  // Ground heights: far fewer pictures, since they stop at a wider zoom.
  const dem = new Set();
  for (const [x, y] of z14) for (let z = MIN_Z; z <= DEM_MAX; z++) dem.add(`${z}/${x >> (14 - z)}/${y >> (14 - z)}`);
  for (const t of dem) list.push({ key: `${DEM_URL}/${t}.png`, from: `${DEM_URL}/${t}.png` });
  // Extra sharp: the state's 2022 aerial photo, one step closer in. Listed last, and fetched gently (see below).
  if (sharp) {
    const n = 2 ** (SHARP_Z - 14);
    for (const [x, y] of z14) for (let dx = 0; dx < n; dx++) for (let dy = 0; dy < n; dy++) {
      const url = txPhotoUrl('tx22', SHARP_Z, x * n + dx, y * n + dy);
      list.push({ key: url, from: url, gentle: true });
    }
  }
  return list;
}

export function estimateBytes(summary, sharp = false) {
  // Rough guess before the full list is loaded: about 21 map pictures per close-up property tile per layer.
  const z14 = summary.parcelTileCount / 1.4;
  return summary.parcelBytes + z14 * (21 + 5) * AVG_TILE_BYTES + z14 * 0.4 * AVG_DEM_BYTES + (sharp ? z14 * 16 * AVG_SHARP_BYTES : 0);
}

async function manifest(key) {
  const res = await fetch(`data/counties/${key}.json`);
  if (!res.ok) throw new Error('Could not load the county list. Check your signal and try again.');
  return res.json();
}

// Saves a list of files onto the device. Used by county downloads and the wide-area "grid-down" download.
async function saveFiles(files, onProgress, signal) {
  const cache = await caches.open(TILES);
  let done = 0, failed = 0, bytes = 0, next = 0;
  let lock = null;
  try { lock = await navigator.wakeLock?.request('screen'); } catch { /* not allowed */ } // keep the screen on: phones pause web apps when it locks

  async function worker(_, id) {
    while (next < files.length) {
      if (signal?.aborted) return;
      // Some servers draw each picture to order, so only half the workers ask those at once.
      if (files[next].gentle && id >= 4) return;
      const f = files[next++];
      if (!(await cache.match(f.key))) {
        let ok = false;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          try {
            const res = await fetch(f.from, { signal });
            if (res.ok) {
              const headers = { 'Content-Type': res.headers.get('Content-Type') || '' };
              let blob = await res.blob();
              // Road data squeezes to about a third of its size; it is unsqueezed when the map reads it (see map.js).
              if (f.pack && 'CompressionStream' in self) {
                blob = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
                headers['X-Packed'] = 'gzip';
              }
              bytes += blob.size;
              await cache.put(f.key, new Response(blob, { headers }));
              ok = true;
            } else if (f.optional && (res.status === 404 || res.status === 204)) ok = true; // nothing there (open water)
          } catch (e) { if (signal?.aborted) return; }
        }
        if (!ok) failed++;
      }
      done++;
      if (done % 25 === 0 || done === files.length) onProgress?.(done, files.length, bytes);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  lock?.release?.();
  if (signal?.aborted) throw new Error('Stopped');
  return { failed, bytes };
}

export async function downloadCounty(key, onProgress, signal, { sharp = false } = {}) {
  const m = await manifest(key);
  const files = countyFiles(m, { sharp });
  const { failed } = await saveFiles(files, onProgress, signal);
  const record = { id: key, name: m.name, bbox: m.bbox, files: files.length, failed, terrain: true, sharp, date: new Date().toISOString(), prepared: m.prepared };
  await db.put('counties', record);
  return record;
}

// Every saved picture that a downloaded county (other than `skip`) or a downloaded region part still needs.
async function keysStillNeeded(skip, skipPart) {
  const cache = await caches.open(TILES), keep = new Set();
  for (const c of await db.all('counties')) {
    if (c.id === skip) continue;
    const other = await cache.match(abs(`data/counties/${c.id}.json`));
    if (other) countyFiles(await other.json(), { sharp: !!c.sharp }).forEach(f => keep.add(f.key));
  }
  const parts = regionParts();
  for (const part of Object.keys(parts)) if (part !== skipPart && part !== 'roads') regionFiles(part).forEach(f => keep.add(f.key));
  return keep;
}

export async function removeCounty(key) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(abs(`data/counties/${key}.json`));
  if (hit) {
    const keep = await keysStillNeeded(key);
    for (const f of countyFiles(await hit.json(), { sharp: true })) if (!keep.has(f.key)) await cache.delete(f.key);
  }
  await db.del('counties', key);
}

// ---------- Wide-area "grid-down" map: Galveston to just north of Huntsville ----------
// Three parts you can save separately: every road, track and rail line; the topo map; and a satellite picture.
export const REGION = { name: 'Galveston to Huntsville', bbox: [-96.2, 28.95, -94.45, 30.98] };
// Tests shrink the area so they finish quickly.
export const regionBbox = () => { try { return JSON.parse(localStorage.getItem('regionTest')) || REGION.bbox; } catch { return REGION.bbox; } };
export const REGION_PARTS = {
  roads: { label: 'Roads, rail lines and town names', hint: 'Every road, side road, track, path and railroad. Small, and sharp at any zoom.', zooms: [6, 14], avg: 16000 },
  topo: { label: 'Topo map', hint: 'Hills, creeks, bridges and place names for the whole area.', zooms: [8, 15], avg: 21000 },
  sat: { label: 'Satellite picture', hint: 'The whole area from above. Less detail than a county download (about 13 feet per dot).', zooms: [8, 15], avg: 22000 },
};

function regionTiles([zmin, zmax]) {
  const [w, s, e, n] = regionBbox(), out = [];
  const col = (lng, z) => Math.floor((lng + 180) / 360 * 2 ** z);
  const row = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
  for (let z = zmin; z <= zmax; z++) for (let x = col(w, z); x <= col(e, z); x++) for (let y = row(n, z); y <= row(s, z); y++) out.push([z, x, y]);
  return out;
}

// Road data comes from OpenFreeMap (OpenStreetMap). Their address changes with each weekly update, so saved copies
// are filed under a fixed address of our own instead.
export const roadsKey = (z, x, y) => `https://saved.hunting-map.invalid/roads/${z}/${x}/${y}`;
let roadsFrom = localStorage.getItem('roadsFrom') || '';
export async function roadsTemplate() {
  if (roadsFrom && roadsTemplate.fresh) return roadsFrom;
  try {
    const j = await (await fetch('https://tiles.openfreemap.org/planet')).json();
    roadsFrom = j.tiles[0]; roadsTemplate.fresh = true;
    localStorage.setItem('roadsFrom', roadsFrom);
  } catch { /* no signal: use the last known address, saved copies still work */ }
  return roadsFrom;
}

function regionFiles(part, template = '') {
  const tiles = regionTiles(REGION_PARTS[part].zooms);
  if (part === 'roads') return tiles.map(([z, x, y]) => ({ key: roadsKey(z, x, y), from: template.replace('{z}', z).replace('{x}', x).replace('{y}', y), pack: true, optional: true }));
  const base = USGS[part === 'topo' ? 'usgstopo' : 'usgsimg'];
  return tiles.map(([z, x, y]) => ({ key: `${base}/${z}/${y}/${x}`, from: `${base}/${z}/${y}/${x}` }));
}
export const regionEstimate = part => regionTiles(REGION_PARTS[part].zooms).length * REGION_PARTS[part].avg;
export const regionParts = () => { try { return JSON.parse(localStorage.getItem('regionParts')) || {}; } catch { return {}; } };
const saveParts = p => localStorage.setItem('regionParts', JSON.stringify(p));

export async function downloadRegion(part, onProgress, signal) {
  const template = part === 'roads' ? await roadsTemplate() : '';
  if (part === 'roads' && !template) throw new Error('Could not reach the road map server. Check your signal and try again.');
  const files = regionFiles(part, template);
  const { failed, bytes } = await saveFiles(files, onProgress, signal);
  const parts = regionParts();
  parts[part] = { date: new Date().toISOString(), files: files.length, failed, bytes: (parts[part]?.bytes || 0) + bytes };
  saveParts(parts);
  return parts[part];
}

export async function removeRegion(part) {
  const cache = await caches.open(TILES);
  const keep = part === 'roads' ? new Set() : await keysStillNeeded(null, part);
  for (const f of regionFiles(part)) if (!keep.has(f.key)) await cache.delete(f.key);
  const parts = regionParts();
  delete parts[part];
  saveParts(parts);
}
