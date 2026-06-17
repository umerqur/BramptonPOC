import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useWorkflow } from '../../lib/workflowStore'
import { can, DEMO_OFFICER } from '../../lib/roles'
import { GuardrailFooter } from '../../components/workflow/WorkflowUI'
import { formatDate, formatDateTime } from '../../services/demoWorkflowService'
import { residentRowToCase } from '../../services/residentCaseBridge'
import {
  STATUS_LABELS,
  assignResidentRequestToOfficer,
  getResidentRequests,
  getResidentRequestAttachmentsForCases,
  type ResidentRequestAttachment,
  type ResidentRequestRow,
} from '../../services/residentRequests'
import {
  loadOpenBenchmarkWorkRows,
  mapResidentToWorkRow,
  sortByReviewPriority,
  isActiveResident,
  REVIEW_PRIORITY_EXPLAINER,
  REVIEW_PRIORITY_FACTORS,
  type WorkQueueRow,
  type ReviewPriorityTier,
} from '../../services/workQueue'
import type { OpenReviewRow } from '../../services/caseExplorer'
import ResidentAttachments from '../../components/app/ResidentAttachments'

// Work Queue — the unified, active review surface staff land on first. It brings
// together two LIVE sources of active work, with clear source labels on every row:
//
//   * Resident intake — public.resident_service_requests (the app's intake form).
//   * NYC open benchmark — public.v_nyc_open_review_queue (the active open queue).
//
// Historical CLOSED NYC cases are NOT here — they live in the Insights Case
// Explorer. Insights Open Cases stays as analytics/drilldown; this is where the
// active review work happens.
//
// Review priority is deterministic decision support (age, due-date pressure, and
// historical workload/closure pressure) — never an automated enforcement
// decision, an AI decision, or a risk score. A human reviews and decides.

// The five Work Queue views.
type WorkTab = 'all' | 'resident' | 'open' | 'assigned' | 'closure'

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

// Source + review-priority-tier badge styles for the normalized rows.
const SOURCE_STYLES: Record<WorkQueueRow['source_type'], string> = {
  resident: 'bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200',
  nyc_open: 'bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-200',
}

const TIER_STYLES: Record<ReviewPriorityTier, string> = {
  High: 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200',
  Medium: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  Low: 'bg-slate-100 text-slate-700',
  Unscored: 'bg-slate-100 text-slate-500',
}

type ResidentState = { rows: ResidentRequestRow[]; loading: boolean; error: string | null }
type OpenState = { rows: WorkQueueRow[]; total: number; loading: boolean; error: string | null }

const OPEN_BENCHMARK_LIMIT = 50

