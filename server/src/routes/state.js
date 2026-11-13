const crypto = require('crypto')
const { fail, str, num } = require('../util')
const { audit } = require('../services/audit')
const { getSetting, setSetting, getCfg } = require('../services/config')
const { allPlots, allSensors, eventOut, alertOut, withPlotNames } = require('../services/shape')
const { buildRecs } = require('../services/recs')

const PROFILE_FIELDS = ['name', 'email', 'phone', 'estate']

module.exports = function stateRoutes(app, ctx) {
  const { db, auth, adminOnly, publicUser, profileOf, prefsOf, getWeather, mailer } = ctx

  const settingsOut = async admin => {
    const c = await getCfg(db)
    const base = { estateName: c.estateName, lat: c.lat, lon: c.lon, targetMoisture: c.target, dripFactor: c.dripFactor, costPerKl: c.costPerKl }
    return admin ? {
      ...base, rainSkipMm: c.rainSkipMm,
      offlineMin: c.offlineMin, batteryLow: c.batteryLow, simulator: c.simulator, emailEnabled: mailer.enabled,
    } : base
  }

  /** things that rarely change: loaded once after sign-in */
  app.get('/api/bootstrap', auth, async (req, res) => {
    const u = req.user, admin = u.role === 'admin'
    const c = await getCfg(db)
    const logins = new Set((await db.find('users', {}, { fields: ['login_email'] })).map(r => r.login_email))
    res.json({
      user: publicUser(u),
      thresholds: { crit: c.crit, watch: c.watch },
      profile: profileOf(u),
      prefs: prefsOf(u),
      team: (await db.find('team', {}, { sort: { pos: 1 } }))
        .map(m => ({ name: m.name, role: m.role, email: m.email, status: m.status, access: m.access, hasLogin: logins.has(m.email) })),
      settings: await settingsOut(admin),
      apiKey: admin ? await getSetting(db, 'api_key') : '',
    })
  })

  /** the live picture: polled every 30 seconds by the website */
  app.get('/api/live', auth, async (_req, res) => {
    const weather = await getWeather()
    const events = (await withPlotNames(db, await db.find('irrigation', { status: { $in: ['scheduled', 'running'] } }, { sort: { scheduled_for: 1 } }))).map(eventOut)
    const recent = (await withPlotNames(db, await db.find('irrigation', { status: { $in: ['completed', 'cancelled'] } }, { sort: { completed_at: -1 }, limit: 8 }))).map(eventOut)
    // critical alerts first, newest first within each group
    const critical = await db.find('alerts', { status: { $ne: 'resolved' }, severity: 'critical' }, { sort: { opened_at: -1 }, limit: 200 })
    const others = await db.find('alerts', { status: { $ne: 'resolved' }, severity: { $ne: 'critical' } }, { sort: { opened_at: -1 }, limit: 200 - critical.length })
    const alerts = [...critical, ...others].map(alertOut)
    const { crit, watch } = await getCfg(db)
    res.json({
      serverTime: Date.now(),
      thresholds: { crit, watch },
      plots: await allPlots(db), sensors: await allSensors(db),
      alerts, events, recentEvents: recent,
      recs: await buildRecs(db, weather), weather,
    })
  })

  app.put('/api/thresholds', auth, adminOnly, async (req, res) => {
    const { crit, watch } = req.body || {}
    if (!Number.isInteger(crit) || !Number.isInteger(watch)) return fail(res, 400, 'Thresholds must be whole numbers.')
    if (crit < 20 || watch > 85 || watch < crit + 5) return fail(res, 400, 'Critical must be at least 20, watch at most 85, and watch at least 5 above critical.')
    await setSetting(db, 'crit_th', crit); await setSetting(db, 'watch_th', watch)
    await audit(db, req.user, 'thresholds.update', `critical ${crit}%, watch ${watch}%`)
    await ctx.syncNow()
    res.json({ crit, watch })
  })

  app.put('/api/settings', auth, adminOnly, async (req, res) => {
    const b = req.body || {}
    const next = {
      estate_name: str(b.estateName, { max: 80 }), lat: num(b.lat, -90, 90), lon: num(b.lon, -180, 180),
      cost_per_kl: num(b.costPerKl, 0, 1000), drip_factor: num(b.dripFactor, 0.01, 1), rain_skip_mm: num(b.rainSkipMm, 0, 200),
      offline_min: Number.isInteger(b.offlineMin) ? num(b.offlineMin, 5, 1440) : null,
      battery_low: Number.isInteger(b.batteryLow) ? num(b.batteryLow, 1, 100) : null,
      target_moisture: Number.isInteger(b.targetMoisture) ? num(b.targetMoisture, 50, 95) : null,
      simulator: typeof b.simulator === 'boolean' ? (b.simulator ? 1 : 0) : null,
    }
    const bad = Object.entries(next).find(([, v]) => v === null)
    if (bad) return fail(res, 400, `Invalid value for ${bad[0].replace(/_/g, ' ')}.`)
    for (const [k, v] of Object.entries(next)) await setSetting(db, k, v)
    await audit(db, req.user, 'settings.update', Object.entries(next).map(([k, v]) => `${k}=${v}`).join(', '))
    await ctx.syncNow()
    res.json({ settings: await settingsOut(true) })
  })

  app.put('/api/profile', auth, async (req, res) => {
    const b = req.body || {}
    for (const f of PROFILE_FIELDS) {
      if (typeof b[f] !== 'string' || b[f].trim().length === 0 || b[f].length > 120) return fail(res, 400, `Profile field "${f}" is required (max 120 characters).`)
    }
    if (!/^\S+@\S+\.\S+$/.test(b.email.trim())) return fail(res, 400, 'Enter a valid email address.')
    await db.update('users', { id: req.user.id }, { set: { name: b.name.trim(), contact_email: b.email.trim(), phone: b.phone.trim(), estate: b.estate.trim() } })
    const fresh = await db.findOne('users', { id: req.user.id })
    res.json({ profile: profileOf(fresh), user: publicUser(fresh) })
  })

  app.put('/api/prefs', auth, async (req, res) => {
    const { email, sms, push } = req.body || {}
    if ([email, sms, push].some(v => typeof v !== 'boolean')) return fail(res, 400, 'Invalid notification settings.')
    await db.update('users', { id: req.user.id }, { set: { pref_email: email, pref_sms: sms, pref_push: push } })
    res.json({ email, sms, push })
  })

  app.post('/api/api-key/regenerate', auth, adminOnly, async (req, res) => {
    const apiKey = 'tn_live_' + crypto.randomBytes(8).toString('hex')
    await setSetting(db, 'api_key', apiKey)
    await audit(db, req.user, 'apikey.regenerate')
    res.json({ apiKey })
  })
}
