// The "Today" panel: weather and wind, legal shooting hours, moon and feeding times, and open seasons.
import { sunTimes, moonIllumination, moonPhaseName, solunar } from './astro.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time = d => d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
const addMin = (d, m) => new Date(d.getTime() + m * 60000);
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDay = s => new Date(s + 'T12:00').toLocaleDateString([], { month: 'short', day: 'numeric' });
const ARROWS = { N: 180, NNE: 202.5, NE: 225, ENE: 247.5, E: 270, ESE: 292.5, SE: 315, SSE: 337.5, S: 0, SSW: 22.5, SW: 45, WSW: 67.5, W: 90, WNW: 112.5, NW: 135, NNW: 157.5 };

// Wind arrow points the way the wind is blowing TO (so you can keep your scent off the animals).
const windArrow = dir => `<span class="wind" style="transform:rotate(${ARROWS[dir] ?? 0}deg)">↑</span>`;

async function weather(lat, lng) {
  const key = 'weather';
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 8000);
    const p = await (await fetch(`https://api.weather.gov/points/${lat.toFixed(3)},${lng.toFixed(3)}`, { signal: ctl.signal })).json();
    const h = await (await fetch(p.properties.forecastHourly, { signal: ctl.signal })).json();
    const periods = h.properties.periods.slice(0, 12).map(x => ({
      t: x.startTime, temp: x.temperature, wind: x.windSpeed, dir: x.windDirection, rain: x.probabilityOfPrecipitation?.value ?? 0, sky: x.shortForecast }));
    const data = { at: Date.now(), place: `${p.properties.relativeLocation?.properties?.city || ''}`, periods };
    try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* storage full */ }
    return data;
  } catch {
    try { const old = JSON.parse(localStorage.getItem(key)); if (old) return { ...old, stale: true }; } catch { /* none */ }
    return null;
  }
}

function weatherHtml(w) {
  if (!w) return '<h3>Weather</h3><div class="note">Needs signal. Open this panel once with signal and the last forecast is kept for later.</div>';
  const now = w.periods[0];
  const rows = w.periods.map(p => `<tr><td>${new Date(p.t).toLocaleTimeString([], { hour: 'numeric' })}</td>
    <td>${p.temp}°</td><td>${windArrow(p.dir)} ${esc(p.dir)} ${esc(p.wind)}</td><td>${p.rain}%</td></tr>`).join('');
  return `<h3>Weather${w.place ? ' near ' + esc(w.place) : ''}</h3>
    <div class="big">${now.temp}° · ${windArrow(now.dir)} ${esc(now.dir)} ${esc(now.wind)} · ${esc(now.sky)}</div>
    <div class="note">Arrow shows where the wind carries your scent.${w.stale ? ` Saved forecast from ${new Date(w.at).toLocaleString()} (no signal).` : ''}</div>
    <table class="wx"><tr><th>Time</th><th>Temp</th><th>Wind</th><th>Rain</th></tr>${rows}</table>`;
}

function sunHtml(lat, lng, now) {
  const s = sunTimes(now, lat, lng);
  return `<h3>Legal shooting hours today</h3>
    <dl><dt>Deer, hogs, squirrel, quail</dt><dd>${time(addMin(s.sunrise, -30))} – ${time(addMin(s.sunset, 30))}</dd>
    <dt>Dove, ducks, geese</dt><dd>${time(addMin(s.sunrise, -30))} – ${time(s.sunset)}</dd>
    <dt>Sunrise / sunset</dt><dd>${time(s.sunrise)} / ${time(s.sunset)}</dd></dl>
    <div class="note">Half an hour before sunrise to half an hour after sunset for game animals; migratory birds end at sunset.</div>`;
}

function moonHtml(lat, lng, now) {
  const ill = moonIllumination(now);
  const sol = solunar(now, lat, lng);
  const periods = sol.periods.map(p => {
    const live = now >= p.start && now <= p.end;
    return `<div class="${live ? 'live' : ''}"><b>${p.kind}</b> ${time(p.start)} – ${time(p.end)}${live ? ' · happening now' : ''}</div>`;
  }).join('');
  return `<h3>Moon and feeding times</h3>
    <div>${moonPhaseName(ill.phase)}, ${Math.round(ill.fraction * 100)}% lit · moonrise ${time(sol.moon.rise)}, moonset ${time(sol.moon.set)}</div>
    <div class="periods">${periods}</div>
    <div class="note">Solunar times: animals are often more active during major periods (moon overhead or underfoot) and minor periods (moonrise and moonset).</div>`;
}

let seasons = null;
async function seasonsHtml(now) {
  try { seasons ??= await (await fetch('data/seasons.json')).json(); } catch { return ''; }
  const today = ymd(now);
  const rows = seasons.species.map(sp => {
    if (sp.closed) return `<div class="item"><div class="grow"><b>${esc(sp.name)}</b><small>${esc(sp.note)}</small></div><span class="tag no">Closed</span></div>`;
    if (sp.year_round) return `<div class="item"><div class="grow"><b>${esc(sp.name)}</b><small>${esc(sp.bag || '')} ${esc(sp.note || '')}</small></div><span class="tag open">Open</span></div>`;
    const open = sp.seasons.filter(s => today >= s.from && today <= s.to);
    const next = sp.seasons.filter(s => s.from > today).sort((a, b) => a.from.localeCompare(b.from))[0];
    const list = sp.seasons.map(s => `${esc(s.label)}: ${fmtDay(s.from)} – ${fmtDay(s.to)}`).join('<br>');
    return `<div class="item"><div class="grow"><b>${esc(sp.name)}</b>
      <small>${open.length ? 'Now: ' + open.map(s => esc(s.label)).join(', ') : next ? `Next: ${esc(next.label)} on ${fmtDay(next.from)}` : 'Season over for this year'}</small>
      <details><summary>Dates and limits</summary><small>${list}${sp.bag ? '<br>Limit: ' + esc(sp.bag) : ''}${sp.note ? '<br>' + esc(sp.note) : ''}</small></details></div>
      <span class="tag ${open.length ? 'open' : 'no'}">${open.length ? 'Open' : 'Closed'}</span></div>`;
  }).join('');
  return `<h3>Hunting seasons ${esc(seasons.year)}</h3>
    <div class="note">For ${esc(seasons.counties.join(', '))} counties, from the TPWD Outdoor Annual (checked ${esc(seasons.checked)}).
    Always confirm current rules with <a href="${esc(seasons.source)}" target="_blank" rel="noopener">TPWD</a>.</div>${rows}`;
}

export async function conditionsHtml(lat, lng, online) {
  const now = new Date();
  const w = online ? await weather(lat, lng) : await weather(lat, lng).catch(() => null);
  return `<h2>Today</h2><div class="note">For the middle of the map${navigator.geolocation ? ' (or your location, if it’s on)' : ''}.</div>`
    + weatherHtml(w) + sunHtml(lat, lng, now) + moonHtml(lat, lng, now) + await seasonsHtml(now);
}
