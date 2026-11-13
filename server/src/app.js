const path = require('path')
const fs = require('fs')
const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken')
const { fail, rateLimit } = require('./util')
const { getSetting, getCfg } = require('./services/config')
const { syncAlerts } = require('./services/alerts')
const { createWeather } = require('./services/weather')
const { createMailer } = require('./services/mailer')
const { createSimulator } = require('./services/simulator')

/**
 * Builds the Express app on top of an open MongoDB handle (see db.js). `services` can be overridden in tests
 * (fetch for weather, mailer, ...).
 */
async function createApp(db, { staticDir, fetchImpl, mailer = createMailer(), simulate = false } = {}) {
  const app = express()
  app.disable('x-powered-by')
  // Express 4 ignores rejected promises, so route handlers that are async get their errors forwarded to the error handler.
  for (const m of ['get', 'post', 'put', 'delete']) {
    const orig = app[m].bind(app)
    app[m] = (path, ...handlers) => handlers.length === 0 ? orig(path)
      : orig(path, ...handlers.map(fn => (fn.length === 4 ? fn : (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next))))
  }
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://*.arcgisonline.com https://*.openstreetmap.org https://unpkg.com; connect-src 'self' https://*.arcgisonline.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    })
    next()
  })
  app.use(cors())
  app.use(express.json({ limit: '200kb' }))
  app.use('/api', rateLimit({ windowMs: 60e3, max: 600 }))

  const jwtSecret = process.env.JWT_SECRET || await getSetting(db, 'jwt_secret')
  const getWeather = createWeather(db, fetchImpl)

  // ---- shared helpers handed to the route modules ----------------------------------------------------------
  const publicUser = u => ({ id: u.id, role: u.role, displayName: u.name, title: u.title })
  const profileOf = u => ({ name: u.name, role: u.title, email: u.contact_email, phone: u.phone, estate: u.estate, since: u.since })
  const prefsOf = u => ({ email: !!u.pref_email, sms: !!u.pref_sms, push: !!u.pref_push })
  const signToken = u => jwt.sign({ sub: u.id, tv: u.token_version }, jwtSecret, { expiresIn: '7d' })

  async function auth(req, res, next) {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) return fail(res, 401, 'Not signed in.')
    try {
      const payload = jwt.verify(token, jwtSecret)
      const user = await db.findOne('users', { id: payload.sub })
      // role and validity always come from the database, never from the token
      if (!user || user.token_version !== payload.tv) return fail(res, 401, 'Session expired. Please sign in again.')
      req.user = user
      next()
    } catch { return fail(res, 401, 'Session expired. Please sign in again.') }
  }
  const adminOnly = (req, res, next) => (req.user.role === 'admin' ? next() : fail(res, 403, 'Admin access required.'))

  // email people who want it when a critical alert opens
  const notifyAlert = async alert => {
    if (!mailer.enabled) return
    for (const u of await db.find('users', { pref_email: true })) {
      mailer.send(u.contact_email, `TerraNova alert: ${alert.message}`, `Hi ${u.name},\n\n${alert.message}.\n\nOpen TerraNova to acknowledge it and see recommendations.`)
    }
  }
  const syncNow = async () => { try { await syncAlerts(db, a => { notifyAlert(a).catch(e => console.error('alert email failed:', e.message)) }) } catch (e) { console.error('alert sync failed:', e.message) } }

  const ctx = { db, jwtSecret, auth, adminOnly, publicUser, profileOf, prefsOf, signToken, getWeather, mailer, syncNow, cfg: () => getCfg(db) }

  require('./routes/auth')(app, ctx)
  require('./routes/state')(app, ctx)
  require('./routes/farm')(app, ctx)
  require('./routes/irrigation')(app, ctx)
  require('./routes/team')(app, ctx)
  require('./routes/reports')(app, ctx)
  require('./routes/database')(app, ctx)
  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.use('/api', (_req, res) => fail(res, 404, 'Not found.'))

  // Serve the built website (web/dist) with SPA fallback for page URLs.
  if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }))
    app.get('*', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')))
  }
  app.use((_req, res) => fail(res, 404, 'Not found.'))
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return fail(res, 400, 'Invalid JSON.')
    if (err.type === 'entity.too.large') return fail(res, 413, 'Request too large.')
    console.error(err)
    fail(res, 500, 'Server error.')
  })

  const simulator = createSimulator(db, { sync: syncNow })
  await syncNow()
  if (simulate) simulator.start()
  return Object.assign(app, { simulator, syncNow, mailer })
}

module.exports = { createApp }
