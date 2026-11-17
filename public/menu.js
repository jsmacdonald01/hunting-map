/* global maplibregl */
// The Menu card: county downloads, saved pins and paths, display settings, and where the map data comes from.
import { map } from './map.js';
import { db } from './db.js';
import { $, $$, esc, fmtBytes, miles, state, emit, DISCLAIMER } from './core.js';
import { downloadCounty, removeCounty, estimateBytes, REGION, REGION_PARTS, regionParts, regionEstimate, regionBbox, downloadRegion, removeRegion } from './offline.js';
import { openSheet, closeSheet, sheetOpen, shareThing, flyToSpot, flyToBounds } from './ui.js';
import { addCountyLayers, removeCountyLayers, updateParcelLayers } from './parcels.js';
import { refreshTracks, saveHidden } from './tracks.js';
import { pinKind, showPin } from './pins.js';
import { perf, setGraphics } from './perf.js';

let menuTab = 'download';
$('#btn-menu').onclick = () => renderMenu();

export async function renderMenu(tab = menuTab) {
  menuTab = tab;
  const t = (key, label) => `<button data-tab="${key}" class="${tab === key ? 'on' : ''}">${label}</button>`;
  const tabs = `<div class="tabs">${t('download', 'Download maps')}${t('saved', 'Pins &amp; paths')}${t('display', 'Display')}${t('about', 'Map info')}</div>`;
  let body = '';
  if (tab === 'download') body = await downloadsHtml();
  if (tab === 'saved') body = await savedHtml();
  if (tab === 'display') body = displayHtml();
  if (tab === 'about') body = aboutHtml();
  openSheet(tabs + body);
  $$('[data-tab]').forEach(b => b.onclick = () => renderMenu(b.dataset.tab));
  if (tab === 'download') wireDownloads();
  if (tab === 'saved') wireSaved();
  if (tab === 'display') wireDisplay();
}

// ---------- Downloads ----------
let available = [];
let activeDownload = null;
let wantSharp = localStorage.getItem('dlSharp') === '1';

async function downloadsHtml() {
  try { available = await (await fetch('data/counties.json')).json(); } catch { /* keep last list */ }
  const have = new Map(state.counties.map(c => [c.id, c]));
  let storage = '';
  try { const s = await navigator.storage.estimate(); storage = `Using ${fmtBytes(s.usage || 0)} on this device.`; } catch { /* unsupported */ }
  const rows = available.map(c => {
    const h = have.get(c.key);
    const busy = activeDownload?.key === c.key;
    const needs3d = h && !h.terrain;
    return `<div class="item"><div class="grow"><b>${esc(c.name)} County</b>
        <small>${c.parcels.toLocaleString()} properties · ${c.blankOwners.toLocaleString()} without owner names · about ${fmtBytes(estimateBytes(c, wantSharp))}</small>
        <small>${h ? `Downloaded ${new Date(h.date).toLocaleDateString()}${h.failed ? ` · ${h.failed} pieces missed — tap Update` : ''}${needs3d ? ' · tap Update to add the 3D ground for offline' : ''}${h.sharp ? ' · extra sharp' : wantSharp ? ' · tap Update to add extra sharp photos' : ''}` : 'Not downloaded'}</small>
        ${busy ? `<progress id="dl-prog" max="1" value="0"></progress><small id="dl-text">Starting…</small>` : ''}</div>
      ${busy ? '<button id="dl-stop">Stop</button>'
        : `<button data-dl="${c.key}" ${activeDownload ? 'disabled' : ''} class="${h && !needs3d && !(wantSharp && !h.sharp) ? '' : 'primary'}">${h ? 'Update' : 'Download'}</button>
           ${h ? `<button data-show="${c.key}">Show</button><button data-rm="${c.key}" class="danger">Remove</button>` : ''}`}</div>`;
  }).join('') || '<div class="note">Couldn’t load the county list. Check your signal and try again.</div>';
  return `<div class="note">Downloads save satellite, topo, the 3D ground, property lines and owner names onto this device so they work with no signal.
    Use Wi-Fi if you can, and keep the app open until it finishes.</div>
    <label class="switch"><input type="checkbox" id="dl-sharp" ${wantSharp ? 'checked' : ''} ${activeDownload ? 'disabled' : ''}> Extra sharp offline photos</label>
    <div class="note">Adds the state's 2022 aerial photo at twice the detail when you zoom in with no signal. Roughly triples each county's size and takes a good while longer.</div>
    ${rows}
    ${regionHtml()}
    <div class="note">${storage}</div>`;
}

