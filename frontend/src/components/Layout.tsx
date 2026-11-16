import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useMatch } from 'react-router-dom'
import { useAuth } from '../auth'
import {
  IconAdmin,
  IconAnalysis,
  IconDashboard,
  IconMachines,
  IconQuality,
  IconReports,
} from './NavIcons'
import { AiChatbot } from './AiChatbot'
import { UserAvatar, Wordmark } from './Wordmark'

const links = [
  { to: '/', label: 'Daily Production', icon: IconDashboard },
  { to: '/machines', label: 'Machines', icon: IconMachines },
  { to: '/quality', label: 'Quality', icon: IconQuality },
  { to: '/analysis', label: 'Analysis', icon: IconAnalysis },
  { to: '/reports', label: 'Reports', icon: IconReports },
  { to: '/admin', label: 'Admin', icon: IconAdmin, roles: ['Administrator', 'Production Manager'] },
]

function resolveNav(pathname: string) {
  if (pathname.startsWith('/machines/')) {
    return { label: 'Station board', parent: 'Machines', parentTo: '/machines' }
  }
  const exact = links.find((l) => l.to === pathname)
  if (exact) return { label: exact.label, parent: null as string | null, parentTo: null as string | null }
  const partial = [...links].reverse().find((l) => l.to !== '/' && pathname.startsWith(l.to))
  return {
    label: partial?.label || 'Workspace',
    parent: null as string | null,
    parentTo: null as string | null,
  }
}

export function Layout() {
  const { user, logout } = useAuth()
  const role = user?.role_name || ''
  const location = useLocation()
  const onStation = Boolean(useMatch('/machines/:id'))
  const nav = resolveNav(location.pathname)
  const visibleLinks = links.filter((l) => !l.roles || l.roles.includes(role))
  const [clock, setClock] = useState(() => new Date())

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className={`app-shell${onStation ? ' is-station' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <Wordmark size="md" tone="dark" />
          <div className="brand-company">Tanui Plastic Plant</div>
          <div className="brand-sub">Production MES</div>
        </div>
        <nav className="nav-list" aria-label="Main">
          {visibleLinks.map((l) => {
            const Icon = l.icon
            return (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/'}
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                title={l.label}
              >
                <Icon className="nav-ico" />
                <span>{l.label}</span>
              </NavLink>
            )
          })}
        </nav>
      </aside>

      <div className="main">
        {!onStation ? (
          <header className="app-navbar">
            <div className="app-navbar-left">
              <div className="app-navbar-context-block">
                <span className="app-navbar-kicker">Tanui Plastic Plant</span>
                <span className="app-navbar-context">
                  {nav.parent && nav.parentTo ? (
                    <>
                      <NavLink to={nav.parentTo}>{nav.parent}</NavLink>
                      <span aria-hidden> / </span>
                    </>
                  ) : null}
                  <strong>{nav.label}</strong>
                </span>
              </div>
            </div>

            <div className="app-navbar-right">
              <span className="live-pill">LIVE</span>
              <span className="app-navbar-clock">
                {clock.toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
              <div className="app-navbar-user">
                <UserAvatar name={user?.name} />
                <div className="user-meta">
                  <div className="user-name">{user?.name}</div>
                  <div className="user-role">{user?.role_name}</div>
                </div>
              </div>
              <button className="btn btn-ghost btn-compact" onClick={logout} type="button">
                Sign out
              </button>
            </div>
          </header>
        ) : null}

        <div className="main-body">
          <Outlet />
        </div>
      </div>
      {!onStation ? <AiChatbot /> : null}
    </div>
  )
}
