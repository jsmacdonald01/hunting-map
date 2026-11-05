// Draws the app icon and saves the sizes phones need. Usage: node scripts/make-icons.mjs
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = path.resolve(import.meta.dirname, '..', 'public');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#1f2a1c"/>
  <g fill="none" stroke="#4f6b3f" stroke-width="10">
    <path d="M-20 360 C 90 300, 160 420, 280 350 S 450 290, 540 340"/>
    <path d="M-20 420 C 100 360, 170 480, 290 410 S 450 350, 540 400"/>
    <path d="M-20 160 C 80 120, 170 220, 280 150 S 440 100, 540 140"/>
  </g>
  <circle cx="256" cy="256" r="120" fill="none" stroke="#ff8c00" stroke-width="22"/>
  <path d="M256 96 V196 M256 316 V416 M96 256 H196 M316 256 H416" stroke="#ff8c00" stroke-width="22" stroke-linecap="round"/>
  <circle cx="256" cy="256" r="14" fill="#ff8c00"/>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await page.screenshot({ path: path.join(OUT, name) });
}
await browser.close();
console.log('Icons saved');
