import { Link } from 'react-router-dom'
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
import type { DemoCase } from '../../data/demoWorkflowTypes'

// Triage Automation — shows everything the deterministic decision-support
// workflow produced from the raw intake: classification, location extraction, key facts, a
// missing-information check, duplicate risk, recommended department / priority /
// stage, confidence level, and reasoning notes. Badges make it obvious which
// outputs are automated vs. where staff review / approval is required.

const DUP_STYLES: Record<string, string> = {
  None: 'bg-slate-100 text-slate-700',
  Low: 'bg-slate-100 text-slate-700',
  Possible: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  Likely: 'bg-orange-50 text-orange-800 ring-1 ring-inset ring-orange-200',
}

export default function AppTriageAutomationPage() {
  const { cases, activeCase, setActiveCase } = useWorkflow()
  const c = useDemoCase()

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

  const t = c.triage

  return (
    <div className="container-page py-10">
      <Header cases={cases} activeId={c.id} onPick={setActiveCase} />

      <div className="mt-6 card p-5">
        <WorkflowStepper stage={c.stage} />
      </div>

      {/* Resident intake recap */}
      <div className="mt-6 card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-navy-900">What the resident submitted</h2>
          <span className="badge bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200">Human input</span>
        </div>
        <p className="mt-3 text-sm text-ink">{c.input.description}</p>
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Meta label="Location" value={c.input.location || 'Not provided'} />
          <Meta label="Channel" value={c.input.channel} />
          <Meta label="Photo" value={c.input.hasPhoto ? 'Attached' : 'None'} />
        </dl>
      </div>

      {/* AI outputs */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <AutomationBadge kind="ai" />
        {t.confidenceLevel === 'High' ? (
          <AutomationBadge kind="approval" />
        ) : (
          <AutomationBadge kind="review" />
        )}
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Panel title="Classification & routing">
            <div className="grid gap-4 sm:grid-cols-2">
              <Stat label="Complaint type" value={t.category} sub={`${(t.categoryConfidence * 100).toFixed(0)}% classification confidence`} />
              <Stat label="Extracted location" value={t.extractedLocation ?? 'Not detected'} />
              <Stat label="Recommended department" value={t.recommendedDepartment} />
              <Stat label="Recommended priority" value={t.recommendedPriority} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink-subtle">Duplicate risk:</span>
              <span className={`badge ${DUP_STYLES[t.duplicateRisk]}`}>{t.duplicateRisk}</span>
            </div>
          </Panel>

          <Panel title="Key facts extracted">
            <ul className="space-y-2">
              {t.keyFacts.map((f) => (
                <li key={f} className="flex gap-2 text-sm text-ink">
                  <span className="mt-0.5 text-accent-600">✓</span>
                  {f}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Reasoning notes">
            <ul className="space-y-2">
              {t.reasoning.map((r) => (
                <li key={r} className="flex gap-2 text-sm text-ink-muted">
                  <span className="mt-0.5 text-ink-subtle">›</span>
                  {r}
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Confidence check">
            <ConfidenceMeter value={t.confidence} level={t.confidenceLevel} />
            <p className="mt-3 text-xs text-ink-muted">
              {t.confidenceLevel === 'High'
                ? 'High confidence — a closure-response draft was prepared for staff review.'
                : 'Below threshold — routed to staff attention before any draft is prepared.'}
            </p>
            <div className="mt-4">
              <Link
                to={t.confidenceLevel === 'High' ? `/app/closure?case=${c.id}` : `/app/workbench?case=${c.id}`}
                className="btn-primary w-full text-sm"
              >
                {t.confidenceLevel === 'High' ? 'Go to staff review →' : 'Open case workbench →'}
              </Link>
            </div>
          </Panel>

          <Panel title="Missing-information check">
            {t.missingInformation.length === 0 ? (
              <p className="text-sm text-accent-700">No missing information detected.</p>
            ) : (
              <ul className="space-y-2">
                {t.missingInformation.map((m) => (
                  <li key={m} className="flex gap-2 text-sm text-amber-800">
                    <span className="mt-0.5">!</span>
                    {m}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {t.sensitiveCategory && (
            <div className="rounded-lg border border-navy-200 bg-navy-50 px-4 py-3 text-xs text-navy-900">
              <span className="font-semibold">Sensitive category.</span> A human review is required before any closure
              response is sent.
            </div>
          )}
        </div>
      </div>

      <div className="mt-6">
        <Link to={`/app/workbench?case=${c.id}`} className="text-sm font-semibold text-accent-600 hover:text-accent-700">
          Continue to enforcement context & case summary →
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
        <div className="section-eyebrow">Step 2 · AI triage</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">Triage Automation</h1>
        <p className="mt-2 text-ink-muted">What the AI system did automatically — no manual research required.</p>
      </div>
      <CaseSwitcher cases={cases} activeId={activeId} onPick={onPick} />
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-navy-900">{value}</div>
      {sub && <div className="text-xs text-ink-subtle">{sub}</div>}
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  )
}
