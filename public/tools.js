// Measure tool and "Go to pin" (back to the truck) guide.
const EMPTY = { type: 'FeatureCollection', features: [] };
const R = 6371000, rad = Math.PI / 180;

export function meters([x1, y1], [x2, y2]) {
  const a = Math.sin((y2 - y1) * rad / 2) ** 2 + Math.cos(y1 * rad) * Math.cos(y2 * rad) * Math.sin((x2 - x1) * rad / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export function bearing([x1, y1], [x2, y2]) {
  const y = Math.sin((x2 - x1) * rad) * Math.cos(y2 * rad);
  const x = Math.cos(y1 * rad) * Math.sin(y2 * rad) - Math.sin(y1 * rad) * Math.cos(y2 * rad) * Math.cos((x2 - x1) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}
function acres(pts) {
  if (pts.length < 3) return 0;
  const ring = [...pts, pts[0]];
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    a += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad));
  }
  return Math.abs(a * R * R / 2) / 4046.86;
}
export const distText = m => m < 400 ? `${Math.round(m * 1.09361)} yd` : `${(m / 1609.34).toFixed(2)} mi`;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = b => COMPASS[Math.round(b / 45) % 8];

// ---------- Measure ----------
export function setupMeasure(map, { bar, onStart, onStop }) {
  let pts = null;
  const draw = () => {
    const feats = [];
    if (pts.length > 1) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} });
    if (pts.length > 2) feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] }, properties: {} });
    pts.forEach(p => feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} }));
    map.getSource('measure').setData({ type: 'FeatureCollection', features: feats });
    let d = 0;
    for (let i = 1; i < pts.length; i++) d += meters(pts[i - 1], pts[i]);
    bar.querySelector('.text').textContent = pts.length < 2 ? 'Tap the map to add points.'
      : `Distance: ${distText(d)}` + (pts.length > 2 ? ` · Area: ${acres(pts).toFixed(acres(pts) < 10 ? 2 : 1)} acres` : '');
  };
  const api = {
    active: () => !!pts,
    start() { pts = []; bar.hidden = false; onStart?.(); draw(); },
    stop() { pts = null; bar.hidden = true; map.getSource('measure').setData(EMPTY); onStop?.(); },
    tap(lngLat) { if (!pts) return false; pts.push([lngLat.lng, lngLat.lat]); draw(); return true; },
    undo() { if (pts?.length) { pts.pop(); draw(); } },
  };
  bar.querySelector('.undo').onclick = api.undo;
  bar.querySelector('.clear').onclick = () => { pts = []; draw(); };
  bar.querySelector('.done').onclick = api.stop;
  return api;
}

// ---------- Go to a pin ----------
export function setupGuide(map, { bar }) {
  let target = null, watch = null, heading = null, here = null;

  function onOrient(e) {
    // iPhone gives a true compass heading; others give alpha (counter-clockwise).
    if (typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === 'number') heading = 360 - e.alpha;
    update();
  }
  function update() {
    if (!target) return;
    const to = [target.lng, target.lat];
    if (!here) { bar.querySelector('.text').textContent = `Finding your location… (${target.name})`; return; }
    const d = meters(here, to), b = bearing(here, to);
    // With a compass, the arrow points the way to walk; without one, it points on the map (north is up).
    const rot = heading == null ? b - map.getBearing() : b - heading;
    bar.querySelector('.arrow').style.transform = `rotate(${rot}deg)`;
    bar.querySelector('.text').innerHTML = `<b>${target.name}</b><br>${distText(d)} ${compass(b)}${heading == null ? ' · arrow uses map (no compass)' : ''}`;
    map.getSource('guide').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [here, to] }, properties: {} });
  }

  return {
    active: () => !!target,
    async start(pin) {
      target = pin; bar.hidden = false;
      // iPhone asks permission for the compass; it must come from a tap, which this does.
      try { if (typeof DeviceOrientationEvent?.requestPermission === 'function') await DeviceOrientationEvent.requestPermission(); } catch { /* denied */ }
      window.addEventListener('deviceorientationabsolute', onOrient);
      window.addEventListener('deviceorientation', onOrient);
      watch = navigator.geolocation.watchPosition(p => { here = [p.coords.longitude, p.coords.latitude]; update(); },
        () => { bar.querySelector('.text').textContent = 'Can’t get your location. Check that location is allowed.'; },
        { enableHighAccuracy: true, maximumAge: 2000 });
      map.on('rotate', update);
      update();
    },
    stop() {
      target = null; bar.hidden = true;
      if (watch != null) navigator.geolocation.clearWatch(watch);
      window.removeEventListener('deviceorientationabsolute', onOrient);
      window.removeEventListener('deviceorientation', onOrient);
      map.off('rotate', update);
      map.getSource('guide').setData(EMPTY);
    },
  };
}
