const { getCfg } = require('./config')

const plotOut = (p, sensorIds = []) => ({
  id: p.id, name: p.name, area: p.area, crop: p.crop, age: p.age, ndvi: p.ndvi,
  moisture: p.moisture, moistureAt: p.moisture_at, sensorIds,
})
function sensorOut(s, cfg, now = Date.now()) {
  return {
    id: s.id, plotId: s.plot_id, plotName: s.plot_name ?? null, depth: s.depth, firmware: s.firmware, signal: s.signal,
    battery: s.battery, moisture: s.moisture, temp: s.temp, ec: s.ec, ph: s.ph, lastSeen: s.last_seen,
    online: s.last_seen != null && now - s.last_seen <= cfg.offlineMin * 60e3,
  }
}
const eventOut = e => ({
  id: e.id, plotId: e.plot_id, plotName: e.plot_name ?? null, kind: e.kind, mm: e.mm, litres: e.litres, note: e.note, status: e.status,
  scheduledFor: e.scheduled_for, startedAt: e.started_at, completedAt: e.completed_at, createdBy: e.created_by, recKey: e.rec_key,
})
const alertOut = a => ({
  id: a.id, kind: a.kind, subject: a.subject, severity: a.severity, message: a.message, status: a.status,
  openedAt: a.opened_at, ackBy: a.ack_by, ackAt: a.ack_at, resolvedAt: a.resolved_at,
})
/** adds `plot_name` to rows that carry a `plot_id` (MongoDB has no joins, so we look the names up once) */
async function withPlotNames(db, rows) {
  const names = new Map((await db.find('plots')).map(p => [p.id, p.name]))
  return rows.map(r => ({ ...r, plot_name: names.get(r.plot_id) ?? null }))
}
async function allPlots(db) {
  const sensors = await db.find('sensors', {}, { fields: ['plot_id'] })
  return (await db.find('plots', {}, { sort: { pos: 1 } })).map(p => plotOut(p, sensors.filter(s => s.plot_id === p.id).map(s => s.id)))
}
async function allSensors(db) {
  const cfg = await getCfg(db)
  return (await withPlotNames(db, await db.find('sensors', {}, { sort: { pos: 1 } }))).map(s => sensorOut(s, cfg))
}
/** thin a time series down to about `max` points by averaging buckets */
function downsample(rows, max = 300) {
  if (rows.length <= max) return rows
  const size = Math.ceil(rows.length / max), out = []
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size), avg = k => {
      const v = chunk.map(r => r[k]).filter(x => x != null)
      return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : null
    }
    out.push({ ts: Math.round(chunk.reduce((a, r) => a + r.ts, 0) / chunk.length), moisture: avg('moisture'), temp: avg('temp'), ec: avg('ec'), ph: avg('ph') })
  }
  return out
}
module.exports = { withPlotNames, plotOut, sensorOut, eventOut, alertOut, allPlots, allSensors, downsample }
