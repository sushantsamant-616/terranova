import { useMemo, useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../context/App'
import { Badge, Card, Empty, MoistureBar, PageTitle, SectionLabel } from '../components/ui'
import { STATUS, type StatusKey } from '../theme'
import { fmtDateTime, fmtLitres, timeAgo } from '../utils'

const FILTERS: Array<'all' | StatusKey> = ['all', 'optimal', 'watch', 'critical']

export default function Overview() {
  const { plots, sensors, openAlerts, events, weather, settings, watchTh, lastUpdated, refresh, eventAction } = useApp()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | StatusKey>('all')
  const [spin, setSpin] = useState(false)
  const [showMap, setShowMap] = useState(false)

  const known = plots.filter(p => p.moisture != null)
  const avg = known.length ? Math.round(known.reduce((s, p) => s + p.moisture!, 0) / known.length) : null
  const opt = plots.filter(p => p.status === 'optimal').length
  const area = plots.reduce((s, p) => s + p.area, 0)
  const online = sensors.filter(s => s.online).length
  const q = search.toLowerCase()
  const filtered = useMemo(() => plots.filter(p => (filter === 'all' || p.status === filter) && p.name.toLowerCase().includes(q)), [plots, q, filter])
  const nextEvent = (id: string) => events.find(e => e.plotId === id)
  const critical = openAlerts.filter(a => a.severity === 'critical').length

  const kpis = [
    { label: 'Total Area', value: `${area.toFixed(1)} ha`, sub: `${plots.length} active plots` },
    { label: 'Avg Soil Moisture', value: avg == null ? '—' : `${avg}%`, sub: `Target is ${settings.targetMoisture}%` },
    { label: 'Optimal Plots', value: `${opt}/${plots.length}`, sub: opt === plots.length ? 'No action needed' : `${plots.length - opt} below the ${watchTh}% watch level` },
    { label: 'Open Alerts', value: String(openAlerts.length), sub: critical ? `${critical} critical` : 'Nothing critical', warn: critical > 0 },
  ]

  return (
    <>
      <PageTitle title="Farm Overview" sub={`${settings.estateName} · live status of every plot`}>
        <span className="muted small live-note"><i className="dot live" /> Updated {timeAgo(lastUpdated)}</span>
        <button className="btn small-btn" disabled={spin} onClick={async () => { setSpin(true); await refresh(); setSpin(false) }}>Refresh</button>
      </PageTitle>

      <div className="grid kpis">
        {kpis.map(k => (
          <Card key={k.label}>
            <SectionLabel>{k.label}</SectionLabel>
            <div className={`kpi-value ${k.warn ? 'warn' : ''}`}>{k.value}</div>
            <div className="muted small">{k.sub}</div>
          </Card>
        ))}
      </div>

      <div className="toolbar">
        <h2 className="h2">All Plots</h2>
        <input className="search" type="search" aria-label="Search plots" placeholder="Search plots…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="chips">
          {FILTERS.map(f => <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : STATUS[f].label}</button>)}
        </div>
      </div>

      <div className="row gap">
        <button className="btn small-btn" onClick={() => setShowMap(s => !s)}>{showMap ? 'Hide farm map' : 'Show farm map'}</button>
      </div>
      {showMap && <FarmMap plots={plots} sensors={sensors} />}
      <div className="grid plots">
        {filtered.map(p => {
          const ev = nextEvent(p.id)
          return (
            <Link key={p.id} to={`/plots/${p.id}`} className={`plot-card ${p.status}`}>
              <div className="row between"><span className="mono muted small">{p.id}</span><Badge s={p.status} /></div>
              <div className="plot-name">{p.name}</div>
              <div className="muted small">{p.crop} · {p.age}mo · {p.area} ha</div>
              <MoistureBar val={p.moisture} />
              <div className="row between muted small"><span>{p.moisture == null ? 'No reading' : `${p.moisture.toFixed(0)}% moisture`}</span><span>NDVI {p.ndvi}</span></div>
              {ev && <div className={`irr ${p.status === 'unknown' ? 'optimal' : p.status}`}>↳ {ev.status === 'running' ? 'Irrigating now' : `${ev.mm}mm ${ev.kind} · ${fmtDateTime(ev.scheduledFor)}`}</div>}
            </Link>
          )
        })}
        {filtered.length === 0 && <Empty>{plots.length === 0 ? 'No plots yet. An admin can add them under Admin → Plots & sensors.' : 'No plots match that search.'}</Empty>}
      </div>

      <div className="grid three">
        <Card>
          <div className="row between"><SectionLabel>Irrigation queue</SectionLabel><Link className="small" to="/irrigation">All →</Link></div>
          {events.length === 0 && <Empty>Nothing scheduled.</Empty>}
          {events.slice(0, 5).map(e => (
            <div key={e.id} className="list-row between">
              <div className="grow"><div>{e.plotName}</div><div className="muted small">{e.mm}mm {e.kind} · {fmtLitres(e.litres)} · {e.status === 'running' ? 'running' : fmtDateTime(e.scheduledFor)}</div></div>
              {e.status === 'scheduled' && <button className="btn small-btn" onClick={() => eventAction(e.id, 'start')}>Start</button>}
              {e.status === 'running' && <button className="btn small-btn solid" onClick={() => eventAction(e.id, 'complete')}>Finish</button>}
            </div>
          ))}
        </Card>

        <Card>
          <div className="row between"><SectionLabel>5-Day Forecast</SectionLabel>
            <span className={`badge ${weather.source === 'demo' ? 'watch' : 'optimal'}`} title={weather.source === 'demo' ? 'The weather service could not be reached, so sample numbers are shown.' : 'From Open-Meteo'}>{weather.source === 'demo' ? 'Sample data' : 'Live'}</span>
          </div>
          {weather.days.map(w => (
            <div key={w.day} className="list-row weather">
              <span className="mono muted small day">{w.day}</span><span>{w.icon}</span>
              <span className="mono small">{w.high}° <span className="soft">{w.low}°</span></span>
              <span className="mono small rain">{w.rain > 0 ? `💧${w.rain}mm` : '—'}</span><span className="mono small soft">{w.hum}%</span>
            </div>
          ))}
        </Card>

        <Card>
          <SectionLabel>System Status</SectionLabel>
          {[
            { label: 'IoT Sensors', val: `${online}/${sensors.length} online`, ok: online === sensors.length },
            { label: 'Open alerts', val: `${openAlerts.length}`, ok: openAlerts.length === 0 },
            { label: 'Weather feed', val: weather.source === 'demo' ? 'sample data' : 'Open-Meteo', ok: weather.source !== 'demo' },
            { label: 'Rain next 24h', val: `${weather.rain24} mm`, ok: true },
            { label: 'Queued irrigation', val: `${events.length} event${events.length === 1 ? '' : 's'}`, ok: true },
          ].map(s => (
            <div key={s.label} className="list-row between">
              <span className="small">{s.label}</span>
              <span className={`status-val ${s.ok ? 'ok' : 'warn'}`}><i className="dot" />{s.val}</span>
            </div>
          ))}
        </Card>
      </div>

      {critical > 0 && <p className="foot-note">{critical} critical alert(s) — see <Link to="/alerts">Alerts</Link> and <Link to="/recommendations">Recommendations</Link>.</p>}
    </>
  )
}


