import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useWorkflow, type FieldActionInput } from '../../lib/workflowStore'
import { FIELD_OUTCOME_LABELS, formatDateTime } from '../../services/demoWorkflowService'
import { residentRowToCase } from '../../services/residentCaseBridge'
import ResidentAttachments from '../../components/app/ResidentAttachments'
import type { DemoCase } from '../../data/demoWorkflowTypes'
import {
  STATUS_LABELS,
  getResidentRequestByCaseId,
  recordResidentFieldOutcome,
  type FieldOutcomeInput,
  type ResidentRequestRow,
} from '../../services/residentRequests'

// Officer Case — the focused, officer-only view of one assigned case. It supports
// BOTH sources the officer can be assigned:
//   * Local workflow DemoCase records (NYC open benchmark cases assigned in the
//     Workbench) — checked first; the officer records the field outcome via the
//     in-browser workflow store (recordFieldAction), using the SAME field
//     structure as Officer Oakley's resident form (observed condition, violation
//     observed, action taken, officer notes, follow-up).
//   * Supabase resident_service_requests — the existing resident intake flow,
//     unchanged: the officer records the outcome via recordResidentFieldOutcome.
// Recording the outcome feeds closure review; a supervisor still approves the
// final closure. Closed cases are read only.

export default function AppOfficerCasePage() {
  const { caseId = '' } = useParams()
  const { role, cases, userEmail } = useWorkflow()

  // Officers only.
  if (role !== 'officer') return <Navigate to="/app" replace />

  const officerEmail = (userEmail ?? '').trim().toLowerCase()

  // Local-first: NYC open benchmark cases live only in the workflow store and are
  // recorded through it. Everything else falls back to the Supabase resident flow.
  const localCase = cases.find((c) => c.id === caseId && c.source.kind === 'nyc_open')
  if (localCase) {
    // A signed-in officer may only open a case assigned to their own email.
    if ((localCase.assignedOfficerEmail ?? '').toLowerCase() !== officerEmail) {
      return <NotAssignedNotice />
    }
    return <LocalOfficerCaseView caseId={caseId} />
  }
  return <SupabaseOfficerCaseView caseId={caseId} officerEmail={officerEmail} />
}

// Shown when an officer tries to open a case that is not assigned to their email.
function NotAssignedNotice() {
  return (
    <div className="container-page py-10">
      <BackLink />
      <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
        This case is not assigned to you. You can only open cases assigned to your officer account.
      </div>
    </div>
  )
}

