const { getCfg } = require('./config')

const ICONS = [[0, '☀️'], [1, '🌤️'], [2, '⛅'], [3, '☁️'], [45, '🌫️'], [48, '🌫️'], [51, '🌦️'], [55, '🌦️'], [57, '🌦️'],
  [61, '🌧️'], [65, '🌧️'], [67, '🌧️'], [71, '❄️'], [77, '❄️'], [80, '🌦️'], [82, '🌧️'], [86, '❄️'], [95, '⛈️'], [99, '⛈️']]
const iconFor = code => { let out = '⛅'; for (const [c, i] of ICONS) if (code >= c) out = i; return out }

const DEMO = [
  { icon: '☀️', high: 33, low: 22, rain: 0, hum: 61 }, { icon: '⛅', high: 31, low: 21, rain: 0, hum: 66 },
  { icon: '☀️', high: 34, low: 23, rain: 0, hum: 58 }, { icon: '🌦️', high: 28, low: 20, rain: 12, hum: 78 },
  { icon: '🌧️', high: 25, low: 19, rain: 28, hum: 85 },
]

function label(dateStr, i) {
  if (i === 0) return 'Today'
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
}
function summarise(days, source, fetchedAt) {
  return { source, fetchedAt, days, rain24: days[0]?.rain ?? 0, rain5: days.reduce((s, d) => s + d.rain, 0) }
}
function demo() {
  const today = new Date()
  const days = DEMO.map((d, i) => {
    const dt = new Date(today.getTime() + i * 864e5)
    return { ...d, day: label(dt.toISOString().slice(0, 10), i) }
  })
  return summarise(days, 'demo', Date.now())
}

/**
 * Five-day forecast from Open-Meteo (free, no API key). Cached for 30 minutes; if the service
 * can't be reached the app falls back to demo numbers and says so (`source: 'demo'`).
 */
function createWeather(db, fetchImpl = globalThis.fetch) {
  let cache = null
  return async function getWeather() {
    const cfg = await getCfg(db)
    const key = `${cfg.lat},${cfg.lon}`
    if (cache && cache.key === key && Date.now() - cache.at < 30 * 60e3) return cache.data
    let data
    try {
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + cfg.lat + '&longitude=' + cfg.lon +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean&timezone=auto&forecast_days=5'
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(4000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const j = (await res.json()).daily
      const days = j.time.map((t, i) => ({
        day: label(t, i), icon: iconFor(j.weather_code[i]), high: Math.round(j.temperature_2m_max[i]),
        low: Math.round(j.temperature_2m_min[i]), rain: Math.round((j.precipitation_sum[i] ?? 0) * 10) / 10,
        hum: Math.round(j.relative_humidity_2m_mean?.[i] ?? 0),
      }))
      data = summarise(days, 'open-meteo', Date.now())
    } catch {
      data = demo()
    }
    // failures are cached briefly so a blocked network doesn't slow every request
    cache = { key, data, at: data.source === 'demo' ? Date.now() - 25 * 60e3 : Date.now() }
    return data
  }
}

module.exports = { createWeather, iconFor }
