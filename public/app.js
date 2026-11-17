// Starts the app and ties the parts together. Each part lives in its own file:
//   map.js (the map and its layers)   layers.js (map type, sightings, roads)   parcels.js (property lines)
//   pins.js   tracks.js   menu.js   gps.js   terrain.js (3D)   tools.js (measure, go-to)   conditions.js (Today)
import { map, whenReady } from './map.js';
import { db } from './db.js';
import { $, esc, state, on, emit } from './core.js';
import { openSheet, closeSheet, setHighlight } from './ui.js';
import { startLayers, checkOnline, closeLayersPanel, sightingHtml, roadHtml, publicHtml } from './layers.js';
import { addCountyLayers, updateParcelLayers, savedParcelLayers, inBbox, identifyOnline, parcelHtml } from './parcels.js';
import { addPinIcons, refreshPins, showPin, placing, pinKind } from './pins.js';
import { refreshTracks, recoverTracks } from './tracks.js';
import { setupMeasure, setupGuide } from './tools.js';
import { conditionsHtml } from './conditions.js';
import { start3d } from './terrain.js';
import { lastFix } from './gps.js';
import './menu.js';
import './daylight.js';
import './wind.js';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
navigator.storage?.persist?.();

// ---------- Tapping the map ----------
const visibleLayers = ids => ids.filter(l => map.getLayer(l) && map.getLayoutProperty(l, 'visibility') !== 'none');
const near = (point, layers, px) => {
  const ls = visibleLayers(layers);
  return ls.length ? map.queryRenderedFeatures([[point.x - px, point.y - px], [point.x + px, point.y + px]], { layers: ls }) : [];
};

map.on('click', async e => {
  if (placing()) return;
  if (measure.tap(e.lngLat)) return;
  closeLayersPanel();

  const pin = near(e.point, ['pins'], 16)[0];
  if (pin) return showPin(pin.properties.id);

  const extra = sightingHtml(near(e.point, ['sight-dots'], 10)) + roadHtml(near(e.point, ['roads-road', 'roads-ohv', 'roads-trail'], 8));
  const pub = visibleLayers(['pub-fill']).length ? map.queryRenderedFeatures(e.point, { layers: ['pub-fill'] }) : [];
  const parcelLayers = savedParcelLayers();
  const local = parcelLayers.length ? map.queryRenderedFeatures(e.point, { layers: parcelLayers }).find(f => f.properties.county) : null;

  let html = '';
  if (local) {
    setHighlight(local, local.properties.owner);
    html = parcelHtml(local.properties);
  } else if (state.online && map.getZoom() >= 11) {
    openSheet('<div class="note">Looking up this property…</div>' + extra + publicHtml(pub));
    try {
      const r = await identifyOnline(e.lngLat);
      if (r) { if (r.geo) setHighlight(r.geo, r.props.owner); html = parcelHtml(r.props); }
      else html = '<h2>No property record here</h2>';
    } catch {
      html = '<h2>Couldn’t reach the property lookup</h2><div class="note">Try again, or download this county for offline use.</div>';
    }
  } else if (map.getZoom() < 14 && parcelLayers.length && state.counties.some(c => inBbox(e.lngLat.toArray(), c.bbox))) {
    html = '<h2>Zoom in closer</h2><div class="note">Owner info for downloaded counties shows when you’re zoomed in close.</div>';
  } else if (!pub.length && !extra) {
    html = state.online ? '<h2>Zoom in to see property info</h2>'
      : '<h2>No saved property info here</h2><div class="note">This spot isn’t in a downloaded county. Use Menu → Download maps while you have signal.</div>';
  }
  openSheet(html + extra + publicHtml(pub));
});

// ---------- Measure ----------
const measure = setupMeasure(map, {
  bar: $('#measurebar'),
  onStart: () => { closeSheet(); $('#btn-measure').classList.add('on'); },
  onStop: () => $('#btn-measure').classList.remove('on'),
});
$('#btn-measure').onclick = () => (measure.active() ? measure.stop() : measure.start());

// ---------- Go to a pin ----------
const guide = setupGuide(map, { bar: $('#guidebar') });
const startGuide = pin => { $('#btn-goto').classList.add('on'); guide.start(pin); emit('guiding', true); };
const stopGuide = () => { guide.stop(); $('#btn-goto').classList.remove('on'); emit('guiding', false); };
$('#guide-stop').onclick = stopGuide;
on('goto', startGuide);
$('#btn-goto').onclick = async () => {
  if (guide.active()) return stopGuide();
  const pins = (await db.all('pins')).sort((a, b) => (b.type === 'truck') - (a.type === 'truck') || b.created.localeCompare(a.created));
  if (!pins.length) return openSheet('<h2>Go to a pin</h2><div class="note">Drop a pin first (tip: pick “Truck / parking” where you park). Then this guides you back to it.</div>');
  openSheet(`<h2>Go to a pin</h2><div class="note">Shows an arrow and distance to the pin. Trucks are listed first.</div>`
    + pins.map(p => `<div class="item"><div class="grow">${pinKind(p)[1]} <b>${esc(p.name)}</b></div><button data-goto="${p.id}" class="primary">Go</button></div>`).join(''));
  document.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => { closeSheet(); startGuide(pins.find(p => p.id === b.dataset.goto)); });
};

// ---------- Today ----------
$('#btn-today').onclick = async () => {
  const c = map.getCenter();
  openSheet('<h2>Today</h2><div class="note">Loading…</div>');
  const fix = lastFix();
  const where = fix ? [fix[1], fix[0]] : await new Promise(resolve => navigator.geolocation
    ? navigator.geolocation.getCurrentPosition(p => resolve([p.coords.latitude, p.coords.longitude]), () => resolve([c.lat, c.lng]), { timeout: 4000, maximumAge: 600000 })
    : resolve([c.lat, c.lng]));
  openSheet(await conditionsHtml(where[0], where[1], state.online));
};

// ---------- Zoom buttons (PC) and red night mode ----------
$('#btn-zoom-in').onclick = () => map.zoomIn();
$('#btn-zoom-out').onclick = () => map.zoomOut();

function setNight(night) {
  document.documentElement.classList.toggle('night', night);
  $('#nightveil').hidden = !night;
  $('#btn-night').classList.toggle('on', night);
  localStorage.setItem('night', night ? '1' : '0');
}
$('#btn-night').onclick = () => setNight(!document.documentElement.classList.contains('night'));
on('night', setNight);
setNight(localStorage.getItem('night') === '1');

// ---------- Start ----------
map.on('moveend', updateParcelLayers);
whenReady(async () => {
  startLayers();
  addPinIcons();
  state.counties = await db.all('counties');
  state.counties.forEach(addCountyLayers);
  updateParcelLayers();
  await recoverTracks();
  await refreshPins();
  await refreshTracks();
  checkOnline();
  start3d({ move: false });
});
