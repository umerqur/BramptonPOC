/**
 * Forward-looking note. Because v1 only reproduces volume persistence, the
 * valuable next step is change/emergence detection — areas rising relative to
 * their own baseline. Framed as planned future work, not a current capability.
 */
const NEXT = [
  {
    title: 'Emergence / change detection',
    body: 'Predict areas rising relative to their own baseline, factoring out the persistence v1 already captures, to surface newly busy areas.',
  },
  {
    title: 'Longer data horizon',
    body: 'More months enable seasonality, multiple holdout periods, and steadier estimates than the current four-month window allows.',
  },
  {
    title: 'Finer geography only when justified',
    body: 'Move below FSA only with real complaint coordinates or reliable address geocoding — never inferred from ward boundaries.',
  },
]

export default function V2Direction() {
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
          Next direction
        </span>
        <h2 className="text-sm font-semibold text-navy-900">Where v2 goes</h2>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {NEXT.map((n) => (
          <div key={n.title} className="rounded-lg border border-slate-200 p-3">
            <div className="text-xs font-semibold text-navy-900">{n.title}</div>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">{n.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
