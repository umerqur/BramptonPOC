import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useWorkflow } from '../../lib/workflowStore'
import { can, officerProfiles, officerDisplayName, type StaffProfile } from '../../lib/roles'
import { GuardrailFooter } from '../../components/workflow/WorkflowUI'
import { formatDateTime } from '../../services/demoWorkflowService'
import { residentRowToCase } from '../../services/residentCaseBridge'
import { recommendOfficer } from '../../lib/officerRecommendation'
import {
  STATUS_LABELS,
  assignResidentRequestToOfficer,
  getResidentRequests,
  getResidentRequestAttachmentsForCases,
  markSupervisorSeen,
  type ResidentRequestAttachment,
  type ResidentRequestRow,
} from '../../services/residentRequests'
import {
  mapResidentToWorkRow,
  sortByReviewPriority,
  sortReadyForClosure,
  sortAllActiveWork,
  isActiveResident,
  needsOfficerAssignment,
  classifySupervisorBucket,
  REVIEW_PRIORITY_EXPLAINER,
  REVIEW_PRIORITY_FACTORS,
  type WorkQueueRow,
  type ReviewPriorityTier,
} from '../../services/workQueue'
import { QueueCard, DecisionStrip, Pill, FitPill } from '../../components/app/QueueCard'

// Priority Queue — the supervisor's review surface. Tabs are ordered left to
// right by supervisor-action priority, so the queue LEADS with "Ready to close"
// and lands there by default. Live resident service requests
// (public.resident_service_requests) grouped by where they sit in the workflow:
//   Ready to close → field outcome recorded, waiting for closure approval
//   New            → newly submitted intakes, not yet triaged or assigned
//   Active         → assigned, under review, waiting on officer action, investigating
//   All            → every active case, closure work surfaced on top
//
// "New" surfaces fresh resident intakes immediately on submission with a subtle
// pulsing badge. "Active" combines the old "Needs review" + "In progress" buckets
// into one being-worked group. Closed historical cases and NYC open benchmark
// cases live in Intelligence Command (Case Explorer / Open Cases), not here.
// Review priority is deterministic decision support — the detail sits behind
// "How the queue is sorted".
//
// Tabs render as a segmented control (grey track, solid navy active chip) so the
// four buckets read as obviously distinct, clickable filters. The "New" tab
// carries a persistent blinking alert while there are fresh intakes this
// supervisor has not viewed yet: which intakes have been seen is remembered
// per user in localStorage, so the alert survives sign-out/sign-in and only
// settles once the supervisor actually opens the New tab.

// localStorage key (namespaced per signed-in user) for the set of new-intake
// case ids the supervisor has already viewed on the New tab.
const NEW_INTAKE_SEEN_KEY = 'brampton-new-intakes-seen-v1'

function newIntakeSeenStorageKey(email: string | null): string {
  return email ? `${NEW_INTAKE_SEEN_KEY}:${email.trim().toLowerCase()}` : NEW_INTAKE_SEEN_KEY
}

