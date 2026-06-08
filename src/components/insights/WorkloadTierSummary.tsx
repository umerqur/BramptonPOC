import type { WorkloadInsightRow } from '../../services/municipalServiceRequests'

/** Tier accent classes — workload intensity, not risk. */
const TIER_STYLES: Record<string, string> = {
  high: 'bg-rose-50 border-rose-200 text-rose-900',
  medium: 'bg-amber-50 border-amber-200 text-amber-900',
  low: 'bg-emerald-50 border-emerald-200 text-emerald-900',
}

function tierLabel(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/**
 * Top-line summary of persistent high-workload areas and the tier distribution.
 * "Persistent" here means high prior-period volume that tends to stay high — the
 * v1 signal is volume persistence, nothing more.
 */
export default function WorkloadTierSummary({ rows }: { rows: WorkloadInsightRow[] }) {
  const total = rows.length
  const counts = { high: 0, medium: 0, low: 0 } as Record<string, number>
  for (const r of rows) {
    const t = (r.predicted_tier || '').toLowerCase()
    if (t in counts) counts[t] += 1
  }

  const tiers: Array<{ key: 'high' | 'medium' | 'low'; blurb: string }> = [
    { key: 'high', blurb: 'Highest planned workload' },
    { key: 'medium', blurb: 'Moderate planned workload' },
    { key: 'low', blurb: 'Lowest planned workload' },
  ]

  return (
    <section aria-label="Workload tiers">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-5">
          <div className="stat-label">Areas scored</div>
          <div className="stat-value">{total}</div>
          <div className="mt-2 text-xs text-ink-subtle">Forward-sortation areas (FSAs)</div>
        </div>
        {tiers.map(({ key, blurb }) => (
          <div key={key} className={`rounded-lg border p-5 ${TIER_STYLES[key]}`}>
            <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">
              {tierLabel(key)} workload tier
            </div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">{counts[key]}</div>
            <div className="mt-2 text-xs opacity-80">{blurb}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
