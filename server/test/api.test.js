// End-to-end API test: real HTTP against the Express app and MongoDB, including a "server restart".
//
// By default MongoDB is replaced by a small in-memory stand-in (test/fakeMongo.js) so no server is needed.
// To run against a real MongoDB instead (uses a throw-away database that is dropped afterwards):
//     TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test
process.env.SMTP_URL = 'json' // capture emails in memory instead of sending
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { MongoClient } = require('mongodb')
const ExcelJS = require('exceljs')
const { openDb } = require('../src/db')
const { createApp } = require('../src/app')
const { TABLES, VALIDATORS, ORDER } = require('../src/schema')
const { FakeClient } = require('./fakeMongo')

const REAL_URI = process.env.TEST_MONGODB_URI
const DB_NAME = 'terranova_test_' + Math.random().toString(36).slice(2, 8)
const sharedFake = new FakeClient() // survives "restarts" like a real server's data would
const newClient = () => (REAL_URI ? new MongoClient(REAL_URI, { serverSelectionTimeoutMS: 5000 }) : sharedFake)
let rain24 = 0
const fakeFetch = async () => ({
  ok: true,
  json: async () => ({ daily: {
    time: ['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'], weather_code: [0, 3, 61, 63, 0],
    temperature_2m_max: [33.2, 31, 30, 28, 29], temperature_2m_min: [21, 20, 19, 19, 20],
    precipitation_sum: [rain24, 0, 2.5, 4, 0], relative_humidity_2m_mean: [60, 65, 70, 80, 62],
  } }),
})

async function start(dbName = DB_NAME, client = newClient()) {
  const db = await openDb({ client, dbName })
  const app = await createApp(db, { fetchImpl: fakeFetch })
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  return { base, db, app, stop: () => new Promise(r => server.close(() => db.close().then(r))) }
}
const call = async (base, method, url, body, token, headers = {}) => {
  const res = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const type = res.headers.get('content-type') || ''
  return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() }
}
const login = async (base, email, password, role) => (await call(base, 'POST', '/api/auth/login', { email, password, role })).body.token
let passed = 0
const t = async (name, fn) => { try { await fn(); passed++ } catch (e) { console.error(`FAILED: ${name}`); throw e } }

