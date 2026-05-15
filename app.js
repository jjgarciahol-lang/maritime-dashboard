// ============================================================================
// Maritime Rescue Dashboard — Carrickfinn Station
// Plain vanilla JS. No frameworks. Designed for unattended kiosk operation.
// ============================================================================

(function () {
  'use strict';

  const C = window.CONFIG;
  if (!C) {
    console.error('CONFIG missing — config.js failed to load.');
    return;
  }

  // --------------------------------------------------------------------------
  // Logger
  // --------------------------------------------------------------------------
  const LOG = {
    info: (s, m) => console.log('[' + new Date().toISOString() + '][' + s + '] ' + m),
    warn: (s, m) => console.warn('[' + new Date().toISOString() + '][' + s + '] ' + m),
    err:  (s, e) => console.error('[' + new Date().toISOString() + '][' + s + ']', e)
  };

  // --------------------------------------------------------------------------
  // Runtime state
  // --------------------------------------------------------------------------
  const STATE = {
    pressureHistory: [],                                       // [{t,p}]
    failures:    { weather: 0, marine: 0, tide: 0, warnings: 0 },
    lastSuccess: { weather: 0, marine: 0, tide: 0, warnings: 0 },
    pendingTimers: {}
  };

  // --------------------------------------------------------------------------
  // DOM helpers
  // --------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);

  function cacheGet(key) {
    try { return JSON.parse(localStorage.getItem('mrd_' + key)); }
    catch (e) { return null; }
  }
  function cacheSet(key, v) {
    try { localStorage.setItem('mrd_' + key, JSON.stringify({ at: Date.now(), v: v })); }
    catch (e) { /* quota exhausted — ignore */ }
  }

  async function fetchJSON(url, opts) {
    const timeout = (opts && opts.timeout) || 15000;
    const headers = (opts && opts.headers) || {};
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store', headers: headers });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return await r.json();
    } finally {
      clearTimeout(tid);
    }
  }

  // --------------------------------------------------------------------------
  // Formatting / conversion
  // --------------------------------------------------------------------------
  function fmtTime(d, withSec) {
    if (!d) return '—';
    const dd = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dd.getTime())) return '—';
    const opts = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: C.station.timezone };
    if (withSec) opts.second = '2-digit';
    return dd.toLocaleTimeString('en-IE', opts);
  }
  function fmtDate(d) {
    return (d instanceof Date ? d : new Date(d)).toLocaleDateString('en-IE', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      timeZone: C.station.timezone
    });
  }
  function round1(v) { return v == null || isNaN(v) ? '—' : (Math.round(v * 10) / 10).toString(); }

  function cardinal(deg) {
    if (deg == null || isNaN(deg)) return '—';
    const d = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return d[Math.round(((deg % 360 + 360) % 360) / 22.5) % 16];
  }

  // Full-name compass for the main wind card — clearer than "N (357°)" for non-navy operators.
  function cardinalLong(deg) {
    if (deg == null || isNaN(deg)) return '—';
    const names = [
      'North', 'North-northeast', 'Northeast', 'East-northeast',
      'East',  'East-southeast', 'Southeast', 'South-southeast',
      'South', 'South-southwest', 'Southwest', 'West-southwest',
      'West',  'West-northwest', 'Northwest', 'North-northwest'
    ];
    return names[Math.round(((deg % 360 + 360) % 360) / 22.5) % 16];
  }

  function beaufort(kmh) {
    const t = [
      [1,    0, 'Calm'],         [6,    1, 'Light air'],
      [12,   2, 'Light breeze'], [20,   3, 'Gentle breeze'],
      [29,   4, 'Moderate'],     [39,   5, 'Fresh'],
      [50,   6, 'Strong'],       [62,   7, 'Near gale'],
      [75,   8, 'Gale'],         [89,   9, 'Strong gale'],
      [103, 10, 'Storm'],        [118, 11, 'Violent storm']
    ];
    for (const r of t) if (kmh < r[0]) return { n: r[1], name: r[2] };
    return { n: 12, name: 'Hurricane' };
  }

  // Douglas Sea State scale (0-9) based on significant wave height in metres.
  // Official WMO scale used by maritime services.
  function douglasSeaState(m) {
    if (m == null || isNaN(m)) return { n: null, name: '—' };
    if (m < 0.1)  return { n: 0, name: 'Calm' };
    if (m < 0.5)  return { n: 2, name: 'Smooth' };
    if (m < 1.25) return { n: 3, name: 'Slight' };
    if (m < 2.5)  return { n: 4, name: 'Moderate' };
    if (m < 4)    return { n: 5, name: 'Rough' };
    if (m < 6)    return { n: 6, name: 'Very rough' };
    if (m < 9)    return { n: 7, name: 'High' };
    if (m < 14)   return { n: 8, name: 'Very high' };
    return { n: 9, name: 'Phenomenal' };
  }

  const WMO_TEXT = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Depositing rime fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle',
    56: 'Freezing drizzle', 57: 'Heavy freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
    66: 'Freezing rain', 67: 'Heavy freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Rain showers', 81: 'Heavy showers', 82: 'Violent showers',
    85: 'Snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Storm with hail', 99: 'Severe storm with hail'
  };

  // --------------------------------------------------------------------------
  // Inline SVG icons
  // --------------------------------------------------------------------------
  function svgSun(size) {
    size = size || 56;
    const rays = Array.from({ length: 8 }, (_, i) => {
      const a = i * Math.PI / 4;
      const x1 = 32 + Math.cos(a) * 18, y1 = 32 + Math.sin(a) * 18;
      const x2 = 32 + Math.cos(a) * 28, y2 = 32 + Math.sin(a) * 28;
      return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 +
             '" stroke="#FACC15" stroke-width="3.5" stroke-linecap="round"/>';
    }).join('');
    return '<svg viewBox="0 0 64 64" width="' + size + '" height="' + size + '">' +
      '<circle cx="32" cy="32" r="11" fill="#FACC15"/>' + rays + '</svg>';
  }
  function svgCloud(size) {
    size = size || 56;
    return '<svg viewBox="0 0 64 64" width="' + size + '" height="' + size + '">' +
      '<path d="M16 44c-6 0-10-4-10-9s4-9 10-9c1-6 6-10 13-10 7 0 13 5 13 12 5 0 9 4 9 9s-4 9-9 9H16z" fill="#7C8A9D"/></svg>';
  }
  function svgPartCloud(size) {
    size = size || 56;
    return '<svg viewBox="0 0 64 64" width="' + size + '" height="' + size + '">' +
      '<circle cx="22" cy="22" r="10" fill="#FACC15"/>' +
      '<path d="M22 48c-5 0-9-4-9-8s4-8 9-8c1-5 5-8 10-8 6 0 10 4 10 10 4 0 8 3 8 7s-4 7-8 7H22z" fill="#7C8A9D"/></svg>';
  }
  function svgFog(size) {
    size = size || 56;
    return '<svg viewBox="0 0 64 64" width="' + size + '" height="' + size + '">' +
      '<g stroke="#7C8A9D" stroke-width="4" stroke-linecap="round">' +
      '<line x1="10" y1="22" x2="54" y2="22"/>' +
      '<line x1="6"  y1="34" x2="58" y2="34"/>' +
      '<line x1="14" y1="46" x2="50" y2="46"/></g></svg>';
  }
  function svgRain(size) {
    size = size || 56;
    return '<svg viewBox="0 0 64 64" width="' + size + '" height="' + size + '">' +
      '<path d="M16 38c-5 0-9-4-9-8s4-8 9-8c1-5 5-8 10-8 6 0 10 4 10 10 4 0 8 3 8 7s-4 7-8 7H16z" fill="#7C8A9D"/>' +
      '<g stroke="#38BDF8" stroke-width="3" stroke-linecap="round">' +
      '<line x1="20" y1="46" x2="16" y2="56"/>' +
      '<line x1="32" y1="46" x2="28" y2="56"/>' +
      '<line x1="44" y1="46" x2="40" y2="56"/></g></svg>';
  }
  function svgSnow(size) {
    size = size || 56;
    return '<svg viewBox="0 0 64 64" width="' + size + '" height="' + size + '">' +
      '<path d="M16 38c-5 0-9-4-9-8s4-8 9-8c1-5 5-8 10-8 6 0 10 4 10 10 4 0 8 3 8 7s-4 7-8 7H16z" fill="#7C8A9D"/>' +
      '<g fill="#ECEFF4"><circle cx="20" cy="50" r="2.5"/><circle cx="32" cy="54" r="2.5"/><circle cx="44" cy="50" r="2.5"/></g></svg>';
  }
  function svgStorm(size) {
    size = size || 56;
    return '<svg viewBox="0 0 64 64" width="' + size + '" height="' + size + '">' +
      '<path d="M16 38c-5 0-9-4-9-8s4-8 9-8c1-5 5-8 10-8 6 0 10 4 10 10 4 0 8 3 8 7s-4 7-8 7H16z" fill="#7C8A9D"/>' +
      '<path d="M30 40l-9 14h7l-3 8 12-16h-7l3-6z" fill="#FACC15"/></svg>';
  }

  function wmoIcon(code, size) {
    if (code == null) return svgCloud(size);
    if (code === 0) return svgSun(size);
    if (code === 1 || code === 2) return svgPartCloud(size);
    if (code === 3) return svgCloud(size);
    if (code === 45 || code === 48) return svgFog(size);
    if (code >= 51 && code <= 67) return svgRain(size);
    if (code >= 71 && code <= 77) return svgSnow(size);
    if (code >= 80 && code <= 82) return svgRain(size);
    if (code >= 85 && code <= 86) return svgSnow(size);
    if (code >= 95) return svgStorm(size);
    return svgCloud(size);
  }

  function svgSunrise() {
    return '<svg viewBox="0 0 64 64" width="36" height="36">' +
      '<line x1="6" y1="50" x2="58" y2="50" stroke="#FACC15" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M20 50 A12 12 0 0 1 44 50" fill="none" stroke="#FACC15" stroke-width="3"/>' +
      '<line x1="32" y1="14" x2="32" y2="26" stroke="#FACC15" stroke-width="3" stroke-linecap="round"/>' +
      '<polyline points="22,28 32,18 42,28" fill="none" stroke="#FACC15" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
  }
  function svgSunset() {
    return '<svg viewBox="0 0 64 64" width="36" height="36">' +
      '<line x1="6" y1="50" x2="58" y2="50" stroke="#FB923C" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M20 50 A12 12 0 0 1 44 50" fill="none" stroke="#FB923C" stroke-width="3"/>' +
      '<line x1="32" y1="14" x2="32" y2="26" stroke="#FB923C" stroke-width="3" stroke-linecap="round"/>' +
      '<polyline points="22,18 32,28 42,18" fill="none" stroke="#FB923C" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
  }

  // --------------------------------------------------------------------------
  // Wind rose SVG (programmatic)
  // --------------------------------------------------------------------------
  function renderWindRose(deg) {
    const svg = $('windRose');
    if (!svg) return;
    const cx = 100, cy = 100, r = 84;
    const RULE = '#2A3548', LBL = '#ECEFF4', INK = '#7C8A9D', ARROW = '#FB923C';
    let html = '<defs><marker id="arrHead" viewBox="0 0 10 10" refX="6" refY="5" ' +
               'markerWidth="5" markerHeight="5" orient="auto">' +
               '<path d="M 0 0 L 10 5 L 0 10 z" fill="' + ARROW + '"/></marker></defs>';
    // Concentric range rings — three soft circles instead of one dashed
    [0.35, 0.62, 1.0].forEach((f, i) => {
      html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * f) +
              '" fill="none" stroke="' + RULE + '" stroke-width="' + (i === 2 ? 1.5 : 0.8) + '"/>';
    });
    // 36 degree ticks (every 10°) — minor / major / cardinal
    for (let i = 0; i < 36; i++) {
      const a = i * 10 * Math.PI / 180 - Math.PI / 2;
      const isCard = i % 9 === 0;
      const isMaj  = i % 3 === 0;
      const inner = isCard ? r - 14 : (isMaj ? r - 9 : r - 5);
      const x1 = cx + Math.cos(a) * inner, y1 = cy + Math.sin(a) * inner;
      const x2 = cx + Math.cos(a) * r,     y2 = cy + Math.sin(a) * r;
      html += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 +
              '" stroke="' + INK + '" stroke-width="' + (isCard ? 1.8 : (isMaj ? 1 : 0.6)) + '"/>';
    }
    // Cardinal labels
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, a]) => {
      const rad = (a - 90) * Math.PI / 180;
      const tx = cx + Math.cos(rad) * (r - 26);
      const ty = cy + Math.sin(rad) * (r - 26) + 5;
      html += '<text x="' + tx + '" y="' + ty + '" text-anchor="middle" fill="' + LBL +
              '" font-size="14" font-weight="700" font-family="-apple-system,system-ui,sans-serif">' + t + '</text>';
    });
    if (deg != null && !isNaN(deg)) {
      // Wind direction = direction wind is COMING FROM.
      // Draw arrow pointing the way the wind is BLOWING (deg + 180).
      const fromRad = (deg - 90) * Math.PI / 180;
      const tailX = cx + Math.cos(fromRad) * (r - 22);
      const tailY = cy + Math.sin(fromRad) * (r - 22);
      const tipX  = cx - Math.cos(fromRad) * (r - 24);
      const tipY  = cy - Math.sin(fromRad) * (r - 24);
      html += '<line x1="' + tailX + '" y1="' + tailY + '" x2="' + tipX + '" y2="' + tipY +
              '" stroke="' + ARROW + '" stroke-width="5" stroke-linecap="round" marker-end="url(#arrHead)"/>';
      html += '<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="' + ARROW + '"/>';
    }
    svg.innerHTML = html;
  }

  function renderMiniCompass(svg, deg) {
    if (!svg) return;
    let html = '<circle cx="20" cy="20" r="16" fill="none" stroke="#7C8A9D" stroke-width="1.3"/>';
    html += '<text x="20" y="9" text-anchor="middle" fill="#7C8A9D" font-size="8" font-weight="700" font-family="-apple-system,system-ui,sans-serif">N</text>';
    if (deg != null && !isNaN(deg)) {
      const rad = (deg - 90) * Math.PI / 180;
      const tipX = 20 + Math.cos(rad) * 13;
      const tipY = 20 + Math.sin(rad) * 13;
      html += '<line x1="20" y1="20" x2="' + tipX + '" y2="' + tipY +
              '" stroke="#38BDF8" stroke-width="3" stroke-linecap="round"/>';
    }
    svg.innerHTML = html;
  }

  // --------------------------------------------------------------------------
  // Open-Meteo fetchers
  // --------------------------------------------------------------------------
  function buildWeatherURL(model) {
    const p = new URLSearchParams({
      latitude: C.station.latitude,
      longitude: C.station.longitude,
      timezone: C.station.timezone,
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility',
      hourly: 'pressure_msl,temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation',
      daily: 'sunrise,sunset,weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_direction_10m_dominant,precipitation_sum',
      wind_speed_unit: 'kmh',
      temperature_unit: 'celsius',
      precipitation_unit: 'mm',
      past_days: 1,
      forecast_days: 7
    });
    if (model) p.append('models', model);
    return 'https://api.open-meteo.com/v1/forecast?' + p.toString();
  }

  function buildMarineURL(model) {
    const p = new URLSearchParams({
      latitude: C.station.latitude,
      longitude: C.station.longitude,
      timezone: C.station.timezone,
      current: 'wave_height,wave_period,wave_direction,wind_wave_height,swell_wave_height,swell_wave_period,sea_surface_temperature',
      hourly: 'wave_height',
      daily: 'wave_height_max,wave_direction_dominant',
      forecast_days: 7
    });
    if (model) p.append('models', model);
    return 'https://marine-api.open-meteo.com/v1/marine?' + p.toString();
  }

  // OpenWeatherMap free-tier loader. Two-call fetch (current + 3h forecast),
  // translated into Open-Meteo response shape so renderers don't need to care
  // which provider served them.
  async function loadOpenWeatherMap() {
    const key = C.apiKeys && C.apiKeys.OPENWEATHERMAP_KEY;
    if (!key) throw new Error('OPENWEATHERMAP_KEY not set');
    const base = 'https://api.openweathermap.org/data/2.5';
    const q = '?lat=' + C.station.latitude + '&lon=' + C.station.longitude +
              '&units=metric&appid=' + key;
    const [now, fc] = await Promise.all([
      fetchJSON(base + '/weather' + q),
      fetchJSON(base + '/forecast' + q)
    ]);
    const owmToWmo = id => {
      if (id >= 200 && id < 300) return 95;
      if (id === 511)             return 66;
      if (id >= 300 && id < 400) return 53;
      if (id >= 500 && id < 600) return 63;
      if (id >= 600 && id < 700) return 73;
      if (id >= 700 && id < 800) return 45;
      if (id === 800)             return 0;
      if (id === 801)             return 1;
      if (id === 802)             return 2;
      return 3;
    };
    const list = (fc && fc.list) || [];
    const toIso = epoch => new Date(epoch * 1000).toISOString();
    return {
      current: {
        temperature_2m:        now.main && now.main.temp,
        apparent_temperature:  now.main && now.main.feels_like,
        relative_humidity_2m:  now.main && now.main.humidity,
        precipitation:         (now.rain && now.rain['1h']) || 0,
        weather_code:          owmToWmo(now.weather && now.weather[0] ? now.weather[0].id : 800),
        cloud_cover:           now.clouds && now.clouds.all,
        pressure_msl:          now.main && now.main.pressure,
        wind_speed_10m:        now.wind && now.wind.speed != null ? now.wind.speed * 3.6 : null,
        wind_direction_10m:    now.wind && now.wind.deg,
        wind_gusts_10m:        now.wind && now.wind.gust != null ? now.wind.gust * 3.6 : null,
        visibility:            now.visibility
      },
      hourly: {
        time:               list.map(x => x.dt_txt.replace(' ', 'T')),
        pressure_msl:       list.map(x => x.main && x.main.pressure),
        temperature_2m:     list.map(x => x.main && x.main.temp),
        weather_code:       list.map(x => owmToWmo(x.weather && x.weather[0] ? x.weather[0].id : 800)),
        wind_speed_10m:     list.map(x => x.wind && x.wind.speed != null ? x.wind.speed * 3.6 : null),
        wind_direction_10m: list.map(x => x.wind && x.wind.deg),
        precipitation:      list.map(x => (x.rain && x.rain['3h']) ? x.rain['3h'] / 3 : 0)
      },
      daily: {
        sunrise: now.sys && now.sys.sunrise ? [toIso(now.sys.sunrise)] : [],
        sunset:  now.sys && now.sys.sunset  ? [toIso(now.sys.sunset)]  : []
      }
    };
  }

  // Loaders dispatch table — each returns the raw response in Open-Meteo shape.
  const LOADERS = {
    openMeteo:        src => fetchJSON(buildWeatherURL(src.model || '')),
    openMeteoMarine:  src => fetchJSON(buildMarineURL(src.model || '')),
    openWeatherMap:   ()  => loadOpenWeatherMap()
  };

  // Try each source in the chain; return { data, source } from the first success.
  async function tryChain(sources, validate) {
    let lastErr = null;
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      const loader = LOADERS[src.loader] || LOADERS.openMeteo;
      try {
        const data = await loader(src);
        if (validate && !validate(data)) throw new Error('invalid response');
        return { data, source: src.name, fallback: i > 0 };
      } catch (e) { lastErr = e; LOG.warn('chain', src.name + ' → ' + e.message); }
    }
    throw lastErr || new Error('no sources configured');
  }

  async function loadWeather() {
    try {
      const sources = (C.sources && C.sources.weather) || [{ name: 'Open-Meteo', loader: 'openMeteo', model: '' }];
      const result = await tryChain(sources,
        d => d && d.current && d.current.temperature_2m != null);
      const data = result.data;
      cacheSet('weather', data);
      STATE.lastSuccess.weather = Date.now();
      STATE.failures.weather = 0;
      if (data.hourly && data.hourly.time && data.hourly.pressure_msl) {
        STATE.pressureHistory = data.hourly.time
          .map((t, i) => ({ t: new Date(t).getTime(), p: data.hourly.pressure_msl[i] }))
          .filter(x => !isNaN(x.p) && !isNaN(x.t));
      }
      STATE.lastWeatherHourly = data.hourly || null;
      STATE.lastWeatherDaily  = data.daily  || null;
      renderWeather(data, false, result);
      renderSun(data);
      renderHourly();
      renderDaily();
      markUpdated();
      LOG.info('weather', 'ok via ' + result.source);
    } catch (e) {
      LOG.err('weather', e);
      STATE.failures.weather++;
      const cached = cacheGet('weather');
      if (cached && cached.v) {
        renderWeather(cached.v, true, { source: 'cache', fallback: true });
        renderSun(cached.v);
        STATE.lastWeatherHourly = cached.v.hourly || null;
        STATE.lastWeatherDaily  = cached.v.daily  || null;
        renderHourly();
        renderDaily();
      }
      markStale('atmoCard');
      markStale('windCard');
    }
    scheduleFetch('weather', C.refresh.weatherMs);
  }

  async function loadMarine() {
    try {
      const sources = (C.sources && C.sources.marine) || [{ name: 'Open-Meteo', loader: 'openMeteoMarine', model: '' }];
      const result = await tryChain(sources,
        d => d && d.current && d.current.wave_height != null);
      const data = result.data;
      cacheSet('marine', data);
      STATE.lastSuccess.marine = Date.now();
      STATE.failures.marine = 0;
      STATE.lastMarineHourly = data.hourly || null;
      STATE.lastMarineDaily  = data.daily  || null;
      renderMarine(data, false, result);
      renderHourly();
      renderDaily();
      markUpdated();
      LOG.info('marine', 'ok via ' + result.source);
    } catch (e) {
      LOG.err('marine', e);
      STATE.failures.marine++;
      const cached = cacheGet('marine');
      if (cached && cached.v) {
        renderMarine(cached.v, true, { source: 'cache', fallback: true });
        STATE.lastMarineHourly = cached.v.hourly || null;
        STATE.lastMarineDaily  = cached.v.daily  || null;
        renderHourly();
        renderDaily();
      }
      markStale('seaCard');
    }
    scheduleFetch('marine', C.refresh.marineMs);
  }

  async function loadWarnings() {
    const urls = (C.warnings && C.warnings.urls) || [];
    let data = null, lastErr = null;
    for (const url of urls) {
      try {
        data = await fetchJSON(url);
        LOG.info('warnings', 'ok ' + url);
        break;
      } catch (e) { lastErr = e; LOG.warn('warnings', url + ' → ' + e.message); }
    }
    if (data) {
      cacheSet('warnings', data);
      STATE.lastSuccess.warnings = Date.now();
      STATE.failures.warnings = 0;
      renderWarnings(data);
    } else {
      LOG.err('warnings', lastErr || new Error('no warnings URL configured'));
      STATE.failures.warnings++;
      const cached = cacheGet('warnings');
      if (cached && cached.v) renderWarnings(cached.v);
    }
    scheduleFetch('warnings', C.refresh.warningsMs);
  }

  // --------------------------------------------------------------------------
  // Tide loaders
  // --------------------------------------------------------------------------
  async function loadTides() {
    try {
      let result;
      if (C.apiKeys.STORMGLASS_KEY)      result = await loadStormglass();
      else if (C.apiKeys.WORLDTIDES_KEY) result = await loadWorldTides();
      else                               result = computeHarmonicTides();
      cacheSet('tide', result);
      STATE.lastSuccess.tide = Date.now();
      STATE.failures.tide = 0;
      renderTides(result);
      LOG.info('tide', 'ok (' + result.source + ')');
    } catch (e) {
      LOG.err('tide', e);
      STATE.failures.tide++;
      const cached = cacheGet('tide');
      if (cached && cached.v) renderTides(cached.v);
      else renderTides(computeHarmonicTides());
    }
    scheduleFetch('tide', C.refresh.tideMs);
  }

  async function loadStormglass() {
    const start = Math.floor(Date.now() / 1000);
    const end   = start + 48 * 3600;
    const url = 'https://api.stormglass.io/v2/tide/extremes/point' +
                '?lat=' + C.station.latitude +
                '&lng=' + C.station.longitude +
                '&start=' + start + '&end=' + end;
    const data = await fetchJSON(url, { headers: { Authorization: C.apiKeys.STORMGLASS_KEY } });
    const extremes = (data.data || []).map(e => ({
      t: new Date(e.time).getTime(),
      h: e.height + 2.0,                          // Stormglass returns relative-to-MSL; shift to a positive datum
      type: e.type === 'high' ? 'high' : 'low'
    }));
    return { source: 'Stormglass', extremes, curve: buildCurveFromExtremes(extremes) };
  }

  async function loadWorldTides() {
    const start = Math.floor(Date.now() / 1000);
    const url = 'https://www.worldtides.info/api/v3?extremes' +
                '&lat=' + C.station.latitude +
                '&lon=' + C.station.longitude +
                '&start=' + start + '&length=' + (48 * 3600) +
                '&key=' + C.apiKeys.WORLDTIDES_KEY;
    const data = await fetchJSON(url);
    const extremes = (data.extremes || []).map(e => ({
      t: (e.dt || 0) * 1000,
      h: e.height,
      type: (e.type || '').toLowerCase() === 'high' ? 'high' : 'low'
    }));
    return { source: 'WorldTides', extremes, curve: buildCurveFromExtremes(extremes) };
  }

  function buildCurveFromExtremes(extremes) {
    if (!extremes || extremes.length < 2) return [];
    extremes = extremes.slice().sort((a, b) => a.t - b.t);
    const start = Date.now() - 12 * 3600 * 1000;
    const end   = Date.now() + 12 * 3600 * 1000;
    const out = [];
    for (let t = start; t <= end; t += 10 * 60 * 1000) {
      let prev = null, next = null;
      for (const e of extremes) {
        if (e.t <= t) prev = e;
        if (e.t > t && !next) { next = e; break; }
      }
      let h;
      if (prev && next) {
        const f = (t - prev.t) / (next.t - prev.t);
        // Cosine interpolation between extremes
        h = (prev.h + next.h) / 2 + (prev.h - next.h) / 2 * Math.cos(Math.PI * f);
      } else if (prev) h = prev.h;
      else if (next)   h = next.h;
      else             h = 2;
      out.push({ t, h });
    }
    return out;
  }

  // ----- Harmonic fallback: M2 + S2 + N2 superposition ----------------------
  function computeHarmonicTides() {
    const M2 = 12.4206 * 3600 * 1000;
    const S2 = 12.0000 * 3600 * 1000;
    const N2 = 12.6583 * 3600 * 1000;
    const MEAN = 2.0;
    // Anchor: approximate high water at this epoch for the Donegal coast.
    // Phase is rough — labelled "Estimated" in the UI. Replace with API key for accuracy.
    const REF = Date.UTC(2024, 0, 1, 4, 30, 0);
    function h(t) {
      const dt = t - REF;
      return MEAN
        + 1.20 * Math.cos(2 * Math.PI * dt / M2)
        + 0.35 * Math.cos(2 * Math.PI * dt / S2 + 0.5)
        + 0.25 * Math.cos(2 * Math.PI * dt / N2 + 1.2);
    }
    const start = Date.now() - 12 * 3600 * 1000;
    const end   = Date.now() + 12 * 3600 * 1000;
    const curve = [];
    for (let t = start; t <= end; t += 10 * 60 * 1000) curve.push({ t, h: h(t) });

    // Detect extremes by slope sign change
    const extremes = [];
    const scanStart = Date.now() - 6 * 3600 * 1000;
    const scanEnd   = Date.now() + 48 * 3600 * 1000;
    let lastT = scanStart, lastH = h(scanStart), prevSlope = null;
    for (let t = scanStart + 5 * 60 * 1000; t <= scanEnd; t += 5 * 60 * 1000) {
      const cur = h(t);
      const slope = cur - lastH;
      if (prevSlope != null && Math.sign(slope) !== Math.sign(prevSlope) && Math.sign(slope) !== 0) {
        extremes.push({ t: lastT, h: lastH, type: prevSlope > 0 ? 'high' : 'low' });
      }
      prevSlope = slope;
      lastT = t;
      lastH = cur;
    }
    return { source: 'Estimated (harmonic M2+S2+N2)', extremes, curve };
  }

  // --------------------------------------------------------------------------
  // Renderers
  // --------------------------------------------------------------------------
  function setSourceBadge(id, srcInfo) {
    const el = $(id);
    if (!el) return;
    if (!srcInfo) { el.textContent = ''; el.classList.remove('fallback', 'cache'); return; }
    el.textContent = srcInfo.source;
    el.classList.toggle('fallback', !!srcInfo.fallback && srcInfo.source !== 'cache');
    el.classList.toggle('cache', srcInfo.source === 'cache');
  }

  function renderWeather(data, stale, srcInfo) {
    if (!data || !data.current) return;
    const c = data.current;
    if (srcInfo) {
      setSourceBadge('atmoSrc', srcInfo);
      setSourceBadge('windSrc', srcInfo);
    }

    $('temp').textContent = round1(c.temperature_2m);
    $('feels').textContent = round1(c.apparent_temperature);
    $('humidity').textContent = (c.relative_humidity_2m != null) ? Math.round(c.relative_humidity_2m) + ' %' : '—';
    $('precip').textContent   = (c.precipitation != null) ? c.precipitation.toFixed(1) + ' mm/h' : '—';

    // Visibility — critical for rescue, lives in its own callout
    const visEl = $('visibility');
    const visStateEl = $('visState');
    const visCallout = $('visCallout');
    const visKm = (c.visibility != null) ? c.visibility / 1000 : null;
    if (visKm != null) {
      visEl.textContent = visKm >= 10 ? Math.round(visKm) + ' km' : visKm.toFixed(1) + ' km';
    } else { visEl.textContent = '—'; }
    // 3-tier state: good / poor / dangerous
    if (visCallout) {
      visCallout.classList.remove('danger', 'warning');
      if (visKm != null) {
        if (visKm < C.alerts.visibilityKmMin) {
          visCallout.classList.add('danger');
          if (visStateEl) visStateEl.textContent = 'Dangerous';
        } else if (visKm < 4) {
          visCallout.classList.add('warning');
          if (visStateEl) visStateEl.textContent = 'Poor';
        } else if (visKm < 10) {
          if (visStateEl) visStateEl.textContent = 'Moderate';
        } else {
          if (visStateEl) visStateEl.textContent = 'Good';
        }
      } else if (visStateEl) visStateEl.textContent = '';
    }

    // Pressure + trend — now with explicit Δ value over 3 h
    const pVal = $('pressureValue');
    const tEl  = $('pressureTrend');
    if (c.pressure_msl != null) {
      pVal.textContent = Math.round(c.pressure_msl) + ' hPa';
      const targetT = Date.now() - C.refresh.pressureTrendHours * 3600 * 1000;
      let nearest = null, nearestDt = Infinity;
      for (const x of STATE.pressureHistory) {
        const dt = Math.abs(x.t - targetT);
        if (dt < nearestDt) { nearestDt = dt; nearest = x; }
      }
      tEl.className = 'trend';
      if (nearest && nearestDt < 90 * 60 * 1000) {
        const d = c.pressure_msl - nearest.p;
        const sign = d > 0 ? '+' : '';
        if (d > 1)       { tEl.textContent = '↑ ' + sign + d.toFixed(1); tEl.classList.add('up'); }
        else if (d < -1) { tEl.textContent = '↓ ' + d.toFixed(1);         tEl.classList.add('down'); }
        else             { tEl.textContent = '→ steady'; }
      } else { tEl.textContent = ''; }
    } else { pVal.textContent = '—'; tEl.textContent = ''; }

    // Sky
    $('skyIcon').innerHTML = wmoIcon(c.weather_code, 56);
    $('skyText').textContent = WMO_TEXT[c.weather_code] || ('Code ' + c.weather_code);

    // Wind
    const ws = c.wind_speed_10m, wg = c.wind_gusts_10m, wd = c.wind_direction_10m;
    $('windSpeed').textContent = round1(ws);
    const knotsEl = $('windKnots');
    if (knotsEl) knotsEl.textContent = (ws != null) ? Math.round(ws / 1.852) + ' kn' : '';
    $('windDir').textContent   = (wd != null) ? 'from ' + cardinalLong(wd) + ' · ' + Math.round(wd) + '°' : '—';
    $('windGust').textContent  = (wg != null) ? round1(wg) + ' km/h · ' + Math.round(wg / 1.852) + ' kn' : '—';
    const bf = beaufort(ws == null ? 0 : ws);
    $('beaufortBadge').textContent = bf.n + ' — ' + bf.name;
    renderWindRose(wd);
    renderBeaufortLegend(ws == null ? null : bf.n);

    // Wind card colour level + alert
    const wEl = $('windCard');
    wEl.classList.remove('lvl-green', 'lvl-yellow', 'lvl-orange', 'lvl-red');
    if (ws != null) {
      const t = C.colorThresholds.wind;
      if      (ws <= t.green)  wEl.classList.add('lvl-green');
      else if (ws <= t.yellow) wEl.classList.add('lvl-yellow');
      else if (ws <= t.orange) wEl.classList.add('lvl-orange');
      else                     wEl.classList.add('lvl-red');
    }
    const alertWind = (ws != null && ws > C.alerts.windSustainedKmh) ||
                      (wg != null && wg > C.alerts.windGustKmh);
    wEl.classList.toggle('alert', alertWind);

    // Atmospheric alert: low visibility
    const atmoAlert = (visKm != null && visKm < C.alerts.visibilityKmMin);
    $('atmoCard').classList.toggle('alert', atmoAlert);

    if (!stale) {
      $('atmoCard').classList.remove('stale');
      $('windCard').classList.remove('stale');
    }
  }

  function renderMarine(data, stale, srcInfo) {
    if (!data || !data.current) return;
    const c = data.current;
    if (srcInfo) setSourceBadge('seaSrc', srcInfo);

    $('waveHeight').textContent  = (c.wave_height       != null) ? c.wave_height.toFixed(1) : '—';
    $('wavePeriod').textContent  = (c.wave_period       != null) ? c.wave_period.toFixed(1) + ' s' : '—';
    $('waveDir').textContent     = (c.wave_direction    != null) ? cardinal(c.wave_direction) + ' (' + Math.round(c.wave_direction) + '°)' : '—';
    renderMiniCompass($('waveDirCompass'), c.wave_direction);
    $('swellHeight').textContent = (c.swell_wave_height != null) ? c.swell_wave_height.toFixed(1) + ' m' : '—';
    $('swellPeriod').textContent = (c.swell_wave_period != null) ? c.swell_wave_period.toFixed(1) + ' s' : '—';
    $('sst').textContent         = (c.sea_surface_temperature != null) ? c.sea_surface_temperature.toFixed(1) + ' °C' : '—';

    // Douglas sea state — visual legend below the wave height, same idea as Beaufort
    const w = c.wave_height;
    const ds = douglasSeaState(w);
    renderDouglasLegend(ds.n);
    const dsCur = $('douglasCurrent');
    if (dsCur) dsCur.textContent = (ds.n != null) ? ds.n + ' · ' + ds.name : '—';

    const seaEl = $('seaCard');
    seaEl.classList.remove('lvl-green', 'lvl-yellow', 'lvl-orange', 'lvl-red');
    if (w != null) {
      const t = C.colorThresholds.wave;
      if      (w <= t.green)  seaEl.classList.add('lvl-green');
      else if (w <= t.yellow) seaEl.classList.add('lvl-yellow');
      else if (w <= t.orange) seaEl.classList.add('lvl-orange');
      else                    seaEl.classList.add('lvl-red');
    }
    seaEl.classList.toggle('alert', w != null && w > C.alerts.waveHeightM);
    if (!stale) seaEl.classList.remove('stale');
  }

  // Douglas sea-state legend (0-9), same visual idea as Beaufort: a row of colour
  // chips with the current level highlighted.
  function renderDouglasLegend(currentN) {
    const wrap = $('douglasLegend');
    if (!wrap) return;
    const labels = ['Calm','Calm','Smooth','Slight','Moderate','Rough','Very rough','High','Very high','Phenomenal'];
    const colours = ['var(--safe)','var(--safe)','var(--safe)',
                     'var(--caution)','var(--caution)',
                     'var(--warning)',
                     'var(--danger)','var(--danger)','var(--danger)','var(--danger)'];
    let html = '';
    for (let n = 0; n <= 9; n++) {
      const isCur = n === currentN;
      html += '<div class="ds-cell' + (isCur ? ' current' : '') + '" ' +
              'style="background:' + colours[n] + ';" title="' + n + ' — ' + labels[n] + '">' + n + '</div>';
    }
    wrap.innerHTML = html;
  }

  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // Forecast strip — single row, 6 hourly (every 2 h) + 6 daily
  // --------------------------------------------------------------------------
  function renderForecast() {
    const hourlyEl = $('forecastHourly');
    const dailyEl  = $('forecastDaily');
    if (!hourlyEl && !dailyEl) return;
    const wh = STATE.lastWeatherHourly;
    const mh = STATE.lastMarineHourly;
    const wd = STATE.lastWeatherDaily;
    const md = STATE.lastMarineDaily;
    let html = '';

    // ---- 6 HOURLY CELLS (every 2 hours starting from now) ----
    if (wh && wh.time) {
      const now = Date.now();
      let start = 0;
      for (let i = 0; i < wh.time.length; i++) {
        if (new Date(wh.time[i]).getTime() >= now - 30 * 60 * 1000) { start = i; break; }
      }
      for (let k = 0; k < 6; k++) {
        const i = start + k * 2;
        if (i >= wh.time.length) break;
        const t = new Date(wh.time[i]);
        const hh = ('0' + t.getHours()).slice(-2);
        const temp = wh.temperature_2m && wh.temperature_2m[i];
        const ws = wh.wind_speed_10m && wh.wind_speed_10m[i];
        const wdir = wh.wind_direction_10m && wh.wind_direction_10m[i];
        const pr = wh.precipitation && wh.precipitation[i];
        const code = wh.weather_code && wh.weather_code[i];
        let wave = null;
        if (mh && mh.time && mh.wave_height) {
          const tgt = t.getTime();
          for (let j = 0; j < mh.time.length; j++) {
            if (Math.abs(new Date(mh.time[j]).getTime() - tgt) < 30 * 60 * 1000) {
              wave = mh.wave_height[j]; break;
            }
          }
        }
        const arrow = wdir != null
          ? '<span class="fc-arrow" style="display:inline-block;transform:rotate(' + ((wdir + 180) % 360) + 'deg);">↑</span>'
          : '';
        const windCls = (ws != null && ws > C.alerts.windSustainedKmh) ? ' alert' : '';
        const waveCls = (wave != null && wave > C.alerts.waveHeightM) ? ' alert' : '';
        const rainCls = (pr != null && pr > 0.05) ? '' : ' dry';
        const rainTxt = (pr != null && pr > 0.05) ? pr.toFixed(1) + ' mm' : '— mm';
        html += '<div class="fc-cell hourly">' +
          '<div class="fc-time">' + hh + ':00</div>' +
          '<div class="fc-icon">' + wmoIcon(code, 26) + '</div>' +
          '<div class="fc-temp">' + (temp != null ? Math.round(temp) + '°' : '—') + '</div>' +
          '<div class="fc-wind' + windCls + '">' + arrow + (ws != null ? Math.round(ws) : '—') + '</div>' +
          '<div class="fc-wave' + waveCls + '">' + (wave != null ? wave.toFixed(1) + ' m' : '— m') + '</div>' +
          '<div class="fc-rain' + rainCls + '">' + rainTxt + '</div>' +
        '</div>';
      }
    }
    if (hourlyEl) hourlyEl.innerHTML = html;
    html = '';

    // ---- 6 DAILY CELLS (starting from tomorrow) ----
    if (wd && wd.time) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let start = 0;
      for (let i = 0; i < wd.time.length; i++) {
        const t = new Date(wd.time[i]);
        t.setHours(0, 0, 0, 0);
        if (t.getTime() > today.getTime()) { start = i; break; }
      }
      const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      for (let k = 0; k < 6; k++) {
        const i = start + k;
        if (i >= wd.time.length) break;
        const date = new Date(wd.time[i]);
        const dname = dayNames[date.getDay()] + ' ' + date.getDate();
        const code = wd.weather_code && wd.weather_code[i];
        const tmax = wd.temperature_2m_max && wd.temperature_2m_max[i];
        const tmin = wd.temperature_2m_min && wd.temperature_2m_min[i];
        const wmax = wd.wind_speed_10m_max && wd.wind_speed_10m_max[i];
        const wdom = wd.wind_direction_10m_dominant && wd.wind_direction_10m_dominant[i];
        const psum = wd.precipitation_sum && wd.precipitation_sum[i];
        const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
        let wmax_wave = null;
        if (md && md.time && md.wave_height_max) {
          for (let j = 0; j < md.time.length; j++) {
            const dt = new Date(md.time[j]);
            const dtMidnight = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
            if (dtMidnight === dateMidnight) {
              wmax_wave = md.wave_height_max[j]; break;
            }
          }
        }
        const arrow = wdom != null
          ? '<span class="fc-arrow" style="display:inline-block;transform:rotate(' + ((wdom + 180) % 360) + 'deg);">↑</span>'
          : '';
        const windCls = (wmax != null && wmax > C.alerts.windSustainedKmh) ? ' alert' : '';
        const waveCls = (wmax_wave != null && wmax_wave > C.alerts.waveHeightM) ? ' alert' : '';
        const rainCls = (psum != null && psum > 0.5) ? '' : ' dry';
        const rainTxt = (psum != null && psum > 0.5) ? psum.toFixed(1) + ' mm' : '— mm';
        html += '<div class="fc-cell daily">' +
          '<div class="fc-day">' + dname + '</div>' +
          '<div class="fc-icon">' + wmoIcon(code, 26) + '</div>' +
          '<div class="fc-temp">' + (tmax != null ? Math.round(tmax) + '°' : '—') +
            '<span class="fc-tmin">' + (tmin != null ? Math.round(tmin) + '°' : '—') + '</span></div>' +
          '<div class="fc-wind' + windCls + '">' + arrow + (wmax != null ? Math.round(wmax) : '—') + '</div>' +
          '<div class="fc-wave' + waveCls + '">' + (wmax_wave != null ? wmax_wave.toFixed(1) + ' m' : '— m') + '</div>' +
          '<div class="fc-rain' + rainCls + '">' + rainTxt + '</div>' +
        '</div>';
      }
    }
    if (dailyEl) dailyEl.innerHTML = html;
  }

  // Thin shims so the rest of app.js keeps calling renderHourly()/renderDaily()
  // and they both end up in the unified renderForecast.
  function renderHourly() { renderForecast(); }
  function renderDaily()  { renderForecast(); }

  function renderTides(tide) {
    $('tideSource').textContent = tide.source ? '(' + tide.source + ')' : '';
    const svg = $('tideChart');
    const curve = tide.curve || [];
    const W = 1200, H = 220;
    const padL = 44, padR = 14, padT = 18, padB = 30;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    if (curve.length < 2) {
      svg.innerHTML = '<text x="600" y="110" text-anchor="middle" fill="#93A0B5" font-size="18">No tide data available</text>';
      $('tideTable').innerHTML = '<div class="tide-row"><span class="lbl">—</span><span>No data</span><span></span></div>';
      return;
    }

    const now = Date.now();
    const tStart = now - 12 * 3600 * 1000;
    const tEnd   = now + 12 * 3600 * 1000;
    // Include curve points AND extremes (HW/LW) in the Y range so dots aren't clipped
    const heights = curve.map(p => p.h);
    if (tide.extremes) {
      for (const e of tide.extremes) {
        if (e.t >= tStart && e.t <= tEnd) heights.push(e.h);
      }
    }
    const hMin = Math.min.apply(null, heights) - 0.3;
    const hMax = Math.max.apply(null, heights) + 0.3;
    const xFor = t => padL + (t - tStart) / (tEnd - tStart) * innerW;
    const yFor = h => padT + (1 - (h - hMin) / (hMax - hMin)) * innerH;

    let html = '';

    // Hour gridlines + labels (every 3h)
    for (let i = -12; i <= 12; i += 3) {
      const t = now + i * 3600 * 1000;
      const x = xFor(t);
      html += '<line x1="' + x + '" y1="' + padT + '" x2="' + x + '" y2="' + (padT + innerH) +
              '" stroke="#1E2A3C" stroke-width="1" stroke-dasharray="2,3"/>';
      const lbl = (i === 0 ? 'NOW' : (i > 0 ? '+' : '') + i + 'h');
      html += '<text x="' + x + '" y="' + (H - 10) + '" text-anchor="middle" fill="' + (i === 0 ? '#FACC15' : '#7C8A9D') + '" ' +
              'font-size="12" font-weight="' + (i === 0 ? '700' : '500') + '" font-family="-apple-system,system-ui,sans-serif">' + lbl + '</text>';
    }

    // Y-axis labels
    for (let i = 0; i <= 4; i++) {
      const h = hMin + (hMax - hMin) * i / 4;
      const y = yFor(h);
      html += '<text x="' + (padL - 6) + '" y="' + (y + 4) +
              '" text-anchor="end" fill="#7C8A9D" font-size="11" font-family="-apple-system,system-ui,sans-serif">' + h.toFixed(1) + 'm</text>';
    }

    // Curve path
    let path = '';
    curve.forEach((p, i) => {
      const x = xFor(p.t).toFixed(1);
      const y = yFor(p.h).toFixed(1);
      path += (i ? 'L' : 'M') + x + ' ' + y + ' ';
    });
    const fillPath = path + 'L' + xFor(tEnd).toFixed(1) + ' ' + (padT + innerH) +
                     ' L' + xFor(tStart).toFixed(1) + ' ' + (padT + innerH) + ' Z';
    html += '<path d="' + fillPath + '" fill="rgba(56, 189, 248, 0.14)"/>';
    html += '<path d="' + path + '" fill="none" stroke="#38BDF8" stroke-width="2.5"/>';

    // Current time marker
    const curX = xFor(now);
    const curPoint = curve.reduce((acc, p) => Math.abs(p.t - now) < Math.abs(acc.t - now) ? p : acc, curve[0]);
    html += '<line x1="' + curX + '" y1="' + padT + '" x2="' + curX + '" y2="' + (padT + innerH) +
            '" stroke="#FACC15" stroke-width="2"/>';
    html += '<circle cx="' + curX + '" cy="' + yFor(curPoint.h) + '" r="6" fill="#FACC15" stroke="#0B131D" stroke-width="2"/>';

    // Extremes within window
    (tide.extremes || []).filter(e => e.t >= tStart && e.t <= tEnd).forEach(e => {
      const x = xFor(e.t);
      const y = yFor(e.h);
      const col = e.type === 'high' ? '#4ADE80' : '#FACC15';
      html += '<circle cx="' + x + '" cy="' + y + '" r="5" fill="' + col + '"/>';
      const labelY = e.type === 'high' ? y - 12 : y + 18;
      html += '<text x="' + x + '" y="' + labelY +
              '" text-anchor="middle" fill="' + col + '" font-size="11" font-weight="700" font-family="-apple-system,system-ui,sans-serif">' +
              (e.type === 'high' ? 'HW' : 'LW') + ' ' + fmtTime(new Date(e.t)) + '</text>';
    });

    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = html;

    // Side table: rising/falling status + next 4 events
    const upcoming = (tide.extremes || []).filter(e => e.t >= now - 5 * 60 * 1000).slice(0, 4);
    let table = '';
    if (upcoming.length) {
      const trend = upcoming[0].type === 'high' ? 'Rising →' : 'Falling →';
      table += '<div class="tide-row now"><span class="lbl">NOW</span><span>' + trend + '</span>' +
               '<span>' + curPoint.h.toFixed(2) + ' m</span></div>';
      upcoming.forEach(e => {
        const dtMs = e.t - now;
        const hrs = Math.floor(Math.max(0, dtMs) / 3600000);
        const mins = Math.floor((Math.max(0, dtMs) % 3600000) / 60000);
        const inStr = dtMs > 0 ? 'in ' + (hrs > 0 ? hrs + 'h ' : '') + mins + 'm' : 'now';
        table += '<div class="tide-row ' + (e.type === 'high' ? 'high' : 'low') + '">' +
                 '<span class="lbl">' + (e.type === 'high' ? 'HIGH' : 'LOW') + '</span>' +
                 '<span>' + fmtTime(new Date(e.t)) + ' · ' + inStr + '</span>' +
                 '<span>' + e.h.toFixed(2) + ' m</span></div>';
      });
    } else {
      table = '<div class="tide-row"><span class="lbl">—</span><span>No upcoming events</span><span></span></div>';
    }
    $('tideTable').innerHTML = table;
  }

  function renderWarnings(data) {
    const banner = $('warningBanner');
    const text = $('warningText');
    if (!data) { banner.classList.add('hidden'); return; }

    let arr = [];
    if (Array.isArray(data)) arr = data;
    else if (Array.isArray(data.warnings)) arr = data.warnings;
    else if (typeof data === 'object') arr = Object.values(data).filter(x => x && typeof x === 'object');

    const now = Date.now();
    const matches = arr.filter(w => {
      if (!w || typeof w !== 'object') return false;
      if (w.expiry) {
        const exp = new Date(w.expiry).getTime();
        if (exp && exp < now) return false;
      }
      const blob = JSON.stringify(w).toLowerCase();
      return C.warnings.regionKeywords.some(k => blob.includes(k.toLowerCase()));
    });

    if (!matches.length) { banner.classList.add('hidden'); return; }

    const sevOrder = { yellow: 1, orange: 2, red: 3 };
    let worst = 'yellow';
    matches.forEach(m => {
      const lvl = String(m.level || m.severity || m.colour || m.color || 'yellow').toLowerCase();
      if (sevOrder[lvl] && sevOrder[lvl] > sevOrder[worst]) worst = lvl;
    });

    banner.classList.remove('hidden', 'sev-yellow', 'sev-orange', 'sev-red');
    banner.classList.add('sev-' + worst);

    const items = matches.map(m => {
      const head = m.headline || m.type || m.title || 'Marine warning';
      const region = m.regions || m.region || '';
      const exp = m.expiry ? ' (until ' + fmtTime(new Date(m.expiry)) + ')' : '';
      return '⚠ ' + head + (region ? ' — ' + region : '') + exp;
    });
    const combined = items.join('     •     ');
    text.textContent = combined;

    // Marquee only if text is wide
    requestAnimationFrame(() => {
      const overflow = text.scrollWidth > banner.clientWidth - 20;
      banner.classList.toggle('scrolling', overflow);
    });
  }

  function renderSun(data) {
    if (!data || !data.daily) return;
    const sunriseArr = data.daily.sunrise || [];
    const sunsetArr  = data.daily.sunset  || [];

    // Pick today's index by matching the most recent sunrise <= now (or first if all future)
    const now = Date.now();
    let idx = 0;
    for (let i = 0; i < sunriseArr.length; i++) {
      const t = new Date(sunriseArr[i]).getTime();
      if (t <= now) idx = i; else break;
    }
    const sr = sunriseArr[idx], ss = sunsetArr[idx];
    const srNext = sunriseArr[idx + 1];

    $('sunrise').textContent  = sr ? fmtTime(new Date(sr)) : '—';
    $('sunset').textContent   = ss ? fmtTime(new Date(ss)) : '—';
    $('sunriseIcon').innerHTML = svgSunrise();
    $('sunsetIcon').innerHTML  = svgSunset();

    if (ss) {
      const ssT = new Date(ss).getTime();
      if (ssT > now) {
        const rem = ssT - now;
        const h = Math.floor(rem / 3600000);
        const m = Math.floor((rem % 3600000) / 60000);
        $('daylightRemaining').textContent = h + 'h ' + m + 'm';
      } else if (srNext) {
        const rem = new Date(srNext).getTime() - now;
        if (rem > 0) {
          const h = Math.floor(rem / 3600000);
          const m = Math.floor((rem % 3600000) / 60000);
          $('daylightRemaining').textContent = 'Night · sunrise in ' + h + 'h ' + m + 'm';
        } else {
          $('daylightRemaining').textContent = 'Night';
        }
      } else {
        $('daylightRemaining').textContent = 'Night';
      }
    }

    const phase = moonPhase(new Date());
    $('moonPhase').textContent = phase.name + ' (' + Math.round(phase.illum * 100) + '%)';
    $('moonIcon').innerHTML = moonSvg(phase.frac);
  }

  function moonPhase(d) {
    const epoch = Date.UTC(2000, 0, 6, 18, 14, 0);
    const synodic = 29.5305882 * 86400 * 1000;
    let frac = ((d.getTime() - epoch) % synodic) / synodic;
    if (frac < 0) frac += 1;
    const illum = 0.5 * (1 - Math.cos(2 * Math.PI * frac));
    let name;
    if      (frac < 0.03 || frac > 0.97) name = 'New moon';
    else if (frac < 0.22) name = 'Waxing crescent';
    else if (frac < 0.28) name = 'First quarter';
    else if (frac < 0.47) name = 'Waxing gibbous';
    else if (frac < 0.53) name = 'Full moon';
    else if (frac < 0.72) name = 'Waning gibbous';
    else if (frac < 0.78) name = 'Last quarter';
    else                  name = 'Waning crescent';
    return { frac, illum, name };
  }

  function moonSvg(frac) {
    const cx = 18, cy = 18, r = 14;
    const isWaxing = frac < 0.5;
    const phaseAngle = frac * 2 * Math.PI;
    const litFrac = 0.5 * (1 - Math.cos(phaseAngle));
    const rx = Math.abs(Math.cos(phaseAngle)) * r;
    const isGibbous = litFrac > 0.5;
    const outerSweep = isWaxing ? 1 : 0;
    let innerSweep;
    if (isWaxing) innerSweep = isGibbous ? 1 : 0;
    else          innerSweep = isGibbous ? 0 : 1;
    const d = 'M ' + cx + ' ' + (cy - r) +
              ' A ' + r + ' ' + r + ' 0 0 ' + outerSweep + ' ' + cx + ' ' + (cy + r) +
              ' A ' + rx + ' ' + r + ' 0 0 ' + innerSweep + ' ' + cx + ' ' + (cy - r) + ' Z';
    return '<svg viewBox="0 0 36 36" width="36" height="36">' +
           '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#1E2A3C" stroke="#7C8A9D" stroke-width="1"/>' +
           '<path d="' + d + '" fill="#ECEFF4"/></svg>';
  }

  function renderBeaufortLegend(current) {
    // Beaufort color bands: calm-light (green), moderate-fresh (yellow), strong-near gale (orange), gale+ (red)
    const colours = ['var(--safe)', 'var(--safe)', 'var(--safe)', 'var(--safe)',
                     'var(--caution)', 'var(--caution)',
                     'var(--warning)', 'var(--warning)',
                     'var(--danger)', 'var(--danger)', 'var(--danger)', 'var(--danger)', 'var(--danger)'];
    let html = '';
    for (let n = 0; n <= 12; n++) {
      const color = n <= 7 ? '#0B131D' : '#fff';
      const cls = (current != null && current === n) ? ' current' : '';
      html += '<div class="bf-cell bf-' + n + cls + '" style="background:' + colours[n] + ';color:' + color + ';" title="Force ' + n + '">' + n + '</div>';
    }
    $('bfLegend').innerHTML = html;
    const curEl = $('bfCurrent');
    if (curEl) curEl.textContent = current != null ? current : '—';
  }

  // --------------------------------------------------------------------------
  // Clock + stale tracking
  // --------------------------------------------------------------------------
  function tickClock() {
    const d = new Date();
    $('clock').textContent = fmtTime(d, C.ui.showSeconds);
    $('dateText').textContent = fmtDate(d);
  }

  function markUpdated() {
    $('lastUpdated').textContent = fmtTime(new Date(), true);
    const wrap = $('lastUpdated').parentElement;
    if (wrap) wrap.classList.remove('stale');
  }
  function markStale(cardId) {
    const el = $(cardId);
    if (el) el.classList.add('stale');
  }

  function checkOffline() {
    const ages = [STATE.lastSuccess.weather, STATE.lastSuccess.marine]
      .filter(x => x > 0)
      .map(x => Date.now() - x);
    const minAge = ages.length ? Math.min.apply(null, ages) : Infinity;
    const offline = !navigator.onLine || minAge > C.refresh.offlineThresholdMs;
    $('offlineBanner').classList.toggle('hidden', !offline);
    const wrap = $('lastUpdated').parentElement;
    if (wrap) wrap.classList.toggle('stale', offline);
  }

  // --------------------------------------------------------------------------
  // Backoff scheduler
  // --------------------------------------------------------------------------
  function scheduleFetch(name, baseMs) {
    clearTimeout(STATE.pendingTimers[name]);
    const f = STATE.failures[name] || 0;
    let delay = baseMs;
    if (f > 0) {
      delay = Math.min(C.refresh.maxBackoffMs, baseMs * Math.pow(2, Math.min(f, 5)));
      LOG.warn(name, 'backoff: ' + f + ' failures, next in ' + Math.round(delay / 1000) + 's');
    }
    STATE.pendingTimers[name] = setTimeout(() => {
      if (document.hidden) {
        // Don't hammer when tab is hidden — short-circuit and re-check soon
        scheduleFetch(name, 30000);
        return;
      }
      if      (name === 'weather')  loadWeather();
      else if (name === 'marine')   loadMarine();
      else if (name === 'tide')     loadTides();
      else if (name === 'warnings') loadWarnings();
    }, delay);
  }

  // --------------------------------------------------------------------------
  // Init
  // --------------------------------------------------------------------------
  function init() {
    LOG.info('init', 'Maritime Rescue Dashboard starting');

    $('stationLabel').textContent = C.station.label;
    const lat = C.station.latitude, lon = C.station.longitude;
    $('stationCoords').textContent =
      Math.abs(lat).toFixed(5) + '° ' + (lat >= 0 ? 'N' : 'S') + ', ' +
      Math.abs(lon).toFixed(5) + '° ' + (lon >= 0 ? 'E' : 'W');
    document.title = C.station.label;

    if (!C.ui.darkDefault) {
      document.body.classList.remove('theme-dark');
      document.body.classList.add('theme-light');
      $('themeToggle').textContent = '☀';
    }

    $('themeToggle').addEventListener('click', () => {
      const isDark = document.body.classList.contains('theme-dark');
      document.body.classList.toggle('theme-dark', !isDark);
      document.body.classList.toggle('theme-light', isDark);
      $('themeToggle').textContent = isDark ? '☀' : '☾';
    });

    renderBeaufortLegend();
    renderWindRose(null);

    tickClock();
    setInterval(tickClock, C.refresh.clockMs);
    setInterval(checkOffline, 15000);

    // Paint from cache immediately so we have something on screen
    const wc = cacheGet('weather');
    if (wc && wc.v) {
      renderWeather(wc.v, true, { source: 'cache', fallback: true });
      renderSun(wc.v);
      STATE.lastWeatherHourly = wc.v.hourly || null;
      STATE.lastWeatherDaily  = wc.v.daily  || null;
      markStale('atmoCard'); markStale('windCard');
    }
    const mc = cacheGet('marine');
    if (mc && mc.v) {
      renderMarine(mc.v, true, { source: 'cache', fallback: true });
      STATE.lastMarineHourly = mc.v.hourly || null;
      STATE.lastMarineDaily  = mc.v.daily  || null;
      markStale('seaCard');
    }
    renderHourly();
    renderDaily();
    const tc = cacheGet('tide');
    if (tc && tc.v) renderTides(tc.v);
    const wac = cacheGet('warnings');
    if (wac && wac.v) renderWarnings(wac.v);

    // Initial fetches
    loadWeather();
    loadMarine();
    loadTides();
    loadWarnings();

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        LOG.info('visibility', 'visible — refresh');
        loadWeather(); loadMarine(); loadWarnings();
        if (Date.now() - STATE.lastSuccess.tide > C.refresh.tideMs) loadTides();
      }
    });

    window.addEventListener('online',  () => { LOG.info('net', 'online');  loadWeather(); loadMarine(); loadWarnings(); });
    window.addEventListener('offline', () => { LOG.warn('net', 'offline'); checkOffline(); });

    // Watchdog: every minute, if a fetch loop somehow stalled, kick it back to life
    setInterval(() => {
      const now = Date.now();
      ['weather','marine','warnings','tide'].forEach(n => {
        const base = C.refresh[n + 'Ms'];
        if (!base) return;
        const last = STATE.lastSuccess[n];
        if (last && now - last > base * 4) {
          LOG.warn('watchdog', n + ' stale > ' + (base * 4) + 'ms, kicking');
          scheduleFetch(n, 1000);
        }
      });
    }, 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
