// Hunting Map server: shows the app on this PC while we build it.
// No add-ons needed beyond Node. Start with: node server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = import.meta.dirname;
const PORT = Number(process.env.PORT) || 8765;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const VENDOR = path.join(ROOT, 'node_modules', 'maplibre-gl', 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.geojson': 'application/geo+json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.pbf': 'application/x-protobuf', '.jpg': 'image/jpeg',
};

function send(res, status, body, type = 'text/plain') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
}

function sendFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

// Keeps a request inside its folder (no "../" tricks).
function inside(base, rel) {
  const full = path.join(base, rel);
  return full.startsWith(base + path.sep) ? full : null;
}

http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.startsWith('/data/')) {
    const f = inside(DATA, p.slice(6));
    if (!f || f.startsWith(path.join(DATA, 'raw'))) return send(res, 404, 'Not found');
    return sendFile(res, f);
  }
  if (p.startsWith('/vendor/')) {
    const f = inside(VENDOR, p.slice(8));
    return f ? sendFile(res, f) : send(res, 404, 'Not found');
  }
  const f = inside(PUBLIC, p === '/' ? 'index.html' : p.slice(1));
  return f ? sendFile(res, f) : send(res, 404, 'Not found');
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Hunting Map is running: http://localhost:${PORT}`);
  console.log('Leave this window open while you use it. Close it to stop.');
});
