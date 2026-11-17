// Wind you can see: streaks drifting across the map the way the wind blows, a scent fan from the pin you pick,
// and a touch of weather mood (grey under cloud, streaks in rain, haze in fog).
import { map, whenReady } from './map.js';
import { getWeather, ARROWS } from './conditions.js';
import { $, on, emit, state, EMPTY } from './core.js';
import { animate, perf } from './perf.js';
import { shownTime } from './daylight.js';

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const degOf = name => POINTS.indexOf(name) * 22.5;
const nameOf = deg => POINTS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

let forecast = null;   // { at, periods: [{ t, wind: "10 mph", dir: "NNE", sky }] }
let wind = null;       // { from (degrees), mph, label, sky, when }
let shown = localStorage.getItem('wind') !== '0';
let pin = null;        // the pin whose scent fan is showing

// ---------- Forecast ----------
async function refresh() {
  const c = map.getCenter();
  const w = await getWeather(c.lat, c.lng); // falls back to the last saved forecast with no signal
  if (w) { forecast = w; pick(); }
}
// The forecast hour closest to the time being shown (now, or wherever the time slider is).
function pick() {
  if (!forecast?.periods?.length) return;
  // Sliding to an hour that has already passed today means you're planning tomorrow's sit, so use tomorrow's forecast.
  let t = +shownTime();
  const tomorrow = t < Date.now() - 45 * 60000;
  if (tomorrow) t += 24 * 3600000;
  const p = forecast.periods.reduce((best, x) => Math.abs(new Date(x.t) - t) < Math.abs(new Date(best.t) - t) ? x : best);
  const mph = parseInt(String(p.wind).split(' to ').pop(), 10) || 0;
  const next = { from: degOf(p.dir), mph, dir: p.dir, sky: p.sky, when: new Date(p.t), tomorrow, far: Math.abs(new Date(p.t) - t) > 2 * 3600000 };
  const changed = !wind || wind.from !== next.from || wind.mph !== next.mph;
  wind = next;
  $('#wind-label').innerHTML = mph < 1 ? 'Calm' : `<span class="wind" style="transform:rotate(${ARROWS[p.dir] ?? 0}deg)">↑</span> ${p.dir} ${mph}`;
  const sky = String(p.sky).toLowerCase();
  const mood = /rain|shower|drizzle|storm/.test(sky) ? 'rain' : /fog|mist|haze/.test(sky) ? 'fog' : /cloudy|overcast/.test(sky) && !/partly|mostly sunny/.test(sky) ? 'overcast' : 'clear';
  setMood(state.forcedMood || mood);
  if (changed) { emit('wind', wind); drawScent(); }
}
function setMood(mood) {
  $('#mood').className = mood === 'rain' || mood === 'fog' ? mood : '';
  emit('weather-mood', mood);
}
on('daylight', pick);
on('online', ok => ok && refresh());
on('weather-mood', m => { $('#mood').className = m === 'rain' || m === 'fog' ? m : ''; });
setInterval(() => { if (state.online && document.visibilityState === 'visible') refresh(); }, 20 * 60000);

// ---------- Streaks ----------
const canvas = $('#wind'), ctx = canvas.getContext('2d');
let W = 0, H = 0, parts = [], moving = false, dirty = false;
function size() {
  W = canvas.width = innerWidth; H = canvas.height = innerHeight; // plain 1x pixels: soft streaks don't need more, and it's 4-9x less work
  const n = Math.max(50, Math.min(200, Math.round(W * H / 8000)));
  parts = Array.from({ length: n }, spawn);
}
function spawn() { return { x: Math.random() * W, y: Math.random() * H, age: 0, life: 1.5 + Math.random() * 3 }; }
function clear() { if (dirty) { ctx.clearRect(0, 0, W, H); dirty = false; } }
addEventListener('resize', size);
size();

map.on('movestart', () => { moving = true; clear(); });
map.on('moveend', () => { moving = false; });

function step(_t, dt) {
  if (!shown || !wind || wind.mph < 1 || moving) return clear();
  // Wind blows TO the opposite of where it comes from. Turn that into a direction on screen.
  const a = (wind.from + 180 - map.getBearing()) * Math.PI / 180;
  const speed = 14 + wind.mph * 4.5;
  const vx = Math.sin(a) * speed * dt, vy = -Math.cos(a) * speed * dt * Math.cos(map.getPitch() * Math.PI / 180 * .8);
  // Fade what's already drawn, so each streak leaves a short tail.
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = 'rgba(0,0,0,.9)';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath();
  for (const p of parts) {
    const x0 = p.x, y0 = p.y;
    p.x += vx; p.y += vy; p.age += dt;
    if (p.age > p.life || p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) { Object.assign(p, spawn()); continue; }
    ctx.moveTo(x0, y0); ctx.lineTo(p.x, p.y);
  }
  ctx.lineWidth = 1.3; ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,.3)';
  ctx.stroke();
  dirty = true;
}
animate(30, step);
on('idle', resting => { if (resting) clear(); });
on('graphics', () => { if (perf.level < 2) clear(); });

$('#lyr-wind').checked = shown;
$('#lyr-wind').onchange = e => { shown = e.target.checked; localStorage.setItem('wind', shown ? '1' : '0'); if (!shown) clear(); };

// ---------- Scent fan ----------
// A point `dist` meters from [lng, lat] toward compass direction `deg`.
function away([lng, lat], deg, dist) {
  const r = deg * Math.PI / 180, dLat = dist * Math.cos(r) / 111320, dLng = dist * Math.sin(r) / (111320 * Math.cos(lat * Math.PI / 180));
  return [lng + dLng, lat + dLat];
}
function fan(from, toward, length, half, outer) {
  const pts = [from];
  for (let d = -half; d <= half; d += 4) pts.push(away(from, toward + d, length));
  pts.push(from);
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] }, properties: { outer } };
}
function drawScent() {
  const src = map.getSource('scent');
  if (!src) return;
  const note = $('#pin-scent');
  if (!pin) return src.setData(EMPTY);
  if (!wind) { src.setData(EMPTY); if (note) note.textContent = 'Wind and scent show here once the forecast has loaded (needs signal the first time).'; return; }
  const at = [pin.lng, pin.lat], to = wind.from + 180;
  const when = wind.when.toLocaleTimeString([], { hour: 'numeric' }) + (wind.tomorrow ? ' tomorrow' : '');
  if (wind.mph < 2) {
    const ring = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [Array.from({ length: 41 }, (_, i) => away(at, i * 9, 110))] }, properties: { outer: true } };
    src.setData(ring);
    if (note) note.textContent = `Nearly calm at ${when}: your scent pools around you and can drift any way.`;
    return;
  }
  // Three stacked fans, so the color is strongest close in and thins out with distance.
  const reach = 220 + wind.mph * 22;
  src.setData({ type: 'FeatureCollection', features: [fan(at, to, reach, 20, true), fan(at, to, reach * .62, 17, false), fan(at, to, reach * .3, 14, false)] });
  if (note) note.innerHTML = `<b>Scent:</b> wind from the ${wind.dir} at ${wind.mph} mph (${when} forecast${wind.far ? ', the closest hour available' : ''}) carries your scent toward the <b>${nameOf(to)}</b>. The orange fan shows where. Slide the time at the top to check other hours.`;
}
on('pin-selected', p => { pin = p; drawScent(); });
on('sheet-closed', () => { if (pin) { pin = null; drawScent(); } });

whenReady(refresh);
export const currentWind = () => wind;
