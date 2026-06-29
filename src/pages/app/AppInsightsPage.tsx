import { Navigate } from 'react-router-dom'
import InsightsDashboard, { InsightsSourceBanner } from '../../components/app/InsightsDashboard'
import { useWorkflow } from '../../lib/workflowStore'

// Insights — supervisor/coordinator operational workload intelligence over a
// public 311 benchmark service-request dataset. Tabs: Overview (map, KPIs,
// charts), Case Explorer (paginated, filtered case search + detail), Open cases
// (review priority queue when the open dataset is loaded), and Stress Testing
// (the CTGAN + ABM planning simulation framework). Aggregates read small
// materialized views; the Case Explorer reads paginated, filtered rows — never
// the full table. The active tab is selected by ?tab= inside InsightsDashboard.
//
// By-law Officers do not see supervisor Insights and are redirected to their
// Officer Field Console. Decision support only — not a risk prediction.
export default function AppInsightsPage() {
  const { role } = useWorkflow()

  if (role === 'officer') return <Navigate to="/app/field" replace />

  return (
    <div className="container-page py-10">
      <div className="max-w-3xl">
        <div className="section-eyebrow">INSIGHTS</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">
          Workload Intelligence
        </h1>
        <p className="mt-2 text-ink-muted">
          Benchmark view of service request volume, backlog, closure pressure, and field activity patterns. Uses public
          311 benchmark data for the demo, not Brampton operational data.
        </p>
      </div>

      {/* Data source banner — the public 311 benchmark dataset behind the dashboard. */}
      <InsightsSourceBanner />

      <InsightsDashboard />
    </div>
  )
}
