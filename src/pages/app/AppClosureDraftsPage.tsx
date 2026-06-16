import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useWorkflow } from '../../lib/workflowStore'
import { useDemoCase } from '../../lib/useDemoCase'
import { isSupabaseConfigured } from '../../lib/supabase'
import { FIELD_OUTCOME_LABELS, formatDateTime } from '../../services/demoWorkflowService'
import {
  isSendableEmail,
  markResidentRequestClosedFromClosureReview,
  sendResidentEmail,
} from '../../services/residentRequests'
import { can, rolesAllowed } from '../../lib/roles'
import {
  AutomationBadge,
  CaseSwitcher,
  GuardrailFooter,
  NoCaseState,
  WorkflowStepper,
} from '../../components/workflow/WorkflowUI'
import type { DemoCase } from '../../data/demoWorkflowTypes'

// Closure Drafts — the staff review page. The system assembled a policy-aligned
// closure draft from approved rules, templates, and the recorded field outcome;
// staff review, edit, and approve. On approval the case is closed, an audit
// event is recorded, the staff-approved closure response is emailed to the
// resident (when deliverable), and — for real resident requests (RSR-…) — the
// linked resident_service_requests row is marked closed in Supabase (without a
// second generic email).

type SendResult = { attempted: boolean; emailSent: boolean; to: string }

export default function AppClosureDraftsPage() {
  const { cases, activeCase, setActiveCase, editDraftBody, approveClosure, sendToStaffReview } = useWorkflow()
  const c = useDemoCase()
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<SendResult | null>(null)
  const [statusWarning, setStatusWarning] = useState<string | null>(null)

  // Approve the closure: persist any staff edit, email the resident the approved
  // response (when deliverable), mark the linked Supabase resident request closed
  // (for RSR- cases, with no second email), then close the case locally.
  async function handleApprove(caseObj: DemoCase, body: string) {
    if (!caseObj.draft || sending) return
    if (body !== caseObj.draft.body) editDraftBody(caseObj.id, body)

    const to = caseObj.input.residentEmail.trim()
    const attempted = isSendableEmail(to)
    let emailSent = false
    let warning: string | null = null

    setSending(true)
    try {
      if (attempted) {
        emailSent = await sendResidentEmail({
          type: 'closure',
          to,
          residentName: caseObj.input.residentName,
          caseId: caseObj.id,
          requestType: caseObj.triage.category,
          location: caseObj.input.location,
          subject: caseObj.draft.subject,
          message: body,
        })
      }

      // Sync the linked resident request to closed in Supabase — real resident
      // submissions only (RSR-…). No second email is sent from here. A failure
      // must not block the local closure approval; surface it as a warning.
      if (caseObj.id.startsWith('RSR-')) {
        if (!isSupabaseConfigured) {
          warning =
            'The closure email may have been sent, but Supabase is not configured in this environment, so the resident request status could not be updated to closed.'
        } else {
          try {
            await markResidentRequestClosedFromClosureReview(caseObj.id)
          } catch (err) {
            console.error('Failed to mark resident request closed in Supabase:', err)
            warning =
              'The closure email may have been sent, but the resident request status could not be updated to closed in Supabase. You can close it from Resident Intake.'
          }
        }
      }
    } finally {
      approveClosure(caseObj.id, { attempted, emailSent })
      setSendResult({ attempted, emailSent, to })
      setStatusWarning(warning)
      setSending(false)
    }
  }

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

  return (
    <div className="container-page py-10">
      <Header cases={cases} activeId={c.id} onPick={setActiveCase} />

      <div className="mt-6 card p-5">
        <WorkflowStepper stage={c.stage} />
      </div>

      {c.stage === 'closed' ? (
        <ResidentUpdateView c={c} sendResult={sendResult} statusWarning={statusWarning} />
      ) : c.draft ? (
        <ReviewView c={c} sending={sending} onApprove={(body) => handleApprove(c, body)} />
      ) : (
        <NeedsDraftView c={c} onPrepare={() => sendToStaffReview(c.id)} />
      )}

      <GuardrailFooter />
    </div>
  )
}

