const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const { MongoClient } = require('mongodb')
const { TABLES, VALIDATORS, INDEXES, VIEWS, ORDER } = require('./schema')

const DEFAULT_SETTINGS = {
  crit_th: '42', watch_th: '62', target_moisture: '80',
  estate_name: 'Sitapur Estate', lat: '27.57', lon: '80.68',
  cost_per_kl: '4.5',        // currency units per 1000 litres pumped
  drip_factor: '0.1',        // share of the plot area actually wetted by drip lines
  rain_skip_mm: '8',         // hold irrigation when this much rain is forecast within 24h
  offline_min: '30',         // sensor counts as offline after this many minutes of silence
  battery_low: '70',         // battery alert level (%)
  simulator: '1',            // demo data generator: 1 = on, 0 = off
}

// ---- connection settings ---------------------------------------------------------------------------------
function loadConfig() {
  let cfg = {}
  try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'mongo.json'), 'utf8')) } catch { /* optional file */ }
  const uri = process.env.MONGODB_URI || cfg.uri || 'mongodb://127.0.0.1:27017/terranova'
  return { uri, options: cfg.options || { serverSelectionTimeoutMS: 5000 } }
}
/** database name from the path part of a connection string (mongodb://host:27017/NAME), if there is one */
const dbNameOf = uri => (uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/) || [])[1] || ''

// ---- row <-> document conversion -------------------------------------------------------------------------
// The rest of the server works with plain rows (snake_case, id fields, dates as epoch milliseconds).
// MongoDB stores them as documents (_id, real dates, real booleans). These helpers translate between the two.
const toMs = v => (v instanceof Date ? v.getTime() : v)
const toDate = v => (typeof v === 'number' ? new Date(v) : v)

function fromDoc(t, d) {
  if (!d) return null
  const T = TABLES[t], row = {}
  for (const f of T.dates || []) row[f] = null
  for (const [k, v] of Object.entries(d)) {
    if (k === '_id') row[T.id] = v
    else row[k] = (T.dates || []).includes(k) ? (v == null ? null : toMs(v)) : v
  }
  return row
}
function toDoc(t, row) {
  const T = TABLES[t], doc = {}
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) continue
    if (k === T.id) doc._id = v
    else if ((T.dates || []).includes(k)) doc[k] = v == null ? null : toDate(v)
    else if ((T.bools || []).includes(k)) doc[k] = !!v
    else doc[k] = v
  }
  return doc
}
function convValue(T, k, v) {
  if (!(T.dates || []).includes(k)) return v
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v).map(([op, x]) => [op, Array.isArray(x) ? x.map(toDate) : toDate(x)]))
  }
  return toDate(v)
}
function convFilter(t, f = {}) {
  const T = TABLES[t], out = {}
  for (const [k, v] of Object.entries(f)) {
    if (k === '$or' || k === '$and') out[k] = v.map(x => convFilter(t, x))
    else out[k === T.id ? '_id' : k] = convValue(T, k, v)
  }
  return out
}
const convSort = (t, s = {}) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k === TABLES[t].id ? '_id' : k, v]))
function convUpdate(t, { set, inc, unset, setOnInsert, max } = {}) {
  const u = {}
  if (set) u.$set = toDoc(t, set)
  if (inc) u.$inc = inc
  if (unset) u.$unset = Object.fromEntries(unset.map(k => [k, '']))
  if (setOnInsert) u.$setOnInsert = toDoc(t, setOnInsert)
  if (max) u.$max = max
  return u
}

// ---- the database handle ---------------------------------------------------------------------------------
class Db {
  constructor(client, database) { this.client = client; this.database = database }
  col(name) { return this.database.collection(name) }