function SupabaseOfficerCaseView({ caseId, officerEmail }: { caseId: string; officerEmail: string }) {
  const [row, setRow] = useState<ResidentRequestRow | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  // True only right after the officer records the outcome this session, so we can
  // show a focused success panel with the obvious next step.
  const [justRecorded, setJustRecorded] = useState(false)

  useEffect(() => {
    let active = true
    setRow(undefined)
    setError(null)
    getResidentRequestByCaseId(caseId)
      .then((r) => active && setRow(r))
      .catch((err: unknown) => {
        console.error('Failed to load case:', err)
        if (active) {
          setError('Could not load this case. Please try again.')
          setRow(null)
        }
      })
    return () => {
      active = false
    }
  }, [caseId])

  // Decision support derived deterministically from the request (no automated
  // enforcement decision) — routing recommendation, classification, priority.
  const support = useMemo(() => (row ? residentRowToCase(row) : null), [row])

  if (row === undefined) {
    return <div className="container-page py-10 text-sm text-ink-subtle">Loading case…</div>
  }

  if (error || row === null) {
    return (
      <div className="container-page py-10">
        <BackLink />
        <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
          {error ?? 'This case could not be found or is not assigned to you.'}
        </div>
      </div>
    )
  }

  // A signed-in officer may only open a case assigned to their own email. The
  // resident request carries assigned_officer_email — enforce it here.
  if ((row.assigned_officer_email ?? '').toLowerCase() !== officerEmail) {
    return <NotAssignedNotice />
  }

  // Compact success state, shown right after the officer records the outcome.
  if (justRecorded) {
    return (
      <div className="container-page py-10">
        <BackLink />
        <div className="mx-auto mt-6 max-w-xl card p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h1 className="mt-4 text-xl font-semibold text-navy-900">Field outcome recorded</h1>
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-sm text-emerald-900">
            <div>
              <span className="font-semibold">Status:</span> Ready for supervisor closure review
            </div>
            <div className="mt-1">
              <span className="font-semibold">Next step:</span> Supervisor reviews the field outcome and approves the
              closure response.
            </div>
          </div>
          <div className="mt-6">
            <Link to="/app/field" className="btn-primary">
              Back to Officer Field Console
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const isClosed = row.status === 'closed'
  const routing = support?.triage.recommendedDepartment ?? '—'
  const classification = support?.triage.category ?? row.request_type
  const priority = support?.triage.recommendedPriority ?? '—'

  return (
    <div className="container-page py-10">
      <BackLink />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">{row.case_id}</h1>
        <span className="badge bg-slate-100 text-slate-700">{STATUS_LABELS[row.status]}</span>
        <span className="badge bg-slate-100 text-slate-700">{row.request_type}</span>
      </div>

      {isClosed && (
        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-navy-900">
          <span className="font-medium">This case is closed. The record is read only.</span>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Left: read-only case context for the field visit */}
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Case details">
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <Detail label="Address" value={[row.location, row.city, row.province].filter(Boolean).join(', ')} />
              <Detail label="Complaint type" value={row.request_type} />
              <Detail label="Assigned officer" value={row.assigned_officer_name ?? '—'} />
              <Detail label="Assigned" value={row.assigned_at ? formatDateTime(row.assigned_at) : '—'} />
            </dl>
          </Panel>

          <Panel title="Resident complaint" subtitle="The resident's own description, in their words">
            {row.description?.trim() ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{row.description.trim()}</p>
            ) : (
              <p className="text-sm italic text-ink-subtle">No resident description was provided.</p>
            )}
          </Panel>

          <ResidentAttachments caseId={row.case_id} variant="full" />

          <FieldOutcomeSection
            row={row}
            isClosed={isClosed}
            onRecorded={(updated) => {
              setRow(updated)
              setJustRecorded(true)
            }}
          />
        </div>

        {/* Right: assignment + secondary, collapsed decision support. Operational
            first — governance/disclaimer detail stays out of the officer's way. */}
        <div className="space-y-6">
          {row.assigned_officer_name && (
            <Panel title="Assignment">
              <dl className="space-y-2">
                <Detail label="Assigned officer" value={row.assigned_officer_name} />
                <Detail label="Assigned" value={row.assigned_at ? formatDateTime(row.assigned_at) : '—'} />
              </dl>
            </Panel>
          )}

          <details className="card p-5">
            <summary className="cursor-pointer select-none text-sm font-semibold text-navy-900">
              Decision support summary
              <span className="ml-1 font-normal text-ink-subtle">(suggestions — staff decide)</span>
            </summary>
            <dl className="mt-3 space-y-2">
              <Detail label="Routing recommendation" value={routing} />
              <Detail label="Classification" value={classification} />
              <Detail label="Priority" value={priority} />
            </dl>
          </details>
        </div>
      </div>
    </div>
  )
}

function FieldOutcomeSection({
  row,
  isClosed,
  onRecorded,
}: {
  row: ResidentRequestRow
  isClosed: boolean
  onRecorded: (updated: ResidentRequestRow) => void
}) {
  const recorded = row.field_visit_completed

  // Read-only view once an outcome is recorded (or the case is closed).
  if (recorded) {
    return (
      <Panel title="Field outcome" subtitle="Field outcome recorded">
        <span className="badge bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200">
          Ready for closure review
        </span>
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Detail label="Violation observed" value={row.field_violation_observed ?? '—'} />
          <Detail label="Action taken" value={row.field_action_taken ?? '—'} />
          <Detail label="Follow-up required" value={row.field_follow_up_required ? 'Yes' : 'No'} />
          <Detail
            label="Recorded"
            value={row.field_outcome_recorded_at ? formatDateTime(row.field_outcome_recorded_at) : '—'}
          />
        </dl>
        {row.field_observed_condition && (
          <div className="mt-3">
            <div className="stat-label">Observed condition</div>
            <p className="mt-1 text-sm text-ink">{row.field_observed_condition}</p>
          </div>
        )}
        {row.field_officer_notes && (
          <div className="mt-3">
            <div className="stat-label">Officer notes</div>
            <p className="mt-1 text-sm text-ink">{row.field_officer_notes}</p>
          </div>
        )}
        <p className="mt-3 text-[11px] text-emerald-700">
          Next step: a supervisor reviews this field outcome and approves the closure response.
        </p>
      </Panel>
    )
  }

  if (isClosed) {
    return (
      <Panel title="Field outcome">
        <p className="text-sm text-ink-subtle">This case is closed. No field outcome can be recorded.</p>
      </Panel>
    )
  }

  return <FieldOutcomeForm row={row} onRecorded={onRecorded} />
}

function FieldOutcomeForm({
  row,
  onRecorded,
}: {
  row: ResidentRequestRow
  onRecorded: (updated: ResidentRequestRow) => void
}) {
  const [observedCondition, setObservedCondition] = useState('')
  const [violationObserved, setViolationObserved] = useState<'yes' | 'no' | 'unclear'>('unclear')
  const [actionTaken, setActionTaken] = useState('')
  const [officerNotes, setOfficerNotes] = useState('')
  const [followUpRequired, setFollowUpRequired] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!observedCondition.trim()) {
      setError('Describe the observed condition before completing the field outcome.')
      return
    }
    if (!actionTaken.trim()) {
      setError('Record the action taken before completing the field outcome.')
      return
    }
    setBusy(true)
    setError(null)
    const input: FieldOutcomeInput = {
      observedCondition,
      violationObserved,
      actionTaken,
      officerNotes,
      followUpRequired,
    }
    try {
      const updated = await recordResidentFieldOutcome(row.case_id, input)
      onRecorded(updated)
    } catch (err) {
      console.error('Failed to record field outcome:', err)
      setError('Could not save the field outcome. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Record field outcome" subtitle="Your on-site findings — feeds closure review readiness">
      <div className="space-y-4">
        <label className="block">
          <span className="stat-label">Observed condition</span>
          <textarea
            value={observedCondition}
            onChange={(e) => setObservedCondition(e.target.value)}
            rows={3}
            placeholder="What you observed on site…"
            className={fieldClass}
          />
        </label>

        <label className="block">
          <span className="stat-label">Violation observed</span>
          <select
            value={violationObserved}
            onChange={(e) => setViolationObserved(e.target.value as 'yes' | 'no' | 'unclear')}
            className={fieldClass}
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
            <option value="unclear">Unclear</option>
          </select>
        </label>

        <label className="block">
          <span className="stat-label">Action taken</span>
          <input
            value={actionTaken}
            onChange={(e) => setActionTaken(e.target.value)}
            placeholder="e.g. Notice issued, education provided, no action needed"
            className={fieldClass}
          />
        </label>

        <label className="block">
          <span className="stat-label">Officer notes</span>
          <textarea
            value={officerNotes}
            onChange={(e) => setOfficerNotes(e.target.value)}
            rows={2}
            placeholder="Optional additional notes…"
            className={fieldClass}
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={followUpRequired}
            onChange={(e) => setFollowUpRequired(e.target.checked)}
            className="h-4 w-4"
          />
          Follow-up required
        </label>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        )}

        <button onClick={submit} disabled={busy} className="btn-primary text-sm disabled:opacity-60">
          {busy ? 'Saving…' : 'Field outcome complete'}
        </button>
        <p className="text-[11px] text-ink-subtle">
          Recording the outcome moves the case to closure review readiness. A supervisor approves the staff-approved
          closure.
        </p>
      </div>
    </Panel>
  )
}

