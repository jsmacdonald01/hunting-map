/* global maplibregl */
import { db } from './db.js';
import { USGS, IMG_MAX, TOPO_MAX, parcelTileUrl, downloadCounty, removeCounty, estimateBytes } from './offline.js';
import { setupMeasure, setupGuide } from './tools.js';
import { conditionsHtml } from './conditions.js';

// Pin kinds: label and the little picture drawn on the map.
const PIN_TYPES = {
  stand: ['Stand / blind', '🪜', '#8d6e63'], camera: ['Trail camera', '📷', '#455a64'], scrape: ['Scrape', '🍂', '#ef6c00'],
  rub: ['Rub', '🌲', '#2e7d32'], deer: ['Deer seen', '🦌', '#795548'], hog: ['Hog sign', '🐗', '#5d4037'],
  blood: ['Blood trail', '🩸', '#c62828'], truck: ['Truck / parking', '🛻', '#1565c0'], camp: ['Camp', '⛺', '#6a1b9a'],
  other: ['Other', '📍', '#f9a825'],
};
// Sighting animals: label and dot color.
const ANIMALS = {
  deer: ['Deer', '#ffb74d'], hog: ['Hogs', '#e53935'], turkey: ['Turkey', '#8e24aa'], duck: ['Ducks & geese', '#29b6f6'],
  dove: ['Doves', '#cfd8dc'], squirrel: ['Squirrels', '#a1887f'], rabbit: ['Rabbits', '#fff176'], quail: ['Quail', '#aed581'],
  woodcock: ['Woodcock', '#4db6ac'], coyote: ['Coyotes', '#ff8a65'],
};

const ESRI = 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TXGIO = 'https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer';
const DISCLAIMER = 'Property lines are approximate (not a survey). Owner info comes from county appraisal records and can be blank or out of date.';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtBytes = b => b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB';
const fmtMoney = v => v ? '$' + Number(v).toLocaleString() : '';
const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const EMPTY = { type: 'FeatureCollection', features: [] };