// The wide-area map for when the grid is down: roads and rail, topo, and a satellite picture, each saved separately.
function regionHtml() {
  const have = regionParts();
  const rows = Object.entries(REGION_PARTS).map(([part, info]) => {
    const h = have[part], busy = activeDownload?.key === 'region:' + part;
    return `<div class="item"><div class="grow"><b>${info.label}</b>
        <small>${info.hint} About ${fmtBytes(regionEstimate(part))}.</small>
        <small>${h ? `Downloaded ${new Date(h.date).toLocaleDateString()}${h.failed ? ` · ${h.failed} pieces missed — tap Update` : ''}` : 'Not downloaded'}</small>
        ${busy ? `<progress id="dl-prog" max="1" value="0"></progress><small id="dl-text">Starting…</small>` : ''}</div>
      ${busy ? '<button id="dl-stop">Stop</button>'
        : `<button data-region="${part}" ${activeDownload ? 'disabled' : ''} class="${h ? '' : 'primary'}">${h ? 'Update' : 'Download'}</button>
           ${h ? `<button data-rmregion="${part}" class="danger">Remove</button>` : ''}`}</div>`;
  }).join('');
  return `<h3>Grid-down map: ${REGION.name}</h3>
    <div class="note">Saves the whole area from Galveston and Freeport up past Huntsville, so you can find your way with no signal and no power grid.
    Start with roads and rail: it is small and shows every side road, track and railroad. These are big downloads, so use Wi-Fi, plug the phone in, and keep the app open.
    <button id="region-show" class="inline">Show the area</button></div>${rows}`;
}

function wireDownloads() {
  $$('[data-dl]').forEach(b => b.onclick = () => startDownload(b.dataset.dl));
  $('#dl-sharp').onchange = e => { wantSharp = e.target.checked; localStorage.setItem('dlSharp', wantSharp ? '1' : '0'); renderMenu('download'); };
  $$('[data-show]').forEach(b => b.onclick = () => {
    const c = state.counties.find(x => x.id === b.dataset.show);
    if (c) { closeSheet(); flyToBounds(c.bbox); }
  });
  $$('[data-rm]').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this county from this device?')) return;
    b.disabled = true; b.textContent = 'Removing…';
    await removeCounty(b.dataset.rm);
    removeCountyLayers(b.dataset.rm);
    state.counties = await db.all('counties');
    updateParcelLayers();
    renderMenu('download');
  });
  const stop = $('#dl-stop');
  if (stop) stop.onclick = () => activeDownload?.ctl.abort();
  $$('[data-region]').forEach(b => b.onclick = () => startRegion(b.dataset.region));
  $$('[data-rmregion]').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this part of the grid-down map from this device?')) return;
    b.disabled = true; b.textContent = 'Removing…';
    await removeRegion(b.dataset.rmregion);
    renderMenu('download');
  });
  $('#region-show').onclick = () => { closeSheet(); flyToBounds(regionBbox(), { pitch: 0 }); };
}

async function startRegion(part) {
  const ctl = new AbortController();
  activeDownload = { key: 'region:' + part, ctl };
  await renderMenu('download');
  const t0 = Date.now();
  try {
    await downloadRegion(part, (done, total, bytes) => {
      const prog = $('#dl-prog'), text = $('#dl-text');
      if (prog) { prog.max = total; prog.value = done; }
      const mins = Math.round((Date.now() - t0) / 60000), left = done > 200 ? Math.round((Date.now() - t0) / done * (total - done) / 60000) : null;
      if (text) text.textContent = `${Math.round(done / total * 100)}% · ${fmtBytes(bytes)} saved · ${mins} min${left != null ? ` · about ${left} min left` : ''}`;
    }, ctl.signal);
    emit('region-saved', part);
  } catch (e) {
    if (e.message !== 'Stopped') alert('Download problem: ' + e.message);
  }
  activeDownload = null;
  if (sheetOpen() && menuTab === 'download') renderMenu('download');
}

