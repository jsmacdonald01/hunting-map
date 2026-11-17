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

export async function downloadCounty(key, onProgress, signal, { sharp = false } = {}) {
  const m = await manifest(key);
  const files = countyFiles(m, { sharp });
  const cache = await caches.open(TILES);
  let done = 0, failed = 0, bytes = 0, next = 0;

  async function worker(_, id) {
    while (next < files.length) {
      if (signal?.aborted) return;
      // The state's photo server draws each picture to order, so only half the workers ask it at once.
      if (files[next].gentle && id >= 4) return;
      const f = files[next++];
      if (!(await cache.match(f.key))) {
        let ok = false;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          try {
            const res = await fetch(f.from, { signal });
            if (res.ok) {
              const blob = await res.blob();
              bytes += blob.size;
              await cache.put(f.key, new Response(blob, { headers: { 'Content-Type': res.headers.get('Content-Type') || '' } }));
              ok = true;
            }
          } catch (e) { if (signal?.aborted) return; }
        }
        if (!ok) failed++;
      }
      done++;
      if (done % 25 === 0 || done === files.length) onProgress?.(done, files.length, bytes);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  if (signal?.aborted) throw new Error('Stopped');
  const record = { id: key, name: m.name, bbox: m.bbox, files: files.length, failed, terrain: true, sharp, date: new Date().toISOString(), prepared: m.prepared };
  await db.put('counties', record);
  return record;
}

export async function removeCounty(key) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(abs(`data/counties/${key}.json`));
  if (hit) {
    // Keep pictures a neighboring downloaded county still needs.
    const keep = new Set();
    for (const c of await db.all('counties')) {
      if (c.id === key) continue;
      const other = await cache.match(abs(`data/counties/${c.id}.json`));
      if (other) countyFiles(await other.json(), { sharp: !!c.sharp }).forEach(f => keep.add(f.key));
    }
    for (const f of countyFiles(await hit.json(), { sharp: true })) if (!keep.has(f.key)) await cache.delete(f.key);
  }
  await db.del('counties', key);
}
