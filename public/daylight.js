// Time of day: the sun's real position lights the hills and colors the sky, from dawn gold to night.
// The slider scrubs through today so you can see first and last light before a sit.
import { map, whenReady } from './map.js';
import { sunPosition, sunTimes } from './astro.js';
import { $, on, emit, state, clamp } from './core.js';

// Looks keyed to how high the sun is (degrees above the horizon). Colors are [red, green, blue, strength].
const LOOKS = [
  { alt: -14, name: 'Night',       sky: [5, 10, 24, 1],     horizon: [13, 24, 48, 1],    fog: [10, 19, 38, 1],    tint: [6, 14, 40, .52],   shadow: [0, 4, 16, .6],    light: [140, 170, 255, .1],  shade: .35 },
  { alt: -6,  name: 'Twilight',    sky: [27, 37, 80, 1],    horizon: [196, 104, 74, 1],  fog: [92, 76, 94, 1],    tint: [22, 30, 72, .36],  shadow: [10, 12, 40, .6],  light: [255, 170, 120, .2],  shade: .5 },
  { alt: 0,   name: 'Sun on the horizon', sky: [95, 134, 200, 1], horizon: [255, 176, 102, 1], fog: [240, 185, 138, 1], tint: [255, 150, 70, .17], shadow: [30, 20, 60, .62], light: [255, 205, 130, .45], shade: .85 },
  { alt: 8,   name: 'Golden light', sky: [110, 168, 232, 1], horizon: [255, 224, 176, 1], fog: [244, 220, 192, 1], tint: [255, 190, 120, .08], shadow: [20, 24, 50, .55], light: [255, 232, 180, .36], shade: .7 },
  { alt: 25,  name: 'Full daylight', sky: [111, 177, 242, 1], horizon: [220, 236, 255, 1], fog: [230, 240, 250, 1], tint: [255, 255, 255, 0],   shadow: [8, 16, 28, .5],   light: [255, 248, 225, .26], shade: .5 },
];
const GREY = [154, 163, 171, 1];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const css = ([r, g, b, a]) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${(+a).toFixed(3)})`;
const solid = c => css([c[0], c[1], c[2], 1]);

function lookFor(alt) {
  if (alt <= LOOKS[0].alt) return LOOKS[0];
  for (let i = 1; i < LOOKS.length; i++) {
    const a = LOOKS[i - 1], b = LOOKS[i];
    if (alt <= b.alt) {
      const t = (alt - a.alt) / (b.alt - a.alt), out = { name: t < .5 ? a.name : b.name, shade: a.shade + (b.shade - a.shade) * t };
      for (const k of ['sky', 'horizon', 'fog', 'tint', 'shadow', 'light']) out[k] = mix(a[k], b[k], t);
      return out;
    }
  }
  return LOOKS[LOOKS.length - 1];
}

// ---------- What time are we showing? ----------
let scrub = null;      // minutes after midnight while the slider is in use; null means "right now"
let mood = 'clear';    // from the weather: clear, overcast, rain, fog
export const shownTime = () => {
  if (scrub == null) return new Date();
  const d = new Date(); d.setHours(0, scrub, 0, 0); return d;
};
export const isLive = () => scrub == null;
const hm = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

let ready = false, last = '';
function paint() {
  if (!ready) return;
  const c = map.getCenter(), when = shownTime();
  const sun = sunPosition(when, c.lat, c.lng);
  const look = lookFor(sun.altitude);
  const dull = mood === 'clear' ? 0 : mood === 'overcast' ? .55 : .7; // cloud flattens the light and greys the sky
  const baseShade = state.base === 'topo' ? .35 : state.base === 'hybrid' ? .8 : 1; // the topo map already has its own shading
  const up = sun.altitude > -4;

  // Skip the work if nothing would change (the sun moves slowly).
  const key = [Math.round(sun.altitude * 4), Math.round(sun.azimuth), mood, state.base].join();
  if (key !== last) {
    last = key;
    map.setPaintProperty('hillshade', 'hillshade-illumination-direction', up ? Math.round(sun.azimuth) : 315);
    map.setPaintProperty('hillshade', 'hillshade-illumination-altitude', clamp(up ? sun.altitude : 30, 9, 50));
    map.setPaintProperty('hillshade', 'hillshade-exaggeration', look.shade * baseShade * (1 - dull * .6));
    map.setPaintProperty('hillshade', 'hillshade-shadow-color', css(look.shadow));
    map.setPaintProperty('hillshade', 'hillshade-accent-color', css([look.shadow[0], look.shadow[1], look.shadow[2], look.shadow[3] * .5]));
    map.setPaintProperty('hillshade', 'hillshade-highlight-color', css(mix(look.light, [200, 205, 210, look.light[3] * .5], dull)));
    const wet = mood === 'rain' ? [70, 82, 96, Math.max(look.tint[3], .3)] : [GREY[0], GREY[1], GREY[2], Math.max(look.tint[3], .16)];
    const tint = mix(look.tint, wet, dull ? .9 : 0);
    map.setPaintProperty('tint', 'background-color', solid(tint));
    map.setPaintProperty('tint', 'background-opacity', tint[3]);
    map.setSky({
      'sky-color': solid(mix(look.sky, GREY, dull * .75)), 'horizon-color': solid(mix(look.horizon, GREY, dull * .6)), 'fog-color': solid(mix(look.fog, GREY, dull * .5)),
      'sky-horizon-blend': .6, 'horizon-fog-blend': .7, 'fog-ground-blend': mood === 'fog' ? .15 : mood === 'rain' ? .4 : .6,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, .6, 9, 0],
    });
  }
  labels(when, sun, look, c);
  emit('daylight', { when, live: scrub == null, altitude: sun.altitude, azimuth: sun.azimuth });
}

// ---------- The pill and slider ----------
function labels(when, sun, look, c) {
  $('#time-label').textContent = hm(when);
  $('#timepill').classList.toggle('scrub', scrub != null);
  if ($('#timebar').hidden) return;
  const s = sunTimes(when, c.lat, c.lng);
  const first = new Date(s.sunrise - 30 * 60000), lastLight = new Date(+s.sunset + 30 * 60000);
  const legal = when >= first && when <= lastLight;
  $('#time-big').textContent = hm(when);
  $('#time-sub').innerHTML = `${look.name}${legal ? '' : ' · outside legal shooting light'}<br>Legal light ${hm(first)} – ${hm(lastLight)} · sun ${hm(s.sunrise)} – ${hm(s.sunset)}`;
  if (scrub == null) $('#time-slider').value = when.getHours() * 60 + when.getMinutes();
}

// Colors the slider's track like the day itself: dark at night, gold at the edges, blue at midday.
function paintTrack() {
  const c = map.getCenter(), d = new Date(), stops = [];
  for (let m = 0; m <= 1440; m += 30) {
    d.setHours(0, m, 0, 0);
    const l = lookFor(sunPosition(d, c.lat, c.lng).altitude);
    stops.push(`${solid(mix(l.sky, l.horizon, .45))} ${(m / 14.4).toFixed(1)}%`);
  }
  $('#time-slider').style.setProperty('--daylight', `linear-gradient(90deg, ${stops.join(',')})`);
}

$('#timepill').onclick = () => {
  const bar = $('#timebar');
  bar.hidden = !bar.hidden;
  if (!bar.hidden) { paintTrack(); paint(); }
};
let queued = 0;
$('#time-slider').oninput = e => {
  scrub = +e.target.value;
  if (!queued) queued = requestAnimationFrame(() => { queued = 0; paint(); });
};
$('#time-now').onclick = () => { scrub = null; paint(); };

on('base', paint);
on('weather-mood', m => { if (m !== mood) { mood = m; paint(); } });
setInterval(() => { if (scrub == null && document.visibilityState === 'visible') paint(); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') paint(); });
map.on('moveend', () => { if (map.getZoom() < 9) paint(); }); // far-apart places have different sun times

whenReady(() => { ready = true; paint(); });

// For tests and screenshots: window.huntingTime.set(390) shows 6:30 AM; .live() goes back to now.
window.huntingTime = { set(m) { scrub = m; $('#time-slider').value = m; paint(); }, live() { scrub = null; paint(); }, mood(m) { state.forcedMood = m; emit('weather-mood', m); } };
