import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import Logo from './Logo'
import Footer from './Footer'
import { useAuth } from '../lib/auth'

// Authenticated app shell. Shows a focused staff header (Closure Workbench,
// Insights, Statistical Insights, Methodology, Sign out) instead of the public
// marketing nav. Closure Workbench is the primary staff landing page
// (attention-ranked review queue + staff ready packet). The broader consoles
// (Workflow, Dashboard, Toronto Ward Context) and individual cases stay
// available via direct URL (/app/workflow, /app/dashboard, /app/wards,
// /app/cases, /app/cases/:id) but are intentionally kept out of the top nav to
// keep the demo focused.
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
          <Link to="/app" className="flex items-center gap-2.5">
            <Logo className="h-7 w-7" />
            <div className="leading-tight">
              <div className="text-sm font-semibold text-navy-900">Proactive Enforcement Intelligence</div>
              <div className="text-[11px] text-ink-subtle">Authenticated staff workspace</div>
            </div>
          </Link>

          <nav className="hidden lg:flex items-center gap-2">
            <StaffLink to="/app" end>Home</StaffLink>
            <StaffLink to="/app/resident-intake">Resident Intake</StaffLink>
            <StaffLink to="/app/closure-review">Closure Review</StaffLink>
            <StaffLink to="/app/insights">Insights</StaffLink>
            <StaffLink to="/app/statistical-insights">Statistical Insights</StaffLink>
            <StaffLink to="/methodology">Methodology</StaffLink>
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
              <StaffLink to="/app" end onClick={() => setOpen(false)}>Home</StaffLink>
              <StaffLink to="/app/resident-intake" onClick={() => setOpen(false)}>Resident Intake</StaffLink>
              <StaffLink to="/app/closure-review" onClick={() => setOpen(false)}>Closure Review</StaffLink>
              <StaffLink to="/app/insights" onClick={() => setOpen(false)}>Insights</StaffLink>
              <StaffLink to="/app/statistical-insights" onClick={() => setOpen(false)}>Statistical Insights</StaffLink>
              <StaffLink to="/methodology" onClick={() => setOpen(false)}>Methodology</StaffLink>
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

function StaffLink({ to, children, onClick, end }: { to: string; children: React.ReactNode; onClick?: () => void; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
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
