// Checks the visual features: 3D ground, compass, map-type fade, time of day, wind, scent fan, effects, intro, night mode.
// Usage: OWN_SERVER=1 node tests/visuals.mjs   (PORT=8766 to use another port)
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const URL = `http://localhost:${process.env.PORT || 8765}/`;
let server = null;
if (process.env.OWN_SERVER) { server = spawn(process.execPath, [path.resolve(import.meta.dirname, '..', 'server.mjs')], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500)); }

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const HERE = { longitude: -95.456, latitude: 30.556 };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 430, height: 900 }, geolocation: HERE, permissions: ['geolocation'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());
const ready = () => page.waitForFunction(() => window.huntingMap?.loaded(), null, { timeout: 90000 });
const map = fn => page.evaluate(fn);

await page.goto(URL);
await ready();
await page.reload(); // second load runs under the offline helper
await ready();
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 30000 });

// ---------- 3D ground ----------
check('3D ground is on at start', await map(() => !!window.huntingMap.getTerrain()));
await page.click('#btn-3d');
await page.waitForFunction(() => !window.huntingMap.getTerrain() && window.huntingMap.getPitch() === 0, null, { timeout: 5000 }).catch(() => {});
check('2D button flattens the map', await map(() => !window.huntingMap.getTerrain() && window.huntingMap.getPitch() === 0));
await page.click('#btn-3d');
await page.waitForFunction(() => window.huntingMap.getPitch() > 40, null, { timeout: 5000 }).catch(() => {});
check('3D button tilts and restores the ground', await map(() => !!window.huntingMap.getTerrain() && window.huntingMap.getPitch() > 40));

await map(() => window.huntingMap.jumpTo({ bearing: 70 }));
await page.click('#btn-compass');
await page.waitForFunction(() => Math.abs(window.huntingMap.getBearing()) < 0.5, null, { timeout: 5000 }).catch(() => {});
check('Compass turns the map north-up', await map(() => Math.abs(window.huntingMap.getBearing()) < 0.5));

// ---------- Map type fade ----------
await page.click('#btn-layers');
await page.click('[data-base="hybrid"]');
await page.waitForTimeout(1600);
check('Hybrid shows topo lines over satellite', await map(() => { const m = window.huntingMap; return m.getPaintProperty('usgstopo', 'raster-opacity') === 0.5 && m.getPaintProperty('esri', 'raster-opacity') === 1; }));
await page.click('[data-base="sat"]');
await page.waitForTimeout(2600);
check('Back to satellite hides topo', await map(() => window.huntingMap.getLayoutProperty('usgstopo', 'visibility') === 'none'));
await page.click('#btn-layers');

// ---------- Time of day ----------
const skyAt = m => page.evaluate(m => { window.huntingTime.set(m); return JSON.stringify([window.huntingMap.getSky()['sky-color'], window.huntingMap.getPaintProperty('hillshade', 'hillshade-illumination-direction')]); }, m);
const dawn = await skyAt(400), noon = await skyAt(720), night = await skyAt(1380);
check('Sky and sun direction change through the day', dawn !== noon && noon !== night, `dawn ${dawn} noon ${noon}`);
check('Time pill shows the chosen time', /6:40/.test(await page.locator('#time-label').innerText()) || (await skyAt(400), /6:40/.test(await page.locator('#time-label').innerText())));
await page.click('#timepill');
check('Time slider opens with legal light times', /Legal light/i.test(await page.locator('#timebar').innerText()));
await page.click('#time-now');
check('"Now" returns to the live time', !(await page.locator('#timepill').getAttribute('class')).includes('scrub'));
await page.click('#timepill');

