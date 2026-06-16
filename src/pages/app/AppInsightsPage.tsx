import { Navigate } from 'react-router-dom'
import NYCWorkloadMapPanel from '../../components/app/NYCWorkloadMapPanel'
import { useWorkflow } from '../../lib/workflowStore'

// Insights — the NYC 311 workload heat map only. Supervisor/coordinator surface;
// By-law Officers do not see supervisor Insights and are redirected to their
// Officer Field Console. The map is NYC 311 benchmark decision support — not
// Brampton operational data and not a risk prediction.
export default function AppInsightsPage() {
  const { role } = useWorkflow()
  if (role === 'officer') return <Navigate to="/app/field" replace />
  return (
    <div className="container-page py-10">
      <div className="max-w-3xl">
        <div className="section-eyebrow">INSIGHTS</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">Operational insights</h1>
        <p className="mt-2 text-ink-muted">
          Where the service-request workload sits across NYC, using the NYC 311 benchmark dataset. The default council
          district view is the ward-like operational equivalent; the borough view is the high-level executive overview.
          Workload patterns may help supervisors review staffing, patrol coverage, and service response pressure — this
          is supervisor decision support only, not an enforcement decision and not a risk prediction.
        </p>
      </div>

      {/* NYC 311 workload heat map */}
      <NYCWorkloadMapPanel />
    </div>
  )
}
