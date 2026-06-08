/**
 * Framing banner for the Workload Insights page. Makes the honest positioning
 * explicit and unmissable: Toronto 311 benchmark data, decision support only,
 * not Brampton operational data, and not automated enforcement.
 */
export default function WorkloadAdvisory() {
  return (
    <div
      role="note"
      className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500" />
        <div className="space-y-1">
          <p className="font-semibold">Toronto 311 benchmark — decision support only.</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-amber-900/90">
            <li>This is a workload-planning view built on Toronto 311 public benchmark data.</li>
            <li>It is <span className="font-semibold">not Brampton operational complaint data</span>.</li>
            <li>It is <span className="font-semibold">decision support only</span> — authorized staff review and decide.</li>
            <li>It is <span className="font-semibold">not automated enforcement</span> and not a final enforcement decision.</li>
            <li>This is a <span className="font-semibold">supporting analytics view</span>, not the core automation workflow.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
