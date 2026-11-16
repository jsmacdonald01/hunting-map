// Property lines: live from the state when there's signal, saved copies for downloaded counties.
import { map } from './map.js';
import { $, esc, fmtMoney, titleCase, state, TXGIO, DISCLAIMER, EMPTY } from './core.js';
import { parcelTileUrl } from './offline.js';

export function inBbox([x, y], b) { return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]; }

export function addCountyLayers(c) {
  const src = 'parcels-' + c.id;
  if (map.getSource(src)) return;
  map.addSource(src, { type: 'vector', tiles: [parcelTileUrl(c.id)], minzoom: 12, maxzoom: 14, bounds: c.bbox, attribution: 'Property lines: TxGIO StratMap Land Parcels' });
  map.addLayer({ id: 'pf-' + c.id, type: 'fill', source: src, 'source-layer': 'parcels', minzoom: 12, paint: { 'fill-color': '#000', 'fill-opacity': 0 } }, 'pub-fill');
  map.addLayer({ id: 'pl-' + c.id, type: 'line', source: src, 'source-layer': 'parcels', minzoom: 12,
    paint: { 'line-color': '#ffd400', 'line-opacity': 0.9, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 16, 1.6] } }, 'pub-fill');
}
export function removeCountyLayers(key) {
  for (const l of ['pf-' + key, 'pl-' + key]) if (map.getLayer(l)) map.removeLayer(l);
  if (map.getSource('parcels-' + key)) map.removeSource('parcels-' + key);
}
export function updateParcelLayers() {
  if (!map.getLayer('parcelsLive')) return;
  const on = $('#lyr-parcels').checked;
  const center = map.getCenter().toArray();
  const covered = state.counties.some(c => inBbox(center, c.bbox));
  // Live lines when there's signal and this spot isn't downloaded; saved lines otherwise.
  map.setLayoutProperty('parcelsLive', 'visibility', on && state.online && !covered ? 'visible' : 'none');
  for (const c of state.counties) if (map.getLayer('pl-' + c.id)) map.setLayoutProperty('pl-' + c.id, 'visibility', on ? 'visible' : 'none');
}
export const savedParcelLayers = () => state.counties.map(c => 'pf-' + c.id).filter(l => map.getLayer(l));

function esriToGeo(g) {
  return g?.rings ? { type: 'Feature', geometry: { type: 'Polygon', coordinates: g.rings }, properties: {} } : null;
}

export async function identifyOnline(lngLat) {
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

export function parcelHtml(p) {
  const acres = p.acres ? `${Number(p.acres).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${Number(p.acres) === 1 ? 'acre' : 'acres'}` + (p.acresSource === 'mapped' ? ' <small>(measured from map)</small>' : '') : '';
  return `<h2>${p.owner ? esc(p.owner) : '<span class="dim">Owner not listed</span>'}</h2>
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

// On a PC, the property under the mouse lights up softly (saved counties only; live lines are just a picture).
let hoverKey = null;
if (matchMedia('(hover: hover)').matches) {
  map.on('mousemove', e => {
    const layers = savedParcelLayers();
    const f = layers.length && map.getZoom() >= 13 ? map.queryRenderedFeatures(e.point, { layers })[0] : null;
    const key = f ? (f.properties.id || f.properties.owner || '') + '|' + f.geometry.coordinates[0]?.length : null;
    if (key === hoverKey) return;
    hoverKey = key;
    map.getSource('hoverParcel')?.setData(f ? { type: 'Feature', geometry: f.geometry, properties: {} } : EMPTY);
  });
  map.on('mouseout', () => { hoverKey = null; map.getSource('hoverParcel')?.setData(EMPTY); });
}
