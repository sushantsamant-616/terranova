export type StatusKey = 'optimal' | 'watch' | 'critical' | 'unknown'
export type Plot = { id: string; name: string; area: number; crop: string; age: number; ndvi: number; moisture: number | null; moistureAt: number | null; sensorIds: string[] }
export type PlotS = Plot & { status: StatusKey }
export type Sensor = {
  id: string; plotId: string | null; plotName: string | null; depth: string; firmware: string; signal: string; battery: number
  moisture: number | null; temp: number | null; ec: number | null; ph: number | null; lastSeen: number | null; online: boolean
}
export type EventStatus = 'scheduled' | 'running' | 'completed' | 'cancelled'
export type IrrEvent = {
  id: number; plotId: string; plotName: string | null; kind: 'irrigation' | 'fertigation'; mm: number; litres: number; note: string
  status: EventStatus; scheduledFor: number; startedAt: number | null; completedAt: number | null; createdBy: string; recKey: string | null
}
export type Alert = {
  id: number; kind: 'moisture' | 'battery' | 'sensor_offline'; subject: string; severity: 'critical' | 'watch'; message: string
  status: 'open' | 'acknowledged' | 'resolved'; openedAt: number; ackBy: string | null; ackAt: number | null; resolvedAt: number | null
}
export type Rec = {
  key: string; plotId: string; plot: string; type: 'Irrigation' | 'Fertigation' | 'Advisory'; priority: 'urgent' | 'high' | 'medium'
  canSchedule: boolean; action: string; reason: string; mm: number; litres: number; volume: string; timing: string; basis: string
  state: 'open' | 'scheduled'
}
export type WeatherDay = { day: string; icon: string; high: number; low: number; rain: number; hum: number }
export type Weather = { source: 'open-meteo' | 'demo'; fetchedAt: number; days: WeatherDay[]; rain24: number; rain5: number }
export type Live = {
  serverTime: number; thresholds: { crit: number; watch: number }; plots: Plot[]; sensors: Sensor[]; alerts: Alert[]
  events: IrrEvent[]; recentEvents: IrrEvent[]; recs: Rec[]; weather: Weather
}
export type Profile = { name: string; role: string; email: string; phone: string; estate: string; since: string }
export type TeamMember = { name: string; role: string; email: string; status: string; access: 'admin' | 'user'; hasLogin: boolean }
export type Prefs = { email: boolean; sms: boolean; push: boolean }
export type Settings = {
  estateName: string; lat: number; lon: number; targetMoisture: number; dripFactor: number; costPerKl: number
  rainSkipMm?: number; offlineMin?: number; batteryLow?: number; simulator?: boolean; emailEnabled?: boolean
}
export type Bootstrap = {
  thresholds: { crit: number; watch: number }; profile: Profile; prefs: Prefs; team: TeamMember[]; settings: Settings; apiKey: string
}
export type Reading = { ts: number; moisture: number | null; temp: number | null; ec: number | null; ph: number | null }
