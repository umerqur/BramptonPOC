import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useWorkflow } from '../../lib/workflowStore'
import { can, DEMO_OFFICER } from '../../lib/roles'
import { GuardrailFooter } from '../../components/workflow/WorkflowUI'
import { formatDateTime } from '../../services/demoWorkflowService'
import { residentRowToCase } from '../../services/residentCaseBridge'
import {
  STATUS_LABELS,
  assignResidentRequestToOfficer,
  getResidentRequests,
  getResidentRequestAttachmentsForCases,
  type ResidentRequestAttachment,
  type ResidentRequestRow,
  type ResidentStatus,
} from '../../services/residentRequests'
import ResidentAttachments from '../../components/app/ResidentAttachments'

// Work Queue — the page authenticated staff land on first. It lists active
// resident service requests from public.resident_service_requests and, for each
// one, shows a decision support summary (routing recommendation, priority,
// classification, file readiness) generated from the intake details so staff can
// scan what needs action. "Open case" brings the request into the Case Workbench.

type LoadState = {
  rows: ResidentRequestRow[]
  loading: boolean
  error: string | null
}

// The Work Queue is split into Open and Closed tabs. A case stays in Open while
// it moves through the active lifecycle (submitted → received → assigned →
// in_review) and leaves Open the moment it is closed, where it then appears in
// Closed.
const OPEN_STATUSES: ResidentStatus[] = ['submitted', 'received', 'assigned', 'in_review']
const CLOSED_STATUSES: ResidentStatus[] = ['closed']

type QueueTab = 'open' | 'closed'

