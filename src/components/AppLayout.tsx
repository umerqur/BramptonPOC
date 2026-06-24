import { useCallback, useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import Logo from './Logo'
import Footer from './Footer'
import WorkflowRail from './app/WorkflowRail'
import { useAuth } from '../lib/auth'
import { useWorkflow, WorkflowProvider } from '../lib/workflowStore'
import { currentActorName, ROLE_DESCRIPTIONS, ROLE_LABELS, type StaffRole } from '../lib/roles'
import { getResidentRequests } from '../services/residentRequests'

// Authenticated app shell for the staff workflow. The top nav now depends on the
// signed-in user's role (derived from their email):
//   * Supervisor / coordinator — Work Queue + Insights (the full staff workflow).
//   * By-law Officer — Officer Field Console only (their assigned cases). No
//     citywide Work Queue, no supervisor Insights.
// The whole app is wrapped in WorkflowProvider so case + role state is shared
// across pages; the provider receives the signed-in email to set the role.

// A top-nav entry. `match` decides the active state from the current location so
// query-param routes (Stress Testing → /app/insights?tab=simulations) highlight
// distinctly from Insights (/app/insights). `showBadge` marks the single Priority
// entry that carries the live active-item count badge.
type NavItem = {
  to: string
  label: string
  icon: React.ReactNode
  match: (pathname: string, search: string) => boolean
  showBadge?: boolean
}

function tabParam(search: string): string | null {
  return new URLSearchParams(search).get('tab')
}

const SUPERVISOR_NAV: NavItem[] = [
  { to: '/app', label: 'Priority', icon: <PriorityIcon />, match: (p) => p === '/app', showBadge: true },
  {
    to: '/app/insights',
    label: 'Insights',
    icon: <IntelligenceIcon />,
    match: (p, s) => p === '/app/insights' && tabParam(s) !== 'simulations',
  },
  {
    to: '/app/insights?tab=simulations',
    label: 'Stress Testing',
    icon: <StressTestIcon />,
    match: (p, s) => p === '/app/insights' && tabParam(s) === 'simulations',
  },
]

const OFFICER_NAV: NavItem[] = [
  { to: '/app/field', label: 'Field Console', icon: <PriorityIcon />, match: (p) => p === '/app/field' },
]

// localStorage key for the count of active priority items the user has already
// seen. The Priority badge flashes only for the unseen delta (active − seen) and
// settles once the user opens Priority.
const PRIORITY_SEEN_KEY = 'brampton-priority-seen-count-v1'

function readSeenPriorityCount(): number {
  try {
    const v = Number(localStorage.getItem(PRIORITY_SEEN_KEY))
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch {
    return 0
  }
}

/**
 * Live count of active resident priority items — open resident service requests
 * (status !== 'closed') from public.resident_service_requests via the existing
 * getResidentRequests() service. Returns null until loaded or on failure, so the
 * badge simply stays hidden rather than showing a wrong number.
 */
function usePriorityActiveCount(enabled: boolean): number | null {
  const [active, setActive] = useState<number | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    getResidentRequests()
      .then((rows) => {
        if (live) setActive(rows.filter((r) => r.status !== 'closed').length)
      })
      .catch(() => {
        if (live) setActive(null)
      })
    return () => {
      live = false
    }
  }, [enabled])
  return active
}

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
  const { role, canSwitchRole, userEmail } = useWorkflow()
  const navigate = useNavigate()
  const location = useLocation()

  async function handleSignOut() {
    await signOut()
    navigate('/', { replace: true })
  }

  const email = session?.user?.email
  const nav = role === 'officer' ? OFFICER_NAV : SUPERVISOR_NAV

  // Priority badge: flash the unseen delta of active resident items, settle once
  // the user opens Priority. Only supervisors/CSR see the Priority entry.
  const showPriority = role !== 'officer'
  const activePriorityCount = usePriorityActiveCount(showPriority)
  const [seenPriorityCount, setSeenPriorityCount] = useState<number>(readSeenPriorityCount)
  const priorityDelta =
    activePriorityCount == null ? 0 : Math.max(0, activePriorityCount - seenPriorityCount)
  const markPrioritySeen = useCallback(() => {
    if (activePriorityCount == null) return
    setSeenPriorityCount(activePriorityCount)
    try {
      localStorage.setItem(PRIORITY_SEEN_KEY, String(activePriorityCount))
    } catch {
      /* ignore unavailable storage */
    }
  }, [activePriorityCount])

  // Re-keyed by the delta so the finite blink replays when a new delta appears.
  const priorityBadge =
    priorityDelta > 0 ? (
      <span
        key={priorityDelta}
        className="animate-demo-blink ml-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
        aria-label={`${priorityDelta} new priority item${priorityDelta === 1 ? '' : 's'}`}
      >
        {priorityDelta}
      </span>
    ) : null

  const roleName = currentActorName(userEmail, role)

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="sticky top-0 z-40 bg-white border-b-2 border-slate-300 shadow-sm">
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

          <nav className="hidden items-center gap-8 xl:flex">
            <div className="flex items-center gap-1.5">
              {nav.map((item) => (
                <StaffLink
                  key={item.to}
                  to={item.to}
                  icon={item.icon}
                  active={item.match(location.pathname, location.search)}
                  badge={item.showBadge ? priorityBadge : null}
                  onClick={item.showBadge ? markPrioritySeen : undefined}
                >
                  {item.label}
                </StaffLink>
              ))}
            </div>
            <div className="flex items-center gap-2 border-l border-slate-300 pl-6">
              {canSwitchRole && <RoleSwitcher />}
              <RoleBadge role={role} name={roleName} />
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
                <StaffLink
                  key={item.to}
                  to={item.to}
                  icon={item.icon}
                  active={item.match(location.pathname, location.search)}
                  badge={item.showBadge ? priorityBadge : null}
                  mobile
                  onClick={() => {
                    if (item.showBadge) markPrioritySeen()
                    setOpen(false)
                  }}
                >
                  {item.label}
                </StaffLink>
              ))}
              {canSwitchRole && (
                <div className="px-3 py-2">
                  <RoleSwitcher />
                </div>
              )}
              <span className="flex items-center gap-1.5 px-3 py-2 text-xs text-ink-subtle">
                {role === 'officer' && <ShieldIcon className="h-3.5 w-3.5 text-accent-600" />}
                <span className="font-semibold text-navy-900">{roleName}</span>
                {email ? <span>· {email}</span> : null}
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

