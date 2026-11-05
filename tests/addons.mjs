// Clicks through every add-on and takes screenshots. Usage: OWN_SERVER=1 node tests/addons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const OUT = path.resolve(import.meta.dirname, 'screenshots', 'addons');
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const HERE = { longitude: -95.4560, latitude: 30.5560 }; // inside Sam Houston National Forest

let server = null;
if (process.env.OWN_SERVER) {
  server = spawn(process.execPath, [path.resolve(import.meta.dirname, '..', 'server.mjs')], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
}
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2, geolocation: HERE, permissions: ['geolocation', 'clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());
const shot = name => page.screenshot({ path: path.join(OUT, name + '.png') });
const settle = async (ms = 2500) => { await page.waitForFunction(() => window.huntingMap.areTilesLoaded(), null, { timeout: 30000 }).catch(() => {}); await page.waitForTimeout(ms); };
const jump = (c, z) => page.evaluate(([c, z]) => window.huntingMap.jumpTo({ center: c, zoom: z }), [c, z]);
const sheet = () => page.locator('#sheet-body').innerText();

await page.goto('http://localhost:8765/');
await page.waitForFunction(() => window.huntingMap?.loaded(), null, { timeout: 60000 });
await page.reload();
await page.waitForFunction(() => window.huntingMap?.loaded() && navigator.serviceWorker?.controller, null, { timeout: 60000 });

// 1. Sightings as dots, then hot spots, with all animals.
await page.click('#btn-layers');
for (const box of await page.locator('#sight-animals input').all()) if (!(await box.isChecked())) await box.check();
await jump([-95.45, 30.55], 11); await settle();
const dots = await page.evaluate(() => window.huntingMap.queryRenderedFeatures({ layers: ['sight-dots'] }).length);
log('Sightings dots on screen:', dots);
await shot('1-sightings-dots');
await page.selectOption('#sight-style', 'heat'); await settle();
await page.click('#btn-layers');
await shot('2-sightings-hotspots');
await page.click('#btn-layers');
await page.selectOption('#sight-style', 'dots');
await page.click('#btn-layers');

// 2. Forest roads and tapping one.
const road = await page.evaluate(() => {
  const m = window.huntingMap, f = m.querySourceFeatures('roads').find(f => f.properties.kind === 'road');
  return f && f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)];
});
log('A forest road point:', road);
if (road) {
  await jump(Array.isArray(road[0]) ? road[0] : road, 15); await settle();
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(3000);
  log('Tap on road:', (await sheet()).split('\n').filter(l => /Forest road|open|trail/i.test(l)).slice(0, 3).join(' | '));
  await shot('3-forest-road');
  await page.click('#sheet .close');
}

// 3. Today panel.
await jump([HERE.longitude, HERE.latitude], 13); await settle(1000);
await page.click('#btn-today');
await page.waitForFunction(() => /Legal shooting hours/.test(document.querySelector('#sheet-body').innerText), null, { timeout: 20000 });
const today = await sheet();
log('Today:', today.split('\n').filter(l => /°|Deer, hogs|Dove, ducks|lit|Major|White-tailed|Open|Closed/.test(l)).slice(0, 8).join(' | '));
await shot('4-today');
await page.click('#sheet .close');

// 4. Measure: three taps make a triangle.
await page.click('#btn-measure');
const b = await page.locator('#map').boundingBox();
for (const [dx, dy] of [[-80, -60], [90, -40], [10, 90]]) await page.mouse.click(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy);
log('Measure:', await page.locator('#measurebar .text').innerText());
await shot('5-measure');
await page.click('#measurebar .done');

// 5. Pin with a kind and a photo, then share, then guide to it.
await page.click('#btn-pin');
await page.click('#place-here');
await page.click('[data-kind="truck"]');
await page.fill('#pin-notes', 'Parked at the gate');
await page.setInputFiles('#pin-photo', path.resolve(import.meta.dirname, '..', 'public', 'icon-512.png'));
await page.waitForSelector('#pin-photos img');
await shot('6-pin-edit');
await page.click('#pin-save');
await page.waitForTimeout(800);
await jump([HERE.longitude + 0.004, HERE.latitude + 0.003], 15); await settle(1000);
const pinXY = await page.evaluate(([x, y]) => window.huntingMap.project([x, y]), [HERE.longitude, HERE.latitude]);
await page.mouse.click(b.x + pinXY.x, b.y + pinXY.y);
await page.waitForSelector('#pin-go');
log('Pin sheet:', (await sheet()).split('\n').slice(0, 3).join(' | '));
await shot('7-pin-view');
await page.click('#pin-share');
await page.waitForTimeout(500);
log('Shared text:', (await page.evaluate(() => navigator.clipboard.readText()).catch(() => '(none)')).replace(/\n/g, ' / '));
// Walk 300 m away, then guide back.
await context.setGeolocation({ longitude: HERE.longitude + 0.003, latitude: HERE.latitude + 0.002 });
await page.click('#pin-go');
await page.waitForFunction(() => /yd|mi/.test(document.querySelector('#guidebar .text').innerText), null, { timeout: 15000 });
log('Guide:', (await page.locator('#guidebar .text').innerText()).replace(/\n/g, ' '));
await shot('8-go-to-truck');
await page.click('#guide-stop');

// 6. Offline: sightings, roads and Today still work.
await context.setOffline(true);
if (server) { server.kill(); await page.waitForTimeout(1000); }
await page.reload();
await page.waitForFunction(() => window.huntingMap?.loaded(), null, { timeout: 60000 });
await jump([-95.45, 30.55], 11); await settle(4000);
log('OFFLINE sightings on screen:', await page.evaluate(() => window.huntingMap.queryRenderedFeatures({ layers: ['sight-dots'] }).length),
  '| roads:', await page.evaluate(() => window.huntingMap.queryRenderedFeatures({ layers: ['roads-road', 'roads-trail', 'roads-ohv'] }).length));
await page.click('#btn-today');
await page.waitForFunction(() => /Legal shooting hours/.test(document.querySelector('#sheet-body').innerText), null, { timeout: 20000 });
log('OFFLINE Today weather line:', (await sheet()).split('\n').find(l => /Saved forecast|Needs signal/.test(l)) || '(none)');
await shot('9-offline-today');

log('Page errors:', errors.length ? errors : 'none');
await browser.close();
