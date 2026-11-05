// Puts together the website folder (_site) that GitHub Pages serves: the app, its data, and the map library.
// Usage: node scripts/build-site.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, '_site');
fs.rmSync(OUT, { recursive: true, force: true });

fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'data'), path.join(OUT, 'data'), {
  recursive: true,
  filter: src => !src.startsWith(path.join(ROOT, 'data', 'raw')), // the big county downloads stay on the PC
});
fs.mkdirSync(path.join(OUT, 'vendor'), { recursive: true });
for (const f of ['maplibre-gl.js', 'maplibre-gl.css']) {
  fs.copyFileSync(path.join(ROOT, 'node_modules', 'maplibre-gl', 'dist', f), path.join(OUT, 'vendor', f));
}
fs.writeFileSync(path.join(OUT, '.nojekyll'), ''); // serve files as-is
console.log('Website ready in _site');
