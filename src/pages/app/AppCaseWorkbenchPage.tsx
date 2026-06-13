import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useWorkflow } from '../../lib/workflowStore'
import { useDemoCase } from '../../lib/useDemoCase'
import {
  AutomationBadge,
  CaseSwitcher,
  ConfidenceMeter,
  GuardrailFooter,
  NoCaseState,
  WorkflowStepper,
} from '../../components/workflow/WorkflowUI'
import type { DemoCase, Priority } from '../../data/demoWorkflowTypes'

// Case Workbench — assembles the AI's gathered enforcement context and the
// case summary in one place, plus the confidence gate from the diagram. Staff
// act here on exceptions: approve routing, request more information, override
// priority, and send the case to staff review (which prepares the closure
// draft). This is where "AI reduces manual research" should feel obvious.

const PRIORITIES: Priority[] = ['P1', 'P2', 'P3', 'P4']

export default function AppCaseWorkbenchPage() {
  const { cases, activeCase, setActiveCase, approveRouting, requestMoreInfo, overridePriority, sendToStaffReview } =
    useWorkflow()
  const c = useDemoCase()
  const navigate = useNavigate()
  const [flash, setFlash] = useState<string | null>(null)

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

  function note(msg: string) {
    setFlash(msg)
    window.setTimeout(() => setFlash((m) => (m === msg ? null : m)), 4000)
  }

  return (
    <div className="container-page py-10">
      <Header cases={cases} activeId={c.id} onPick={setActiveCase} />

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
          <Panel title="Case summary" subtitle="Plain-language summary assembled by the AI system">
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
          <Panel title="Confidence gate" subtitle="Enough confidence?">
            <ConfidenceMeter value={c.triage.confidence} level={c.triage.confidenceLevel} />
            <div
              className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                c.triage.confidenceLevel === 'High'
                  ? 'border border-accent-200 bg-accent-50 text-accent-800'
                  : 'border border-amber-200 bg-amber-50 text-amber-900'
              }`}
            >
              {c.triage.confidenceLevel === 'High'
                ? 'Yes → routed to Staff Review with a prepared closure draft.'
                : 'No → routed to Needs Staff Attention. Resolve drivers below, then send to review.'}
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
                  note('Closure draft prepared. Sent to staff review.')
                  navigate(`/app/closure?case=${c.id}`)
                }}
                className="btn-primary justify-start text-sm"
              >
                Prepare closure draft → send to staff review
              </button>
            </div>

            {flash && (
              <div className="mt-3 rounded-md border border-accent-200 bg-accent-50 px-3 py-2 text-xs text-accent-800">
                {flash}
              </div>
            )}
          </Panel>
        </div>
      </div>

      <div className="mt-6">
        <Link to={`/app/closure?case=${c.id}`} className="text-sm font-semibold text-accent-600 hover:text-accent-700">
          Continue to closure draft & staff review →
        </Link>
      </div>

      <GuardrailFooter />
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