  /** Rows matching `filter`. Filters are written against row fields (id, snake_case, epoch-ms dates). */
  async find(t, filter = {}, { sort, limit, skip, fields } = {}) {
    let cur = this.col(t).find(convFilter(t, filter), fields ? { projection: Object.fromEntries(fields.map(f => [f, 1])) } : undefined)
    if (sort) cur = cur.sort(convSort(t, sort))
    if (skip) cur = cur.skip(skip)
    if (limit) cur = cur.limit(limit)
    return (await cur.toArray()).map(d => fromDoc(t, d))
  }
  async findOne(t, filter = {}, opts = {}) { return (await this.find(t, filter, { ...opts, limit: 1 }))[0] ?? null }
  async count(t, filter = {}) { return this.col(t).countDocuments(convFilter(t, filter)) }
  async exists(t, filter) { return (await this.col(t).countDocuments(convFilter(t, filter), { limit: 1 })) > 0 }

  /** Hands out `n` consecutive numeric ids for collections that use them (users, readings, irrigation, alerts, audit). */
  async nextIds(t, n = 1) {
    const r = await this.col('counters').findOneAndUpdate({ _id: t }, { $inc: { seq: n } }, { upsert: true, returnDocument: 'after' })
    const last = (r && r.value !== undefined ? r.value : r).seq
    return Array.from({ length: n }, (_, i) => last - n + 1 + i)
  }
  /** Inserts one row or an array of rows. Returns the new id (or array of ids). */
  async insert(t, rowOrRows) {
    const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
    if (!rows.length) return []
    const T = TABLES[t]
    if (T.auto) {
      const missing = rows.filter(r => r[T.id] === undefined)
      const ids = await this.nextIds(t, missing.length)
      missing.forEach((r, i) => { r[T.id] = ids[i] })
    }
    const docs = rows.map(r => toDoc(t, r))
    if (docs.length === 1) await this.col(t).insertOne(docs[0])
    else await this.col(t).insertMany(docs)
    const ids = docs.map(d => d._id)
    return Array.isArray(rowOrRows) ? ids : ids[0]
  }
  /** Update matching rows. `ops` = { set, inc, unset: [fields] }. Returns how many rows matched. */
  async update(t, filter, ops, { upsert = false } = {}) {
    const r = await this.col(t).updateMany(convFilter(t, filter), convUpdate(t, ops), { upsert })
    return r.matchedCount + (r.upsertedCount || 0)
  }
  async upsert(t, id, set) { return this.update(t, { [TABLES[t].id]: id }, { set }, { upsert: true }) }
  async remove(t, filter) { return (await this.col(t).deleteMany(convFilter(t, filter))).deletedCount }
  /** next value for an ordering column: highest existing + 1 */
  async nextPos(t) { const last = await this.findOne(t, {}, { sort: { pos: -1 } }); return last ? last.pos + 1 : 0 }

  /** Runs an aggregation pipeline on a collection and returns the raw documents (real dates, _id). */
  aggregate(name, pipeline) { return this.col(name).aggregate(pipeline).toArray() }

  async close() { await this.client.close() }
}

// ---- setup: collections, indexes, counters, demo data -----------------------------------------------------
async function ensureSchema(db) {
  const have = new Set((await db.database.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name))
  for (const name of ORDER) {
    if (!have.has(name)) await db.database.createCollection(name, { validator: VALIDATORS[name], validationLevel: 'strict', validationAction: 'error' })
    for (const [keys, opts] of INDEXES[name] || []) await db.col(name).createIndex(keys, opts)
  }
  for (const [name, v] of Object.entries(VIEWS)) {
    if (!have.has(name)) await db.database.createCollection(name, { viewOn: v.viewOn, pipeline: v.pipeline })
  }
  // numeric id counters start above whatever is already stored (for example data loaded by database/terranova-setup.js)
  for (const name of ORDER.filter(n => TABLES[n].auto)) {
    const top = await db.col(name).find({}, { projection: { _id: 1 } }).sort({ _id: -1 }).limit(1).toArray()
    await db.col('counters').updateOne({ _id: name }, { $max: { seq: top[0]?._id ?? 0 } }, { upsert: true })
  }
}

