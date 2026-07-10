import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useWorkflow } from '../../lib/workflowStore'
import { useDemoCase } from '../../lib/useDemoCase'
import { can, rolesAllowed, officerProfiles, officerDisplayName } from '../../lib/roles'
import { FIELD_OUTCOME_LABELS, fieldOutcomeNeedsStructuredAction, formatDate, formatDateTime } from '../../services/demoWorkflowService'
import { getResidentRequestAttachmentsForCases, isSendableEmail, sendResidentEmail } from '../../services/residentRequests'
import { computeResidentPriority, normalizeTier } from '../../services/workQueue'
import { getNextRecommendedAction } from '../../services/nextRecommendedAction'
import { DecisionLogicBody, type DecisionLogicData } from '../../components/app/DecisionLogicPanel'
import {
  AutomationBadge,
  CaseSwitcher,
  ConfidenceMeter,
  GuardrailFooter,
  NoCaseState,
  StageBadge,
  WorkflowStepper,
} from '../../components/workflow/WorkflowUI'
import ResidentAttachments from '../../components/app/ResidentAttachments'
import SimilarCaseIntelligencePanel from '../../components/app/SimilarCaseIntelligencePanel'
import { featuresFromCase, type CaseFeatures, type PriorityBand } from '../../services/similarCaseIntelligence'
import type { DemoCase, NycBenchmarkSource, Priority, ResidentComplaintInput } from '../../data/demoWorkflowTypes'

// Case Workbench — assembles the gathered enforcement context and the case
// summary in one place, plus the review-readiness gate. The staff workflow is
// linear and human-in-the-loop: intake review → assign a By-law Officer → the
// officer records the field outcome → supervisor reviews and approves the
// closure. The closure draft is only prepared AFTER an officer field outcome
// exists, so the main demo path is officer-outcome-first.

const PRIORITIES: Priority[] = ['P1', 'P2', 'P3', 'P4']

/** Whole days since an ISO timestamp (0 when missing/unparseable). */
function daysSince(iso: string | null): number {
  if (!iso) return 0
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return 0
  return Math.max(0, Math.floor(ms / 86_400_000))
}

