import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useWorkflow } from '../../lib/workflowStore'
import { useDemoCase } from '../../lib/useDemoCase'
import { can, rolesAllowed } from '../../lib/roles'
import { FIELD_OUTCOME_LABELS, formatDateTime } from '../../services/demoWorkflowService'
import { isSendableEmail, sendResidentEmail } from '../../services/residentRequests'
import {
  AutomationBadge,
  CaseSwitcher,
  ConfidenceMeter,
  GuardrailFooter,
  NoCaseState,
  WorkflowStepper,
} from '../../components/workflow/WorkflowUI'
import ResidentAttachments from '../../components/app/ResidentAttachments'
import type { DemoCase, FieldVisitOutcome, Priority } from '../../data/demoWorkflowTypes'

// Demo roster of by-law officers a supervisor/CSR can assign a case to.
const DEMO_OFFICERS = [
  'R. Singh (By-law Officer)',
  'L. Tremblay (By-law Officer)',
  'D. Owens (By-law Officer)',
]

// Field outcomes in the order officers see them, with which ones issue a number.
const OUTCOME_ORDER: FieldVisitOutcome[] = ['no_violation', 'notice_issued', 'ticket_issued', 'resolved']
const OUTCOME_NEEDS_REFERENCE: Record<FieldVisitOutcome, boolean> = {
  no_violation: false,
  notice_issued: true,
  ticket_issued: true,
  resolved: false,
}

// Resident-safe field-visit message: tells the resident an officer attended,
// without exposing internal observations, ticket numbers, or fines (those stay
// in the staff file; specifics go in the final closure letter).
const FIELD_MESSAGE_TAIL: Record<FieldVisitOutcome, string> = {
  no_violation: ' At the time of the visit, no violation was observed.',
  notice_issued: ' The officer addressed the matter and enforcement action has been taken.',
  ticket_issued: ' The officer addressed the matter and enforcement action has been taken.',
  resolved: ' The issue appears to have been resolved.',
}

function residentFieldMessage(outcome: FieldVisitOutcome, followUp: boolean): string {
  const base = 'A by-law enforcement officer attended the location to investigate your request.'
  const fu = followUp ? ' A follow-up inspection has been scheduled.' : ''
  return `${base}${FIELD_MESSAGE_TAIL[outcome]}${fu} We will send you a final update once the file is reviewed and closed.`
}

// Case Workbench — assembles the AI's gathered enforcement context and the
// case summary in one place, plus the confidence gate from the diagram. Staff
// act here on exceptions: approve routing, request more information, override
// priority, and send the case to staff review (which prepares the closure
// draft). This is where "AI reduces manual research" should feel obvious.

const PRIORITIES: Priority[] = ['P1', 'P2', 'P3', 'P4']

