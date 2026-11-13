// A small in-memory stand-in for the parts of the MongoDB driver that TerraNova uses, so `npm test`
// runs without a MongoDB server. It enforces the same $jsonSchema validators and unique indexes as the
// real collections. To test against a real server instead, run:  TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test
const { Query, Aggregator } = require('mingo')

const bsonTypeOf = v => v === null ? 'null' : typeof v === 'boolean' ? 'bool' : typeof v === 'string' ? 'string'
  : typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'double') : v instanceof Date ? 'date' : Array.isArray(v) ? 'array' : 'object'

function validate(schema, doc) {
  const errs = []
  for (const r of schema.required || []) if (!(r in doc)) errs.push(`missing "${r}"`)
  for (const [k, rule] of Object.entries(schema.properties || {})) {
    if (!(k in doc)) continue
    const v = doc[k], type = bsonTypeOf(v)
    if (rule.enum && !rule.enum.includes(v)) errs.push(`"${k}" must be one of ${rule.enum.join('/')}, got ${v}`)
    if (rule.bsonType) {
      const allowed = [].concat(rule.bsonType)
      if (!allowed.includes(type) && !(type === 'int' && allowed.includes('double'))) errs.push(`"${k}" is ${type}, expected ${allowed.join('|')}`)
    }
    if (rule.minimum != null && v < rule.minimum) errs.push(`"${k}" below minimum`)
    if (rule.maximum != null && v > rule.maximum) errs.push(`"${k}" above maximum`)
  }
  return errs
}

const cmp = (a, b) => {
  a = a instanceof Date ? a.getTime() : a ?? null; b = b instanceof Date ? b.getTime() : b ?? null
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  return a < b ? -1 : 1
}

class Cursor {
  constructor(docs, projection) { this.docs = docs; this.projection = projection; this._skip = 0; this._limit = 0 }
  sort(spec) { const keys = Object.entries(spec); this.docs.sort((x, y) => { for (const [k, d] of keys) { const c = cmp(x[k], y[k]); if (c) return c * d } return 0 }); return this }
  skip(n) { this._skip = n; return this }
  limit(n) { this._limit = n; return this }
  async toArray() {
    let out = this.docs.slice(this._skip, this._limit ? this._skip + this._limit : undefined)
    if (this.projection) {
      const keep = Object.keys(this.projection).filter(k => this.projection[k])
      out = out.map(d => Object.fromEntries(Object.entries(d).filter(([k]) => k === '_id' || keep.includes(k))))
    }
    return out.map(d => structuredClone(d))
  }
}

