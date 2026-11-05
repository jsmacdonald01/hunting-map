// Offline helper. Keeps the app itself and every downloaded county on the device.
const SHELL = 'shell-v3';
const TILES = 'tiles-v1'; // downloaded map pictures and property lines (filled by the Download panel)

const SHELL_FILES = [
  './', 'index.html', 'app.js', 'db.js', 'offline.js', 'style.css', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'astro.js', 'conditions.js', 'tools.js',
  'vendor/maplibre-gl.js', 'vendor/maplibre-gl.css',
  'fonts/OpenSansSemibold/0-255.pbf', 'fonts/OpenSansSemibold/256-511.pbf', 'fonts/OpenSansSemibold/8192-8447.pbf',
  'data/public-hunt.geojson', 'data/counties.json', 'data/seasons.json', 'data/sightings.geojson', 'data/forest-roads.geojson',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const isUsgsTile = u => u.hostname === 'basemap.nationalmap.gov' && u.pathname.includes('/MapServer/tile/');
const EMPTY = () => new Response(new Uint8Array(0), { status: 200, headers: { 'Content-Type': 'application/x-protobuf' } });

async function fromTiles(req, fallback) {
  const hit = await caches.match(req, { cacheName: TILES, ignoreSearch: true });
  if (hit) return hit;
  try { return await fetch(req); } catch { return fallback(); }
}

// Try the PC first (so updates show up), but don't wait long; then use the saved copy.
async function shellFirstNetwork(req) {
  const cache = await caches.open(SHELL);
  const net = fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()); return r; });
  const timeout = new Promise(resolve => setTimeout(resolve, 2500));
  try {
    const r = await Promise.race([net, timeout]);
    if (r) return r;
  } catch { /* offline */ }
  const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' && await cache.match('index.html'));
  if (hit) return hit;
  return net.catch(() => new Response('Offline and not saved yet', { status: 503 }));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (isUsgsTile(u)) return e.respondWith(fromTiles(req, () => new Response('', { status: 404 })));
  if (u.origin !== self.location.origin) return; // Esri, live property lines: always live
  if (u.pathname.includes('/data/parcels/')) return e.respondWith(fromTiles(req, EMPTY));
  if (u.pathname.includes('/data/counties/')) return e.respondWith(fromTiles(req, () => new Response('{}', { status: 503 })));
  e.respondWith(shellFirstNetwork(req));
});
