// ============================================================================
// Maritime Rescue Dashboard — Bunbeg Coast Guard Station — CONFIG
// Edit values below; reload the page to apply.
// ============================================================================

window.CONFIG = {
  station: {
    name: 'Bunbeg Coast Guard Station',
    label: 'BUNBEG COAST GUARD STATION',
    latitude: 55.0645,
    longitude: -8.3039,
    timezone: 'Europe/Dublin'
  },

  refresh: {
    clockMs:        1000,
    weatherMs:      10 * 60 * 1000,   // 10 min
    marineMs:       10 * 60 * 1000,   // 10 min
    tideMs:         60 * 60 * 1000,   // 60 min
    warningsMs:      5 * 60 * 1000,   // 5 min
    offlineThresholdMs: 2 * 60 * 1000, // mark offline if no successful fetch in 2 min
    maxBackoffMs:    5 * 60 * 1000,   // 5 min cap on exponential backoff
    pressureTrendHours: 3             // hours to look back for pressure trend
  },

  // Visual alert thresholds. Cards pulse when any of these are exceeded.
  alerts: {
    windSustainedKmh: 50,
    windGustKmh:      75,
    waveHeightM:       3,
    visibilityKmMin:   1
  },

  // Card colour bands (left border). Numbers are upper bounds in km/h and metres.
  colorThresholds: {
    wind: { green: 20, yellow: 40, orange: 60 },
    wave: { green:  1, yellow:  2, orange:  4 }
  },

  // Met Éireann warnings. The endpoint URL on the public-facing site has
  // changed historically; the dashboard tries each URL in order and uses the
  // first that responds successfully. Add or replace URLs here if needed.
  // Keywords below are matched case-insensitively against the warning JSON.
  warnings: {
    // Met Éireann public warnings feed (verified 2026-05).
    // The dashboard tries each URL in order — if the live URL changes, add the
    // new one at the top of the list and reload.
    urls: [
      'https://www.met.ie/Open_Data/json/warning_IRELAND.json',
      'https://www.met.ie/Open_Data/json/warning_EI04.json'  // Donegal region code
    ],
    regionKeywords: ['donegal', 'ulster', 'connacht', 'marine', 'coastal', 'atlantic']
  },

  // Source fallback chains. Each canal tries sources in order; the first that
  // returns valid data wins, and its name is shown as a small badge on the card.
  // Open-Meteo combines several numerical weather models (ECMWF, DWD ICON, GFS,
  // MeteoFrance, etc.) — forcing a specific model gives REAL redundancy even
  // though the API is the same. If Open-Meteo itself is down, the dashboard
  // falls back to localStorage cache and keeps trying with exponential backoff.
  sources: {
    weather: [
      { name: 'Open-Meteo (mix)',   loader: 'openMeteo',     model: '' },
      { name: 'OpenWeatherMap',     loader: 'openWeatherMap' },           // needs OPENWEATHERMAP_KEY below — skipped silently if blank
      { name: 'Open-Meteo (ECMWF)', loader: 'openMeteo',     model: 'ecmwf_ifs025' },
      { name: 'Open-Meteo (GFS)',   loader: 'openMeteo',     model: 'gfs_seamless' }
    ],
    marine: [
      { name: 'Open-Meteo (best)', loader: 'openMeteoMarine', model: '' },
      { name: 'Open-Meteo (EWAM)', loader: 'openMeteoMarine', model: 'ewam' },
      { name: 'Open-Meteo (GWAM)', loader: 'openMeteoMarine', model: 'gwam' }
    ]
  },

  // Hourly forecast strip (xcweather-style)
  hourly: {
    hours: 12,
    showWave: true,
    showPrecip: true
  },

  // Optional API keys.
  //
  // TIDES (recommended for real operational use — without a key the tide curve
  // is a harmonic estimate, labelled "Estimated" in the UI):
  //   - Stormglass:  https://stormglass.io/    free 50 req/day  → paste into STORMGLASS_KEY
  //   - WorldTides:  https://www.worldtides.info/ free 100 req/month → paste into WORLDTIDES_KEY
  //
  // WEATHER backup (independent provider — without a key the weather chain
  // only uses Open-Meteo with different models. With a key, OpenWeatherMap
  // is tried in second position for real provider redundancy):
  //   - OpenWeatherMap:  https://openweathermap.org/api  free 60 req/min, 1M/mo
  //
  // The dashboard refreshes weather every 10 min so all free tiers are plenty.
  apiKeys: {
    STORMGLASS_KEY:    '',   // e.g. 'abcd1234-...-xyz'
    WORLDTIDES_KEY:    '',   // e.g. '01234567-89ab-...'
    OPENWEATHERMAP_KEY: ''   // e.g. '1234567890abcdef1234567890abcdef'
  },

  ui: {
    darkDefault: true,
    showSeconds: true
  }
};
