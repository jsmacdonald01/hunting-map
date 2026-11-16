// The Layers panel: map type (with a smooth fade between them), what's shown on top, and the "no signal" check.
import { map, BASE_LAYERS, ROAD_LAYERS } from './map.js';
import { $, $$, esc, titleCase, state, ANIMALS, ESRI, emit } from './core.js';
import { updateParcelLayers } from './parcels.js';

// ---------- Map type: satellite, hybrid (satellite with topo lines over it), topo ----------
let swap = 0;
export function applyBase({ instant = false } = {}) {
  const sat = state.base !== 'topo';
  const want = {
    esri: sat && state.online ? 1 : 0,
    usgsimg: sat && !state.online ? 1 : 0,
    usgstopo: state.base === 'topo' ? 1 : state.base === 'hybrid' ? 0.5 : 0,
  };
  const set = (l, v) => map.setPaintProperty(l, 'raster-opacity', v);
  const hide = l => { if (!want[l]) map.setLayoutProperty(l, 'visibility', 'none'); };
  const mine = ++swap;
  // Bring the new pictures in first, then fade the old ones away, so there's never a blank moment.
  for (const l of BASE_LAYERS) if (want[l]) { map.setLayoutProperty(l, 'visibility', 'visible'); set(l, want[l]); }
  if (instant) { for (const l of BASE_LAYERS) if (!want[l]) { set(l, 0); hide(l); } }
  else {
    setTimeout(() => { if (mine === swap && !want.usgstopo) set('usgstopo', 0); }, 200);
    setTimeout(() => { if (mine === swap) for (const l of ['esri', 'usgsimg']) if (!want[l]) set(l, 0); }, 700);
    setTimeout(() => { if (mine === swap) BASE_LAYERS.forEach(hide); }, 1300);
  }
  $$('[data-base]').forEach(b => b.classList.toggle('on', b.dataset.base === state.base));
  emit('base', state.base);
}
$$('[data-base]').forEach(b => b.onclick = () => {
  state.base = b.dataset.base; localStorage.setItem('base', state.base); applyBase();
});

const closePanel = () => { $('#layers').hidden = true; $('#btn-layers').classList.remove('on'); };
export { closePanel as closeLayersPanel };
$('#btn-layers').onclick = () => { $('#layers').hidden = !$('#layers').hidden; $('#btn-layers').classList.toggle('on', !$('#layers').hidden); };

const showAll = (layers, on) => layers.forEach(l => map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none'));
$('#lyr-public').onchange = e => showAll(['pub-fill', 'pub-line', 'pub-label', 'pub-sublabel', 'pub-points', 'pub-points-label'], e.target.checked);
$('#lyr-parcels').onchange = updateParcelLayers;
$('#lyr-roads').onchange = e => showAll([...ROAD_LAYERS, 'roads-label'], e.target.checked);

// ---------- Online / offline ----------
function showStatus() {
  const el = $('#status');
  el.hidden = state.online;
  el.textContent = 'No signal — showing downloaded maps';
}
function setOnline(ok) {
  if (ok !== state.online) { state.online = ok; applyBase(); updateParcelLayers(); emit('online', ok); }
  showStatus();
}
export async function checkOnline() {
  let ok = false;
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(ESRI.replace('{z}/{y}/{x}', '0/0/0') + '?t=' + Date.now(), { cache: 'no-store', signal: ctl.signal });
    ok = r.ok;
  } catch { ok = false; }
  setOnline(ok);
}
window.addEventListener('online', checkOnline);
window.addEventListener('offline', () => setOnline(false));
setInterval(checkOnline, 30000);

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

export function applySightings() {
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
  emit('sightings', { heat: sight.on && sight.style === 'heat' });
}
$('#lyr-sight').onchange = e => { sight.on = e.target.checked; applySightings(); };
$('#sight-animals').onchange = e => { e.target.checked ? sight.animals.add(e.target.value) : sight.animals.delete(e.target.value); applySightings(); };
$('#sight-months').onchange = e => { sight.months = e.target.value; applySightings(); };
$('#sight-style').onchange = e => { sight.style = e.target.value; applySightings(); };

// ---------- What the tap card says about each kind of thing ----------
export function sightingHtml(feats) {
  if (!feats.length) return '';
  const rows = feats.slice(0, 6).map(f => {
    const p = f.properties;
    return `<div><i class="dot" style="background:${ANIMALS[p.a]?.[1]}"></i><b>${esc(ANIMALS[p.a]?.[0] || p.a)}</b> · ${p.d ? new Date(p.d + 'T12:00').toLocaleDateString() : 'date unknown'} <small>(${esc(p.s)})</small></div>`;
  }).join('');
  return `<h3>Animal sightings here</h3>${rows}${feats.length > 6 ? `<div class="note">…and ${feats.length - 6} more nearby.</div>` : ''}
    <div class="note">Sightings people logged on ${feats.some(f => f.properties.s === 'eBird') ? 'eBird and ' : ''}iNaturalist. A sighting means an animal was seen there once, not that it lives there.</div>`;
}

export function roadHtml(feats) {
  if (!feats.length) return '';
  return '<h3>Forest roads and trails</h3>' + feats.slice(0, 3).map(f => {
    const p = f.properties;
    const title = p.kind === 'trail' ? (p.name || 'Trail') : `Forest road ${p.num}${p.name ? ' (' + titleCase(p.name) + ')' : ''}`;
    return `<div><b>${esc(title)}</b><br><small>${esc(p.use)}${p.open ? ` · open ${esc(p.open)} (month/day)` : ''}${p.surface ? ' · ' + esc(p.surface) : ''}</small></div>`;
  }).join('') + '<div class="note">From the Forest Service vehicle-use map. Gates and closures can change; check the ranger district.</div>';
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

export function publicHtml(feats) {
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

// Called once the map is ready.
export function startLayers() {
  applyBase({ instant: true });
  applySightings();
  // Roads and trails start see-through and fade in, so they appear to draw themselves.
  for (const l of ROAD_LAYERS) map.setPaintProperty(l, 'line-opacity', 1);
  showStatus();
}
