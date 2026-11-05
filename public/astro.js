// Sun and moon math (standard astronomy formulas, after Vladimir Agafonkin's SunCalc). Works offline.
const rad = Math.PI / 180, dayMs = 86400000, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397;
const toDays = d => d.valueOf() / dayMs - 0.5 + J1970 - J2000;
const fromJulian = j => new Date((j + 0.5 - J1970) * dayMs);
const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
const altitude = (H, phi, dec) => Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
const siderealTime = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
const solarMeanAnomaly = d => rad * (357.5291 + 0.98560028 * d);
function eclipticLongitude(M) {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + rad * 102.9372 + Math.PI;
}
function sunCoords(d) {
  const L = eclipticLongitude(solarMeanAnomaly(d));
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

// Sunrise and sunset for the calendar day of `date` at lat/lng.
export function sunTimes(date, lat, lng) {
  const lw = rad * -lng, phi = rad * lat;
  const d = toDays(date);
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = solarMeanAnomaly(ds), L = eclipticLongitude(M), dec = declination(L, 0);
  const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const w = Math.acos((Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
  const a = 0.0009 + (w + lw) / (2 * Math.PI) + n;
  const Jset = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const Jrise = Jnoon - (Jset - Jnoon);
  return { sunrise: fromJulian(Jrise), sunset: fromJulian(Jset), noon: fromJulian(Jnoon) };
}

function moonCoords(d) {
  const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.22935 * d);
  const l = L + rad * 6.289 * Math.sin(M), b = rad * 5.128 * Math.sin(F), dt = 385001 - 20905 * Math.cos(M);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: dt };
}

export function moonAltitude(date, lat, lng) {
  const lw = rad * -lng, phi = rad * lat, d = toDays(date);
  const c = moonCoords(d);
  const H = siderealTime(d, lw) - c.ra;
  let h = altitude(H, phi, c.dec);
  h += rad * 0.017 / Math.tan(h + rad * 10.26 / (h + rad * 5.10)); // air bends light a little
  return h / rad;
}

// fraction 0-1 lit; phase 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter
export function moonIllumination(date) {
  const d = toDays(date), s = sunCoords(d), m = moonCoords(d), sdist = 149598000;
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
  const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
  return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI };
}

export function moonPhaseName(phase) {
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return names[Math.round(phase * 8) % 8];
}

// Moon events for the local day: rise, set, overhead and underfoot, found by stepping through the day.
export function moonEvents(date, lat, lng) {
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const step = 5 * 60000, h0 = 0.133; // moon's edge at the horizon
  const ev = { rise: null, set: null, overhead: null, underfoot: null };
  let prev = moonAltitude(start, lat, lng), maxA = -99, minA = 99;
  for (let t = start.getTime() + step; t <= start.getTime() + dayMs; t += step) {
    const a = moonAltitude(new Date(t), lat, lng);
    if (prev < h0 && a >= h0 && !ev.rise) ev.rise = new Date(t);
    if (prev >= h0 && a < h0 && !ev.set) ev.set = new Date(t);
    if (a > maxA) { maxA = a; ev.overhead = new Date(t); }
    if (a < minA) { minA = a; ev.underfoot = new Date(t); }
    prev = a;
  }
  return ev;
}

// Solunar feeding times: major = moon overhead/underfoot (about 2 hours), minor = moonrise/moonset (about 1 hour).
export function solunar(date, lat, lng) {
  const m = moonEvents(date, lat, lng);
  const span = (t, mins) => t && { start: new Date(t - mins * 60000), end: new Date(t.getTime() + mins * 60000) };
  const out = [];
  if (m.overhead) out.push({ kind: 'Major', ...span(m.overhead, 60) });
  if (m.underfoot) out.push({ kind: 'Major', ...span(m.underfoot, 60) });
  if (m.rise) out.push({ kind: 'Minor', ...span(m.rise, 30) });
  if (m.set) out.push({ kind: 'Minor', ...span(m.set, 30) });
  return { periods: out.sort((a, b) => a.start - b.start), moon: m };
}
