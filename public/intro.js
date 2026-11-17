// The opening fly-in: from the whole globe, down to Texas, then to where you last were (or where you're standing).
// It only plays on a fresh start, a tap skips it, and it never plays with reduced motion, lite graphics or no signal.
import { map, homeView, whenReady, GLOBE } from './map.js';
import { $, introWanted, introTap, reducedMotion } from './core.js';

const root = document.documentElement;
const wait = ms => new Promise(r => setTimeout(r, ms));
// Resolves when the camera stops, or right away if `gone` says the fly-in was skipped.
const flight = (opts, gone) => new Promise(resolve => {
  if (gone()) return resolve();
  map.once('moveend', resolve);
  map.flyTo({ essential: true, ...opts });
});

// If the phone already lets us see your location, land there instead of on the last view. Never asks permission.
async function whereAmI() {
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    if (perm?.state !== 'granted') return null;
    return await new Promise(resolve => {
      setTimeout(() => resolve(null), 3000);
      navigator.geolocation.getCurrentPosition(p => resolve([p.coords.longitude, p.coords.latitude]), () => resolve(null), { maximumAge: 600000, timeout: 2800 });
    });
  } catch { return null; }
}

let playing = false;
export async function runIntro({ replay = false } = {}) {
  if (playing || reducedMotion) return;
  playing = true;
  const tilt = localStorage.getItem('view3d') !== '0';
  const target = replay
    ? { center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }
    : { center: homeView.center, zoom: homeView.zoom, bearing: homeView.firstVisit ? -18 : homeView.bearing, pitch: tilt ? Math.max(homeView.pitch, 55) : 0 };
  if (target.zoom < 8) target.zoom = 10;

  const overlay = $('#intro');
  root.classList.add('intro');
  overlay.classList.remove('out');
  overlay.hidden = false;
  if (replay) { // a fresh start already begins out in space (see map.js)
    map.setTerrain(null);
    map.setProjection(GLOBE);
    map.jumpTo({ center: [-98.5, 39], zoom: 1.4, pitch: 0, bearing: 0 });
  }

  if (replay) introTap.skipped = false;
  const gone = () => introTap.skipped;
  const skip = () => { introTap.skipped = true; map.stop(); };
  introTap.onSkip = () => map.stop();
  const bail = setTimeout(skip, 14000); // never get stuck out in space

  const fix = replay ? null : whereAmI();
  await new Promise(r => whenReady(r));
  if (!gone()) await Promise.race([new Promise(r => map.once('idle', r)), wait(2200)]); // let the globe's pictures arrive
  await flight({ center: [-99.2, 31.3], zoom: 5.1, duration: 2600, curve: 1.1 }, gone);
  const here = await Promise.race([fix, wait(50)]);
  if (here) { target.center = here; target.zoom = Math.max(target.zoom, 14); }
  await flight({ ...target, duration: 4200, curve: 1.45 }, gone);

  clearTimeout(bail);
  introTap.onSkip = null;
  map.jumpTo(target); // exact landing (and the whole trip, if skipped)
  map.setProjection({ type: 'mercator' });
  root.classList.remove('intro');
  overlay.classList.add('out');
  setTimeout(() => { overlay.hidden = true; }, 750);
  playing = false;
}

export { introWanted };
