const { fail, str, num } = require('../util')
const { audit } = require('../services/audit')
const { getCfg, litresFor } = require('../services/config')
const { eventOut, alertOut, withPlotNames } = require('../services/shape')
const { buildRecs } = require('../services/recs')

const STATUSES = ['scheduled', 'running', 'completed', 'cancelled']

module.exports = function irrigationRoutes(app, ctx) {
  const { db, auth, getWeather } = ctx
  const plotRow = id => db.findOne('plots', { id: String(id) })
  const eventRow = async id => {
    const e = await db.findOne('irrigation', { id: Number(id) })
    return e ? (await withPlotNames(db, [e]))[0] : null
  }
  const idOk = id => Number.isInteger(Number(id))

  // ---- irrigation & fertigation events -----------------------------------------------------------------
  app.get('/api/irrigation', auth, async (req, res) => {
    const filter = {}
    if (STATUSES.includes(req.query.status)) filter.status = req.query.status
    if (typeof req.query.plot === 'string' && req.query.plot) filter.plot_id = req.query.plot
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100), offset = Math.max(parseInt(req.query.offset) || 0, 0)
    const total = await db.count('irrigation', filter)
    const rows = await db.find('irrigation', filter, { sort: { scheduled_for: -1 }, limit, skip: offset })
    res.json({ total, events: (await withPlotNames(db, rows)).map(eventOut) })
  })

  app.post('/api/irrigation', auth, async (req, res) => {
    const b = req.body || {}
    const plot = typeof b.plotId === 'string' ? await plotRow(b.plotId) : null
    if (!plot) return fail(res, 400, 'Choose a plot.')
    const mm = num(b.mm, 1, 100)
    if (mm === null) return fail(res, 400, 'Depth must be between 1 and 100 mm.')
    const kind = b.kind === 'fertigation' ? 'fertigation' : 'irrigation'
    const when = Number.isFinite(b.scheduledFor) ? b.scheduledFor : null
    if (when === null || when < Date.now() - 3600e3 || when > Date.now() + 90 * 864e5) return fail(res, 400, 'Pick a start time within the next 90 days.')
    const note = b.note === undefined || b.note === '' ? '' : str(b.note, { max: 200 })
    if (note === null) return fail(res, 400, 'Note is too long (200 characters max).')
    const litres = litresFor(mm, plot.area, (await getCfg(db)).dripFactor)
    const id = await db.insert('irrigation', {
      plot_id: plot.id, kind, mm, litres, note, status: 'scheduled', scheduled_for: when, started_at: null, completed_at: null,
      created_by: req.user.name, created_at: Date.now(), rec_key: null,
    })
    await audit(db, req.user, 'irrigation.schedule', `${plot.name}: ${mm}mm ${kind}`)
    res.status(201).json({ event: eventOut(await eventRow(id)) })
  })

  const TRANSITIONS = {
    start: { from: ['scheduled'], to: 'running' },
    complete: { from: ['running', 'scheduled'], to: 'completed' },
    cancel: { from: ['scheduled', 'running'], to: 'cancelled' },
  }
  app.post('/api/irrigation/:id/:action', auth, async (req, res) => {
    const t = TRANSITIONS[req.params.action]
    const e = idOk(req.params.id) ? await eventRow(req.params.id) : null
    if (!t || !e) return fail(res, 404, 'Irrigation event not found.')
    if (!t.from.includes(e.status)) return fail(res, 409, `This event is already ${e.status}.`)
    const now = Date.now()
    if (req.params.action === 'start') {
      if (await db.exists('irrigation', { plot_id: e.plot_id, status: 'running' })) return fail(res, 409, 'This plot already has an irrigation running.')
      await db.update('irrigation', { id: e.id }, { set: { status: 'running', started_at: now } })
    } else if (req.params.action === 'complete') {
      let litres = e.litres
      if (req.body?.litres !== undefined) {
        litres = num(req.body.litres, 0, 100000000)
        if (litres === null) return fail(res, 400, 'Litres applied must be a positive number.')
      }
      await db.update('irrigation', { id: e.id }, { set: { status: 'completed', litres: Math.round(litres), started_at: e.started_at ?? now, completed_at: now } })
    } else {
      await db.update('irrigation', { id: e.id }, { set: { status: 'cancelled', completed_at: now } })
    }
    await audit(db, req.user, `irrigation.${req.params.action}`, `Event #${e.id} on ${e.plot_name}`)
    res.json({ event: eventOut(await eventRow(e.id)) })
  })

  // ---- recommendations ---------------------------------------------------------------------------------
  const DAY = 864e5
  app.post('/api/recommendations/:key/dismiss', auth, async (req, res) => {
    const until = Date.now() + DAY
    await db.upsert('rec_state', req.params.key, { state: 'dismissed', until, by: req.user.name })
    await audit(db, req.user, 'recommendation.dismiss', req.params.key)
    res.json({ ok: true, until })
  })

  app.post('/api/recommendations/:key/schedule', auth, async (req, res) => {
    const rec = (await buildRecs(db, await getWeather())).find(r => r.key === req.params.key)
    if (!rec) return fail(res, 404, 'That recommendation is no longer current.')
    if (!rec.canSchedule) return fail(res, 400, 'This advisory cannot be scheduled.')
    if (rec.state === 'scheduled') return fail(res, 409, 'Already scheduled.')
    const id = await db.insert('irrigation', {
      plot_id: rec.plotId, kind: rec.kind, mm: rec.mm, litres: rec.litres, note: rec.action, status: 'scheduled', scheduled_for: rec.scheduledFor,
      started_at: null, completed_at: null, created_by: req.user.name, created_at: Date.now(), rec_key: rec.key,
    })
    await audit(db, req.user, 'recommendation.schedule', `${rec.plot}: ${rec.action}`)
    res.status(201).json({ event: eventOut(await eventRow(id)) })
  })

  // ---- alerts ------------------------------------------------------------------------------------------
  app.get('/api/alerts', auth, async (req, res) => {
    const status = ['open', 'acknowledged', 'resolved'].includes(req.query.status) ? req.query.status : null
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100), offset = Math.max(parseInt(req.query.offset) || 0, 0)
    const filter = status ? { status } : {}
    const total = await db.count('alerts', filter)
    res.json({ total, alerts: (await db.find('alerts', filter, { sort: { opened_at: -1 }, limit, skip: offset })).map(alertOut) })
  })

  app.post('/api/alerts/:id/acknowledge', auth, async (req, res) => {
    const a = idOk(req.params.id) ? await db.findOne('alerts', { id: Number(req.params.id) }) : null
    if (!a) return fail(res, 404, 'Alert not found.')
    if (a.status !== 'open') return fail(res, 409, `This alert is already ${a.status}.`)
    await db.update('alerts', { id: a.id }, { set: { status: 'acknowledged', ack_by: req.user.name, ack_at: Date.now() } })
    await audit(db, req.user, 'alert.acknowledge', a.message)
    res.json({ alert: alertOut(await db.findOne('alerts', { id: a.id })) })
  })
}