function FarmMap({ plots, sensors }: { plots: any[]; sensors: any[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current || !(window as any).L) return
    const L = (window as any).L
    const map = L.map(ref.current).setView([27.57, 80.68], 14)
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri' }).addTo(map)
    const colors: Record<string, string> = { optimal: '#22c55e', watch: '#f59e0b', critical: '#ef4444' }
    plots.forEach((p, i) => {
      const lat = 27.57 + (i % 3) * 0.005
      const lon = 80.68 + Math.floor(i / 3) * 0.005
      const poly = L.polygon([[lat, lon], [lat + 0.003, lon], [lat + 0.003, lon + 0.003], [lat, lon + 0.003]], { color: colors[p.status] || '#22c55e', fillOpacity: 0.35 }).addTo(map)
      poly.bindPopup(`${p.name} · ${p.moisture?.toFixed?.(0) ?? '—'}% · ${p.status}`)
    })
    sensors.forEach((d, i) => {
      const lat = 27.572 + (i % 3) * 0.005
      const lon = 80.682 + Math.floor(i / 3) * 0.005
      const m = L.marker([lat, lon]).addTo(map)
      m.bindPopup(`${d.id} · ${d.battery}% battery`)
    })
    return () => map.remove()
  }, [plots, sensors])
  return <div ref={ref} style={{ height: 360, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)', marginTop: 12 }} />
}
