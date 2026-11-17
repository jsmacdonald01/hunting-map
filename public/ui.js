/* global maplibregl */
// Things on top of the map: the slide-up card, pop-up messages, the tapped-property outline, and camera moves.
import { map } from './map.js';
import { $, emit, on, EMPTY, reducedMotion } from './core.js';

// ---------- Slide-up card ----------
let closeTimer = 0;
export function openSheet(html) {
  const s = $('#sheet');
  clearTimeout(closeTimer);
  s.classList.remove('closing');
  $('#sheet-body').innerHTML = html;
  s.hidden = false; // the slide-in is a CSS animation that plays whenever the card appears
  s.scrollTop = 0;
}
export function closeSheet() {
  const s = $('#sheet');
  if (!s.hidden && !reducedMotion) {
    s.classList.add('closing');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { s.hidden = true; s.classList.remove('closing'); }, 170);
  } else s.hidden = true;
  setHighlight(null);
  emit('sheet-closed');
}
export const sheetOpen = () => !$('#sheet').hidden && !$('#sheet').classList.contains('closing');
$('#sheet .close').onclick = closeSheet;

// ---------- Short pop-up message ----------
let toastTimer = 0;
export function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}
on('toast', toast);

// ---------- Street View and Google Maps links for a spot ----------
export function spotLinks(lat, lng) {
  const at = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  return `<div class="row links">
      <a class="btnlink" id="link-street" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${at}" target="_blank" rel="noopener">Street View</a>
      <a class="btnlink" href="https://www.google.com/maps/search/?api=1&query=${at}" target="_blank" rel="noopener">Google Maps</a>
    </div>
    <div class="note">Street View opens in Google Maps. It only has pictures along roads, and needs signal.</div>`;
}

// ---------- Sharing ----------
export async function shareThing({ title, text, file }) {
  try {
    if (file && navigator.canShare?.({ files: [file] })) return await navigator.share({ title, text, files: [file] });
    if (navigator.share) return await navigator.share({ title, text });
  } catch (e) { if (e.name === 'AbortError') return; }
  // No share sheet (e.g. on a PC): copy the text, or save the file.
  if (file) { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); return; }
  try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into a text message.'); } catch { prompt('Copy this:', text); }
}

// ---------- Tapped property outline ----------
// Middle of a shape's outer edge, good enough for placing a name.
function middle(geo) {
  const ring = geo.type === 'Polygon' ? geo.coordinates[0] : geo.type === 'MultiPolygon' ? geo.coordinates[0][0] : null;
  if (!ring?.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}
export function setHighlight(feature, label) {
  const src = map.getSource('highlight');
  if (!src) return;
  const show = v => {
    map.setPaintProperty('highlight', 'line-opacity', v);
    map.setPaintProperty('highlight-glow', 'line-opacity', v * 0.75);
    map.setPaintProperty('highlight-label', 'text-opacity', v);
  };
  if (!feature) { show(0); src.setData(EMPTY); return; }
  const feats = [{ type: 'Feature', geometry: feature.geometry, properties: {} }];
  const mid = label && middle(feature.geometry);
  if (mid) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: mid }, properties: { label } });
  show(0); // start see-through so it fades in
  src.setData({ type: 'FeatureCollection', features: feats });
  requestAnimationFrame(() => show(1));
}

// ---------- Camera moves ----------
const R = Math.PI / 180;
function bearingTo([x1, y1], [x2, y2]) {
  const y = Math.sin((x2 - x1) * R) * Math.cos(y2 * R);
  const x = Math.cos(y1 * R) * Math.sin(y2 * R) - Math.sin(y1 * R) * Math.cos(y2 * R) * Math.cos((x2 - x1) * R);
  return (Math.atan2(y, x) / R + 360) % 360;
}
export const is3d = () => document.documentElement.classList.contains('view-3d');

// Glide to a spot on a curved path. In 3D the camera also tilts and swings round to face the way it flew.
export function flyToSpot(center, zoom = 16, opts = {}) {
  const from = map.getCenter().toArray();
  const far = Math.hypot(center[0] - from[0], center[1] - from[1]) > 0.002;
  const cam = { center, zoom, essential: true };
  if (is3d()) {
    cam.pitch = opts.pitch ?? 58;
    if (far) cam.bearing = bearingTo(from, center);
  }
  if (reducedMotion) return map.jumpTo(cam);
  map.flyTo({ ...cam, curve: 1.5, speed: 0.9, maxDuration: 4500, ...opts });
}
export function flyToBounds(bbox, opts = {}) {
  const b = new maplibregl.LngLatBounds([bbox[0], bbox[1]], [bbox[2], bbox[3]]);
  map.fitBounds(b, { padding: 70, pitch: is3d() ? 45 : 0, essential: true, animate: !reducedMotion, curve: 1.5, maxDuration: 4500, ...opts });
}
