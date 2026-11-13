import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { useApp, type InviteResult } from '../context/App'
import { Card, CopyButton, Empty, PageTitle, Pager, Pill, SectionLabel, Tabs } from '../components/ui'
import { fmtDateTime, timeAgo } from '../utils'
import type { Settings } from '../types'
import { Select } from '../components/Select'

const TABS = [['rules', 'Alert rules'], ['team', 'Team'], ['farm', 'Plots & sensors'], ['estate', 'Estate & data'], ['database', 'Database'], ['activity', 'Activity log']] as const
type Tab = (typeof TABS)[number][0]

export default function Admin() {
  const { tab } = useParams()
  const nav = useNavigate()
  if (!TABS.some(([k]) => k === tab)) return <Navigate to="/admin/rules" replace />
  return (
    <>
      <PageTitle title="Admin" sub="Alert rules, team, plots and sensors, estate settings, the database and the audit trail" />
      <Tabs value={tab as Tab} onChange={t => nav(`/admin/${t}`)} tabs={TABS.map(([k, l]) => [k, l] as [Tab, string])} />
      {tab === 'rules' && <Rules />}{tab === 'team' && <Team />}{tab === 'farm' && <Farm />}{tab === 'estate' && <Estate />}{tab === 'database' && <Database />}{tab === 'activity' && <Activity />}
    </>
  )
}

function Rules() {
  const { critTh, watchTh, setCritTh, setWatchTh, plots } = useApp()
  const count = (s: string) => plots.filter(p => p.status === s).length
  return (
    <div className="grid two">
      <Card>
        <SectionLabel>Moisture thresholds</SectionLabel>
        <label className="slider"><span className="row between"><span>Critical below</span><b className="mono crit">{critTh}%</b></span>
          <input type="range" min={20} max={watchTh - 5} step={1} value={critTh} onChange={e => setCritTh(+e.target.value)} className="crit" aria-label="Critical threshold" /></label>
        <label className="slider"><span className="row between"><span>Watch below</span><b className="mono watch">{watchTh}%</b></span>
          <input type="range" min={critTh + 5} max={85} step={1} value={watchTh} onChange={e => setWatchTh(+e.target.value)} className="watch" aria-label="Watch threshold" /></label>
        <p className="muted small">Saved automatically. They set plot colours, alerts and recommendations for everyone.</p>
      </Card>
      <Card>
        <SectionLabel>What this means right now</SectionLabel>
        <div className="grid three-tight">
          <div className="kv"><div className="kv-label">Critical plots</div><div className="kv-value warn">{count('critical')}</div></div>
          <div className="kv"><div className="kv-label">Watch plots</div><div className="kv-value watch">{count('watch')}</div></div>
          <div className="kv"><div className="kv-label">Optimal plots</div><div className="kv-value">{count('optimal')}</div></div>
        </div>
        <p className="muted small mt">Critical raises an alert and an urgent recommendation (and an email if enabled). Watch raises a lower-priority alert.</p>
      </Card>
    </div>
  )
}

function Team() {
  const { team, invite, reinvite, removeMember, settings } = useApp()
  const [f, setF] = useState({ name: '', email: '', jobRole: 'Field Technician', access: 'user' as 'user' | 'admin' })
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<{ email: string; url: string; emailed: boolean } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true)
    const r: InviteResult | null = await invite(f)
    setBusy(false)
    if (r) { setLink({ email: r.member.email, url: r.inviteUrl, emailed: r.emailed }); setF({ ...f, name: '', email: '' }) }
  }
  return (
    <div className="grid two">
      <Card>
        <SectionLabel>Invite someone</SectionLabel>
        <form onSubmit={submit} className="stack">
          <input placeholder="Full name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} maxLength={80} required />
          <input type="email" placeholder="Email address" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} required />
          <div className="row gap">
            <input placeholder="Job role" value={f.jobRole} onChange={e => setF({ ...f, jobRole: e.target.value })} maxLength={60} required />
            <Select ariaLabel="Access level" value={f.access} onChange={v => setF({ ...f, access: v as 'user' | 'admin' })} options={[{ value: 'user', label: 'User access' }, { value: 'admin', label: 'Admin access' }]} />
          </div>
          <button className="btn solid" disabled={busy}>{busy ? 'Creating…' : 'Create invitation'}</button>
        </form>
        {link && (
          <div className="invite-box">
            <div className="small"><b>Invitation for {link.email}</b> (valid 7 days){link.emailed ? ' — also emailed to them.' : ' — email is not set up on this server, so send them this link yourself:'}</div>
            <div className="row gap"><code className="api-key grow">{link.url}</code><CopyButton text={link.url} /></div>
          </div>
        )}
        {!settings.emailEnabled && !link && <p className="muted small mt">Email isn't configured, so you'll be shown a link to share.</p>}
      </Card>

      <Card>
        <SectionLabel>Team ({team.length})</SectionLabel>
        {team.map(m => (
          <div key={m.email} className="list-row">
            <div className="grow"><div>{m.name} {m.access === 'admin' && <span className="muted small">· admin</span>}</div><div className="muted small">{m.role} · {m.email}{!m.hasLogin && m.status === 'Active' ? ' · no login' : ''}</div></div>
            <Pill tone={m.status === 'Active' ? 'optimal' : 'watch'}>{m.status}</Pill>
            {m.status === 'Invited' && <button className="link" onClick={async () => { const r = await reinvite(m.email); if (r) setLink({ email: m.email, url: r.inviteUrl, emailed: r.emailed }) }}>New link</button>}
            {m.role !== 'Admin' && <button className="link danger" onClick={() => { if (confirm(`Remove ${m.name}? ${m.hasLogin ? 'They will be signed out and lose access.' : ''}`)) removeMember(m.email) }}>Remove</button>}
          </div>
        ))}
      </Card>
    </div>
  )
}

