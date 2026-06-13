import { Link } from 'react-router-dom'
import { useWorkflow } from '../../lib/workflowStore'
import { GuardrailFooter } from '../../components/workflow/WorkflowUI'

// Supervisor Insights — the "Where workload is reduced" impact view. Leads with
// the headline metrics that prove the AI is taking manual research, follow-up
// calls, and draft-writing off staff, then keeps the prior operational views
// (statistical attention queue, aging cases, workflow counts, area context) as
// supporting links rather than the main product.

type Metric = {
  label: string
  value: string
  sub: string
  tone?: 'default' | 'accent'
}

export default function AppSupervisorInsightsPage() {
  const { metrics, cases } = useWorkflow()

  const primary: Metric[] = [
    { label: 'New complaints processed', value: String(metrics.newComplaintsProcessed), sub: 'intake captured by AI' },
    { label: 'AI classified', value: String(metrics.aiClassified), sub: 'auto type + routing' },
    { label: 'AI summaries generated', value: String(metrics.aiSummariesGenerated), sub: 'plain-language case summaries' },
    { label: 'Closure drafts prepared', value: String(metrics.closureDraftsPrepared), sub: 'ready for staff review', tone: 'accent' },
  ]

  const savings: Metric[] = [
    { label: 'Staff review exceptions', value: String(metrics.staffReviewExceptions), sub: 'cases needing a human look' },
    { label: 'Manual research avoided', value: `~${metrics.manualResearchHoursAvoided} hrs`, sub: 'context gathered automatically', tone: 'accent' },
    { label: 'Follow-up calls reduced', value: `~${metrics.followUpCallsReduced}`, sub: 'from clearer closure responses', tone: 'accent' },
    { label: 'Avg draft time saved', value: `~${metrics.avgDraftMinutesSaved} min`, sub: 'per closure response', tone: 'accent' },
  ]

  return (
    <div className="container-page py-10">
      <div className="max-w-3xl">
        <div className="section-eyebrow">Supervisor view</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">Where workload is reduced</h1>
        <p className="mt-2 text-ink-muted">
          How the AI workflow system is reducing manual effort across intake, classification, research, summarization,
          and draft writing — while staff keep final approval.
        </p>
      </div>

      <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
        Demo estimates from synthetic case volume — illustrative, not operational figures.
      </div>

      {/* Primary throughput metrics */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {primary.map((m) => (
          <MetricCard key={m.label} {...m} />
        ))}
      </div>

      {/* Workload savings */}
      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-ink-subtle">Estimated workload avoided</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {savings.map((m) => (
          <MetricCard key={m.label} {...m} />
        ))}
      </div>

      {/* Automation vs human split */}
      <div className="mt-10 card p-6">
        <h2 className="text-sm font-semibold text-navy-900">Automation vs. human review</h2>
        <p className="mt-1 text-xs text-ink-subtle">Of {cases.length} synthetic cases currently in play.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-accent-700">AI role</div>
            <ul className="mt-2 space-y-1.5 text-sm text-ink-muted">
              <li>• Intake processing &amp; classification</li>
              <li>• Context gathering &amp; summarization</li>
              <li>• Closure-draft generation</li>
              <li>• Audit logging &amp; trend support</li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-navy-700">Staff role</div>
            <ul className="mt-2 space-y-1.5 text-sm text-ink-muted">
              <li>• Review exceptions</li>
              <li>• Edit drafts where needed</li>
              <li>• Override routing / priority</li>
              <li>• Approve every final response</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Supporting operational views (the former main dashboard) */}
      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-ink-subtle">Supporting operational views</h2>
      <p className="mt-1 text-sm text-ink-muted">
        The prior queue, workflow counts, aging cases, and statistical attention score — kept as supporting analytics
        rather than the main product.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SupportLink to="/app/legacy-insights" title="Statistical attention queue" desc="Review Attention Score ranking and area context." />
        <SupportLink to="/app/workflow" title="Workflow & lifecycle" desc="Workflow counts and case lifecycle stages." />
        <SupportLink to="/app/dashboard" title="Operations dashboard" desc="The original queue and case overview." />
        <SupportLink to="/app/cases" title="Case queue" desc="Benchmark case list and detail views." />
        <SupportLink to="/app/wards" title="Area context" desc="Ward / area boundary context map." />
        <SupportLink to="/app/resident-intake" title="Resident intake (Supabase)" desc="Live resident-request intake demo." />
      </div>

      <GuardrailFooter />
    </div>
  )
}

function MetricCard({ label, value, sub, tone = 'default' }: Metric) {
  return (
    <div className={`card p-5 ${tone === 'accent' ? 'border-accent-200 bg-accent-50/40' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums ${tone === 'accent' ? 'text-accent-700' : 'text-navy-900'}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-ink-subtle">{sub}</div>
    </div>
  )
}

function SupportLink({ to, title, desc }: { to: string; title: string; desc: string }) {
  return (
    <Link to={to} className="card card-hover flex flex-col p-5">
      <span className="text-sm font-semibold text-navy-900">{title}</span>
      <span className="mt-1 flex-1 text-sm text-ink-muted">{desc}</span>
      <span className="mt-3 text-sm font-semibold text-accent-600">Open →</span>
    </Link>
  )
}