const state = {
  base: localStorage.getItem('base') || 'sat',
  online: navigator.onLine,
  counties: [],     // downloaded counties
  rec: null,        // current recording
  hiddenTracks: new Set(JSON.parse(localStorage.getItem('hiddenTracks') || '[]')),
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
navigator.storage?.persist?.();

// ---------- Map ----------
const saved = JSON.parse(localStorage.getItem('view') || 'null');
const map = new maplibregl.Map({
  container: 'map',
  center: saved?.center || [-95.45, 30.55], // Sam Houston National Forest
  zoom: saved?.zoom ?? 10,
  maxZoom: 19,
  attributionControl: false,
  style: {
    version: 8,
    glyphs: new URL('fonts/', location.href).href + '{fontstack}/{range}.pbf',
    sources: {
      esri: { type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom: 19, attribution: 'Satellite: Esri, Vantor, Earthstar Geographics, GIS User Community' },
      usgsimg: { type: 'raster', tiles: [USGS.usgsimg + '/{z}/{y}/{x}'], tileSize: 256, maxzoom: IMG_MAX, attribution: 'Offline satellite: USGS The National Map / USDA NAIP' },
      usgstopo: { type: 'raster', tiles: [USGS.usgstopo + '/{z}/{y}/{x}'], tileSize: 256, maxzoom: TOPO_MAX, attribution: 'Topo: USGS The National Map' },
      parcelsLive: {
        type: 'raster', tileSize: 256, minzoom: 13,
        tiles: [TXGIO + '/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&dpi=192&format=png32&transparent=true&f=image'],
        attribution: 'Property lines: TxGIO StratMap Land Parcels',
      },
      public: { type: 'geojson', data: 'data/public-hunt.geojson', attribution: 'Public hunting areas: TPWD' },
      roads: { type: 'geojson', data: 'data/forest-roads.geojson', attribution: 'Forest roads and trails: USDA Forest Service' },
      sightings: { type: 'geojson', data: 'data/sightings.geojson', attribution: 'Sightings: iNaturalist, eBird (via GBIF)' },
      highlight: { type: 'geojson', data: EMPTY },
      measure: { type: 'geojson', data: EMPTY },
      guide: { type: 'geojson', data: EMPTY },
      tracks: { type: 'geojson', data: EMPTY },
      live: { type: 'geojson', data: EMPTY },
      pins: { type: 'geojson', data: EMPTY },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#2b2b2b' } },
      { id: 'usgsimg', type: 'raster', source: 'usgsimg', layout: { visibility: 'none' } },
      { id: 'esri', type: 'raster', source: 'esri', layout: { visibility: 'none' } },
      { id: 'usgstopo', type: 'raster', source: 'usgstopo', layout: { visibility: 'none' } },
      { id: 'parcelsLive', type: 'raster', source: 'parcelsLive' },
      { id: 'pub-fill', type: 'fill', source: 'public', filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
        paint: { 'fill-color': ['match', ['get', 'kind'], 'nohunt', '#e03131', 'boundary', '#1e90ff', '#74c0fc'],
                 'fill-opacity': ['match', ['get', 'kind'], 'nohunt', 0.35, 'boundary', 0.15, 0.06] } },
      { id: 'pub-line', type: 'line', source: 'public', filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
        paint: { 'line-color': ['match', ['get', 'kind'], 'nohunt', '#e03131', 'boundary', '#1e90ff', '#74c0fc'],
                 'line-width': ['match', ['get', 'kind'], 'boundary', 3, 1.5] } },
      { id: 'pub-label', type: 'symbol', source: 'public', minzoom: 8,
        filter: ['all', ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]], ['==', ['get', 'kind'], 'boundary']],
        layout: { 'text-field': ['get', 'name'], 'text-font': ['OpenSansSemibold'], 'text-size': 13, 'symbol-placement': 'point', 'text-max-width': 9 },
        paint: { 'text-color': '#fff', 'text-halo-color': '#0b3d91', 'text-halo-width': 1.6 } },
      { id: 'pub-sublabel', type: 'symbol', source: 'public', minzoom: 12,
        filter: ['all', ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]], ['!=', ['get', 'kind'], 'boundary']],
        layout: { 'text-field': ['get', 'cls'], 'text-font': ['OpenSansSemibold'], 'text-size': 11, 'text-max-width': 8 },
        paint: { 'text-color': '#fff', 'text-halo-color': ['match', ['get', 'kind'], 'nohunt', '#a51111', '#0b3d91'], 'text-halo-width': 1.4 } },
      { id: 'pub-points', type: 'circle', source: 'public', minzoom: 11, filter: ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]],
        paint: { 'circle-radius': 5, 'circle-color': '#1e90ff', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } },
      { id: 'pub-points-label', type: 'symbol', source: 'public', minzoom: 13, filter: ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]],
        layout: { 'text-field': ['get', 'cls'], 'text-font': ['OpenSansSemibold'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top' },
        paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1.2 } },
      { id: 'roads-trail', type: 'line', source: 'roads', filter: ['==', ['get', 'kind'], 'trail'], minzoom: 10,
        paint: { 'line-color': '#d7ccc8', 'line-width': 2, 'line-dasharray': [2, 1.5] } },
      { id: 'roads-ohv', type: 'line', source: 'roads', filter: ['==', ['get', 'kind'], 'ohv'], minzoom: 10,
        paint: { 'line-color': '#ce93d8', 'line-width': 2.5, 'line-dasharray': [1, 1] } },
      { id: 'roads-road', type: 'line', source: 'roads', filter: ['==', ['get', 'kind'], 'road'], minzoom: 9,
        paint: { 'line-color': ['match', ['get', 'seasonal'], 'seasonal', '#ffca28', '#ffffff'], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 15, 4] } },
      { id: 'roads-label', type: 'symbol', source: 'roads', minzoom: 12,
        layout: { 'symbol-placement': 'line', 'text-field': ['case', ['==', ['get', 'kind'], 'trail'], ['get', 'name'], ['concat', 'FS ', ['get', 'num']]],
                  'text-font': ['OpenSansSemibold'], 'text-size': 11 },
        paint: { 'text-color': '#fff', 'text-halo-color': '#333', 'text-halo-width': 1.4 } },
      { id: 'sight-heat', type: 'heatmap', source: 'sightings', layout: { visibility: 'none' }, maxzoom: 16,
        paint: { 'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 8, 14, 30], 'heatmap-opacity': 0.75,
                 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 1.5] } },
      { id: 'sight-dots', type: 'circle', source: 'sightings', minzoom: 9,
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 15, 6],
                 'circle-color': ['match', ['get', 'a'], ...Object.entries(ANIMALS).flatMap(([k, v]) => [k, v[1]]), '#fff'],
                 'circle-stroke-color': '#000', 'circle-stroke-width': 1 } },
      { id: 'highlight', type: 'line', source: 'highlight', paint: { 'line-color': '#00e5ff', 'line-width': 4 } },
      { id: 'measure-fill', type: 'fill', source: 'measure', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#00e5ff', 'fill-opacity': 0.15 } },
      { id: 'measure-line', type: 'line', source: 'measure', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#00e5ff', 'line-width': 3, 'line-dasharray': [2, 1] } },
      { id: 'measure-pts', type: 'circle', source: 'measure', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#00b8d4', 'circle-stroke-width': 2 } },
      { id: 'guide', type: 'line', source: 'guide', paint: { 'line-color': '#76ff03', 'line-width': 3, 'line-dasharray': [1, 1.5] } },
      { id: 'tracks', type: 'line', source: 'tracks', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ff6b00', 'line-width': 3.5 } },
      { id: 'live', type: 'line', source: 'live', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ff1744', 'line-width': 4.5 } },
      { id: 'pins', type: 'symbol', source: 'pins',
        layout: { 'icon-image': ['concat', 'pin-', ['get', 'type']], 'icon-size': 0.5, 'icon-allow-overlap': true, 'icon-ignore-placement': true } },
      { id: 'pins-label', type: 'symbol', source: 'pins', minzoom: 12,
        layout: { 'text-field': ['get', 'name'], 'text-font': ['OpenSansSemibold'], 'text-size': 12, 'text-offset': [0, 1.6], 'text-anchor': 'top' },
        paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1.4 } },
    ],
  },
});
window.huntingMap = map; // handy for testing

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
const geolocate = new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showAccuracyCircle: true });
map.addControl(geolocate, 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');
map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Hunting Map' }), 'bottom-right');

map.on('moveend', () => {
  localStorage.setItem('view', JSON.stringify({ center: map.getCenter().toArray(), zoom: map.getZoom() }));
  updateParcelLayers();
});

// ---------- Online / offline ----------
async function checkOnline() {
  let ok = false;
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(ESRI.replace('{z}/{y}/{x}', '0/0/0') + '?t=' + Date.now(), { cache: 'no-store', signal: ctl.signal });
    ok = r.ok;
  } catch { ok = false; }
  if (ok !== state.online) { state.online = ok; applyBase(); updateParcelLayers(); }
  showStatus();
}
function showStatus() {
  const el = $('#status');
  el.hidden = state.online;
  el.textContent = 'No signal — showing downloaded maps';
}
window.addEventListener('online', checkOnline);
window.addEventListener('offline', () => { state.online = false; applyBase(); updateParcelLayers(); showStatus(); });
setInterval(checkOnline, 30000);