function readSeenNewIntakes(email: string | null): Set<string> {
  try {
    const raw = window.localStorage.getItem(newIntakeSeenStorageKey(email))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

type WorkTab = 'closure' | 'new' | 'active' | 'all'

const WORK_TAB_LABELS: Record<WorkTab, string> = {
  closure: 'Ready to close',
  new: 'New',
  active: 'Active',
  all: 'All',
}

// Ordered by supervisor-action priority: closure approval is the most urgent
// supervisor-specific action, so it leads and is the default landing tab; then
// fresh intakes (New), then everything being worked (Active), then All.
const TAB_ORDER: WorkTab[] = ['closure', 'new', 'active', 'all']

const STATUS_STYLES: Record<string, string> = {
  submitted: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  received: 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200',
  assigned: 'bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200',
  in_review: 'bg-violet-50 text-violet-800 ring-1 ring-inset ring-violet-200',
  closed: 'bg-accent-50 text-accent-800 ring-1 ring-inset ring-accent-200',
}

const PRIORITY_STYLES: Record<string, string> = {
  P1: 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200',
  P2: 'bg-orange-50 text-orange-800 ring-1 ring-inset ring-orange-200',
  P3: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  P4: 'bg-slate-100 text-slate-700',
}

// Review-priority-tier badge styles (only High / Medium are shown on cards).
const TIER_STYLES: Record<ReviewPriorityTier, string> = {
  High: 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200',
  Medium: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  Low: 'bg-slate-100 text-slate-700',
  Unscored: 'bg-slate-100 text-slate-500',
}

type ResidentState = { rows: ResidentRequestRow[]; loading: boolean; error: string | null }

export default function AppStaffInboxPage() {
  const { ingestResidentCase, role, userEmail } = useWorkflow()
  const navigate = useNavigate()

  const [resident, setResident] = useState<ResidentState>({ rows: [], loading: true, error: null })
  const [attachmentsByCase, setAttachmentsByCase] = useState<Record<string, ResidentRequestAttachment[]>>({})
  // Supervisor lands on "Ready to close" by default — closure approval is the job.
  const [tab, setTab] = useState<WorkTab>('closure')
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const canAssign = can(role, 'assignOfficer')

  const load = useCallback(() => {
    setResident((s) => ({ ...s, loading: true, error: null }))
    setAttachmentsByCase({})
    getResidentRequests(100)
      .then((rows) => {
        setResident({ rows, loading: false, error: null })
        getResidentRequestAttachmentsForCases(rows.map((r) => r.case_id))
          .then((atts) => {
            const map: Record<string, ResidentRequestAttachment[]> = {}
            for (const a of atts) (map[a.case_id] ??= []).push(a)
            setAttachmentsByCase(map)
          })
          .catch((err: unknown) => {
            console.error('Failed to load resident attachments:', err)
            setAttachmentsByCase({})
          })
      })
      .catch((err: unknown) => {
        console.error('Failed to load resident requests:', err)
        setResident({ rows: [], loading: false, error: sectionError(err) })
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Active resident requests only — closed cases belong in Case Explorer.
  const residentActive = useMemo(() => resident.rows.filter(isActiveResident), [resident.rows])

  // New = newly submitted intakes that still need triage / officer assignment.
  // Rendered with the rich assign cards, so it works off the resident rows.
  const residentNeedsAssignment = useMemo(
    () => residentActive.filter(needsOfficerAssignment),
    [residentActive],
  )

  // Which new intakes THIS user has already viewed on the New tab — persisted in
  // localStorage per signed-in email, so the blinking "New" alert survives
  // sign-out/sign-in and only stops once the tab is actually opened.
  const [seenNewIds, setSeenNewIds] = useState<Set<string>>(() => readSeenNewIntakes(userEmail))
  useEffect(() => {
    setSeenNewIds(readSeenNewIntakes(userEmail))
  }, [userEmail])

  const unseenNewCount = useMemo(
    () => residentNeedsAssignment.filter((r) => !seenNewIds.has(r.case_id)).length,
    [residentNeedsAssignment, seenNewIds],
  )

  // Viewing the New tab with loaded data counts as "seeing" every intake in it —
  // persist that and stop the alert. Storing only the CURRENT new-intake ids also
  // prunes ids that have since been assigned/closed, so the set stays small.
  useEffect(() => {
    if (tab !== 'new' || resident.loading || resident.error) return
    setSeenNewIds((prev) => {
      const ids = residentNeedsAssignment.map((r) => r.case_id)
      if (ids.every((id) => prev.has(id))) return prev
      const next = new Set(ids)
      try {
        window.localStorage.setItem(newIntakeSeenStorageKey(userEmail), JSON.stringify([...next]))
      } catch {
        /* ignore unavailable storage — the alert just re-arms next visit */
      }
      return next
    })
  }, [tab, resident.loading, resident.error, residentNeedsAssignment, userEmail])

  const residentWorkRows = useMemo(
    () => residentActive.map((r) => mapResidentToWorkRow(r, attachmentsByCase[r.case_id]?.length ?? 0)),
    [residentActive, attachmentsByCase],
  )

  // Active = assigned / under review / being worked. Ready to close = field
  // outcome recorded, waiting on closure approval — sorted so unseen and
  // highest-priority closures surface first. All = every active case, closure
  // work on top. Buckets share one classifier (classifySupervisorBucket).
  const assignedInProgress = useMemo(
    () => sortByReviewPriority(residentWorkRows.filter((r) => classifySupervisorBucket(r) === 'active')),
    [residentWorkRows],
  )
  const readyForClosure = useMemo(
    () => sortReadyForClosure(residentWorkRows.filter((r) => classifySupervisorBucket(r) === 'closure')),
    [residentWorkRows],
  )
  const allWork = useMemo(() => sortAllActiveWork(residentWorkRows), [residentWorkRows])

  const counts: Record<WorkTab, number> = useMemo(
    () => ({
      closure: readyForClosure.length,
      new: residentNeedsAssignment.length,
      active: assignedInProgress.length,
      all: allWork.length,
    }),
    [readyForClosure.length, residentNeedsAssignment.length, assignedInProgress.length, allWork.length],
  )

  function openResidentCase(row: ResidentRequestRow) {
    ingestResidentCase(row)
    navigate(`/app/workbench?case=${encodeURIComponent(row.case_id)}`)
  }

  // Opening a ready-to-close case for closure review counts as the supervisor
  // "seeing" it — persist that (server-side) so the alert stops, then navigate.
  function openClosureReview(row: ResidentRequestRow) {
    if (!row.supervisor_seen_at) {
      void markSupervisorSeen(row.case_id).catch((err: unknown) =>
        console.error('Failed to mark closure case as seen:', err),
      )
    }
    ingestResidentCase(row)
    navigate(`/app/closure?case=${encodeURIComponent(row.case_id)}`)
  }

  // Supervisor/CSR action: explicit human assignment to a chosen By-law Officer
  // profile (never automated). Stores the officer display name + login email, so
  // only that signed-in officer can record the field outcome (assigned_officer_email).
  async function assignToOfficer(row: ResidentRequestRow, officer: StaffProfile) {
    setAssigningId(row.case_id)
    try {
      await assignResidentRequestToOfficer(row.case_id, {
        name: officerDisplayName(officer),
        email: officer.email,
      })
      load()
    } catch (err) {
      console.error('Failed to assign case to officer:', err)
      setResident((s) => ({ ...s, error: sectionError(err) }))
    } finally {
      setAssigningId(null)
    }
  }

  function openWorkRow(row: WorkQueueRow) {
    if (row.resident) openResidentCase(row.resident)
  }

  // By-law Officers do not see the citywide Work Queue — send them to their console.
  if (role === 'officer') return <Navigate to="/app/field" replace />

  const loading = resident.loading

  return (
    <div className="container-page py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <div className="section-eyebrow">Staff workbench</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">Priority Queue</h1>
          <p className="mt-2 text-ink-muted">Review closure approvals, new intakes, and active enforcement files.</p>
        </div>
        <button onClick={load} className="btn-secondary text-sm py-2 px-4" disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Segmented control: a grey track where every tab is visibly a button and
          the selected one is a solid navy chip — unmistakably distinct states. */}
      <div className="mt-6 overflow-x-auto">
        <div
          role="tablist"
          aria-label="Priority queue filters"
          className="inline-flex items-center gap-1 rounded-xl bg-slate-100 p-1 ring-1 ring-inset ring-slate-200"
        >
          {TAB_ORDER.map((t) => (
            <TabButton
              key={t}
              label={WORK_TAB_LABELS[t]}
              count={counts[t]}
              active={tab === t}
              alert={t === 'new' && unseenNewCount > 0}
              onClick={() => setTab(t)}
            />
          ))}
        </div>
      </div>

      <HowPriorityWorks />

      <div className="mt-6">
        {tab === 'new' ? (
          <ResidentIntakesView
            state={resident}
            rows={residentNeedsAssignment}
            canAssign={canAssign}
            assigningId={assigningId}
            onAssign={assignToOfficer}
            onOpen={openResidentCase}
          />
        ) : (
          <NormalizedListView
            rows={tab === 'active' ? assignedInProgress : tab === 'all' ? allWork : readyForClosure}
            loading={loading}
            residentError={resident.error}
            emptyLabel={
              tab === 'active'
                ? 'No active files right now.'
                : tab === 'all'
                  ? 'No cases in the queue right now.'
                  : 'No cases ready to close right now.'
            }
            onOpen={openWorkRow}
            onReviewClosure={(row) => row.resident && openClosureReview(row.resident)}
          />
        )}
      </div>

      <GuardrailFooter />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Review-priority explainer
// ---------------------------------------------------------------------------

/** A small, low-friction "How the queue is sorted" link near the tabs — the full
 *  decision-support explanation lives behind it, not in a hero card. */
function HowPriorityWorks() {
  return (
    <details className="group mt-3 text-xs">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-ink-subtle hover:text-navy-900">
        How the queue is sorted
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-3.5 w-3.5 transition-transform group-open:rotate-180">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="mt-2 max-w-2xl rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-ink-muted">
        <p className="leading-relaxed">{REVIEW_PRIORITY_EXPLAINER}</p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          {REVIEW_PRIORITY_FACTORS.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-ink-subtle">
          Decision support for review order — staff review and decide.
        </p>
      </div>
    </details>
  )
}

// ---------------------------------------------------------------------------
// Normalized cross-source list (All active work / Assigned / Ready for closure)
// ---------------------------------------------------------------------------

function NormalizedListView({
  rows,
  loading,
  residentError,
  emptyLabel,
  onOpen,
  onReviewClosure,
}: {
  rows: WorkQueueRow[]
  loading: boolean
  residentError: string | null
  emptyLabel: string
  onOpen: (row: WorkQueueRow) => void
  onReviewClosure: (row: WorkQueueRow) => void
}) {
  if (loading && rows.length === 0) {
    return <div className="card p-8 text-center text-sm text-ink-subtle">Loading the queue…</div>
  }
  return (
    <div className="space-y-4">
      {residentError && <SourceWarning label="resident requests" error={residentError} />}
      {rows.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-subtle">{emptyLabel}</div>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.key}>
              <WorkRowCard row={row} onOpen={() => onOpen(row)} onReviewClosure={() => onReviewClosure(row)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Single state label per row — New / Assigned / Closure ready (active rows only).
 *  Uses the shared supervisor-bucket classifier so the card label always matches
 *  the tab a row sits under. */
function workRowState(row: WorkQueueRow): { label: string; style: string } {
  switch (classifySupervisorBucket(row)) {
    case 'closure':
      return { label: 'Closure ready', style: STATUS_STYLES.in_review }
    case 'active':
      return { label: 'Assigned', style: STATUS_STYLES.assigned }
    default:
      return { label: 'New', style: STATUS_STYLES.received }
  }
}

/**
 * A compact operational task card on the shared queue-card standard: case id +
 * one state pill (+ a priority pill only when High/Medium), complaint type and
 * location, a readable decision strip naming what needs to happen next, and a
 * single primary action.
 */
function WorkRowCard({
  row,
  onOpen,
  onReviewClosure,
}: {
  row: WorkQueueRow
  onOpen: () => void
  onReviewClosure: () => void
}) {
  const state = workRowState(row)
  const showPriority = row.priority_tier === 'High' || row.priority_tier === 'Medium'
  const isClosure = row.ready_for_closure
  const isNew = classifySupervisorBucket(row) === 'new'
  const isUnseen = row.unseen_by_supervisor
  const decisionTone = isClosure ? 'emerald' : 'amber'
  const decisionText = isClosure
    ? 'Field outcome recorded · Ready for closure approval'
    : row.in_progress
      ? `Assigned${row.assigned_to ? ` to ${row.assigned_to}` : ''} · In progress`
      : 'Needs staff review'
  return (
    <QueueCard
      caseId={row.case_id}
      accent={isNew ? 'new' : undefined}
      pills={
        <>
          <Pill className={state.style}>{state.label}</Pill>
          {showPriority && <Pill className={TIER_STYLES[row.priority_tier]}>{row.priority_tier} priority</Pill>}
          {/* Unseen-by-supervisor alert — a small red pulsing badge, not a big
              animation. Stops once the supervisor opens / reviews the case. */}
          {isUnseen && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-600" />
              </span>
              New closure review
            </span>
          )}
        </>
      }
      title={row.complaint_type || 'Service request'}
      subtitle={row.location || 'Location not provided'}
      decision={<DecisionStrip tone={decisionTone}>{decisionText}</DecisionStrip>}
      actions={
        <button onClick={isClosure ? onReviewClosure : onOpen} className="btn-primary text-sm py-1.5 px-3">
          {isClosure ? 'Review closure' : 'Open case'}
        </button>
      }
    />
  )
}

// ---------------------------------------------------------------------------
// Resident intakes view (rich workflow cards — unchanged experience)
// ---------------------------------------------------------------------------

function ResidentIntakesView({
  state,
  rows,
  canAssign,
  assigningId,
  onAssign,
  onOpen,
}: {
  state: ResidentState
  rows: ResidentRequestRow[]
  canAssign: boolean
  assigningId: string | null
  onAssign: (row: ResidentRequestRow, officer: StaffProfile) => void
  onOpen: (row: ResidentRequestRow) => void
}) {
  if (state.error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
        <span className="font-semibold">Couldn’t load resident requests.</span>{' '}
        <span className="text-rose-700">{state.error}</span>
      </div>
    )
  }
  if (state.loading) {
    return <div className="card p-8 text-center text-sm text-ink-subtle">Loading resident intakes…</div>
  }
  if (rows.length === 0) {
    return <EmptyState />
  }
  return (
    <ul className="space-y-4">
      {rows.map((row) => (
        <li key={row.case_id}>
          <InboxCard
            row={row}
            canAssign={canAssign}
            assigning={assigningId === row.case_id}
            onAssign={(officer) => onAssign(row, officer)}
            onOpen={() => onOpen(row)}
          />
        </li>
      ))}
    </ul>
  )
}

function SourceWarning({ label, error }: { label: string; error: string }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-900">
      <span className="font-semibold">Couldn’t load {label}.</span> <span className="text-amber-800">{error}</span>
    </div>
  )
}

/**
 * One segment of the queue's segmented control. The selected tab is a solid navy
 * chip with white text; unselected tabs are quiet labels on the grey track that
 * lift to a white chip on hover — so each tab clearly reads as its own button.
 *
 * `alert` marks a tab holding work the user has not seen yet (the New tab with
 * fresh intakes): the segment glows with a looping red blink, the count badge
 * turns solid red, and a pinging dot sits on its corner. It keeps blinking until
 * the tab is opened — under reduced motion, the static red badge + dot remain.
 */
function TabButton({
  label,
  count,
  active,
  alert = false,
  onClick,
}: {
  label: string
  count: number | null
  active: boolean
  alert?: boolean
  onClick: () => void
}) {
  const showAlert = alert && !active
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
        active
          ? 'bg-navy-900 text-white shadow-sm'
          : 'text-navy-700 hover:bg-white hover:text-navy-900 hover:shadow-sm'
      } ${showAlert ? 'animate-queue-tab-alert' : ''}`}
    >
      {label}
      {count != null && (
        <span
          className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none tabular-nums ${
            active
              ? 'bg-white/20 text-white'
              : showAlert
                ? 'bg-rose-600 text-white'
                : 'bg-slate-200 text-slate-600'
          }`}
        >
          {count}
        </span>
      )}
      {showAlert && (
        <>
          <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-600" />
          </span>
          <span className="sr-only">— has new items you haven’t viewed</span>
        </>
      )}
    </button>
  )
}

// A compact intake row for the Supervisor Priority Queue. Same visual density as
// the By-law Officer Field Console / CSR queue: one white rectangle, case id and
// pills on top, complaint type · location under it, the recommended officer + fit
// score + one short reason on a single line, and small text-button actions. The
// heavy decision-support detail (resident complaint, missing information, score
// bars, full summary) lives in the case detail view behind "Open case".
//
// The assignment, recommended-officer, and fit-score LOGIC is unchanged — only
// the presentation is simplified. The recommendation is decision support; staff
// approve every assignment.
function InboxCard({
  row,
  canAssign,
  assigning,
  onAssign,
  onOpen,
}: {
  row: ResidentRequestRow
  canAssign: boolean
  assigning: boolean
  onAssign: (officer: StaffProfile) => void
  onOpen: () => void
}) {
  // Deterministic, rules-based intake triage + officer recommendation. Same
  // calculations as before — we just render a one-line summary instead of panels.
  const triage = useMemo(() => residentRowToCase(row).triage, [row])
  const priority = triage.recommendedPriority
  const routing = triage.recommendedDepartment

  const officers = useMemo(() => officerProfiles(), [])
  const recommendation = useMemo(() => recommendOfficer(row, officers), [row, officers])
  const recommendedOfficer = recommendation.recommended
  const fitScore = recommendation.recommendedScore?.total ?? null
  const reason = recommendation.rationale

  // "Change officer" reveals a single compact picker — not a large nested panel.
  const [changing, setChanging] = useState(false)
  const [selectedEmail, setSelectedEmail] = useState(recommendedOfficer?.email ?? officers[0]?.email ?? '')
  const selectedOfficer = officers.find((o) => o.email === selectedEmail) ?? recommendedOfficer ?? null

  const location = [row.location, row.city].filter(Boolean).join(', ') || 'Location not provided'

  return (
    <QueueCard
      caseId={row.case_id}
      accent="new"
      pills={
        <>
          <Pill className={STATUS_STYLES[row.status] ?? 'bg-slate-100 text-slate-700'}>
            {STATUS_LABELS[row.status]}
          </Pill>
          <Pill className={PRIORITY_STYLES[priority] ?? 'bg-slate-100 text-slate-700'}>{priority} priority</Pill>
        </>
      }
      date={formatDateTime(row.created_at)}
      title={row.request_type}
      subtitle={location}
      decision={
        // The decision row — the actual value of the supervisor queue. Readable
        // 13px text on a soft strip, never tiny muted text.
        <DecisionStrip tone="teal">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              Routing: <span className="font-semibold text-navy-900">{routing}</span>
            </span>
            {recommendedOfficer && (
              <>
                <span aria-hidden className="text-ink-subtle">
                  ·
                </span>
                <span>
                  Recommended:{' '}
                  <span className="font-semibold text-navy-900">{officerDisplayName(recommendedOfficer)}</span>
                </span>
                {fitScore != null && <FitPill score={fitScore} />}
              </>
            )}
          </div>
          {recommendedOfficer && reason && (
            <div className="mt-0.5">
              <span className="font-medium">Why:</span> {reason}
            </div>
          )}
        </DecisionStrip>
      }
      actions={
        <>
          {canAssign && recommendedOfficer && (
            <button
              onClick={() => onAssign(recommendedOfficer)}
              disabled={assigning}
              className="btn-primary text-sm py-1.5 px-3 disabled:opacity-60"
            >
              {assigning ? 'Assigning…' : 'Assign recommended'}
            </button>
          )}
          {canAssign && officers.length > 1 && (
            <button
              onClick={() => setChanging((v) => !v)}
              disabled={assigning}
              className="btn-secondary text-sm py-1.5 px-3"
              aria-expanded={changing}
            >
              Change officer
            </button>
          )}
          <button onClick={onOpen} className="btn-secondary text-sm py-1.5 px-3">
            Open case
          </button>

          {/* Compact officer picker — wraps to its own line when toggled. */}
          {changing && canAssign && (
            <div className="flex w-full flex-wrap items-center gap-2">
              <select
                value={selectedEmail}
                onChange={(e) => setSelectedEmail(e.target.value)}
                disabled={assigning}
                aria-label="Choose another By-law Officer"
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-navy-900 focus:border-accent-500 focus:outline-none disabled:bg-slate-50"
              >
                {officers.map((o) => (
                  <option key={o.email} value={o.email}>
                    {recommendedOfficer && o.email === recommendedOfficer.email
                      ? `${officerDisplayName(o)} (recommended)`
                      : officerDisplayName(o)}
                  </option>
                ))}
              </select>
              <button
                onClick={() => selectedOfficer && onAssign(selectedOfficer)}
                disabled={assigning || !selectedOfficer}
                className="btn-secondary text-sm py-1.5 px-3 disabled:opacity-50"
              >
                {assigning ? 'Assigning…' : `Assign ${selectedOfficer ? officerDisplayName(selectedOfficer) : 'officer'}`}
              </button>
            </div>
          )}
        </>
      }
      footer="Recommendation only. Staff approve every assignment."
    />
  )
}

function EmptyState() {
  return (
    <div className="card p-8 text-center">
      <h3 className="text-base font-semibold text-navy-900">No resident submissions yet</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
        Submit a demo complaint from the public resident form, then return here to review it as staff.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link to="/resident/new-request" className="btn-primary text-sm py-2 px-4">
          Open resident form
        </Link>
      </div>
    </div>
  )
}

function sectionError(err: unknown): string {
  if (err == null) return 'Unknown error'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>
    const parts = [e.message, e.details, e.hint, e.code].filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    )
    if (parts.length > 0) return parts.join(' — ')
  }
  return String(err)
}
