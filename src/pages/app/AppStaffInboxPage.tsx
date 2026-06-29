import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useWorkflow } from '../../lib/workflowStore'
import { can, officerProfiles, officerDisplayName, type StaffProfile } from '../../lib/roles'
import { GuardrailFooter } from '../../components/workflow/WorkflowUI'
import { formatDateTime } from '../../services/demoWorkflowService'
import { residentRowToCase } from '../../services/residentCaseBridge'
import { recommendOfficer, type RecommendationDriver } from '../../lib/officerRecommendation'
import {
  STATUS_LABELS,
  assignResidentRequestToOfficer,
  getResidentRequests,
  getResidentRequestAttachmentsForCases,
  type ResidentRequestAttachment,
  type ResidentRequestRow,
} from '../../services/residentRequests'
import {
  mapResidentToWorkRow,
  sortByReviewPriority,
  isActiveResident,
  needsOfficerAssignment,
  REVIEW_PRIORITY_EXPLAINER,
  REVIEW_PRIORITY_FACTORS,
  type WorkQueueRow,
  type ReviewPriorityTier,
} from '../../services/workQueue'
import { sanitizeResidentDescription } from '../../lib/residentDescription'
import ResidentAttachments from '../../components/app/ResidentAttachments'
import { DecisionLogicDisclosure, decisionLogicFromWorkRow } from '../../components/app/DecisionLogicPanel'

// Priority Queue — the active review surface staff land on first. Live resident
// service requests (public.resident_service_requests) that need staff action,
// grouped by where they sit in the workflow:
//   New      → intakes that still need an officer assignment
//   Active   → assigned / in progress
//   Closure  → field outcome recorded, ready for supervisor closure approval
//
// Closed historical cases and NYC open benchmark cases live in Intelligence
// Command (Case Explorer / Open Cases), not here. Review priority is
// deterministic decision support — the detail sits behind "How priority works".

type WorkTab = 'new' | 'active' | 'closure'