// ---------- Base map ----------
function applyBase() {
  if (!map.isStyleLoaded()) return map.once('load', applyBase);
  const sat = state.base === 'sat';
  map.setLayoutProperty('esri', 'visibility', sat && state.online ? 'visible' : 'none');
  map.setLayoutProperty('usgsimg', 'visibility', sat && !state.online ? 'visible' : 'none');
  map.setLayoutProperty('usgstopo', 'visibility', sat ? 'none' : 'visible');
  document.querySelectorAll('[data-base]').forEach(b => b.classList.toggle('on', b.dataset.base === state.base));
}
document.querySelectorAll('[data-base]').forEach(b => b.onclick = () => {
  state.base = b.dataset.base; localStorage.setItem('base', state.base); applyBase();
});
$('#btn-layers').onclick = () => { $('#layers').hidden = !$('#layers').hidden; $('#btn-layers').classList.toggle('on', !$('#layers').hidden); };
$('#lyr-public').onchange = e => ['pub-fill', 'pub-line', 'pub-label', 'pub-sublabel', 'pub-points', 'pub-points-label']
  .forEach(l => map.setLayoutProperty(l, 'visibility', e.target.checked ? 'visible' : 'none'));
$('#lyr-parcels').onchange = updateParcelLayers;
$('#lyr-roads').onchange = e => ['roads-trail', 'roads-ohv', 'roads-road', 'roads-label']
  .forEach(l => map.setLayoutProperty(l, 'visibility', e.target.checked ? 'visible' : 'none'));

// ---------- Animal sightings ----------
const sight = {
  on: localStorage.getItem('sightOn') !== '0',
  animals: new Set(JSON.parse(localStorage.getItem('sightAnimals') || '["deer","hog","turkey"]')),
  months: localStorage.getItem('sightMonths') || 'all',
  style: localStorage.getItem('sightStyle') || 'dots',
};
const MONTHS = { all: null, fall: ['09', '10', '11', '12', '01', '02'], spring: ['03', '04', '05', '06', '07', '08'] };
$('#sight-animals').innerHTML = Object.entries(ANIMALS).map(([k, [label, color]]) =>
  `<label class="chip"><input type="checkbox" value="${k}" ${sight.animals.has(k) ? 'checked' : ''}><i style="background:${color}"></i>${label}</label>`).join('');
$('#lyr-sight').checked = sight.on;
$('#sight-months').value = sight.months;
$('#sight-style').value = sight.style;

function applySightings() {
  if (!map.isStyleLoaded()) return;
  const filter = ['all', ['in', ['get', 'a'], ['literal', [...sight.animals]]]];
  if (MONTHS[sight.months]) filter.push(['in', ['slice', ['get', 'd'], 5, 7], ['literal', MONTHS[sight.months]]]);
  map.setFilter('sight-dots', filter);
  map.setFilter('sight-heat', filter);
  map.setLayoutProperty('sight-dots', 'visibility', sight.on && sight.style === 'dots' ? 'visible' : 'none');
  map.setLayoutProperty('sight-heat', 'visibility', sight.on && sight.style === 'heat' ? 'visible' : 'none');
  $('#sight-options').hidden = !sight.on;
  localStorage.setItem('sightOn', sight.on ? '1' : '0');
  localStorage.setItem('sightAnimals', JSON.stringify([...sight.animals]));
  localStorage.setItem('sightMonths', sight.months);
  localStorage.setItem('sightStyle', sight.style);
}
$('#lyr-sight').onchange = e => { sight.on = e.target.checked; applySightings(); };
$('#sight-animals').onchange = e => { e.target.checked ? sight.animals.add(e.target.value) : sight.animals.delete(e.target.value); applySightings(); };
$('#sight-months').onchange = e => { sight.months = e.target.value; applySightings(); };
$('#sight-style').onchange = e => { sight.style = e.target.value; applySightings(); };

function sightingHtml(feats) {
  if (!feats.length) return '';
  const rows = feats.slice(0, 6).map(f => {
    const p = f.properties;
    return `<div><i class="dot" style="background:${ANIMALS[p.a]?.[1]}"></i><b>${esc(ANIMALS[p.a]?.[0] || p.a)}</b> · ${p.d ? new Date(p.d + 'T12:00').toLocaleDateString() : 'date unknown'} <small>(${esc(p.s)})</small></div>`;
  }).join('');
  return `<h3>Animal sightings here</h3>${rows}${feats.length > 6 ? `<div class="note">…and ${feats.length - 6} more nearby.</div>` : ''}
    <div class="note">Sightings people logged on ${feats.some(f => f.properties.s === 'eBird') ? 'eBird and ' : ''}iNaturalist. A sighting means an animal was seen there once, not that it lives there.</div>`;
}

