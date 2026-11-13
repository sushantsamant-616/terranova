import { useState, type FormEvent } from 'react'
import { useApp } from '../context/App'
import { useAuth } from '../context/Auth'
import { Card, PageTitle, SectionLabel } from '../components/ui'
import { initials } from '../utils'
import type { Profile } from '../types'
import type { Theme } from '../context/Theme'

export default function Account({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  const { profile, setProfile, prefs, setPrefs, changePassword, settings } = useApp()
  const { user, logout } = useAuth()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Profile>(profile)
  const [saving, setSaving] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault(); setSaving(true)
    const ok = await setProfile(draft)
    setSaving(false); if (ok) setEditing(false)
  }

  return (
    <>
      <PageTitle title="My account" sub={`${user?.role === 'admin' ? 'Admin' : 'User'} account · ${settings.estateName}`} />
      <div className="grid two">
        <Card>
          <form onSubmit={save}>
            <div className="row between">
              <div className="row gap"><div className="avatar">{initials(profile.name)}</div><div><div className="profile-name">{profile.name}</div><div className="muted small">{profile.role} · {profile.estate}</div></div></div>
              {!editing ? <button type="button" className="btn" onClick={() => { setDraft(profile); setEditing(true) }}>Edit</button>
                : <div className="row gap"><button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button><button className="btn solid" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>}
            </div>
            {!editing ? (
              <div className="grid two-tight mt">
                {(['email', 'phone', 'estate', 'since'] as const).map(k => <div className="kv" key={k}><div className="kv-label">{k === 'since' ? 'Member since' : k[0].toUpperCase() + k.slice(1)}</div><div className="kv-value plain">{profile[k] || '—'}</div></div>)}
              </div>
            ) : (
              <div className="grid two-tight mt">
                {(['name', 'email', 'phone', 'estate'] as const).map(f => <label key={f} className="field">{f[0].toUpperCase() + f.slice(1)}<input value={draft[f]} onChange={e => setDraft({ ...draft, [f]: e.target.value })} maxLength={120} required={f !== 'phone'} /></label>)}
              </div>
            )}
          </form>
        </Card>

        <Card>
          <SectionLabel>Notifications</SectionLabel>
          {(['email', 'sms', 'push'] as const).map(k => (
            <label key={k} className="row between switch-row">
              <span>{k === 'sms' ? 'SMS alerts' : k === 'push' ? 'Push notifications' : 'Email alerts'}</span>
              <input type="checkbox" role="switch" checked={prefs[k]} onChange={e => setPrefs({ ...prefs, [k]: e.target.checked })} />
            </label>
          ))}
          <p className="muted small">Email goes to your profile address when a critical alert opens (needs email set up on the server). SMS and push are saved but not delivered yet.</p>
          <div className="prefs">
            <label className="row between switch-row"><span>Dark mode</span><input type="checkbox" role="switch" checked={theme === 'dark'} onChange={toggleTheme} /></label>
          </div>
        </Card>

        <Card><PasswordForm onSubmit={changePassword} /></Card>
        <Card>
          <SectionLabel>Session</SectionLabel>
          <p className="muted small mb">You stay signed in on this device for up to 7 days. Changing your password signs you out everywhere else.</p>
          <button className="btn danger-btn" onClick={logout}>Log out</button>
        </Card>
      </div>
    </>
  )
}

export function PasswordForm({ onSubmit }: { onSubmit: (cur: string, next: string) => Promise<boolean> }) {
  const [cur, setCur] = useState(''), [next, setNext] = useState(''), [again, setAgain] = useState(''), [busy, setBusy] = useState(false)
  const mismatch = again.length > 0 && next !== again
  async function submit(e: FormEvent) {
    e.preventDefault(); if (mismatch) return
    setBusy(true); const ok = await onSubmit(cur, next); setBusy(false)
    if (ok) { setCur(''); setNext(''); setAgain('') }
  }
  return (
    <form onSubmit={submit} className="stack">
      <SectionLabel>Change password</SectionLabel>
      <input type="password" placeholder="Current password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} required />
      <input type="password" placeholder="New password (8+ characters)" autoComplete="new-password" minLength={8} value={next} onChange={e => setNext(e.target.value)} required />
      <input type="password" placeholder="Repeat new password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} required />
      {mismatch && <div className="form-error">Passwords don't match.</div>}
      <button className="btn solid" disabled={busy || mismatch}>{busy ? 'Saving…' : 'Update password'}</button>
    </form>
  )
}