/** small deterministic generator so demo history looks the same on every fresh database */
function lcg(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296 }

async function seedIfEmpty(db) {
  const now = Date.now()
  const HOUR = 3600e3, DAY = 24 * HOUR

  if ((await db.count('users')) === 0) {
    const mk = (login_email, pw, role, name, title, contact_email, phone) => ({
      login_email, password_hash: bcrypt.hashSync(pw, 10), role, name, title, contact_email, phone, estate: 'Sitapur Estate', since: 'Mar 2025',
      pref_email: true, pref_sms: false, pref_push: true, token_version: 0,
    })
    await db.insert('users', [
      mk('admin@terranova.farm', 'admin123', 'admin', 'Kiran Sable', 'Estate Manager', 'kiran.sable@terranova.farm', '+91 98765 43210'),
      mk('farmer@terranova.farm', 'farmer123', 'user', 'Ramesh Patil', 'Farmer', 'farmer@terranova.farm', '+91 98765 00000'),
    ])
  }

  if ((await db.count('team')) === 0) {
    await db.insert('team', [
      ['kiran.sable@terranova.farm', 'Kiran Sable', 'Admin', 'Active', 'admin'],
      ['anjali.kadam@terranova.farm', 'Anjali Kadam', 'Agronomist', 'Active', 'user'],
      ['ravi.patil@terranova.farm', 'Ravi Patil', 'Field Technician', 'Active', 'user'],
      ['suresh.more@terranova.farm', 'Suresh More', 'Field Technician', 'Active', 'user'],
    ].map(([email, name, role, status, access], pos) => ({ email, name, role, status, access, pos })))
  }

  if ((await db.count('plots')) > 0) return

  const plots = [
    ['A1', 'Block A-1', 4.2, 'CP 72-2086', 14, 0.81, 72], ['A2', 'Block A-2', 3.8, 'RB 867515', 11, 0.67, 48],
    ['A3', 'Block A-3', 5.1, 'CP 72-2086', 8, 0.84, 75], ['B1', 'Block B-1', 6.0, 'SP 81-3250', 18, 0.74, 60],
    ['B2', 'Block B-2', 4.5, 'RB 867515', 6, 0.55, 38], ['B3', 'Block B-3', 3.2, 'CP 72-2086', 22, 0.89, 80],
    ['C1', 'Block C-1', 5.5, 'SP 81-3250', 10, 0.71, 58], ['C2', 'Block C-2', 4.8, 'CP 72-2086', 16, 0.86, 76],
    ['C3', 'Block C-3', 3.9, 'RB 867515', 9, 0.62, 44],
  ]
  await db.insert('plots', plots.map(([id, name, area, crop, age, ndvi, moisture], pos) =>
    ({ id, name, area, crop, age, ndvi, moisture, moisture_at: now - 5 * 60e3, pos })))

  const sensors = [
    ['SNS-01', 'A1', '30cm', 28.1, 1.24, 6.8, 91, '2.3.0', 'strong', 2],
    ['SNS-02', 'A2', '30cm', 29.4, 1.87, 6.4, 74, '2.3.0', 'strong', 3],
    ['SNS-03', 'B1', '45cm', 27.9, 1.41, 7.0, 88, '2.2.4', 'good', 2],
    ['SNS-04', 'B2', '30cm', 30.2, 2.10, 6.1, 62, '2.2.4', 'fair', 6],
    ['SNS-05', 'C1', '60cm', 28.6, 1.33, 6.9, 95, '2.3.0', 'strong', 1],
  ]
  const moistureOf = id => plots.find(p => p[0] === id)[6]
  const readings = []
  const sensorRows = sensors.map(([id, plot, depth, temp, ec, ph, battery, firmware, signal, minsAgo], i) => {
    const m = moistureOf(plot)
    // 48 hours of history ending at the current value, drifting down at roughly 1 point per 8 hours
    const rnd = lcg(1000 + i)
    for (let h = 48; h >= 0; h -= 0.5) {
      const wobble = (rnd() - 0.5) * 1.2
      const moisture = Math.min(95, Math.max(15, m + h * 0.12 + wobble))
      const dayCycle = Math.sin(((now - h * HOUR) % DAY) / DAY * 2 * Math.PI)
      readings.push({ plot_id: plot, sensor_id: id, source: 'sensor', ts: now - h * HOUR - minsAgo * 60e3,
        moisture: +moisture.toFixed(1), temp: +(temp + dayCycle * 3 + (rnd() - 0.5)).toFixed(1), ec, ph })
    }
    return { id, plot_id: plot, depth, firmware, signal, battery, last_seen: now - minsAgo * 60e3, moisture: m, temp, ec, ph, pos: i }
  })
  await db.insert('sensors', sensorRows)
  // plots without a sensor start from one manual reading each
  for (const p of plots.filter(p => !sensors.some(s => s[1] === p[0]))) {
    readings.push({ plot_id: p[0], sensor_id: null, source: 'manual', ts: now - 5 * 60e3, moisture: p[6], temp: null, ec: null, ph: null })
  }
  await db.insert('readings', readings)

  // six weeks of completed irrigation so Reports has real history; weekly totals follow the old demo chart
  const weekLitres = [128000, 141000, 96000, 155000, 133000, 108000]
  const areaOf = id => plots.find(p => p[0] === id)[2]
  const events = []
  weekLitres.forEach((total, w) => {
    const weeksAgo = weekLitres.length - w
    const ids = ['A2', 'B2', 'C3', 'B1']
    const shares = [0.34, 0.31, 0.21, 0.14]
    ids.forEach((pid, k) => {
      const litres = Math.round(total * shares[k] / 100) * 100
      const mm = +(litres / (areaOf(pid) * 10000 * 0.1)).toFixed(1)
      const start = now - weeksAgo * 7 * DAY + (k + 1) * DAY * 1.3 + 6 * HOUR
      events.push({ plot_id: pid, kind: k === 2 ? 'fertigation' : 'irrigation', mm, litres, note: '', status: 'completed',
        scheduled_for: start, started_at: start, completed_at: start + mm * 2 * 60e3, created_by: 'Kiran Sable', created_at: start - HOUR, rec_key: null })
    })
  })
  await seedHistory(db, now)
  events.push({ plot_id: 'A2', kind: 'irrigation', mm: 18, litres: 68400, note: 'Pre-scheduled by agronomist', status: 'scheduled',
    scheduled_for: now + DAY, started_at: null, completed_at: null, created_by: 'Kiran Sable', created_at: now, rec_key: null })
  await db.insert('irrigation', events)
}