function roadHtml(feats) {
  if (!feats.length) return '';
  return '<h3>Forest roads and trails</h3>' + feats.slice(0, 3).map(f => {
    const p = f.properties;
    const title = p.kind === 'trail' ? (p.name || 'Trail') : `Forest road ${p.num}${p.name ? ' (' + titleCase(p.name) + ')' : ''}`;
    return `<div><b>${esc(title)}</b><br><small>${esc(p.use)}${p.open ? ` · open ${esc(p.open)} (month/day)` : ''}${p.surface ? ' · ' + esc(p.surface) : ''}</small></div>`;
  }).join('') + '<div class="note">From the Forest Service vehicle-use map. Gates and closures can change; check the ranger district.</div>';
}

// ---------- Property lines ----------
function inBbox([x, y], b) { return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]; }

function addCountyLayers(c) {
  const src = 'parcels-' + c.id;
  if (map.getSource(src)) return;
  map.addSource(src, { type: 'vector', tiles: [parcelTileUrl(c.id)], minzoom: 12, maxzoom: 14, bounds: c.bbox, attribution: 'Property lines: TxGIO StratMap Land Parcels' });
  map.addLayer({ id: 'pf-' + c.id, type: 'fill', source: src, 'source-layer': 'parcels', minzoom: 12, paint: { 'fill-color': '#000', 'fill-opacity': 0 } }, 'pub-fill');
  map.addLayer({ id: 'pl-' + c.id, type: 'line', source: src, 'source-layer': 'parcels', minzoom: 12,
    paint: { 'line-color': '#ffd400', 'line-opacity': 0.9, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 16, 1.6] } }, 'pub-fill');
}
function removeCountyLayers(key) {
  for (const l of ['pf-' + key, 'pl-' + key]) if (map.getLayer(l)) map.removeLayer(l);
  if (map.getSource('parcels-' + key)) map.removeSource('parcels-' + key);
}
function updateParcelLayers() {
  if (!map.isStyleLoaded()) return;
  const on = $('#lyr-parcels').checked;
  const center = map.getCenter().toArray();
  const covered = state.counties.some(c => inBbox(center, c.bbox));
  // Live lines when there's signal and this spot isn't downloaded; saved lines otherwise.
  map.setLayoutProperty('parcelsLive', 'visibility', on && state.online && !covered ? 'visible' : 'none');
  for (const c of state.counties) map.setLayoutProperty('pl-' + c.id, 'visibility', on ? 'visible' : 'none');
}

// ---------- Tapping the map ----------
function esriToGeo(g) {
  return g?.rings ? { type: 'Feature', geometry: { type: 'Polygon', coordinates: g.rings }, properties: {} } : null;
}

async function identifyOnline(lngLat) {
  const { lng: x, lat: y } = lngLat;
  const d = 0.002;
  const url = `${TXGIO}/identify?geometry=${x},${y}&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=1`
    + `&mapExtent=${x - d},${y - d},${x + d},${y + d}&imageDisplay=400,400,96&returnGeometry=true&f=json`;
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 8000);
  const r = await fetch(url, { signal: ctl.signal });
  const j = await r.json();
  const hit = j.results?.[0];
  if (!hit) return null;
  const a = hit.attributes;
  const clean = v => (v && v !== 'Null' ? String(v).replace(/\u0000/g, '').replace(/^[\s,]+|[\s,]+$/g, '') : '');
  const legal = Number(a.LEGAL_AREA) || 0;
  return {
    props: {
      owner: clean(a.OWNER_NAME), acres: legal || Number(a.GIS_AREA) || 0, acresSource: legal ? 'appraisal' : 'mapped',
      county: clean(a.COUNTY), addr: clean(a.SITUS_ADDR), value: Number(a.MKT_VALUE) || 0,
      legal: clean(a.LEGAL_DESC), id: clean(a.PROP_ID).replace(/\.0+$/, ''), live: true,
    },
    geo: esriToGeo(hit.geometry),
  };
}

function titleCase(s) { return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); }

function parcelHtml(p) {
  const acres = p.acres ? `${Number(p.acres).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${Number(p.acres) === 1 ? 'acre' : 'acres'}` + (p.acresSource === 'mapped' ? ' <small>(measured from map)</small>' : '') : '';
  return `<h2>${p.owner ? esc(p.owner) : '<span style="color:#666">Owner not listed</span>'}</h2>
    ${p.owner ? '' : '<div class="note">This county left the owner name blank for this property.</div>'}
    <dl>
      ${acres ? `<dt>Size</dt><dd>${acres}</dd>` : ''}
      ${p.county ? `<dt>County</dt><dd>${esc(titleCase(p.county))}</dd>` : ''}
      ${p.addr ? `<dt>Address</dt><dd>${esc(p.addr)}</dd>` : ''}
      ${p.value ? `<dt>Value</dt><dd>${fmtMoney(p.value)}</dd>` : ''}
      ${p.legal ? `<dt>Legal</dt><dd>${esc(p.legal)}</dd>` : ''}
      ${p.id ? `<dt>Property ID</dt><dd>${esc(p.id)}</dd>` : ''}
    </dl>
    <div class="note">${DISCLAIMER} ${p.live ? 'Source: TxGIO (live).' : 'Source: TxGIO (saved on this device).'}</div>`;
}

