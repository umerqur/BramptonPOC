import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import NYCWorkloadMapPanel from '../../components/app/NYCWorkloadMapPanel'
import InsightsDashboard, { DrilldownModal, type Drilldown } from '../../components/app/InsightsDashboard'
import { useWorkflow } from '../../lib/workflowStore'

// Insights — the supervisor/coordinator operational workload intelligence
// dashboard over the NYC 311 benchmark dataset. It keeps the council-district /
// borough workload map and adds supervisor-focused sections: KPIs, complaint
// type pressure, closure and area bottlenecks, department workload, trend, and
// channel mix. Every aggregate is read from a server-side Supabase view (never
// the full table in the browser); clicking a map area, a complaint type, or a
// bottleneck row opens the individual case records behind it.
//
// By-law Officers do not see supervisor Insights and are redirected to their
// Officer Field Console. This is NYC 311 benchmark decision support — not
// Brampton operational data, not a risk prediction, and not an automated
// enforcement decision.
export default function AppInsightsPage() {
  const { role } = useWorkflow()
  // Shared drilldown opened from the map, complaint types, or bottleneck rows.
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null)

  if (role === 'officer') return <Navigate to="/app/field" replace />

  return (
    <div className="container-page py-10">
      <div className="max-w-3xl">
        <div className="section-eyebrow">INSIGHTS</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">
          Operational workload intelligence
        </h1>
        <p className="mt-2 text-ink-muted">
          Where the service-request workload sits and where closure is under pressure across the NYC 311 benchmark
          dataset. The council district view is the ward-like operational unit; the borough view is the executive
          overview. These workload and closure patterns are supervisor decision support for reviewing staffing, routing,
          and service response pressure — not an enforcement decision and not a risk prediction.
        </p>
      </div>

      {/* NYC 311 workload heat map — clicking a district opens its case drilldown. */}
      <NYCWorkloadMapPanel
        onSelectDistrict={(district) =>
          setDrilldown({ title: `District ${district} — cases`, filter: { councilDistrict: district } })
        }
      />

      {/* Supervisor-focused operational sections. */}
      <InsightsDashboard onDrilldown={setDrilldown} />

      {/* Case records behind a clicked aggregate. */}
      <DrilldownModal drilldown={drilldown} onClose={() => setDrilldown(null)} />
    </div>
  )
}
