import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, download } from '../api'
import { useApp, messageOf } from '../context/App'
import { useAuth } from '../context/Auth'
import { useToast } from '../context/Toast'
import { Badge, Card, Empty, PageTitle, Popover, SectionLabel, Tabs } from '../components/ui'
import { fmtDate, fmtDateTime, fmtLitres, fmtMoney } from '../utils'
import type { StatusKey } from '../theme'

type Summary = {
  days: number; since: number; generatedAt: number; estateName: string; costPerKl: number
  litres: number; events: number; fertigationEvents: number; cost: number; avgPerEvent: number; alertsOpened: number
  weeks: Array<{ label: string; litres: number; events: number }>
  plots: Array<{ id: string; name: string; crop: string; area: number; ndvi: number; moisture: number | null; status: StatusKey; litres: number; events: number; litresPerHa: number }>
  recentEvents: Array<{ id: number; plot: string | null; kind: string; mm: number; litres: number; completedAt: number; by: string }>
  recentAlerts: Array<{ id: number; severity: string; message: string; status: string; openedAt: number }>
}

const CSV_EXPORTS: Array<[string, string, string]> = [
  ['plots', 'Plots', 'Current status of every plot'],
  ['irrigation', 'Irrigation events', 'Scheduled, running and completed'],
  ['alerts', 'Alerts', 'Raised, acknowledged and resolved'],
  ['readings', 'Sensor readings', 'Moisture, temperature, EC and pH'],
]
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'UTC' } }
const todayStamp = () => new Date().toLocaleDateString('en-CA') // 2026-11-08

