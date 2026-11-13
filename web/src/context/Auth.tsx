import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, getAuthToken, setAuthToken, setUnauthorizedHandler } from '../api'

export type Role = 'admin' | 'user'
type User = { role: Role; displayName: string; title: string }

// Used only by the "Use demo credentials" button. They are real accounts in the server
// database (stored hashed); the website never checks passwords itself.
export const DEMO_ACCOUNTS: Record<Role, { id: string; password: string }> = {
  admin: { id: 'admin@terranova.farm', password: 'admin123' },
  user: { id: 'farmer@terranova.farm', password: 'farmer123' },
}

type AuthValue = {
  user: User | null
  /** true while an existing session is being re-checked after a page load */
  restoring: boolean
  login: (role: Role, email: string, password: string) => Promise<string | null>
  logout: () => void
  updateIdentity: (displayName: string, title: string) => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [restoring, setRestoring] = useState(() => !!getAuthToken())

  function logout() { setAuthToken(null); setUser(null) }

  useEffect(() => {
    setUnauthorizedHandler(logout)
    if (getAuthToken()) {
      api<{ user: User }>('GET', '/api/me')
        .then(r => setUser(r.user))
        .catch(() => setAuthToken(null))
        .finally(() => setRestoring(false))
    }
    return () => setUnauthorizedHandler(null)
  }, [])

  async function login(role: Role, email: string, password: string) {
    if (!email.trim() || !password) return 'Enter your email and password.'
    try {
      const res = await api<{ token: string; user: User }>('POST', '/api/auth/login', { email: email.trim(), password, role })
      setAuthToken(res.token)
      setUser(res.user)
      return null
    } catch (e) {
      return e instanceof ApiError ? e.message : 'Something went wrong. Try again.'
    }
  }

  const updateIdentity = (displayName: string, title: string) =>
    setUser(u => (u ? { ...u, displayName, title } : u))

  return <AuthContext.Provider value={{ user, restoring, login, logout, updateIdentity }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
