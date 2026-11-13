const path = require('path')
const { openDb, loadConfig } = require('./db')
const { createApp } = require('./app')

async function main() {
  const db = await openDb()
  const app = await createApp(db, { staticDir: path.join(__dirname, '..', '..', 'web', 'dist'), simulate: true })
  const port = Number(process.env.PORT) || 4000
  const server = app.listen(port, () => {
    console.log(`TerraNova running at http://localhost:${port}`)
    console.log(`MongoDB: ${loadConfig().uri.replace(/\/\/[^@/]*@/, '//***@')}`)
  })
  const stop = () => { app.simulator.stop(); server.close(() => db.close().then(() => process.exit(0))) }
  process.on('SIGINT', stop); process.on('SIGTERM', stop)
}
main().catch(e => { console.error(e.message); process.exit(1) })
