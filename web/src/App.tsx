import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { AppProvider, useApp } from './context/App'
import { useAuth } from './context/Auth'
import { useTheme, type Theme } from './context/Theme'
import { Popover } from './components/ui'
import { initials, timeAgo } from './utils'
import Login from './pages/Login'
import AcceptInvite from './pages/AcceptInvite'
import Overview from './pages/Overview'
import PlotDetail from './pages/PlotDetail'
import Sensors from './pages/Sensors'
import Irrigation from './pages/Irrigation'
import Alerts from './pages/Alerts'
import Recommendations from './pages/Recommendations'
import Reports from './pages/Reports'
import Account from './pages/Account'
import Admin from './pages/Admin'

function NotificationBell() {
  const { openAlerts } = useApp()
  return (
    <Popover label={`Alerts (${openAlerts.length})`} button={<>🔔{openAlerts.length > 0 && <span className="count">{openAlerts.length}</span>}</>}>
      {close => (
        <>
          <div className="popover-title">Open alerts</div>
          {openAlerts.slice(0, 6).map(a => (
            <div key={a.id} className="popover-row"><b className={`${a.severity}-text`}>{a.severity === 'critical' ? 'Critical' : 'Watch'}</b> — {a.message}<div className="muted small">{timeAgo(a.openedAt)}</div></div>
          ))}
          {openAlerts.length === 0 && <div className="popover-row muted">No open alerts.</div>}
          <Link to="/alerts" onClick={close} className="small">{openAlerts.length > 6 ? `See all ${openAlerts.length} alerts →` : 'Open alert centre →'}</Link>
        </>
      )}
    </Popover>
  )
}

function ProfileMenu({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  const { user, logout } = useAuth()
  return (
    <Popover label="Account menu" button={<span className="avatar sm">{initials(user!.displayName)}</span>}>
      {close => (
        <>
          <div className="popover-title">{user!.displayName}</div>
          <div className="popover-row muted">{user!.title}</div>
          <span className={`badge ${user!.role === 'admin' ? 'watch' : 'optimal'}`}>{user!.role === 'admin' ? 'Admin account' : 'User account'}</span>
          <Link to="/account" onClick={close} className="menu-item">My account &amp; settings</Link>
          <button className="menu-item" onClick={toggleTheme}>{theme === 'dark' ? '☀️ Switch to light mode' : '🌙 Switch to dark mode'}</button>
          <button className="popover-logout" onClick={logout}>Log out</button>
        </>
      )}
    </Popover>
  )
}

function NavBar({ isAdmin, theme, toggleTheme }: { isAdmin: boolean; theme: Theme; toggleTheme: () => void }) {
  const { openAlerts } = useApp()
  const links: Array<[string, string]> = [['/overview', 'Overview'], ['/sensors', 'Sensors'], ['/irrigation', 'Irrigation'], ['/alerts', 'Alerts'], ['/recommendations', 'Recommendations'], ['/reports', 'Reports'], ...(isAdmin ? [['/admin', 'Admin'] as [string, string]] : [])]
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <NavLink to="/overview" className="brand">🌿 TerraNova</NavLink>
        <nav className="nav" aria-label="Main">
          {links.map(([to, label]) => (
            <NavLink key={to} to={to}>{label}{to === '/alerts' && openAlerts.length > 0 && <span className="nav-count">{openAlerts.length}</span>}</NavLink>
          ))}
        </nav>
        <div className="row gap"><NotificationBell /><ProfileMenu theme={theme} toggleTheme={toggleTheme} /></div>
      </div>
    </header>
  )
}

function Shell({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  const { user } = useAuth()
  const isAdmin = user!.role === 'admin'
  return (
    <AppProvider key={user!.role}>
      <a href="#main" className="skip">Skip to content</a>
      <NavBar isAdmin={isAdmin} theme={theme} toggleTheme={toggleTheme} />
      <main className="page" id="main">
        <Routes>
          <Route path="/overview" element={<Overview />} />
          <Route path="/plots/:id" element={<PlotDetail />} />
          <Route path="/sensors" element={<Sensors />} />
          <Route path="/irrigation" element={<Irrigation />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/recommendations" element={<Recommendations />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/account" element={<Account theme={theme} toggleTheme={toggleTheme} />} />
          <Route path="/admin" element={isAdmin ? <Navigate to="/admin/rules" replace /> : <Navigate to="/overview" replace />} />
          <Route path="/admin/:tab" element={isAdmin ? <Admin /> : <Navigate to="/overview" replace />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </main>
    </AppProvider>
  )
}

export default function App() {
  const { user, restoring } = useAuth()
  const [theme, toggleTheme] = useTheme()
  if (restoring) return <div className="center-screen"><div className="spinner" aria-label="Loading" /></div>
  if (!user) return <Routes><Route path="/accept" element={<AcceptInvite />} /><Route path="*" element={<Login />} /></Routes>
  return <Shell theme={theme} toggleTheme={toggleTheme} />
}
