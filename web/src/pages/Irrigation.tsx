import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { useApp } from '../context/App'
import { Card, Empty, PageTitle, Pager, Pill, SectionLabel } from '../components/ui'
import { fmtDateTime, fmtLitres, toLocalInput } from '../utils'
import type { EventStatus, IrrEvent } from '../types'
import { Select, KIND_OPTIONS } from '../components/Select'

const TONE: Record<EventStatus, 'optimal' | 'watch' | 'critical' | 'unknown'> = { scheduled: 'watch', running: 'optimal', completed: 'optimal', cancelled: 'unknown' }
const LIMIT = 12

export default function Irrigation() {
  const { plots, events, settings, scheduleEvent, eventAction, lastUpdated } = useApp()
  const [plotId, setPlotId] = useState('')
  const [kind, setKind] = useState<'irrigation' | 'fertigation'>('irrigation')
  const [mm, setMm] = useState('15')
  const [when, setWhen] = useState(() => toLocalInput(Date.now() + 3600e3))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<'' | 'completed' | 'cancelled'>('')
  const [plotFilter, setPlotFilter] = useState('')
  const [offset, setOffset] = useState(0)
  const [hist, setHist] = useState<{ total: number; events: IrrEvent[] } | null>(null)
  const [finishing, setFinishing] = useState<number | null>(null)
  const [litresIn, setLitresIn] = useState('')

  const plot = plots.find(p => p.id === (plotId || plots[0]?.id))
  const litres = Math.round((Number(mm) || 0) * (plot?.area ?? 0) * 10000 * settings.dripFactor)

  useEffect(() => {
    let live = true
    const q = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) })
    if (filter) q.set('status', filter)
    if (plotFilter) q.set('plot', plotFilter)
    api<{ total: number; events: IrrEvent[] }>('GET', `/api/irrigation?${q}`).then(r => { if (live) setHist(r) }).catch(() => {})
    return () => { live = false }
  }, [filter, plotFilter, offset, lastUpdated])

  async function submit(e: FormEvent) {
    e.preventDefault(); if (!plot) return
    setBusy(true)
    await scheduleEvent({ plotId: plot.id, kind, mm: Number(mm), scheduledFor: new Date(when).getTime(), note })
    setBusy(false); setNote('')
  }
  async function finish(id: number) {
    const body = litresIn.trim() === '' ? {} : { litres: Number(litresIn) }
    if (await eventAction(id, 'complete', body)) { setFinishing(null); setLitresIn('') }
  }

  const running = events.filter(e => e.status === 'running'), upcoming = events.filter(e => e.status === 'scheduled')
  return (
    <>
      <PageTitle title="Irrigation & Fertigation" sub="Schedule, run and record water and nutrient applications" />
      <div className="grid two">
        <Card>
          <SectionLabel>New event</SectionLabel>
          <form onSubmit={submit} className="stack">
            <label className="field">Plot<Select ariaLabel="Plot" value={plot?.id ?? ''} onChange={v => setPlotId(v)} options={plots.map(p => ({ value: p.id, label: `${p.name} (${p.moisture == null ? 'no data' : `${p.moisture.toFixed(0)}%`})` }))} /></label>
            <div className="row gap">
              <label className="field grow">Type<Select ariaLabel="Type" value={kind} onChange={v => setKind(v as typeof kind)} options={KIND_OPTIONS} /></label>
              <label className="field grow">Depth (mm)<input type="number" min={1} max={100} step="0.5" value={mm} onChange={e => setMm(e.target.value)} required /></label>
            </div>
            <label className="field">Start<input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} required /></label>
            <label className="field">Note (optional)<input value={note} maxLength={200} onChange={e => setNote(e.target.value)} placeholder="e.g. NPK 15-5-20 with the irrigation" /></label>
            <div className="muted small">Volume ≈ <b>{fmtLitres(litres)}</b> (1 mm over 1 ha = 10,000 L, × {settings.dripFactor} drip wetted share)</div>
            <button className="btn solid" disabled={busy || !plot}>{busy ? 'Scheduling…' : 'Schedule event'}</button>
          </form>
        </Card>

        <Card>
          <SectionLabel>Running &amp; upcoming</SectionLabel>
          {running.length + upcoming.length === 0 && <Empty>Nothing queued. Use the form or schedule a recommendation.</Empty>}
          {[...running, ...upcoming].map(e => (
            <div key={e.id} className="event">
              <div className="row between">
                <div className="grow"><b>{e.plotName}</b> <span className="muted small">· {e.mm}mm {e.kind} · {fmtLitres(e.litres)}</span>
                  <div className="muted small">{e.status === 'running' ? 'Started' : 'Planned'} {fmtDateTime(e.status === 'running' ? e.startedAt : e.scheduledFor)}{e.note ? ` · ${e.note}` : ''}</div></div>
                <Pill tone={TONE[e.status]}>{e.status}</Pill>
              </div>
              {finishing === e.id ? (
                <div className="row gap wrap mt"><input type="number" min={0} placeholder={`Litres applied (default ${e.litres})`} value={litresIn} onChange={ev => setLitresIn(ev.target.value)} />
                  <button className="btn solid small-btn" onClick={() => finish(e.id)}>Save</button><button className="btn small-btn" onClick={() => setFinishing(null)}>Back</button></div>
              ) : (
                <div className="row gap end mt">
                  {e.status === 'scheduled' && <button className="btn small-btn" onClick={() => eventAction(e.id, 'start')}>Start now</button>}
                  <button className="btn small-btn solid" onClick={() => { setFinishing(e.id); setLitresIn('') }}>Mark complete</button>
                  <button className="btn small-btn danger-btn" onClick={() => { if (confirm('Cancel this event?')) eventAction(e.id, 'cancel') }}>Cancel</button>
                </div>
              )}
            </div>
          ))}
        </Card>
      </div>

      <Card>
        <div className="row between wrap">
          <h3 className="card-title">History</h3>
          <div className="row gap wrap">
            <Select className="compact" ariaLabel="Filter by plot" value={plotFilter} onChange={v => { setPlotFilter(v); setOffset(0) }} options={[{ value: '', label: 'All plots' }, ...plots.map(p => ({ value: p.id, label: p.name }))]} />
            <Select className="compact" ariaLabel="Filter by status" value={filter} onChange={v => { setFilter(v as typeof filter); setOffset(0) }} options={[{ value: '', label: 'All statuses' }, { value: 'completed', label: 'Completed' }, { value: 'cancelled', label: 'Cancelled' }]} />
          </div>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>Plot</th><th>Type</th><th>Depth</th><th>Volume</th><th>Status</th><th>By</th></tr></thead>
          <tbody>
            {hist?.events.filter(e => filter || e.status === 'completed' || e.status === 'cancelled').map(e => (
              <tr key={e.id}><td>{fmtDateTime(e.completedAt ?? e.scheduledFor)}</td><td>{e.plotName}</td><td className="cap">{e.kind}</td><td className="mono">{e.mm}mm</td><td className="mono">{fmtLitres(e.litres)}</td><td><Pill tone={TONE[e.status]}>{e.status}</Pill></td><td className="muted">{e.createdBy}</td></tr>
            ))}
          </tbody>
        </table></div>
        {hist && hist.events.length === 0 && <Empty>No events match.</Empty>}
        {hist && <Pager total={hist.total} offset={offset} limit={LIMIT} onChange={setOffset} />}
        <p className="muted small mt">The history list also shows queued events when "All statuses" is chosen.</p>
      </Card>
    </>
  )
}
