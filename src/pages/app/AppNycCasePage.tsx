import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getUnifiedNycCaseDetail, type UnifiedNycCaseDetail } from '../../services/caseExplorer'

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

  return (
    <div className="container-page py-10">
      {/* Header */}
      <div className="text-xs text-ink-subtle">
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
              <Field label="Borough" value={detail.borough} />
              <Field label="Council district" value={fmtDistrict(detail.council_district)} />
              <Field label="Agency" value={agency} />
              <Field label="Agency code" value={detail.agency} />
              <Field label="Assigned department" value={detail.assigned_department} />
            </dl>
          </Card>

          {/* Resolution — only when the source record carries one. */}
          {detail.resolution_description && (
            <Card title="Resolution">
              <p className="text-sm leading-relaxed text-ink">{detail.resolution_description}</p>
            </Card>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Review priority — open review queue only. */}
          {isOpen && (
            <Card title="Review priority" hint="decision support">
              <dl className="space-y-3 text-sm">
                <Field label="Priority score" value={detail.priority_score == null ? null : detail.priority_score.toFixed(0)} />
                <Field label="Priority tier" value={detail.priority_tier} />
                <Field label="Priority reason" value={detail.priority_reason} />
              </dl>
              <p className="mt-4 text-[11px] leading-relaxed text-ink-subtle">
                Review priority is a transparent ranking aid to help staff decide what to look at first. It is not an
                automated decision, risk prediction, or enforcement action.
              </p>
            </Card>
          )}

          {/* Timeline */}
          <Card title="Timeline">
            <dl className="space-y-3 text-sm">
              <Field label="Submitted" value={fmtDateTime(detail.submitted_at)} />
              {isOpen ? (
                <>
                  <Field label="Due date" value={fmtDateTime(detail.due_date)} />
                  <Field label="Age" value={detail.age_days == null ? null : `${detail.age_days} days open`} />
                </>
              ) : (
                <>
                  <Field label="Closed" value={fmtDateTime(detail.closed_at)} />
                  <Field label="Closure duration" value={closure == null ? null : `${closure} days`} />
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
// Raw source record (collapsible, for transparency / debugging)
// ---------------------------------------------------------------------------

function RawSourceRecord({ raw }: { raw: Record<string, unknown> }) {
  const entries = Object.entries(raw)
    .map(([key, value]) => ({ key, value: formatRawValue(value) }))
    .filter((e) => e.value != null)
    .sort((a, b) => a.key.localeCompare(b.key))

  return (
    <details className="group rounded-xl border border-slate-200 bg-slate-50/60">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-5 py-3.5">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-navy-900">Raw source record details</span>
          <span className="block text-[11px] text-ink-subtle">Every field as stored in the public 311 source data.</span>
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
        {entries.length === 0 ? (
          <p className="text-xs text-ink-subtle">No source fields available for this record.</p>
        ) : (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map((e) => (
              <div key={e.key} className="min-w-0">
                <dt className="font-mono text-[10px] uppercase tracking-wider text-ink-subtle">{e.key}</dt>
                <dd className="mt-0.5 break-words text-sm text-ink">{e.value}</dd>
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
