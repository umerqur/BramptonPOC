import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useWorkflow } from '../../lib/workflowStore'
import { GuardrailFooter } from '../../components/workflow/WorkflowUI'
import { formatDateTime } from '../../services/demoWorkflowService'
import { residentRowToCase } from '../../services/residentCaseBridge'
import {
  STATUS_LABELS,
  getResidentRequests,
  getResidentRequestAttachmentsForCases,
  type ResidentRequestAttachment,
  type ResidentRequestRow,
  type ResidentStatus,
} from '../../services/residentRequests'
import ResidentAttachments from '../../components/app/ResidentAttachments'

// Staff Inbox — the page authenticated staff land on first. It lists the newest
// resident submissions from public.resident_service_requests and, for each one,
// shows a generated AI-style triage (department, priority, confidence,
// recommended next action) so staff can scan what needs attention. "Open case"
// bridges the resident row into the Case Workbench. This is the real
// resident → staff handoff; the POC Walkthrough keeps the synthetic narrative.

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
  const { ingestResidentCase } = useWorkflow()
  const navigate = useNavigate()
  const [state, setState] = useState<LoadState>({ rows: [], loading: true, error: null })
  const [tab, setTab] = useState<QueueTab>('open')
  // Attachments for the loaded cases, batched into one query and grouped by case.
  const [attachmentsByCase, setAttachmentsByCase] = useState<Record<string, ResidentRequestAttachment[]>>({})

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

  return (
    <div className="container-page py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <div className="section-eyebrow">Staff workbench</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">Work Queue</h1>
          <p className="mt-2 text-ink-muted">
            The service-request queue, with a generated AI triage to help you decide what to open first. Open a case to
            review the full workbench — every closure still needs staff approval.
          </p>
        </div>
        <button onClick={load} className="btn-secondary text-sm py-2 px-4" disabled={state.loading}>
          {state.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
        Demo data only. AI triage values are generated decision support — not automated enforcement.
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
            {tab === 'open' ? 'No open cases in the queue right now.' : 'No closed cases yet.'}
          </div>
        ) : (
          <ul className="space-y-4">
            {visibleRows.map((row) => (
              <li key={row.case_id}>
                <InboxCard
                  row={row}
                  attachments={attachmentsByCase[row.case_id] ?? []}
                  onOpen={() => openCase(row)}
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
  onOpen,
}: {
  row: ResidentRequestRow
  attachments: ResidentRequestAttachment[]
  onOpen: () => void
}) {
  // Deterministic generated triage from the row (placeholder for a real AI
  // result). Memoised so we don't re-run the workflow on every render.
  const triageCase = useMemo(() => residentRowToCase(row), [row])
  const { triage, summary } = triageCase
  const priority = triage.recommendedPriority
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

      {/* Generated AI triage — support only, below the resident's complaint. */}
      <div className="mt-4 rounded-lg border border-accent-200 bg-accent-50/50 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-accent-800">Decision support summary</span>
          <span className="text-[11px] text-accent-700">Generated · staff review required</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink">{summary.plainLanguage}</p>

        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Detail label="Recommended department" value={triage.recommendedDepartment} />
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
