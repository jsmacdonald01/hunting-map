/* global maplibregl */
// Small moving touches: pins that glow and pulse, a ring on the pin you tapped, paths that draw themselves,
// flowing dashes on the go-to line, and hot spots that breathe. All share one slow clock (see perf.js),
// so they cost one map redraw per tick, and they stop when the app is idle, hidden, or on lighter graphics.
import { map, whenReady } from './map.js';
import { on, EMPTY } from './core.js';
import { animate, perf } from './perf.js';

let havePins = false, guiding = false, heat = false;
on('pins-changed', pins => { havePins = pins.length > 0; });
on('guiding', v => { guiding = v; if (!v) map.setPaintProperty('guide', 'line-dasharray', DASHES[0]); });
on('sightings', s => { heat = s.heat; if (!heat) map.setPaintProperty('sight-heat', 'heatmap-opacity', .75); });

// Dash patterns that, played in order, make the line look like it's flowing toward the pin.
const DASHES = [[0, 4, 3], [.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, .5], [3, 4, 0],
  [0, .5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, .5]];
let dash = -1;

whenReady(() => {
  animate(15, t => {
    const s = t / 1000;
    if (havePins && map.getZoom() >= 10) {
      const beat = (Math.sin(s * 2.6) + 1) / 2; // 0..1, about one pulse every 2.4 seconds
      map.setPaintProperty('pins-glow', 'circle-radius', 19 + beat * 9);
      map.setPaintProperty('pins-glow', 'circle-opacity', .6 - beat * .32);
    }
    if (guiding) {
      const next = Math.floor(s * 12) % DASHES.length;
      if (next !== dash) { dash = next; map.setPaintProperty('guide', 'line-dasharray', DASHES[dash]); }
    }
    if (heat) map.setPaintProperty('sight-heat', 'heatmap-opacity', .7 + Math.sin(s * 1.3) * .08);
  });
});
// Lighter graphics: leave everything at a calm, still setting.
on('graphics', () => {
  if (perf.level >= 2) return;
  map.setPaintProperty('pins-glow', 'circle-radius', 22);
  map.setPaintProperty('pins-glow', 'circle-opacity', .5);
});

// ---------- Ring on the tapped pin ----------
const ringEl = document.createElement('div');
ringEl.className = 'pin-ring';
ringEl.innerHTML = '<i></i><i></i>';
const ring = new maplibregl.Marker({ element: ringEl });
on('pin-selected', p => ring.setLngLat([p.lng, p.lat]).addTo(map));
on('sheet-closed', () => ring.remove());
// Keep the ring on its pin when the 3D ground finishes loading underneath it.
map.on('idle', () => { if (ring._map) ring.setLngLat(ring.getLngLat()); });

// ---------- Paths that draw themselves ----------
let drawing = null;
on('track-draw', points => {
  drawing?.stop();
  const src = map.getSource('trackDraw');
  if (!src || points.length < 2 || perf.level < 2 || perf.reduced) return;
  // Measure the path once so the pen moves at an even speed.
  const run = [0];
  for (let i = 1; i < points.length; i++) run.push(run[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const total = run[run.length - 1] || 1, started = performance.now(), TIME = 1600;
  const job = animate(40, t => {
    const k = Math.min(1, (t - started) / TIME), ease = 1 - (1 - k) ** 3, reach = ease * total;
    let i = 1;
    while (i < run.length - 1 && run[i] < reach) i++;
    const f = (reach - run[i - 1]) / ((run[i] - run[i - 1]) || 1);
    const tip = [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * f, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * f];
    src.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [...points.slice(0, i), tip] }, properties: {} });
    if (k >= 1) { job.stop(); drawing = null; setTimeout(() => src.setData(EMPTY), 500); }
  });
  drawing = job;
});
