import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import Logo from './Logo'
import Footer from './Footer'
import { useAuth } from '../lib/auth'

// Authenticated app shell. Shows the staff header (Live Dashboard, Cases,
// Sign out) instead of the public marketing nav.
export default function AppLayout() {
  const [open, setOpen] = useState(false)
  const { session, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/', { replace: true })
  }

  const email = session?.user?.email

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="container-page flex h-16 items-center justify-between">
          <Link to="/app/dashboard" className="flex items-center gap-2.5">
            <Logo className="h-7 w-7" />
            <div className="leading-tight">
              <div className="text-sm font-semibold text-navy-900">Proactive Enforcement Intelligence</div>
              <div className="text-[11px] text-ink-subtle">Authenticated staff workspace</div>
            </div>
          </Link>

          <nav className="hidden lg:flex items-center gap-2">
            <StaffLink to="/app/workflow">Workflow</StaffLink>
            <StaffLink to="/app/dashboard">Dashboard</StaffLink>
            <StaffLink to="/app/cases">Cases</StaffLink>
            <StaffLink to="/app/wards">Ward Context</StaffLink>
            {email && <span className="ml-2 text-xs text-ink-subtle">{email}</span>}
            <button onClick={handleSignOut} className="btn-secondary text-sm py-2 px-4">
              Sign out
            </button>
          </nav>

          <button
            className="lg:hidden inline-flex items-center justify-center p-2 rounded-md text-ink-muted hover:text-navy-900 hover:bg-slate-100"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {open ? <path d="M18 6 6 18M6 6l12 12" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
            </svg>
          </button>
        </div>

        {open && (
          <div className="lg:hidden border-t border-slate-200 bg-white">
            <div className="container-page py-3 flex flex-col gap-1">
              <StaffLink to="/app/workflow" onClick={() => setOpen(false)}>Workflow</StaffLink>
              <StaffLink to="/app/dashboard" onClick={() => setOpen(false)}>Dashboard</StaffLink>
              <StaffLink to="/app/cases" onClick={() => setOpen(false)}>Cases</StaffLink>
              <StaffLink to="/app/wards" onClick={() => setOpen(false)}>Ward Context</StaffLink>
              <button onClick={handleSignOut} className="btn-secondary mt-2">Sign out</button>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}

function StaffLink({ to, children, onClick }: { to: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `px-3 py-2 rounded-md text-sm font-medium transition ${
          isActive ? 'text-navy-900 bg-slate-100' : 'text-ink-muted hover:text-navy-900 hover:bg-slate-50'
        }`
      }
    >
      {children}
    </NavLink>
  )
}