const WORK_TAB_LABELS: Record<WorkTab, string> = {
  new: 'New',
  active: 'Active',
  closure: 'Closure',
}

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
  const { ingestResidentCase, role } = useWorkflow()
  const navigate = useNavigate()

  const [resident, setResident] = useState<ResidentState>({ rows: [], loading: true, error: null })
  const [attachmentsByCase, setAttachmentsByCase] = useState<Record<string, ResidentRequestAttachment[]>>({})
  const [tab, setTab] = useState<WorkTab>('new')
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

  // New = intakes that still need an officer assignment.
  const residentNeedsAssignment = useMemo(
    () => residentActive.filter(needsOfficerAssignment),
    [residentActive],
  )

  const residentWorkRows = useMemo(
    () => residentActive.map((r) => mapResidentToWorkRow(r, attachmentsByCase[r.case_id]?.length ?? 0)),
    [residentActive, attachmentsByCase],
  )

  // Active = assigned / in progress. Closure = ready for closure review.
  const assignedInProgress = useMemo(
    () => sortByReviewPriority(residentWorkRows.filter((r) => r.in_progress)),
    [residentWorkRows],
  )
  const readyForClosure = useMemo(
    () => sortByReviewPriority(residentWorkRows.filter((r) => r.ready_for_closure)),
    [residentWorkRows],
  )

  const counts: Record<WorkTab, number> = useMemo(
    () => ({
      new: residentNeedsAssignment.length,
      active: assignedInProgress.length,
      closure: readyForClosure.length,
    }),
    [residentNeedsAssignment.length, assignedInProgress.length, readyForClosure.length],
  )

  const TAB_ORDER: WorkTab[] = ['new', 'active', 'closure']

  // Once loaded, land on the first tab that has items. Runs once; never overrides
  // a manual tab choice.
  const didInitTab = useRef(false)
  useEffect(() => {
    if (didInitTab.current) return
    if (resident.loading) return
    didInitTab.current = true
    const firstWithItems = TAB_ORDER.find((t) => counts[t] > 0)
    if (firstWithItems) setTab(firstWithItems)
    // TAB_ORDER is a stable module-level constant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resident.loading, counts])

  function openResidentCase(row: ResidentRequestRow) {
    ingestResidentCase(row)
    navigate(`/app/workbench?case=${encodeURIComponent(row.case_id)}`)
  }

  function openClosureReview(row: ResidentRequestRow) {
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
          <p className="mt-2 text-ink-muted">Cases that need staff review, assignment, or closure approval.</p>
        </div>
        <button onClick={load} className="btn-secondary text-sm py-2 px-4" disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div role="tablist" aria-label="Priority queue filters" className="mt-6 flex gap-8 border-b border-slate-200">
        {TAB_ORDER.map((t) => (
          <TabButton key={t} label={WORK_TAB_LABELS[t]} count={counts[t]} active={tab === t} onClick={() => setTab(t)} />
        ))}
      </div>

      <HowPriorityWorks />

      <div className="mt-6">
        {tab === 'new' ? (
          <ResidentIntakesView
            state={resident}
            rows={residentNeedsAssignment}
            attachmentsByCase={attachmentsByCase}
            canAssign={canAssign}
            assigningId={assigningId}
            onAssign={assignToOfficer}
            onOpen={openResidentCase}
            onOpenClosureReview={openClosureReview}
          />
        ) : (
          <NormalizedListView
            rows={tab === 'active' ? assignedInProgress : readyForClosure}
            loading={loading}
            residentError={resident.error}
            emptyLabel={
              tab === 'active' ? 'No active cases right now.' : 'No cases awaiting closure approval right now.'
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

/** A small, low-friction "How priority works" link near the tabs — the full
 *  decision-support explanation lives behind it, not in a hero card. */
function HowPriorityWorks() {
  return (
    <details className="group mt-3 text-xs">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-ink-subtle hover:text-navy-900">
        How priority works
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

/** Single state label per row — New / Assigned / Closure ready (active rows only). */
function workRowState(row: WorkQueueRow): { label: string; style: string } {
  if (row.ready_for_closure) return { label: 'Closure ready', style: STATUS_STYLES.in_review }
  if (row.in_progress) return { label: 'Assigned', style: STATUS_STYLES.assigned }
  return { label: 'New', style: STATUS_STYLES.received }
}

/**
 * A compact operational task card: case id + one state pill (+ a priority pill
 * only when High/Medium), complaint type · location as plain text, a single
 * primary action, and the rules-based "why" tucked behind a collapsed disclosure.
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
  const meta = [row.complaint_type, row.location].filter(Boolean).join(' · ') || 'Location not provided'
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Max two pills on mobile: state, plus priority only if High/Medium. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-navy-900">{row.case_id}</span>
            <span className={`badge ${state.style}`}>{state.label}</span>
            {showPriority && <span className={`badge ${TIER_STYLES[row.priority_tier]}`}>{row.priority_tier} priority</span>}
          </div>
          <div className="mt-1 truncate text-sm text-ink-muted">{meta}</div>
          {row.in_progress && row.assigned_to && (
            <div className="mt-0.5 text-xs text-ink-subtle">Officer: {row.assigned_to}</div>
          )}
        </div>
        <button
          onClick={isClosure ? onReviewClosure : onOpen}
          className="btn-primary shrink-0 text-sm py-1.5 px-3"
        >
          {isClosure ? 'Review closure' : 'Open case'}
        </button>
      </div>

      <DecisionLogicDisclosure data={decisionLogicFromWorkRow(row)} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Resident intakes view (rich workflow cards — unchanged experience)
// ---------------------------------------------------------------------------

function ResidentIntakesView({
  state,
  rows,
  attachmentsByCase,
  canAssign,
  assigningId,
  onAssign,
  onOpen,
  onOpenClosureReview,
}: {
  state: ResidentState
  rows: ResidentRequestRow[]
  attachmentsByCase: Record<string, ResidentRequestAttachment[]>
  canAssign: boolean
  assigningId: string | null
  onAssign: (row: ResidentRequestRow, officer: StaffProfile) => void
  onOpen: (row: ResidentRequestRow) => void
  onOpenClosureReview: (row: ResidentRequestRow) => void
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
            attachments={attachmentsByCase[row.case_id] ?? []}
            canAssign={canAssign}
            assigning={assigningId === row.case_id}
            onAssign={(officer) => onAssign(row, officer)}
            onOpen={() => onOpen(row)}
            onOpenClosureReview={() => onOpenClosureReview(row)}
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

function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number | null
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative shrink-0 pb-3 text-sm font-semibold transition ${
        active
          ? 'text-navy-900 after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-teal-600'
          : 'text-slate-500 hover:text-navy-900'
      }`}
    >
      {label}
      {count != null && <span className="ml-1 text-xs font-semibold text-teal-700">{count}</span>}
    </button>
  )
}

function InboxCard({
  row,
  attachments,
  canAssign,
  assigning,
  onAssign,
  onOpen,
  onOpenClosureReview,
}: {
  row: ResidentRequestRow
  attachments: ResidentRequestAttachment[]
  canAssign: boolean
  assigning: boolean
  onAssign: (officer: StaffProfile) => void
  onOpen: () => void
  onOpenClosureReview: () => void
}) {
  // Deterministic intake decision-support result for this submission. The intake
  // pipeline is deterministic (rule based), not an agentic dispatcher: it only
  // SUGGESTS a category, priority, routing recommendation, missing information,
  // and closure readiness. A human coordinator/supervisor still approves the
  // assignment below. Memoised so we don't re-run it on every render.
  const triageCase = useMemo(() => residentRowToCase(row), [row])
  const { triage, summary } = triageCase
  const priority = triage.recommendedPriority
  const missingInformation = triage.missingInformation
  const residentComplaint = sanitizeResidentDescription(row.description)

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-navy-900">{row.case_id}</span>
            <span className={`badge ${STATUS_STYLES[row.status]}`}>{STATUS_LABELS[row.status]}</span>
          </div>
          <div className="mt-1 text-sm text-ink-muted">
            {row.request_type} · {[row.location, row.city].filter(Boolean).join(', ')}
          </div>
        </div>
        <span className="shrink-0 text-xs text-ink-subtle tabular-nums">{formatDateTime(row.created_at)}</span>
      </div>

      {/* Assignment — supervisor/coordinator assigns the case to a Bylaw Officer.
          This is an explicit human assignment. The routing recommendation is
          decision support only and never dispatches an officer on its own. */}
      <AssignmentPanel
        row={row}
        canAssign={canAssign}
        assigning={assigning}
        onAssign={onAssign}
        routingRecommendation={triage.recommendedDepartment}
      />

      {/* Officer has recorded a field outcome — ready for supervisor closure review. */}
      {row.field_visit_completed && row.status !== 'closed' && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
          <div>
            <div className="flex items-center gap-2">
              <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                Ready for closure review
              </span>
            </div>
            <p className="mt-1 text-sm text-ink">
              Field outcome recorded by {row.assigned_officer_name ?? 'the assigned officer'}.
            </p>
          </div>
          <button onClick={onOpenClosureReview} className="btn-primary text-sm py-2 px-4">
            Open closure review →
          </button>
        </div>
      )}

      {/* Resident's own words — shown before, and above, the generated triage. */}
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Resident complaint</div>
        {residentComplaint ? (
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">{residentComplaint}</p>
        ) : (
          <p className="mt-2 text-sm italic text-ink-subtle">
            No resident description was provided for this older demo record.
          </p>
        )}
      </div>

      {/* Resident-uploaded photos / documents (private; viewed via signed URL). */}
      <ResidentAttachments caseId={row.case_id} attachments={attachments} variant="card" />

      {/* Decision support summary — generated from intake details, below the
          resident's complaint. Staff review required. */}
      <div className="mt-4 rounded-lg border border-accent-200 bg-accent-50/50 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-accent-800">Decision support summary</div>
        <p className="mt-2 text-sm leading-relaxed text-ink">{summary.plainLanguage}</p>

        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Detail label="Routing recommendation" value={triage.recommendedDepartment} />
          <Detail label="Classification" value={triage.category} />
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-subtle">Priority</dt>
            <dd className="mt-0.5">
              <span className={`badge ${PRIORITY_STYLES[priority] ?? 'bg-slate-100 text-slate-700'}`}>{priority}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-subtle">File readiness</dt>
            <dd className="mt-0.5 text-ink">
              {Math.round(triage.confidence * 100)}% · {triage.confidenceLevel}
            </dd>
          </div>
        </dl>

        <div className="mt-3">
          <div className="text-xs uppercase tracking-wide text-ink-subtle">Missing information</div>
          {missingInformation.length > 0 ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink">
              {missingInformation.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-0.5 text-sm text-ink">No missing intake information identified.</p>
          )}
        </div>

        <div className="mt-3">
          <div className="text-xs uppercase tracking-wide text-ink-subtle">Recommended next action</div>
          <p className="mt-0.5 text-sm text-navy-900">{summary.recommendedNextStep}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end">
        <button onClick={onOpen} className="btn-primary text-sm py-2 px-4">
          {row.status === 'closed' ? 'View closed case →' : 'Open case →'}
        </button>
      </div>
    </div>
  )
}

// Supervisor/coordinator assignment panel. A prominent block (not a thin row)
// with two clear states: before assignment it surfaces a deterministic,
// rules-based officer recommendation (the primary "Assign recommended officer"
// action) plus an explanation of WHY that officer was suggested, and an
// override dropdown to choose another officer; after assignment it shows the
// assigned officer, role, status, and the next step. The officer's account
// email is an implementation detail and is intentionally never shown. The
// recommendation is decision support only — staff approve every assignment.
function AssignmentPanel({
  row,
  canAssign,
  assigning,
  onAssign,
  routingRecommendation,
}: {
  row: ResidentRequestRow
  canAssign: boolean
  assigning: boolean
  onAssign: (officer: StaffProfile) => void
  routingRecommendation: string
}) {
  // Only a recorded officer name means the assignment actually completed. A row
  // can carry status 'assigned' with NO officer on file (an incomplete or stale
  // assignment) — that is not "assigned", it needs the supervisor to finish it.
  const assignedComplete = Boolean(row.assigned_officer_name)
  const assignmentIncomplete = !assignedComplete && row.status === 'assigned'
  // The assignable By-law Officers (Officer Qureshi, Officer Mann, Officer Ahmed,
  // Officer Oakley). Assignment stores the chosen officer's login email.
  const officers = officerProfiles()
  // Deterministic, rules-based recommendation for this submission. The top-scored
  // officer is the default assignee; Officer Qureshi is recommended only when his
  // score wins. Memoised so it doesn't re-run on every render.
  const recommendation = useMemo(() => recommendOfficer(row, officers), [row, officers])
  const recommendedOfficer = recommendation.recommended
  // The override dropdown starts on the recommended officer so "Choose another
  // officer" is an explicit, deliberate override of the recommendation.
  const [selectedEmail, setSelectedEmail] = useState(
    recommendedOfficer?.email ?? officers[0]?.email ?? '',
  )
  const selectedOfficer = officers.find((o) => o.email === selectedEmail) ?? recommendedOfficer ?? null
  const overridingRecommendation = Boolean(
    selectedOfficer && recommendedOfficer && selectedOfficer.email !== recommendedOfficer.email,
  )

  if (assignedComplete) {
    return (
      <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-indigo-500" />
          <span className="text-xs font-semibold uppercase tracking-wide text-indigo-800">Assignment</span>
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Detail label="Assigned officer" value={row.assigned_officer_name ?? 'the assigned officer'} />
          <Detail label="Role" value="Bylaw Officer" />
          <Detail label="Status" value="Assigned for field review" />
          <Detail label="Next step" value="Officer records field outcome" />
        </dl>
      </div>
    )
  }

  return (
    <div
      className={`mt-4 rounded-xl border p-4 ${
        assignmentIncomplete ? 'border-rose-200 bg-rose-50/60' : 'border-amber-200 bg-amber-50/60'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`inline-block h-2 w-2 rounded-full ${assignmentIncomplete ? 'bg-rose-500' : 'bg-amber-500'}`}
        />
        <span
          className={`text-xs font-semibold uppercase tracking-wide ${
            assignmentIncomplete ? 'text-rose-800' : 'text-amber-800'
          }`}
        >
          Assignment
        </span>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-subtle">Status</dt>
          <dd className={`mt-0.5 font-medium ${assignmentIncomplete ? 'text-rose-700' : 'text-amber-700'}`}>
            {assignmentIncomplete ? 'Assignment incomplete — select an officer again' : 'Human assignment required'}
          </dd>
        </div>
        <Detail label="Routing recommendation" value={routingRecommendation} />
      </dl>
      {assignmentIncomplete && (
        <p className="mt-2 text-[11px] text-rose-700">
          This case shows as assigned but has no officer on file. Select an officer to complete the assignment.
        </p>
      )}
      {canAssign && row.status !== 'closed' && recommendedOfficer && recommendation.recommendedScore && (
        <>
          {/* Why this officer — a transparent, rules-based recommendation. This is
              decision support; the supervisor still approves the assignment. */}
          <RecommendationExplanation
            officerName={recommendation.recommendedScore.name}
            total={recommendation.recommendedScore.total}
            rationale={recommendation.rationale}
            drivers={recommendation.recommendedScore.drivers}
          />

          {/* Primary action — assign the recommended officer. */}
          <div className="mt-3">
            <button
              onClick={() => onAssign(recommendedOfficer)}
              disabled={assigning}
              className="btn-primary text-sm py-2 px-4 disabled:opacity-60"
            >
              {assigning ? 'Assigning…' : 'Assign recommended officer'}
            </button>
            <p className="mt-1.5 text-[11px] text-ink-subtle">
              Recommendation only. Staff approve every assignment.
            </p>
          </div>

          {/* Override — choose another officer instead of the recommendation. */}
          <div className="mt-3 border-t border-amber-200/70 pt-3">
            <label
              htmlFor={`officer-override-${row.id}`}
              className="text-xs font-semibold uppercase tracking-wide text-ink-subtle"
            >
              Choose another officer
            </label>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <select
                id={`officer-override-${row.id}`}
                value={selectedEmail}
                onChange={(e) => setSelectedEmail(e.target.value)}
                disabled={assigning}
                aria-label="Choose another By-law Officer"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-navy-900 focus:border-accent-500 focus:outline-none disabled:bg-slate-50"
              >
                {officers.map((o) => {
                  const label = officerDisplayName(o)
                  return (
                    <option key={o.email} value={o.email}>
                      {o.email === recommendedOfficer.email ? `${label} (recommended)` : label}
                    </option>
                  )
                })}
              </select>
              <button
                onClick={() => selectedOfficer && onAssign(selectedOfficer)}
                disabled={assigning || !selectedOfficer || !overridingRecommendation}
                className="btn-secondary text-sm py-2 px-4 disabled:opacity-50"
              >
                {assigning
                  ? 'Assigning…'
                  : `Assign ${selectedOfficer ? officerDisplayName(selectedOfficer) : 'officer'} instead`}
              </button>
            </div>
          </div>
        </>
      )}
      {/* Fallback: no recommendation available (e.g. no assignable officers) but
          assignment is still possible — keep a basic officer picker. */}
      {canAssign && row.status !== 'closed' && !recommendedOfficer && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={selectedEmail}
            onChange={(e) => setSelectedEmail(e.target.value)}
            disabled={assigning}
            aria-label="Select By-law Officer"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-navy-900 focus:border-accent-500 focus:outline-none disabled:bg-slate-50"
          >
            {officers.map((o) => (
              <option key={o.email} value={o.email}>
                {officerDisplayName(o)}
              </option>
            ))}
          </select>
          <button
            onClick={() => selectedOfficer && onAssign(selectedOfficer)}
            disabled={assigning || !selectedOfficer}
            className="btn-primary text-sm py-2 px-4 disabled:opacity-60"
          >
            {assigning ? 'Assigning…' : `Assign to ${selectedOfficer ? officerDisplayName(selectedOfficer) : 'officer'}`}
          </button>
        </div>
      )}
    </div>
  )
}

// The recommendation panel — a compact, staff-facing summary: recommended
// officer, fit score, a one-line "why", and the five driver rows (short label +
// bar + short rationale). Intentionally free of technical/modelling language;
// the scoring method lives in code comments and technical docs, not on screen.
function RecommendationExplanation({
  officerName,
  total,
  rationale,
  drivers,
}: {
  officerName: string
  total: number
  rationale: string
  drivers: RecommendationDriver[]
}) {
  return (
    <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-teal-500" />
          <span className="text-xs font-semibold uppercase tracking-wide text-teal-800">
            Recommended officer
          </span>
        </div>
        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-teal-700 ring-1 ring-inset ring-teal-200 tabular-nums">
          Fit score {total}/100
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold text-navy-900">{officerName}</p>
      <p className="mt-1 text-xs text-ink-muted">
        <span className="font-medium text-ink">Why this officer:</span> {rationale}
      </p>
      <dl className="mt-3 space-y-2">
        {drivers.map((driver) => (
          <div key={driver.key} className="grid grid-cols-[10rem_1fr] items-center gap-x-3 gap-y-0.5">
            <dt className="text-xs font-medium text-ink-muted">{driver.label}</dt>
            <dd className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-teal-100">
                <div
                  className="h-full rounded-full bg-teal-500"
                  style={{ width: `${Math.max(0, Math.min(100, driver.score))}%` }}
                />
              </div>
              <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-ink-subtle">
                {Math.round(driver.score)}
              </span>
            </dd>
            <dd className="col-start-2 text-[11px] text-ink-subtle">{driver.detail}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 break-words text-ink">{value}</dd>
    </div>
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