function ReviewView({ c, sending, onApprove }: { c: DemoCase; sending: boolean; onApprove: (body: string) => void }) {
  const draft = c.draft!
  const { role } = useWorkflow()
  const canApprove = can(role, 'approveClosure')
  const [body, setBody] = useState(draft.body)
  const [internal, setInternal] = useState('')

  // Keep the local editor in sync if the focused case changes.
  useEffect(() => {
    setBody(c.draft?.body ?? '')
  }, [c.id, c.draft?.body])

  const willEmail = isSendableEmail(c.input.residentEmail)

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <AutomationBadge kind="review" />
        <AutomationBadge kind="approval" />
        <span className="text-xs text-ink-subtle">
          Assembled from approved templates and the recorded case facts. Staff review, edit, and approve.
        </span>
      </div>

      {/* What the letter is actually based on — a recorded field outcome, or a
          review-only closure with no officer claim. */}
      {c.fieldAction ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
          <span className="font-semibold">Based on a recorded field visit:</span>{' '}
          {FIELD_OUTCOME_LABELS[c.fieldAction.outcome]} by {c.fieldAction.officerName} on{' '}
          {formatDateTime(c.fieldAction.visitedAt)}
          {c.fieldAction.referenceNumber ? ` · ${c.fieldAction.referenceNumber}` : ''}. The letter states this outcome.
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <span className="font-semibold">Review-only closure.</span> No officer field visit is on file, so the letter
          does not claim an officer attended. Assign an officer in the Case Workbench if a site visit is needed first.
        </div>
      )}

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        {/* AI summary recap */}
        <div className="space-y-6">
          <Panel title="AI case summary">
            <p className="text-sm leading-relaxed text-ink">{c.summary.plainLanguage}</p>
            <div className="mt-3">
              <Link to={`/app/workbench?case=${c.id}`} className="text-xs font-semibold text-accent-600 hover:text-accent-700">
                View full context →
              </Link>
            </div>
          </Panel>

          <Panel title="Policy alignment">
            <Checklist items={draft.policyChecklist} />
          </Panel>
          <Panel title="Resident-friendly tone">
            <Checklist items={draft.toneChecklist} />
          </Panel>
        </div>

        {/* Editable draft */}
        <div className="lg:col-span-2 space-y-6">
          <Panel title="Rules based closure draft" subtitle={`Generated by ${draft.generatedBy} · ${formatDateTime(draft.generatedAt)}`}>
            <div className="mb-2 text-sm">
              <span className="text-ink-subtle">Subject: </span>
              <span className="font-medium text-navy-900">{draft.subject}</span>
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={16}
              className="w-full rounded-lg border border-slate-300 p-3 font-sans text-sm leading-relaxed text-ink focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
            />
            <p className="mt-2 text-xs text-ink-subtle">
              {body === draft.body ? 'Unedited template draft.' : 'Edited by staff — your changes will be saved on approval.'}
            </p>
          </Panel>

          {/* Resident message governance — clarifies the outbound message is
              template-controlled and staff-approved, with AI limited to summary
              and context (not freeform generation of the resident letter). */}
          <div className="rounded-lg border border-navy-200 bg-navy-50 px-4 py-3 text-xs text-navy-900">
            <span className="font-semibold">Resident message governance:</span> this closure response is assembled from
            approved template logic and recorded case facts. AI assists with summary and context, but the outbound
            resident message is staff approved and template controlled.
          </div>

          <Panel title="Internal notes">
            <ul className="space-y-1.5">
              {draft.internalNotes.map((n) => (
                <li key={n} className="flex gap-2 text-sm text-ink-muted">
                  <span className="mt-0.5 text-ink-subtle">›</span>
                  {n}
                </li>
              ))}
            </ul>
            <textarea
              value={internal}
              onChange={(e) => setInternal(e.target.value)}
              rows={2}
              placeholder="Add an internal note (demo only)…"
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
            />
          </Panel>

          <div className="card border-accent-200 bg-accent-50/40 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-navy-900">Approve final response</h3>
                <p className="text-xs text-ink-muted">
                  {canApprove ? (
                    <>
                      Human-in-the-loop approval.{' '}
                      {willEmail
                        ? `On approval, this response is emailed to ${c.input.residentEmail}.`
                        : 'No deliverable resident email is on file, so the case is closed without sending an email.'}
                    </>
                  ) : (
                    <>Closure approval is restricted to {rolesAllowed('approveClosure')}. Switch role to “Supervisor”.</>
                  )}
                </p>
              </div>
              <button
                onClick={() => onApprove(body)}
                disabled={sending || !canApprove}
                title={canApprove ? undefined : `Only ${rolesAllowed('approveClosure')} can approve a closure`}
                className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {sending ? 'Approving & sending…' : 'Approve final response →'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function NeedsDraftView({ c, onPrepare }: { c: DemoCase; onPrepare: () => void }) {
  return (
    <div className="mt-6 card p-8 text-center">
      <span className="badge bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200">Needs staff attention</span>
      <h2 className="mt-3 text-base font-semibold text-navy-900">No closure draft prepared yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
        This case was routed to staff attention at the confidence gate. Resolve the attention drivers in the workbench,
        then prepare a closure draft for review.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <button onClick={onPrepare} className="btn-primary">
          Prepare closure draft now
        </button>
        <Link to={`/app/workbench?case=${c.id}`} className="btn-secondary">
          Open case workbench
        </Link>
      </div>
    </div>
  )
}

function ResidentUpdateView({
  c,
  sendResult,
  statusWarning,
}: {
  c: DemoCase
  sendResult: SendResult | null
  statusWarning: string | null
}) {
  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <span className="badge bg-accent-100 text-accent-900 ring-1 ring-inset ring-accent-300">Closed</span>
        <span className="text-xs text-ink-subtle">
          {sendResult?.attempted && sendResult.emailSent
            ? 'Approved by a human. Closure response emailed to the resident.'
            : 'Approved by a human. Case closed and recorded in the audit trail.'}
        </span>
      </div>

      <ResidentEmailNotice sendResult={sendResult} />

      {statusWarning && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <span className="font-semibold">Resident request status not updated.</span> {statusWarning}
        </div>
      )}

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <Panel title="Approval record">
          <dl className="space-y-2 text-sm">
            <Row label="Approved by" value={c.approvedBy ?? '—'} />
            <Row label="Approved at" value={c.approvedAt ? formatDateTime(c.approvedAt) : '—'} />
            <Row label="Case status" value="Closed" />
            <Row label="Audit event" value="Recorded" />
          </dl>
          <div className="mt-4">
            <Link to={`/app/audit?case=${c.id}`} className="text-xs font-semibold text-accent-600 hover:text-accent-700">
              View audit trail →
            </Link>
          </div>
        </Panel>

        <div className="lg:col-span-2">
          <Panel title="Resident receives closure update" subtitle="Clear, personalized, transparent response">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="border-b border-slate-100 pb-2 text-sm">
                <div><span className="text-ink-subtle">To: </span><span className="text-navy-900">{c.input.residentEmail || 'resident@example.com'}</span></div>
                <div><span className="text-ink-subtle">Subject: </span><span className="font-medium text-navy-900">{c.draft?.subject}</span></div>
              </div>
              <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">{c.closureMessage}</pre>
            </div>
            <p className="mt-3 text-xs text-ink-subtle">
              {sendResult?.attempted && sendResult.emailSent
                ? `This closure response was emailed to ${sendResult.to}. If it is not in the inbox, check the junk or spam folder.`
                : sendResult?.attempted
                  ? 'The closure email could not be sent in this environment — the email service is not configured here.'
                  : 'No deliverable resident email was on file (demo placeholder address), so nothing was emailed.'}
            </p>
          </Panel>
        </div>
      </div>
    </>
  )
}

