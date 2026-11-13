const { getCfg } = require('./config')
const { audit } = require('./audit')

/**
 * Demo data generator. Every tick each sensor "reports": moisture slowly dries out, rises while an
 * irrigation event is running, and running events finish after a simulated duration (2 min per mm).
 * Turn it off (Admin > Estate & data) once real devices post to /api/ingest.
 */
function createSimulator(db, { sync, intervalMs = Number(process.env.SIM_INTERVAL_MS) || 60000 } = {}) {
  let timer = null
  let lastPrune = 0

  async function tick(now = Date.now(), rnd = Math.random) {
    if (!(await getCfg(db)).simulator) return false
    const running = new Set((await db.find('irrigation', { status: 'running' })).map(r => r.plot_id))
    const readings = []
    for (const s of await db.find('sensors', { plot_id: { $ne: null } })) {
      const delta = running.has(s.plot_id) ? 0.45 : -(0.01 + rnd() * 0.015)
      const moisture = +Math.min(95, Math.max(10, (s.moisture ?? 50) + delta)).toFixed(2)
      const hour = new Date(now).getHours()
      const temp = +(25 + 5 * Math.sin(((hour - 9) / 24) * 2 * Math.PI) + (rnd() - 0.5)).toFixed(1)
      const ec = +Math.min(4, Math.max(0.2, (s.ec ?? 1.2) + (rnd() - 0.5) * 0.01)).toFixed(2)
      const battery = rnd() < 0.002 ? Math.max(0, s.battery - 1) : s.battery
      await db.update('sensors', { id: s.id }, { set: { moisture, temp, ec, battery, last_seen: now } })
      await db.update('plots', { id: s.plot_id }, { set: { moisture, moisture_at: now } })
      readings.push({ plot_id: s.plot_id, sensor_id: s.id, source: 'sensor', ts: now, moisture, temp, ec, ph: s.ph })
    }
    await db.insert('readings', readings)
    // finish simulated irrigation runs
    for (const e of await db.find('irrigation', { status: 'running' })) {
      if (e.started_at + e.mm * 2 * 60e3 <= now) {
        await db.update('irrigation', { id: e.id }, { set: { status: 'completed', completed_at: now } })
        await audit(db, 'system', 'irrigation.complete', `Event #${e.id} on ${e.plot_id} finished (simulated)`)
      }
    }
    if (now - lastPrune > 3600e3) {
      await db.remove('readings', { ts: { $lt: now - 30 * 864e5 } })
      lastPrune = now
    }
    await sync?.()
    return true
  }

  return {
    tick,
    start() {
      if (timer) return
      let busy = false
      timer = setInterval(async () => {
        if (busy) return // a slow database should not pile up ticks
        busy = true
        try { await tick() } catch (e) { console.error('simulator:', e.message) } finally { busy = false }
      }, intervalMs)
      timer.unref()
    },
    stop() { if (timer) { clearInterval(timer); timer = null } },
  }
}

module.exports = { createSimulator }