function publicHtml(feats) {
  if (!feats.length) return '';
  const seen = new Set();
  const rows = feats.filter(f => { const k = f.properties.name + f.properties.cls; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(f => {
      const p = f.properties;
      const no = p.kind === 'nohunt';
      return `<div><span class="tag ${no ? 'no' : ''}">${esc(p.cls)}</span> <b>${esc(p.name)}</b>
        ${p.acres ? `· ${Number(p.acres).toLocaleString()} acres` : ''} <small>(${esc(p.src)})</small>
        ${p.booklet ? `<br><a href="${esc(p.booklet)}" target="_blank" rel="noopener">TPWD map booklet</a>` : ''}</div>`;
    }).join('');
  const names = new Set(feats.map(f => f.properties.name));
  const facts = [...names].map(n => AREA_FACTS[n]).filter(Boolean).map(f => `<div class="facts">${f}</div>`).join('');
  return `<h3>Public hunting</h3>${rows}${facts}
    <div class="note">Most TPWD public hunting land requires the Annual Public Hunting Permit. Check TPWD rules before you hunt.</div>`;
}

// TPWD facts for public areas we know well. (TPWD doesn't publish harvest numbers for these areas.)
const AREA_FACTS = {
  'Sam Houston National Forest WMA': `<b>About this area</b><br>161,508 acres across Montgomery, San Jacinto and Walker counties. Open year round.
    Deer, feral hog, waterfowl, dove, squirrel, quail, rabbits and predators may be hunted.
    Hunters 17 and older need the <b>Annual Public Hunting Permit</b> and a hunting license.
    No antlerless deer on National Forest land. Bring your own water.
    <br>TPWD office: <a href="tel:9365537641">(936) 553-7641</a> ·
    <a href="https://tpwd.texas.gov/huntwild/hunt/wma/find_a_wma/list/?id=30" target="_blank" rel="noopener">TPWD area page</a>
    <br><small>TPWD doesn’t publish harvest counts for this area.</small>`,
};

function openSheet(html) {
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
}
function closeSheet() {
  $('#sheet').hidden = true;
  map.getSource('highlight')?.setData(EMPTY);
}
$('#sheet .close').onclick = closeSheet;

const visibleLayers = ids => ids.filter(l => map.getLayer(l) && map.getLayoutProperty(l, 'visibility') !== 'none');
const near = (point, layers, px) => {
  const ls = visibleLayers(layers);
  return ls.length ? map.queryRenderedFeatures([[point.x - px, point.y - px], [point.x + px, point.y + px]], { layers: ls }) : [];
};

map.on('click', async e => {
  if (!$('#placebar').hidden) return;
  if (measure.tap(e.lngLat)) return;
  $('#layers').hidden = true; $('#btn-layers').classList.remove('on');

  const pin = near(e.point, ['pins'], 14)[0];
  if (pin) return showPin(pin.properties.id);

  const extra = sightingHtml(near(e.point, ['sight-dots'], 10)) + roadHtml(near(e.point, ['roads-road', 'roads-ohv', 'roads-trail'], 8));
  const pub = map.getLayer('pub-fill') && map.getLayoutProperty('pub-fill', 'visibility') !== 'none'
    ? map.queryRenderedFeatures(e.point, { layers: ['pub-fill'] }) : [];
  const parcelLayers = state.counties.map(c => 'pf-' + c.id).filter(l => map.getLayer(l));
  const local = parcelLayers.length ? map.queryRenderedFeatures(e.point, { layers: parcelLayers }).find(f => f.properties.county) : null;

  let html = '';
  if (local) {
    map.getSource('highlight').setData(local.toJSON ? local.toJSON() : { type: 'Feature', geometry: local.geometry, properties: {} });
    html = parcelHtml(local.properties);
  } else if (state.online && map.getZoom() >= 11) {
    openSheet('<div class="note">Looking up this property…</div>' + extra + publicHtml(pub));
    try {
      const r = await identifyOnline(e.lngLat);
      if (r) { if (r.geo) map.getSource('highlight').setData(r.geo); html = parcelHtml(r.props); }
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

// ---------- Pins ----------
async function refreshPins() {
  const pins = await db.all('pins');
  map.getSource('pins')?.setData({ type: 'FeatureCollection', features: pins.map(p => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { id: p.id, name: p.name, type: PIN_TYPES[p.type] ? p.type : 'other' } })) });
  return pins;
}

// Draws each pin kind's picture once so the map can use it.
function addPinIcons() {
  for (const [type, [, emoji, color]] of Object.entries(PIN_TYPES)) {
    const s = 64, c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 3, 0, Math.PI * 2);
    g.fillStyle = '#fff'; g.fill();
    g.lineWidth = 5; g.strokeStyle = color; g.stroke();
    g.font = '34px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(emoji, s / 2, s / 2 + 2);
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
async function shareThing({ title, text, file }) {
  try {
    if (file && navigator.canShare?.({ files: [file] })) return await navigator.share({ title, text, files: [file] });
    if (navigator.share) return await navigator.share({ title, text });
  } catch (e) { if (e.name === 'AbortError') return; }
  // No share sheet (e.g. on a PC): copy the text, or save the file.
  if (file) { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); return; }
  try { await navigator.clipboard.writeText(text); alert('Copied. Paste it into a text message.'); } catch { prompt('Copy this:', text); }
}

function startPlacing() {
  closeSheet();
  $('#crosshair').hidden = false; $('#placebar').hidden = false;
  $('#btn-pin').classList.add('on');
}
function stopPlacing() {
  $('#crosshair').hidden = true; $('#placebar').hidden = true;
  $('#btn-pin').classList.remove('on');
}
$('#btn-pin').onclick = () => ($('#placebar').hidden ? startPlacing() : stopPlacing());
$('#place-cancel').onclick = stopPlacing;
$('#place-here').onclick = () => { const c = map.getCenter(); stopPlacing(); editPin({ lng: c.lng, lat: c.lat }); };
$('#place-gps').onclick = () => {
  navigator.geolocation.getCurrentPosition(
    p => { stopPlacing(); editPin({ lng: p.coords.longitude, lat: p.coords.latitude }); },
    () => alert('Couldn’t get your location. Check that location is allowed for this app.'),
    { enableHighAccuracy: true, timeout: 15000 });
};

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
    document.querySelectorAll('[data-rmphoto]').forEach(b => b.onclick = () => { photos.splice(+b.dataset.rmphoto, 1); wirePhotos(); });
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
    await db.put('pins', { ...pin, id: pin.id || id(), type, photos, name: $('#pin-name').value.trim() || PIN_TYPES[type][0],
      notes: $('#pin-notes').value, created: pin.created || new Date().toISOString() });
    await refreshPins(); closeSheet();
  };
}

async function showPin(pinId) {
  const p = await db.get('pins', pinId);
  if (!p) return;
  const [label, emoji] = PIN_TYPES[p.type] || PIN_TYPES.other;
  openSheet(`<h2>${emoji} ${esc(p.name)}</h2>
    ${p.name !== label ? `<div class="note">${esc(label)}</div>` : ''}
    ${p.notes ? `<p style="white-space:pre-wrap">${esc(p.notes)}</p>` : ''}
    <div class="thumbs">${photoThumbs(p.photos)}</div>
    <div class="note">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} · ${new Date(p.created).toLocaleString()}</div>
    <div class="row"><button class="primary" id="pin-go">Take me here</button><button id="pin-share">Share</button>
      <button id="pin-edit">Edit</button><button class="danger" id="pin-del">Delete</button></div>`);
  document.querySelectorAll('[data-photo]').forEach(img => img.onclick = () => window.open(img.src, '_blank'));
  $('#pin-go').onclick = () => { closeSheet(); guide.start(p); };
  $('#pin-share').onclick = () => shareThing({ title: p.name,
    text: `${p.name}${p.notes ? ' — ' + p.notes : ''}\n${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}\n${mapsLink(p.lat, p.lng)}` });
  $('#pin-edit').onclick = () => editPin(p);
  $('#pin-del').onclick = async () => { if (confirm('Delete this pin?')) { await db.del('pins', p.id); await refreshPins(); closeSheet(); } };
}

// ---------- Measure, go-to, today ----------
const measure = setupMeasure(map, {
  bar: $('#measurebar'),
  onStart: () => { closeSheet(); $('#btn-measure').classList.add('on'); },
  onStop: () => $('#btn-measure').classList.remove('on'),
});
$('#btn-measure').onclick = () => (measure.active() ? measure.stop() : measure.start());

const guide = setupGuide(map, { bar: $('#guidebar') });
$('#guide-stop').onclick = () => { guide.stop(); $('#btn-goto').classList.remove('on'); };
$('#btn-goto').onclick = async () => {
  if (guide.active()) { guide.stop(); $('#btn-goto').classList.remove('on'); return; }
  const pins = (await db.all('pins')).sort((a, b) => (b.type === 'truck') - (a.type === 'truck') || b.created.localeCompare(a.created));
  if (!pins.length) return openSheet('<h2>Go to a pin</h2><div class="note">Drop a pin first (tip: pick “Truck / parking” where you park). Then this guides you back to it.</div>');
  openSheet(`<h2>Go to a pin</h2><div class="note">Shows an arrow and distance to the pin. Trucks are listed first.</div>`
    + pins.map(p => `<div class="item"><div class="grow">${(PIN_TYPES[p.type] || PIN_TYPES.other)[1]} <b>${esc(p.name)}</b></div><button data-goto="${p.id}" class="primary">Go</button></div>`).join(''));
  document.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => {
    closeSheet(); $('#btn-goto').classList.add('on'); guide.start(pins.find(p => p.id === b.dataset.goto));
  });
};

$('#btn-today').onclick = async () => {
  const c = map.getCenter();
  openSheet('<h2>Today</h2><div class="note">Loading…</div>');
  const where = await new Promise(resolve => navigator.geolocation
    ? navigator.geolocation.getCurrentPosition(p => resolve([p.coords.latitude, p.coords.longitude]), () => resolve([c.lat, c.lng]), { timeout: 4000, maximumAge: 600000 })
    : resolve([c.lat, c.lng]));
  openSheet(await conditionsHtml(where[0], where[1], state.online));
};

// ---------- Walking path ----------
function meters([x1, y1], [x2, y2]) {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin((y2 - y1) * r / 2) ** 2 + Math.cos(y1 * r) * Math.cos(y2 * r) * Math.sin((x2 - x1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const miles = m => (m / 1609.34).toFixed(2) + ' mi';

async function refreshTracks() {
  const tracks = await db.all('tracks');
  map.getSource('tracks')?.setData({ type: 'FeatureCollection', features: tracks
    .filter(t => !t.recording && !state.hiddenTracks.has(t.id) && t.points.length > 1)
    .map(t => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: t.points }, properties: { id: t.id } })) });
  return tracks;
}

let wakeLock = null;
async function keepAwake() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not allowed */ } }
document.addEventListener('visibilitychange', () => { if (state.rec && document.visibilityState === 'visible') keepAwake(); });

