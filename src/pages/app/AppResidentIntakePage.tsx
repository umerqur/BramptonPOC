import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import SectionHeading from '../../components/SectionHeading'
import {
  STAFF_ACTIONS,
  STATUS_LABELS,
  applyStaffStatusUpdate,
  getResidentRequests,
  type ResidentRequestRow,
  type ResidentStatus,
} from '../../services/residentRequests'
import { sanitizeResidentDescription } from '../../lib/residentDescription'

type LoadState = {
  rows: ResidentRequestRow[]
  loading: boolean
  error: string | null
}

// Per-request transient feedback after an explicit staff action.
type ActionFeedback = { caseId: string; message: string; tone: 'ok' | 'warn' }

const STAFF_LIFECYCLE = [
  { key: 'submitted', label: 'Submitted', description: 'Resident filed request' },
  { key: 'received', label: 'Received', description: 'Intake acknowledged' },
  { key: 'assigned', label: 'Assigned', description: 'Owner assigned' },
  { key: 'in_review', label: 'Under review', description: 'Review underway' },
  { key: 'closed', label: 'Closed', description: 'Final update sent' },
] as const

function StaffLifecycleStrip() {
  return (
    <div className="mt-6 card p-5">
      <div className="text-xs uppercase tracking-wide text-ink-subtle">Internal workflow</div>
      <h2 className="mt-1 text-base font-semibold text-navy-900">Resident intake to enforcement closure</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-5">
        {STAFF_LIFECYCLE.map((stage, i) => (
          <div key={stage.key} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy-900 text-[11px] font-semibold text-white">
                {i + 1}
              </span>
              <span className="text-sm font-semibold text-navy-900">{stage.label}</span>
            </div>
            <p className="mt-2 text-xs text-ink-subtle">{stage.description}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-ink-subtle">
        Each status change is staff initiated and sends a resident update.
      </p>
    </div>
  )
}

const STATUS_STYLES: Record<ResidentStatus, string> = {
  submitted: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  received: 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200',
  assigned: 'bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200',
  in_review: 'bg-violet-50 text-violet-800 ring-1 ring-inset ring-violet-200',
  closed: 'bg-accent-50 text-accent-800 ring-1 ring-inset ring-accent-200',
}

/**
 * Resident Intake Demo — the staff-side workbench for the public resident flow.
 * Authenticated staff see requests residents submitted through /resident, and
 * advance each one (received → assigned → in review → closed). Every advance is
 * an EXPLICIT click that writes a workflow event and emails the resident; no
 * email is ever sent on load or automatically. Staff themselves receive no email.
 */
export default function AppResidentIntakePage() {
  const [state, setState] = useState<LoadState>({ rows: [], loading: true, error: null })
  const [busyCaseId, setBusyCaseId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }))
    getResidentRequests(100)
      .then((rows) => setState({ rows, loading: false, error: null }))
      .catch((err: unknown) => {
        console.error('Failed to load resident requests:', err)
        setState({ rows: [], loading: false, error: sectionError(err) })
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleAction(
    request: ResidentRequestRow,
    action: { toStatus: ResidentStatus; eventType: string; label: string },
  ) {
    setBusyCaseId(request.case_id)
    setFeedback(null)
    try {
      const result = await applyStaffStatusUpdate(request, action)
      // Update just this row in place so the UI reflects the new status.
      setState((s) => ({
        ...s,
        rows: s.rows.map((r) => (r.case_id === result.row.case_id ? result.row : r)),
      }))
      setFeedback({
        caseId: request.case_id,
        tone: result.emailSent ? 'ok' : 'warn',
        message: result.emailSent
          ? `Marked “${STATUS_LABELS[action.toStatus]}”. Workflow event logged and resident emailed.`
          : `Marked “${STATUS_LABELS[action.toStatus]}”. Workflow event logged. (Email could not be sent in this environment.)`,
      })
    } catch (err) {
      console.error('Resident status update failed:', err)
      setFeedback({ caseId: request.case_id, tone: 'warn', message: 'Status update failed. Please try again.' })
    } finally {
      setBusyCaseId(null)
    }
  }

  return (
    <div className="container-page py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="section-eyebrow">Staff Workspace</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">Resident Intake</h1>
          <p className="mt-2 text-sm text-ink-muted max-w-3xl">
            Review resident submitted complaints and send status updates through explicit staff actions.
          </p>
        </div>
        <button onClick={load} className="btn-secondary text-sm py-2 px-4" disabled={state.loading}>
          {state.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
        Demo data only. Requests here are separate from the NYC 311 benchmark analytics layer.
      </div>

      <StaffLifecycleStrip />

      <div className="mt-8">
        <SectionHeading eyebrow="Inbox" title="Resident requests" description="Newest first." />

        {state.error ? (
          <div className="mt-5 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
            <span className="font-semibold">Couldn’t load resident requests.</span>{' '}
            <span className="text-rose-700">{state.error}</span>
          </div>
        ) : state.loading ? (
          <div className="mt-5 card p-8 text-center text-sm text-ink-subtle">Loading resident requests…</div>
        ) : state.rows.length === 0 ? (
          <div className="mt-5 card p-8 text-center">
            <h3 className="text-base font-semibold text-navy-900">No resident requests yet</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
              Submit a demo service request from the public resident form, then return here to review it as
              staff.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Link to="/resident/new-request" className="btn-primary text-sm py-2 px-4">
                Open resident form
              </Link>
              <Link to="/resident" className="btn-secondary text-sm py-2 px-4">
                Check resident portal
              </Link>
            </div>
            <p className="mt-4 text-xs text-ink-subtle">
              Once submitted, the request appears here and the resident receives a confirmation email.
            </p>
          </div>
        ) : (
          <ul className="mt-5 space-y-4">
            {state.rows.map((row) => (
              <li key={row.case_id}>
                <RequestCard
                  row={row}
                  busy={busyCaseId === row.case_id}
                  anyBusy={busyCaseId !== null}
                  feedback={feedback && feedback.caseId === row.case_id ? feedback : null}
                  onAction={handleAction}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function RequestCard({
  row,
  busy,
  anyBusy,
  feedback,
  onAction,
}: {
  row: ResidentRequestRow
  busy: boolean
  anyBusy: boolean
  feedback: ActionFeedback | null
  onAction: (
    row: ResidentRequestRow,
    action: { toStatus: ResidentStatus; eventType: string; label: string },
  ) => void
}) {
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-navy-900">{row.case_id}</span>
            <span className={`badge ${STATUS_STYLES[row.status]}`}>{STATUS_LABELS[row.status]}</span>
          </div>
          <div className="mt-1 text-sm font-medium text-ink">{row.request_type}</div>
        </div>
        <span className="shrink-0 text-xs text-ink-subtle tabular-nums">{formatDateTime(row.created_at)}</span>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Detail label="Resident" value={row.resident_name} />
        <Detail label="Email" value={row.resident_email} />
        <Detail label="Phone" value={row.resident_phone || '—'} />
        <Detail label="Method of contact" value={row.method_of_contact || '—'} />
        <Detail label="Location" value={[row.location, row.city].filter(Boolean).join(', ')} />
        <Detail label="Postal code" value={row.postal_code || '—'} />
        <Detail label="Resolution followup" value={row.resolution_followup ? 'Yes' : 'No'} />
      </dl>

      <div className="mt-3">
        <div className="text-xs uppercase tracking-wide text-ink-subtle">Additional information</div>
        <p className="mt-0.5 whitespace-pre-line text-sm text-ink">{sanitizeResidentDescription(row.description) || '—'}</p>
      </div>

      <div className="mt-4 border-t border-slate-100 pt-4">
        <div className="text-xs font-medium text-ink-subtle">Explicit staff actions — resident update sent on click</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {STAFF_ACTIONS.map((action) => {
            const isCurrent = action.toStatus === row.status
            return (
              <button
                key={action.toStatus}
                type="button"
                onClick={() => onAction(row, action)}
                disabled={isCurrent || anyBusy}
                title={isCurrent ? 'Request is already at this status' : `Set status to ${STATUS_LABELS[action.toStatus]} and email the resident`}
                className="btn-secondary text-sm py-1.5 px-3 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? '…' : action.label}
              </button>
            )
          })}
        </div>

        {feedback && (
          <div
            className={`mt-3 rounded-md px-3 py-2 text-xs ${
              feedback.tone === 'ok'
                ? 'border border-accent-200 bg-accent-50 text-accent-800'
                : 'border border-amber-200 bg-amber-50 text-amber-900'
            }`}
          >
            {feedback.message}
          </div>
        )}
      </div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 truncate text-ink">{value}</dd>
    </div>
  )
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
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