function Farm() {
  const { plots, sensors, addPlot, deletePlot, addSensor, updateSensor, removeSensor } = useApp()
  const [p, setP] = useState({ name: '', crop: 'CP 72-2086', area: '', age: '', ndvi: '0.7', moisture: '' })
  const [s, setS] = useState({ id: '', plotId: '', depth: '30cm', firmware: '2.3.0' })
  const addP = async (e: FormEvent) => {
    e.preventDefault()
    if (await addPlot({ name: p.name, crop: p.crop, area: Number(p.area), age: Number(p.age), ndvi: Number(p.ndvi), moisture: Number(p.moisture) })) setP({ ...p, name: '', area: '', age: '', moisture: '' })
  }
  const addS = async (e: FormEvent) => {
    e.preventDefault()
    if (await addSensor({ id: s.id.trim() || undefined, plotId: s.plotId || null, depth: s.depth, firmware: s.firmware })) setS({ ...s, id: '' })
  }
  return (
    <div className="grid two">
      <Card>
        <SectionLabel>Plots ({plots.length})</SectionLabel>
        {plots.map(x => (
          <div key={x.id} className="list-row"><div className="grow"><Link to={`/plots/${x.id}`}>{x.name}</Link><div className="muted small">{x.crop} · {x.area} ha · {x.sensorIds.length} sensor(s)</div></div>
            <button className="link danger" onClick={() => { if (confirm(`Delete ${x.name} and its history?`)) deletePlot(x.id) }}>Delete</button></div>
        ))}
        <form onSubmit={addP} className="stack add-form">
          <div className="label-sm">Add a plot</div>
          <div className="row gap"><input placeholder="Name, e.g. Block D-1" value={p.name} onChange={e => setP({ ...p, name: e.target.value })} required /><input placeholder="Crop / variety" value={p.crop} onChange={e => setP({ ...p, crop: e.target.value })} required /></div>
          <div className="row gap">
            <input type="number" step="any" min={0.1} placeholder="Area (ha)" value={p.area} onChange={e => setP({ ...p, area: e.target.value })} required />
            <input type="number" min={0} placeholder="Age (months)" value={p.age} onChange={e => setP({ ...p, age: e.target.value })} required />
            <input type="number" step="any" min={0} max={1} placeholder="NDVI" value={p.ndvi} onChange={e => setP({ ...p, ndvi: e.target.value })} required />
          </div>
          <div className="row gap"><input type="number" step="any" min={0} max={100} placeholder="Current moisture %" value={p.moisture} onChange={e => setP({ ...p, moisture: e.target.value })} required /><button className="btn solid">Add plot</button></div>
        </form>
      </Card>

      <Card>
        <SectionLabel>Sensor nodes ({sensors.length})</SectionLabel>
        {sensors.map(x => (
          <div key={x.id} className="list-row">
            <div className="grow"><div className="mono">{x.id} <span className="muted small">· {x.depth} · fw {x.firmware}</span></div><div className="muted small">{x.online ? 'online' : 'offline'} · seen {timeAgo(x.lastSeen)} · battery {x.battery}%</div></div>
            <Select className="compact" ariaLabel={`Plot for ${x.id}`} value={x.plotId ?? ''} onChange={v => updateSensor(x.id, { plotId: v || null, depth: x.depth, firmware: x.firmware })} options={[{ value: '', label: 'Unassigned' }, ...plots.map(pl => ({ value: pl.id, label: pl.name }))]} />
            <button className="link danger" onClick={() => { if (confirm(`Remove ${x.id}? Its history is kept under the plot.`)) removeSensor(x.id) }}>Remove</button>
          </div>
        ))}
        <form onSubmit={addS} className="stack add-form">
          <div className="label-sm">Register a sensor</div>
          <div className="row gap"><input placeholder="ID (blank = automatic)" value={s.id} onChange={e => setS({ ...s, id: e.target.value })} /><Select ariaLabel="Plot" value={s.plotId} onChange={v => setS({ ...s, plotId: v })} options={[{ value: '', label: 'Unassigned' }, ...plots.map(pl => ({ value: pl.id, label: pl.name }))]} /></div>
          <div className="row gap"><input placeholder="Depth" value={s.depth} onChange={e => setS({ ...s, depth: e.target.value })} required /><input placeholder="Firmware" value={s.firmware} onChange={e => setS({ ...s, firmware: e.target.value })} required /><button className="btn solid">Register</button></div>
        </form>
      </Card>
    </div>
  )
}

