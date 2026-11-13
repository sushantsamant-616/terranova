import { useEffect, useRef, useState, type ReactNode } from 'react'
import { STATUS, type StatusKey } from '../theme'
import type { Reading } from '../types'

export const Card = ({ children, className = '', style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) =>
  <section className={`card ${className}`} style={style}>{children}</section>

export const SectionLabel = ({ children }: { children: ReactNode }) => <h3 className="section-label">{children}</h3>
export const Badge = ({ s }: { s: StatusKey }) => <span className={`badge ${s}`}>{STATUS[s].label}</span>
export const Pill = ({ tone, children }: { tone: 'optimal' | 'watch' | 'critical' | 'unknown'; children: ReactNode }) => <span className={`badge ${tone}`}>{children}</span>
export const Empty = ({ children }: { children: ReactNode }) => <p className="muted empty">{children}</p>
export const Spinner = () => <div className="spinner small" aria-label="Loading" />

export function MoistureBar({ val }: { val: number | null }) {
  if (val == null) return <div className="track" />
  const cls = val < 45 ? 'critical' : val < 62 ? 'watch' : 'optimal'
  return <div className="track"><div className={`fill ${cls}`} style={{ width: `${val}%` }} /></div>
}

export const KV = ({ k, v, tone }: { k: string; v: string; tone?: 'warn' | 'watch' }) => (
  <div className="kv"><div className="kv-label">{k}</div><div className={`kv-value ${tone ?? ''}`}>{v}</div></div>
)

export function PageTitle({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-title"><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
      {children && <div className="row gap wrap">{children}</div>}
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: Array<[T, string]> }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'active' : ''} onClick={() => onChange(k)}>{label}</button>)}
    </div>
  )
}

export function Pager({ total, offset, limit, onChange }: { total: number; offset: number; limit: number; onChange: (o: number) => void }) {
  if (total <= limit) return null
  return (
    <div className="pager">
      <button className="btn small-btn" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>← Newer</button>
      <span className="muted small">{offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
      <button className="btn small-btn" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>Older →</button>
    </div>
  )
}

/** A button that opens a small dropdown panel; closes on outside click or Escape. */
export function Popover({ button, label, children, triggerClass = 'icon-btn', disabled = false }: { button: ReactNode; label: string; children: (close: () => void) => ReactNode; triggerClass?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div className="popover" ref={ref}>
      <button type="button" className={triggerClass} aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(o => !o)}>{button}</button>
      {open && <div className="popover-panel">{children(() => setOpen(false))}</div>}
    </div>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" className="btn small-btn" onClick={async () => {
      try { await navigator.clipboard.writeText(text) } catch {
        const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove()
      }
      setDone(true); setTimeout(() => setDone(false), 1500)
    }}>{done ? 'Copied ✓' : label}</button>
  )
}

/** Time-series line chart (SVG) with optional threshold lines and a hover read-out. */
export function LineChart({ data, field, unit = '', lines = [], yMin = 0, yMax = 100, hours, color = 'var(--bar-optimal)', decimals = 1 }: {
  data: Reading[]; field: 'moisture' | 'temp' | 'ec' | 'ph'; unit?: string; lines?: Array<{ y: number; label: string; color: string }>
  yMin?: number; yMax?: number; hours: number; color?: string; decimals?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const pts = data.filter(d => d[field] != null) as Array<Reading & Record<typeof field, number>>
  const w = 720, h = 240, pl = 38, pr = 14, pt = 12, pb = 26
  if (pts.length < 2) return <p className="muted empty">Not enough readings in this time range yet.</p>
  const now = Date.now(), t0 = now - hours * 3600e3
  const x = (ts: number) => pl + ((ts - t0) / (now - t0)) * (w - pl - pr)
  const y = (v: number) => pt + (1 - (v - yMin) / (yMax - yMin)) * (h - pt - pb)
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.ts).toFixed(1)} ${y(p[field]).toFixed(1)}`).join(' ')
  const ticks = Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) * i) / 4)
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map(f => t0 + f * (now - t0))
  const fmtX = (ts: number) => hours <= 72 ? new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  const hp = hover != null ? pts[hover] : null
  return (
    <div className="chart-wrap">
      <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${field} over the last ${hours} hours`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={e => {
          const r = e.currentTarget.getBoundingClientRect(), mx = ((e.clientX - r.left) / r.width) * w
          let best = 0, bd = Infinity
          pts.forEach((p, i) => { const d = Math.abs(x(p.ts) - mx); if (d < bd) { bd = d; best = i } })
          setHover(best)
        }}>
        {ticks.map(v => (
          <g key={v}><line x1={pl} x2={w - pr} y1={y(v)} y2={y(v)} stroke="var(--track)" /><text x={pl - 6} y={y(v) + 3} fontSize="10" fill="var(--muted)" textAnchor="end">{+v.toFixed(1)}</text></g>
        ))}
        {xTicks.map((t, i) => <text key={i} x={x(t)} y={h - 8} fontSize="10" fill="var(--muted)" textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>{fmtX(t)}</text>)}
        {lines.map(l => (
          <g key={l.label}><line x1={pl} x2={w - pr} y1={y(l.y)} y2={y(l.y)} stroke={l.color} strokeDasharray="5,5" /><text x={w - pr - 2} y={y(l.y) - 4} fontSize="10" fill={l.color} textAnchor="end">{l.label}</text></g>
        ))}
        <path d={path} stroke={color} strokeWidth="2.5" fill="none" strokeLinejoin="round" />
        {hp && <><line x1={x(hp.ts)} x2={x(hp.ts)} y1={pt} y2={h - pb} stroke="var(--muted)" strokeDasharray="3,3" /><circle cx={x(hp.ts)} cy={y(hp[field])} r="4.5" fill={color} stroke="#fff" strokeWidth="2" /></>}
      </svg>
      <div className="chart-readout mono small">{hp ? `${new Date(hp.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · ${hp[field].toFixed(decimals)}${unit}` : `Latest ${pts[pts.length - 1][field].toFixed(decimals)}${unit} · hover the chart for values`}</div>
    </div>
  )
}