export default function Reports() {
  const { lastUpdated, settings, critTh, watchTh } = useApp()
  const { user } = useAuth()
  const toast = useToast()
  const [days, setDays] = useState('30')
  const [sum, setSum] = useState<Summary | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<Summary>('GET', `/api/reports/summary?days=${days}`).then(setSum).catch(() => {}) }, [days, lastUpdated])

  async function exportFile(type: 'workbook' | string, close: () => void) {
    close()
    if (busy) return
    setBusy(true)
    const isXlsx = type === 'workbook'
    const name = isXlsx ? `terranova_report_${todayStamp()}.xlsx` : `terranova_${type}_${todayStamp()}.csv`
    try {
      await download(`/api/reports/export/${type}?days=${days}&tz=${encodeURIComponent(tz())}`, name)
      toast(`Downloaded ${name}`, 'ok')
    } catch (e) { toast(`Export failed. ${messageOf(e)}`) }
    finally { setBusy(false) }
  }

  /** the browser's print dialog (choose "Save as PDF" there); the page title becomes the suggested file name */
  function printReport() {
    const before = document.title
    document.title = `TerraNova report - ${sum?.estateName ?? 'estate'} - last ${days} days - ${todayStamp()}`
    const restore = () => { document.title = before; window.removeEventListener('afterprint', restore) }
    window.addEventListener('afterprint', restore)
    window.print()
  }

  const max = Math.max(1, ...(sum?.weeks.map(w => w.litres) ?? [1]))

  return (
    <>
      <div className="screen-only">
        <PageTitle title="Reports" sub={`Water use, cost and plot performance · pumping cost ₹${settings.costPerKl} per 1,000 L`}>
          <Tabs value={days} onChange={setDays} tabs={[['7', '7 days'], ['30', '30 days'], ['90', '90 days']]} />
          <Popover label="Export data" triggerClass="btn small-btn export-btn" disabled={busy}
            button={<>{busy ? <span className="spinner tiny" aria-hidden /> : '⬇'} {busy ? 'Preparing…' : 'Export data'}</>}>
            {close => (
              <div className="menu" role="menu">
                <button role="menuitem" className="menu-item rich" onClick={() => exportFile('workbook', close)}>
                  <b>Excel workbook (.xlsx)</b><span>Formatted summary + all four data sheets</span>
                </button>
                <div className="menu-sep">CSV files</div>
                {CSV_EXPORTS.map(([t, label, hint]) => (
                  <button role="menuitem" key={t} className="menu-item rich" onClick={() => exportFile(t, close)}><b>{label}</b><span>{hint}</span></button>
                ))}
                <p className="menu-note">Covers the last {days} days · times shown in your time zone</p>
              </div>
            )}
          </Popover>
          <button className="btn small-btn" disabled={!sum} onClick={printReport}>🖨 Print / PDF</button>
        </PageTitle>

        {!sum ? <div className="spinner" style={{ margin: '40px auto' }} /> : <>
          <div className="grid kpis five">
            {[['Water applied', fmtLitres(sum.litres)], ['Pumping cost', fmtMoney(sum.cost)], ['Events completed', String(sum.events)], ['Avg per event', fmtLitres(sum.avgPerEvent)], ['Alerts raised', String(sum.alertsOpened)]].map(([l, v]) => (
              <Card key={l}><SectionLabel>{l}</SectionLabel><div className="kpi-value">{v}</div></Card>
            ))}
          </div>

          <div className="grid two">
            <Card>
              <h3 className="card-title">Water applied per week</h3>
              <p className="muted small">Litres from completed irrigation and fertigation events</p>
              <div className="bars" role="img" aria-label="Weekly water use">
                {sum.weeks.map((w, i) => (
                  <div key={i} className="bar-col" title={`${w.label}: ${w.litres.toLocaleString('en-IN')} L in ${w.events} events`}>
                    <span className="mono muted small">{w.litres ? `${Math.round(w.litres / 1000)}k` : ''}</span>
                    <div className="bar" style={{ height: `${(w.litres / max) * 100}%` }} />
                    <span className="mono muted small">{w.label}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <h3 className="card-title">Plot performance</h3>
              <div className="table-wrap"><table>
                <thead><tr><th>Plot</th><th>Moisture</th><th>NDVI</th><th>Water</th><th>L / ha</th><th>Status</th></tr></thead>
                <tbody>{sum.plots.map(p => (
                  <tr key={p.id}><td><Link to={`/plots/${p.id}`}>{p.name}</Link><div className="muted small">{p.crop} · {p.area} ha</div></td>
                    <td className="mono">{p.moisture == null ? '—' : `${p.moisture.toFixed(0)}%`}</td><td className="mono">{p.ndvi}</td>
                    <td className="mono">{fmtLitres(p.litres)}<div className="muted small">{p.events} events</div></td><td className="mono">{p.litresPerHa.toLocaleString('en-IN')}</td><td><Badge s={p.status} /></td></tr>
                ))}</tbody>
              </table></div>
              {sum.plots.length === 0 && <Empty>No plots yet.</Empty>}
            </Card>
          </div>
        </>}
      </div>

      {sum && <PrintReport sum={sum} by={user?.displayName ?? ''} crit={critTh} watch={watchTh} />}
    </>
  )
}

/** Weekly water bars as inline SVG, so they print with their colours in every browser. */
function PrintBars({ weeks }: { weeks: Summary['weeks'] }) {
  const W = 700, H = 150, pl = 8, top = 18, bottom = 22
  const max = Math.max(1, ...weeks.map(w => w.litres))
  const slot = (W - pl * 2) / Math.max(1, weeks.length), bw = Math.min(46, slot * 0.6)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="print-bars" role="img" aria-label="Water applied per week">
      <line x1={pl} x2={W - pl} y1={H - bottom} y2={H - bottom} stroke="#95d5b2" />
      {weeks.map((w, i) => {
        const h = (w.litres / max) * (H - top - bottom), x = pl + slot * i + (slot - bw) / 2
        return (
          <g key={i}>
            <rect x={x} y={H - bottom - h} width={bw} height={Math.max(h, 1.5)} rx="3" fill="#3bb273" />
            {w.litres > 0 && <text x={x + bw / 2} y={H - bottom - h - 5} fontSize="10" textAnchor="middle" fill="#1b4332" fontWeight="600">{`${Math.round(w.litres / 1000)}k L`}</text>}
            <text x={x + bw / 2} y={H - 7} fontSize="10" textAnchor="middle" fill="#5f9a6b">{w.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** The paper version of the report. Hidden on screen; it is what the browser prints / saves as PDF. */
function PrintReport({ sum, by, crit, watch }: { sum: Summary; by: string; crit: number; watch: number }) {
  const kpis: Array<[string, string, string?]> = [
    ['Water applied', fmtLitres(sum.litres)], ['Pumping cost', fmtMoney(sum.cost)], ['Events completed', String(sum.events), `${sum.fertigationEvents} fertigation`],
    ['Average per event', fmtLitres(sum.avgPerEvent)], ['Alerts raised', String(sum.alertsOpened)],
  ]
  return (
    <article className="print-report" aria-hidden>
      <header className="pr-head">
        <div>
          <div className="pr-brand">🌿 TerraNova</div>
          <h1>Water &amp; Irrigation Report</h1>
        </div>
        <dl className="pr-meta">
          <div><dt>Estate</dt><dd>{sum.estateName}</dd></div>
          <div><dt>Period</dt><dd>{fmtDate(sum.since)} – {fmtDate(sum.generatedAt)} ({sum.days} days)</dd></div>
          <div><dt>Generated</dt><dd>{fmtDateTime(sum.generatedAt)}{by ? ` by ${by}` : ''}</dd></div>
        </dl>
      </header>

      <section className="pr-kpis">
        {kpis.map(([l, v, sub]) => <div key={l} className="pr-kpi"><span>{l}</span><b>{v}</b>{sub && <small>{sub}</small>}</div>)}
      </section>

      <section className="pr-section">
        <h2>Water applied per week</h2>
        <p className="pr-sub">Litres from completed irrigation and fertigation events</p>
        <PrintBars weeks={sum.weeks} />
      </section>

      <section className="pr-section">
        <h2>Plot performance</h2>
        <table className="pr-table">
          <thead><tr><th>Plot</th><th>Crop variety</th><th className="num">Area (ha)</th><th className="num">Moisture</th><th className="num">NDVI</th><th className="num">Water applied</th><th className="num">L / ha</th><th>Status</th></tr></thead>
          <tbody>{sum.plots.map(p => (
            <tr key={p.id}>
              <td><b>{p.name}</b></td><td>{p.crop}</td><td className="num">{p.area}</td>
              <td className="num">{p.moisture == null ? '—' : `${p.moisture.toFixed(0)}%`}</td><td className="num">{p.ndvi}</td>
              <td className="num">{fmtLitres(p.litres)} <small>({p.events})</small></td><td className="num">{p.litresPerHa.toLocaleString('en-IN')}</td>
              <td><span className={`pr-chip ${p.status}`}>{p.status === 'unknown' ? 'No data' : p.status[0].toUpperCase() + p.status.slice(1)}</span></td>
            </tr>
          ))}</tbody>
        </table>
        <p className="pr-note">Status: critical below {crit}% soil moisture, watch below {watch}%. Figures in brackets are completed events.</p>
      </section>

      <div className="pr-stack">
        <section className="pr-section">
          <h2>Recent irrigation</h2>
          {sum.recentEvents.length === 0 ? <p className="pr-sub">No completed events in this period.</p> : (
            <table className="pr-table compact">
              <thead><tr><th>Completed</th><th>Plot</th><th>Type</th><th className="num">mm</th><th className="num">Litres</th></tr></thead>
              <tbody>{sum.recentEvents.map(e => (
                <tr key={e.id}><td>{fmtDateTime(e.completedAt)}</td><td>{e.plot ?? '—'}</td><td className="cap">{e.kind}</td><td className="num">{e.mm}</td><td className="num">{e.litres.toLocaleString('en-IN')}</td></tr>
              ))}</tbody>
            </table>
          )}
        </section>
        <section className="pr-section">
          <h2>Alerts in this period</h2>
          {sum.recentAlerts.length === 0 ? <p className="pr-sub">No alerts were raised.</p> : (
            <table className="pr-table compact">
              <thead><tr><th>Opened</th><th>Level</th><th>Alert</th></tr></thead>
              <tbody>{sum.recentAlerts.map(a => (
                <tr key={a.id}><td>{fmtDateTime(a.openedAt)}</td><td><span className={`pr-chip ${a.severity}`}>{a.severity}</span></td><td>{a.message}</td></tr>
              ))}</tbody>
            </table>
          )}
        </section>
      </div>

      <footer className="pr-foot">Pumping cost is calculated at ₹{sum.costPerKl} per 1,000 litres. Source: TerraNova on MongoDB. The full data is available as CSV or Excel from the Reports page.</footer>
    </article>
  )
}