async function startDownload(key) {
  const ctl = new AbortController();
  activeDownload = { key, ctl };
  await renderMenu('download');
  const t0 = Date.now();
  try {
    const rec = await downloadCounty(key, (done, total, bytes) => {
      const prog = $('#dl-prog'), text = $('#dl-text');
      if (prog) { prog.max = total; prog.value = done; }
      if (text) text.textContent = `${Math.round(done / total * 100)}% · ${fmtBytes(bytes)} saved · ${Math.round((Date.now() - t0) / 1000)}s`;
    }, ctl.signal, { sharp: wantSharp });
    state.counties = await db.all('counties');
    addCountyLayers(rec);
    updateParcelLayers();
  } catch (e) {
    if (e.message !== 'Stopped') alert('Download problem: ' + e.message);
  }
  activeDownload = null;
  if (sheetOpen() && menuTab === 'download') renderMenu('download');
}

// ---------- Saved pins and paths ----------
async function savedHtml() {
  const pins = await db.all('pins');
  const tracks = (await db.all('tracks')).filter(t => !t.recording);
  const p = pins.sort((a, b) => b.created.localeCompare(a.created)).map(x => `<div class="item"><div class="grow">${pinKind(x)[1]} <b>${esc(x.name)}</b>
    <small>${esc((x.notes || '').slice(0, 80))}</small></div><button data-go="${x.id}">Show</button></div>`).join('') || '<div class="note">No pins yet. Tap Pin to drop one.</div>';
  const t = tracks.sort((a, b) => b.started.localeCompare(a.started)).map(x => `<div class="item"><div class="grow"><b>${esc(x.name)}</b>
    <small>${miles(x.distance)} · ${new Date(x.started).toLocaleString()}</small></div>
    <button data-fit="${x.id}">Show</button>
    <button data-hide="${x.id}">${state.hiddenTracks.has(x.id) ? 'Unhide' : 'Hide'}</button>
    <button data-sharetrack="${x.id}">Share</button>
    <button data-deltrack="${x.id}" class="danger">Delete</button></div>`).join('') || '<div class="note">No paths yet. Tap Record to start one.</div>';
  return `<h3>Pins</h3>${p}<h3>Walking paths</h3>${t}`;
}

function wireSaved() {
  $$('[data-go]').forEach(b => b.onclick = async () => {
    const pin = await db.get('pins', b.dataset.go);
    if (!pin) return;
    closeSheet();
    flyToSpot([pin.lng, pin.lat], 16);
    map.once('moveend', () => showPin(pin.id));
  });
  $$('[data-fit]').forEach(b => b.onclick = async () => {
    const t = await db.get('tracks', b.dataset.fit);
    if (t.points.length < 2) return;
    const bounds = t.points.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(t.points[0], t.points[0]));
    state.hiddenTracks.delete(t.id); saveHidden(); await refreshTracks();
    closeSheet();
    flyToBounds(bounds.toArray().flat());
    emit('track-draw', t.points); // the line draws itself in
  });
  $$('[data-hide]').forEach(b => b.onclick = async () => {
    const k = b.dataset.hide;
    state.hiddenTracks.has(k) ? state.hiddenTracks.delete(k) : state.hiddenTracks.add(k);
    saveHidden(); await refreshTracks(); renderMenu('saved');
  });
  $$('[data-sharetrack]').forEach(b => b.onclick = async () => {
    const t = await db.get('tracks', b.dataset.sharetrack);
    // GPX is the standard path file that onX, Google Earth, Garmin and others can open.
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Hunting Map" xmlns="http://www.topografix.com/GPX/1/1">`
      + `<trk><name>${esc(t.name)}</name><trkseg>${t.points.map(([x, y]) => `<trkpt lat="${y}" lon="${x}"/>`).join('')}</trkseg></trk></gpx>`;
    const file = new File([gpx], (t.name || 'path').replace(/[^\w -]/g, '') + '.gpx', { type: 'application/gpx+xml' });
    shareThing({ title: t.name, text: `${t.name} — ${miles(t.distance)}`, file });
  });
  $$('[data-deltrack]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this path?')) return;
    await db.del('tracks', b.dataset.deltrack); await refreshTracks(); renderMenu('saved');
  });
}

