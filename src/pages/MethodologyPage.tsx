const workflowSteps = [
  ['1', 'Resident intake', 'A resident submits a demo municipal request.'],
  ['2', 'Structured case', 'The request becomes clean, reviewable case data.'],
  ['3', 'Staff triage', 'Staff review priority, context, and workload pressure.'],
  ['4', 'Field follow up', 'Field context can be recorded against the case.'],
  ['5', 'Closure support', 'Draft wording is prepared for staff review.'],
  ['6', 'Supervisor approval', 'A supervisor approves the final response before closure.'],
]

const valueCards = [
  ['Cleaner intake', 'Residents submit structured requests that are easier for staff to review.'],
  ['Faster triage', 'Staff can see priority context, similar cases, and workload pressure earlier.'],
  ['Consistent responses', 'Closure wording can follow approved patterns while remaining staff reviewed.'],
  ['Capacity planning', 'Stress testing estimates when complaint volume and staff workload create backlog risk.'],
]

const stressNotes = [
  ['CTGAN', 'A generative AI technique used to create plausible demand scenarios from 3.4M New York City 311 public records covering the past 12 months.'],
  ['ABM', 'Simulates how complaints, districts, staff queues, field work, and resident attention interact under different workload conditions.'],
  ['GPU accelerated training', 'Can speed up scenario generation when larger municipal complaint datasets are used locally.'],
  ['The output', 'Planning insight, not automated action.'],
]

const governanceNotes = [
  'The current demo uses a 3.4M record New York City 311 public dataset covering the past 12 months, not Brampton operational data.',
  'Brampton data can be connected later with City approval and approved privacy controls.',
  'Resident messages and case actions remain under human control.',
  'The system preserves provenance, auditability, and clear labelling of public, synthetic, and future operational data.',
]

const guardrails = [
  'No automated tickets',
  'No automated enforcement decisions',
  'No automatic case closure',
  'No resident message without staff approval',
  'No staff replacement or performance scoring',
  'Public source data clearly labelled',
]

export default function MethodologyPage() {
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
          <SectionTitle eyebrow="System architecture" title="From a resident complaint to a workload signal" />
          <div className="mt-6 card overflow-hidden p-6 sm:p-8">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {workflowSteps.map(([n, title, detail]) => (
                <div key={n} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-900 text-sm font-semibold text-white">{n}</span>
                    <div>
                      <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
                      <p className="mt-1 text-xs leading-snug text-ink-muted">{detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              <SupportCard title="NYC 311 pattern intelligence" items={['3.4M NYC 311 records', 'Past 12 months', 'Similar cases', 'Closure patterns']} />
              <SupportCard title="Operational analytics" items={['Work queue', 'Heat map', 'Closure duration', 'Complaint pressure']} />
              <SupportCard title="Stress testing" items={['Synthetic patrol logs', 'Staff capacity', 'Backlog growth', 'Demand shocks']} />
            </div>
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

        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 bg-navy-900 px-6 py-6 sm:px-8">
            <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">Stress Testing and Simulation Lab</h2>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-navy-100">
              Historical complaint patterns are turned into planning scenarios. Synthetic patrol logs translate complaint
              volume into estimated field actions, staff time, follow ups, supervisor review pressure, and backlog risk.
              This lets the City test operational questions before they become real bottlenecks.
            </p>
          </div>
          <div className="px-6 py-7 sm:px-8">
            <div className="grid gap-2 lg:grid-cols-5">
              {['CTGAN demand scenarios', 'ABM operations model', 'Capacity pressure', 'Backlog growth', 'Stress zones'].map((label) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-center text-sm font-semibold text-navy-900">{label}</div>
              ))}
            </div>
            <dl className="mt-6 grid gap-4 sm:grid-cols-2">
              {stressNotes.map(([term, detail]) => (
                <div key={term} className="rounded-xl border border-slate-200 bg-white p-4">
                  <dt className="text-sm font-semibold text-navy-900">{term}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-ink-muted">{detail}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 rounded-xl bg-accent-50 px-4 py-3 text-sm leading-relaxed text-accent-800 ring-1 ring-inset ring-accent-100">
              GPU accelerated stress testing and generative scenario modelling are used for capacity planning and decision
              support only. Every result is reviewed by staff, and human approval is always required before any action.
            </p>
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

        <section>
          <SectionTitle eyebrow="Limits by design" title="Governance guardrails" />
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {guardrails.map((item) => (
              <li key={item} className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm font-medium text-navy-900">{item}</li>
            ))}
          </ul>
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

function SupportCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <span className="block h-1 w-10 rounded-full bg-accent-500" />
      <h3 className="mt-3 text-sm font-semibold text-navy-900">{title}</h3>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li key={item} className="rounded-md bg-accent-50 px-2 py-1 text-xs font-medium text-accent-700 ring-1 ring-inset ring-accent-100">{item}</li>
        ))}
      </ul>
    </div>
  )
}
