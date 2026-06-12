import { Link } from 'react-router-dom'

// Staff home — the first screen authenticated staff land on after sign in.
// A simple two-card chooser between Resident Intake (the start of the workflow)
// and the Closure Review Workbench. Deliberately minimal so the workspace opens
// on a clear "what do you want to do?" rather than dropping staff straight into
// the dense Closure Review screen.
const STAFF_CARDS: Array<{
  title: string
  body: string
  cta: string
  to: string
}> = [
  {
    title: 'Resident Intake',
    body: 'Review parking complaints submitted by residents and move each request through received, assigned, under review, and closed.',
    cta: 'Open Resident Intake',
    to: '/app/resident-intake',
  },
  {
    title: 'Closure Review Workbench',
    body: 'Review enforcement context, trends, and AI drafted closure language for staff approval.',
    cta: 'Open Closure Review',
    to: '/app/closure-review',
  },
]

export default function AppStaffHomePage() {
  return (
    <div className="container-page py-12">
      <div className="max-w-3xl">
        <div className="section-eyebrow">Staff workspace</div>
        <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">
          What do you want to do?
        </h1>
        <p className="mt-3 text-ink-muted">
          Start with resident intake, then use closure review when a case is ready for staff approved response
          language.
        </p>
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {STAFF_CARDS.map((card) => (
          <div key={card.title} className="card flex flex-col p-7">
            <h2 className="text-lg font-semibold text-navy-900">{card.title}</h2>
            <p className="mt-2 flex-1 text-sm text-ink-muted">{card.body}</p>
            <div className="mt-6">
              <Link to={card.to} className="btn-primary">
                {card.cta}
              </Link>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-xs text-ink-subtle">
        Decision support only. Staff approve every enforcement decision and resident communication.
      </p>
    </div>
  )
}