export default function AppCaseWorkbenchPage() {
  const { cases, activeCase, setActiveCase, approveRouting, requestMoreInfo, overridePriority, sendToStaffReview, role } =
    useWorkflow()
  const c = useDemoCase()
  const navigate = useNavigate()
  const [flash, setFlash] = useState<string | null>(null)

  // The Case Workbench is a supervisor/coordinator surface. Officers work from
  // their Officer Field Console instead.
  if (role === 'officer') return <Navigate to="/app/field" replace />

  if (!c) {
    return (
      <div className="container-page py-10">
        <Header cases={cases} activeId={activeCase?.id ?? null} onPick={setActiveCase} />
        <div className="mt-8">
          <NoCaseState />
        </div>
        <GuardrailFooter />
      </div>
    )
  }

  const ctx = c.context
  const summary = c.summary
  const effectivePriority = c.priorityOverride ?? c.triage.recommendedPriority
  const isClosed = c.stage === 'closed'

  function note(msg: string) {
    setFlash(msg)
    window.setTimeout(() => setFlash((m) => (m === msg ? null : m)), 4000)
  }

  return (
    <div className="container-page py-10">
      <Header cases={cases} activeId={c.id} onPick={setActiveCase} />

      {isClosed && (
        <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-navy-900">
          <svg className="mt-0.5 h-4 w-4 flex-none text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span className="font-medium">This case is closed. Actions are locked and the record is read only.</span>
        </div>
      )}

      <div className="mt-6 card p-5">
        <WorkflowStepper stage={c.stage} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <AutomationBadge kind="ai" />
        <AutomationBadge kind="review" />
        <span className="text-xs text-ink-subtle">AI gathered the context below — staff confirm and decide.</span>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        {/* Left: enforcement context */}
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Resident complaint" subtitle="The resident's own description of the issue, in their words">
            {c.input.description.trim() ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{c.input.description.trim()}</p>
            ) : (
              <p className="text-sm italic text-ink-subtle">
                No resident description was provided for this older demo record.
              </p>
            )}
          </Panel>

          <ResidentAttachments caseId={c.id} variant="full" />

          <Panel title="Case summary" subtitle="AI summary / recommended action — decision support for staff review">
            <p className="text-sm leading-relaxed text-ink">{summary.plainLanguage}</p>
            <div className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {summary.structuredFacts.map((f) => (
                <div key={f.label} className="flex justify-between gap-3 border-b border-slate-100 py-1.5 text-sm">
                  <span className="text-ink-subtle">{f.label}</span>
                  <span className="text-right font-medium text-navy-900">{f.value}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Enforcement context" subtitle="Research the AI pulled so staff don't have to">
            <Sub label="Related complaint history">
              {ctx.complaintHistory.length === 0 ? (
                <Empty>No prior complaints on record for this location.</Empty>
              ) : (
                <ul className="space-y-2">
                  {ctx.complaintHistory.map((h) => (
                    <li key={h.caseId} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-navy-900">{h.caseId}</span>
                        <span className="text-xs text-ink-subtle">{h.date}</span>
                      </div>
                      <div className="text-ink-muted">{h.summary}</div>
                      <div className="text-xs text-ink-subtle">{h.status}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Sub>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Sub label="Patrol log snippets">
                <BulletList items={ctx.patrolLogs} />
              </Sub>
              <Sub label="Ticket records">
                <BulletList items={ctx.ticketRecords} />
              </Sub>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Sub label="Complaint trend">
                <p className="text-sm text-ink-muted">{ctx.trendSummary}</p>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="text-ink-subtle">Repeat-location signal:</span>
                  <span
                    className={`badge ${
                      ctx.repeatLocationSignal === 'High'
                        ? 'bg-orange-50 text-orange-800 ring-1 ring-inset ring-orange-200'
                        : ctx.repeatLocationSignal === 'Emerging'
                          ? 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200'
                          : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {ctx.repeatLocationSignal} ({ctx.repeatLocationCount})
                  </span>
                </div>
              </Sub>
              <Sub label="Policy / template match">
                <div className="rounded-lg border border-accent-200 bg-accent-50/60 px-3 py-2 text-sm">
                  <div className="font-medium text-navy-900">{ctx.policyMatch.name}</div>
                  <div className="text-xs text-accent-800">{ctx.policyMatch.reference}</div>
                  <div className="mt-1 text-xs text-ink-muted">{ctx.policyMatch.summary}</div>
                </div>
              </Sub>
            </div>

            <Sub label="Similar cases nearby">
              <ul className="grid gap-2 sm:grid-cols-2">
                {ctx.similarNearbyCases.map((s) => (
                  <li key={s.caseId} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-navy-900">{s.caseId}</span>
                      <span className="text-xs text-ink-subtle">{s.distance}</span>
                    </div>
                    <div className="text-xs text-ink-muted">{s.outcome}</div>
                  </li>
                ))}
              </ul>
            </Sub>
          </Panel>
        </div>

        {/* Right: confidence gate + staff actions */}
        <div className="space-y-6">
          <Panel title="Review readiness" subtitle="Is the file ready for staff review?">
            <ConfidenceMeter value={c.triage.confidence} level={c.triage.confidenceLevel} />
            <div
              className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                c.triage.confidenceLevel === 'High'
                  ? 'border border-accent-200 bg-accent-50 text-accent-800'
                  : 'border border-amber-200 bg-amber-50 text-amber-900'
              }`}
            >
              {c.triage.confidenceLevel === 'High'
                ? 'The file has enough intake detail, policy match, and context to prepare a staff reviewed closure draft.'
                : 'More information is needed before staff review. Resolve the items below before preparing a closure draft.'}
            </div>
            <div className="mt-3">
              <div className="stat-label">Recommended next step</div>
              <p className="mt-1 text-sm text-navy-900">{summary.recommendedNextStep}</p>
            </div>
          </Panel>

          <Panel title="Attention drivers">
            <ul className="space-y-1.5">
              {summary.attentionDrivers.map((d) => (
                <li key={d} className="flex gap-2 text-sm text-ink-muted">
                  <span className="mt-0.5 text-amber-500">•</span>
                  {d}
                </li>
              ))}
            </ul>
            {summary.missingContext.length > 0 && (
              <div className="mt-3">
                <div className="stat-label">Missing context</div>
                <ul className="mt-1 space-y-1">
                  {summary.missingContext.map((m) => (
                    <li key={m} className="text-xs text-amber-800">• {m}</li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          {isClosed ? (
            <Panel title="Case closed">
              <p className="text-sm text-ink-muted">
                This case has already been closed. No further workflow actions are available.
              </p>
              <dl className="mt-3 space-y-1.5 text-sm">
                <Row label="Approved by" value={c.approvedBy ?? '—'} />
                <Row label="Approved at" value={c.approvedAt ? formatDateTime(c.approvedAt) : '—'} />
              </dl>
            </Panel>
          ) : (
          <Panel title="Staff actions" subtitle="Human review / decision">
            <div className="flex items-center gap-2 text-xs text-ink-subtle">
              <span>Effective priority:</span>
              <span className="badge bg-navy-50 text-navy-900 ring-1 ring-inset ring-navy-200">{effectivePriority}</span>
              {c.priorityOverride && <span className="text-amber-700">(overridden)</span>}
            </div>

            <div className="mt-3 grid gap-2">
              <button
                onClick={() => {
                  approveRouting(c.id)
                  note('Routing approved and logged to the audit trail.')
                }}
                className="btn-secondary justify-start text-sm"
              >
                Approve routing
              </button>
              <button
                onClick={() => {
                  requestMoreInfo(c.id)
                  note('Marked as needing more information — logged to audit trail.')
                }}
                className="btn-secondary justify-start text-sm"
              >
                Request more information
              </button>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-ink-subtle">Override priority:</span>
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      overridePriority(c.id, p)
                      note(`Priority overridden to ${p}.`)
                    }}
                    className={`badge cursor-pointer ${
                      effectivePriority === p
                        ? 'bg-navy-800 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <button
                onClick={() => {
                  sendToStaffReview(c.id)
                  note(
                    c.fieldAction
                      ? 'Closure draft prepared from the recorded field outcome. Sent to staff review.'
                      : 'Review-only closure draft prepared (no officer field visit). Sent to staff review.',
                  )
                  navigate(`/app/closure?case=${c.id}`)
                }}
                className="btn-primary justify-start text-sm"
              >
                Prepare closure draft → send to staff review
              </button>
              {!c.fieldAction && (
                <p className="text-[11px] text-ink-subtle">
                  No field visit recorded — the closure letter will be review-only and won’t claim an officer attended.
                </p>
              )}
            </div>

            {flash && (
              <div className="mt-3 rounded-md border border-accent-200 bg-accent-50 px-3 py-2 text-xs text-accent-800">
                {flash}
              </div>
            )}
          </Panel>
          )}

          <FieldInvestigationPanel c={c} readOnly={isClosed} />
        </div>
      </div>

      {isClosed ? (
        <div className="mt-6">
          <Link to={`/app/closure?case=${c.id}`} className="text-sm font-semibold text-accent-600 hover:text-accent-700">
            View approved closure record →
          </Link>
        </div>
      ) : (
        <div className="mt-6">
          <Link to={`/app/closure?case=${c.id}`} className="text-sm font-semibold text-accent-600 hover:text-accent-700">
            Continue to closure draft & staff review →
          </Link>
        </div>
      )}

      <GuardrailFooter />
    </div>
  )
}

// Officer field-investigation panel — the real-world step a standard city
// enforcement model has between triage and closure. A supervisor/CSR assigns the
// case to an officer; the officer (role) attends and records the actual outcome,
// which is what the closure letter is then allowed to state.
function FieldInvestigationPanel({ c, readOnly = false }: { c: DemoCase; readOnly?: boolean }) {
  const { role, assignToOfficer, recordFieldAction } = useWorkflow()
  const canAssign = !readOnly && can(role, 'assignOfficer')
  const canRecord = !readOnly && can(role, 'recordFieldAction')

  const [officer, setOfficer] = useState(c.assignedOfficer ?? DEMO_OFFICERS[0])
  const [outcome, setOutcome] = useState<FieldVisitOutcome>('no_violation')
  const [observations, setObservations] = useState('')
  const [reference, setReference] = useState('')
  const [followUp, setFollowUp] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const needsReference = OUTCOME_NEEDS_REFERENCE[outcome]

  // Best-effort resident email for a milestone; returns the suffix to append to
  // the staff flash so the reviewer sees whether the resident was notified.
  async function emailResident(
    payload: Parameters<typeof sendResidentEmail>[0],
  ): Promise<string> {
    if (!isSendableEmail(payload.to)) return ' (No deliverable resident email — demo address.)'
    const sent = await sendResidentEmail(payload)
    return sent
      ? ` Resident emailed at ${payload.to}.`
      : ' (Resident email could not be sent in this environment.)'
  }

  async function handleAssign() {
    setBusy(true)
    assignToOfficer(c.id, officer)
    const suffix = await emailResident({
      type: 'status_update',
      status: 'assigned',
      to: c.input.residentEmail.trim(),
      residentName: c.input.residentName,
      caseId: c.id,
      requestType: c.triage.category,
      location: c.input.location,
    })
    setFlash(`Assigned to ${officer}.${suffix}`)
    setBusy(false)
  }

  // Already investigated — show the recorded outcome (read-only).
  if (c.fieldAction) {
    const fa = c.fieldAction
    return (
      <Panel title="Field investigation" subtitle="Recorded officer outcome">
        <span className="badge bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200">
          {FIELD_OUTCOME_LABELS[fa.outcome]}
        </span>
        <dl className="mt-3 space-y-1.5 text-sm">
          <Row label="Officer" value={fa.officerName} />
          <Row label="Visited" value={formatDateTime(fa.visitedAt)} />
          {fa.referenceNumber && <Row label="Reference" value={fa.referenceNumber} />}
          <Row label="Follow-up" value={fa.followUpRequired ? 'Required' : 'Not required'} />
        </dl>
        {fa.observations && (
          <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-ink-muted">
            {fa.observations}
          </p>
        )}
        <p className="mt-2 text-[11px] text-emerald-700">
          {readOnly
            ? 'This case is closed. The recorded field outcome is read only.'
            : 'The closure letter now states this outcome. Continue to staff review to approve it.'}
        </p>
      </Panel>
    )
  }

  // Closed with no recorded field visit — nothing can be assigned or recorded.
  if (readOnly) {
    return (
      <Panel title="Field investigation" subtitle="Read only — case closed">
        <p className="text-sm text-ink-subtle">No field investigation was recorded for this case.</p>
      </Panel>
    )
  }

  async function handleRecord() {
    if (!observations.trim()) {
      setFlash('Add a short observation before recording the outcome.')
      return
    }
    setBusy(true)
    recordFieldAction(c.id, {
      outcome,
      observations: observations.trim(),
      referenceNumber: needsReference ? reference.trim() || null : null,
      followUpRequired: followUp,
    })
    const suffix = await emailResident({
      type: 'field_update',
      to: c.input.residentEmail.trim(),
      residentName: c.input.residentName,
      caseId: c.id,
      requestType: c.triage.category,
      location: c.input.location,
      message: residentFieldMessage(outcome, followUp),
    })
    setFlash(`Field outcome recorded. The closure draft has been updated to match.${suffix}`)
    setBusy(false)
  }

  return (
    <Panel title="Field investigation" subtitle="Assign an officer, then record the on-site outcome">
      {/* Assignment */}
      <div>
        <div className="text-xs text-ink-subtle">
          {c.assignedOfficer ? (
            <>Assigned to <span className="font-medium text-navy-900">{c.assignedOfficer}</span></>
          ) : (
            'Not yet assigned to an officer.'
          )}
        </div>
        {canAssign ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={officer}
              onChange={(e) => setOfficer(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-navy-900 focus:border-accent-500 focus:outline-none"
            >
              {DEMO_OFFICERS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            <button onClick={handleAssign} disabled={busy} className="btn-secondary text-sm disabled:opacity-60">
              {c.assignedOfficer ? 'Reassign' : 'Assign to officer'}
            </button>
          </div>
        ) : (
          <p className="mt-1 text-[11px] text-ink-subtle">Assigning is restricted to {rolesAllowed('assignOfficer')}.</p>
        )}
      </div>

      {/* Record outcome — only once assigned */}
      <div className="mt-4 border-t border-slate-100 pt-4">
        {!c.assignedOfficer ? (
          <p className="text-xs text-ink-subtle">Assign an officer first, then the officer records the field outcome.</p>
        ) : !canRecord ? (
          <p className="text-xs text-ink-subtle">
            Recording a field visit is restricted to {rolesAllowed('recordFieldAction')}. Switch role to “By-law Officer”.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="text-xs font-medium text-navy-900">Record field visit outcome</div>
            <label className="block">
              <span className="stat-label">Outcome</span>
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as FieldVisitOutcome)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-navy-900 focus:border-accent-500 focus:outline-none"
              >
                {OUTCOME_ORDER.map((o) => (
                  <option key={o} value={o}>{FIELD_OUTCOME_LABELS[o]}</option>
                ))}
              </select>
            </label>
            {needsReference && (
              <label className="block">
                <span className="stat-label">{outcome === 'ticket_issued' ? 'Ticket number' : 'Notice number'}</span>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={outcome === 'ticket_issued' ? 'e.g. TKT-20260616-014' : 'e.g. NTC-20260616-007'}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-navy-900 focus:border-accent-500 focus:outline-none"
                />
              </label>
            )}
            <label className="block">
              <span className="stat-label">Observations</span>
              <textarea
                value={observations}
                onChange={(e) => setObservations(e.target.value)}
                rows={3}
                placeholder="What the officer observed on site…"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-navy-900 focus:border-accent-500 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} className="h-4 w-4" />
              Follow-up / re-inspection required
            </label>
            <button onClick={handleRecord} disabled={busy} className="btn-primary text-sm disabled:opacity-60">
              {busy ? 'Recording…' : 'Record field outcome'}
            </button>
          </div>
        )}
      </div>

      {flash && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {flash}
        </div>
      )}
    </Panel>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1 text-sm">
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="text-right font-medium text-navy-900">{value}</dd>
    </div>
  )
}

function Header({ cases, activeId, onPick }: { cases: DemoCase[]; activeId: string | null; onPick: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        <div className="section-eyebrow">Step 3 · Case workbench</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">Case Workbench</h1>
        <p className="mt-2 text-ink-muted">
          Enforcement context, case summary, and the confidence gate — assembled by AI, decided by staff.
        </p>
      </div>
      <CaseSwitcher cases={cases} activeId={activeId} onPick={onPick} />
    </div>
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

function Sub({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <div className="stat-label">{label}</div>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1">
      {items.map((i) => (
        <li key={i} className="flex gap-2 text-sm text-ink-muted">
          <span className="mt-0.5 text-ink-subtle">•</span>
          {i}
        </li>
      ))}
    </ul>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-subtle">{children}</p>
}
