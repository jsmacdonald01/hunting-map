// Walking paths: recording them and showing saved ones.
import { map } from './map.js';
import { db } from './db.js';
import { $, newId, miles, state, emit, EMPTY } from './core.js';
import { meters } from './tools.js';

export async function refreshTracks() {
  const tracks = await db.all('tracks');
  map.getSource('tracks')?.setData({ type: 'FeatureCollection', features: tracks
    .filter(t => !t.recording && !state.hiddenTracks.has(t.id) && t.points.length > 1)
    .map(t => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: t.points }, properties: { id: t.id } })) });
  return tracks;
}
export function saveHidden() { localStorage.setItem('hiddenTracks', JSON.stringify([...state.hiddenTracks])); }

let wakeLock = null;
async function keepAwake() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not allowed */ } }
document.addEventListener('visibilitychange', () => { if (state.rec && document.visibilityState === 'visible') keepAwake(); });

function recUpdate() {
  const r = state.rec;
  const mins = Math.round((Date.now() - new Date(r.started)) / 60000);
  $('#rectext').textContent = `Recording · ${miles(r.distance)} · ${mins} min · keep app open`;
  map.getSource('live').setData(r.points.length > 1 ? { type: 'Feature', geometry: { type: 'LineString', coordinates: r.points }, properties: {} } : EMPTY);
}
const setRecButton = on => { $('#btn-rec').classList.toggle('on', on); $('#btn-rec .lbl').textContent = on ? 'Stop' : 'Record'; };

async function startRecording() {
  state.rec = { id: newId(), name: '', started: new Date().toISOString(), points: [], distance: 0, recording: true };
  await db.put('tracks', state.rec);
  setRecButton(true);
  $('#recbar').hidden = false;
  keepAwake();
  emit('recording', true);
  let unsaved = 0;
  state.rec.watch = navigator.geolocation.watchPosition(p => {
    const r = state.rec;
    if (!r || p.coords.accuracy > 35) return;
    const pt = [+p.coords.longitude.toFixed(6), +p.coords.latitude.toFixed(6)];
    const last = r.points[r.points.length - 1];
    if (last) { const d = meters(last, pt); if (d < 4) return; r.distance += d; }
    r.points.push(pt);
    recUpdate();
    if (++unsaved >= 5) { unsaved = 0; const { watch, timer, ...rest } = r; db.put('tracks', rest); }
  }, err => { if (err.code === 1) alert('Location is turned off for this app, so the path can’t be recorded.'); },
  { enableHighAccuracy: true, maximumAge: 0 });
  state.rec.timer = setInterval(recUpdate, 30000);
  recUpdate();
}

async function stopRecording() {
  const r = state.rec;
  navigator.geolocation.clearWatch(r.watch); clearInterval(r.timer);
  wakeLock?.release?.(); wakeLock = null;
  state.rec = null;
  setRecButton(false);
  $('#recbar').hidden = true;
  emit('recording', false);
  map.getSource('live').setData(EMPTY);
  const name = prompt('Name this path', 'Walk ' + new Date(r.started).toLocaleDateString()) || 'Walk';
  const { watch, timer, ...rest } = r;
  await db.put('tracks', { ...rest, name, recording: false, ended: new Date().toISOString() });
  await refreshTracks();
  if (r.points.length > 1) emit('track-draw', r.points);
}
$('#btn-rec').onclick = () => (state.rec ? stopRecording() : startRecording());

// A path that was still recording when the app closed gets kept, not lost.
export async function recoverTracks() {
  for (const t of await db.all('tracks')) if (t.recording) await db.put('tracks', { ...t, recording: false, name: 'Walk ' + new Date(t.started).toLocaleDateString() + ' (unfinished)' });
}
