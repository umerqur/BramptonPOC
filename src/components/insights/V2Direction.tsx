/**
 * Forward-looking note. The core POC is complaint workflow intelligence —
 * accelerating existing enforcement work and keeping staff in control. Workload
 * analytics (this view) is supporting management context, not the core product
 * and not predictive targeting.
 */
const NEXT = [
  {
    title: 'Workflow acceleration',
    body: 'Reduce time from complaint intake to resolution through AI-assisted classification, summaries, routing support, and closure drafting.',
  },
  {
    title: 'Human review and auditability',
    body: 'Keep staff in control with review queues, supervisor visibility, decision notes, and audit trails.',
  },
  {
    title: 'Workload analytics as support',
    body: 'Keep workload views as management context for capacity planning, not predictive targeting or automated enforcement.',
  },
]

export default function V2Direction() {
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
          Next direction
        </span>
        <h2 className="text-sm font-semibold text-navy-900">Where the POC goes next</h2>
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
