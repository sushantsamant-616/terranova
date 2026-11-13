import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useApp } from '../context/App'
import { useAuth } from '../context/Auth'
import { Badge, Card, Empty, KV, LineChart, PageTitle, Pill, SectionLabel, Tabs } from '../components/ui'
import { fmtDateTime, fmtLitres, timeAgo, toLocalInput } from '../utils'
import type { IrrEvent, Reading, Sensor } from '../types'
import { Select, KIND_OPTIONS } from '../components/Select'

const RANGES: Array<[string, string]> = [['6', '6h'], ['24', '24h'], ['72', '3d'], ['168', '7d'], ['720', '30d']]

export default function PlotDetail() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { user } = useAuth()
  const { plots, critTh, watchTh, settings, lastUpdated, logReading, scheduleEvent, eventAction, updatePlot, deletePlot } = useApp()
  const plot = plots.find(p => p.id === id)
  const [hours, setHours] = useState('24')
  const [data, setData] = useState<{ readings: Reading[]; sensors: Sensor[]; events: IrrEvent[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState('')
  const [mm, setMm] = useState('15')
  const [kind, setKind] = useState<'irrigation' | 'fertigation'>('irrigation')
  const [when, setWhen] = useState(() => toLocalInput(Date.now() + 3600e3))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ name: '', crop: '', area: '', age: '', ndvi: '' })

  useEffect(() => {
    let live = true
    api<{ readings: Reading[]; sensors: Sensor[]; events: IrrEvent[] }>('GET', `/api/plots/${encodeURIComponent(id)}?hours=${hours}`)
      .then(d => { if (live) { setData(d); setError(null) } })
      .catch(e => { if (live) setError(e instanceof ApiError ? e.message : 'Could not load this plot.') })
    return () => { live = false }
  }, [id, hours, lastUpdated])

  if (!plot) return <Card><Empty>{error ?? 'That plot does not exist (it may have been deleted).'}</Empty><Link to="/overview">← Back to overview</Link></Card>

  const isAdmin = user?.role === 'admin'
  const litres = Math.round((Number(mm) || 0) * plot.area * 10000 * settings.dripFactor)
  const submitReading = async (e: FormEvent) => { e.preventDefault(); if (await logReading(plot.id, Number(reading))) setReading('') }
  const submitEvent = async (e: FormEvent) => {
    e.preventDefault()
    await scheduleEvent({ plotId: plot.id, kind, mm: Number(mm), scheduledFor: new Date(when).getTime(), note: '' })
  }
  const startEdit = () => { setDraft({ name: plot.name, crop: plot.crop, area: String(plot.area), age: String(plot.age), ndvi: String(plot.ndvi) }); setEditing(true) }
  const saveEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (await updatePlot(plot.id, { name: draft.name, crop: draft.crop, area: Number(draft.area), age: Number(draft.age), ndvi: Number(draft.ndvi) })) setEditing(false)
  }

  return (
    <>
      <PageTitle title={plot.name} sub={`${plot.crop} · ${plot.area} ha · planted ${plot.age} months ago`}>
        <Badge s={plot.status} />
        {isAdmin && !editing && <button className="btn small-btn" onClick={startEdit}>Edit plot</button>}
        {isAdmin && <button className="btn small-btn danger-btn" onClick={async () => { if (confirm(`Delete ${plot.name}? Its readings and queued irrigation are removed too.`) && await deletePlot(plot.id)) nav('/overview') }}>Delete</button>}
      </PageTitle>
      <Link to="/overview" className="small back">← All plots</Link>

      {editing && (
        <Card><form onSubmit={saveEdit} className="form-grid">
          {([['name', 'Name', 'text'], ['crop', 'Crop / variety', 'text'], ['area', 'Area (ha)', 'number'], ['age', 'Crop age (months)', 'number'], ['ndvi', 'NDVI (0–1)', 'number']] as const).map(([k, label, type]) => (
            <label key={k} className="field">{label}<input type={type} step="any" value={draft[k]} onChange={e => setDraft({ ...draft, [k]: e.target.value })} required /></label>
          ))}
          <div className="row gap end-self"><button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button><button className="btn solid">Save</button></div>
        </form></Card>
      )}

      <div className="grid kpis">
        <Card><SectionLabel>Soil moisture</SectionLabel><div className={`kpi-value ${plot.status === 'critical' ? 'warn' : ''}`}>{plot.moisture == null ? '—' : `${plot.moisture.toFixed(1)}%`}</div><div className="muted small">updated {timeAgo(plot.moistureAt)}</div></Card>
        <Card><SectionLabel>Status</SectionLabel><div className="kpi-value small-kpi">{plot.status === 'unknown' ? 'No data' : plot.status[0].toUpperCase() + plot.status.slice(1)}</div><div className="muted small">critical &lt; {critTh}% · watch &lt; {watchTh}%</div></Card>
        <Card><SectionLabel>NDVI</SectionLabel><div className="kpi-value">{plot.ndvi.toFixed(2)}</div><div className="muted small">crop vigour (1 = best)</div></Card>
        <Card><SectionLabel>Sensors</SectionLabel><div className="kpi-value">{data?.sensors.filter(s => s.online).length ?? '…'}/{plot.sensorIds.length}</div><div className="muted small">{plot.sensorIds.length ? 'online' : 'none attached — log readings by hand'}</div></Card>
      </div>

      <Card>
        <div className="row between wrap"><h3 className="card-title">Moisture history</h3><Tabs value={hours} onChange={setHours} tabs={RANGES} /></div>
        {data ? <LineChart data={data.readings} field="moisture" unit="%" hours={Number(hours)} lines={[{ y: critTh, label: `critical ${critTh}%`, color: 'var(--bar-critical)' }, { y: watchTh, label: `watch ${watchTh}%`, color: 'var(--bar-watch)' }]} /> : <div className="spinner small" />}
      </Card>

      <div className="grid two">
        <Card>
          <SectionLabel>Log a moisture reading</SectionLabel>
          <p className="muted small mb">Measured with a handheld probe? Enter it here; it updates the plot, alerts and recommendations straight away.</p>
          <form onSubmit={submitReading} className="row gap">
            <input type="number" min={0} max={100} step="0.1" placeholder="Moisture %" aria-label="Moisture percent" value={reading} onChange={e => setReading(e.target.value)} required />
            <button className="btn solid">Save</button>
          </form>

          <SectionLabel>&nbsp;</SectionLabel>
          <SectionLabel>Schedule irrigation</SectionLabel>
          <form onSubmit={submitEvent} className="stack">
            <div className="row gap">
              <Select ariaLabel="Type" value={kind} onChange={v => setKind(v as typeof kind)} options={KIND_OPTIONS} />
              <input type="number" min={1} max={100} step="0.5" value={mm} onChange={e => setMm(e.target.value)} aria-label="Depth in mm" required />
              <span className="muted small nowrap">mm</span>
            </div>
            <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} aria-label="Start time" required />
            <div className="muted small">≈ {fmtLitres(litres)} through drip lines ({Math.round(settings.dripFactor * 100)}% of the area is wetted)</div>
            <button className="btn solid">Schedule</button>
          </form>
        </Card>

        <Card>
          <SectionLabel>Sensors on this plot</SectionLabel>
          {data?.sensors.length === 0 && <Empty>No sensor attached.</Empty>}
          {data?.sensors.map(s => (
            <div key={s.id} className="list-row between">
              <div className="grow"><div className="mono">{s.id} <span className="muted small">· {s.depth}</span></div>
                <div className="muted small">EC {s.ec ?? '—'} · pH {s.ph ?? '—'} · {s.temp ?? '—'}°C · battery {s.battery}% · seen {timeAgo(s.lastSeen)}</div></div>
              <Pill tone={s.online ? 'optimal' : 'critical'}>{s.online ? 'online' : 'offline'}</Pill>
            </div>
          ))}
          <SectionLabel>&nbsp;</SectionLabel>
          <SectionLabel>Irrigation history</SectionLabel>
          {data?.events.length === 0 && <Empty>No irrigation recorded yet.</Empty>}
          {data?.events.slice(0, 8).map(e => (
            <div key={e.id} className="list-row between">
              <div className="grow"><div>{e.mm}mm {e.kind} · {fmtLitres(e.litres)}</div><div className="muted small">{fmtDateTime(e.completedAt ?? e.scheduledFor)} · {e.createdBy}</div></div>
              <Pill tone={e.status === 'completed' ? 'optimal' : e.status === 'cancelled' ? 'unknown' : 'watch'}>{e.status}</Pill>
              {e.status === 'scheduled' && <button className="btn small-btn" onClick={() => eventAction(e.id, 'start')}>Start</button>}
              {e.status === 'running' && <button className="btn small-btn solid" onClick={() => eventAction(e.id, 'complete')}>Finish</button>}
            </div>
          ))}
        </Card>
      </div>
      <div className="grid kpis"><KV k="Area" v={`${plot.area} ha`} /><KV k="Crop" v={plot.crop} /><KV k="Age" v={`${plot.age} months`} /><KV k="Drip factor" v={`${settings.dripFactor}`} /></div>
    </>
  )
}