function recUpdate() {
  const r = state.rec;
  const mins = Math.round((Date.now() - new Date(r.started)) / 60000);
  $('#rectext').textContent = `Recording · ${miles(r.distance)} · ${mins} min · keep app open`;
  map.getSource('live').setData(r.points.length > 1 ? { type: 'Feature', geometry: { type: 'LineString', coordinates: r.points }, properties: {} } : EMPTY);
}

async function startRecording() {
  state.rec = { id: id(), name: '', started: new Date().toISOString(), points: [], distance: 0, recording: true };
  await db.put('tracks', state.rec);
  $('#btn-rec').classList.add('on'); $('#btn-rec').textContent = 'Stop';
  $('#recbar').hidden = false;
  keepAwake();
  let unsaved = 0;
  state.rec.watch = navigator.geolocation.watchPosition(p => {
    const r = state.rec;
    if (!r || p.coords.accuracy > 35) return;
    const pt = [+p.coords.longitude.toFixed(6), +p.coords.latitude.toFixed(6)];
    const last = r.points[r.points.length - 1];
    if (last) { const d = meters(last, pt); if (d < 4) return; r.distance += d; }
    r.points.push(pt);
    recUpdate();
    if (++unsaved >= 5) { unsaved = 0; const { watch, ...rest } = r; db.put('tracks', rest); }
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
  $('#btn-rec').classList.remove('on'); $('#btn-rec').textContent = 'Record';
  $('#recbar').hidden = true;
  map.getSource('live').setData(EMPTY);
  const name = prompt('Name this path', 'Walk ' + new Date(r.started).toLocaleDateString()) || 'Walk';
  const { watch, timer, ...rest } = r;
  await db.put('tracks', { ...rest, name, recording: false, ended: new Date().toISOString() });
  await refreshTracks();
}
$('#btn-rec').onclick = () => (state.rec ? stopRecording() : startRecording());

// A path that was still recording when the app closed gets kept, not lost.
async function recoverTracks() {
  for (const t of await db.all('tracks')) if (t.recording) await db.put('tracks', { ...t, recording: false, name: 'Walk ' + new Date(t.started).toLocaleDateString() + ' (unfinished)' });
}

// ---------- Menu ----------
let menuTab = 'download';
$('#btn-menu').onclick = () => renderMenu();

async function renderMenu(tab = menuTab) {
  menuTab = tab;
  const tabs = `<div class="tabs">
    <button data-tab="download" class="${tab === 'download' ? 'on' : ''}">Download maps</button>
    <button data-tab="saved" class="${tab === 'saved' ? 'on' : ''}">Pins &amp; paths</button>
    <button data-tab="about" class="${tab === 'about' ? 'on' : ''}">Map info</button></div>`;
  let body = '';
  if (tab === 'download') body = await downloadsHtml();
  if (tab === 'saved') body = await savedHtml();
  if (tab === 'about') body = aboutHtml();
  openSheet(tabs + body);
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => renderMenu(b.dataset.tab));
  if (tab === 'download') wireDownloads();
  if (tab === 'saved') wireSaved();
}

let available = [];
let activeDownload = null;

async function downloadsHtml() {
  try { available = await (await fetch('data/counties.json')).json(); } catch { /* keep last list */ }
  const have = new Map(state.counties.map(c => [c.id, c]));
  let storage = '';
  try { const s = await navigator.storage.estimate(); storage = `Using ${fmtBytes(s.usage || 0)} on this device.`; } catch { /* unsupported */ }
  const rows = available.map(c => {
    const h = have.get(c.key);
    const busy = activeDownload?.key === c.key;
    return `<div class="item"><div class="grow"><b>${esc(c.name)} County</b>
        <small>${c.parcels.toLocaleString()} properties · ${c.blankOwners.toLocaleString()} without owner names · about ${fmtBytes(estimateBytes(c))}</small>
        <small>${h ? `Downloaded ${new Date(h.date).toLocaleDateString()}${h.failed ? ` · ${h.failed} pieces missed — tap Update` : ''}` : 'Not downloaded'}</small>
        ${busy ? `<progress id="dl-prog" max="1" value="0"></progress><small id="dl-text">Starting…</small>` : ''}</div>
      ${busy ? '<button id="dl-stop">Stop</button>'
        : `<button data-dl="${c.key}" ${activeDownload ? 'disabled' : ''} class="${h ? '' : 'primary'}">${h ? 'Update' : 'Download'}</button>
           ${h ? `<button data-rm="${c.key}" class="danger">Remove</button>` : ''}`}</div>`;
  }).join('') || '<div class="note">Couldn’t load the county list. Check your signal and try again.</div>';
  return `<div class="note">Downloads save satellite, topo, property lines and owner names onto this device so they work with no signal.
    Use Wi-Fi if you can, and keep the app open until it finishes.</div>
    ${rows}<div class="note">${storage}</div>`;
}

function wireDownloads() {
  document.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => startDownload(b.dataset.dl));
  document.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
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
    }, ctl.signal);
    state.counties = await db.all('counties');
    addCountyLayers(rec);
    updateParcelLayers();
  } catch (e) {
    if (e.message !== 'Stopped') alert('Download problem: ' + e.message);
  }
  activeDownload = null;
  if (!$('#sheet').hidden && menuTab === 'download') renderMenu('download');
}

