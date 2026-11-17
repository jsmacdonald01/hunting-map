/* global maplibregl */
// Builds the map itself: every picture layer, line layer and label, in drawing order (bottom first).
import { ESRI, TXGIO, ANIMALS, ACCENT, EMPTY } from './core.js';
import { USGS, IMG_MAX, TOPO_MAX, DEM_URL, DEM_MAX } from './offline.js';

const saved = JSON.parse(localStorage.getItem('view') || 'null');
const polys = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]];
const points = ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]];
const font = ['OpenSansSemibold'];
const fade = { duration: 400, delay: 0 };
const demAttribution = 'Terrain: Mapzen / AWS Terrain Tiles (USGS 3DEP)';

export const homeView = {
  center: saved?.center || [-95.45, 30.55], // Sam Houston National Forest
  zoom: saved?.zoom ?? 10,
  bearing: saved?.bearing || 0,
  pitch: saved?.pitch || 0,
  firstVisit: !saved,
};

export const map = new maplibregl.Map({
  container: 'map',
  center: homeView.center,
  zoom: homeView.zoom,
  bearing: homeView.bearing,
  pitch: localStorage.getItem('view3d') === '0' ? 0 : homeView.pitch,
  maxZoom: 19,
  maxPitch: 75,
  attributionControl: false,
  style: {
    version: 8,
    glyphs: new URL('fonts/', location.href).href + '{fontstack}/{range}.pbf',
    sky: { 'sky-color': '#6fb1f2', 'horizon-color': '#dcecff', 'fog-color': '#e6f0fa', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.6, 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 0.6, 9, 0] },
    sources: {
      esri: { type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom: 19, attribution: 'Satellite: Esri, Vantor, Earthstar Geographics, GIS User Community' },
      usgsimg: { type: 'raster', tiles: [USGS.usgsimg + '/{z}/{y}/{x}'], tileSize: 256, maxzoom: IMG_MAX, attribution: 'Offline satellite: USGS The National Map / USDA NAIP' },
      usgstopo: { type: 'raster', tiles: [USGS.usgstopo + '/{z}/{y}/{x}'], tileSize: 256, maxzoom: TOPO_MAX, attribution: 'Topo: USGS The National Map' },
      // Ground heights. Two copies of the same pictures: one shapes the 3D ground, one draws the hill shading.
      dem: { type: 'raster-dem', tiles: [DEM_URL + '/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: DEM_MAX, attribution: demAttribution },
      demShade: { type: 'raster-dem', tiles: [DEM_URL + '/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: DEM_MAX },
      parcelsLive: {
        type: 'raster', tileSize: 256, minzoom: 13,
        tiles: [TXGIO + '/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&dpi=192&format=png32&transparent=true&f=image'],
        attribution: 'Property lines: TxGIO StratMap Land Parcels',
      },
      public: { type: 'geojson', data: 'data/public-hunt.geojson', attribution: 'Public hunting areas: TPWD' },
      roads: { type: 'geojson', data: 'data/forest-roads.geojson', attribution: 'Forest roads and trails: USDA Forest Service' },
      sightings: { type: 'geojson', data: 'data/sightings.geojson', attribution: 'Sightings: iNaturalist, eBird (via GBIF)' },
      highlight: { type: 'geojson', data: EMPTY },
      hoverParcel: { type: 'geojson', data: EMPTY },
      scent: { type: 'geojson', data: EMPTY },
      measure: { type: 'geojson', data: EMPTY },
      guide: { type: 'geojson', data: EMPTY },
      tracks: { type: 'geojson', data: EMPTY },
      trackDraw: { type: 'geojson', data: EMPTY },
      live: { type: 'geojson', data: EMPTY },
      gps: { type: 'geojson', data: EMPTY },
      pins: { type: 'geojson', data: EMPTY },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0d1210' } },
      { id: 'usgsimg', type: 'raster', source: 'usgsimg', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0, 'raster-opacity-transition': fade } },
      { id: 'esri', type: 'raster', source: 'esri', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0, 'raster-opacity-transition': fade } },
      { id: 'usgstopo', type: 'raster', source: 'usgstopo', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0, 'raster-opacity-transition': fade } },
      { id: 'hillshade', type: 'hillshade', source: 'demShade',
        paint: { 'hillshade-method': 'igor', 'hillshade-illumination-anchor': 'map', 'hillshade-illumination-direction': 315, 'hillshade-illumination-altitude': 35,
                 'hillshade-exaggeration': 0.5, 'hillshade-shadow-color': 'rgba(8,16,28,0.55)', 'hillshade-highlight-color': 'rgba(255,244,214,0.28)', 'hillshade-accent-color': 'rgba(8,16,28,0.3)' } },
      // A see-through wash of color over the ground: gold at dawn, deep blue at night, grey under cloud.
      { id: 'tint', type: 'background', paint: { 'background-color': '#ffffff', 'background-opacity': 0 } },
      { id: 'parcelsLive', type: 'raster', source: 'parcelsLive', paint: { 'raster-opacity': 0.75 } },
      { id: 'pub-fill', type: 'fill', source: 'public', filter: polys,
        paint: { 'fill-color': ['match', ['get', 'kind'], 'nohunt', '#e03131', 'boundary', '#1e90ff', '#74c0fc'],
                 'fill-opacity': ['match', ['get', 'kind'], 'nohunt', 0.35, 'boundary', 0.15, 0.06] } },
      { id: 'pub-line', type: 'line', source: 'public', filter: polys,
        paint: { 'line-color': ['match', ['get', 'kind'], 'nohunt', '#e03131', 'boundary', '#1e90ff', '#74c0fc'],
                 'line-width': ['match', ['get', 'kind'], 'boundary', 3, 1.5] } },
      { id: 'pub-label', type: 'symbol', source: 'public', minzoom: 8,
        filter: ['all', polys, ['==', ['get', 'kind'], 'boundary']],
        layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 13, 'symbol-placement': 'point', 'text-max-width': 9 },
        paint: { 'text-color': '#fff', 'text-halo-color': '#0b3d91', 'text-halo-width': 1.6 } },
      { id: 'pub-sublabel', type: 'symbol', source: 'public', minzoom: 12,
        filter: ['all', polys, ['!=', ['get', 'kind'], 'boundary']],
        layout: { 'text-field': ['get', 'cls'], 'text-font': font, 'text-size': 11, 'text-max-width': 8 },
        paint: { 'text-color': '#fff', 'text-halo-color': ['match', ['get', 'kind'], 'nohunt', '#a51111', '#0b3d91'], 'text-halo-width': 1.4 } },
      { id: 'pub-points', type: 'circle', source: 'public', minzoom: 11, filter: points,
        paint: { 'circle-radius': 5, 'circle-color': '#1e90ff', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } },
      { id: 'pub-points-label', type: 'symbol', source: 'public', minzoom: 13, filter: points,
        layout: { 'text-field': ['get', 'cls'], 'text-font': font, 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top' },
        paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1.2 } },
      { id: 'roads-trail', type: 'line', source: 'roads', filter: ['==', ['get', 'kind'], 'trail'], minzoom: 10,
        paint: { 'line-color': '#d7ccc8', 'line-width': 2, 'line-dasharray': [2, 1.5], 'line-opacity': 0, 'line-opacity-transition': { duration: 1400, delay: 300 } } },
      { id: 'roads-ohv', type: 'line', source: 'roads', filter: ['==', ['get', 'kind'], 'ohv'], minzoom: 10,
        paint: { 'line-color': '#ce93d8', 'line-width': 2.5, 'line-dasharray': [1, 1], 'line-opacity': 0, 'line-opacity-transition': { duration: 1400, delay: 300 } } },
      { id: 'roads-road', type: 'line', source: 'roads', filter: ['==', ['get', 'kind'], 'road'], minzoom: 9,
        paint: { 'line-color': ['match', ['get', 'seasonal'], 'seasonal', '#ffca28', '#ffffff'], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 15, 4],
                 'line-opacity': 0, 'line-opacity-transition': { duration: 1400, delay: 300 } } },
      { id: 'roads-label', type: 'symbol', source: 'roads', minzoom: 12,
        layout: { 'symbol-placement': 'line', 'text-field': ['case', ['==', ['get', 'kind'], 'trail'], ['get', 'name'], ['concat', 'FS ', ['get', 'num']]],
                  'text-font': font, 'text-size': 11 },
        paint: { 'text-color': '#fff', 'text-halo-color': '#333', 'text-halo-width': 1.4 } },
      { id: 'sight-heat', type: 'heatmap', source: 'sightings', layout: { visibility: 'none' }, maxzoom: 16,
        paint: { 'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 8, 14, 30], 'heatmap-opacity': 0.75,
                 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 1.5] } },
      { id: 'sight-dots', type: 'circle', source: 'sightings', minzoom: 9,
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 15, 6],
                 'circle-color': ['match', ['get', 'a'], ...Object.entries(ANIMALS).flatMap(([k, v]) => [k, v[1]]), '#fff'],
                 'circle-stroke-color': '#000', 'circle-stroke-width': 1 } },
      // Property under the mouse (PC) and the tapped property, each with a soft glow under a crisp line.
      { id: 'hover-parcel', type: 'line', source: 'hoverParcel', paint: { 'line-color': '#fff3bf', 'line-width': 3, 'line-blur': 2, 'line-opacity': 0.9 } },
      { id: 'highlight-glow', type: 'line', source: 'highlight', layout: { 'line-join': 'round' },
        paint: { 'line-color': '#00e5ff', 'line-width': 12, 'line-blur': 10, 'line-opacity': 0, 'line-opacity-transition': { duration: 500, delay: 0 } } },
      { id: 'highlight', type: 'line', source: 'highlight', layout: { 'line-join': 'round' },
        paint: { 'line-color': '#7df9ff', 'line-width': 3, 'line-opacity': 0, 'line-opacity-transition': { duration: 350, delay: 0 } } },
      { id: 'highlight-label', type: 'symbol', source: 'highlight', filter: ['has', 'label'],
        layout: { 'text-field': ['get', 'label'], 'text-font': font, 'text-size': 14, 'text-max-width': 10, 'text-allow-overlap': true, 'text-ignore-placement': true },
        paint: { 'text-color': '#fff', 'text-halo-color': '#003b44', 'text-halo-width': 2, 'text-opacity': 0, 'text-opacity-transition': { duration: 700, delay: 250 } } },
      // Where your scent drifts from a pin (three stacked fans, so it fades with distance).
      { id: 'scent', type: 'fill', source: 'scent', paint: { 'fill-color': ACCENT, 'fill-opacity': 0.13 } },
      { id: 'scent-edge', type: 'line', source: 'scent', filter: ['==', ['get', 'outer'], true], paint: { 'line-color': ACCENT, 'line-width': 1.5, 'line-opacity': 0.7, 'line-dasharray': [2, 2] } },
      { id: 'measure-fill', type: 'fill', source: 'measure', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#00e5ff', 'fill-opacity': 0.15 } },
      { id: 'measure-line', type: 'line', source: 'measure', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#00e5ff', 'line-width': 3, 'line-dasharray': [2, 1] } },
      { id: 'measure-pts', type: 'circle', source: 'measure', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#00b8d4', 'circle-stroke-width': 2 } },
      { id: 'guide-glow', type: 'line', source: 'guide', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#76ff03', 'line-width': 9, 'line-blur': 7, 'line-opacity': 0.45 } },
      { id: 'guide', type: 'line', source: 'guide', paint: { 'line-color': '#b2ff59', 'line-width': 3.5, 'line-dasharray': [0, 4, 3] } },
      { id: 'tracks-glow', type: 'line', source: 'tracks', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ACCENT, 'line-width': 9, 'line-blur': 7, 'line-opacity': 0.35 } },
      { id: 'tracks', type: 'line', source: 'tracks', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ACCENT, 'line-width': 3.5 } },
      { id: 'track-draw', type: 'line', source: 'trackDraw', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffd8a8', 'line-width': 5, 'line-blur': 1 } },
      { id: 'live', type: 'line', source: 'live', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ff1744', 'line-width': 4.5 } },
      { id: 'gps-accuracy', type: 'fill', source: 'gps', paint: { 'fill-color': '#4dabf7', 'fill-opacity': 0.14 } },
      { id: 'gps-accuracy-edge', type: 'line', source: 'gps', paint: { 'line-color': '#74c0fc', 'line-width': 1, 'line-opacity': 0.6 } },
      { id: 'pins-glow', type: 'circle', source: 'pins',
        paint: { 'circle-radius': 22, 'circle-blur': 0.9, 'circle-opacity': 0.55, 'circle-pitch-alignment': 'map',
                 'circle-color': ['match', ['get', 'type'], 'blood', '#ff4d4d', 'truck', '#4dabf7', 'camp', '#b197fc', ACCENT] } },
      { id: 'pins', type: 'symbol', source: 'pins',
        layout: { 'icon-image': ['concat', 'pin-', ['get', 'type']], 'icon-size': 0.5, 'icon-allow-overlap': true, 'icon-ignore-placement': true } },
      { id: 'pins-label', type: 'symbol', source: 'pins', minzoom: 12,
        layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 12, 'text-offset': [0, 1.6], 'text-anchor': 'top' },
        paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1.4 } },
    ],
  },
});
window.huntingMap = map; // handy for testing

map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');
map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Hunting Map' }), 'bottom-right');

export const BASE_LAYERS = ['usgsimg', 'esri', 'usgstopo'];
export const ROAD_LAYERS = ['roads-trail', 'roads-ohv', 'roads-road'];

// Runs fn once the map has finished setting up (right away if it already has).
let isReady = false;
const waiting = [];
map.once('load', () => { isReady = true; waiting.splice(0).forEach(fn => fn()); });
export const whenReady = fn => (isReady ? fn() : waiting.push(fn));