// ---------- Display settings ----------
function displayHtml() {
  const g = (key, label, hint) => `<button data-gfx="${key}" class="${perf.choice === key ? 'on' : ''}">${label}<small>${hint}</small></button>`;
  const night = document.documentElement.classList.contains('night');
  return `<h3>Graphics</h3>
    <div class="choices">${g('auto', 'Auto', 'Eases off if the phone is slow or low on battery')}${g('full', 'Full', 'Always show every effect')}${g('lite', 'Lite', 'No moving effects; best battery life')}</div>
    <div class="note">Right now: ${perf.level >= 2 ? 'all effects on' : perf.level === 1 ? 'moving effects off' : 'moving effects and 3D ground off'}.</div>
    <h3>Night</h3>
    <label class="switch"><input type="checkbox" id="set-night" ${night ? 'checked' : ''}> Red night mode (keeps your eyes adjusted to the dark)</label>
    <h3>Opening fly-in</h3>
    <label class="switch"><input type="checkbox" id="set-intro" ${localStorage.getItem('intro') !== '0' ? 'checked' : ''}> Play the fly-in when the app opens</label>
    <div class="row"><button id="set-replay">Play it now</button></div>`;
}
function wireDisplay() {
  $$('[data-gfx]').forEach(b => b.onclick = () => { setGraphics(b.dataset.gfx); renderMenu('display'); });
  $('#set-night').onchange = e => emit('night', e.target.checked);
  $('#set-intro').onchange = e => localStorage.setItem('intro', e.target.checked ? '1' : '0');
  $('#set-replay').onclick = () => { closeSheet(); emit('replay-intro'); };
}

// ---------- Map info ----------
function aboutHtml() {
  return `<h3>Where the map comes from</h3>
    <div class="note"><b>Satellite (with signal):</b> Esri World Imagery — Esri, Vantor, Earthstar Geographics, GIS User Community.<br>
    <b>Satellite (offline):</b> USGS The National Map, USDA NAIP imagery (public domain). Slightly less sharp than Esri.<br>
    <b>Topo:</b> USGS The National Map (public domain).<br>
    <b>Roads, rail lines and town names:</b> © OpenStreetMap contributors (ODbL), OpenMapTiles, served by OpenFreeMap.<br>
    <b>Texas photos (summer 2022, winter 2015, and extra sharp offline):</b> Texas Geographic Information Office; USDA NAIP; Texas Orthoimagery Program.<br>
    <b>3D ground and hill shading:</b> Terrain Tiles on AWS Open Data (Mapzen), built from USGS 3DEP elevation data.<br>
    <b>Property lines and owners:</b> Texas Geographic Information Office (TxGIO), StratMap Land Parcels, from county appraisal districts.<br>
    <b>Public hunting areas and seasons:</b> Texas Parks and Wildlife Department.<br>
    <b>Forest roads and trails:</b> USDA Forest Service (vehicle-use map).<br>
    <b>Animal sightings:</b> iNaturalist and eBird (Cornell Lab of Ornithology, via GBIF).<br>
    <b>Weather and wind:</b> National Weather Service. <b>Sun, moon and feeding times:</b> calculated on your device.<br>
    <b>Lettering:</b> Barlow Semi Condensed (SIL Open Font License).</div>
    <h3>Please keep in mind</h3>
    <div class="note">${DISCLAIMER} Public hunting boundaries can change; check the current TPWD map booklet and rules. You still need landowner permission to hunt private land.
    The 3D ground is stretched so gentle hills are easier to see; it is not to scale.</div>
    <h3>Walking paths</h3>
    <div class="note">Your phone stops web apps when the screen locks, so keep the app open while recording. The screen stays on while recording.</div>`;
}
