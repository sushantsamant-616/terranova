/** Admin-only window into the MongoDB database behind the website: connection health, collections, views and indexes. */
module.exports = function databaseRoutes(app, ctx) {
  const { db, auth, adminOnly } = ctx

  const keysText = key => Object.entries(key).map(([k, v]) => `${k} ${v === -1 ? '↓' : v === 1 ? '↑' : v}`).join(', ')

  app.get('/api/admin/database', auth, adminOnly, async (_req, res) => {
    const t0 = process.hrtime.bigint()
    await db.database.command({ ping: 1 })
    const latencyMs = Number(process.hrtime.bigint() - t0) / 1e6
    const info = await db.database.command({ buildInfo: 1 }).catch(() => ({}))

    const list = await db.database.listCollections({}, { nameOnly: false }).toArray()
    const collections = []
    for (const c of list.filter(c => !c.name.startsWith('system.')).sort((a, b) => a.name.localeCompare(b.name))) {
      const isView = c.type === 'view'
      const documents = await db.col(c.name).countDocuments({})
      const stats = isView ? null : await db.database.command({ collStats: c.name }).catch(() => null)
      const indexes = isView ? [] : (await db.col(c.name).listIndexes().toArray()).map(i => ({
        name: i.name, keys: keysText(i.key), unique: !!i.unique || i.name === '_id_',
        ttlDays: i.expireAfterSeconds == null ? null : Math.round((i.expireAfterSeconds / 86400) * 10) / 10,
      }))
      collections.push({
        name: c.name, type: isView ? 'view' : 'collection', viewOn: c.options?.viewOn ?? null, documents,
        sizeBytes: stats?.size ?? null, storageBytes: stats?.storageSize ?? null, avgObjSize: stats?.avgObjSize ?? null,
        validated: !!c.options?.validator, indexes,
      })
    }
    const real = collections.filter(c => c.type === 'collection')
    res.json({
      connected: true, database: db.name, uri: db.uri.replace(/\/\/[^@/]*@/, '//***@'),
      serverVersion: info.version ?? 'unknown', latencyMs: Math.round(latencyMs * 10) / 10,
      totals: {
        collections: real.length, views: collections.length - real.length, documents: real.reduce((n, c) => n + c.documents, 0),
        indexes: real.reduce((n, c) => n + c.indexes.length, 0), sizeBytes: real.reduce((n, c) => n + (c.sizeBytes ?? 0), 0),
      },
      collections,
    })
  })
}
