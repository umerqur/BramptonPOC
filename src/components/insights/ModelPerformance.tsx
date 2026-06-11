import { workloadV1Metrics, workloadV1Prevalence } from '../../data/workloadV1'

/**
 * Model performance summary + the honest headline finding. The persistence
 * baseline row is highlighted because it is the bar v1 had to beat — and did not.
 * Numbers come from the local report artifacts (reports/modeling/v1/metrics.json).
 */
export default function ModelPerformance() {
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-navy-900">Model performance summary</h2>
        <p className="text-xs text-ink-subtle">Stratified cross-validation · positive rate {Math.round(workloadV1Prevalence * 100)}%</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-ink-subtle">
            <tr className="text-left">
              <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider">Model</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider">PR-AUC</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider">ROC-AUC</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider">Precision@k</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider">Brier</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {workloadV1Metrics.map((m) => (
              <tr key={m.model} className={m.isBaseline ? 'bg-sky-50/60' : 'hover:bg-slate-50'}>
                <td className="px-4 py-2.5 font-medium text-navy-900">
                  {m.model}
                  {m.isBaseline && (
                    <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800">
                      baseline to beat
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{m.prAuc.toFixed(3)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{m.rocAuc.toFixed(3)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{m.precisionAtK.toFixed(2)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                  {m.brier == null ? '—' : m.brier.toFixed(3)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-xs leading-relaxed text-ink-muted">
        <span className="font-semibold text-navy-900">Honest finding: v1 does not beat the persistence baseline.</span>{' '}
        The tree models match but do not exceed simply ranking areas by their prior-period volume. In other words, busy
        areas tend to stay busy — a dependable workload-planning signal, but not a hidden pattern the model uncovered.
      </div>
    </section>
  )
}
