import { workloadV1FeatureImportance } from '../../data/workloadV1'

/**
 * Feature-importance summary from the local report artifact
 * (reports/modeling/v1/feature_importance.csv). Reinforces the persistence
 * finding: the signal is dominated by volume-correlated features, with the
 * compositional features contributing essentially nothing.
 */
export default function FeatureImportance() {
  const max = Math.max(...workloadV1FeatureImportance.map((f) => f.importance), 0.0001)

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-navy-900">Feature importance summary</h2>
      <p className="mt-1 text-xs text-ink-subtle">Permutation importance (top features) — from the local v1 report.</p>

      <ul className="mt-4 space-y-2">
        {workloadV1FeatureImportance.map((f) => {
          const pct = Math.max(2, (f.importance / max) * 100)
          const meaningful = f.importance > 0
          return (
            <li key={f.feature} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <div>
                <div className="truncate text-xs font-medium text-navy-900" title={f.feature}>
                  {f.feature}
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-100">
                  <div
                    className={`h-2 rounded-full ${meaningful ? 'bg-navy-500' : 'bg-slate-300'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <span className="text-xs tabular-nums text-ink-muted">{f.importance.toFixed(3)}</span>
            </li>
          )
        })}
      </ul>

      <p className="mt-4 text-[11px] leading-relaxed text-ink-subtle">
        Importance concentrates in <span className="font-medium">complaint diversity</span> and{' '}
        <span className="font-medium">prior complaint count</span> — both volume-correlated. Complaint mix, department
        mix, and timing features added no measurable lift at this scale.
      </p>
    </section>
  )
}
