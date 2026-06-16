import TorontoWardContextPanel from '../../components/app/TorontoWardContextPanel'

// Authenticated NYC service request workload context (full /app/wards page).
// REAL NYC borough / council district boundaries (NYC open data) are shaded by
// REAL NYC 311 benchmark complaint volume aggregated per area. The map + area
// coding visualization now lives in the shared TorontoWardContextPanel so the
// same real visualization can also be embedded at the top of the Insights tab.
// This page renders the full panel (including the collapsed geometry-validation
// and Brampton future-context layers). The route is intentionally kept out of
// the top nav; it remains reachable by direct URL and from the Insights "Open
// full area context" link.
export default function AppTorontoWardContextPage() {
  return (
    <div className="container-page py-10">
      <div className="section-eyebrow">Benchmark Context</div>
      <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">
        NYC service request workload context (by borough / council district)
      </h1>
      <p className="mt-2 text-sm text-ink-muted max-w-3xl">
        Real NYC borough / council district boundaries (NYC open data) provide the geographic base layer, shaded by real
        NYC 311 benchmark complaint volume aggregated per area to show area-level workload intensity.
      </p>

      <TorontoWardContextPanel showValidationLayers />
    </div>
  )
}
