/* global maplibregl */
// "Where am I": a blue dot with a soft halo showing how exact the fix is, and a cone showing which way you face.
import { map } from './map.js';
import { $, emit, EMPTY } from './core.js';
import { toast, flyToSpot, openSheet } from './ui.js';

const btn = $('#btn-locate');
let watch = null, follow = false, here = null, marker = null, compass = null, firstFix = true;

// Two pieces: the dot and "YOU" tag always stand upright and full size, however the map is tilted or turned;
// the direction cone lies on the ground and turns with the way you face.
const el = document.createElement('div');
el.className = 'gps';
el.innerHTML = '<i class="halo"></i><i class="halo late"></i><i class="dot"></i><b class="you">YOU</b>';
const coneEl = document.createElement('div');
coneEl.className = 'gps-cone';
coneEl.innerHTML = '<i></i>';
let coneMarker = null;

// A circle on the ground `radius` meters wide, for the accuracy halo.
function circle([lng, lat], radius) {
  const pts = [], dLat = radius / 111320, dLng = dLat / Math.cos(lat * Math.PI / 180);
  for (let i = 0; i <= 40; i++) { const a = i / 40 * 2 * Math.PI; pts.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]); }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] }, properties: {} };
}

function setHeading(deg) {
  coneEl.classList.toggle('has-heading', deg != null);
  if (deg != null) coneMarker?.setRotation(deg);
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
  if (!marker) {
    coneMarker = new maplibregl.Marker({ element: coneEl, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(here).addTo(map);
    marker = new maplibregl.Marker({ element: el }).setLngLat(here).addTo(map);
  } else { marker.setLngLat(here); coneMarker.setLngLat(here); }
  // Moving: the phone knows your direction of travel. Standing still: use the compass.
  if (speed > 0.7 && heading != null && !Number.isNaN(heading)) setHeading(heading);
  else if (compass == null) setHeading(null);
  map.getSource('gps')?.setData(accuracy > 8 ? circle(here, accuracy) : EMPTY);
  emit('gps', { lng, lat, accuracy });
  if (firstFix) {
    firstFix = false;
    flyToSpot(here, Math.max(map.getZoom(), 15));
    if (needsCompassOk && !compassAsked) toast('Found you. Tap the locate button once more to show which way you’re facing.');
  }
  else if (follow && !map.isMoving()) map.easeTo({ center: here, duration: 600 });
}

// What to do when the phone refuses to share location. The phone's own words go at the bottom, to help track it down.
function showBlocked(err) {
  openSheet(`<h2>Your phone is blocking location</h2>
    <div class="note">The app asked, and the phone said no. On an iPhone, check these, then close the app fully and open it again:</div>
    <ol class="steps">
      <li>Open <b>Settings</b> → <b>Privacy &amp; Security</b> → <b>Location Services</b>. Make sure it is <b>on</b>.</li>
      <li>In that same list, tap <b>Safari Websites</b> and choose <b>While Using the App</b>. Turn on <b>Precise Location</b>.</li>
      <li>Go back to <b>Settings</b> → <b>Apps</b> → <b>Safari</b> → <b>Location</b> and choose <b>Ask</b> or <b>Allow</b>.</li>
      <li>Swipe Hunting Map away to close it, open it again, and tap the locate button. Tap <b>Allow</b> when asked.</li>
    </ol>
    <div class="note"><b>Works in Safari but not from the home screen icon?</b> Press and hold the Hunting Map icon and remove it.
    Open the site in Safari, tap the locate button and allow location there, then use Share → Add to Home Screen again.</div>
    <div class="note">Home screen apps use Safari's location setting, which is why Hunting Map isn't listed by name.</div>
    <div class="note dim" id="gps-diag">Phone said: ${err?.message ? String(err.message).replace(/[<>&]/g, '') : 'permission denied'} (code ${err?.code ?? '?'})</div>`);
  // Extra clues for tracking the problem down: home-screen app or Safari, what the phone has on file, and how fast it said no.
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const fast = Date.now() - askedAt < 1500 ? 'instantly (no question shown)' : `after ${Math.round((Date.now() - askedAt) / 1000)}s`;
  Promise.resolve(navigator.permissions?.query({ name: 'geolocation' })).then(p => p?.state, () => 'unknown').then(state => {
    const d = document.querySelector('#gps-diag');
    if (d) d.textContent += ` · ${standalone ? 'home-screen app' : 'browser'} · on file: ${state || 'unknown'} · refused ${fast}`;
  });
}
let askedAt = 0;

function start() {
  if (!navigator.geolocation) return toast('This device can’t share its location.');
  follow = true; firstFix = true; askedAt = Date.now();
  // Ask for location first, in the same instant as the tap. (Asking for the compass first and waiting for that
  // answer can make an iPhone drop the location question.)
  let denied = 0;
  const begin = () => navigator.geolocation.watchPosition(onFix, err => {
    if (err.code !== 1) return toast('Still looking for your location…');
    navigator.geolocation.clearWatch(watch);
    // One quiet second try: iPhones sometimes say no while their own permission question is still on screen.
    if (++denied === 1) { setTimeout(() => { if (watch != null) watch = begin(); }, 1500); return; }
    stop();
    showBlocked(err);
  }, { enableHighAccuracy: true, maximumAge: 2000 });
  watch = begin();
  // The compass (for the direction cone) is asked for separately, on a later tap. A home-screen app on an iPhone
  // can only show one permission question at a time, and asking both together made it refuse location.
  window.addEventListener('deviceorientationabsolute', onOrient);
  window.addEventListener('deviceorientation', onOrient);
  paint();
}
const needsCompassOk = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
let compassAsked = false;
function askCompass() {
  compassAsked = true;
  try { DeviceOrientationEvent.requestPermission().catch(() => {}); } catch { /* not supported */ }
}
function stop() {
  if (watch != null) navigator.geolocation.clearWatch(watch);
  window.removeEventListener('deviceorientationabsolute', onOrient);
  window.removeEventListener('deviceorientation', onOrient);
  watch = null; follow = false; here = null; compass = null;
  marker?.remove(); marker = null;
  coneMarker?.remove(); coneMarker = null;
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
  if (here && needsCompassOk && !compassAsked) { askCompass(); follow = true; flyToSpot(here, Math.max(map.getZoom(), 15)); return paint(); }
  if (!follow && here) { follow = true; flyToSpot(here, Math.max(map.getZoom(), 15)); return paint(); }
  stop();
};
map.on('dragstart', () => { if (follow) { follow = false; paint(); } });

// The 3D ground can finish loading after a marker was placed, which leaves the marker floating off its spot.
// Re-seat both pieces whenever new ground data arrives or the map settles.
const reseat = () => { if (here && marker) { marker.setLngLat(here); coneMarker.setLngLat(here); } };
map.on('idle', reseat);
map.on('data', e => { if (e.sourceId === 'dem' && e.tile) reseat(); });

export const lastFix = () => here;