// ---------- Wind and scent ----------
await page.waitForFunction(() => document.querySelector('#wind-label').textContent.trim().length > 0, null, { timeout: 20000 }).catch(() => {});
const windLabel = await page.locator('#wind-label').innerText();
check('Wind shows in the time pill', windLabel.trim().length > 0, windLabel.trim());
await map(() => window.huntingMap.jumpTo({ center: [-95.456, 30.556], zoom: 15, pitch: 0, bearing: 0 }));
await page.waitForTimeout(1500);
await page.click('#btn-pin');
await page.click('#place-here');
await page.click('[data-kind="stand"]');
await page.click('#pin-save');
await page.waitForTimeout(700);
const box = await page.locator('#map').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForSelector('#pin-go');
await page.waitForTimeout(500);
const scent = await map(async () => { const d = await window.huntingMap.getSource('scent').getData(); return (d.features || [d]).filter(f => f.geometry).length; });
check('Scent fan draws from the selected pin', scent >= 1, `${scent} shapes; ${(await page.locator('#pin-scent').innerText()).slice(0, 70)}`);
if (process.env.STAGE !== 'b') {
  check('Selected pin gets a ring', await page.locator('.pin-ring').count() === 1);
}
await page.click('#sheet .close');
await page.waitForTimeout(400);
check('Scent fan clears when the card closes', await map(async () => { const d = await window.huntingMap.getSource('scent').getData(); return (d.features || []).length === 0; }));

if (process.env.STAGE !== 'b') {
  // ---------- GPS dot ----------
  await page.click('#btn-locate');
  await page.waitForSelector('.gps', { timeout: 10000 });
  check('Locate button shows the GPS dot', await page.locator('.gps .dot').count() === 1);
  await page.click('#btn-locate'); // following -> off

  // ---------- Night mode ----------
  await page.click('#btn-night');
  check('Night button turns on red mode', await page.evaluate(() => document.documentElement.classList.contains('night') && !document.querySelector('#nightveil').hidden));
  await page.click('#btn-night');

  // ---------- Opening fly-in (forced on for the test) ----------
  const p2 = await context.newPage();
  p2.on('pageerror', e => errors.push('intro: ' + e.message));
  await p2.goto(URL + '?intro=1');
  await p2.waitForSelector('#intro:not([hidden])', { timeout: 30000 });
  check('Fly-in starts far out with the controls hidden', await p2.evaluate(() => document.documentElement.classList.contains('intro') && window.huntingMap.getZoom() < 6));
  await p2.click('#intro');
  await p2.waitForFunction(() => !document.documentElement.classList.contains('intro') && window.huntingMap.getZoom() > 8, null, { timeout: 25000 }).catch(() => {});
  check('A tap skips the fly-in and lands on the map', await p2.evaluate(() => !document.documentElement.classList.contains('intro') && window.huntingMap.getZoom() > 8));
  await p2.close();
  const p3 = await context.newPage();
  await p3.goto(URL + '?intro=1');
  await p3.waitForFunction(() => window.huntingMap && !document.documentElement.classList.contains('intro') && window.huntingMap.getZoom() > 8, null, { timeout: 40000 }).catch(() => {});
  check('Fly-in finishes by itself', await p3.evaluate(() => !document.documentElement.classList.contains('intro') && window.huntingMap.getZoom() > 8 && !!window.huntingMap.getTerrain()));
  await p3.close();
}

// ---------- Reduced motion: no fly-in, no moving effects ----------
if (process.env.STAGE !== 'b') {
  const calm = await browser.newContext({ viewport: { width: 430, height: 900 }, reducedMotion: 'reduce' });
  const p4 = await calm.newPage();
  await p4.goto(URL);
  await p4.waitForFunction(() => window.huntingMap?.loaded(), null, { timeout: 90000 });
  await p4.waitForTimeout(4000);
  const still = await p4.evaluate(() => {
    const c = document.querySelector('#wind'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let ink = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) ink++;
    return { ink, reduced: window.huntingPerf.reduced, intro: document.documentElement.classList.contains('intro') };
  });
  check('Reduced motion: no wind streaks and no fly-in', still.reduced && still.ink === 0 && !still.intro, JSON.stringify(still));
  await calm.close();
}

// ---------- Offline: the app still opens with no signal ----------
await context.setOffline(true);
await page.reload();
await ready();
await page.waitForTimeout(4000);
check('App opens offline with the new look', await page.evaluate(() => !!document.querySelector('#tools') && window.huntingMap.loaded()));
check('Wind falls back to the saved forecast offline', (await page.locator('#wind-label').innerText()).trim().length > 0);

check('No page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
await browser.close();
server?.kill();
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
