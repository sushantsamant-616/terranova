import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useApp } from '../context/App'
import { Card, Empty, PageTitle, Pager, Pill, Tabs } from '../components/ui'
import { fmtDateTime, timeAgo } from '../utils'
import type { Alert } from '../types'

const LIMIT = 15
type Tab = 'open' | 'acknowledged' | 'resolved'
const KIND = { moisture: 'Soil moisture', battery: 'Battery', sensor_offline: 'Sensor offline' } as const

export default function Alerts() {
  const { ackAlert, lastUpdated, openAlerts, alerts, prefs, setPrefs } = useApp()
  const [tab, setTab] = useState<Tab>('open')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<{ total: number; alerts: Alert[] } | null>(null)

  useEffect(() => {
    let live = true
    api<{ total: number; alerts: Alert[] }>('GET', `/api/alerts?status=${tab}&limit=${LIMIT}&offset=${offset}`).then(r => { if (live) setData(r) }).catch(() => {})
    return () => { live = false }
  }, [tab, offset, lastUpdated])

  const link = (a: Alert) => a.kind === 'moisture' ? `/plots/${a.subject}` : '/sensors'
  return (
    <>
      <PageTitle title="Alerts" sub="Raised automatically from your thresholds, sensor health and readings. They clear on their own when the problem is fixed." />
      <div className="grid kpis">
        <Card><div className="kpi-value warn">{openAlerts.filter(a => a.severity === 'critical').length}</div><div className="muted small">critical &amp; open</div></Card>
        <Card><div className="kpi-value" style={{ color: 'var(--watch-text)' }}>{openAlerts.filter(a => a.severity === 'watch').length}</div><div className="muted small">watch &amp; open</div></Card>
        <Card><div className="kpi-value">{alerts.filter(a => a.status === 'acknowledged').length}</div><div className="muted small">acknowledged, still active</div></Card>
        <Card>
          <label className="row between switch-row"><span>Email me critical alerts</span><input type="checkbox" role="switch" checked={prefs.email} onChange={e => setPrefs({ ...prefs, email: e.target.checked })} /></label>
          <div className="muted small">Sent only if the server has email set up.</div>
        </Card>
      </div>
      <Card>
        <Tabs value={tab} onChange={t => { setTab(t); setOffset(0); setData(null) }} tabs={[['open', 'Open'], ['acknowledged', 'Acknowledged'], ['resolved', 'Resolved (history)']]} />
        {data?.alerts.length === 0 && <Empty>{tab === 'open' ? '🎉 No open alerts.' : 'Nothing here.'}</Empty>}
        {data?.alerts.map(a => (
          <div key={a.id} className="list-row alert-row">
            <Pill tone={a.severity}>{a.severity}</Pill>
            <div className="grow">
              <div>{a.message}</div>
              <div className="muted small">{KIND[a.kind]} · opened {fmtDateTime(a.openedAt)} ({timeAgo(a.openedAt)}){a.ackBy ? ` · acknowledged by ${a.ackBy}` : ''}{a.resolvedAt ? ` · resolved ${fmtDateTime(a.resolvedAt)}` : ''}</div>
            </div>
            <Link className="small" to={link(a)}>View</Link>
            {a.status === 'open' && <button className="btn small-btn" onClick={() => ackAlert(a.id)}>Acknowledge</button>}
          </div>
        ))}
        {data && <Pager total={data.total} offset={offset} limit={LIMIT} onChange={setOffset} />}
      </Card>
    </>
  )
}