async function savedHtml() {
  const pins = await db.all('pins');
  const tracks = (await db.all('tracks')).filter(t => !t.recording);
  const p = pins.sort((a, b) => b.created.localeCompare(a.created)).map(x => `<div class="item"><div class="grow">${(PIN_TYPES[x.type] || PIN_TYPES.other)[1]} <b>${esc(x.name)}</b>
    <small>${esc((x.notes || '').slice(0, 80))}</small></div><button data-go="${x.lng},${x.lat}">Show</button></div>`).join('') || '<div class="note">No pins yet. Tap Pin to drop one.</div>';
  const t = tracks.sort((a, b) => b.started.localeCompare(a.started)).map(x => `<div class="item"><div class="grow"><b>${esc(x.name)}</b>
    <small>${miles(x.distance)} · ${new Date(x.started).toLocaleString()}</small></div>
    <button data-fit="${x.id}">Show</button>
    <button data-hide="${x.id}">${state.hiddenTracks.has(x.id) ? 'Unhide' : 'Hide'}</button>
    <button data-sharetrack="${x.id}">Share</button>
    <button data-deltrack="${x.id}" class="danger">Delete</button></div>`).join('') || '<div class="note">No paths yet. Tap Record to start one.</div>';
  return `<h3>Pins</h3>${p}<h3>Walking paths</h3>${t}`;
}

