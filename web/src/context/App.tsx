import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError, setAuthToken } from '../api'
import { getStatus } from '../theme'
import type { Alert, Bootstrap, IrrEvent, Live, Plot, PlotS, Prefs, Profile, Rec, Sensor, Settings, TeamMember, Weather } from '../types'
import { useAuth } from './Auth'
import { useToast } from './Toast'

const POLL_MS = 30000
export const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.')

export type InviteInput = { name: string; email: string; jobRole: string; access: 'admin' | 'user' }
export type InviteResult = { member: TeamMember; inviteUrl: string; emailed: boolean }
export type EventInput = { plotId: string; kind: 'irrigation' | 'fertigation'; mm: number; scheduledFor: number; note: string }

type AppValue = {
  critTh: number; watchTh: number; setCritTh: (n: number) => void; setWatchTh: (n: number) => void
  plots: PlotS[]; sensors: Sensor[]; alerts: Alert[]; openAlerts: Alert[]; events: IrrEvent[]; recentEvents: IrrEvent[]
  recs: Rec[]; weather: Weather; lastUpdated: number; refresh: () => Promise<void>
  profile: Profile; setProfile: (p: Profile) => Promise<boolean>
  prefs: Prefs; setPrefs: (p: Prefs) => void
  team: TeamMember[]; settings: Settings; apiKey: string
  // farm
  addPlot: (p: { name: string; crop: string; area: number; age: number; ndvi: number; moisture: number }) => Promise<boolean>
  updatePlot: (id: string, p: Partial<Pick<Plot, 'name' | 'crop' | 'area' | 'age' | 'ndvi'>>) => Promise<boolean>
  deletePlot: (id: string) => Promise<boolean>
  logReading: (plotId: string, moisture: number) => Promise<boolean>
  addSensor: (s: { id?: string; plotId: string | null; depth: string; firmware: string }) => Promise<boolean>
  updateSensor: (id: string, s: { plotId: string | null; depth: string; firmware: string }) => Promise<boolean>
  removeSensor: (id: string) => Promise<boolean>
  // irrigation, recommendations, alerts
  scheduleEvent: (e: EventInput) => Promise<boolean>
  eventAction: (id: number, action: 'start' | 'complete' | 'cancel', body?: { litres?: number }) => Promise<boolean>
  scheduleRec: (key: string) => Promise<boolean>
  dismissRec: (key: string) => Promise<boolean>
  ackAlert: (id: number) => Promise<boolean>
  // admin
  invite: (i: InviteInput) => Promise<InviteResult | null>
  reinvite: (email: string) => Promise<{ inviteUrl: string; emailed: boolean } | null>
  removeMember: (email: string) => Promise<boolean>
  saveSettings: (s: Settings) => Promise<boolean>
  regenerateKey: () => Promise<boolean>
  changePassword: (current: string, next: string) => Promise<boolean>
}

const AppContext = createContext<AppValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const { logout } = useAuth()
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [live, setLive] = useState<Live | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [b, l] = await Promise.all([api<Bootstrap>('GET', '/api/bootstrap'), api<Live>('GET', '/api/live')])
      setBoot(b); setLive(l)
    } catch (e) { setLoadError(messageOf(e)) }
  }, [])
  useEffect(() => { load() }, [load])

  if (!boot || !live) {
    return (
      <div className="center-screen">
        {loadError ? (
          <div className="card center-card">
            <h2>Couldn't load your farm data</h2>
            <p className="muted">{loadError}</p>
            <div className="row gap"><button className="btn solid" onClick={load}>Retry</button><button className="btn" onClick={logout}>Log out</button></div>
          </div>
        ) : <div className="spinner" aria-label="Loading" />}
      </div>
    )
  }
  return <Loaded initialBoot={boot} initialLive={live}>{children}</Loaded>
}

