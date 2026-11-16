// Shared bits every part of the app uses: small helpers, the lists of pin kinds and animals, and app-wide state.

// Pin kinds: label and the little picture drawn on the map.
export const PIN_TYPES = {
  stand: ['Stand / blind', '🪜', '#8d6e63'], camera: ['Trail camera', '📷', '#455a64'], scrape: ['Scrape', '🍂', '#ef6c00'],
  rub: ['Rub', '🌲', '#2e7d32'], deer: ['Deer seen', '🦌', '#795548'], hog: ['Hog sign', '🐗', '#5d4037'],
  blood: ['Blood trail', '🩸', '#c62828'], truck: ['Truck / parking', '🛻', '#1565c0'], camp: ['Camp', '⛺', '#6a1b9a'],
  other: ['Other', '📍', '#f9a825'],
};
// Sighting animals: label and dot color.
export const ANIMALS = {
  deer: ['Deer', '#ffb74d'], hog: ['Hogs', '#e53935'], turkey: ['Turkey', '#8e24aa'], duck: ['Ducks & geese', '#29b6f6'],
  dove: ['Doves', '#cfd8dc'], squirrel: ['Squirrels', '#a1887f'], rabbit: ['Rabbits', '#fff176'], quail: ['Quail', '#aed581'],
  woodcock: ['Woodcock', '#4db6ac'], coyote: ['Coyotes', '#ff8a65'],
};

export const ESRI = 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const TXGIO = 'https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer';
export const DISCLAIMER = 'Property lines are approximate (not a survey). Owner info comes from county appraisal records and can be blank or out of date.';
export const ACCENT = '#ff6a13'; // blaze orange

export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtBytes = b => b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB';
export const fmtMoney = v => v ? '$' + Number(v).toLocaleString() : '';
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const titleCase = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
export const miles = m => (m / 1609.34).toFixed(2) + ' mi';
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const EMPTY = { type: 'FeatureCollection', features: [] };

export const state = {
  base: localStorage.getItem('base') || 'sat',
  online: navigator.onLine,
  counties: [],     // downloaded counties
  rec: null,        // current recording
  hiddenTracks: new Set(JSON.parse(localStorage.getItem('hiddenTracks') || '[]')),
};

// A tiny message board so parts of the app can tell each other things ("the weather changed", "a pin was picked").
const board = new EventTarget();
export const on = (name, fn) => board.addEventListener(name, e => fn(e.detail));
export const emit = (name, detail) => board.dispatchEvent(new CustomEvent(name, { detail }));

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
