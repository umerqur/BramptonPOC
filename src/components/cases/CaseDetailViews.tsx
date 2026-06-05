import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import RiskBadge from '../RiskBadge'
import AdvisoryNotice from '../AdvisoryNotice'
import { PriorityBadge, StatusBadge } from './CaseQueueView'
import CaseAiReview from './CaseAiReview'
import type { findCase } from '../../data/mockCases'
import {
  addWorkflowEvent,
  caseAiReviewInputFromComplaint,
  getSimilarComplaints,
  getWorkflowEvents,
  type MunicipalComplaintRow,
  type WorkflowEvent,
} from '../../services/municipalServiceRequests'

type MockCase = NonNullable<ReturnType<typeof findCase>>

/** "Case not found" panel shown when an id resolves to no record. */
export function CaseNotFound({ id, casesPath }: { id?: string; casesPath: string }) {
  return (
    <div className="container-page py-16 text-center">
      <h1 className="text-2xl font-semibold text-navy-900">Case not found</h1>
      <p className="mt-2 text-ink-muted">No complaint with case ID <span className="font-mono">{id}</span>.</p>
      <Link to={casesPath} className="mt-6 inline-block btn-primary">Back to case queue</Link>
    </div>
  )
}

// Human review actions. Each button records a workflow event for the case; it
// does not auto-change the complaint table status in this POC.
const REVIEW_ACTIONS: { label: string; eventType: string; toStatus?: string }[] = [
  { label: 'Mark reviewed', eventType: 'human_review' },
  { label: 'Assign', eventType: 'assignment' },
  { label: 'Inspection required', eventType: 'inspection_required' },
  { label: 'Warning issued', eventType: 'warning_issued' },
  { label: 'Ticket issued', eventType: 'ticket_issued' },
  { label: 'Referred elsewhere', eventType: 'referral' },
  { label: 'No violation found', eventType: 'no_violation' },
  { label: 'Close case', eventType: 'closure', toStatus: 'Closed' },
]

