// Public methodology page — a short, business-readable overview of the POC.
// It is built to be read in about 60 seconds and is organized around four plain
// questions: what problem we solve, what the POC does, where AI is used, and
// what the guardrails are. Deeper technical notes live behind one collapsed
// "View technical details" disclosure, never on the visible page.

const heroBadges = [
  'Decision support',
  'Human approval',
  'Public 311 benchmark',
  'Operational pressure map',
  'Capacity planning',
] as const

// 1. The problem — the operational pressures staff need to see early.
const problemCards = [
  ['Backlog growth', 'Complaints can pile up faster than available capacity can clear them.'],
  ['Stale cases', 'Cases can sit too long without movement and quietly age.'],
  ['Uneven officer workload', 'Demand can fall unevenly across officers and districts.'],
  ['Review bottlenecks', 'Supervisor review can become the second queue.'],
  ['Delayed closure updates', 'Residents can wait longer for a closure update when capacity is constrained.'],
] as const

// 2. What the POC does — a complaint becomes a structured workflow.
const workflowCards = [
  ['Resident intake', 'A structured complaint enters the staff workflow.'],
  ['Staff triage', 'Staff review priority, routing, and recommended next action.'],
  ['Recommended routing', 'A recommended officer or routing option is surfaced for staff to confirm or override.'],
  ['Field follow up', 'The assigned officer records the field outcome when needed.'],
  ['Supervisor approved closure', 'A supervisor reviews and approves the final response before it is sent.'],
] as const

// 3. Where AI and advanced analytics are used — compact cards, one capability
// each. Only genuine model-backed capabilities are described as AI: the case
// scoped Field Support Assistant (Groq LPU inference), embeddings/reranking for
// similar case retrieval, CTGAN synthetic demand, and the ABM queue simulation.
// Rules based workflow support (intake, officer recommendation, closure) is
// called out as decision support, not AI.
const aiCards = [
  [
    'Field Support Assistant',
    'Case scoped AI assistant for officers. Helps prepare site checks, evidence notes, field summaries, and supervisor handoff. Backed by Groq LPU inference when configured. Staff decide all actions.',
  ],
  [
    'Similar Case Retrieval',
    'Uses embeddings and reranking to surface comparable public benchmark cases for reference. It supports review context only and does not decide outcomes.',
  ],
  [
    'Synthetic Demand',
    'Uses CTGAN to generate synthetic planning demand from a public 311 benchmark. It does not create or claim real Brampton records.',
  ],
  [
    'Queue Simulation',
    'Uses ABM to run synthetic demand through district queues, officer capacity, supervisor review, and closure pressure for capacity planning.',
  ],
  [
    'Rules Based Workflow Support',
    'Structured intake, priority review, officer recommendation, and closure drafts use transparent rules, templates, and staff approval. They are decision support, not AI decisions.',
  ],
] as const

// 4. How stress testing works — synthetic demand, scenario shocks, queue ABM.
const stressCards = [
  ['Synthetic 311 demand', 'Creates planning scenarios from a public 311 benchmark.'],
  ['Scenario shock testing', 'Shows what happens when demand rises or capacity drops.'],
  ['Queue based ABM', 'Runs demand through district queues, officer capacity, supervisor review, and closure pressure.'],
  ['Stress Testing tab', 'Shows backlog risk, stale case risk, red zones, and prevention actions.'],
] as const

// 5. What it produces — compact output pills.
const outputs = [
  'Backlog risk',
  'Stale case risk',
  'District pressure',
  'Complaint type pressure',
  'Supervisor review pressure',
  'Staff capacity need',
  'Operational pressure map',
  'Prevention action',
] as const

// 6. Governance and limits — the guardrails, stated plainly.
const guardrails = [
  'Decision support only',
  'Public 311 benchmark',
  'Synthetic demand',
  'Not live Brampton operational data',
  'Not enforcement decisioning',
  'Staff approve actions',
  'No automated enforcement',
] as const