export default function AppCaseWorkbenchPage() {
  const { cases, activeCase, setActiveCase, requestMoreInfo, overridePriority, sendToStaffReview, role } =
    useWorkflow()
  const c = useDemoCase()
  const navigate = useNavigate()
  const [flash, setFlash] = useState<string | null>(null)

  // Optional staff support tools. Similar Case Intelligence is structured
  // (computed from the case features, no embeddings), so the top "Decision
  // support tools" strip just scrolls to it. Every section on this page is
  // expanded by default — nothing staff need is hidden behind a click; the
  // toggles only let staff collapse sections they don't need right now.
  const similarRef = useRef<HTMLElement>(null)
  const logicRef = useRef<HTMLElement>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const [logicOpen, setLogicOpen] = useState(true)

  // Structured operational features for Similar Case Intelligence.
  const similarFeatures = useMemo<CaseFeatures | null>(() => {
    if (!c) return null
    return featuresFromCase({
      requestType: c.normalized.complaint_type ?? c.triage.category,
      serviceCategory: c.triage.category,
      district: c.normalized.ward_or_area ?? c.input.location ?? null,
      priority: (c.priorityOverride ?? c.triage.recommendedPriority) as PriorityBand,
      createdAt: c.normalized.submitted_at ?? c.createdAt,
      status: c.normalized.status ?? c.stage,
      fieldVisitCompleted: Boolean(c.fieldAction),
      assignedOfficerName: c.assignedOfficer ?? null,
      isClosed: c.stage === 'closed',
      description: c.input.description,
    })
  }, [c])

  function findSimilar() {
    requestAnimationFrame(() => similarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  function viewLogic() {
    setLogicOpen(true)
    requestAnimationFrame(() => logicRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  // Resident evidence count — feeds the deterministic decision-logic breakdown so
  // the workbench shows the same rules-based score as the Work Queue row.
  const [residentAttachmentCount, setResidentAttachmentCount] = useState<number | null>(null)
  const caseId = c?.id ?? null
  const sourceKind = c?.source.kind ?? null
  useEffect(() => {
    if (!caseId || sourceKind !== 'resident') {
      setResidentAttachmentCount(null)
      return
    }
    let active = true
    getResidentRequestAttachmentsForCases([caseId])
      .then((atts) => active && setResidentAttachmentCount(atts.length))
      .catch(() => active && setResidentAttachmentCount(0))
    return () => {
      active = false
    }
  }, [caseId, sourceKind])

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
  const nyc = c.source.kind === 'nyc_open' ? c.source.nyc : undefined
  const isBenchmark = c.source.kind === 'nyc_open'

  // Rules-based decision logic for this case. NYC open benchmark cases carry a
  // precomputed queue score (no exposed component weights), so we show the
  // available source fields; resident intakes are fully decomposable.
  const decisionLogic: DecisionLogicData = nyc
    ? {
        score: nyc.priorityScore,
        tier: normalizeTier(nyc.priorityTier),
        reason: nyc.priorityReason,
        sourceFields: [
          { label: 'Priority score', value: nyc.priorityScore == null ? '—' : nyc.priorityScore.toFixed(0) },
          { label: 'Priority tier', value: nyc.priorityTier ?? '—' },
          { label: 'Complaint type', value: nyc.complaintType ?? '—' },
          { label: 'Age in queue', value: nyc.ageDays == null ? '—' : `${nyc.ageDays} day${nyc.ageDays === 1 ? '' : 's'}` },
          { label: 'Due date', value: nyc.dueDate ? formatDate(nyc.dueDate) : '—' },
          {
            label: 'Borough / district',
            value:
              [nyc.borough, nyc.councilDistrict ? `District ${Number(nyc.councilDistrict)}` : null]
                .filter(Boolean)
                .join(' · ') || '—',
          },
        ],
      }
    : (() => {
        const readyForClosure = Boolean(c.fieldAction) && c.stage !== 'closed'
        const inProgress = Boolean(c.assignedOfficer) && !readyForClosure && c.stage !== 'closed'
        const r = computeResidentPriority({
          priority: c.triage.recommendedPriority,
          category: c.triage.category,
          ageDays: daysSince(c.normalized.submitted_at ?? c.createdAt),
          attachmentCount: residentAttachmentCount ?? 0,
          readyForClosure,
          inProgress,
        })
        return { score: r.score, tier: r.tier, reason: r.reason, components: r.components }
      })()

  function note(msg: string) {
    setFlash(msg)
    window.setTimeout(() => setFlash((m) => (m === msg ? null : m)), 4000)
  }

  // Deterministic, stage-aware next-best-action. The first matching rule wins, so
  // it always reflects where the case is in the officer-first lifecycle.
  const nextAction = getNextRecommendedAction(c)
  const nextActionButton = (() => {
    switch (nextAction.kind) {
      case 'request_info':
        return (
          <button
            onClick={() => {
              requestMoreInfo(c.id)
              note('Marked as needing more information — logged to audit trail.')
            }}
            className="btn-primary text-sm"
          >
            Request more information
          </button>
        )
      case 'assign_officer':
        return (
          <button
            onClick={() => fieldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="btn-primary text-sm"
          >
            Assign an officer
          </button>
        )
      case 'prepare_closure':
        return (
          <button
            onClick={() => {
              sendToStaffReview(c.id)
              note('Closure draft prepared from the recorded field outcome. Sent to staff review.')
              navigate(`/app/closure?case=${c.id}`)
            }}
            className="btn-primary text-sm"
          >
            Prepare closure draft
          </button>
        )
      case 'review_closure':
        return (
          <button onClick={() => navigate(`/app/closure?case=${c.id}`)} className="btn-primary text-sm">
            Review &amp; approve closure
          </button>
        )
      default:
        // closed, wait_for_outcome, complete_structured_action, follow_up —
        // informational; no primary button (the explanation is the guidance).
        return null
    }
  })()

  return (
    <div className="container-page py-10">
      <Header cases={cases} activeId={c.id} onPick={setActiveCase} />

      <CaseSourceBar c={c} />

      {/* Who filed this — the resident's name and contact email, first thing on
          the file. NYC benchmark cases carry no resident, so nothing renders. */}
      <ResidentContactCard input={c.input} />

      {/* Primary decision support: the single next best action, why, and a staff
          control. Deterministic and stage-aware — staff confirm and can override. */}
      <section className="mt-4 card p-5 ring-1 ring-navy-100">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="badge bg-navy-50 text-navy-900 ring-1 ring-inset ring-navy-200">Next recommended action</span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">Staff decision required</span>
        </div>
        <h2 className="mt-2 text-lg font-semibold text-navy-900">{nextAction.label}</h2>
        <div className="mt-2">
          <div className="stat-label">Why this is next</div>
          <p className="mt-1 text-sm leading-relaxed text-ink">{nextAction.why}</p>
        </div>
        {nextActionButton && <div className="mt-3">{nextActionButton}</div>}
        <p className="mt-3 text-[11px] text-ink-subtle">{nextAction.staffNote}</p>
      </section>

      {isBenchmark && (
        <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50/70 px-4 py-3 text-xs leading-relaxed text-teal-900">
          This is an <span className="font-semibold">NYC open benchmark</span> case worked through the same operational
          lifecycle as resident intake. Source record remains unchanged. Any closure here is recorded in the Brampton POC
          workflow layer — it does not update NYC data.
        </div>
      )}

      {isClosed && (
        <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-navy-900">
          <svg className="mt-0.5 h-4 w-4 flex-none text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span className="font-medium">This case is closed. Actions are locked and the record is read only.</span>
        </div>
      )}

      {/* Decision support tools — optional staff helpers, surfaced near the top. */}
      <div className="mt-4 card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="stat-label mr-1">Decision support tools</span>
            <button onClick={findSimilar} className="btn-primary text-sm py-1.5 px-3">
              Find similar cases
            </button>
            <button onClick={viewLogic} className="btn-secondary text-sm py-1.5 px-3">
              View decision logic
            </button>
          </div>
          <span className="text-[11px] text-ink-subtle">Optional staff support. Does not decide outcome.</span>
        </div>
      </div>

      {/* Full lifecycle, expanded by default, with the current stage badged. */}
      <div className="mt-4">
        <CollapsibleCard title="Workflow steps" headerRight={<StageBadge stage={c.stage} />}>
          <WorkflowStepper stage={c.stage} />
        </CollapsibleCard>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <AutomationBadge kind="ai" />
        <AutomationBadge kind="review" />
        <span className="text-xs text-ink-subtle">Context gathered for review — staff confirm and decide.</span>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        {/* Left: enforcement context */}
        <div className="space-y-6 lg:col-span-2">
          <Panel
            title={isBenchmark ? 'Reported issue' : 'Resident complaint'}
            subtitle={
              isBenchmark
                ? 'Complaint type and descriptor from the NYC 311 open benchmark source record'
                : "The resident's own description of the issue, in their words"
            }
          >
            {c.input.description.trim() ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{c.input.description.trim()}</p>
            ) : (
              <p className="text-sm italic text-ink-subtle">
                No resident description was provided for this older demo record.
              </p>
            )}
          </Panel>

          {nyc && <NycSourceRecordPanel nyc={nyc} />}

          <NormalizedRecordPanel c={c} />

          {!isBenchmark && <ResidentAttachments caseId={c.id} variant="full" />}

          <CollapsibleCard title="Case summary" subtitle="Decision support summary, staff review required">
            <p className="text-sm leading-relaxed text-ink">{summary.plainLanguage}</p>
            <div className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {summary.structuredFacts.map((f) => (
                <div key={f.label} className="flex justify-between gap-3 border-b border-slate-100 py-1.5 text-sm">
                  <span className="text-ink-subtle">{f.label}</span>
                  <span className="text-right font-medium text-navy-900">{f.value}</span>
                </div>
              ))}
            </div>
          </CollapsibleCard>

          <CollapsibleCard title="Enforcement context" subtitle="Related records and context for this case">
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

            <Sub label="Local complaint history">
              {ctx.similarNearbyCases.length === 0 ? (
                <Empty>No verified nearby complaint history found for this location.</Empty>
              ) : (
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
              )}
              <p className="mt-1.5 text-[11px] text-ink-subtle">
                Verified records for this location only. Structured operational matches appear under “Similar Case
                Intelligence” below.
              </p>
            </Sub>
          </CollapsibleCard>

          <SimilarCaseIntelligencePanel features={similarFeatures} sectionRef={similarRef} />
        </div>

        {/* Right: confidence gate + staff actions */}
        <div className="space-y-6">
          {nyc && <NycReviewPriorityPanel nyc={nyc} />}

          <CollapsibleCard
            title="Decision logic"
            subtitle="Rules based review priority"
            controlledOpen={logicOpen}
            onToggle={setLogicOpen}
            sectionRef={logicRef}
          >
            <DecisionLogicBody {...decisionLogic} />
          </CollapsibleCard>

          <Panel title="File readiness" subtitle="Rules based intake-completeness signal — supporting context">
            <ConfidenceMeter value={c.triage.confidence} level={c.triage.confidenceLevel} />
            <div
              className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                c.triage.confidenceLevel === 'High'
                  ? 'border border-accent-200 bg-accent-50 text-accent-800'
                  : 'border border-amber-200 bg-amber-50 text-amber-900'
              }`}
            >
              {c.triage.confidenceLevel === 'High'
                ? 'The file has enough intake detail, policy match, and context for confident staff review.'
                : 'More intake information is needed before staff can act confidently. See the next recommended action above.'}
            </div>
          </Panel>

          <CollapsibleCard title="Attention drivers">
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
          </CollapsibleCard>

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
          <Panel title="Staff actions" subtitle="Staff decision required — you can override the recommendation">
            <div className="flex items-center gap-2 text-xs text-ink-subtle">
              <span>Effective priority:</span>
              <span className="badge bg-navy-50 text-navy-900 ring-1 ring-inset ring-navy-200">{effectivePriority}</span>
              {c.priorityOverride && <span className="text-amber-700">(overridden)</span>}
            </div>

            <div className="mt-3 grid gap-2">
              {/* The recommended primary action lives in the "Next recommended
                  action" card at the top. This panel keeps the always-available
                  secondary controls. */}
              <button
                onClick={() => {
                  requestMoreInfo(c.id)
                  note('Marked as needing more information — logged to audit trail.')
                }}
                className="btn-secondary justify-start text-sm"
              >
                Request more information
              </button>

              {isBenchmark && c.fieldAction && (
                <p className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-[11px] leading-relaxed text-teal-800">
                  Source record remains unchanged. This closure is recorded in the Brampton POC workflow layer.
                </p>
              )}
            </div>

            {/* Secondary: priority is an adjustment, not the main path. */}
            <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="stat-label">Adjust priority</span>
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
            </div>

            {flash && (
              <div className="mt-3 rounded-md border border-accent-200 bg-accent-50 px-3 py-2 text-xs text-accent-800">
                {flash}
              </div>
            )}
          </Panel>
          )}

          <div ref={fieldRef}>
            <FieldInvestigationPanel c={c} readOnly={isClosed} />
          </div>
        </div>
      </div>

      <ActionLogPanel c={c} />

      {isClosed ? (
        <div className="mt-6">
          <Link to={`/app/closure?case=${c.id}`} className="text-sm font-semibold text-accent-600 hover:text-accent-700">
            View approved closure record →
          </Link>
        </div>
      ) : c.fieldAction && !fieldOutcomeNeedsStructuredAction(c.fieldAction) ? (
        <div className="mt-6">
          <Link to={`/app/closure?case=${c.id}`} className="text-sm font-semibold text-accent-600 hover:text-accent-700">
            Continue to closure draft & staff review →
          </Link>
        </div>
      ) : null}

      <GuardrailFooter />
    </div>
  )
}

// Officer field-investigation panel — the real-world step between triage and
// closure. The supervisor/CSR assigns the case to an assignable By-law Officer
// profile (Officer Qureshi, Officer Mann, Officer Ahmed, or Officer Oakley);
// assignment is tied to that officer's login email. The officer records the
// actual on-site outcome from their own Officer Field Console. The supervisor
// never records a field outcome here.
function FieldInvestigationPanel({ c, readOnly = false }: { c: DemoCase; readOnly?: boolean }) {
  const { role, assignToOfficer } = useWorkflow()
  const canAssign = !readOnly && can(role, 'assignOfficer')
  const assigned = Boolean(c.assignedOfficer)

  // Assignable officers come from the staff profile list (officer-role profiles).
  const officers = officerProfiles()
  const [selectedEmail, setSelectedEmail] = useState(officers[0]?.email ?? '')
  const selectedOfficer = officers.find((o) => o.email === selectedEmail) ?? officers[0] ?? null

  const [flash, setFlash] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Best-effort resident email for the assignment milestone; returns a suffix for
  // the staff flash so the reviewer sees whether the resident was notified. NYC
  // benchmark cases carry no resident email, so nothing is sent for them.
  async function emailResident(
    payload: Parameters<typeof sendResidentEmail>[0],
  ): Promise<string> {
    if (!isSendableEmail(payload.to)) return ''
    const sent = await sendResidentEmail(payload)
    return sent
      ? ` Resident emailed at ${payload.to}.`
      : ' (Resident email could not be sent in this environment.)'
  }

  async function handleAssign() {
    if (!selectedOfficer) return
    setBusy(true)
    // Assign to a real officer profile (officer display name + login email) —
    // never an invented identity. The assignment is tied to the officer's email,
    // so only that signed-in officer can record the field outcome.
    assignToOfficer(c.id, { name: officerDisplayName(selectedOfficer), email: selectedOfficer.email })
    const suffix = await emailResident({
      type: 'status_update',
      status: 'assigned',
      to: c.input.residentEmail.trim(),
      residentName: c.input.residentName,
      caseId: c.id,
      requestType: c.triage.category,
      location: c.input.location,
    })
    setFlash(`Assigned to ${officerDisplayName(selectedOfficer)}.${suffix}`)
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

  return (
    <Panel title="Field investigation status" subtitle="Supervisor assigns the officer here; the officer records the on-site outcome in their console">
      {assigned ? (
        <>
          <dl className="space-y-1.5 text-sm">
            <Row label="Assigned officer" value={c.assignedOfficer ?? '—'} />
          </dl>
          <p className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
            Assigned to {c.assignedOfficer}. The officer can record the field outcome from their Officer Field Console.
          </p>
        </>
      ) : canAssign ? (
        <div>
          <label className="block text-sm">
            <span className="stat-label">Assign to officer</span>
            <select
              value={selectedEmail}
              onChange={(e) => setSelectedEmail(e.target.value)}
              disabled={busy || officers.length <= 1}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-navy-900 focus:border-accent-500 focus:outline-none disabled:bg-slate-50"
            >
              {officers.map((o) => (
                <option key={o.email} value={o.email}>
                  {officerDisplayName(o)}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={handleAssign}
            disabled={busy || !selectedOfficer}
            className="btn-primary mt-3 text-sm disabled:opacity-60"
          >
            {busy ? 'Assigning…' : `Assign to ${selectedOfficer ? officerDisplayName(selectedOfficer) : 'officer'}`}
          </button>
          <p className="mt-2 text-[11px] text-ink-subtle">
            The supervisor assigns the case; the assigned officer records the field outcome from their Officer Field
            Console. Supervisors do not record field outcomes here.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-ink-subtle">Assigning is restricted to {rolesAllowed('assignOfficer')}.</p>
      )}

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
      <dt className="shrink-0 text-ink-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-navy-900">{value}</dd>
    </div>
  )
}

// Source badge styles for the three operational sources.
const SOURCE_BADGE_STYLES: Record<DemoCase['source']['kind'], string> = {
  resident: 'bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200',
  nyc_open: 'bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-200',
  historical: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200',
}

/**
 * Resident contact — first name, last name, and the email used to file the
 * request, shown as the first card on every resident case. Older records that
 * only carry a combined name fall back to splitting it on the first space.
 * Renders nothing when there is no resident on file (NYC benchmark cases).
 */
function ResidentContactCard({ input }: { input: ResidentComplaintInput }) {
  const fullName = input.residentName.trim()
  const email = input.residentEmail.trim()
  if (!fullName && !email) return null
  const firstName = input.residentFirstName?.trim() || fullName.split(/\s+/)[0] || ''
  const lastName = input.residentLastName?.trim() || fullName.split(/\s+/).slice(1).join(' ')
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || '?'
  return (
    <section className="mt-4 card p-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy-50 text-sm font-bold text-navy-800 ring-1 ring-inset ring-navy-200"
          >
            {initials}
          </span>
          <span className="stat-label">Resident contact</span>
        </div>
        <div>
          <div className="stat-label">First name</div>
          <div className="text-sm font-semibold text-navy-900">{firstName || '—'}</div>
        </div>
        <div>
          <div className="stat-label">Last name</div>
          <div className="text-sm font-semibold text-navy-900">{lastName || '—'}</div>
        </div>
        <div className="min-w-0">
          <div className="stat-label">Email used</div>
          {email ? (
            <a
              href={`mailto:${email}`}
              className="block max-w-full truncate text-sm font-semibold text-accent-700 hover:text-accent-800 hover:underline"
            >
              {email}
            </a>
          ) : (
            <div className="text-sm text-ink-subtle">No email on file</div>
          )}
        </div>
      </div>
    </section>
  )
}

/** A clear, source-labelled bar under the workbench header. */
function CaseSourceBar({ c }: { c: DemoCase }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="font-mono text-sm font-semibold text-navy-900">{c.id}</span>
      <span className={`badge ${SOURCE_BADGE_STYLES[c.source.kind]}`}>{c.source.label}</span>
      <span className="badge bg-slate-100 text-slate-700">{c.normalized.complaint_type ?? '—'}</span>
      <span className="text-xs text-ink-subtle">
        One operational workflow — resident intake and NYC open benchmark cases share this lifecycle.
      </span>
    </div>
  )
}

/** Verbatim NYC 311 source record for an open benchmark case (collapsible). */
function NycSourceRecordPanel({ nyc }: { nyc: NycBenchmarkSource }) {
  const coords =
    nyc.latitude != null && nyc.longitude != null ? `${nyc.latitude.toFixed(5)}, ${nyc.longitude.toFixed(5)}` : null
  const rows: { label: string; value: string | null }[] = [
    { label: 'Status', value: nyc.status },
    { label: 'Complaint type', value: nyc.complaintType },
    { label: 'Descriptor', value: nyc.descriptor },
    { label: 'Agency', value: nyc.agency },
    { label: 'Source channel', value: nyc.sourceChannel },
    { label: 'Borough', value: nyc.borough },
    { label: 'Council district', value: nyc.councilDistrict ? String(Number(nyc.councilDistrict)) : null },
    { label: 'Location', value: nyc.location },
    { label: 'Location type', value: nyc.locationType },
    { label: 'Address type', value: nyc.addressType },
    { label: 'Incident address', value: nyc.incidentAddress },
    { label: 'Cross streets', value: nyc.crossStreets },
    { label: 'City', value: nyc.city },
    { label: 'ZIP', value: nyc.incidentZip },
    { label: 'Coordinates', value: coords },
    { label: 'Submitted', value: nyc.submittedAt ? formatDate(nyc.submittedAt) : null },
    { label: 'Due date', value: nyc.dueDate ? formatDate(nyc.dueDate) : null },
    { label: 'Age', value: nyc.ageDays == null ? null : `${nyc.ageDays} days` },
    { label: 'Resolution action updated', value: nyc.resolutionActionUpdatedDate ? formatDate(nyc.resolutionActionUpdatedDate) : null },
    // resolution_description is NOT a reliable closure indicator in the open NYC
    // dataset, so it is shown as the public source response — never the raw
    // "Resolution description" label, which stays in the raw record view only.
    { label: 'NYC source response', value: nyc.resolutionDescription },
    { label: 'Source dataset ID / unique key', value: nyc.uniqueKey },
  ].filter((r) => r.value != null)

  return (
    <section className="card p-5">
      <h3 className="text-sm font-semibold text-navy-900">Source record details</h3>
      <p className="text-xs text-ink-subtle">Verbatim public NYC 311 source record — unchanged by this workflow.</p>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="min-w-0">
            <dt className="text-[10px] uppercase tracking-wider text-ink-subtle">{r.label}</dt>
            <dd className="mt-0.5 break-words text-sm text-ink">{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** Review-priority signal for an NYC open benchmark case — rules based, not AI generated. */
function NycReviewPriorityPanel({ nyc }: { nyc: NycBenchmarkSource }) {
  return (
    <Panel title="Review priority" subtitle="Rules based internal priority, not AI generated">
      <dl className="space-y-1.5 text-sm">
        <Row label="Score" value={nyc.priorityScore == null ? '—' : nyc.priorityScore.toFixed(0)} />
        <Row label="Tier" value={nyc.priorityTier ?? '—'} />
      </dl>
      {nyc.priorityReason && <p className="mt-2 text-xs text-ink-muted">{nyc.priorityReason}</p>}
      <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
        Review priority is a rules based internal ranking that helps staff decide what to look at first. It is{' '}
        <span className="font-semibold">not</span> a field from the NYC 311 source record, and not AI generated.
      </p>
    </Panel>
  )
}

/** The shared normalized service-request record (open by default, collapsible) — same schema for every source. */
function NormalizedRecordPanel({ c }: { c: DemoCase }) {
  const n = c.normalized
  const closureStatus = c.stage === 'closed' ? 'closed' : n.closure_status
  const rows: { label: string; value: string | null }[] = [
    { label: 'case_id', value: n.case_id },
    { label: 'source', value: n.source },
    { label: 'submitted_at', value: n.submitted_at ? formatDate(n.submitted_at) : null },
    { label: 'status', value: n.status },
    { label: 'complaint_type', value: n.complaint_type },
    { label: 'request_detail', value: n.request_detail },
    { label: 'location_type', value: n.location_type },
    { label: 'address_or_location', value: n.address_or_location },
    { label: 'ward_or_area', value: n.ward_or_area },
    { label: 'assigned_department', value: n.assigned_department },
    { label: 'priority_score', value: n.priority_score == null ? null : String(n.priority_score) },
    { label: 'priority_reason', value: n.priority_reason },
    { label: 'resolution_description', value: n.resolution_description },
    { label: 'closure_status', value: closureStatus },
  ]
  return (
    <details open className="group card p-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-5 py-4">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-navy-900">Normalized service request</span>
          <span className="block text-xs text-ink-subtle">
            The shared internal schema every source maps to — resident intake and NYC benchmark alike.
          </span>
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle transition-transform group-open:rotate-180">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="border-t border-slate-100 px-5 py-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.label} className="min-w-0">
              <dt className="font-mono text-[10px] uppercase tracking-wider text-ink-subtle">{r.label}</dt>
              <dd className="mt-0.5 break-words text-sm text-ink">{r.value ?? '—'}</dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  )
}

// Audit-actor badge tints for the action log.
const ACTOR_STYLES: Record<string, string> = {
  ai: 'bg-accent-50 text-accent-800 ring-1 ring-inset ring-accent-200',
  staff: 'bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200',
  officer: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200',
  resident: 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200',
  system: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200',
}

/** Full, chronological action log (audit trail) for the case. */
function ActionLogPanel({ c }: { c: DemoCase }) {
  const events = [...c.audit].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  return (
    <details open className="group mt-6 card p-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-5 py-4">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-navy-900">Action log</span>
          <span className="block text-xs text-ink-subtle">
            Every workflow action on this case, in order — decision support and human decisions alike.
          </span>
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle transition-transform group-open:rotate-180">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="border-t border-slate-100 px-5 py-4">
        {events.length === 0 ? (
          <p className="text-sm text-ink-subtle">No actions recorded yet.</p>
        ) : (
          <ol className="space-y-3">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3">
                <div className="mt-0.5 shrink-0">
                  <span className={`badge ${ACTOR_STYLES[e.actor] ?? ACTOR_STYLES.system}`}>{e.actorLabel}</span>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium text-navy-900">{e.type}</span>
                    <span className="text-[11px] tabular-nums text-ink-subtle">{formatDateTime(e.at)}</span>
                  </div>
                  <p className="text-sm text-ink-muted">{e.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  )
}

function Header({ cases, activeId, onPick }: { cases: DemoCase[]; activeId: string | null; onPick: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        <div className="section-eyebrow">Case workbench</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">Case Workbench</h1>
        <p className="mt-2 text-ink-muted">
          Enforcement context, case summary, and review readiness — decision support for staff.
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

// A card whose body can be collapsed behind its header. EXPANDED by default —
// staff see everything without clicking; the toggle only lets them tuck away
// sections they don't need right now. Uncontrolled (own open state) unless
// `controlledOpen` + `onToggle` are supplied, which lets the top action strip
// open a specific section and scroll to it.
function CollapsibleCard({
  title,
  subtitle,
  headerRight,
  children,
  defaultOpen = true,
  controlledOpen,
  onToggle,
  sectionRef,
}: {
  title: string
  subtitle?: string
  headerRight?: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
  controlledOpen?: boolean
  onToggle?: (open: boolean) => void
  sectionRef?: React.Ref<HTMLElement>
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const open = controlledOpen ?? internalOpen
  const toggle = () => (onToggle ? onToggle(!open) : setInternalOpen((o) => !o))
  return (
    <section ref={sectionRef} className="card p-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-navy-900">{title}</span>
          {subtitle && <span className="block text-xs text-ink-subtle">{subtitle}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {headerRight}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className={`h-4 w-4 text-ink-subtle transition-transform ${open ? 'rotate-180' : ''}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>
      {open && <div className="border-t border-slate-100 px-5 py-4">{children}</div>}
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
