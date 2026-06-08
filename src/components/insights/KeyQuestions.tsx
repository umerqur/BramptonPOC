/**
 * The operational questions this view is meant to help staff answer. Framed as
 * workload-planning support, never as discovery or enforcement.
 */
const QUESTIONS = [
  'Which areas (FSAs) carry the most complaint workload, and are likely to stay busy next period?',
  'How is workload distributed across low / medium / high tiers?',
  'Where should limited staff capacity be planned first?',
  'How dependable is this signal, and what does it not tell us?',
]

export default function KeyQuestions() {
  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-navy-900">Key operational questions</h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {QUESTIONS.map((q) => (
          <li key={q} className="flex items-start gap-2 text-sm text-ink-muted">
            <span aria-hidden className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-navy-300" />
            <span>{q}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