export default function MethodologyPage() {
  return (
    <div className="container-page py-12 sm:py-16">
      {/* Hero */}
      <header className="max-w-3xl">
        <div className="section-eyebrow">Methodology</div>
        <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight text-navy-900 sm:text-4xl">
          How the proactive enforcement POC works
        </h1>
        <p className="mt-4 text-base leading-relaxed text-ink-muted sm:text-lg">
          A human reviewed workflow that helps Enforcement and By Law staff triage complaints, support field follow up,
          approve closures, and stress test workload pressure before backlog grows.
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
        {/* Section 1: The problem */}
        <Section
          title="The problem"
          lead="Staff need a way to see operational pressure early and decide where to shift attention."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {problemCards.map(([title, detail]) => (
              <Card key={title} title={title} detail={detail} tone="avoid" />
            ))}
          </div>
        </Section>

        {/* Section 2: What the POC does */}
        <Section
          title="What the POC does"
          lead="It turns a complaint into a structured workflow: triage, recommended routing, officer follow up, supervisor approved closure, and resident communication support."
        >
          <FlowCards items={workflowCards} />
        </Section>

        {/* Section 3: Where AI and advanced analytics are used */}
        <Section
          title="Where AI and advanced analytics are used"
          lead="The POC combines rules based workflow support, case scoped AI assistance, retrieval, and synthetic workload simulation. Staff stay in control of every decision."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {aiCards.map(([title, detail]) => (
              <Card key={title} title={title} detail={detail} />
            ))}
          </div>
        </Section>

        {/* Section 4: How stress testing works */}
        <Section
          title="How stress testing works"
          lead="Synthetic demand and a queue based simulation show workload pressure before it becomes backlog, stale cases, or delayed closure updates."
        >
          <FlowCards items={stressCards} />
          <p className="mt-4 text-xs leading-relaxed text-ink-subtle">
            Uses a public 311 benchmark and synthetic demand. Not live Brampton operational data. Not enforcement decisioning.
          </p>
        </Section>

        {/* Section 5: What it produces */}
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
          <p className="mt-4 text-sm leading-relaxed text-ink-muted">
            Results surface on an operational pressure map, including a 3D district pressure heat map, so staff can see
            where pressure is building and where a prevention action may help.
          </p>
        </Section>

        {/* Section 6: Governance and limits */}
        <Section title="Governance and limits">
          <div className="rounded-2xl bg-navy-900 px-6 py-5">
            <div className="flex flex-wrap gap-2">
              {guardrails.map((g) => (
                <span
                  key={g}
                  className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-navy-50 ring-1 ring-inset ring-white/15"
                >
                  {g}
                </span>
              ))}
            </div>
            <p className="mt-4 text-sm font-medium leading-relaxed text-navy-50">
              The POC is decision support. Staff remain responsible for review, action, and any enforcement decision.
            </p>
          </div>
        </Section>

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
              The synthetic demand generator (CTGAN) learns patterns in the public 311 benchmark, including complaint
              mix, district pressure, timing, and closure patterns. It produces synthetic planning demand that is
              statistically similar to benchmark demand but never claims to be real Brampton records.
            </p>
            <p>
              A scenario shock layer applies pressure scenarios to that demand — for example demand rising in selected
              districts or complaint types, or capacity dropping — before it enters the simulation. This is a planning
              scenario layer, not a prediction of real events.
            </p>
            <p>
              The queue based operations simulation (ABM) runs the adjusted demand through district queues, officer
              capacity, supervisor review, and closure pressure using clear, visible rules. This helps staff see why
              capacity constrained queue pressure builds and where prevention actions may help.
            </p>
            <p>
              The officer guidance assistant is a server-side, case-scoped helper backed by Groq LPU inference. It is
              grounded only in the current case context and workflow timeline, never writes to any record, and never
              makes an enforcement decision.
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
