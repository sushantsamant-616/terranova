const crypto = require('crypto')
const { fail, str, num, rateLimit } = require('../util')
const { audit } = require('../services/audit')
const { getSetting, getCfg } = require('../services/config')
const { plotOut, sensorOut, eventOut, downsample, withPlotNames } = require('../services/shape')

const SIGNALS = ['strong', 'good', 'fair', 'weak']
const RANGES = { 6: 6, 24: 24, 72: 72, 168: 168, 720: 720 }
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase()

module.exports = function farmRoutes(app, ctx) {
  const { db, auth, adminOnly } = ctx

  const plotRow = id => db.findOne('plots', { id: String(id) })
  const hoursParam = req => RANGES[Number(req.query.hours)] ?? 24

  // ---- plots ------------------------------------------------------------------------------------
  function plotFields(b, partial = false) {
    const f = {
      name: str(b.name, { max: 60 }), crop: str(b.crop, { max: 60 }),
      area: num(b.area, 0.1, 10000), age: Number.isInteger(b.age) ? num(b.age, 0, 120) : null, ndvi: num(b.ndvi, 0, 1),
    }
    const bad = Object.entries(f).find(([k, v]) => v === null && !(partial && b[k] === undefined))
    return bad ? { error: `Invalid or missing value for ${bad[0]}.` } : { f }
  }
  const nameTaken = async (name, exceptId) => (await db.find('plots', {}, { fields: ['name'] })).some(p => p.id !== exceptId && sameName(p.name, name))

  app.post('/api/plots', auth, adminOnly, async (req, res) => {
    const { f, error } = plotFields(req.body || {})
    if (error) return fail(res, 400, error)
    const moisture = num(req.body.moisture, 0, 100)
    if (moisture === null) return fail(res, 400, 'Enter the current soil moisture (0 to 100%).')
    if (await nameTaken(f.name)) return fail(res, 409, 'A plot with that name already exists.')
    let n = (await db.count('plots')) + 1, id = `P${n}`
    while (await plotRow(id)) id = `P${++n}`
    const now = Date.now()
    await db.insert('plots', { id, name: f.name, area: f.area, crop: f.crop, age: f.age, ndvi: f.ndvi, moisture, moisture_at: now, pos: await db.nextPos('plots') })
    await db.insert('readings', { plot_id: id, sensor_id: null, source: 'manual', ts: now, moisture, temp: null, ec: null, ph: null })
    await audit(db, req.user, 'plot.create', `${f.name} (${f.area} ha)`)
    await ctx.syncNow()
    res.status(201).json({ plot: plotOut(await plotRow(id)) })
  })

  app.put('/api/plots/:id', auth, adminOnly, async (req, res) => {
    const p = await plotRow(req.params.id)
    if (!p) return fail(res, 404, 'Plot not found.')
    const { f, error } = plotFields({ name: p.name, crop: p.crop, area: p.area, age: p.age, ndvi: p.ndvi, ...req.body }, true)
    if (error) return fail(res, 400, error)
    if (await nameTaken(f.name, p.id)) return fail(res, 409, 'A plot with that name already exists.')
    await db.update('plots', { id: p.id }, { set: { name: f.name, crop: f.crop, area: f.area, age: f.age, ndvi: f.ndvi } })
    await audit(db, req.user, 'plot.update', f.name)
    res.json({ plot: plotOut(await plotRow(p.id)) })
  })

  app.delete('/api/plots/:id', auth, adminOnly, async (req, res) => {
    const p = await plotRow(req.params.id)
    if (!p) return fail(res, 404, 'Plot not found.')
    await db.update('sensors', { plot_id: p.id }, { set: { plot_id: null } })
    await db.remove('readings', { plot_id: p.id })
    await db.remove('irrigation', { plot_id: p.id, status: { $in: ['scheduled', 'running'] } })
    await db.remove('plots', { id: p.id })
    await audit(db, req.user, 'plot.delete', p.name)
    await ctx.syncNow()
    res.json({ ok: true })
  })

  app.get('/api/plots/:id', auth, async (req, res) => {
    const p = await plotRow(req.params.id)
    if (!p) return fail(res, 404, 'Plot not found.')
    const hours = hoursParam(req), cfg = await getCfg(db)
    const readings = downsample(await db.find('readings', { plot_id: p.id, ts: { $gte: Date.now() - hours * 3600e3 } }, { sort: { ts: 1 }, fields: ['ts', 'moisture', 'temp', 'ec', 'ph'] }))
    const sensors = (await withPlotNames(db, await db.find('sensors', { plot_id: p.id }, { sort: { pos: 1 } }))).map(s => sensorOut(s, cfg))
    const events = (await withPlotNames(db, await db.find('irrigation', { plot_id: p.id }, { sort: { scheduled_for: -1 }, limit: 30 }))).map(eventOut)
    res.json({ plot: plotOut(p, sensors.map(s => s.id)), readings, sensors, events, hours })
  })

  /** anyone signed in can log a hand measurement, e.g. from a field probe */
  app.post('/api/plots/:id/readings', auth, async (req, res) => {
    const p = await plotRow(req.params.id)
    if (!p) return fail(res, 404, 'Plot not found.')
    const moisture = num(req.body?.moisture, 0, 100)
    if (moisture === null) return fail(res, 400, 'Moisture must be a number from 0 to 100.')
    const now = Date.now()
    await db.insert('readings', { plot_id: p.id, sensor_id: null, source: 'manual', ts: now, moisture, temp: null, ec: null, ph: null })
    await db.update('plots', { id: p.id }, { set: { moisture, moisture_at: now } })
    await audit(db, req.user, 'reading.manual', `${p.name}: ${moisture}%`)
    await ctx.syncNow()
    res.status(201).json({ plot: plotOut(await plotRow(p.id)) })
  })

  // ---- sensors ----------------------------------------------------------------------------------
  const sensorRow = id => db.findOne('sensors', { id: String(id) })
  const sensorFull = async id => sensorOut((await withPlotNames(db, [await sensorRow(id)]))[0], await getCfg(db))

  async function sensorFields(b, cur = {}) {
    let plotId = b.plotId === undefined ? cur.plot_id ?? null : b.plotId
    if (plotId === '') plotId = null
    if (plotId !== null && (typeof plotId !== 'string' || !(await plotRow(plotId)))) return { error: 'Choose an existing plot.' }
    const depth = str(b.depth ?? cur.depth ?? '30cm', { max: 20 }), firmware = str(b.firmware ?? cur.firmware ?? '2.3.0', { max: 20 })
    if (!depth || !firmware) return { error: 'Depth and firmware are required.' }
    return { plotId, depth, firmware }
  }

  app.post('/api/sensors', auth, adminOnly, async (req, res) => {
    const { plotId, depth, firmware, error } = await sensorFields(req.body || {})
    if (error) return fail(res, 400, error)
    let id = req.body.id === undefined || req.body.id === '' ? null : str(req.body.id, { max: 20 })
    if (req.body.id && !id) return fail(res, 400, 'Invalid sensor ID.')
    if (id && !/^[A-Za-z0-9_-]+$/.test(id)) return fail(res, 400, 'Sensor ID may only use letters, numbers, - and _.')
    if (!id) { let n = (await db.count('sensors')) + 1; do id = `SNS-${String(n++).padStart(2, '0')}`; while (await sensorRow(id)) }
    if (await sensorRow(id)) return fail(res, 409, 'A sensor with that ID already exists.')
    await db.insert('sensors', {
      id, plot_id: plotId, depth, firmware, signal: 'good', battery: 100, last_seen: null,
      moisture: null, temp: null, ec: null, ph: null, pos: await db.nextPos('sensors'),
    })
    await audit(db, req.user, 'sensor.create', `${id}${plotId ? ` on ${plotId}` : ''}`)
    res.status(201).json({ sensor: await sensorFull(id) })
  })

  app.put('/api/sensors/:id', auth, adminOnly, async (req, res) => {
    const cur = await sensorRow(req.params.id)
    if (!cur) return fail(res, 404, 'Sensor not found.')
    const { plotId, depth, firmware, error } = await sensorFields(req.body || {}, cur)
    if (error) return fail(res, 400, error)
    await db.update('sensors', { id: cur.id }, { set: { plot_id: plotId, depth, firmware } })
    await audit(db, req.user, 'sensor.update', `${cur.id}${plotId ? ` -> ${plotId}` : ' unassigned'}`)
    await ctx.syncNow()
    res.json({ sensor: await sensorFull(cur.id) })
  })

  app.delete('/api/sensors/:id', auth, adminOnly, async (req, res) => {
    if ((await db.remove('sensors', { id: req.params.id })) === 0) return fail(res, 404, 'Sensor not found.')
    await audit(db, req.user, 'sensor.delete', req.params.id)
    await ctx.syncNow()
    res.json({ ok: true })
  })

  app.get('/api/sensors/:id/readings', auth, async (req, res) => {
    const s = await sensorRow(req.params.id)
    if (!s) return fail(res, 404, 'Sensor not found.')
    const hours = hoursParam(req)
    res.json({ hours, readings: downsample(await db.find('readings', { sensor_id: s.id, ts: { $gte: Date.now() - hours * 3600e3 } }, { sort: { ts: 1 }, fields: ['ts', 'moisture', 'temp', 'ec', 'ph'] })) })
  })

  // ---- device ingest: sensors (or a gateway) post readings with the estate API key ---------------------
  const ingestLimiter = rateLimit({ windowMs: 60e3, max: 300, message: 'Too many ingest requests.' })
  const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y) }

  app.post('/api/ingest', ingestLimiter, async (req, res) => {
    if (!safeEqual(req.get('x-api-key') ?? '', await getSetting(db, 'api_key'))) return fail(res, 401, 'Invalid API key.')
    const items = Array.isArray(req.body?.readings) ? req.body.readings : [req.body]
    if (items.length === 0 || items.length > 100) return fail(res, 400, 'Send between 1 and 100 readings.')
    const now = Date.now()
    const clean = []
    for (const [i, r] of items.entries()) {
      const where = items.length > 1 ? ` (reading ${i + 1})` : ''
      if (!r || typeof r.sensorId !== 'string' || !(await sensorRow(r.sensorId))) return fail(res, 404, `Unknown sensorId${where}. Register the sensor in Admin first.`)
      const ts = r.ts === undefined ? now : r.ts
      if (!Number.isFinite(ts) || ts > now + 5 * 60e3 || ts < now - 7 * 864e5) return fail(res, 400, `ts must be epoch milliseconds within the last 7 days${where}.`)
      const v = {
        moisture: num(r.moisture, 0, 100), temp: r.temp === undefined ? undefined : num(r.temp, -20, 70),
        ec: r.ec === undefined ? undefined : num(r.ec, 0, 20), ph: r.ph === undefined ? undefined : num(r.ph, 0, 14),
        battery: r.battery === undefined ? undefined : (Number.isInteger(r.battery) ? num(r.battery, 0, 100) : null),
      }
      if (v.moisture === null || [v.temp, v.ec, v.ph, v.battery].includes(null)) return fail(res, 400, `Invalid reading values${where}. moisture is required (0-100).`)
      if (r.signal !== undefined && !SIGNALS.includes(r.signal)) return fail(res, 400, `signal must be one of ${SIGNALS.join(', ')}${where}.`)
      clean.push({ sensorId: r.sensorId, ts, signal: r.signal, ...v })
    }
    for (const r of clean.sort((a, b) => a.ts - b.ts)) {
      const s = await sensorRow(r.sensorId)
      await db.insert('readings', { plot_id: s.plot_id, sensor_id: s.id, source: 'sensor', ts: r.ts, moisture: r.moisture, temp: r.temp ?? null, ec: r.ec ?? null, ph: r.ph ?? null })
      // only move the "latest" values forward in time; fields the device didn't send keep their old value
      if (s.last_seen == null || r.ts >= s.last_seen) {
        const set = { moisture: r.moisture, last_seen: r.ts }
        for (const k of ['temp', 'ec', 'ph', 'battery', 'signal']) if (r[k] !== undefined) set[k] = r[k]
        await db.update('sensors', { id: s.id }, { set })
        if (s.plot_id) await db.update('plots', { id: s.plot_id }, { set: { moisture: r.moisture, moisture_at: r.ts } })
      }
    }
    await ctx.syncNow()
    res.status(201).json({ accepted: clean.length })
  })
}
