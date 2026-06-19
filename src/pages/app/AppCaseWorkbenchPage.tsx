import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useWorkflow } from '../../lib/workflowStore'
import { useDemoCase } from '../../lib/useDemoCase'
import { can, rolesAllowed, DEMO_OFFICER } from '../../lib/roles'
import { FIELD_OUTCOME_LABELS, formatDate, formatDateTime } from '../../services/demoWorkflowService'
import { getResidentRequestAttachmentsForCases, isSendableEmail, sendResidentEmail } from '../../services/residentRequests'
import { computeResidentPriority, normalizeTier } from '../../services/workQueue'
import DecisionLogicPanel, { type DecisionLogicData } from '../../components/app/DecisionLogicPanel'
import {
  AutomationBadge,
  CaseSwitcher,
  ConfidenceMeter,
  GuardrailFooter,
  NoCaseState,
  WorkflowStepper,
} from '../../components/workflow/WorkflowUI'
import ResidentAttachments from '../../components/app/ResidentAttachments'
import type { DemoCase, NycBenchmarkSource, Priority } from '../../data/demoWorkflowTypes'

// Case Workbench — assembles the gathered enforcement context and the case
// summary in one place, plus the review-readiness gate. Staff act here: approve
// routing, request more information, override priority, and send the case to
// staff review (which prepares the closure draft).

const PRIORITIES: Priority[] = ['P1', 'P2', 'P3', 'P4']

/** Whole days since an ISO timestamp (0 when missing/unparseable). */
function daysSince(iso: string | null): number {
  if (!iso) return 0
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return 0
  return Math.max(0, Math.floor(ms / 86_400_000))
}

export default function AppCaseWorkbenchPage() {
  const { cases, activeCase, setActiveCase, approveRouting, requestMoreInfo, overridePriority, sendToStaffReview, role } =
    useWorkflow()
  const c = useDemoCase()
  const navigate = useNavigate()
  const [flash, setFlash] = useState<string | null>(null)

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

  return (
    <div className="container-page py-10">
      <Header cases={cases} activeId={c.id} onPick={setActiveCase} />

      <CaseSourceBar c={c} />

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

      <div className="mt-6 card p-5">
        <WorkflowStepper stage={c.stage} />
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

          <Panel title="Case summary" subtitle="AI assisted summary, staff review required">
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

          <Panel title="Enforcement context" subtitle="Related records and context for this case">
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
          {nyc && <NycReviewPriorityPanel nyc={nyc} />}

          <DecisionLogicPanel data={decisionLogic} />

          <Panel title="AI review readiness" subtitle="AI assisted file readiness, staff confirm and decide">
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
              {isBenchmark && (
                <p className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-[11px] leading-relaxed text-teal-800">
                  Source record remains unchanged. This closure is recorded in the Brampton POC workflow layer.
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

      <ActionLogPanel c={c} />

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

// Officer field-investigation panel — the real-world step between triage and
// closure. The supervisor/CSR assigns the case to the single demo By-law Officer
// (Officer Oakley); the officer records the actual on-site outcome from their
// own Officer Field Console. The supervisor never records a field outcome here.
function FieldInvestigationPanel({ c, readOnly = false }: { c: DemoCase; readOnly?: boolean }) {
  const { role, assignToOfficer } = useWorkflow()
  const canAssign = !readOnly && can(role, 'assignOfficer')
  const assigned = Boolean(c.assignedOfficer)

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
    setBusy(true)
    // One demo officer: always Officer Oakley. No invented officer identities.
    assignToOfficer(c.id, DEMO_OFFICER.name)
    const suffix = await emailResident({
      type: 'status_update',
      status: 'assigned',
      to: c.input.residentEmail.trim(),
      residentName: c.input.residentName,
      caseId: c.id,
      requestType: c.triage.category,
      location: c.input.location,
    })
    setFlash(`Assigned to ${DEMO_OFFICER.name}.${suffix}`)
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
    <Panel title="Field investigation" subtitle="Supervisor assigns; the officer records the on-site outcome">
      <dl className="space-y-1.5 text-sm">
        <Row label="Assigned officer" value={DEMO_OFFICER.name} />
      </dl>

      {assigned ? (
        <p className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
          Assigned to {DEMO_OFFICER.name}. Officer can record the field outcome from the Officer Field Console.
        </p>
      ) : canAssign ? (
        <div className="mt-3">
          <button onClick={handleAssign} disabled={busy} className="btn-primary text-sm disabled:opacity-60">
            {busy ? 'Assigning…' : `Assign to ${DEMO_OFFICER.name}`}
          </button>
          <p className="mt-2 text-[11px] text-ink-subtle">
            The supervisor assigns the case; {DEMO_OFFICER.name} records the field outcome from the Officer Field
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
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="text-right font-medium text-navy-900">{value}</dd>
    </div>
  )
}

// Source badge styles for the three operational sources.
const SOURCE_BADGE_STYLES: Record<DemoCase['source']['kind'], string> = {
  resident: 'bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200',
  nyc_open: 'bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-200',
  historical: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200',
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

/** The shared normalized service-request record (collapsible) — same schema for every source. */
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
    <details className="group card p-0">
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
    <details className="group mt-6 card p-0" open>
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
