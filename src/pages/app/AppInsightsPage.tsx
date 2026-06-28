import { Navigate, useSearchParams } from 'react-router-dom'
import InsightsDashboard, { InsightsSourceBanner } from '../../components/app/InsightsDashboard'
import { useWorkflow } from '../../lib/workflowStore'

// Insights — supervisor/coordinator operational workload intelligence over the
// New York City 311 public service request dataset. Three tabs: Overview (map,
// KPIs, charts), Case Explorer (paginated, filtered case search + detail), and
// Open cases (review priority queue when the open dataset is loaded). Aggregates
// read small materialized views; the Case Explorer reads paginated, filtered
// rows — never the full table.
//
// By-law Officers do not see supervisor Insights and are redirected to their
// Officer Field Console. Decision support only — not a risk prediction.
export default function AppInsightsPage() {
  const { role } = useWorkflow()
  const [searchParams] = useSearchParams()
  const isStressTesting = searchParams.get('tab') === 'simulations'

  if (role === 'officer') return <Navigate to="/app/field" replace />

  return (
    <div className="container-page py-10">
      <div className="max-w-3xl">
        <div className="section-eyebrow">INTELLIGENCE COMMAND</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">
          Workload Intelligence
        </h1>
        <p className="mt-2 text-ink-muted">
          Live benchmark view of service request volume, backlog, closure pressure, and field activity patterns. Uses
          NYC 311 public data for the demo, not Brampton operational data.
        </p>
      </div>

      {/* Data source banner — the live NYC 311 public dataset behind the dashboard. */}
      <InsightsSourceBanner />

      {isStressTesting ? <StressTestingComingSoon /> : <InsightsDashboard />}
    </div>
  )
}

function StressTestingComingSoon() {
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-navy-900 px-5 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-white">Stress Testing</h2>
          <span className="inline-flex items-center rounded-full bg-amber-400/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-200 ring-1 ring-inset ring-amber-400/30">
            Coming soon
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-navy-100">
          The AI GAN stress testing layer is not live in the main branch yet. This area is reserved for future scenario
          generation, capacity testing, and human reviewed planning analysis.
        </p>
      </div>

      <div className="grid gap-4 px-5 py-5 md:grid-cols-3">
        <ComingSoonCard
          title="AI GAN model"
          body="Coming soon. The synthetic scenario model is still being prepared and is not running in production."
        />
        <ComingSoonCard
          title="Scenario generation"
          body="Future simulations will help staff reason about backlog pressure and staffing assumptions."
        />
        <ComingSoonCard
          title="Human review first"
          body="Outputs will remain decision support only, with staff review before any operational use."
        />
      </div>
    </section>
  )
}

function ComingSoonCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="text-sm font-semibold text-navy-900">{title}</div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-subtle">{body}</p>
    </div>
  )
}
