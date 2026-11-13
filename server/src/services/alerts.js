const { getCfg, getStatus } = require('./config')
const { withPlotNames } = require('./shape')

/**
 * Brings the alerts collection in line with reality: opens alerts for new problems, updates the
 * ones that are still true, and resolves the ones that cleared. Safe to call at any time.
 * `onOpen(alert)` is called for each newly opened (or escalated) critical alert.
 */
async function syncAlerts(db, onOpen) {
  const cfg = await getCfg(db)
  const now = Date.now()
  const want = new Map() // "kind|subject" -> { kind, subject, severity, message }
  const add = (kind, subject, severity, message) => want.set(`${kind}|${subject}`, { kind, subject, severity, message })

  for (const p of await db.find('plots')) {
    const s = getStatus(p.moisture, cfg.crit, cfg.watch)
    if (s === 'critical') add('moisture', p.id, 'critical', `${p.name} moisture ${p.moisture.toFixed(0)}% is below the critical level (${cfg.crit}%)`)
    else if (s === 'watch') add('moisture', p.id, 'watch', `${p.name} moisture ${p.moisture.toFixed(0)}% is below the watch level (${cfg.watch}%)`)
  }
  for (const s of await withPlotNames(db, await db.find('sensors'))) {
    const where = s.plot_name ? ` (${s.plot_name})` : ''
    if (s.last_seen != null && now - s.last_seen > cfg.offlineMin * 60e3) {
      add('sensor_offline', s.id, 'critical', `${s.id}${where} has not reported for ${Math.round((now - s.last_seen) / 60e3)} minutes`)
    }
    if (s.battery < cfg.batteryLow) add('battery', s.id, 'watch', `${s.id}${where} battery is at ${s.battery}%`)
  }

  const open = await db.find('alerts', { status: { $ne: 'resolved' } })
  const have = new Map(open.map(a => [`${a.kind}|${a.subject}`, a]))
  for (const a of open) {
    if (!want.has(`${a.kind}|${a.subject}`)) await db.update('alerts', { id: a.id }, { set: { status: 'resolved', resolved_at: now } })
  }
  for (const [key, w] of want) {
    const cur = have.get(key)
    if (!cur) {
      const id = await db.insert('alerts', { ...w, status: 'open', opened_at: now, ack_by: null, ack_at: null, resolved_at: null })
      if (w.severity === 'critical') onOpen?.({ id, ...w })
    } else if (cur.severity !== w.severity) {
      // escalated or eased: reopen so people see it again
      await db.update('alerts', { id: cur.id }, { set: { severity: w.severity, message: w.message, status: 'open', ack_by: null, ack_at: null } })
      if (w.severity === 'critical') onOpen?.({ id: cur.id, ...w })
    } else if (cur.message !== w.message) {
      await db.update('alerts', { id: cur.id }, { set: { message: w.message } })
    }
  }
}

module.exports = { syncAlerts }
