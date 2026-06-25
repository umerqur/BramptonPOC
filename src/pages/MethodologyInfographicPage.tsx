const valueCards = [
  ['Cleaner intake', 'Residents submit structured requests that are easier for staff to review.'],
  ['Faster triage', 'Staff can see priority context, similar cases, and workload pressure earlier.'],
  ['Consistent responses', 'Closure wording can follow approved patterns while remaining staff reviewed.'],
  ['Capacity planning', 'Stress testing estimates when complaint volume and staff workload create backlog risk.'],
]

const governanceNotes = [
  'The current demo uses a 3.4M record New York City 311 public dataset covering the past 12 months, not Brampton operational data.',
  'Brampton data can be connected later with City approval and approved privacy controls.',
  'Resident messages and case actions remain under human control.',
  'The system preserves provenance, auditability, and clear labelling of public, synthetic, and future operational data.',
]

export default function MethodologyInfographicPage() {
  return (
    <div className="container-page py-12 sm:py-16">
      <header className="max-w-3xl">
        <div className="section-eyebrow">Methodology</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          How the AI assisted enforcement POC works
        </h1>
        <p className="mt-4 text-base leading-relaxed text-ink-muted sm:text-lg">
          This proof of concept shows how resident complaints can move from structured intake to staff review, field
          follow up, supervisor approved closure communication, and workload intelligence. The analytics are grounded in
          3.4M New York City 311 public records from the past 12 months. This is not Brampton operational data.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {['Decision support', 'Human approval', '3.4M NYC 311 records', 'Capacity planning'].map((tag) => (
            <span key={tag} className="inline-flex items-center rounded-full bg-navy-50 px-3 py-1 text-xs font-medium text-navy-700 ring-1 ring-inset ring-navy-100">
              {tag}
            </span>
          ))}
        </div>
      </header>

      <div className="mt-12 space-y-12 sm:mt-16 sm:space-y-16">
        <section>
          <SectionTitle eyebrow="Visual workflow" title="From a resident complaint to a workload signal" />
          <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <img
              src="/methodology-infographic.svg"
              alt="Infographic showing the workflow from resident intake through staff review, field follow up, supervisor approval, resident update, analytics, and stress testing."
              className="w-full"
            />
          </div>
        </section>

        <section>
          <SectionTitle eyebrow="Why this matters" title="What staff gain at each step" />
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {valueCards.map(([title, detail]) => (
              <div key={title} className="card card-hover p-5">
                <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle eyebrow="Trust" title="Data and governance" />
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {governanceNotes.map((note) => (
              <p key={note} className="rounded-xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-ink-muted">{note}</p>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="max-w-3xl">
      <div className="section-eyebrow">{eyebrow}</div>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900">{title}</h2>
    </div>
  )
}