function Estate() {
  const { settings, saveSettings, apiKey, regenerateKey } = useApp()
  const [f, setF] = useState<Record<string, string>>(() => toForm(settings))
  const [sim, setSim] = useState(!!settings.simulator)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setF(toForm(settings)); setSim(!!settings.simulator) }, [settings])
  const fields: Array<[keyof ReturnType<typeof toForm>, string, string, string?]> = [
    ['estateName', 'Estate name', 'text'], ['lat', 'Latitude', 'number', 'Used for the weather forecast'], ['lon', 'Longitude', 'number'],
    ['costPerKl', 'Pumping cost per 1,000 L (₹)', 'number', 'For cost reports'], ['dripFactor', 'Drip wetted share (0–1)', 'number', 'Share of plot area the drip lines wet'],
    ['targetMoisture', 'Target moisture (%)', 'number', 'Irrigation recommendations aim for this'], ['rainSkipMm', 'Hold irrigation if rain ≥ (mm / 24h)', 'number'],
    ['offlineMin', 'Sensor offline after (minutes)', 'number'], ['batteryLow', 'Low battery alert at (%)', 'number'],
  ]
  async function submit(e: FormEvent) {
    e.preventDefault(); setSaving(true)
    await saveSettings({ estateName: f.estateName, lat: Number(f.lat), lon: Number(f.lon), costPerKl: Number(f.costPerKl), dripFactor: Number(f.dripFactor),
      targetMoisture: Number(f.targetMoisture), rainSkipMm: Number(f.rainSkipMm), offlineMin: Number(f.offlineMin), batteryLow: Number(f.batteryLow), simulator: sim })
    setSaving(false)
  }
  const curl = `curl -X POST ${location.origin}/api/ingest \\\n  -H "X-API-Key: ${apiKey}" -H "Content-Type: application/json" \\\n  -d '{"sensorId":"SNS-01","moisture":54.2,"temp":28.4,"ec":1.3,"ph":6.8,"battery":90}'`
  return (
    <div className="grid two">
      <Card>
        <SectionLabel>Estate settings</SectionLabel>
        <form onSubmit={submit} className="form-grid one">
          {fields.map(([k, label, type, hint]) => (
            <label key={k} className="field">{label}<input type={type} step="any" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} required />{hint && <span className="hint">{hint}</span>}</label>
          ))}
          <label className="row between switch-row"><span>Demo data simulator<span className="hint block">Makes sensors report fake readings every minute. Turn off when real devices send data.</span></span>
            <input type="checkbox" role="switch" checked={sim} onChange={e => setSim(e.target.checked)} /></label>
          <button className="btn solid" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
        </form>
      </Card>
      <Card>
        <SectionLabel>Device API key</SectionLabel>
        <div className="row between gap"><code className="api-key grow">{apiKey}</code><CopyButton text={apiKey} /></div>
        <p className="muted small mb mt">Sensors or a gateway send readings to <code>/api/ingest</code> with this key in the <code>X-API-Key</code> header. Register each sensor ID first. Send up to 100 readings at once as <code>{'{"readings":[…]}'}</code>.</p>
        <pre className="code">{curl}</pre>
        <div className="row between gap mt"><span className="muted small">Regenerating stops all devices using the old key.</span><button className="btn" onClick={() => { if (confirm('Regenerate the key? Devices using the old key will stop working.')) regenerateKey() }}>Regenerate</button></div>
      </Card>
    </div>
  )
}
const toForm = (s: Settings) => ({
  estateName: s.estateName, lat: String(s.lat), lon: String(s.lon), costPerKl: String(s.costPerKl), dripFactor: String(s.dripFactor),
  targetMoisture: String(s.targetMoisture), rainSkipMm: String(s.rainSkipMm ?? 8), offlineMin: String(s.offlineMin ?? 30), batteryLow: String(s.batteryLow ?? 70),
})