const fieldClass =
  'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-navy-900 focus:border-accent-500 focus:outline-none'

// ---------------------------------------------------------------------------
// Local (NYC open benchmark) officer case view — records the field outcome
// through the in-browser workflow store (recordFieldAction).
// ---------------------------------------------------------------------------

function LocalOfficerCaseView({ caseId }: { caseId: string }) {
  const { cases } = useWorkflow()
  const c = cases.find((x) => x.id === caseId)
  const [justRecorded, setJustRecorded] = useState(false)

  if (!c) {
    return (
      <div className="container-page py-10">
        <BackLink />
        <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
          This case could not be found or is no longer assigned to you.
        </div>
      </div>
    )
  }

  if (justRecorded) {
    return (
      <div className="container-page py-10">
        <BackLink />
        <div className="mx-auto mt-6 max-w-xl card p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h1 className="mt-4 text-xl font-semibold text-navy-900">Field outcome recorded</h1>
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-sm text-emerald-900">
            <div>
              <span className="font-semibold">Status:</span> Ready for supervisor closure review
            </div>
            <div className="mt-1">
              <span className="font-semibold">Next step:</span> Supervisor reviews the field outcome and approves the
              closure response.
            </div>
          </div>
          <div className="mt-6">
            <Link to="/app/field" className="btn-primary">
              Back to Officer Field Console
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const isClosed = c.stage === 'closed'
  const complaintType = c.normalized.complaint_type ?? c.triage.category

  return (
    <div className="container-page py-10">
      <BackLink />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">{c.id}</h1>
        <span className="badge bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-200">NYC open benchmark</span>
        <span className="badge bg-slate-100 text-slate-700">{complaintType}</span>
      </div>

      <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50/70 px-4 py-2.5 text-xs leading-relaxed text-teal-900">
        Source record remains unchanged. This closure is recorded in the Brampton POC workflow layer.
      </div>

      {isClosed && (
        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-navy-900">
          <span className="font-medium">This case is closed. The record is read only.</span>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Case details">
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <Detail label="Location" value={c.input.location || '—'} />
              <Detail label="Complaint type" value={complaintType} />
              <Detail label="Assigned officer" value={c.assignedOfficer ?? '—'} />
              <Detail label="Source" value={c.source.label} />
            </dl>
          </Panel>

          <Panel title="Reported issue" subtitle="From the NYC 311 open benchmark source record">
            {c.input.description.trim() ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{c.input.description.trim()}</p>
            ) : (
              <p className="text-sm italic text-ink-subtle">No descriptor was provided in the source record.</p>
            )}
          </Panel>

          <LocalFieldOutcomeSection c={c} isClosed={isClosed} onRecorded={() => setJustRecorded(true)} />
        </div>

        <div className="space-y-6">
          <details className="card p-5">
            <summary className="cursor-pointer select-none text-sm font-semibold text-navy-900">
              Decision support summary
              <span className="ml-1 font-normal text-ink-subtle">(suggestions — staff decide)</span>
            </summary>
            <dl className="mt-3 space-y-2">
              <Detail label="Routing recommendation" value={c.triage.recommendedDepartment} />
              <Detail label="Classification" value={c.triage.category} />
              <Detail label="Priority" value={c.priorityOverride ?? c.triage.recommendedPriority} />
            </dl>
          </details>
        </div>
      </div>
    </div>
  )
}

function LocalFieldOutcomeSection({
  c,
  isClosed,
  onRecorded,
}: {
  c: DemoCase
  isClosed: boolean
  onRecorded: () => void
}) {
  if (c.fieldAction) {
    const fa = c.fieldAction
    return (
      <Panel title="Field outcome" subtitle="Field outcome recorded">
        <span className="badge bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200">
          {FIELD_OUTCOME_LABELS[fa.outcome]}
        </span>
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Detail label="Officer" value={fa.officerName} />
          <Detail label="Recorded" value={formatDateTime(fa.recordedAt)} />
          {fa.referenceNumber && <Detail label="Reference" value={fa.referenceNumber} />}
          <Detail label="Follow-up required" value={fa.followUpRequired ? 'Yes' : 'No'} />
        </dl>
        {fa.observations && (
          <div className="mt-3">
            <div className="stat-label">Observations</div>
            <p className="mt-1 text-sm text-ink">{fa.observations}</p>
          </div>
        )}
        <p className="mt-3 text-[11px] text-emerald-700">
          Next step: a supervisor reviews this field outcome and approves the closure response.
        </p>
      </Panel>
    )
  }

  if (isClosed) {
    return (
      <Panel title="Field outcome">
        <p className="text-sm text-ink-subtle">This case is closed. No field outcome can be recorded.</p>
      </Panel>
    )
  }

  return <LocalFieldOutcomeForm caseId={c.id} onRecorded={onRecorded} />
}

function LocalFieldOutcomeForm({ caseId, onRecorded }: { caseId: string; onRecorded: () => void }) {
  const { recordFieldAction } = useWorkflow()
  const [observedCondition, setObservedCondition] = useState('')
  const [violationObserved, setViolationObserved] = useState<'yes' | 'no' | 'unclear'>('unclear')
  const [actionTaken, setActionTaken] = useState('')
  const [officerNotes, setOfficerNotes] = useState('')
  const [followUpRequired, setFollowUpRequired] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Same structure as Officer Oakley's resident field-outcome form. The closure
  // disposition is derived from violation + action; the officer never picks
  // "ticket" from a dropdown.
  function submit() {
    if (!observedCondition.trim()) {
      setError('Describe the observed condition before completing the field outcome.')
      return
    }
    if (!actionTaken.trim()) {
      setError('Record the action taken before completing the field outcome.')
      return
    }
    setError(null)
    const input: FieldActionInput = {
      observedCondition: observedCondition.trim(),
      violationObserved,
      actionTaken: actionTaken.trim(),
      officerNotes: officerNotes.trim() || undefined,
      followUpRequired,
    }
    recordFieldAction(caseId, input)
    onRecorded()
  }

  return (
    <Panel title="Record field outcome" subtitle="Your on-site findings — feeds closure review readiness">
      <div className="space-y-4">
        <label className="block">
          <span className="stat-label">Observed condition</span>
          <textarea
            value={observedCondition}
            onChange={(e) => setObservedCondition(e.target.value)}
            rows={3}
            placeholder="What you observed on site…"
            className={fieldClass}
          />
        </label>

        <label className="block">
          <span className="stat-label">Violation observed</span>
          <select
            value={violationObserved}
            onChange={(e) => setViolationObserved(e.target.value as 'yes' | 'no' | 'unclear')}
            className={fieldClass}
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
            <option value="unclear">Unclear</option>
          </select>
        </label>

        <label className="block">
          <span className="stat-label">Action taken</span>
          <input
            value={actionTaken}
            onChange={(e) => setActionTaken(e.target.value)}
            placeholder="e.g. Education provided, warning issued, notice to comply, ticket issued, no action needed"
            className={fieldClass}
          />
        </label>

        <label className="block">
          <span className="stat-label">Officer notes</span>
          <textarea
            value={officerNotes}
            onChange={(e) => setOfficerNotes(e.target.value)}
            rows={2}
            placeholder="Optional additional notes…"
            className={fieldClass}
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={followUpRequired}
            onChange={(e) => setFollowUpRequired(e.target.checked)}
            className="h-4 w-4"
          />
          Follow-up / re-inspection required
        </label>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        )}

        <button onClick={submit} className="btn-primary text-sm">
          Record field outcome
        </button>
        <p className="text-[11px] text-ink-subtle">
          Recording the outcome moves the case to closure review readiness. A supervisor approves the closure.
        </p>
      </div>
    </Panel>
  )
}

function BackLink() {
  return (
    <Link to="/app/field" className="text-sm font-semibold text-accent-600 hover:text-accent-700">
      ← Back to Officer Field Console
    </Link>
  )
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
      {subtitle && <p className="text-xs text-ink-subtle">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  )
}