function Loaded({ initialBoot, initialLive, children }: { initialBoot: Bootstrap; initialLive: Live; children: ReactNode }) {
  const { updateIdentity } = useAuth()
  const toast = useToast()
  const toastRef = useRef(toast); toastRef.current = toast

  const [boot, setBoot] = useState(initialBoot)
  const [live, setLive] = useState(initialLive)
  const [lastUpdated, setLastUpdated] = useState(Date.now())
  const [critTh, setCrit] = useState(initialBoot.thresholds.crit)
  const [watchTh, setWatch] = useState(initialBoot.thresholds.watch)
  const [prefs, setPrefsState] = useState(initialBoot.prefs)

  // ---- live data: refreshed every 30s, when the tab regains focus, and after every change -------------
  const refresh = useCallback(async () => {
    try {
      const l = await api<Live>('GET', '/api/live')
      setLive(l); setLastUpdated(Date.now())
    } catch { /* keep showing the last good data; a failed poll is not worth a popup */ }
  }, [])
  const reloadBoot = useCallback(async () => {
    try { setBoot(await api<Bootstrap>('GET', '/api/bootstrap')) } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, POLL_MS)
    const onVis = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [refresh])

  /** run a change; on success refresh the data, on failure show why */
  const act = useCallback(async <T,>(what: string, fn: () => Promise<T>, opts: { boot?: boolean; ok?: string } = {}): Promise<T | null> => {
    try {
      const r = await fn()
      await Promise.all([refresh(), opts.boot ? reloadBoot() : Promise.resolve()])
      if (opts.ok) toastRef.current(opts.ok, 'ok')
      return r
    } catch (e) {
      toastRef.current(`Couldn't ${what}. ${messageOf(e)}`)
      return null
    }
  }, [refresh, reloadBoot])
  const okAct = async (what: string, fn: () => Promise<unknown>, opts?: { boot?: boolean; ok?: string }) =>
    (await act(what, async () => { await fn(); return true }, opts)) === true

  // ---- thresholds: sliders fire on every tick, so save once they settle (queued in order) -------------
  const liveTh = useRef({ crit: critTh, watch: watchTh })
  const savedTh = useRef({ crit: critTh, watch: watchTh })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const flushThresholds = useCallback(() => {
    timer.current = null
    const next = { ...liveTh.current }
    queue.current = queue.current.then(async () => {
      if (next.crit === savedTh.current.crit && next.watch === savedTh.current.watch) return
      try {
        await api('PUT', '/api/thresholds', next)
        savedTh.current = next
        refresh()
      } catch (e) {
        if (liveTh.current.crit === next.crit && liveTh.current.watch === next.watch) {
          liveTh.current = { ...savedTh.current }; setCrit(savedTh.current.crit); setWatch(savedTh.current.watch)
        }
        toastRef.current(`Couldn't save thresholds. ${messageOf(e)}`)
      }
    })
  }, [refresh])
  const scheduleSave = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(flushThresholds, 500) }
  const setCritTh = (n: number) => { liveTh.current.crit = n; setCrit(n); scheduleSave() }
  const setWatchTh = (n: number) => { liveTh.current.watch = n; setWatch(n); scheduleSave() }
  useEffect(() => {
    const flush = () => { if (timer.current) { clearTimeout(timer.current); flushThresholds() } }
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); flush() }
  }, [flushThresholds])
  // pick up threshold changes made by another admin (only when we have nothing unsaved)
  useEffect(() => {
    if (timer.current) return
    if (live.thresholds.crit !== savedTh.current.crit || live.thresholds.watch !== savedTh.current.watch) {
      savedTh.current = { ...live.thresholds }; liveTh.current = { ...live.thresholds }
      setCrit(live.thresholds.crit); setWatch(live.thresholds.watch)
    }
  }, [live.thresholds])

  const plots = useMemo<PlotS[]>(() => live.plots.map(p => ({ ...p, status: getStatus(p.moisture, critTh, watchTh) })), [live.plots, critTh, watchTh])
  const openAlerts = useMemo(() => live.alerts.filter(a => a.status === 'open'), [live.alerts])

  const value: AppValue = {
    critTh, watchTh, setCritTh, setWatchTh, plots, sensors: live.sensors, alerts: live.alerts, openAlerts,
    events: live.events, recentEvents: live.recentEvents, recs: live.recs, weather: live.weather, lastUpdated, refresh,
    profile: boot.profile, prefs, team: boot.team, settings: boot.settings, apiKey: boot.apiKey,

    async setProfile(p) {
      try {
        const res = await api<{ profile: Profile; user: { displayName: string; title: string } }>('PUT', '/api/profile', p)
        setBoot(b => ({ ...b, profile: res.profile })); updateIdentity(res.user.displayName, res.user.title)
        toast('Profile saved.', 'ok'); return true
      } catch (e) { toast(`Couldn't save profile. ${messageOf(e)}`); return false }
    },
    setPrefs(p) {
      const before = prefs; setPrefsState(p)
      api('PUT', '/api/prefs', p).catch(e => { setPrefsState(before); toast(`Couldn't save notification settings. ${messageOf(e)}`) })
    },

    addPlot: p => okAct('add plot', () => api('POST', '/api/plots', p), { ok: 'Plot added.' }),
    updatePlot: (id, p) => okAct('update plot', () => api('PUT', `/api/plots/${encodeURIComponent(id)}`, p), { ok: 'Plot updated.' }),
    deletePlot: id => okAct('delete plot', () => api('DELETE', `/api/plots/${encodeURIComponent(id)}`), { ok: 'Plot deleted.' }),
    logReading: (id, moisture) => okAct('save reading', () => api('POST', `/api/plots/${encodeURIComponent(id)}/readings`, { moisture }), { ok: 'Reading saved.' }),
    addSensor: s => okAct('add sensor', () => api('POST', '/api/sensors', s), { ok: 'Sensor registered.' }),
    updateSensor: (id, s) => okAct('update sensor', () => api('PUT', `/api/sensors/${encodeURIComponent(id)}`, s), { ok: 'Sensor updated.' }),
    removeSensor: id => okAct('remove sensor', () => api('DELETE', `/api/sensors/${encodeURIComponent(id)}`), { ok: 'Sensor removed.' }),

    scheduleEvent: e => okAct('schedule irrigation', () => api('POST', '/api/irrigation', e), { ok: 'Scheduled.' }),
    eventAction: (id, action, body) => okAct(`${action} irrigation`, () => api('POST', `/api/irrigation/${id}/${action}`, body ?? {}),
      { ok: { start: 'Irrigation started.', complete: 'Marked complete. Log a moisture reading to update the plot.', cancel: 'Cancelled.' }[action] }),
    scheduleRec: key => okAct('schedule recommendation', () => api('POST', `/api/recommendations/${encodeURIComponent(key)}/schedule`), { ok: 'Scheduled. See it under Irrigation.' }),
    dismissRec: key => okAct('dismiss recommendation', () => api('POST', `/api/recommendations/${encodeURIComponent(key)}/dismiss`), { ok: 'Dismissed for 24 hours.' }),
    ackAlert: id => okAct('acknowledge alert', () => api('POST', `/api/alerts/${id}/acknowledge`)),

    invite: i => act('send invite', () => api<InviteResult>('POST', '/api/team/invite', i), { boot: true }),
    reinvite: email => act('create a new invite link', () => api<{ inviteUrl: string; emailed: boolean }>('POST', `/api/team/${encodeURIComponent(email)}/reinvite`)),
    removeMember: email => okAct('remove team member', () => api('DELETE', `/api/team/${encodeURIComponent(email)}`), { boot: true, ok: 'Removed.' }),
    saveSettings: s => okAct('save settings', () => api('PUT', '/api/settings', s), { boot: true, ok: 'Settings saved.' }),
    regenerateKey: () => okAct('regenerate API key', () => api('POST', '/api/api-key/regenerate'), { boot: true, ok: 'New API key generated. Update your devices.' }),
    async changePassword(currentPassword, newPassword) {
      try {
        const res = await api<{ token: string }>('POST', '/api/auth/change-password', { currentPassword, newPassword })
        setAuthToken(res.token) // the old token was just revoked; keep this session signed in
        toast('Password changed. Other devices were signed out.', 'ok'); return true
      } catch (e) { toast(`Couldn't change password. ${messageOf(e)}`); return false }
    },
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
