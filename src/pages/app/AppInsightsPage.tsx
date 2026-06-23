import { Navigate } from 'react-router-dom'
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
  if (role === 'officer') return <Navigate to="/app/field" replace />

  return (
    <div className="container-page py-10">
      <div className="max-w-3xl">
        <div className="section-eyebrow">INTELLIGENCE COMMAND</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">
          Intelligence Command
        </h1>
        <p className="mt-2 text-ink-muted">
          Operational workload intelligence over the public New York City 311 benchmark dataset — where the
          service-request workload sits and where closure is under pressure. This is benchmark data, not Brampton
          operational data, and it is decision support for staffing and routing review — not automated enforcement and
          not a risk prediction.
        </p>
      </div>

      {/* Data source banner — the live NYC 311 public dataset behind the dashboard. */}
      <InsightsSourceBanner />

      {/* Overview · Case Explorer · Open cases. */}
      <InsightsDashboard />
    </div>
  )
}
