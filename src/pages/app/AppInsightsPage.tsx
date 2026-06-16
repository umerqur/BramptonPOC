import NYCWorkloadMapPanel from '../../components/app/NYCWorkloadMapPanel'

// Insights — the NYC 311 workload heat map only. The page intentionally shows
// just the map for now: the live complaint dashboard, supervisor workflow-impact
// metrics, automation-vs-human-review card, supporting links, and guardrail
// footer have been removed to keep the staff product surface focused. The map is
// NYC 311 benchmark decision support — not Brampton operational data and not a
// risk prediction.
export default function AppInsightsPage() {
  return (
    <div className="container-page py-10">
      <div className="max-w-3xl">
        <div className="section-eyebrow">INSIGHTS</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">Operational insights</h1>
        <p className="mt-2 text-ink-muted">
          Where the service-request workload sits across NYC, using the NYC 311 benchmark dataset. The default council
          district view is the ward-like operational equivalent; the borough view is the high-level executive overview.
          This is decision support only — staff review every case.
        </p>
      </div>

      {/* NYC 311 workload heat map */}
      <NYCWorkloadMapPanel />
    </div>
  )
}
