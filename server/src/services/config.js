async function getSetting(db, key) { return (await db.findOne('settings', { key }))?.value }
async function setSetting(db, key, value) { await db.upsert('settings', key, { value: String(value) }) }
/** typed view of every tunable setting */
async function getCfg(db) {
  const s = Object.fromEntries((await db.find('settings')).map(r => [r.key, r.value]))
  const n = k => Number(s[k])
  return {
    crit: n('crit_th'), watch: n('watch_th'), target: n('target_moisture'),
    estateName: s.estate_name, lat: n('lat'), lon: n('lon'),
    costPerKl: n('cost_per_kl'), dripFactor: n('drip_factor'), rainSkipMm: n('rain_skip_mm'),
    offlineMin: n('offline_min'), batteryLow: n('battery_low'), simulator: s.simulator === '1',
  }
}
function getStatus(moisture, crit, watch) {
  if (moisture == null) return 'unknown'
  if (moisture < crit) return 'critical'
  if (moisture < watch) return 'watch'
  return 'optimal'
}
const litresFor = (mm, area, drip) => Math.round(mm * area * 10000 * drip)

module.exports = { getSetting, setSetting, getCfg, getStatus, litresFor }
