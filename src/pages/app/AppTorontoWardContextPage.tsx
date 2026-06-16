import NYCWorkloadMapPanel from '../../components/app/NYCWorkloadMapPanel'

// Legacy NYC service request workload context page. Superseded by the Insights
// tab (which embeds the same NYC 311 workload heat map). This route is removed
// from the product surface — it redirects to Insights — and is kept only so the
// underlying view still compiles for any internal use.
export default function AppNYCWorkloadContextPage() {
  return (
    <div className="container-page py-10">
      <div className="section-eyebrow">Benchmark Context</div>
      <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">
        NYC service request workload context (by borough)
      </h1>
      <p className="mt-2 text-sm text-ink-muted max-w-3xl">
        Real NYC borough boundaries (NYC open data) provide the geographic base layer, shaded by real NYC 311 benchmark
        complaint volume aggregated per borough to show area-level workload intensity.
      </p>

      <NYCWorkloadMapPanel />
    </div>
  )
}
