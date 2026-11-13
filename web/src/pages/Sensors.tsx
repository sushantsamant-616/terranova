import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useApp } from '../context/App'
import { Card, Empty, LineChart, PageTitle, Pill, Tabs } from '../components/ui'
import { timeAgo } from '../utils'
import type { Reading } from '../types'

const RANGES: Array<[string, string]> = [['6', '6h'], ['24', '24h'], ['72', '3d'], ['168', '7d']]
type Metric = 'moisture' | 'temp' | 'ec' | 'ph'
const METRICS: Record<Metric, { label: string; unit: string; min: number; max: number; color: string }> = {
  moisture: { label: 'Moisture', unit: '%', min: 0, max: 100, color: 'var(--bar-optimal)' },
  temp: { label: 'Temperature', unit: '°C', min: 10, max: 50, color: 'var(--bar-watch)' },
  ec: { label: 'Salinity (EC)', unit: ' dS/m', min: 0, max: 4, color: '#6366f1' },
  ph: { label: 'pH', unit: '', min: 4, max: 9, color: '#0ea5e9' },
}

export default function Sensors() {
  const { sensors, critTh, watchTh, lastUpdated } = useApp()
  const [sel, setSel] = useState<string>('')
  const [hours, setHours] = useState('24')
  const [metric, setMetric] = useState<Metric>('moisture')
  const [readings, setReadings] = useState<Reading[] | null>(null)
  const current = sensors.find(s => s.id === sel) ?? sensors[0]

  useEffect(() => {
    if (!current) return
    let live = true
    api<{ readings: Reading[] }>('GET', `/api/sensors/${encodeURIComponent(current.id)}/readings?hours=${hours}`).then(r => { if (live) setReadings(r.readings) }).catch(() => { if (live) setReadings([]) })
    return () => { live = false }
  }, [current?.id, hours, lastUpdated])

  const m = METRICS[metric]
  const online = sensors.filter(s => s.online).length
  return (
    <>
      <PageTitle title="IoT Sensor Network" sub={`${online} of ${sensors.length} sensors online · readings refresh automatically`} />
      <div className="grid sensors">
        {sensors.map(s => (
          <Card key={s.id} className={`sensor-card ${current?.id === s.id ? 'selected' : ''}`}>
            <div className="row between">
              <button className="link-plain mono sensor-id" onClick={() => { setSel(s.id); setReadings(null) }}>{s.id}</button>
              <div className="row gap"><Pill tone={s.online ? 'optimal' : 'critical'}>{s.online ? 'online' : 'offline'}</Pill><Pill tone={s.signal === 'strong' || s.signal === 'good' ? 'optimal' : 'watch'}>{s.signal}</Pill></div>
            </div>
            <div className="muted small mb">{s.plotId ? <Link to={`/plots/${s.plotId}`}>{s.plotName}</Link> : 'Not assigned to a plot'} · {s.depth} · seen {timeAgo(s.lastSeen)}</div>
            <div className="metrics">
              <Cell label="Moisture" value={s.moisture == null ? '—' : `${s.moisture.toFixed(1)}%`} tone={s.moisture != null && s.moisture < critTh ? 'warn' : s.moisture != null && s.moisture < watchTh ? 'watch' : undefined} />
              <Cell label="Temp" value={s.temp == null ? '—' : `${s.temp}°C`} />
              <Cell label="EC" value={s.ec == null ? '—' : `${s.ec} dS/m`} tone={s.ec != null && s.ec > 2 ? 'warn' : undefined} />
              <Cell label="pH" value={s.ph == null ? '—' : String(s.ph)} />
            </div>
            <div className="battery">
              <span className="muted small">Battery</span>
              <div className="track"><div className={`fill ${s.battery > 70 ? 'optimal' : s.battery > 30 ? 'watch' : 'critical'}`} style={{ width: `${s.battery}%` }} /></div>
              <span className="mono muted small">{s.battery}%</span>
            </div>
          </Card>
        ))}
        {sensors.length === 0 && <Empty>No sensors registered. An admin can add them under Admin → Plots &amp; sensors.</Empty>}
      </div>

      {current && (
        <Card>
          <div className="row between wrap">
            <div><h3 className="card-title">{current.id} · {m.label}</h3><p className="muted small">{current.plotName ?? 'Unassigned'} · {current.depth}</p></div>
            <div className="row gap wrap"><Tabs value={metric} onChange={setMetric} tabs={(Object.keys(METRICS) as Metric[]).map(k => [k, METRICS[k].label])} /><Tabs value={hours} onChange={setHours} tabs={RANGES} /></div>
          </div>
          {readings ? <LineChart data={readings} field={metric} unit={m.unit} yMin={m.min} yMax={m.max} hours={Number(hours)} color={m.color} decimals={metric === 'ec' || metric === 'ph' ? 2 : 1}
            lines={metric === 'moisture' ? [{ y: critTh, label: `critical ${critTh}%`, color: 'var(--bar-critical)' }] : metric === 'ec' ? [{ y: 2, label: 'salinity limit 2.0', color: 'var(--bar-critical)' }] : []} /> : <div className="spinner small" />}
        </Card>
      )}
    </>
  )
}
function Cell({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'watch' }) {
  return <div className="kv"><div className="kv-label">{label}</div><div className={`kv-value ${tone ?? ''}`}>{value}</div></div>
}
