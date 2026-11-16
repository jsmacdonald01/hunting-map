/* global maplibregl */
// "Where am I": a blue dot with a soft halo showing how exact the fix is, and a cone showing which way you face.
import { map } from './map.js';
import { $, emit, EMPTY } from './core.js';
import { toast, flyToSpot } from './ui.js';

const btn = $('#btn-locate');
let watch = null, follow = false, here = null, marker = null, compass = null, firstFix = true;

const el = document.createElement('div');
el.className = 'gps';
el.innerHTML = '<i class="cone"></i><i class="halo"></i><i class="dot"></i>';

// A circle on the ground `radius` meters wide, for the accuracy halo.
function circle([lng, lat], radius) {
  const pts = [], dLat = radius / 111320, dLng = dLat / Math.cos(lat * Math.PI / 180);
  for (let i = 0; i <= 40; i++) { const a = i / 40 * 2 * Math.PI; pts.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]); }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] }, properties: {} };
}

function setHeading(deg) {
  el.classList.toggle('has-heading', deg != null);
  if (deg != null) marker?.setRotation(deg);
}
function onOrient(e) {
  // iPhone gives a true compass heading; others give alpha (counter-clockwise).
  if (typeof e.webkitCompassHeading === 'number') compass = e.webkitCompassHeading;
  else if (e.absolute && typeof e.alpha === 'number') compass = 360 - e.alpha;
  else return;
  setHeading(compass);
}

function onFix(p) {
  const { longitude: lng, latitude: lat, accuracy, heading, speed } = p.coords;
  here = [lng, lat];
  if (!marker) marker = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(here).addTo(map);
  else marker.setLngLat(here);
  // Moving: the phone knows your direction of travel. Standing still: use the compass.
  if (speed > 0.7 && heading != null && !Number.isNaN(heading)) setHeading(heading);
  else if (compass == null) setHeading(null);
  map.getSource('gps')?.setData(accuracy > 8 ? circle(here, accuracy) : EMPTY);
  emit('gps', { lng, lat, accuracy });
  if (firstFix) { firstFix = false; flyToSpot(here, Math.max(map.getZoom(), 15)); }
  else if (follow && !map.isMoving()) map.easeTo({ center: here, duration: 600 });
}

async function start() {
  if (!navigator.geolocation) return toast('This device can’t share its location.');
  // iPhone asks permission for the compass; it must come from a tap, which this is.
  try { if (typeof DeviceOrientationEvent?.requestPermission === 'function') await DeviceOrientationEvent.requestPermission(); } catch { /* denied */ }
  window.addEventListener('deviceorientationabsolute', onOrient);
  window.addEventListener('deviceorientation', onOrient);
  follow = true; firstFix = true;
  watch = navigator.geolocation.watchPosition(onFix, err => {
    toast(err.code === 1 ? 'Location is turned off for this app. Allow it in your phone’s settings.' : 'Still looking for your location…');
    if (err.code === 1) stop();
  }, { enableHighAccuracy: true, maximumAge: 2000 });
  paint();
}
function stop() {
  if (watch != null) navigator.geolocation.clearWatch(watch);
  window.removeEventListener('deviceorientationabsolute', onOrient);
  window.removeEventListener('deviceorientation', onOrient);
  watch = null; follow = false; here = null; compass = null;
  marker?.remove(); marker = null;
  map.getSource('gps')?.setData(EMPTY);
  paint();
}
function paint() {
  btn.classList.toggle('on', watch != null);
  btn.classList.toggle('follow', follow);
  btn.title = watch == null ? 'Show where I am' : follow ? 'Following you. Tap to turn off' : 'Tap to centre on me';
}

// First tap: find me and follow. If you've moved the map away: tap to come back. Tap while following: off.
btn.onclick = () => {
  if (watch == null) return start();
  if (!follow && here) { follow = true; flyToSpot(here, Math.max(map.getZoom(), 15)); return paint(); }
  stop();
};
map.on('dragstart', () => { if (follow) { follow = false; paint(); } });

export const lastFix = () => here;
