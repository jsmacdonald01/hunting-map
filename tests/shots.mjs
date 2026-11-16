// Takes screenshots for eyeballing the look. Usage: OWN_SERVER=1 node tests/shots.mjs [name-prefix]
// Views: phone and desktop, flat and tilted, at chosen times of day (minutes after midnight, or "now").
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const prefix = process.argv[2] || 'look';
const OUT = path.resolve(import.meta.dirname, 'screenshots', 'look');
fs.mkdirSync(OUT, { recursive: true });
let server = null;
if (process.env.OWN_SERVER) { server = spawn(process.execPath, [path.resolve(import.meta.dirname, '..', 'server.mjs')], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500)); }

const SPOT = [-95.127, 30.612]; // creek country near Coldspring, inside Sam Houston NF
const VIEWS = (process.env.VIEWS || 'phone-flat,phone-tilt,desk-tilt').split(',');
const TIMES = (process.env.TIMES || 'now').split(',');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
for (const view of VIEWS) {
  const phone = view.startsWith('phone');
  const ctx = await browser.newContext({ viewport: phone ? { width: 430, height: 900 } : { width: 1280, height: 800 }, deviceScaleFactor: phone ? 2 : 1 });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(view + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(view + ' console: ' + m.text().slice(0, 200)); });
  await page.goto(`http://localhost:${process.env.PORT || 8765}/` + (process.env.QUERY || ''));
  await page.waitForFunction(() => window.huntingMap?.loaded(), null, { timeout: 90000 });
  const tilt = view.endsWith('tilt');
  await page.evaluate(([c, tilt]) => window.huntingMap.jumpTo({ center: c, zoom: tilt ? 13.6 : 13, pitch: tilt ? 62 : 0, bearing: tilt ? -30 : 0 }), [SPOT, tilt]);
  for (const t of TIMES) {
    if (t !== 'now') await page.evaluate(m => window.huntingTime?.set(Number(m)), t);
    await page.waitForFunction(() => window.huntingMap.areTilesLoaded(), null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(Number(process.env.WAIT || 3500));
    await page.screenshot({ path: path.join(OUT, `${prefix}-${view}-${t}.png`) });
    console.log('saved', `${prefix}-${view}-${t}.png`);
  }
  await ctx.close();
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
server?.kill();
