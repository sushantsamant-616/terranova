import { useState, type FormEvent } from 'react'
import { DEMO_ACCOUNTS, useAuth, type Role } from '../context/Auth'

export default function Login() {
  const { login } = useAuth()
  const [role, setRole] = useState<Role>('user')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    const err = await login(role, email, password)
    setBusy(false)
    setError(err)
  }
  const pickRole = (r: Role) => { setRole(r); setError(null); setEmail(''); setPassword('') }
  const fillDemo = () => { setEmail(DEMO_ACCOUNTS[role].id); setPassword(DEMO_ACCOUNTS[role].password); setError(null) }

  return (
    <div className="login-page">
      <div className="login-hero">
        <div className="leaf-float leaf1">🍃</div>
        <div className="leaf-float leaf2">🌿</div>
        <div className="leaf-float leaf3">🍃</div>
        <div className="login-hero-inner">
          <div className="brand big">TerraNova</div>
          <p className="tagline">Precision irrigation and fertigation for sugarcane</p>
          <ul className="hero-points">
            <li>Live soil moisture across every plot</li>
            <li>AI irrigation and fertigation recommendations</li>
            <li>Alerts you control, saved for your whole team</li>
          </ul>
        </div>
      </div>
      <form className="login-card card" onSubmit={submit}>
        <h1>Sign in</h1>
        <p className="muted">Choose how you want to log in.</p>

        <div className="segment" role="tablist">
          {(['user', 'admin'] as Role[]).map(r => (
            <button type="button" key={r} role="tab" aria-selected={role === r}
              className={role === r ? 'active' : ''} onClick={() => pickRole(r)}>
              {r === 'admin' ? 'Admin' : 'User'}
            </button>
          ))}
        </div>
        <p className="muted small">
          {role === 'admin'
            ? 'Admins can set alert thresholds and manage the team and sensor nodes.'
            : 'Users can view plots, sensors, recommendations and reports.'}
        </p>

        <label>Email
          <input type="email" value={email} autoComplete="username" placeholder={DEMO_ACCOUNTS[role].id}
            onChange={e => { setEmail(e.target.value); setError(null) }} />
        </label>
        <label>Password
          <div className="pw">
            <input type={showPw ? 'text' : 'password'} value={password} autoComplete="current-password" placeholder="Password"
              onChange={e => { setPassword(e.target.value); setError(null) }} />
            <button type="button" className="link" onClick={() => setShowPw(s => !s)}>{showPw ? 'Hide' : 'Show'}</button>
          </div>
        </label>

        {error && <div className="form-error" role="alert">{error}</div>}

        <button className="btn solid wide" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : `Login as ${role === 'admin' ? 'Admin' : 'User'}`}
        </button>
        <button type="button" className="link center" onClick={fillDemo}>Use demo {role} credentials</button>
      </form>
    </div>
  )
}
