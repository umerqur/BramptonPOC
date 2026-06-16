import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import Logo from './Logo'
import Footer from './Footer'
import { useAuth } from '../lib/auth'
import { useWorkflow, WorkflowProvider } from '../lib/workflowStore'
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_OPTIONS } from '../lib/roles'

// Authenticated app shell for the staff workflow. Staff land on the Staff Inbox
// of real resident submissions, then work a case through the Case Workbench and
// Closure Review. Insights (the merged live dashboard + supervisor workflow-impact
// view) and the Audit Trail give oversight, and the POC Walkthrough (last) keeps
// the guided synthetic end-to-end narrative. Intake is resident-facing and is
// intentionally not a staff tab. The prior standalone consoles remain reachable
// via direct URL (/app/workflow, /app/wards, /app/cases, /app/legacy-insights,
// /app/resident-intake); /app/dashboard and /app/supervisor now redirect to
// /app/insights. The whole app is wrapped in WorkflowProvider so the case state
// is shared across pages.

// Primary staff navigation.
const NAV: { to: string; label: string; end?: boolean }[] = [
  { to: '/app', label: 'Staff Inbox', end: true },
  { to: '/app/workbench', label: 'Case Workbench' },
  { to: '/app/closure', label: 'Closure Review' },
  { to: '/app/insights', label: 'Insights' },
  { to: '/app/audit', label: 'Audit Trail' },
  { to: '/app/walkthrough', label: 'POC Walkthrough' },
]

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
    <WorkflowProvider>
      <div className="min-h-screen flex flex-col bg-slate-50">
        <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
          <div className="container-page flex h-16 items-center justify-between gap-4">
            <Link to="/app" className="flex items-center gap-2.5 shrink-0">
              <Logo className="h-7 w-7" />
              <div className="leading-tight">
                <div className="text-sm font-semibold text-navy-900">Proactive Enforcement Response</div>
                <div className="text-[11px] text-ink-subtle">AI-assisted closure workflow · POC</div>
              </div>
            </Link>

            <nav className="hidden xl:flex items-center gap-1">
              {NAV.map((item) => (
                <StaffLink key={item.to} to={item.to} end={item.end}>
                  {item.label}
                </StaffLink>
              ))}
              <RoleSwitcher className="ml-1" />
              <button onClick={handleSignOut} className="btn-secondary text-sm py-2 px-4 ml-1">
                Sign out
              </button>
            </nav>

            <button
              className="xl:hidden inline-flex items-center justify-center p-2 rounded-md text-ink-muted hover:text-navy-900 hover:bg-slate-100"
              onClick={() => setOpen((v) => !v)}
              aria-label="Toggle menu"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {open ? <path d="M18 6 6 18M6 6l12 12" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
              </svg>
            </button>
          </div>

          {open && (
            <div className="xl:hidden border-t border-slate-200 bg-white">
              <div className="container-page py-3 flex flex-col gap-1">
                {NAV.map((item) => (
                  <StaffLink key={item.to} to={item.to} end={item.end} onClick={() => setOpen(false)}>
                    {item.label}
                  </StaffLink>
                ))}
                <div className="px-3 py-2">
                  <RoleSwitcher />
                </div>
                {email && <span className="px-3 py-2 text-xs text-ink-subtle">{email}</span>}
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
    </WorkflowProvider>
  )
}

// Acting-as role switcher. The app sign-in has no real roles, so for the POC the
// reviewer picks which role they are acting as; this gates the workflow actions
// (assign to officer, record field visit, approve closure) across the app.
function RoleSwitcher({ className = '' }: { className?: string }) {
  const { role, setRole } = useWorkflow()
  return (
    <label className={`flex items-center gap-1.5 text-xs text-ink-subtle ${className}`}>
      <span className="hidden 2xl:inline whitespace-nowrap">Acting as</span>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as typeof role)}
        title={ROLE_DESCRIPTIONS[role]}
        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-navy-900 focus:border-accent-500 focus:outline-none"
      >
        {ROLE_OPTIONS.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
    </label>
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
