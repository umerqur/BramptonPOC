// Public methodology page — a short executive overview of the POC. It is built
// to be read in about 60 seconds: strong headings, compact cards, one sentence
// each, no walls of text. Deeper technical notes live behind one collapsed
// "View technical details" disclosure, never on the visible page.

const heroBadges = ['Decision support', 'Human approval', 'Public 311 benchmark', 'Capacity planning']

// 2. What the POC helps avoid — the strongest section, value first.
const avoidCards = [
  ['Backlog growth', 'Shows where demand can exceed available capacity.'],
  ['Stale cases', 'Surfaces where cases may sit too long without movement.'],
  ['Review bottlenecks', 'Highlights where supervisor review can become the second queue.'],
  ['Delayed closure updates', 'Shows where closure communication pressure may build.'],
] as const

// 3. Workflow snapshot — four steps, not seven.
const workflowCards = [
  ['Resident intake', 'Structured complaint enters the staff workflow.'],
  ['Staff triage', 'Staff review priority, routing, and recommended next action.'],
  ['Field follow up', 'Officer records the field outcome when needed.'],
  ['Supervisor approved closure', 'Supervisor reviews and approves the final response.'],
] as const

// 4. Stress testing snapshot — four steps.
const stressCards = [
  ['Public benchmark patterns', 'Uses public 311 benchmark patterns for POC modelling.'],
  ['Synthetic demand', 'Creates planning demand scenarios from benchmark patterns.'],
  ['Capacity simulation', 'Runs demand through district queues, officer capacity, and supervisor review.'],
  ['Prevention action', 'Shows where capacity can be shifted before backlog compounds.'],
] as const

// 5. Methods used — small method tags only.
const methodCards = [
  ['Synthetic demand', 'CTGAN', 'Creates synthetic workload patterns from the public benchmark.'],
  ['Operations simulation', 'ABM', 'Runs demand through queues, staff capacity, review, and closure pressure.'],
] as const

// 6. Outputs — compact pills.
const outputs = [
  'Backlog risk',
  'Stale case risk',
  'District pressure',
  'Complaint type pressure',
  'Supervisor review pressure',
  'Staff capacity need',
] as const

export default function MethodologyPage() {
  return (
    <div className="container-page py-12 sm:py-16">
      {/* 1. Hero */}
      <header className="max-w-3xl">
        <div className="section-eyebrow">Methodology</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          How the enforcement intelligence POC works
        </h1>
        <p className="mt-4 text-base leading-relaxed text-ink-muted sm:text-lg">
          A human reviewed workflow that helps staff triage complaints, understand workload pressure, and prepare
          consistent closure support.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {heroBadges.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full bg-navy-50 px-3 py-1 text-xs font-medium text-navy-700 ring-1 ring-inset ring-navy-100"
            >
              {tag}
            </span>
          ))}
        </div>
      </header>

      <div className="mt-10 space-y-10 sm:mt-12 sm:space-y-12">
        {/* 2. What the POC helps avoid */}
        <Section title="What the POC helps you avoid" lead="See workload pressure before it turns into a problem.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {avoidCards.map(([title, detail]) => (
              <Card key={title} title={title} detail={detail} tone="avoid" />
            ))}
          </div>
        </Section>

        {/* 3. Workflow snapshot */}
        <Section title="The workflow at a glance">
          <FlowCards items={workflowCards} />
        </Section>

        {/* 4. Stress testing snapshot */}
        <Section title="How stress testing works" lead="Demand pressure modelled before it reaches residents and staff.">
          <FlowCards items={stressCards} />
          <p className="mt-4 text-xs leading-relaxed text-ink-subtle">
            Uses public 311 benchmark patterns. Not live Brampton operational data. Not enforcement decisioning.
          </p>
        </Section>

        {/* 5. Methods used */}
        <Section title="Methods used">
          <div className="grid gap-4 sm:grid-cols-2">
            {methodCards.map(([title, tag, detail]) => (
              <div key={title} className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
                  <span className="rounded-md bg-accent-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-800">
                    {tag}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{detail}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* 6. Outputs */}
        <Section title="What it produces">
          <div className="flex flex-wrap gap-2">
            {outputs.map((o) => (
              <span
                key={o}
                className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-navy-900"
              >
                {o}
              </span>
            ))}
          </div>
        </Section>

        {/* 7. Governance strip */}
        <div className="rounded-2xl bg-navy-900 px-6 py-5 text-sm font-medium leading-relaxed text-navy-50">
          Decision support only. Public 311 benchmark. Not live Brampton data. Staff approve actions. No automated
          enforcement.
        </div>

        {/* Optional deeper detail — collapsed by default, intentionally short. */}
        <details className="group rounded-2xl border border-slate-200 bg-white p-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-navy-900">
            View technical details
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="h-4 w-4 text-ink-subtle transition-transform group-open:rotate-180"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </summary>
          <div className="mt-3 space-y-2 text-sm leading-relaxed text-ink-muted">
            <p>
              The synthetic demand generator (CTGAN) learns patterns in the public 311 benchmark — complaint mix,
              district pressure, timing, and closure patterns — and produces synthetic demand scenarios that are
              statistically similar to real demand but never claim to be real Brampton records.
            </p>
            <p>
              The operations simulation (ABM) runs that demand through district queues, officer capacity, and supervisor
              review using clear, visible rules, so staff can see why capacity constrained queue pressure builds. The
              Stress Testing tab reports a current baseline, a projected trajectory, the worst case red zones, and the
              recommended prevention actions.
            </p>
            <p className="text-xs text-ink-subtle">
              Planning simulation and decision support only. Staff remain responsible for review and action.
            </p>
          </div>
        </details>
      </div>
    </div>
  )
}

// A titled section with an optional one-line lead.
function Section({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight text-navy-900 sm:text-2xl">{title}</h2>
      {lead && <p className="mt-1.5 max-w-2xl text-sm text-ink-muted">{lead}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

// A single compact value card.
function Card({ title, detail, tone }: { title: string; detail: string; tone?: 'avoid' }) {
  return (
    <div className={`rounded-2xl border p-5 ${tone === 'avoid' ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-white'}`}>
      <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{detail}</p>
    </div>
  )
}

// A horizontal flow of compact numbered cards with connectors (stacked on mobile).
function FlowCards({ items }: { items: ReadonlyArray<readonly [string, string]> }) {
  return (
    <ol className="flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-0">
      {items.map(([title, detail], i) => (
        <li key={title} className="flex flex-col lg:flex-1 lg:flex-row lg:items-stretch">
          <div className="flex h-full w-full flex-col rounded-2xl border border-slate-200 bg-white p-4">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-white">
              {i + 1}
            </span>
            <h3 className="mt-3 text-sm font-semibold text-navy-900">{title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">{detail}</p>
          </div>
          {i < items.length - 1 && (
            <span aria-hidden className="flex shrink-0 items-center justify-center self-center py-1 text-slate-300 lg:px-1 lg:py-0">
              <svg viewBox="0 0 24 24" className="h-5 w-5 lg:hidden" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14" />
                <path d="m6 13 6 6 6-6" />
              </svg>
              <svg viewBox="0 0 24 24" className="hidden h-5 w-5 lg:block" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="m13 6 6 6-6 6" />
              </svg>
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}
