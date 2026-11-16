// Keeps the app smooth and easy on the battery.
// - One shared clock runs every moving effect, and stops when the app is hidden or nobody has touched it for a while.
// - If the phone is struggling (or low on battery) the fancy effects switch themselves off.
import { map } from './map.js';
import { on, emit, reducedMotion } from './core.js';

// Graphics level: 2 = everything, 1 = no moving effects (wind, pulses), 0 = also no 3D ground.
const choice = localStorage.getItem('gfx') || 'auto'; // 'auto' | 'full' | 'lite'
export const perf = {
  choice,
  level: choice === 'lite' ? 1 : 2,
  idle: false,
  reduced: reducedMotion,
};
const IDLE_AFTER = 30000;

export function setGraphics(c) {
  perf.choice = c;
  localStorage.setItem('gfx', c);
  setLevel(c === 'lite' ? 1 : 2, true);
}
function setLevel(level, fromUser = false) {
  if (level === perf.level) return;
  perf.level = level;
  emit('graphics', { level, fromUser });
  pump();
}
function stepDown(why) {
  if (perf.choice !== 'auto' || perf.level === 0) return;
  setLevel(perf.level - 1);
  emit('toast', why);
}

// ---------- The shared clock ----------
const jobs = new Set();
let raf = 0;
export function animate(fps, fn, { minLevel = 2 } = {}) {
  const job = { every: 1000 / fps, last: 0, fn, minLevel };
  jobs.add(job);
  pump();
  return { stop() { jobs.delete(job); } };
}
const canRun = () => !perf.idle && !perf.reduced && document.visibilityState === 'visible';
function pump() {
  if (raf || !jobs.size || !canRun()) return;
  raf = requestAnimationFrame(tick);
}
function tick(t) {
  raf = 0;
  for (const j of jobs) {
    if (perf.level < j.minLevel || t - j.last < j.every - 2) continue;
    const dt = j.last ? Math.min(t - j.last, 200) : j.every;
    j.last = t;
    j.fn(t, dt / 1000);
  }
  pump();
}

// ---------- Resting when nobody is looking ----------
let idleTimer = 0;
export function wake() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { perf.idle = true; emit('idle', true); }, IDLE_AFTER);
  if (perf.idle) { perf.idle = false; emit('idle', false); }
  pump();
}
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, wake, { passive: true, capture: true });
map.on('movestart', wake);
document.addEventListener('visibilitychange', () => { emit('idle', !canRun()); if (canRun()) wake(); });
wake();

// ---------- Noticing a struggling phone ----------
// While a finger is moving the map, time the frames. Two slow drags in a row and we lighten the load.
let frames = [], strikes = 0, dragging = false;
map.on('movestart', e => { dragging = !!e.originalEvent; frames = []; });
map.on('render', () => { if (dragging) frames.push(performance.now()); });
map.on('moveend', () => {
  if (!dragging || frames.length < 30) return;
  dragging = false;
  const span = frames[frames.length - 1] - frames[0];
  const fps = (frames.length - 1) / span * 1000;
  if (span > 1200 && fps < 38) { if (++strikes >= 2) { strikes = 0; stepDown('Lighter graphics on, to keep the map smooth.'); } }
  else if (fps > 50) strikes = 0;
});

// Low battery (where the phone tells us).
navigator.getBattery?.().then(b => {
  const check = () => { if (!b.charging && b.level <= 0.2) stepDown('Battery is low, so moving effects are off.'); };
  b.addEventListener('levelchange', check);
  check();
}).catch(() => {});

// iPhones don't share battery level, but Low Power Mode halves the screen's refresh rate. Check once things settle.
map.once('idle', () => setTimeout(() => {
  if (!canRun() || navigator.webdriver) return;
  const stamps = [];
  const probe = t => {
    stamps.push(t);
    if (stamps.length < 24) return requestAnimationFrame(probe);
    const gaps = stamps.slice(1).map((s, i) => s - stamps[i]).sort((a, b) => a - b);
    if (gaps[gaps.length >> 1] > 30) stepDown('Phone is saving power, so moving effects are off.');
  };
  requestAnimationFrame(probe);
}, 1500));

on('idle', () => pump());

// Tell the page's styling too, so looping CSS animations and frosted glass follow along.
const root = document.documentElement;
const paintClasses = () => { root.classList.toggle('fx-lite', perf.level < 2); root.classList.toggle('fx-rest', !canRun() || perf.level < 2); };
on('graphics', paintClasses);
on('idle', paintClasses);
paintClasses();
