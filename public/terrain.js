// The 3D ground: real hills and creek bottoms, the 2D/3D switch, and the compass button.
import { map, whenReady } from './map.js';
import { $, on, reducedMotion } from './core.js';
import { perf } from './perf.js';

// East Texas is gentle country, so heights are stretched to make ridges and drainages easy to read.
const EXAGGERATION = 2.2;
const TILT = 58;
const view = { on: localStorage.getItem('view3d') !== '0', ready: false };
export const is3dOn = () => view.on;

function meshWanted() { return view.on && perf.level >= 1; }

function applyMesh() {
  const want = meshWanted();
  const has = !!map.getTerrain();
  if (want && !has) map.setTerrain({ source: 'dem', exaggeration: EXAGGERATION });
  if (!want && has) map.setTerrain(null);
  // A 3x-sharp phone screen makes the 3D ground three times the work for little gain, so 3D draws at 2x.
  const dpr = window.devicePixelRatio || 1;
  map.setPixelRatio(view.on ? Math.min(dpr, perf.level >= 2 ? 2 : 1.5) : dpr);
}

// Switches between flat and 3D. `move: false` just sets things up without swinging the camera.
export function apply3d({ move = true } = {}) {
  document.documentElement.classList.toggle('view-3d', view.on);
  $('#btn-3d').classList.toggle('on', view.on);
  $('#btn-3d .lbl').textContent = view.on ? '3D' : '2D';
  $('#btn-3d').title = view.on ? 'Switch to flat map' : 'Switch to 3D map';
  if (view.on) {
    map.setMaxPitch(75);
    map.touchPitch.enable();
    applyMesh();
    if (move && map.getPitch() < 20) map.easeTo({ pitch: TILT, duration: reducedMotion ? 0 : 900, essential: true });
  } else {
    map.touchPitch.disable();
    const flat = () => { map.setMaxPitch(0); applyMesh(); };
    if (move && map.getPitch() > 0.5 && !reducedMotion) {
      map.easeTo({ pitch: 0, duration: 700, essential: true });
      map.once('moveend', () => { if (!view.on) flat(); });
    } else { map.setPitch(0); flat(); }
  }
}

$('#btn-3d').onclick = () => {
  view.on = !view.on;
  localStorage.setItem('view3d', view.on ? '1' : '0');
  apply3d();
};

// Compass: the needle shows north; a tap turns the map north-up.
const needle = $('#btn-compass svg');
const turnNeedle = () => { needle.style.transform = `rotate(${-map.getBearing()}deg)`; };
map.on('rotate', turnNeedle);
$('#btn-compass').onclick = () => map.easeTo({ bearing: 0, duration: reducedMotion ? 0 : 600, essential: true });

map.on('moveend', () => {
  if (document.documentElement.classList.contains('intro')) return; // don't remember the view from space
  localStorage.setItem('view', JSON.stringify({ center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }));
});
on('graphics', () => { if (view.ready) applyMesh(); });

// Called once at start (after the opening fly-in, if there is one).
export function start3d(opts) {
  whenReady(() => { view.ready = true; turnNeedle(); apply3d(opts); });
}
