import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useApp } from '../context/App'
import { Card, Empty, PageTitle, Pill } from '../components/ui'
import { fmtLitres, fmtMoney } from '../utils'

const TONE = { urgent: 'critical', high: 'watch', medium: 'optimal' } as const

export default function Recommendations() {
  const { recs, scheduleRec, dismissRec, weather, lastUpdated } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const [sum, setSum] = useState<{ litres: number; events: number; cost: number; alertsOpened: number } | null>(null)
  useEffect(() => { api<typeof sum>('GET', '/api/reports/summary?days=30').then(setSum).catch(() => {}) }, [lastUpdated])
  const run = async (key: string, fn: (k: string) => Promise<boolean>) => { setBusy(key); await fn(key); setBusy(null) }

  return (
    <>
      <PageTitle title="Recommendations" sub={`Worked out from live soil moisture, trends, salinity and the 5-day forecast (${weather.rain5} mm rain expected)`} />
      <div className="recs">
        {recs.map(rec => (
          <Card key={rec.key} className={`rec ${TONE[rec.priority]}`}>
            <div className="row gap wrap mb">
              <span className="mono soft small">{rec.key}</span>
              <Pill tone={TONE[rec.priority]}><span className="cap">{rec.priority}</span></Pill>
              <Pill tone={rec.type === 'Irrigation' ? 'optimal' : rec.type === 'Fertigation' ? 'watch' : 'unknown'}>{rec.type}</Pill>
            </div>
            <h3 className="rec-action">{rec.action}</h3>
            <div className="mono muted small mb"><Link to={`/plots/${rec.plotId}`}>{rec.plot}</Link> · based on {rec.basis}</div>
            <p className="reason">{rec.reason}</p>
            <div className="facts">
              <div className="kv"><div className="kv-label">Volume</div><div className="kv-value">{rec.volume}</div></div>
              <div className="kv"><div className="kv-label">Timing</div><div className="kv-value">{rec.timing}</div></div>
              <div className="kv"><div className="kv-label">Water</div><div className="kv-value">{rec.litres ? fmtLitres(rec.litres) : '—'}</div></div>
            </div>
            <div className="row gap end">
              <button className="btn" disabled={busy === rec.key} onClick={() => run(rec.key, dismissRec)} title="Hide for 24 hours">Dismiss</button>
              {rec.canSchedule && (rec.state === 'scheduled'
                ? <Link className="btn" to="/irrigation">Scheduled ✓ — view</Link>
                : <button className="btn solid" disabled={busy === rec.key} onClick={() => run(rec.key, scheduleRec)}>Schedule</button>)}
            </div>
          </Card>
        ))}
        {recs.length === 0 && <Empty>All plots are within your thresholds, so there is nothing to do right now. 🌱</Empty>}
      </div>
      <Card>
        <h3 className="section-label">Last 30 days</h3>
        <div className="grid summary">
          {[['Events completed', sum ? String(sum.events) : '…'], ['Water applied', sum ? fmtLitres(sum.litres) : '…'], ['Pumping cost', sum ? fmtMoney(sum.cost) : '…'], ['Alerts raised', sum ? String(sum.alertsOpened) : '…']].map(([l, v]) => (
            <div className="kv" key={l}><div className="kv-label">{l}</div><div className="summary-value">{v}</div></div>
          ))}
        </div>
      </Card>
    </>
  )
}
