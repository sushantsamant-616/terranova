import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError, setAuthToken } from '../api'

export default function AcceptInvite() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [info, setInfo] = useState<{ email: string; name: string; jobRole: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ email: string; name: string; jobRole: string }>('GET', `/api/invites/${encodeURIComponent(token)}`)
      .then(i => { setInfo(i); setName(i.name) })
      .catch(e => setError(e instanceof ApiError ? e.message : 'Could not check this invitation.'))
  }, [token])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pw !== pw2) return setError("Passwords don't match.")
    setBusy(true); setError(null)
    try {
      const res = await api<{ token: string }>('POST', '/api/invites/accept', { token, password: pw, name })
      setAuthToken(res.token)
      window.location.assign('/overview') // reload so the app starts signed in as the new user
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Something went wrong.'); setBusy(false) }
  }

  return (
    <div className="center-screen">
      <form className="card login-card" style={{ margin: 0, width: 'min(440px, 100%)' }} onSubmit={submit}>
        <div className="brand dark">🌿 TerraNova</div>
        {!info && !error && <div className="spinner" style={{ margin: '24px auto' }} />}
        {info && (<>
          <h1 style={{ marginTop: 14 }}>Join the team</h1>
          <p className="muted">You're invited as <b>{info.jobRole}</b> ({info.email}). Choose a password to create your account.</p>
          <label>Your name<input value={name} onChange={e => setName(e.target.value)} maxLength={80} required /></label>
          <label>Password<input type="password" value={pw} onChange={e => setPw(e.target.value)} minLength={8} autoComplete="new-password" placeholder="At least 8 characters" required /></label>
          <label>Repeat password<input type="password" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" required /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="btn solid wide" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
        </>)}
        {!info && error && (<>
          <h1 style={{ marginTop: 14 }}>Invitation problem</h1>
          <div className="form-error" role="alert">{error}</div>
          <a className="btn wide" style={{ display: 'block', textAlign: 'center', marginTop: 16 }} href="/">Go to sign in</a>
        </>)}
      </form>
    </div>
  )
}