const STATUS_STYLES: Record<ResidentStatus, string> = {
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

export default function AppStaffInboxPage() {
  const { ingestResidentCase, role } = useWorkflow()
  const navigate = useNavigate()
  const [state, setState] = useState<LoadState>({ rows: [], loading: true, error: null })
  const [tab, setTab] = useState<QueueTab>('open')
  // Attachments for the loaded cases, batched into one query and grouped by case.
  const [attachmentsByCase, setAttachmentsByCase] = useState<Record<string, ResidentRequestAttachment[]>>({})
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const canAssign = can(role, 'assignOfficer')

  const openRows = useMemo(() => state.rows.filter((r) => OPEN_STATUSES.includes(r.status)), [state.rows])
  const closedRows = useMemo(() => state.rows.filter((r) => CLOSED_STATUSES.includes(r.status)), [state.rows])
  const visibleRows = tab === 'open' ? openRows : closedRows

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }))
    setAttachmentsByCase({})
    getResidentRequests(100)
      .then((rows) => {
        setState({ rows, loading: false, error: null })
        // Load attachment metadata for these cases. Best-effort: a failure here
        // (e.g. the table not migrated yet) must never break the queue.
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
        setState({ rows: [], loading: false, error: sectionError(err) })
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function openCase(row: ResidentRequestRow) {
    ingestResidentCase(row)
    navigate(`/app/workbench?case=${encodeURIComponent(row.case_id)}`)
  }

  // Once the officer has recorded a field outcome, the supervisor opens closure
  // review for that case (the officer outcome is pulled into the closure draft).
  function openClosureReview(row: ResidentRequestRow) {
    ingestResidentCase(row)
    navigate(`/app/closure?case=${encodeURIComponent(row.case_id)}`)
  }

  // Supervisor/coordinator action: explicit human assignment to the By-law
  // Officer (never automated). Persisted to Supabase so the officer sees it.
  async function assignToOfficer(row: ResidentRequestRow) {
    setAssigningId(row.case_id)
    try {
      await assignResidentRequestToOfficer(row.case_id, { name: DEMO_OFFICER.name, email: DEMO_OFFICER.email })
      load()
    } catch (err) {
      console.error('Failed to assign case to officer:', err)
      setState((s) => ({ ...s, error: sectionError(err) }))
    } finally {
      setAssigningId(null)
    }
  }

  // By-law Officers do not see the citywide Work Queue — send them to their console.
  if (role === 'officer') return <Navigate to="/app/field" replace />

  return (
    <div className="container-page py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <div className="section-eyebrow">Staff workbench</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">Work Queue</h1>
          <p className="mt-2 text-ink-muted">
            Active resident service requests requiring staff review, officer assignment, field outcome, or closure
            approval.
          </p>
        </div>
        <button onClick={load} className="btn-secondary text-sm py-2 px-4" disabled={state.loading}>
          {state.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {!state.error && !state.loading && state.rows.length > 0 && (
        <div className="mt-8 flex gap-1 border-b border-slate-200">
          <TabButton label="Open" count={openRows.length} active={tab === 'open'} onClick={() => setTab('open')} />
          <TabButton label="Closed" count={closedRows.length} active={tab === 'closed'} onClick={() => setTab('closed')} />
        </div>
      )}

      <div className="mt-6">
        {state.error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
            <span className="font-semibold">Couldn’t load resident requests from Supabase.</span>{' '}
            <span className="text-rose-700">{state.error}</span>
          </div>
        ) : state.loading ? (
          <div className="card p-8 text-center text-sm text-ink-subtle">Loading the inbox…</div>
        ) : state.rows.length === 0 ? (
          <EmptyState />
        ) : visibleRows.length === 0 ? (
          <div className="card p-8 text-center text-sm text-ink-subtle">
            {tab === 'open' ? 'No open cases need staff action right now.' : 'No closed cases yet.'}
          </div>
        ) : (
          <ul className="space-y-4">
            {visibleRows.map((row) => (
              <li key={row.case_id}>
                <InboxCard
                  row={row}
                  attachments={attachmentsByCase[row.case_id] ?? []}
                  canAssign={canAssign}
                  assigning={assigningId === row.case_id}
                  onAssign={() => assignToOfficer(row)}
                  onOpen={() => openCase(row)}
                  onOpenClosureReview={() => openClosureReview(row)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <GuardrailFooter />
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
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
        active
          ? 'border-accent-600 text-navy-900'
          : 'border-transparent text-ink-subtle hover:text-navy-900'
      }`}
    >
      {label}
      <span
        className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${
          active ? 'bg-accent-100 text-accent-800' : 'bg-slate-100 text-slate-600'
        }`}
      >
        {count}
      </span>
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
  onAssign: () => void
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
  const residentComplaint = row.description?.trim()

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-navy-900">{row.case_id}</span>
            <span className={`badge ${STATUS_STYLES[row.status]}`}>{STATUS_LABELS[row.status]}</span>
            <span className="badge bg-slate-100 text-slate-700">{row.request_type}</span>
          </div>
          <div className="mt-1 text-sm text-ink-muted">
            {row.resident_name} · {[row.location, row.city].filter(Boolean).join(', ')}
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
              Field outcome recorded by {row.assigned_officer_name ?? 'Officer Oakley'}.
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
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-accent-800">Decision support summary</span>
          <span className="text-[11px] text-accent-700">Generated from intake details · Staff review required</span>
        </div>
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

        <p className="mt-3 text-[11px] text-accent-700">
          Suggestions only — a human coordinator or supervisor reviews and approves the assignment.
        </p>
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
// with two clear states: before assignment it shows the routing recommendation
// and a single role-based "Assign to Bylaw Officer" action; after assignment it
// shows the assigned officer, role, status, and the next step. The officer's
// account email is an implementation detail and is intentionally never shown.
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
  onAssign: () => void
  routingRecommendation: string
}) {
  const assigned = Boolean(row.assigned_officer_name)

  if (assigned) {
    return (
      <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-indigo-500" />
          <span className="text-xs font-semibold uppercase tracking-wide text-indigo-800">Assignment</span>
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Detail label="Assigned officer" value={row.assigned_officer_name ?? 'Officer Oakley'} />
          <Detail label="Role" value="Bylaw Officer" />
          <Detail label="Status" value="Assigned for field review" />
          <Detail label="Next step" value="Officer records field outcome" />
        </dl>
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex items-center gap-2">
        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-amber-500" />
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-800">Assignment</span>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-subtle">Status</dt>
          <dd className="mt-0.5 font-medium text-amber-700">Human assignment required</dd>
        </div>
        <Detail label="Routing recommendation" value={routingRecommendation} />
      </dl>
      <p className="mt-2 text-[11px] text-ink-subtle">
        Routing recommendation does not dispatch an officer automatically.
      </p>
      {canAssign && row.status !== 'closed' && (
        <div className="mt-3">
          <button onClick={onAssign} disabled={assigning} className="btn-primary text-sm py-2 px-4 disabled:opacity-60">
            {assigning ? 'Assigning…' : 'Assign to Bylaw Officer'}
          </button>
        </div>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
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
