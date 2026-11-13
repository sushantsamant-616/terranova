const { getCfg, getStatus, litresFor } = require('./config')

const RANK = { urgent: 0, high: 1, medium: 2 }
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const ago = ms => { const m = Math.round((Date.now() - ms) / 60e3); return m < 1 ? 'just now' : m < 90 ? `${m}m ago` : `${Math.round(m / 60)}h ago` }

/**
 * Recommendations computed from live data: soil moisture vs your thresholds, the moisture trend,
 * rainfall in the forecast, and sensor salinity (EC). Nothing here is stored except dismissals.
 */
async function buildRecs(db, weather) {
  const cfg = await getCfg(db)
  const now = Date.now()
  const plots = await db.find('plots', {}, { sort: { pos: 1 } })
  const sensors = await db.find('sensors', { plot_id: { $ne: null } }, { sort: { pos: 1 } })
  const open = await db.find('irrigation', { status: { $in: ['scheduled', 'running'] } })
  const hidden = new Set((await db.find('rec_state', { until: { $gt: now } })).map(r => r.rec_key))
  const recs = []

  const trendPerDay = async plotId => {
    const rows = await db.find('readings', { plot_id: plotId, moisture: { $ne: null }, ts: { $gte: now - 24 * 3600e3 } }, { sort: { ts: 1 }, fields: ['ts', 'moisture'] })
    if (rows.length < 4) return null
    const first = rows[0], last = rows[rows.length - 1]
    const days = (last.ts - first.ts) / 864e5
    return days > 0.2 ? (last.moisture - first.moisture) / days : null
  }
  const rainText = weather.rain5 > 0 ? `${weather.rain5} mm of rain is forecast over the next 5 days.` : 'No rain is forecast over the next 5 days.'

  for (const p of plots) {
    const status = getStatus(p.moisture, cfg.crit, cfg.watch)
    const sensor = sensors.find(s => s.plot_id === p.id)
    const basis = sensor ? `${sensor.id} · ${ago(sensor.last_seen ?? p.moisture_at)}` : `Manual reading · ${p.moisture_at ? ago(p.moisture_at) : 'unknown'}`

    if (status === 'critical' || status === 'watch') {
      const trend = await trendPerDay(p.id)
      const trendText = trend != null && trend < -0.5 ? ` Moisture is falling about ${Math.abs(trend).toFixed(1)} points per day.` : ''
      const held = status !== 'critical' && weather.rain24 >= cfg.rainSkipMm
      if (held) {
        recs.push({
          key: `hold:${p.id}`, plotId: p.id, plot: p.name, type: 'Advisory', priority: 'medium', canSchedule: false,
          action: `Hold irrigation: ${weather.rain24} mm of rain expected within 24 hours`,
          reason: `${p.name} is at ${p.moisture.toFixed(0)}% (below the ${cfg.watch}% watch level), but enough rain is forecast to recover it.${trendText} Re-check after the rain.`,
          mm: 0, litres: 0, volume: '—', timing: 'Re-check in 24 hours', basis, scheduledFor: null, kind: null,
        })
      } else {
        const mm = clamp(Math.round((cfg.target - p.moisture) * 0.6), 5, 40)
        const litres = litresFor(mm, p.area, cfg.dripFactor)
        const priority = status === 'critical' ? 'urgent' : p.moisture < (cfg.crit + cfg.watch) / 2 ? 'high' : 'medium'
        const timing = { urgent: 'Within 6 hours', high: 'Within 24 hours', medium: 'In 2 days' }[priority]
        const delay = { urgent: 1, high: 12, medium: 36 }[priority] * 3600e3
        recs.push({
          key: `irrigate:${p.id}`, plotId: p.id, plot: p.name, type: 'Irrigation', priority, canSchedule: true,
          action: `Apply ${mm}mm drip irrigation${priority === 'urgent' ? ' immediately' : ''}`,
          reason: `Moisture is ${p.moisture.toFixed(0)}%, ${status === 'critical' ? `${(cfg.crit - p.moisture).toFixed(0)} points below the critical level (${cfg.crit}%)` : `${(cfg.watch - p.moisture).toFixed(0)} points below the watch level (${cfg.watch}%)`}.${trendText} ${rainText}`,
          mm, litres, volume: `${mm}mm / ${litres.toLocaleString('en-IN')} L`, timing, basis, scheduledFor: now + delay, kind: 'irrigation',
        })
      }
    }

    if (sensor?.ec != null && sensor.ec > 2.0) {
      const mm = 10, litres = litresFor(mm, p.area, cfg.dripFactor)
      recs.push({
        key: `flush:${p.id}`, plotId: p.id, plot: p.name, type: 'Irrigation', priority: 'high', canSchedule: true,
        action: `Leaching irrigation (${mm}mm) to flush salts`,
        reason: `Soil salinity (EC) is ${sensor.ec} dS/m, above the 2.0 dS/m limit for sugarcane. A light extra irrigation moves salts below the root zone.`,
        mm, litres, volume: `${mm}mm / ${litres.toLocaleString('en-IN')} L`, timing: 'Within 24 hours', basis, scheduledFor: now + 12 * 3600e3, kind: 'irrigation',
      })
    } else if (sensor?.ec != null && sensor.ec < 0.8) {
      const mm = 12, litres = litresFor(mm, p.area, cfg.dripFactor)
      recs.push({
        key: `fert:${p.id}`, plotId: p.id, plot: p.name, type: 'Fertigation', priority: 'high', canSchedule: true,
        action: `Apply N-P-K 15-5-20 via drip at ${mm}mm`,
        reason: `Soil EC is only ${sensor.ec} dS/m, which indicates low nutrient availability. A potassium-rich fertigation round supports stalk density.`,
        mm, litres, volume: `${mm}mm + fertilizer`, timing: 'Within 24 hours', basis, scheduledFor: now + 12 * 3600e3, kind: 'fertigation',
      })
    }
  }

  return recs
    .filter(r => !hidden.has(r.key))
    .map(r => {
      const scheduled = r.canSchedule && open.some(e => e.plot_id === r.plotId && e.kind === r.kind)
      return { ...r, state: scheduled ? 'scheduled' : 'open' }
    })
    .sort((a, b) => RANK[a.priority] - RANK[b.priority])
}

module.exports = { buildRecs }
