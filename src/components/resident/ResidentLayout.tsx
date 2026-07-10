import { Link, NavLink, Outlet } from 'react-router-dom'
import Logo from '../Logo'

// Public resident portal shell for the Resident Intake Demo. Intentionally
// distinct from both the marketing Header (staff sign-in) and the authenticated
// AppLayout, so the resident persona feels like a separate self-serve portal.
export default function ResidentLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="container-page flex h-16 items-center justify-between">
          <Link to="/resident" className="flex items-center gap-2.5">
            <Logo className="h-7 w-7" />
            <div className="leading-tight">
              <div className="text-sm font-semibold text-navy-900">Resident Services</div>
              <div className="text-[11px] text-ink-subtle">Proactive enforcement intake · Demo</div>
            </div>
          </Link>

          <nav className="flex items-center gap-2">
            <NavLink
              to="/resident"
              end
              className={({ isActive }) =>
                `px-3 py-2 rounded-md text-sm font-medium transition ${
                  isActive ? 'text-navy-900 bg-slate-100' : 'text-ink-muted hover:text-navy-900 hover:bg-slate-50'
                }`
              }
            >
              Check status
            </NavLink>
            <Link to="/resident/new-request" className="btn-primary text-sm py-2 px-4">
              File a complaint
            </Link>
            <Link
              to="/"
              className="hidden sm:inline-flex px-3 py-2 rounded-md text-sm font-medium text-ink-muted hover:text-navy-900 hover:bg-slate-50 transition"
            >
              Staff sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white mt-16">
        <div className="container-page py-6 text-xs text-ink-subtle flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Proactive Enforcement Response — Proof of Concept demo.</span>
          <span>Demo only. Do not enter real personal information.</span>
          <Link to="/" className="font-medium text-navy-900 hover:underline">
            City staff? Go to the main site to sign in →
          </Link>
        </div>
      </footer>
    </div>
  )
}