function Activity() {
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<{ total: number; entries: Array<{ id: number; ts: number; userName: string; action: string; detail: string }> } | null>(null)
  useEffect(() => { api<NonNullable<typeof data>>('GET', `/api/audit?limit=20&offset=${offset}`).then(setData).catch(() => {}) }, [offset])
  return (
    <Card>
      <SectionLabel>Who changed what</SectionLabel>
      <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
        <tbody>{data?.entries.map(e => <tr key={e.id}><td className="nowrap">{fmtDateTime(e.ts)}</td><td>{e.userName}</td><td className="mono small">{e.action}</td><td className="muted">{e.detail}</td></tr>)}</tbody>
      </table></div>
      {data?.entries.length === 0 && <Empty>No activity yet.</Empty>}
      {data && <Pager total={data.total} offset={offset} limit={20} onChange={setOffset} />}
    </Card>
  )
}


type DbInfo = {
  connected: boolean; database: string; uri: string; serverVersion: string; latencyMs: number
  totals: { collections: number; views: number; documents: number; indexes: number; sizeBytes: number }
  collections: Array<{
    name: string; type: 'collection' | 'view'; viewOn: string | null; documents: number; sizeBytes: number | null; validated: boolean
    indexes: Array<{ name: string; keys: string; unique: boolean; ttlDays: number | null }>
  }>
}
const bytes = (n: number | null) => n == null ? '—' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`

function Database() {
  const [info, setInfo] = useState<DbInfo | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  async function load() {
    setLoading(true); setError('')
    try { setInfo(await api<DbInfo>('GET', '/api/admin/database')) } catch (e) { setError(e instanceof Error ? e.message : 'Could not read the database.') }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  if (error) return <Card><p className="form-error">{error}</p><button className="btn small-btn mt" onClick={load}>Try again</button></Card>
  if (!info) return <div className="spinner" style={{ margin: '40px auto' }} />
  const t = info.totals
  return (
    <>
      <Card>
        <div className="row between wrap gap">
          <div>
            <SectionLabel>MongoDB connection</SectionLabel>
            <div className="row gap"><span className="dot live optimal-text" /><b className="optimal-text">Connected</b><span className="muted small">· responded in {info.latencyMs} ms</span></div>
          </div>
          <button className="btn small-btn" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : '↻ Refresh'}</button>
        </div>
        <div className="grid three-tight mt">
          <div className="kv"><div className="kv-label">Database</div><div className="kv-value">{info.database}</div></div>
          <div className="kv"><div className="kv-label">Server version</div><div className="kv-value">{info.serverVersion}</div></div>
          <div className="kv"><div className="kv-label">Connection string</div><div className="kv-value">{info.uri}</div></div>
        </div>
        <div className="row gap mt wrap"><span className="muted small">Open the same database in MongoDB Compass:</span><CopyButton text={info.uri} label="Copy connection string" /></div>
      </Card>

      <div className="grid kpis five">
        {[['Collections', t.collections], ['Views', t.views], ['Documents', t.documents.toLocaleString('en-IN')], ['Indexes', t.indexes], ['Data size', bytes(t.sizeBytes)]].map(([l, v]) => (
          <Card key={String(l)}><SectionLabel>{String(l)}</SectionLabel><div className="kpi-value">{v}</div></Card>
        ))}
      </div>

      <Card>
        <SectionLabel>Collections and views</SectionLabel>
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Type</th><th>Documents</th><th>Size</th><th>Schema rules</th><th>Indexes</th></tr></thead>
          <tbody>{info.collections.map(c => (
            <tr key={c.name}>
              <td><b className="mono">{c.name}</b>{c.viewOn && <div className="muted small">computed from {c.viewOn}</div>}</td>
              <td><Pill tone={c.type === 'view' ? 'watch' : 'optimal'}>{c.type}</Pill></td>
              <td className="mono">{c.documents.toLocaleString('en-IN')}</td>
              <td className="mono">{bytes(c.sizeBytes)}</td>
              <td>{c.validated ? <Pill tone="optimal">validated</Pill> : <span className="muted">—</span>}</td>
              <td>{c.indexes.length === 0 ? <span className="muted">—</span> : c.indexes.map(i => (
                <div key={i.name} className="small"><span className="mono">{i.keys}</span>{i.unique && i.name !== '_id_' && <> · <b>unique</b></>}{i.ttlDays != null && <> · <b>{i.ttlDays === 0 ? 'removed once expired' : `auto-delete after ${i.ttlDays} days`}</b></>}</div>
              ))}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="muted small mt">Collections hold the data; views are read-only and computed by MongoDB on every read. Readings older than 30 days and expired invitations are removed automatically by TTL indexes.</p>
      </Card>
    </>
  )
}
