import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getUnifiedNycCaseDetail, type UnifiedNycCaseDetail } from '../../services/caseExplorer'
import { buildCasePriorityContext } from '../../services/benchmarks'
import { getSyntheticPatrolLogs, type SyntheticPatrolLog } from '../../services/syntheticPatrol'
import BackButton from '../../components/app/BackButton'

// Full NYC 311 case page (replaces the old side drawer). Reads one case by id
// from the unified detail reader, which resolves it from EITHER the historical
// NYC 311 history (public.municipal_complaints) or the active open review queue
// (public.v_nyc_open_review_queue). Live source data only — every field shown
// comes verbatim from the public 311 source record. We never invent a resident
// narrative: if the source record carries no descriptor, the field reads "—".
// Decision support only — staff review and decide; nothing here is automated
// enforcement, risk prediction, or an officer replacement.

export default function AppNycCasePage() {
  const { caseId } = useParams<{ caseId: string }>()
  const [detail, setDetail] = useState<UnifiedNycCaseDetail | null | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    if (!caseId) {
      setDetail(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    getUnifiedNycCaseDetail(caseId)
      .then((data) => {
        if (!active) return
        setDetail(data)
        setError(null)
      })
      .catch((err: unknown) => {
        console.error('Failed to load NYC case detail:', err)
        if (active) {
          setDetail(null)
          setError(errorMessage(err))
        }
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [caseId, reloadKey])

  const handleRetry = useCallback(() => setReloadKey((k) => k + 1), [])

  if (loading) {
    return <div className="container-page py-16 text-center text-ink-subtle">Loading case…</div>
  }
  if (error) {
    return <CaseLoadError id={caseId} message={error} onRetry={handleRetry} />
  }
  if (!detail) {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="text-2xl font-semibold text-navy-900">Case not found</h1>
        <p className="mt-2 text-ink-muted">
          No NYC 311 record with case ID <span className="font-mono">{caseId}</span>.
        </p>
        <Link to="/app/insights" className="mt-6 inline-block btn-primary">
          Back to Insights
        </Link>
      </div>
    )
  }

  return <NycCaseDetailView detail={detail} />
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

function NycCaseDetailView({ detail }: { detail: UnifiedNycCaseDetail }) {
  const isOpen = detail.sourceType === 'open_review'
  const sourceLabel = isOpen ? 'Open review queue' : 'Historical NYC 311 record'
  const agency = detail.agency_name || detail.agency || detail.assigned_department || '—'
  const requestDetail = joinParts([detail.request_detail, detail.request_detail_2]) ?? '—'
  const closure = closureDurationDays(detail.submitted_at, detail.closed_at)
  // A case is closed when the source record carries a closure timestamp OR the
  // status is terminal — NOT based on which source view it came from. The open
  // review queue can still hold Closed cases, so sourceType must not drive this.
  const isClosed = !!detail.closed_at || isTerminalStatus(detail.status)
  // Plain-language, case-level priority explanation (open cases only).
  const priorityContext = isClosed ? null : buildCasePriorityContext(detail.age_days)
  const coordinates = fmtCoordinates(detail.source.latitude, detail.source.longitude)
  const crossStreets = joinParts([
    detail.source.cross_street_1,
    detail.source.cross_street_2,
    detail.source.intersection_street_1,
    detail.source.intersection_street_2,
  ])

  return (
    <div className="container-page py-10">
      {/* Header */}
      {/* Back returns to the exact previous screen (officer case, workbench,
          explorer…) with its scroll context; deep links fall back to Insights. */}
      <BackButton fallback="/app/insights" label="Back" />
      <div className="mt-3 text-xs text-ink-subtle">
        <Link to="/app/insights" className="link-quiet">
          Insights
        </Link>
        <span className="mx-2">/</span>
        <span className="font-mono">{detail.case_id}</span>
      </div>

      <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">{detail.case_id}</h1>
            <SourceTypeBadge open={isOpen} label={sourceLabel} />
            {detail.status && <span className="badge bg-navy-900/5 text-navy-900">{detail.status}</span>}
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            {joinParts([detail.complaint_type, detail.borough, detail.address_or_location]) ?? 'NYC 311 service request'}
          </p>
        </div>
      </div>

      {/* Provenance / advisory */}
      <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50/60 px-4 py-3 text-xs leading-relaxed text-sky-900">
        Public 311 source record from the New York City 311 service request benchmark (Source data). Decision support
        only — authorized staff review and decide. {isOpen ? 'Review priority is a transparent ranking aid, not an automated decision.' : ''}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* Left / main column */}
        <div className="space-y-6 lg:col-span-2">
          {/* Case summary */}
          <Card title="Case summary">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="Case ID" value={detail.case_id} mono />
              <Field label="Source dataset ID" value={detail.source_dataset_id} mono />
              <Field label="Source" value={sourceLabel} />
              <Field label="Status" value={detail.status} />
              <Field label="Complaint type" value={detail.complaint_type} />
              <Field label="Submitted" value={fmtDateTime(detail.submitted_at)} />
              <Field label="Source channel" value={detail.source_channel} />
            </dl>
          </Card>

          {/* Complaint source details — verbatim public 311 fields, never a fabricated narrative. */}
          <Card title="Complaint source details" hint="Public 311 source record">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="Complaint type" value={detail.complaint_type} />
              <Field label="Request detail" value={requestDetail} className="sm:col-span-2" />
            </dl>
            <p className="mt-4 text-[11px] leading-relaxed text-ink-subtle">
              These are the original source fields recorded in the public NYC 311 service request. No resident narrative
              is shown unless the source record contains one.
            </p>
          </Card>

          {/* Location and agency */}
          <Card title="Location and agency">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="Location" value={detail.address_or_location} className="sm:col-span-2" />
              <Field label="Cross streets" value={crossStreets} className="sm:col-span-2" />
              <Field label="Location type" value={detail.source.location_type} />
              <Field label="Address type" value={detail.source.address_type} />
              <Field label="City" value={detail.source.city} />
              <Field label="ZIP" value={detail.source.incident_zip} />
              <Field label="Borough" value={detail.borough} />
              <Field label="Council district" value={fmtDistrict(detail.council_district)} />
              <Field label="Coordinates" value={coordinates} mono />
              <Field label="Agency" value={agency} />
              <Field label="Agency code" value={detail.agency} />
              <Field label="Assigned department" value={detail.assigned_department} />
            </dl>
          </Card>

          {/* NYC source response — only when the source record carries a response
              text or an action-update date. resolution_description is NOT a
              reliable closure indicator in the open NYC dataset (most OPEN cases
              also carry one), so it is framed as a source response / agency
              update — never as closure evidence. The terminal/closed branch
              below frames it as the final source response and shows the closed
              date; closure of a POC workflow case is tracked separately. */}
          {(detail.resolution_description || detail.source.resolution_action_updated_date) &&
            (isClosed ? (
              <Card title="Closure outcome">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <Field
                    label="Final source response"
                    value={detail.resolution_description}
                    className="sm:col-span-2"
                  />
                  <Field
                    label="Closed date"
                    value={
                      detail.closed_at
                        ? fmtDateTime(detail.closed_at)
                        : 'Closed date not provided by source record.'
                    }
                  />
                  <Field
                    label="Resolution action updated"
                    value={fmtDateTime(detail.source.resolution_action_updated_date)}
                  />
                </dl>
              </Card>
            ) : (
              <Card title="NYC source response">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <Field
                    label="Source response text"
                    value={detail.resolution_description}
                    className="sm:col-span-2"
                  />
                  <Field
                    label="Resolution action updated"
                    value={fmtDateTime(detail.source.resolution_action_updated_date)}
                  />
                </dl>
                <p className="mt-4 text-[11px] leading-relaxed text-ink-subtle">
                  This is the public response or agency update from the NYC 311 source record. It does not mean the case
                  is closed.
                </p>
              </Card>
            ))}

          {/* Synthetic patrol activity — simulated field timeline, clearly
              labelled as NOT Brampton patrol history. */}
          <SyntheticPatrolTimeline caseId={detail.case_id} />
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Review priority — open review queue only. */}
          {isOpen && (
            <Card title="Review priority" hint="internal decision support">
              <dl className="space-y-3 text-sm">
                <Field label="Priority score" value={detail.priority_score == null ? null : detail.priority_score.toFixed(0)} />
                <Field label="Priority tier" value={detail.priority_tier} />
                <Field label="Priority reason" value={detail.priority_reason} />
              </dl>
              {priorityContext && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-800">Why this is prioritized</div>
                  <ul className="mt-1 space-y-0.5 text-xs leading-relaxed text-amber-900">
                    {priorityContext.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="mt-4 text-[11px] leading-relaxed text-ink-subtle">
                Review priority is an internal ranking we compute to help staff decide what to look at first — it is{' '}
                <span className="font-semibold">not</span> a field from the NYC 311 source record. It is not an automated
                decision, risk prediction, or enforcement action.
              </p>
            </Card>
          )}

          {/* Timeline — open vs. closed is decided by closure date / terminal
              status, never by which source view the case came from. */}
          <Card title="Timeline">
            <dl className="space-y-3 text-sm">
              <Field label="Submitted" value={fmtDateTime(detail.submitted_at)} />
              {isClosed ? (
                <>
                  <Field label="Closed" value={fmtDateTime(detail.closed_at)} />
                  <Field label="Closure duration" value={closure == null ? null : `${closure} days`} />
                </>
              ) : (
                <>
                  <Field label="Due date" value={fmtDateTime(detail.due_date)} />
                  <Field label="Age" value={detail.age_days == null ? null : `${detail.age_days} days open`} />
                </>
              )}
            </dl>
          </Card>
        </div>

        {/* Raw source record — full transparency, collapsed by default. */}
        <div className="lg:col-span-3">
          <RawSourceRecord raw={detail.raw} />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Synthetic patrol activity timeline
// ---------------------------------------------------------------------------

type PatrolState = { logs: SyntheticPatrolLog[] | null; loading: boolean; error: string | null }

/** Load synthetic patrol logs for a case. Distinguishes loading / loaded / error. */
function useSyntheticPatrolLogs(caseId: string): PatrolState {
  const [state, setState] = useState<PatrolState>({ logs: null, loading: true, error: null })
  useEffect(() => {
    let active = true
    setState({ logs: null, loading: true, error: null })
    getSyntheticPatrolLogs(caseId)
      .then((logs) => active && setState({ logs, loading: false, error: null }))
      .catch((err: unknown) => {
        console.error('Failed to load synthetic patrol logs:', err)
        if (active) setState({ logs: null, loading: false, error: errorMessage(err) })
      })
    return () => {
      active = false
    }
  }, [caseId])
  return state
}

/**
 * A simulated patrol-activity timeline for a case. The data is generated from NYC
 * 311 benchmark timing and status patterns — it is explicitly NOT Brampton patrol
 * history and NOT an automated enforcement record. The section is always rendered
 * (with a clear disclaimer) and degrades calmly when there is no activity or the
 * data can't be loaded, rather than showing an alarming error.
 */
function SyntheticPatrolTimeline({ caseId }: { caseId: string }) {
  const { logs, loading, error } = useSyntheticPatrolLogs(caseId)
  const hasLogs = !!logs && logs.length > 0

  return (
    <div className="card overflow-hidden p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-navy-900">Synthetic patrol activity</h3>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-violet-500" />
          Simulated
        </span>
      </div>

      {/* Always-visible provenance: simulated, not Brampton patrol history. */}
      <p className="mt-3 rounded-lg border border-violet-200 bg-violet-50/60 px-3.5 py-2.5 text-[11px] leading-relaxed text-violet-900">
        This patrol timeline is <span className="font-semibold">synthetic activity generated from NYC 311 benchmark
        patterns</span> to illustrate how officer field activity could appear once Brampton operational data is
        connected. It is not Brampton patrol history and not an automated enforcement record.
      </p>

      <div className="mt-4">
        {loading ? (
          <div className="animate-pulse space-y-3" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-slate-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/3 rounded bg-slate-200" />
                  <div className="h-3 w-2/3 rounded bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-ink-subtle">
            Synthetic patrol activity could not be loaded for this case.
          </p>
        ) : !hasLogs ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-ink-subtle">
            No synthetic patrol activity has been generated for this case.
          </p>
        ) : (
          <PatrolTimelineList logs={logs!} />
        )}
      </div>
    </div>
  )
}

function PatrolTimelineList({ logs }: { logs: SyntheticPatrolLog[] }) {
  return (
    <ol className="space-y-0">
      {logs.map((log, i) => (
        <li key={log.log_sequence ?? i} className="relative flex gap-3.5 pb-5 last:pb-0">
          {/* Rail: dot + connecting line (line omitted on the final entry). */}
          <div className="flex flex-col items-center" aria-hidden>
            <span className="mt-1 inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full bg-violet-500 ring-4 ring-violet-100" />
            {i < logs.length - 1 && <span className="mt-1 w-px flex-1 bg-slate-200" />}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xs font-medium tabular-nums text-ink-muted">
                {fmtDateTime(log.activity_at) ?? 'Time not recorded'}
              </span>
              {log.patrol_status && <PatrolStatusBadge status={log.patrol_status} />}
            </div>

            <div className="mt-1 text-sm font-semibold text-navy-900">
              {log.patrol_activity_type ?? 'Patrol activity'}
            </div>

            {log.officer_unit && (
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-subtle">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-3.5 w-3.5">
                  <path d="M12 3l7 3v5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6l7-3Z" />
                </svg>
                {log.officer_unit}
              </div>
            )}

            {log.outcome_summary && (
              <p className="mt-1.5 text-sm leading-relaxed text-ink">{log.outcome_summary}</p>
            )}

            {log.recommended_next_step && (
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
                  Recommended next step
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{log.recommended_next_step}</p>
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

// Calm, keyword-based tone for a patrol status — no alarming colors, just a
// readable badge. Unknown statuses fall back to a neutral slate badge.
function PatrolStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase()
  let tone = 'bg-slate-100 text-ink-muted ring-slate-200'
  if (/(complete|closed|done|resolved)/.test(s)) tone = 'bg-emerald-50 text-emerald-800 ring-emerald-200'
  else if (/(progress|active|en route|enroute|dispatch|ongoing)/.test(s)) tone = 'bg-sky-50 text-sky-800 ring-sky-200'
  else if (/(plan|schedul|pending|queued)/.test(s)) tone = 'bg-amber-50 text-amber-800 ring-amber-200'
  else if (/(escalat|follow|flag)/.test(s)) tone = 'bg-rose-50 text-rose-800 ring-rose-200'
  else if (/(cancel|no action|cleared)/.test(s)) tone = 'bg-slate-100 text-ink-subtle ring-slate-200'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${tone}`}>
      {status}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Raw source record (collapsible, for transparency / debugging)
// ---------------------------------------------------------------------------

// Human-readable labels for the stored benchmark source fields. The raw record
// holds snake_case / UPPERCASE database column names; staff should never see
// those directly. Note that the ai_* fields are STORED enrichment columns from
// the offline benchmark dataset — not the product of a live LLM call. The only
// live AI request is the explicit, click-triggered "Generate AI review".
const RAW_FIELD_LABELS: Record<string, string> = {
  ai_category: 'Suggested service category',
  ai_priority: 'Suggested review priority',
  ai_recommended_action: 'Recommended staff action',
  ai_summary: 'Decision support summary',
  assigned_department: 'Assigned department',
  borough: 'Borough',
  case_id: 'Case ID',
  channel: 'Source channel',
  closed_at: 'Closed date',
  complaint_type: 'Complaint type',
  council_district: 'Council district',
  created_at: 'Created date',
  description: 'Source description',
  resolution_description: 'Source resolution text',
  resolution_action_updated_at: 'Resolution update date',
  source_channel: 'Source channel',
  source_city: 'Source city',
  source_dataset: 'Source dataset',
  source_dataset_id: 'Source dataset ID',
  status: 'Status',
  submitted_at: 'Submitted date',
  workflow_stage: 'Workflow stage',
}

/** Fallback label for unknown raw keys — never expose the raw DB key as the
 * primary label. Drops the ai_ prefix, de-snakes, and Title Cases. */
function toHumanLabel(key: string) {
  return key
    .replace(/^ai_/i, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function RawSourceRecord({ raw }: { raw: Record<string, unknown> }) {
  const entries = Object.entries(raw)
    .map(([key, value]) => {
      const normalizedKey = key.toLowerCase()
      const label = RAW_FIELD_LABELS[normalizedKey] ?? toHumanLabel(key)
      return { key, label, value: formatRawValue(value) }
    })
    .filter((e) => e.value != null)
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <details className="group rounded-xl border border-slate-200 bg-slate-50/60">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-5 py-3.5">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-navy-900">Source record details</span>
          <span className="block text-[11px] text-ink-subtle">
            Technical source fields from the public NYC 311 benchmark record. Shown for transparency.
          </span>
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="h-4 w-4 shrink-0 text-ink-subtle transition-transform group-open:rotate-180"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="border-t border-slate-200 px-5 py-4">
        <p className="mb-4 rounded-lg bg-slate-100 px-3 py-2 text-[11px] leading-relaxed text-ink-subtle">
          These fields are stored benchmark data. Opening this section does not trigger a live AI call.
        </p>
        {entries.length === 0 ? (
          <p className="text-xs text-ink-subtle">No source fields available for this record.</p>
        ) : (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map((e) => (
              <div key={e.key} className="min-w-0">
                <dt className="text-xs font-semibold text-navy-900">{e.label}</dt>
                <dd className="mt-0.5 break-words text-sm text-ink">{e.value}</dd>
                <dd className="mt-0.5 font-mono text-[10px] lowercase tracking-wide text-ink-subtle/70">{e.key}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </details>
  )
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function SourceTypeBadge({ open, label }: { open: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${
        open ? 'bg-accent-50 text-accent-800 ring-accent-200' : 'bg-slate-100 text-ink-muted ring-slate-200'
      }`}
    >
      <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${open ? 'bg-accent-500' : 'bg-slate-400'}`} />
      {label}
    </span>
  )
}

function Card({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
        {hint && <span className="text-xs text-ink-subtle">{hint}</span>}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  )
}

function Field({
  label,
  value,
  mono,
  className,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
  className?: string
}) {
  const empty = value == null || value === ''
  return (
    <div className={className}>
      <dt className="text-[10px] uppercase tracking-wider text-ink-subtle">{label}</dt>
      <dd className={`mt-0.5 break-words text-ink ${mono ? 'font-mono text-[13px]' : 'text-sm'}`}>
        {empty ? '—' : value}
      </dd>
    </div>
  )
}

/** Explicit data-service error state with a retry button. No mock fallback. */
function CaseLoadError({ id, message, onRetry }: { id?: string; message: string; onRetry: () => void }) {
  return (
    <div className="container-page py-16">
      <div className="mx-auto max-w-xl card p-6">
        <div className="flex items-start gap-3">
          <span aria-hidden className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-navy-900">Could not load this case.</h1>
            <p className="mt-1 text-sm text-ink-muted">
              This case page uses live source data only and does not fall back to sample cases.
              {id ? ` Requested case ${id}.` : ''} Check the connection and try again.
            </p>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-rose-800">
              {message}
            </pre>
            <button type="button" onClick={onRetry} className="btn-primary mt-3">
              Retry
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Combine non-empty parts with a separator, or return null if none are present. */
function joinParts(parts: (string | null)[], sep = ' · '): string | null {
  const present = parts.filter((p): p is string => !!p && p.trim().length > 0)
  return present.length > 0 ? present.join(sep) : null
}

function fmtDateTime(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

/** Terminal (closed-equivalent) NYC 311 statuses, lower-cased for comparison. */
const TERMINAL_STATUSES = new Set(['closed', 'resolved', 'completed', 'cancelled', 'canceled'])

/** Whether a status means the case is no longer open. */
function isTerminalStatus(status: string | null): boolean {
  if (!status) return false
  return TERMINAL_STATUSES.has(status.trim().toLowerCase())
}

/** Format a lat/long pair as "lat, long", or null when either is missing. */
function fmtCoordinates(lat: number | null, long: number | null): string | null {
  if (lat == null || long == null) return null
  return `${lat.toFixed(5)}, ${long.toFixed(5)}`
}

function fmtDistrict(value: string | null): string | null {
  if (!value) return null
  const n = Number(value)
  return Number.isFinite(n) && String(n) !== 'NaN' ? `District ${n}` : value
}

/** Closure duration in whole days, or null when not closed cleanly. */
function closureDurationDays(submittedAt: string | null, closedAt: string | null): number | null {
  if (!submittedAt || !closedAt) return null
  const start = new Date(submittedAt).getTime()
  const end = new Date(closedAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return Math.round((end - start) / 86_400_000)
}

/** Render a raw source value as a trimmed string, or null when empty. */
function formatRawValue(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  const s = String(value).trim()
  return s.length > 0 ? s : null
}

function errorMessage(err: unknown): string {
  if (err == null) return 'Unknown error'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>
    const parts = [e.message, e.details, e.hint, e.code].filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    )
    if (parts.length > 0) return parts.join(' — ')
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err)
}
