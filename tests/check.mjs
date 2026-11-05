// End-to-end check: owner lookup online, county download, then everything again with the internet cut off.
// Usage: node tests/check.mjs [county-key] [lng] [lat]   (the server must be running)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const [key = 'san-jacinto', lng = '-95.1180', lat = '30.5990'] = process.argv.slice(2);
const URL = 'http://localhost:8765/';
const OUT = path.resolve(import.meta.dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// With OWN_SERVER=1 the test starts the app itself, so it can switch it off for the offline part.
let server = null;
if (process.env.OWN_SERVER) {
  server = spawn(process.execPath, [path.resolve(import.meta.dirname, '..', 'server.mjs')], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 430, height: 900 }, deviceScaleFactor: 2,
  geolocation: { longitude: Number(lng), latitude: Number(lat) }, permissions: ['geolocation'],
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

async function ready() {
  await page.waitForFunction(() => window.huntingMap?.loaded() && navigator.serviceWorker?.controller, null, { timeout: 60000 });
}
async function goTo(z) {
  await page.evaluate(([x, y, z]) => window.huntingMap.jumpTo({ center: [x, y], zoom: z }), [Number(lng), Number(lat), z]);
  await page.waitForFunction(() => window.huntingMap.areTilesLoaded(), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
async function tapCenter() {
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => { const h = document.querySelector('#sheet-body h2'); return h && !/Looking/.test(h.textContent); }, null, { timeout: 20000 });
  return page.evaluate(() => document.querySelector('#sheet-body').innerText);
}

// 1. Online: tap a property, see the owner.
await page.goto(URL);
await ready();
await page.reload(); // second load is controlled by the offline helper
await ready();
await goTo(16);
log('ONLINE tap:\n' + (await tapCenter()).split('\n').slice(0, 6).join('\n'));
await page.screenshot({ path: path.join(OUT, '1-online-owner.png') });

// 2. Download the county.
await page.click('#sheet .close');
await page.click('#btn-menu');
await page.click(`[data-dl="${key}"]`);
log('Downloading', key, '...');
const t0 = Date.now();
await page.waitForFunction(k => !document.querySelector('#dl-prog') && document.querySelector(`[data-rm="${k}"]`), key, { timeout: 60 * 60000, polling: 2000 });
log(`Downloaded in ${Math.round((Date.now() - t0) / 1000)}s:`, (await page.locator('#sheet-body').innerText()).split('\n').filter(l => /Downloaded|Using/.test(l)).join(' | '));
await page.screenshot({ path: path.join(OUT, '2-downloaded.png') });

// 3. Turn off the PC server AND cut the internet, like being in the woods. Reload and tap again.
if (server) { server.kill(); await new Promise(r => setTimeout(r, 1000)); log('PC server stopped'); }
await context.setOffline(true);
await page.reload();
await page.waitForFunction(() => window.huntingMap?.loaded(), null, { timeout: 60000 });
await page.waitForTimeout(5000);
await goTo(16);
const status = await page.locator('#status').innerText().catch(() => '');
log('OFFLINE status banner:', status);
log('OFFLINE tap:\n' + (await tapCenter()).split('\n').slice(0, 6).join('\n'));
await page.screenshot({ path: path.join(OUT, '3-offline-owner.png') });

// 4. Offline topo.
await page.click('#sheet .close');
await page.click('#btn-layers');
await page.click('[data-base="topo"]');
await page.click('#btn-layers');
await goTo(14);
await page.screenshot({ path: path.join(OUT, '4-offline-topo.png') });

// 5. Public hunting areas, offline, zoomed out over Sam Houston National Forest.
await page.click('#btn-layers');
await page.click('[data-base="sat"]');
await page.click('#btn-layers');
await page.evaluate(() => window.huntingMap.jumpTo({ center: [-95.2, 30.6], zoom: 11 }));
await page.waitForTimeout(4000);
const labels = await page.evaluate(() => [...new Set(window.huntingMap.queryRenderedFeatures({ layers: ['pub-label'] }).map(f => f.properties.name))]);
log('OFFLINE hunting-area labels on screen:', labels.join(', ') || 'none');
await page.screenshot({ path: path.join(OUT, '5-offline-public-areas.png') });

log('Page errors:', errors.length ? errors : 'none');
await browser.close();