/** Live Supabase complaint detail with the full workflow + closure lifecycle. */
export function ComplaintDetailView({ row, casesPath }: { row: MunicipalComplaintRow; casesPath: string }) {
  const [events, setEvents] = useState<WorkflowEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [similar, setSimilar] = useState<MunicipalComplaintRow[]>([])
  const [similarLoading, setSimilarLoading] = useState(true)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [actionNote, setActionNote] = useState<string | null>(null)

  const address = row.address_or_location || row.fsa_or_area || 'Location not recorded'

  function loadEvents() {
    setEventsLoading(true)
    getWorkflowEvents(row.case_id)
      .then((data) => setEvents(data))
      .catch((err) => {
        console.error('Failed to load workflow events:', err)
        setEvents([])
      })
      .finally(() => setEventsLoading(false))
  }

  useEffect(() => {
    let active = true
    loadEvents()
    setSimilarLoading(true)
    getSimilarComplaints(row, 5)
      .then((data) => active && setSimilar(data))
      .catch((err) => {
        console.error('Failed to load similar complaints:', err)
        if (active) setSimilar([])
      })
      .finally(() => active && setSimilarLoading(false))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.case_id])

  async function handleAction(action: (typeof REVIEW_ACTIONS)[number]) {
    setPendingAction(action.eventType)
    setActionNote(null)
    try {
      await addWorkflowEvent({
        case_id: row.case_id,
        event_type: action.eventType,
        event_label: action.label,
        from_status: row.status ?? undefined,
        to_status: action.toStatus,
        actor_type: 'staff',
      })
      setActionNote(`Recorded "${action.label}" in the audit trail.`)
      loadEvents()
    } catch (err) {
      console.error('Failed to record workflow event:', err)
      setActionNote(`Could not record "${action.label}". Check the connection and try again.`)
    } finally {
      setPendingAction(null)
    }
  }

  const residentDraft = useMemo(() => buildResidentDraft(row), [row])
  const aiReviewInput = useMemo(() => caseAiReviewInputFromComplaint(row), [row])

  return (
    <div className="container-page py-10">
      <div className="text-xs text-ink-subtle">
        <Link to={casesPath} className="link-quiet">Case Queue</Link>
        <span className="mx-2">/</span>
        <span>{row.case_id}</span>
      </div>

      {/* Header */}
      <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">{row.case_id}</h1>
            {row.status && <StatusBadge status={row.status} />}
            {row.workflow_stage && (
              <span className="badge bg-navy-900/5 text-navy-900">{row.workflow_stage}</span>
            )}
            {row.priority && <PriorityBadge priority={row.priority} />}
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            {[row.complaint_type, row.ward_or_area, address].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      <div className="mt-3 text-[11px] text-ink-subtle">
        Public benchmark municipal service request data used to demonstrate the workflow. Not Brampton operational
        complaint data. Workflow and closure tracking with staff reviewed decision support.
      </div>

      <div className="mt-4">
        <AdvisoryNotice />
      </div>

      {/*
        Investigation workspace. On desktop: the left two columns hold the case
        record (original complaint, rule based triage, then resident draft and
        similar cases), and the right column is a sticky staff command panel with
        the AI assisted staff review at the top. The command column spans both
        left rows and is placed explicitly so that, when the grid collapses on
        mobile, the source order is: case details → AI review → supporting record
        — i.e. the AI review appears immediately under the case details, never
        buried at the bottom.
      */}
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* Case record (left, top) */}
        <div className="space-y-6 lg:col-span-2 lg:col-start-1 lg:row-start-1">
          {/* Original complaint */}
          <Card title="Original complaint">
            <p className="text-sm text-ink leading-relaxed">
              {row.description || 'No complaint description recorded for this case.'}
            </p>
            <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Field label="Complaint type" value={row.complaint_type} />
              <Field label="Submitted" value={formatDateTime(row.submitted_at)} />
              <Field label="Location" value={address} />
              <Field label="Ward or area" value={row.ward_or_area} />
              <Field label="Source channel" value={row.source_channel} />
            </dl>
          </Card>

          {/* Rule based triage (existing POC triage — distinct from the AI review) */}
          <Card title="Rule based triage" advisory>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Field label="Category" value={row.ai_category} />
              <Field label="Priority" value={row.ai_priority} />
            </dl>
            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-wider text-ink-subtle">Triage summary</div>
              <p className="mt-1 text-sm text-ink leading-relaxed">
                {row.ai_summary || 'No triage summary available.'}
              </p>
            </div>
            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-wider text-ink-subtle">Recommended action</div>
              <p className="mt-1 text-sm font-medium text-navy-900">
                {row.ai_recommended_action || 'Validate details and assign to the responsible team.'}
              </p>
            </div>
            <div className="mt-4">
              <AdvisoryNotice variant="inline" />
            </div>
          </Card>
        </div>

        {/* Staff command column (right, sticky). Scrolls internally if it grows
            past the viewport so the AI review result stays reachable. */}
        <div className="lg:col-start-3 lg:row-start-1 lg:row-span-2">
          <div className="space-y-6 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
            {/* AI assisted staff review — top of the command column, on-demand */}
            <CaseAiReview input={aiReviewInput} />

            {/* Human review actions */}
            <Card title="Human review" hint="records a workflow event">
              <p className="text-sm text-ink-muted">
                Staff reviewed decision support. Recording a decision adds a workflow event to the audit trail; it does
                not automatically change the complaint status in this POC.
              </p>
              {row.human_decision && (
                <div className="mt-3 text-sm">
                  <span className="text-ink-subtle">Latest recorded decision: </span>
                  <span className="font-medium text-navy-900">{row.human_decision}</span>
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {REVIEW_ACTIONS.map((action) => (
                  <button
                    key={action.eventType}
                    onClick={() => handleAction(action)}
                    disabled={pendingAction !== null}
                    className="btn-secondary text-sm py-1.5 px-3 disabled:opacity-50"
                  >
                    {pendingAction === action.eventType ? 'Recording…' : action.label}
                  </button>
                ))}
              </div>
              {actionNote && <div className="mt-3 text-xs text-ink-muted">{actionNote}</div>}
            </Card>

            {/* Assignment summary */}
            <Card title="Assignment">
              <dl className="space-y-2 text-sm">
                <Field label="Department" value={row.assigned_department} />
                <Field label="Unit" value={row.department_unit} />
                <Field label="Priority" value={row.priority} />
              </dl>
            </Card>

            {/* Audit trail */}
            <Card title="Audit trail" hint={eventsLoading ? 'loading…' : `${events.length}`}>
              {eventsLoading ? (
                <div className="text-sm text-ink-subtle">Loading workflow events…</div>
              ) : events.length === 0 ? (
                <div className="text-sm text-ink-subtle">No workflow events recorded yet.</div>
              ) : (
                <ul className="space-y-3 text-xs">
                  {events.map((e) => (
                    <li key={e.id} className="flex items-start gap-3">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-300 shrink-0" />
                      <div className="flex-1">
                        <div className="text-ink">{e.event_label || e.event_type}</div>
                        {(e.from_status || e.to_status) && (
                          <div className="text-ink-subtle">
                            {[e.from_status, e.to_status].filter(Boolean).join(' → ')}
                          </div>
                        )}
                        {e.notes && <div className="text-ink-subtle">{e.notes}</div>}
                        <div className="text-ink-subtle">
                          {(e.actor_type || 'staff')} · {formatDateTime(e.created_at)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>

        {/* Supporting record (left, below the case details) */}
        <div className="space-y-6 lg:col-span-2 lg:col-start-1 lg:row-start-2">
          {/* Resident response draft */}
          <Card title="Resident response draft" aiGenerated>
            <p className="text-xs text-ink-subtle">
              Generated locally from the complaint type, status, assigned department, and AI triage. Staff must review
              and edit before sending to a resident.
            </p>
            <pre className="mt-3 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-ink leading-relaxed font-sans">
              {residentDraft}
            </pre>
          </Card>

          {/* Similar cases */}
          <Card title="Similar cases" hint={similarLoading ? 'loading…' : `${similar.length}`}>
            <p className="text-[11px] text-ink-subtle">
              Same complaint type and ward or area, excluding this case.
            </p>
            {similarLoading ? (
              <div className="mt-3 text-sm text-ink-subtle">Finding similar complaints…</div>
            ) : similar.length === 0 ? (
              <div className="mt-3 text-sm text-ink-subtle">No similar complaints found.</div>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {similar.map((s) => (
                  <li key={s.case_id} className="flex flex-col">
                    <Link to={`${casesPath}/${encodeURIComponent(s.case_id)}`} className="link-quiet font-medium">
                      {s.case_id}
                    </Link>
                    <span className="text-[11px] text-ink-subtle">
                      {[s.status, formatDate(s.submitted_at)].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

/** Build a resident-facing response draft from the complaint fields. */
function buildResidentDraft(row: MunicipalComplaintRow): string {
  const type = row.complaint_type || 'your reported concern'
  const dept = row.assigned_department || 'the responsible municipal team'
  const status = (row.status || 'in progress').toLowerCase()
  const summary = row.ai_summary?.trim()
  const action = row.ai_recommended_action?.trim()

  const lines = [
    `Re: Complaint ${row.case_id} — ${type}`,
    '',
    'Hello,',
    '',
    `Thank you for contacting us about ${type}. This complaint has been received and is currently ${status}. It has been routed to ${dept}.`,
  ]
  if (summary) lines.push('', `Summary of the issue: ${summary}`)
  if (action) lines.push('', `Next step: ${action}`)
  lines.push(
    '',
    'We will follow up if we need additional information. You can reference the case number above in any further correspondence.',
    '',
    'Sincerely,',
    `${dept}`,
  )
  return lines.join('\n')
}

/** Rich mock case detail used by the public demo. */
export function MockCaseDetailView({ c, casesPath }: { c: MockCase; casesPath: string }) {
  return (
    <div className="container-page py-10">
      <div className="text-xs text-ink-subtle">
        <Link to={casesPath} className="link-quiet">Case Queue</Link>
        <span className="mx-2">/</span>
        <span>{c.id}</span>
      </div>

      <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">{c.id}</h1>
            <RiskBadge risk={c.risk} />
            <span className="badge bg-slate-100 text-slate-700">{c.priority}</span>
            <span className="badge bg-navy-900/5 text-navy-900">{c.status}</span>
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            {c.category} · {c.ward} · {c.address}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" disabled>Assign</button>
          <button className="btn-primary" disabled>Take recommended action</button>
        </div>
      </div>

      <div className="mt-3 text-[11px] text-ink-subtle">
        Buttons disabled in this public demo — decision support only. Final action remains with authorized municipal
        staff.
      </div>

      <div className="mt-4">
        <AdvisoryNotice />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          <Card title="Case summary" aiGenerated>
            <p className="text-sm text-ink leading-relaxed">{c.summary}</p>
          </Card>

          <Card title="Complaint history" hint={`${c.complaints.length} records`}>
            <ul className="divide-y divide-slate-100">
              {c.complaints.map((s) => (
                <li key={s.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3 text-xs text-ink-subtle">
                    <span className="font-mono">{s.id}</span>
                    <span>{s.date} · {s.channel}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink">{s.summary}</p>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Officer briefing" aiGenerated>
            <ol className="space-y-3">
              {c.briefing.map((p, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="text-xs font-semibold text-accent-700 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-ink leading-relaxed">{p}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <Card title="Recommended action">
            <div className="text-sm text-ink-muted">AI recommendation, pending staff review</div>
            <div className="mt-2 text-base font-semibold text-navy-900">{c.recommendedAction}</div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-ink-subtle">
              <Metric label="Days open" value={c.daysOpen} />
              <Metric label="Repeat complaints" value={c.repeatComplaints} />
            </div>
          </Card>

          <Card title="Similar cases" hint={`${c.similarCases.length}`}>
            {c.similarCases.length === 0 ? (
              <div className="text-sm text-ink-subtle">No similar active cases identified.</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {c.similarCases.map((sid) => (
                  <li key={sid}>
                    <Link to={`${casesPath}/${sid}`} className="link-quiet font-medium">{sid}</Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Audit trail" hint="placeholder">
            <ul className="space-y-3 text-xs">
              <AuditEntry time="just now" actor="System" text="AI case summary regenerated" />
              <AuditEntry time="2h ago" actor="J. Lee (Triage)" text="Complaint reviewed and acknowledged" />
              <AuditEntry time="yesterday" actor="System" text="Case opened from intake batch" />
              <AuditEntry time="—" actor="—" text="Full audit trail available in production with role based access" />
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}

function formatDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-ink">{value || '—'}</dd>
    </div>
  )
}

function Card({
  title,
  hint,
  aiGenerated,
  advisory,
  children,
}: {
  title: string
  hint?: string
  aiGenerated?: boolean
  advisory?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
        <div className="flex items-center gap-2 text-xs text-ink-subtle">
          {aiGenerated && (
            <span className="inline-flex items-center gap-1 rounded-md bg-accent-50 px-2 py-0.5 text-accent-800 ring-1 ring-inset ring-accent-200">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
              AI generated
            </span>
          )}
          {advisory && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-amber-800 ring-1 ring-inset ring-amber-200">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Rule based POC triage
            </span>
          )}
          {hint && <span>{hint}</span>}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 p-2.5">
      <div className="text-[10px] uppercase tracking-wider">{label}</div>
      <div className="mt-0.5 text-base font-semibold text-navy-900 tabular-nums">{value}</div>
    </div>
  )
}

function AuditEntry({ time, actor, text }: { time: string; actor: string; text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-300 shrink-0" />
      <div className="flex-1">
        <div className="text-ink">{text}</div>
        <div className="text-ink-subtle">{actor} · {time}</div>
      </div>
    </li>
  )
}
