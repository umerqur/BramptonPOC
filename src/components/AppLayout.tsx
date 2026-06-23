import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import Logo from './Logo'
import Footer from './Footer'
import WorkflowRail from './app/WorkflowRail'
import { useAuth } from '../lib/auth'
import { useWorkflow, WorkflowProvider } from '../lib/workflowStore'
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type StaffRole } from '../lib/roles'

// Authenticated app shell for the staff workflow. The top nav now depends on the
// signed-in user's role (derived from their email):
//   * Supervisor / coordinator — Work Queue + Insights (the full staff workflow).
//   * By-law Officer — Officer Field Console only (their assigned cases). No
//     citywide Work Queue, no supervisor Insights.
// The whole app is wrapped in WorkflowProvider so case + role state is shared
// across pages; the provider receives the signed-in email to set the role.

type NavItem = { to: string; label: string; end?: boolean }

const SUPERVISOR_NAV: NavItem[] = [
  { to: '/app', label: 'Work Queue', end: true },
  { to: '/app/insights', label: 'Insights' },
]

const OFFICER_NAV: NavItem[] = [{ to: '/app/field', label: 'Field Console', end: true }]

export default function AppLayout() {
  const { session } = useAuth()
  const email = session?.user?.email ?? null
  return (
    <WorkflowProvider userEmail={email}>
      <AppShell />
    </WorkflowProvider>
  )
}

function AppShell() {
  const [open, setOpen] = useState(false)
  const { session, signOut } = useAuth()
  const { role, canSwitchRole } = useWorkflow()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/', { replace: true })
  }

  const email = session?.user?.email
  const nav = role === 'officer' ? OFFICER_NAV : SUPERVISOR_NAV

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="container-page flex h-16 items-center justify-between gap-4">
          <Link to={role === 'officer' ? '/app/field' : '/app'} className="flex items-center gap-2.5 shrink-0">
            <Logo className="h-7 w-7" />
            <div className="leading-tight">
              <div className="text-sm font-semibold text-navy-900">Proactive Enforcement Response</div>
              <div className="text-[11px] text-ink-subtle">
                {role === 'officer' ? 'Officer field console' : 'Staff work queue and operational insights'}
              </div>
            </div>
          </Link>

          <nav className="hidden items-center gap-5 xl:flex">
            <div className="flex items-center gap-5">
              {nav.map((item) => (
                <StaffLink key={item.to} to={item.to} end={item.end}>
                  {item.label}
                </StaffLink>
              ))}
            </div>
            <div className="flex items-center gap-2 border-l border-slate-200 pl-4">
              {canSwitchRole && <RoleSwitcher />}
              <RoleBadge role={role} canSwitchRole={canSwitchRole} />
              <button onClick={handleSignOut} className="btn-secondary text-sm py-2 px-4">
                Sign out
              </button>
            </div>
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
              {nav.map((item) => (
                <StaffLink key={item.to} to={item.to} end={item.end} mobile onClick={() => setOpen(false)}>
                  {item.label}
                </StaffLink>
              ))}
              {canSwitchRole && (
                <div className="px-3 py-2">
                  <RoleSwitcher />
                </div>
              )}
              <span className="px-3 py-2 text-xs text-ink-subtle">
                {ROLE_LABELS[role]}
                {email ? ` · ${email}` : ''}
              </span>
              <button onClick={handleSignOut} className="btn-secondary mt-2">Sign out</button>
            </div>
          </div>
        )}
      </header>

      <div className="flex flex-1">
        <WorkflowRail />
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
      <Footer />
    </div>
  )
}

// Shows the active role. For accounts that cannot switch (a real By-law Officer),
// this is the only role indicator; the "Acting as" selector is hidden for them.
function RoleBadge({ role, canSwitchRole }: { role: StaffRole; canSwitchRole: boolean }) {
  if (canSwitchRole) return null
  return (
    <span className="ml-1 inline-flex items-center rounded-full bg-navy-50 px-2.5 py-1 text-[11px] font-semibold text-navy-800 ring-1 ring-inset ring-navy-200">
      {ROLE_LABELS[role]}
    </span>
  )
}

// Acting-as role switcher. It renders ONLY the roles the signed-in user's staff
// profile allows — not every possible role. Umer, Balraj, and Ousmaan are
// allowed Supervisor + CSR + By-law Officer (each acting only as their own
// officer identity), so they can switch into officer; Yuri is supervisor/CSR
// only and never sees By-law Officer; an officer-only account (Officer Oakley)
// has a single allowed role, so the switcher is hidden entirely (canSwitchRole
// is false). This is staff-profile-based access control, not a free persona
// switcher.
function RoleSwitcher({ className = '' }: { className?: string }) {
  const { role, setRole, allowedRoles } = useWorkflow()
  return (
    <label className={`flex items-center gap-1.5 text-xs text-ink-subtle ${className}`}>
      <span className="hidden 2xl:inline whitespace-nowrap">Acting as</span>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as typeof role)}
        title={ROLE_DESCRIPTIONS[role]}
        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-navy-900 focus:border-accent-500 focus:outline-none"
      >
        {allowedRoles.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
    </label>
  )
}

// Top-nav link. Two clean, non-pill treatments that make the active page obvious:
//   * desktop — an underline tab (bottom accent rule under the active label).
//   * mobile  — a left accent rule beside the active row in the dropdown.
function StaffLink({
  to,
  children,
  onClick,
  end,
  mobile = false,
}: {
  to: string
  children: React.ReactNode
  onClick?: () => void
  end?: boolean
  mobile?: boolean
}) {
  if (mobile) {
    return (
      <NavLink
        to={to}
        end={end}
        onClick={onClick}
        className={({ isActive }) =>
          `block rounded-r-md border-l-[3px] px-3 py-2 text-sm font-semibold transition-colors ${
            isActive
              ? 'border-accent-500 bg-accent-50 text-navy-900'
              : 'border-transparent text-ink-muted hover:bg-slate-50 hover:text-navy-900'
          }`
        }
      >
        {children}
      </NavLink>
    )
  }
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `inline-flex items-center rounded-md border-b-2 px-2.5 pb-1.5 pt-2 text-sm font-semibold transition-colors ${
          isActive
            ? 'border-accent-500 bg-accent-50 text-navy-900'
            : 'border-transparent text-ink-muted hover:bg-slate-50 hover:text-navy-900'
        }`
      }
    >
      {children}
    </NavLink>
  )
}