// Persistent role identity badge — always shown in the nav (even when the user
// can switch roles), so the acting identity is unmistakable. For the By-law
// Officer role it shows the "By-law Officer [Name]" identity with a shield icon;
// supervisor/CSR keep their existing actor name (e.g. "Supervisor Qureshi").
function RoleBadge({ role, name }: { role: StaffRole; name: string }) {
  const isOfficer = role === 'officer'
  // currentActorName returns "Officer Qureshi" etc. for the officer role; present
  // it with the full "By-law Officer" prefix in the badge.
  const display = isOfficer ? name.replace(/^Officer\s+/, 'By-law Officer ') : name
  return (
    <span
      className={`ml-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${
        isOfficer
          ? 'bg-accent-50 text-accent-800 ring-accent-200'
          : 'bg-navy-50 text-navy-800 ring-navy-200'
      }`}
    >
      {isOfficer && <ShieldIcon className="h-3.5 w-3.5 text-accent-600" />}
      {display}
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

// Top-nav link — an operational command treatment: icon + label + optional count
// badge, with a clear active accent state. Active state is computed by the caller
// (so query-param routes like Stress Testing highlight distinctly) rather than by
// NavLink's pathname-only matching. On the white municipal header the active tab
// reads as a confident teal-tinted chip (light teal fill, teal border, navy text)
// rather than a washed-out underline.
//   * desktop — teal-bordered tinted chip under the active item.
//   * mobile  — left accent rule beside the active row in the dropdown.
function StaffLink({
  to,
  children,
  icon,
  badge,
  active,
  onClick,
  mobile = false,
}: {
  to: string
  children: React.ReactNode
  icon?: React.ReactNode
  badge?: React.ReactNode
  active: boolean
  onClick?: () => void
  mobile?: boolean
}) {
  if (mobile) {
    return (
      <Link
        to={to}
        onClick={onClick}
        className={`flex items-center gap-2 rounded-r-md border-l-[3px] px-3 py-2 text-sm font-semibold transition-colors ${
          active
            ? 'border-accent-600 bg-accent-50 text-navy-900'
            : 'border-transparent text-navy-700 hover:bg-slate-100 hover:text-navy-900'
        }`}
      >
        {icon && <span className="shrink-0">{icon}</span>}
        <span>{children}</span>
        {badge}
      </Link>
    )
  }
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-t-md border border-b-[3px] px-3 pb-1.5 pt-2 text-sm font-semibold transition-colors ${
        active
          ? 'border-accent-200 border-b-accent-600 bg-accent-50 text-navy-900 shadow-sm'
          : 'border-transparent text-navy-700 hover:bg-slate-100 hover:text-navy-900'
      }`}
    >
      {icon && <span className={`shrink-0 ${active ? 'text-accent-600' : 'text-navy-500'}`}>{icon}</span>}
      <span>{children}</span>
      {badge}
    </Link>
  )
}

// --- Inline nav icons (no external icon library) ---------------------------

/** Priority — a flag, signaling the active resident queue that needs attention. */
function PriorityIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4 21V4" />
      <path d="M4 4h12l-2 4 2 4H4" />
    </svg>
  )
}

/** Intelligence Command — an analytics / chart-grid mark. */
function IntelligenceIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 3v18h18" />
      <path d="M7 14l3-3 3 3 4-5" />
    </svg>
  )
}

/** Stress-Testing — a gauge / dial, evoking load and capacity testing. */
function StressTestIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 14a8 8 0 1 0-8-8" opacity="0" />
      <path d="M4 13a8 8 0 1 1 16 0" />
      <path d="M12 13l3-3" />
      <circle cx="12" cy="13" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** A small shield / municipal badge mark for the By-law Officer role badge. */
function ShieldIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 3l7 3v5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6l7-3Z" />
      <path d="M9.5 12l1.8 1.8L15 10" />
    </svg>
  )
}