/** A couple of weeks of past alerts and activity, so Alerts, the activity log and Reports have history from day one. */
async function seedHistory(db, now) {
  const H = 3600e3, D = 24 * H
  const alert = (daysAgo, hoursOpen, kind, subject, severity, message, by) => ({
    kind, subject, severity, message, status: 'resolved', opened_at: now - daysAgo * D, ack_by: by, ack_at: by ? now - daysAgo * D + 0.5 * H : null, resolved_at: now - daysAgo * D + hoursOpen * H,
  })
  await db.insert('alerts', [
    alert(12, 14, 'moisture', 'C3', 'watch', 'Block C-3 moisture 61% is below the watch level (62%)', 'Ramesh Patil'),
    alert(9, 22, 'moisture', 'B2', 'critical', 'Block B-2 moisture 39% is below the critical level (42%)', 'Anjali Kadam'),
    alert(6, 9, 'moisture', 'A2', 'watch', 'Block A-2 moisture 58% is below the watch level (62%)', 'Kiran Sable'),
    alert(4, 1.5, 'sensor_offline', 'SNS-03', 'critical', 'SNS-03 (Block B-1) has not reported for 41 minutes', 'Ravi Patil'),
    alert(3, 30, 'battery', 'SNS-02', 'watch', 'SNS-02 (Block A-2) battery is at 69%', null),
    alert(2, 7, 'moisture', 'B1', 'watch', 'Block B-1 moisture 60% is below the watch level (62%)', 'Kiran Sable'),
  ])
  const log = (daysAgo, hour, uid, name, action, detail) => ({ ts: now - daysAgo * D - hour * H, user_id: uid, user_name: name, action, detail })
  await db.insert('audit', [
    log(13, 2, 1, 'Kiran Sable', 'auth.login', ''),
    log(12, 3, 2, 'Ramesh Patil', 'auth.login', ''),
    log(12, 1, 2, 'Ramesh Patil', 'alert.acknowledge', 'Block C-3 moisture 61% is below the watch level (62%)'),
    log(11, 5, 1, 'Kiran Sable', 'settings.update', 'cost_per_kl=4.5, drip_factor=0.1'),
    log(10, 4, 1, 'Kiran Sable', 'team.invite', 'Suresh More <suresh.more@terranova.farm> as Field Technician (user)'),
    log(9, 1, null, 'system', 'irrigation.complete', 'Event on B2 finished (simulated)'),
    log(9, 0.5, 1, 'Kiran Sable', 'irrigation.schedule', 'Block B-2: 22mm irrigation'),
    log(8, 6, 1, 'Kiran Sable', 'thresholds.update', 'critical 42%, watch 62%'),
    log(7, 2, 1, 'Kiran Sable', 'plot.update', 'Block A-3'),
    log(6, 3, 1, 'Kiran Sable', 'recommendation.schedule', 'Block A-2: irrigate 18 mm'),
    log(5, 4, 2, 'Ramesh Patil', 'reading.manual', 'Block C-2: 76%'),
    log(4, 1, 1, 'Kiran Sable', 'sensor.update', 'SNS-03 -> B1'),
    log(3, 5, 1, 'Kiran Sable', 'irrigation.start', 'Event on A2 started'),
    log(2, 2, 1, 'Kiran Sable', 'recommendation.dismiss', 'B1-hold'),
    log(1, 6, 1, 'Kiran Sable', 'auth.login', ''),
    log(0.2, 0, 1, 'Kiran Sable', 'auth.login', ''),
  ].map(e => ({ ...e, user_name: e.user_name })))
}