;(async () => {
  let s = await start(), r
  const B = () => s.base
  let admin, farmer

  await t('auth + security headers', async () => {
    r = await call(B(), 'POST', '/api/auth/login', { email: 'admin@terranova.farm', password: 'nope', role: 'admin' }); assert.equal(r.status, 401)
    r = await call(B(), 'POST', '/api/auth/login', { email: 'admin@terranova.farm', password: 'admin123', role: 'user' }); assert.equal(r.status, 401)
    assert.equal((await call(B(), 'GET', '/api/bootstrap')).status, 401)
    admin = await login(B(), 'admin@terranova.farm', 'admin123', 'admin'); farmer = await login(B(), 'farmer@terranova.farm', 'farmer123', 'user')
    assert.ok(admin && farmer)
    r = await call(B(), 'GET', '/api/health'); assert.equal(r.headers.get('x-frame-options'), 'DENY'); assert.ok(r.headers.get('content-security-policy'))
  })

  await t('bootstrap + live data', async () => {
    r = await call(B(), 'GET', '/api/bootstrap', null, farmer); assert.equal(r.body.apiKey, ''); assert.equal(r.body.settings.simulator, undefined, 'users do not get admin-only settings'); assert.equal(r.body.settings.dripFactor, 0.1)
    r = await call(B(), 'GET', '/api/bootstrap', null, admin); assert.ok(r.body.apiKey.startsWith('tn_live_')); assert.equal(r.body.settings.simulator, true)
    r = await call(B(), 'GET', '/api/live', null, farmer)
    assert.equal(r.body.plots.length, 9); assert.equal(r.body.sensors.length, 5); assert.ok(r.body.sensors.every(x => x.online))
    assert.equal(r.body.weather.source, 'open-meteo'); assert.equal(r.body.weather.days.length, 5)
    assert.ok(r.body.alerts.some(a => a.subject === 'B2' && a.severity === 'critical'))
    assert.ok(r.body.recs.some(x => x.key === 'irrigate:B2' && x.priority === 'urgent'))
    assert.ok(r.body.events.some(e => e.status === 'scheduled'))
  })

  await t('admin-only routes are blocked for users', async () => {
    for (const [m, u, b] of [
      ['PUT', '/api/thresholds', { crit: 40, watch: 60 }], ['PUT', '/api/settings', {}], ['POST', '/api/plots', {}], ['PUT', '/api/plots/A1', {}],
      ['DELETE', '/api/plots/A1'], ['POST', '/api/sensors', {}], ['PUT', '/api/sensors/SNS-01', {}], ['DELETE', '/api/sensors/SNS-01'],
      ['POST', '/api/team/invite', {}], ['DELETE', '/api/team/ravi.patil@terranova.farm'], ['POST', '/api/api-key/regenerate'], ['GET', '/api/audit'],
    ]) assert.equal((await call(B(), m, u, b, farmer)).status, 403, `${m} ${u}`)
  })

  await t('thresholds drive alerts', async () => {
    r = await call(B(), 'PUT', '/api/thresholds', { crit: 50, watch: 52 }, admin); assert.equal(r.status, 400)
    r = await call(B(), 'PUT', '/api/thresholds', { crit: 35, watch: 70 }, admin); assert.equal(r.status, 200)
    r = await call(B(), 'GET', '/api/live', null, admin)
    assert.deepEqual(r.body.thresholds, { crit: 35, watch: 70 })
    assert.ok(!r.body.alerts.some(a => a.subject === 'B2' && a.severity === 'critical'), 'B2 (38%) is no longer critical at 35')
    assert.ok(r.body.alerts.some(a => a.subject === 'B2' && a.severity === 'watch'))
    await call(B(), 'PUT', '/api/thresholds', { crit: 42, watch: 62 }, admin)
  })

  await t('plots: create, validate, edit, manual reading, delete', async () => {
    r = await call(B(), 'POST', '/api/plots', { name: 'Block D-1', crop: 'Co 0238', area: 2.5, age: 5, ndvi: 0.7, moisture: 30 }, admin)
    assert.equal(r.status, 201); const id = r.body.plot.id
    assert.equal((await call(B(), 'POST', '/api/plots', { name: 'block d-1', crop: 'x', area: 1, age: 1, ndvi: 0.5, moisture: 50 }, admin)).status, 409)
    assert.equal((await call(B(), 'POST', '/api/plots', { name: 'Bad', crop: 'x', area: -1, age: 1, ndvi: 0.5, moisture: 50 }, admin)).status, 400)
    r = await call(B(), 'GET', '/api/live', null, admin)
    assert.ok(r.body.alerts.some(a => a.subject === id && a.severity === 'critical'), 'new dry plot raises an alert')
    r = await call(B(), 'PUT', `/api/plots/${id}`, { area: 3 }, admin); assert.equal(r.body.plot.area, 3)
    r = await call(B(), 'POST', `/api/plots/${id}/readings`, { moisture: 150 }, farmer); assert.equal(r.status, 400)
    r = await call(B(), 'POST', `/api/plots/${id}/readings`, { moisture: 75 }, farmer); assert.equal(r.status, 201)
    r = await call(B(), 'GET', `/api/plots/${id}?hours=24`, null, farmer)
    assert.equal(r.body.plot.moisture, 75); assert.ok(r.body.readings.length >= 2)
    r = await call(B(), 'GET', '/api/live', null, admin); assert.ok(!r.body.alerts.some(a => a.subject === id), 'alert auto-resolves')
    assert.equal((await call(B(), 'DELETE', `/api/plots/${id}`, null, admin)).status, 200)
    assert.equal((await call(B(), 'GET', `/api/plots/${id}`, null, admin)).status, 404)
  })

  await t('sensors + device ingest', async () => {
    r = await call(B(), 'POST', '/api/sensors', { plotId: 'C2', depth: '40cm', firmware: '2.3.1' }, admin); assert.equal(r.status, 201)
    const sid = r.body.sensor.id
    assert.equal((await call(B(), 'POST', '/api/sensors', { id: sid, plotId: 'C2' }, admin)).status, 409)
    assert.equal((await call(B(), 'POST', '/api/sensors', { plotId: 'NOPE' }, admin)).status, 400)
    const key = (await call(B(), 'GET', '/api/bootstrap', null, admin)).body.apiKey
    const ingest = (body, k = key) => call(B(), 'POST', '/api/ingest', body, null, { 'X-API-Key': k })
    assert.equal((await ingest({ sensorId: sid, moisture: 50 }, 'wrong')).status, 401)
    assert.equal((await ingest({ sensorId: 'SNS-99', moisture: 50 })).status, 404)
    assert.equal((await ingest({ sensorId: sid, moisture: 500 })).status, 400)
    assert.equal((await ingest({ sensorId: sid, moisture: 50, ts: Date.now() - 30 * 864e5 })).status, 400)
    r = await ingest({ sensorId: sid, moisture: 36, temp: 29.5, ec: 2.4, battery: 55, signal: 'fair' }); assert.equal(r.status, 201)
    r = await ingest({ readings: [{ sensorId: sid, moisture: 37, ts: Date.now() - 600e3 }, { sensorId: 'SNS-01', moisture: 71 }] }); assert.equal(r.body.accepted, 2)
    r = await call(B(), 'GET', '/api/live', null, farmer)
    assert.equal(r.body.plots.find(p => p.id === 'C2').moisture, 36, 'older batch reading must not overwrite the newer latest')
    assert.ok(r.body.alerts.some(a => a.subject === sid && a.kind === 'battery'))
    assert.ok(r.body.recs.some(x => x.key === 'flush:C2'), 'high EC gives a leaching recommendation')
    r = await call(B(), 'GET', `/api/sensors/${sid}/readings?hours=24`, null, farmer); assert.ok(r.body.readings.length >= 2)
    r = await call(B(), 'PUT', `/api/sensors/${sid}`, { plotId: '' }, admin); assert.equal(r.body.sensor.plotId, null)
    assert.equal((await call(B(), 'DELETE', `/api/sensors/${sid}`, null, admin)).status, 200)
    await call(B(), 'POST', '/api/plots/C2/readings', { moisture: 76 }, admin)
  })

  await t('simulator: drying, irrigation raises moisture, runs finish', async () => {
    const moistureOf = async id => (await s.db.findOne('sensors', { id })).moisture
    const before = await moistureOf('SNS-04')
    await s.app.simulator.tick(Date.now(), () => 0.5); await s.app.simulator.tick(Date.now(), () => 0.5)
    const dried = await moistureOf('SNS-04')
    assert.ok(dried < before)
    r = await call(B(), 'POST', '/api/irrigation', { plotId: 'B2', mm: 2, scheduledFor: Date.now() + 3600e3 }, farmer); assert.equal(r.status, 201)
    const id = r.body.event.id
    assert.equal((await call(B(), 'POST', `/api/irrigation/${id}/start`, null, farmer)).status, 200)
    await s.app.simulator.tick(Date.now(), () => 0.5)
    assert.ok((await moistureOf('SNS-04')) > dried)
    await s.app.simulator.tick(Date.now() + 10 * 60e3, () => 0.5) // 2 mm = 4 simulated minutes
    assert.equal((await s.db.findOne('irrigation', { id })).status, 'completed')
    // simulator off => sensors stop reporting
    await call(B(), 'PUT', '/api/settings', { ...(await call(B(), 'GET', '/api/bootstrap', null, admin)).body.settings, simulator: false }, admin)
    assert.equal(await s.app.simulator.tick(), false)
    await call(B(), 'PUT', '/api/settings', { ...(await call(B(), 'GET', '/api/bootstrap', null, admin)).body.settings, simulator: true }, admin)
  })

  await t('irrigation lifecycle + validation', async () => {
    assert.equal((await call(B(), 'POST', '/api/irrigation', { plotId: 'NOPE', mm: 5, scheduledFor: Date.now() + 1e5 }, farmer)).status, 400)
    assert.equal((await call(B(), 'POST', '/api/irrigation', { plotId: 'A1', mm: 500, scheduledFor: Date.now() + 1e5 }, farmer)).status, 400)
    assert.equal((await call(B(), 'POST', '/api/irrigation', { plotId: 'A1', mm: 5, scheduledFor: Date.now() + 200 * 864e5 }, farmer)).status, 400)
    r = await call(B(), 'POST', '/api/irrigation', { plotId: 'A1', mm: 10, kind: 'fertigation', scheduledFor: Date.now() + 1e5, note: 'NPK' }, farmer)
    const e = r.body.event; assert.equal(e.litres, Math.round(10 * 4.2 * 10000 * 0.1))
    assert.equal((await call(B(), 'POST', `/api/irrigation/${e.id}/complete`, { litres: -5 }, farmer)).status, 400)
    r = await call(B(), 'POST', `/api/irrigation/${e.id}/complete`, { litres: 4000 }, farmer); assert.equal(r.body.event.litres, 4000)
    assert.equal((await call(B(), 'POST', `/api/irrigation/${e.id}/cancel`, null, farmer)).status, 409)
    r = await call(B(), 'GET', '/api/irrigation?status=completed&plot=A1&limit=5', null, farmer); assert.ok(r.body.total >= 1)
  })

  await t('recommendations: schedule, dismiss, rain hold', async () => {
    r = await call(B(), 'POST', '/api/recommendations/irrigate:C3/schedule', null, farmer); assert.equal(r.status, 201)
    assert.equal((await call(B(), 'POST', '/api/recommendations/irrigate:C3/schedule', null, farmer)).status, 409)
    r = await call(B(), 'GET', '/api/live', null, farmer); assert.equal(r.body.recs.find(x => x.key === 'irrigate:C3').state, 'scheduled')
    await call(B(), 'POST', '/api/recommendations/irrigate:C1/dismiss', null, farmer)
    r = await call(B(), 'GET', '/api/live', null, farmer); assert.ok(!r.body.recs.some(x => x.key === 'irrigate:C1'))
    assert.equal((await call(B(), 'POST', '/api/recommendations/nope:X/schedule', null, farmer)).status, 404)
    // heavy rain forecast => non-critical plots get a "hold" advisory, critical ones still irrigate
    rain24 = 20; await s.stop(); s = await start(); admin = await login(B(), 'admin@terranova.farm', 'admin123', 'admin')
    r = await call(B(), 'GET', '/api/live', null, admin)
    assert.ok(r.body.recs.some(x => x.key === 'hold:A2' && !x.canSchedule))
    assert.ok(r.body.recs.some(x => x.key === 'irrigate:B2'))
    assert.equal((await call(B(), 'POST', '/api/recommendations/hold:A2/schedule', null, admin)).status, 400)
    rain24 = 0
  })

  await t('alerts + acknowledge', async () => {
    r = await call(B(), 'GET', '/api/alerts?status=open', null, farmer); const a = r.body.alerts[0]; assert.ok(a)
    assert.equal((await call(B(), 'POST', `/api/alerts/${a.id}/acknowledge`, null, farmer)).status, 200)
    assert.equal((await call(B(), 'POST', `/api/alerts/${a.id}/acknowledge`, null, farmer)).status, 409)
    r = await call(B(), 'GET', '/api/alerts?status=acknowledged', null, farmer); assert.ok(r.body.alerts.some(x => x.id === a.id && x.ackBy === 'Ramesh Patil'))
  })

  await t('team invites: email, accept, login, remove', async () => {
    farmer = await login(B(), 'farmer@terranova.farm', 'farmer123', 'user')
    assert.equal((await call(B(), 'POST', '/api/team/invite', { name: 'X', jobRole: 'Y', email: 'bad' }, admin)).status, 400)
    r = await call(B(), 'POST', '/api/team/invite', { name: 'Meera Joshi', jobRole: 'Agronomist', email: 'Meera@Example.com', access: 'user' }, admin)
    assert.equal(r.status, 201); assert.equal(r.body.member.status, 'Invited'); assert.ok(r.body.emailed)
    const token = new URL(r.body.inviteUrl).searchParams.get('token')
    assert.equal((await call(B(), 'POST', '/api/team/invite', { name: 'Meera', jobRole: 'Y', email: 'meera@example.com' }, admin)).status, 409)
    assert.ok(s.app.mailer.outbox.some(m => m.to === 'meera@example.com' && m.text.includes(token)))
    r = await call(B(), 'GET', `/api/invites/${token}`); assert.equal(r.body.email, 'meera@example.com')
    assert.equal((await call(B(), 'GET', '/api/invites/bogus')).status, 404)
    assert.equal((await call(B(), 'POST', '/api/invites/accept', { token, password: 'short' })).status, 400)
    r = await call(B(), 'POST', '/api/invites/accept', { token, password: 'meera-pass-1' }); assert.equal(r.status, 201); assert.equal(r.body.user.role, 'user')
    assert.equal((await call(B(), 'POST', '/api/invites/accept', { token, password: 'meera-pass-1' })).status, 404, 'link is single-use')
    const meera = await login(B(), 'meera@example.com', 'meera-pass-1', 'user'); assert.ok(meera)
    r = await call(B(), 'GET', '/api/bootstrap', null, admin); assert.ok(r.body.team.find(m => m.email === 'meera@example.com' && m.status === 'Active' && m.hasLogin))
    assert.equal((await call(B(), 'DELETE', '/api/team/meera@example.com', null, admin)).status, 200)
    assert.equal((await call(B(), 'GET', '/api/me', null, meera)).status, 401, 'removed user is signed out immediately')
    assert.equal((await call(B(), 'DELETE', '/api/team/kiran.sable@terranova.farm', null, admin)).status, 400)
    r = await call(B(), 'POST', '/api/team/invite', { name: 'Pending P', jobRole: 'Tech', email: 'p@example.com' }, admin)
    r = await call(B(), 'POST', '/api/team/p@example.com/reinvite', null, admin); assert.ok(r.body.inviteUrl)
  })

  await t('password change signs out old sessions', async () => {
    const old = await login(B(), 'farmer@terranova.farm', 'farmer123', 'user')
    assert.equal((await call(B(), 'POST', '/api/auth/change-password', { currentPassword: 'wrong', newPassword: 'newpass123' }, old)).status, 403)
    assert.equal((await call(B(), 'POST', '/api/auth/change-password', { currentPassword: 'farmer123', newPassword: 'short' }, old)).status, 400)
    r = await call(B(), 'POST', '/api/auth/change-password', { currentPassword: 'farmer123', newPassword: 'newpass123' }, old)
    assert.equal(r.status, 200); assert.equal((await call(B(), 'GET', '/api/me', null, old)).status, 401, 'old token revoked')
    assert.equal((await call(B(), 'GET', '/api/me', null, r.body.token)).status, 200, 'new token works')
    farmer = await login(B(), 'farmer@terranova.farm', 'newpass123', 'user')
  })

  await t('reports + CSV exports', async () => {
    r = await call(B(), 'GET', '/api/reports/summary?days=90', null, farmer)
    assert.equal(r.body.weeks.length, 13); assert.ok(r.body.litres > 500000); assert.ok(r.body.cost > 0); assert.equal(r.body.plots.length, 9)
    assert.equal(r.body.weeks.reduce((a, w) => a + w.litres, 0), r.body.litres)
    await call(B(), 'PUT', '/api/plots/A1', { name: '=HYPERLINK("x")' }, admin)
    r = await call(B(), 'GET', '/api/reports/export/plots', null, farmer)
    assert.ok(r.headers.get('content-type').includes('text/csv')); assert.ok(r.body.includes(`"'=HYPERLINK(""x"")"`), 'formula injection neutralised')
    await call(B(), 'PUT', '/api/plots/A1', { name: 'Block A-1' }, admin)
    for (const type of ['irrigation', 'alerts', 'readings']) assert.equal((await call(B(), 'GET', `/api/reports/export/${type}?days=7`, null, farmer)).status, 200)
    assert.equal((await call(B(), 'GET', '/api/reports/export/nope', null, farmer)).status, 404)
  })

  await t('CSV is readable: friendly headers, times in the viewer\'s time zone, plain numbers', async () => {
    const csvOf = async tz => (await call(B(), 'GET', `/api/reports/export/plots?tz=${tz}`, null, farmer))
    r = await csvOf('Asia/Kolkata')
    assert.match(r.headers.get('content-disposition'), /terranova_plots_\d{4}-\d{2}-\d{2}\.csv/)
    const lines = r.body.replace(/^\uFEFF/, '').split('\r\n')
    assert.equal(lines[0], '"Plot","Crop variety","Area (ha)","Age (months)","NDVI","Soil moisture (%)","Status","Last reading"')
    assert.match(lines[1], /,"(Optimal|Watch|Critical)","\d{4}-\d{2}-\d{2} \d{2}:\d{2}"$/)
    assert.ok(!lines[1].includes('T') || !/\dT\d/.test(lines[1]), 'no raw ISO timestamps')
    const when = body => body.replace(/^\uFEFF/, '').split('\r\n')[1].match(/"(\d{4}-\d{2}-\d{2} \d{2}:\d{2})"$/)[1]
    const minutes = x => Date.parse(x.replace(' ', 'T') + 'Z') / 60000
    assert.equal(minutes(when(r.body)) - minutes(when((await csvOf('UTC')).body)), 330, 'India is UTC+5:30')
    assert.equal((await csvOf('Not/AZone')).status, 200, 'an unknown time zone falls back to UTC instead of failing')
    r = await call(B(), 'GET', '/api/reports/export/irrigation?days=90', null, farmer)
    assert.ok(r.body.includes('"Scheduled for"') && r.body.includes('"Block A-2"'), 'plot names are joined in with $lookup')
  })

  await t('Excel workbook export opens and has the expected sheets', async () => {
    const res = await fetch(B() + '/api/reports/export/workbook?days=30&tz=Asia/Kolkata', { headers: { Authorization: `Bearer ${farmer}` } })
    assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /spreadsheetml/)
    assert.match(res.headers.get('content-disposition'), /terranova_report_\d{4}-\d{2}-\d{2}\.xlsx/)
    const buf = Buffer.from(await res.arrayBuffer()); assert.equal(buf.subarray(0, 2).toString(), 'PK', 'an .xlsx file is a zip')
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf)
    assert.deepEqual(wb.worksheets.map(w => w.name), ['Summary', 'Plots', 'Irrigation', 'Alerts', 'Sensor readings'])
    const plots = wb.getWorksheet('Plots')
    assert.equal(plots.rowCount, 12, 'title + spacer + header + 9 plots'); assert.ok(plots.getCell('H4').value instanceof Date, 'dates are real Excel dates')
    assert.equal(plots.views[0].ySplit, 3, 'header row stays visible while scrolling')
    assert.equal(wb.getWorksheet('Summary').getCell('B5').value > 500000, true, 'summary carries the water total')
  })

  await t('summary carries what the printed report needs', async () => {
    r = await call(B(), 'GET', '/api/reports/summary?days=30', null, farmer)
    assert.ok(r.body.estateName && r.body.generatedAt && r.body.since < r.body.generatedAt)
    assert.ok(r.body.recentEvents.length > 0 && r.body.recentEvents[0].plot, 'recent events include plot names')
    assert.ok(r.body.recentAlerts.length > 0, 'seeded alert history shows up in the period')
  })

  await t('Database tab: admin only; lists collections, views, validation and TTL indexes', async () => {
    assert.equal((await call(B(), 'GET', '/api/admin/database', null, farmer)).status, 403)
    r = await call(B(), 'GET', '/api/admin/database', null, admin); assert.equal(r.status, 200); assert.equal(r.body.connected, true)
    const by = Object.fromEntries(r.body.collections.map(c => [c.name, c]))
    for (const n of ['users', 'plots', 'readings', 'counters', 'v_plot_overview', 'v_water_use_daily', 'v_open_alerts']) assert.ok(by[n], `${n} is listed`)
    assert.equal(by.v_plot_overview.type, 'view'); assert.equal(by.v_plot_overview.viewOn, 'plots'); assert.equal(by.plots.type, 'collection')
    assert.ok(by.readings.validated); assert.ok(by.readings.indexes.some(i => i.ttlDays === 30), 'readings expire after 30 days')
    assert.ok(by.users.indexes.some(i => i.keys.startsWith('login_email') && i.unique), 'unique login email')
    assert.ok(r.body.totals.documents > 500 && r.body.totals.views === 3 && r.body.totals.collections >= 12)
    assert.ok(!/\/\/[^*@/]+:[^@/]+@/.test(r.body.uri), 'passwords are never shown')
  })

  await t('views are computed by MongoDB and stay in step with the data', async () => {
    const overview = await s.db.col('v_plot_overview').find({}).toArray()
    assert.equal(overview.length, 9); assert.equal(overview.find(p => p._id === 'A1').sensor_count, 1); assert.equal(overview.find(p => p._id === 'A3').sensor_count, 0)
    const live = (await call(B(), 'GET', '/api/live', null, farmer)).body.alerts.length
    assert.equal((await s.db.col('v_open_alerts').find({}).toArray()).length, live, 'v_open_alerts matches the alerts the website shows')
    const daily = await s.db.col('v_water_use_daily').find({}).toArray()
    const total = (await call(B(), 'GET', '/api/reports/summary?days=90', null, farmer)).body.litres
    assert.equal(daily.reduce((n, d) => n + d.litres, 0), total, 'daily view adds up to the report total')
  })

  await t('demo data includes past alerts and activity, so no collection looks empty', async () => {
    assert.ok((await s.db.count('alerts', { status: 'resolved' })) >= 6)
    assert.ok((await s.db.count('audit')) >= 16)
    r = await call(B(), 'GET', '/api/audit?limit=100', null, admin); assert.ok(r.body.entries.some(e => e.action === 'team.invite'))
  })

  await t('settings validation + audit log', async () => {
    const cur = (await call(B(), 'GET', '/api/bootstrap', null, admin)).body.settings
    assert.equal((await call(B(), 'PUT', '/api/settings', { ...cur, lat: 999 }, admin)).status, 400)
    assert.equal((await call(B(), 'PUT', '/api/settings', { ...cur, costPerKl: 6, estateName: 'Test Estate' }, admin)).status, 200)
    r = await call(B(), 'GET', '/api/audit?limit=100', null, admin)
    const actions = r.body.entries.map(e => e.action)
    for (const a of ['thresholds.update', 'plot.create', 'sensor.create', 'irrigation.schedule', 'team.invite', 'team.accept_invite', 'auth.change_password', 'settings.update']) assert.ok(actions.includes(a), `audit has ${a}`)
  })

  await t('data survives a server restart', async () => {
    await s.stop(); s = await start()
    admin = await login(B(), 'admin@terranova.farm', 'admin123', 'admin')
    r = await call(B(), 'GET', '/api/bootstrap', null, admin)
    assert.equal(r.body.settings.estateName, 'Test Estate'); assert.equal(r.body.settings.costPerKl, 6)
    assert.ok(!r.body.team.some(m => m.email === 'meera@example.com'))
    r = await call(B(), 'GET', '/api/live', null, admin); assert.equal(r.body.plots.length, 9)
  })

  await t('stored data really is MongoDB-shaped (dates, booleans, _id)', async () => {
    const plot = await s.db.col('plots').findOne({ _id: 'A1' })
    assert.ok(plot.moisture_at instanceof Date, 'timestamps are BSON dates')
    const user = await s.db.col('users').findOne({ login_email: 'admin@terranova.farm' })
    assert.equal(typeof user.pref_email, 'boolean'); assert.equal(typeof user._id, 'number')
    assert.equal((await s.db.col('irrigation').countDocuments({})), (await s.db.col('counters').findOne({ _id: 'irrigation' })).seq, 'id counter matches the highest event id')
    // the unique index on login_email is enforced
    await assert.rejects(() => s.db.col('users').insertOne({ ...user, _id: 999 }), /duplicate|E11000/)
  })

  await t('works on a database loaded from database/collections/*.json (the files shipped for Compass)', async () => {
    const dir = path.join(__dirname, '..', '..', 'database', 'collections')
    const revive = v => (v && typeof v === 'object' ? (v.$date ? new Date(v.$date) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]))) : v)
    const client = REAL_URI ? new MongoClient(REAL_URI) : new FakeClient()
    const name = DB_NAME + '_import'
    const d = (await client.connect(), client.db(name))
    for (const col of ORDER) {          // what database/terranova-setup.js does: create with validators, then load the data
      await d.createCollection(col, { validator: VALIDATORS[col], validationLevel: 'strict', validationAction: 'error' })
      const file = path.join(dir, col + '.json')
      if (fs.existsSync(file)) { const docs = JSON.parse(fs.readFileSync(file, 'utf8')).map(revive); if (docs.length) await d.collection(col).insertMany(docs) }
    }
    const imp = await start(name, client)
    try {
      const tok = (await call(imp.base, 'POST', '/api/auth/login', { email: 'admin@terranova.farm', password: 'admin123', role: 'admin' })).body.token
      assert.ok(tok, 'demo login from the imported data works')
      r = await call(imp.base, 'GET', '/api/live', null, tok); assert.equal(r.body.plots.length, 9); assert.equal(r.body.sensors.length, 5)
      const before = await imp.db.count('irrigation')
      r = await call(imp.base, 'POST', '/api/irrigation', { plotId: 'A1', mm: 5, scheduledFor: Date.now() + 1e5 }, tok)
      assert.equal(r.status, 201); assert.equal(r.body.event.id, before + 1, 'new ids continue after the imported ones')
      assert.equal((await call(imp.base, 'POST', '/api/team/invite', { name: 'N', jobRole: 'R', email: 'n@example.com' }, tok)).status, 201)
    } finally {
      await imp.stop()
      if (REAL_URI) await new MongoClient(REAL_URI).connect().then(c => c.db(name).dropDatabase().then(() => c.close()))
    }
  })

  await s.stop()
  if (REAL_URI) { const c = await new MongoClient(REAL_URI).connect(); await c.db(DB_NAME).dropDatabase(); await c.close() }
  console.log(`All ${passed} API test groups passed${REAL_URI ? ' (against real MongoDB)' : ' (in-memory MongoDB stand-in)'}.`)
})().catch(e => { console.error(e); process.exit(1) })