export default function AppStaffInboxPage() {
  const { ingestResidentCase, role } = useWorkflow()
  const navigate = useNavigate()

  const [resident, setResident] = useState<ResidentState>({ rows: [], loading: true, error: null })
  const [open, setOpen] = useState<OpenState>({ rows: [], total: 0, loading: true, error: null })
  const [attachmentsByCase, setAttachmentsByCase] = useState<Record<string, ResidentRequestAttachment[]>>({})
  const [tab, setTab] = useState<WorkTab>('all')
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [drawerRow, setDrawerRow] = useState<OpenReviewRow | null>(null)
  const canAssign = can(role, 'assignOfficer')

  const load = useCallback(() => {
    // Resident intake requests + their attachment counts.
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

    // NYC open benchmark cases — graceful "not loaded" if the open view is absent.
    setOpen((s) => ({ ...s, loading: true, error: null }))
    loadOpenBenchmarkWorkRows(OPEN_BENCHMARK_LIMIT)
      .then(({ rows, total }) => setOpen({ rows, total, loading: false, error: null }))
      .catch((err: unknown) => {
        console.error('Failed to load NYC open benchmark cases:', err)
        setOpen({ rows: [], total: 0, loading: false, error: sectionError(err) })
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Active resident requests only — closed cases belong in Case Explorer, not the
  // active Work Queue.
  const residentActive = useMemo(() => resident.rows.filter(isActiveResident), [resident.rows])

  const residentWorkRows = useMemo(
    () => residentActive.map((r) => mapResidentToWorkRow(r, attachmentsByCase[r.case_id]?.length ?? 0)),
    [residentActive, attachmentsByCase],
  )

  const allActive = useMemo(
    () => sortByReviewPriority([...residentWorkRows, ...open.rows]),
    [residentWorkRows, open.rows],
  )
  const assignedInProgress = useMemo(
    () => sortByReviewPriority(residentWorkRows.filter((r) => r.in_progress)),
    [residentWorkRows],
  )
  const readyForClosure = useMemo(
    () => sortByReviewPriority(residentWorkRows.filter((r) => r.ready_for_closure)),
    [residentWorkRows],
  )

  function openResidentCase(row: ResidentRequestRow) {
    ingestResidentCase(row)
    navigate(`/app/workbench?case=${encodeURIComponent(row.case_id)}`)
  }

  function openClosureReview(row: ResidentRequestRow) {
    ingestResidentCase(row)
    navigate(`/app/closure?case=${encodeURIComponent(row.case_id)}`)
  }

  // Supervisor/coordinator action: explicit human assignment to the By-law
  // Officer (never automated).
  async function assignToOfficer(row: ResidentRequestRow) {
    setAssigningId(row.case_id)
    try {
      await assignResidentRequestToOfficer(row.case_id, { name: DEMO_OFFICER.name, email: DEMO_OFFICER.email })
      load()
    } catch (err) {
      console.error('Failed to assign case to officer:', err)
      setResident((s) => ({ ...s, error: sectionError(err) }))
    } finally {
      setAssigningId(null)
    }
  }

  // Open a normalized row: resident rows go into the workbench; NYC benchmark
  // rows open a read-only review drawer (deep analytics stay in Insights).
  function openWorkRow(row: WorkQueueRow) {
    if (row.source_type === 'resident' && row.resident) openResidentCase(row.resident)
    else if (row.source_type === 'nyc_open' && row.open) setDrawerRow(row.open)
  }

  // By-law Officers do not see the citywide Work Queue — send them to their console.
  if (role === 'officer') return <Navigate to="/app/field" replace />

  const loading = resident.loading || open.loading
  const counts: Record<WorkTab, number> = {
    all: allActive.length,
    resident: residentActive.length,
    open: open.rows.length,
    assigned: assignedInProgress.length,
    closure: readyForClosure.length,
  }

  return (
    <div className="container-page py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <div className="section-eyebrow">Staff workbench</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">Work Queue</h1>
          <p className="mt-2 text-ink-muted">
            Active work to review — resident intakes and NYC open benchmark cases in one place, ordered by review
            priority. Closed historical cases live in Insights Case Explorer.
          </p>
        </div>
        <button onClick={load} className="btn-secondary text-sm py-2 px-4" disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <ReviewPriorityNote />

      <div className="mt-6 flex flex-wrap gap-1 border-b border-slate-200">
        <TabButton label="All active work" count={counts.all} active={tab === 'all'} onClick={() => setTab('all')} />
        <TabButton label="Resident intakes" count={counts.resident} active={tab === 'resident'} onClick={() => setTab('resident')} />
        <TabButton
          label="Open benchmark cases"
          count={open.error ? null : counts.open}
          active={tab === 'open'}
          onClick={() => setTab('open')}
        />
        <TabButton label="Assigned / in progress" count={counts.assigned} active={tab === 'assigned'} onClick={() => setTab('assigned')} />
        <TabButton label="Ready for closure review" count={counts.closure} active={tab === 'closure'} onClick={() => setTab('closure')} />
      </div>

      <div className="mt-6">
        {tab === 'resident' ? (
          <ResidentIntakesView
            state={resident}
            rows={residentActive}
            attachmentsByCase={attachmentsByCase}
            canAssign={canAssign}
            assigningId={assigningId}
            onAssign={assignToOfficer}
            onOpen={openResidentCase}
            onOpenClosureReview={openClosureReview}
          />
        ) : tab === 'open' ? (
          <OpenBenchmarkView state={open} onView={(row) => row.open && setDrawerRow(row.open)} />
        ) : (
          <NormalizedListView
            header={
              tab === 'all' ? (
                <SourceMixSummary
                  residentIntakes={counts.resident}
                  openBenchmark={open.error ? null : counts.open}
                  assignedInProgress={counts.assigned}
                  readyForClosure={counts.closure}
                />
              ) : null
            }
            rows={tab === 'all' ? allActive : tab === 'assigned' ? assignedInProgress : readyForClosure}
            loading={loading}
            residentError={resident.error}
            openError={tab === 'all' ? open.error : null}
            emptyLabel={
              tab === 'all'
                ? 'No active work in the queue right now.'
                : tab === 'assigned'
                  ? 'No cases are assigned or under review right now.'
                  : 'No cases are ready for closure review right now.'
            }
            onOpen={openWorkRow}
            onOpenClosureReview={(row) => row.resident && openClosureReview(row.resident)}
          />
        )}
      </div>

      <OpenBenchmarkDrawer row={drawerRow} onClose={() => setDrawerRow(null)} />

      <GuardrailFooter />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Review-priority explainer
// ---------------------------------------------------------------------------

/** Collapsible note explaining review priority as decision support — not ML. */
function ReviewPriorityNote() {
  return (
    <details className="group mt-6 rounded-xl border border-slate-200 bg-slate-50/60">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3">
        <span className="flex items-center gap-2">
          <span className="badge bg-accent-50 text-accent-800 ring-1 ring-inset ring-accent-200">Review priority</span>
          <span className="text-sm text-ink-muted">How review priority works — decision support, not an automated decision.</span>
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle transition-transform group-open:rotate-180">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="border-t border-slate-200 px-4 py-3 text-sm text-ink">
        <p className="leading-relaxed">{REVIEW_PRIORITY_EXPLAINER}</p>
        <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-subtle">Considered factors</div>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink-muted">
          {REVIEW_PRIORITY_FACTORS.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-ink-subtle">
          Routing support for staffing and review order. Staff review and decide — this is not AI deciding, not automated
          enforcement, and not a risk score.
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
  openError,
  emptyLabel,
  header,
  onOpen,
  onOpenClosureReview,
}: {
  rows: WorkQueueRow[]
  loading: boolean
  residentError: string | null
  openError: string | null
  emptyLabel: string
  /** Optional summary rendered above the list (e.g. the All-active-work source mix). */
  header?: ReactNode
  onOpen: (row: WorkQueueRow) => void
  onOpenClosureReview: (row: WorkQueueRow) => void
}) {
  if (loading && rows.length === 0) {
    return <div className="card p-8 text-center text-sm text-ink-subtle">Loading the Work Queue…</div>
  }
  return (
    <div className="space-y-4">
      {header}
      {residentError && <SourceWarning label="resident intake requests" error={residentError} />}
      {openError && <SourceWarning label="NYC open benchmark cases" error={openError} />}
      {rows.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-subtle">{emptyLabel}</div>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.key}>
              <WorkRowCard row={row} onOpen={() => onOpen(row)} onOpenClosureReview={() => onOpenClosureReview(row)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * A compact operational read of what is in the All-active-work queue: where the
 * work came from (resident intakes, NYC open benchmark) and where it sits in the
 * resident workflow (assigned / in progress, ready for closure review). Plain
 * counts, no scoring — just an at-a-glance sense of the queue. The open-benchmark
 * count is null when that source failed to load, so it reads "—" rather than 0.
 */
function SourceMixSummary({
  residentIntakes,
  openBenchmark,
  assignedInProgress,
  readyForClosure,
}: {
  residentIntakes: number
  openBenchmark: number | null
  assignedInProgress: number
  readyForClosure: number
}) {
  const items: { label: string; value: number | null }[] = [
    { label: 'Resident intakes', value: residentIntakes },
    { label: 'NYC open benchmark', value: openBenchmark },
    { label: 'Assigned / in progress', value: assignedInProgress },
    { label: 'Ready for closure review', value: readyForClosure },
  ]
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">In the queue</div>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.label}>
            <dd className="text-xl font-semibold tabular-nums text-navy-900">{item.value == null ? '—' : item.value}</dd>
            <dt className="mt-0.5 text-xs text-ink-muted">{item.label}</dt>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** A compact, source-agnostic Work Queue row. */
function WorkRowCard({
  row,
  onOpen,
  onOpenClosureReview,
}: {
  row: WorkQueueRow
  onOpen: () => void
  onOpenClosureReview: () => void
}) {
  const isResident = row.source_type === 'resident'
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-navy-900">{row.case_id}</span>
            <span className={`badge ${SOURCE_STYLES[row.source_type]}`}>{row.source_label}</span>
            <span className="badge bg-slate-100 text-slate-700">{row.complaint_type ?? '—'}</span>
            <span className="badge bg-slate-100 text-slate-600">{row.status_label}</span>
          </div>
          <div className="mt-1 truncate text-sm text-ink-muted">{row.location ?? 'Location not provided'}</div>
        </div>
        <div className="shrink-0 text-right">
          <span className={`badge ${TIER_STYLES[row.priority_tier]}`}>
            {row.priority_tier === 'Unscored' ? 'Unscored' : `${row.priority_tier} priority`}
          </span>
          <div className="mt-1 text-[11px] tabular-nums text-ink-subtle">
            {row.priority_score == null ? '—' : `Score ${row.priority_score}`}
            {row.submitted_at ? ` · ${formatDate(row.submitted_at)}` : ''}
          </div>
        </div>
      </div>

      {row.priority_reason && (
        <p className="mt-2 text-xs text-ink-muted">
          <span className="font-medium text-ink">Why review:</span> {row.priority_reason}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] text-ink-subtle">
          {row.workflow_stage}
          {row.assigned_to ? ` · ${row.assigned_to}` : ''}
        </div>
        <div className="flex gap-2">
          {isResident && row.ready_for_closure && (
            <button onClick={onOpenClosureReview} className="btn-secondary text-sm py-1.5 px-3">
              Closure review →
            </button>
          )}
          <button onClick={onOpen} className="btn-primary text-sm py-1.5 px-3">
            {isResident ? 'Open case →' : 'View details'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Open benchmark view (normalized list, read-only review)
// ---------------------------------------------------------------------------

function OpenBenchmarkView({ state, onView }: { state: OpenState; onView: (row: WorkQueueRow) => void }) {
  if (state.loading && state.rows.length === 0) {
    return <div className="card p-8 text-center text-sm text-ink-subtle">Loading open benchmark cases…</div>
  }
  if (state.error) {
    return (
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-navy-900">Open benchmark queue not loaded</h3>
        <p className="mt-1 text-sm text-ink-muted">
          The active NYC open benchmark queue (review priority) is not available right now. Load the open dataset to
          review benchmark cases here.
        </p>
        <p className="mt-2 font-mono text-[11px] text-ink-subtle">{state.error}</p>
      </div>
    )
  }
  if (state.rows.length === 0) {
    return <div className="card p-8 text-center text-sm text-ink-subtle">No open benchmark cases available.</div>
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-subtle">
        <span>
          Showing the top {state.rows.length} of {state.total.toLocaleString()} open benchmark cases by review priority.
        </span>
        <Link to="/app/insights" className="font-medium text-accent-700 hover:text-accent-900">
          Open in Insights · Open Cases →
        </Link>
      </div>
      <ul className="space-y-3">
        {state.rows.map((row) => (
          <li key={row.key}>
            <WorkRowCard row={row} onOpen={() => onView(row)} onOpenClosureReview={() => {}} />
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// NYC open benchmark detail drawer (read-only review)
// ---------------------------------------------------------------------------

function OpenBenchmarkDrawer({ row, onClose }: { row: OpenReviewRow | null; onClose: () => void }) {
  useEffect(() => {
    if (!row) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [row, onClose])

  if (!row) return null

  const src = row.source
  const latLng =
    src.latitude != null && src.longitude != null ? `${src.latitude.toFixed(5)}, ${src.longitude.toFixed(5)}` : null
  const sourceRows: { label: string; value: string | null }[] = [
    { label: 'Source dataset ID / unique key', value: src.unique_key },
    { label: 'Location type', value: src.location_type },
    { label: 'ZIP', value: src.incident_zip },
    { label: 'Incident address', value: src.incident_address },
    { label: 'City', value: src.city },
    { label: 'Resolution description', value: src.resolution_description },
    { label: 'Latitude / longitude', value: latLng },
  ].filter((r) => r.value != null)

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-navy-900/40" role="dialog" aria-modal="true" aria-label={`Open benchmark case ${row.case_id}`} onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col overflow-hidden bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">NYC open benchmark case</div>
            <h3 className="truncate text-sm font-semibold text-navy-900">{row.case_id}</h3>
          </div>
          <button type="button" onClick={onClose} className="btn-secondary text-xs py-1.5 px-3">Close</button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          <dl className="space-y-2.5">
            <DrawerRow label="Submitted" value={row.submitted_at ? formatDate(row.submitted_at) : '—'} />
            <DrawerRow label="Status" value={row.status ?? '—'} />
            <DrawerRow label="Complaint type" value={row.complaint_type ?? '—'} />
            <DrawerRow label="Descriptor" value={row.descriptor ?? '—'} />
            <DrawerRow label="Agency" value={row.agency ?? '—'} />
            <DrawerRow label="Borough" value={row.borough ?? '—'} />
            <DrawerRow label="Council district" value={row.council_district ? String(Number(row.council_district)) : '—'} />
            <DrawerRow label="Location" value={row.address_or_location ?? '—'} />
            <DrawerRow label="Due date" value={row.due_date ? formatDate(row.due_date) : '—'} />
            <DrawerRow label="Age" value={row.age_days == null ? '—' : `${row.age_days} days`} />
          </dl>

          {/* Review priority — decision support, not an automated decision. */}
          <div className="rounded-lg border border-accent-200 bg-accent-50/50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-accent-800">Review priority</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <DrawerRow label="Score" value={row.priority_score == null ? '—' : row.priority_score.toFixed(0)} />
              <DrawerRow label="Tier" value={row.priority_tier ?? '—'} />
            </div>
            {row.priority_reason && <DrawerRow label="Reason" value={row.priority_reason} />}
            <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
              {REVIEW_PRIORITY_EXPLAINER} Decision support — staff review and decide.
            </p>
          </div>

          {sourceRows.length > 0 && (
            <details className="group rounded-lg border border-slate-200 bg-slate-50/60">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-navy-900">Source record details</span>
                  <span className="block text-[11px] text-ink-subtle">Public service request source data</span>
                </span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle transition-transform group-open:rotate-180">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </summary>
              <div className="border-t border-slate-200 px-3.5 py-3">
                <dl className="space-y-2.5">
                  {sourceRows.map((r) => (
                    <DrawerRow key={r.label} label={r.label} value={r.value as string} />
                  ))}
                </dl>
              </div>
            </details>
          )}
        </div>

        <div className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-ink-subtle">
          NYC open benchmark — analytics drilldown lives in Insights · Open Cases.
        </div>
      </div>
    </div>
  )
}

function DrawerRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{value}</dd>
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
  onAssign: (row: ResidentRequestRow) => void
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
            onAssign={() => onAssign(row)}
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
      onClick={onClick}
      className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
        active ? 'border-accent-600 text-navy-900' : 'border-transparent text-ink-subtle hover:text-navy-900'
      }`}
    >
      {label}
      {count != null && (
        <span
          className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${
            active ? 'bg-accent-100 text-accent-800' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {count}
        </span>
      )}
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
            <span className="badge bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200">Resident intake</span>
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