async function ensureSettings(db) {
  const defaults = { ...DEFAULT_SETTINGS, jwt_secret: crypto.randomBytes(32).toString('hex'), api_key: 'tn_live_' + crypto.randomBytes(8).toString('hex') }
  for (const [key, value] of Object.entries(defaults)) {
    await db.col('settings').updateOne({ _id: key }, { $setOnInsert: { value } }, { upsert: true })
  }
}

/**
 * Connects to MongoDB, creates any missing collections/indexes, and loads demo data into an empty database.
 * Options: { uri, dbName } to override the config, or { client } to supply your own MongoClient (used by tests).
 */
async function openDb(opts = {}) {
  const cfg = loadConfig()
  const uri = opts.uri || cfg.uri
  const dbName = opts.dbName || process.env.MONGODB_DB || dbNameOf(uri) || 'terranova'
  const client = opts.client || new MongoClient(uri, cfg.options)
  try {
    await client.connect()
    await client.db(dbName).command({ ping: 1 })
  } catch (e) {
    await client.close().catch(() => {})
    throw new Error(`Cannot reach MongoDB at ${uri.replace(/\/\/[^@/]*@/, '//***@')} (${e.message}). Start MongoDB, or set MONGODB_URI.`)
  }
  const db = new Db(client, client.db(dbName))
  db.uri = uri; db.name = dbName
  await ensureSchema(db)
  await seedIfEmpty(db)
  await ensureSettings(db)
  return db
}

module.exports = { openDb, loadConfig, DEFAULT_SETTINGS, fromDoc, toDoc }
