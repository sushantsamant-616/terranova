export function timeAgo(ts: number | null, now = Date.now()): string {
  if (ts == null) return 'never'
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 90) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
export const fmtDateTime = (ts: number | null) => ts == null ? '—'
  : new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
export const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
export const fmtLitres = (l: number) => l >= 100000 ? `${(l / 100000).toFixed(2)} lakh L` : `${Math.round(l).toLocaleString('en-IN')} L`
export const fmtMoney = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
export const initials = (name: string) => name.split(/\s+/).map(n => n[0]).join('').slice(0, 2).toUpperCase()
/** value for <input type="datetime-local"> in the browser's own time zone */
export function toLocalInput(ts: number) {
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60000)
  return d.toISOString().slice(0, 16)
}