function wireSaved() {
  document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { closeSheet(); map.flyTo({ center: b.dataset.go.split(',').map(Number), zoom: 16 }); });
  document.querySelectorAll('[data-fit]').forEach(b => b.onclick = async () => {
    const t = await db.get('tracks', b.dataset.fit);
    if (t.points.length < 2) return;
    const bounds = t.points.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(t.points[0], t.points[0]));
    state.hiddenTracks.delete(t.id); saveHidden(); await refreshTracks();
    closeSheet(); map.fitBounds(bounds, { padding: 60 });
  });
  document.querySelectorAll('[data-hide]').forEach(b => b.onclick = async () => {
    const k = b.dataset.hide;
    state.hiddenTracks.has(k) ? state.hiddenTracks.delete(k) : state.hiddenTracks.add(k);
    saveHidden(); await refreshTracks(); renderMenu('saved');
  });
  document.querySelectorAll('[data-sharetrack]').forEach(b => b.onclick = async () => {
    const t = await db.get('tracks', b.dataset.sharetrack);
    // GPX is the standard path file that onX, Google Earth, Garmin and others can open.
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Hunting Map" xmlns="http://www.topografix.com/GPX/1/1">`
      + `<trk><name>${esc(t.name)}</name><trkseg>${t.points.map(([x, y]) => `<trkpt lat="${y}" lon="${x}"/>`).join('')}</trkseg></trk></gpx>`;
    const file = new File([gpx], (t.name || 'path').replace(/[^\w -]/g, '') + '.gpx', { type: 'application/gpx+xml' });
    shareThing({ title: t.name, text: `${t.name} — ${miles(t.distance)}`, file });
  });
  document.querySelectorAll('[data-deltrack]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this path?')) return;
    await db.del('tracks', b.dataset.deltrack); await refreshTracks(); renderMenu('saved');
  });
}
function saveHidden() { localStorage.setItem('hiddenTracks', JSON.stringify([...state.hiddenTracks])); }

function aboutHtml() {
  return `<h3>Where the map comes from</h3>
    <div class="note"><b>Satellite (with signal):</b> Esri World Imagery — Esri, Vantor, Earthstar Geographics, GIS User Community.<br>
    <b>Satellite (offline):</b> USGS The National Map, USDA NAIP imagery (public domain). Slightly less sharp than Esri.<br>
    <b>Topo:</b> USGS The National Map (public domain).<br>
    <b>Property lines and owners:</b> Texas Geographic Information Office (TxGIO), StratMap Land Parcels, from county appraisal districts.<br>
    <b>Public hunting areas and seasons:</b> Texas Parks and Wildlife Department.<br>
    <b>Forest roads and trails:</b> USDA Forest Service (vehicle-use map).<br>
    <b>Animal sightings:</b> iNaturalist and eBird (Cornell Lab of Ornithology, via GBIF).<br>
    <b>Weather:</b> National Weather Service. <b>Sun, moon and feeding times:</b> calculated on your device.</div>
    <h3>Please keep in mind</h3>
    <div class="note">${DISCLAIMER} Public hunting boundaries can change; check the current TPWD map booklet and rules. You still need landowner permission to hunt private land.</div>
    <h3>Walking paths</h3>
    <div class="note">Your phone stops web apps when the screen locks, so keep the app open while recording. The screen stays on while recording.</div>`;
}

// ---------- Start ----------
map.on('load', async () => {
  applyBase();
  addPinIcons();
  applySightings();
  state.counties = await db.all('counties');
  state.counties.forEach(addCountyLayers);
  updateParcelLayers();
  await recoverTracks();
  await refreshPins();
  await refreshTracks();
  checkOnline();
});