class Collection {
  constructor(name, db) { this.name = name; this.db = db; this.docs = []; this.validator = null; this.unique = []; this.indexes = [{ name: '_id_', key: { _id: 1 } }] }
  _match(filter) { const q = new Query(filter || {}); return this.docs.filter(d => q.test(d)) }
  _check(doc, self) {
    if (this.validator?.$jsonSchema) {
      const errs = validate(this.validator.$jsonSchema, doc)
      if (errs.length) throw Object.assign(new Error(`Document failed validation (${this.name}): ${errs.join('; ')}`), { code: 121 })
    }
    for (const keys of [['_id'], ...this.unique]) {
      if (this.docs.some(d => d !== self && keys.every(k => cmp(d[k], doc[k]) === 0 && d[k] !== undefined))) {
        throw Object.assign(new Error(`E11000 duplicate key in ${this.name}: ${keys.join(',')}`), { code: 11000 })
      }
    }
  }
  find(filter, opts = {}) { return new Cursor(this._match(filter), opts.projection) }
  async findOne(filter) { return (await this.find(filter).limit(1).toArray())[0] ?? null }
  async countDocuments(filter, opts = {}) { const n = this._match(filter).length; return opts.limit ? Math.min(n, opts.limit) : n }
  async insertOne(doc) { const d = structuredClone(doc); this._check(d); this.docs.push(d); return { insertedId: d._id } }
  async insertMany(docs) { for (const doc of docs) await this.insertOne(doc); return { insertedCount: docs.length } }
  _apply(doc, update, inserting) {
    for (const [k, v] of Object.entries(update.$set || {})) doc[k] = structuredClone(v)
    for (const [k, v] of Object.entries(update.$inc || {})) doc[k] = (doc[k] ?? 0) + v
    for (const k of Object.keys(update.$unset || {})) delete doc[k]
    for (const [k, v] of Object.entries(update.$max || {})) if (doc[k] === undefined || v > doc[k]) doc[k] = v
    if (inserting) for (const [k, v] of Object.entries(update.$setOnInsert || {})) doc[k] = structuredClone(v)
  }
  async _update(filter, update, { upsert = false } = {}, many = true) {
    const hits = this._match(filter).slice(0, many ? undefined : 1)
    for (const d of hits) { const next = structuredClone(d); this._apply(next, update, false); this._check(next, d); Object.assign(d, next); for (const k of Object.keys(d)) if (!(k in next)) delete d[k] }
    if (!hits.length && upsert) {
      const doc = {}
      for (const [k, v] of Object.entries(filter)) if (!k.startsWith('$') && (v === null || typeof v !== 'object' || v instanceof Date)) doc[k] = v
      this._apply(doc, update, true); this._check(doc); this.docs.push(doc)
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, doc }
    }
    return { matchedCount: hits.length, modifiedCount: hits.length, upsertedCount: 0, doc: hits[0] }
  }
  async updateOne(f, u, o) { const { doc, ...r } = await this._update(f, u, o, false); return r }
  async updateMany(f, u, o) { const { doc, ...r } = await this._update(f, u, o, true); return r }
  async findOneAndUpdate(f, u, o = {}) {
    const r = await this._update(f, u, o, false)
    return r.doc ? structuredClone(r.doc) : null
  }
  async deleteMany(filter) { const hit = new Set(this._match(filter)); this.docs = this.docs.filter(d => !hit.has(d)); return { deletedCount: hit.size } }
  async createIndex(keys, opts = {}) {
    if (opts.unique) this.unique.push(Object.keys(keys))
    if (!this.indexes.some(i => i.name === opts.name)) this.indexes.push({ name: opts.name, key: keys, ...opts })
    return opts.name
  }
  listIndexes() { return { toArray: async () => structuredClone(this.indexes) } }
  async estimatedDocumentCount() { return this.docs.length }
  aggregate(pipeline) {
    // $lookup reads other collections of the same fake database
    const resolver = name => this.db.collection(name).docs
    return { toArray: async () => new Aggregator(pipeline, { collectionResolver: resolver }).run(this.docs).map(d => structuredClone(d)) }
  }
}

/** a read-only view: its documents are the source collection run through the pipeline, every time */
class View extends Collection {
  constructor(name, db, viewOn, pipeline) { super(name, db); this.viewOn = viewOn; this.pipeline = pipeline }
  get docs() { return new Aggregator(this.pipeline, { collectionResolver: n => this.db.collection(n).docs }).run(this.db.collection(this.viewOn).docs) }
  set docs(_) {}
  async insertOne() { throw Object.assign(new Error('Namespace is a view, writes are not allowed'), { code: 166 }) }
}

class FakeDb {
  constructor() { this.cols = new Map() }
  collection(name) { if (!this.cols.has(name)) this.cols.set(name, new Collection(name, this)); return this.cols.get(name) }
  async createCollection(name, opts = {}) {
    if (opts.viewOn) { const v = new View(name, this, opts.viewOn, opts.pipeline); this.cols.set(name, v); return v }
    const c = this.collection(name); c.validator = opts.validator || null; return c
  }
  listCollections() {
    return { toArray: async () => [...this.cols.entries()].map(([name, c]) => ({
      name, type: c instanceof View ? 'view' : 'collection',
      options: c instanceof View ? { viewOn: c.viewOn, pipeline: c.pipeline } : c.validator ? { validator: c.validator } : {},
    })) }
  }
  async command(cmd) {
    if (cmd.buildInfo) return { version: 'stand-in', ok: 1 }
    if (cmd.dbStats) return { collections: this.cols.size, objects: [...this.cols.values()].reduce((n, c) => n + c.docs.length, 0), dataSize: 0, storageSize: 0, indexSize: 0, ok: 1 }
    if (cmd.collStats) { const docs = this.collection(cmd.collStats).docs; const size = JSON.stringify(docs).length; return { size, storageSize: size, avgObjSize: docs.length ? Math.round(size / docs.length) : 0, ok: 1 } }
    return { ok: 1 }
  }
}

class FakeClient {
  constructor() { this.dbs = new Map() }
  async connect() { return this }
  db(name) { if (!this.dbs.has(name)) this.dbs.set(name, new FakeDb()); return this.dbs.get(name) }
  async close() {}
}

module.exports = { FakeClient }