// Prominent banner summarizing whether the resident closure email actually went
// out. Driven by the real send result from the Netlify email function.
function ResidentEmailNotice({ sendResult }: { sendResult: SendResult | null }) {
  if (!sendResult) {
    // Reached e.g. after a page refresh on an already-closed case: the live send
    // result is gone, but the audit trail holds the recorded outcome.
    return (
      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-ink-muted">
        Case closed. See the audit trail for the resident-email delivery result.
      </div>
    )
  }
  if (sendResult.attempted && sendResult.emailSent) {
    return (
      <div className="mt-3 rounded-lg border border-accent-200 bg-accent-50 px-4 py-2.5 text-xs text-accent-800">
        <span className="font-semibold">Closure email sent</span> to {sendResult.to}. The resident has been notified.
      </div>
    )
  }
  if (sendResult.attempted) {
    return (
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
        <span className="font-semibold">Closure email not sent.</span> The case is closed, but the email service is not
        configured in this environment, so the resident was not emailed.
      </div>
    )
  }
  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
      <span className="font-semibold">No email sent.</span> This case has no deliverable resident email (demo
      placeholder address), so the closure response was not emailed.
    </div>
  )
}

function Header({ cases, activeId, onPick }: { cases: DemoCase[]; activeId: string | null; onPick: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        <div className="section-eyebrow">Step 4 · Staff review & approval</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">Closure Drafts</h1>
        <p className="mt-2 text-ink-muted">
          The system assembled a policy aligned closure draft from approved rules, templates, and the recorded field
          outcome. Staff review, edit, and approve before anything is sent.
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

function Checklist({ items }: { items: { item: string; ok: boolean }[] }) {
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.item} className="flex items-start gap-2 text-sm">
          <span className={i.ok ? 'text-accent-600' : 'text-amber-500'}>{i.ok ? '✓' : '!'}</span>
          <span className={i.ok ? 'text-ink' : 'text-amber-800'}>{i.item}</span>
        </li>
      ))}
    </ul>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1.5">
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="text-right font-medium text-navy-900">{value}</dd>
    </div>
  )
}
