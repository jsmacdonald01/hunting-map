// Pins: dropping them, their pictures, notes and photos, and sharing.
import { map } from './map.js';
import { db } from './db.js';
import { $, $$, esc, newId, emit, PIN_TYPES } from './core.js';
import { openSheet, closeSheet, shareThing } from './ui.js';

export const pinKind = p => PIN_TYPES[p.type] || PIN_TYPES.other;

export async function refreshPins() {
  const pins = await db.all('pins');
  map.getSource('pins')?.setData({ type: 'FeatureCollection', features: pins.map(p => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { id: p.id, name: p.name, type: PIN_TYPES[p.type] ? p.type : 'other' } })) });
  emit('pins-changed', pins);
  return pins;
}

// Draws each pin kind's picture once so the map can use it: a dark badge with a colored ring.
export function addPinIcons() {
  for (const [type, [, emoji, color]] of Object.entries(PIN_TYPES)) {
    const s = 96, c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2);
    g.fillStyle = '#141a16'; g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.9)'; g.stroke();
    g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 10, 0, Math.PI * 2);
    g.lineWidth = 7; g.strokeStyle = color; g.stroke();
    g.font = '46px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(emoji, s / 2, s / 2 + 3);
    if (!map.hasImage('pin-' + type)) map.addImage('pin-' + type, g.getImageData(0, 0, s, s), { pixelRatio: 1 });
  }
}

// Shrinks a phone photo so it doesn't fill up the phone's storage.
async function shrinkPhoto(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(resolve => c.toBlob(resolve, 'image/jpeg', 0.8));
}

const mapsLink = (lat, lng) => `https://maps.apple.com/?ll=${lat.toFixed(6)},${lng.toFixed(6)}&q=${lat.toFixed(6)},${lng.toFixed(6)}`;

// ---------- Placing a new pin ----------
function startPlacing() {
  closeSheet();
  $('#crosshair').hidden = false; $('#placebar').hidden = false;
  $('#btn-pin').classList.add('on');
}
function stopPlacing() {
  $('#crosshair').hidden = true; $('#placebar').hidden = true;
  $('#btn-pin').classList.remove('on');
}
export const placing = () => !$('#placebar').hidden;
$('#btn-pin').onclick = () => (placing() ? stopPlacing() : startPlacing());
$('#place-cancel').onclick = stopPlacing;
$('#place-here').onclick = () => { const c = map.getCenter(); stopPlacing(); editPin({ lng: c.lng, lat: c.lat }); };
$('#place-gps').onclick = () => {
  navigator.geolocation.getCurrentPosition(
    p => { stopPlacing(); editPin({ lng: p.coords.longitude, lat: p.coords.latitude }); },
    () => alert('Couldn’t get your location. Check that location is allowed for this app.'),
    { enableHighAccuracy: true, timeout: 15000 });
};

// ---------- Editing and viewing ----------
function photoThumbs(photos, removable) {
  return (photos || []).map((b, i) => `<span class="thumb"><img src="${URL.createObjectURL(b)}" data-photo="${i}" alt="Pin photo">${removable ? `<button data-rmphoto="${i}" aria-label="Remove photo">×</button>` : ''}</span>`).join('');
}

function editPin(pin) {
  const isNew = !pin.id;
  let type = PIN_TYPES[pin.type] ? pin.type : 'other';
  const photos = [...(pin.photos || [])];
  const typeButtons = () => Object.entries(PIN_TYPES).map(([k, [label, emoji]]) =>
    `<button type="button" class="kind ${k === type ? 'on' : ''}" data-kind="${k}">${emoji} ${label}</button>`).join('');
  openSheet(`<h2>${isNew ? 'New pin' : 'Edit pin'}</h2>
    <div class="kinds" id="pin-kinds">${typeButtons()}</div>
    <label>Name<input type="text" id="pin-name" value="${esc(pin.name || '')}" placeholder="Optional — uses the kind if blank"></label>
    <label>Notes<textarea id="pin-notes">${esc(pin.notes || '')}</textarea></label>
    <div id="pin-photos" class="thumbs">${photoThumbs(photos, true)}</div>
    <label class="filebtn">📷 Add photo<input type="file" id="pin-photo" accept="image/*" hidden></label>
    <div class="note">${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}</div>
    <div class="row"><button class="primary" id="pin-save">Save</button><button id="pin-cancel">Cancel</button></div>`);
  const wirePhotos = () => {
    $('#pin-photos').innerHTML = photoThumbs(photos, true);
    $$('[data-rmphoto]').forEach(b => b.onclick = () => { photos.splice(+b.dataset.rmphoto, 1); wirePhotos(); });
  };
  wirePhotos();
  $('#pin-kinds').onclick = e => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    type = b.dataset.kind;
    $('#pin-kinds').innerHTML = typeButtons();
  };
  $('#pin-photo').onchange = async e => {
    for (const f of e.target.files) photos.push(await shrinkPhoto(f));
    e.target.value = '';
    wirePhotos();
  };
  $('#pin-cancel').onclick = closeSheet;
  $('#pin-save').onclick = async () => {
    await db.put('pins', { ...pin, id: pin.id || newId(), type, photos, name: $('#pin-name').value.trim() || PIN_TYPES[type][0],
      notes: $('#pin-notes').value, created: pin.created || new Date().toISOString() });
    await refreshPins(); closeSheet();
  };
}

export async function showPin(pinId) {
  const p = await db.get('pins', pinId);
  if (!p) return;
  const [label, emoji] = pinKind(p);
  openSheet(`<h2>${emoji} ${esc(p.name)}</h2>
    ${p.name !== label ? `<div class="note">${esc(label)}</div>` : ''}
    ${p.notes ? `<p style="white-space:pre-wrap">${esc(p.notes)}</p>` : ''}
    <div class="thumbs">${photoThumbs(p.photos)}</div>
    <div id="pin-scent" class="note"></div>
    <div class="note">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} · ${new Date(p.created).toLocaleString()}</div>
    <div class="row"><button class="primary" id="pin-go">Take me here</button><button id="pin-share">Share</button>
      <button id="pin-edit">Edit</button><button class="danger" id="pin-del">Delete</button></div>`);
  $$('[data-photo]').forEach(img => img.onclick = () => window.open(img.src, '_blank'));
  $('#pin-go').onclick = () => { closeSheet(); emit('goto', p); };
  $('#pin-share').onclick = () => shareThing({ title: p.name,
    text: `${p.name}${p.notes ? ' — ' + p.notes : ''}\n${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}\n${mapsLink(p.lat, p.lng)}` });
  $('#pin-edit').onclick = () => editPin(p);
  $('#pin-del').onclick = async () => { if (confirm('Delete this pin?')) { await db.del('pins', p.id); await refreshPins(); closeSheet(); } };
  emit('pin-selected', p); // lights the ring and the scent cone
}
