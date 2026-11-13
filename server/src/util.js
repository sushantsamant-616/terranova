const fail = (res, status, message) => res.status(status).json({ error: message })

const isNum = v => typeof v === 'number' && Number.isFinite(v)
/** trimmed string within length limits, or null */
function str(v, { min = 1, max = 120 } = {}) {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length >= min && t.length <= max ? t : null
}
/** number within range, or null */
function num(v, min, max) { return isNum(v) && v >= min && v <= max ? v : null }

/** Tiny in-memory fixed-window rate limiter. */
function rateLimit({ windowMs, max, key = req => req.ip, message = 'Too many requests. Slow down.' }) {
  const hits = new Map()
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k) }, windowMs).unref()
  return (req, res, next) => {
    const k = key(req); const now = Date.now()
    let e = hits.get(k)
    if (!e || e.resetAt <= now) { e = { count: 0, resetAt: now + windowMs }; hits.set(k, e) }
    if (++e.count > max) return fail(res, 429, message)
    next()
  }
}

/** Neutralise spreadsheet formula injection and quote CSV cells. */
function csvCell(v) {
  let s = v == null ? '' : String(v)
  // plain numbers such as -3.5 are fine; anything else starting with a formula character gets defused
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s
  return `"${s.replace(/"/g, '""')}"`
}
const toCsv = (header, rows) => [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')

module.exports = { fail, isNum, str, num, rateLimit, toCsv }
