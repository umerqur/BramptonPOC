/**
 * The operational questions this view is meant to help staff answer. Framed as
 * workload-planning support, never as discovery or enforcement.
 */
const QUESTIONS = [
  'Where is complaint workload concentrated across areas (FSAs)?',
  'Which queues or complaint categories create the most bottlenecks?',
  'Which cases need staff review, and how is workload distributed across tiers?',
  'What information helps staff close work faster?',
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
