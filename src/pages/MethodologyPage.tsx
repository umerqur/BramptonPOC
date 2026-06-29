// Public methodology page for the Brampton Proactive Enforcement Response POC.
// Built entirely from responsive React + Tailwind components — no fixed-width
// SVG with baked-in text — so the workflow and simulation diagrams scale cleanly
// from wide desktop down to portrait mobile.

const heroBadges = ['Decision support', 'Human approval', '3.4M NYC 311 records', 'Capacity planning']

const workflowSteps = [
  ['1', 'Resident intake', 'Resident submits a demo municipal request.'],
  ['2', 'Structured service request', 'Complaint details become clean, reviewable case data.'],
  ['3', 'Staff triage', 'Staff review priority, location, complaint type, history, and workload context.'],
  ['4', 'Field follow up', 'Officer observations or patrol style context can be attached to the case.'],
  ['5', 'Closure support', 'Draft wording and case summaries are prepared for staff review.'],
  ['6', 'Supervisor approval', 'A supervisor approves the final closure response.'],
  ['7', 'Resident update', 'Approved response is sent to the resident.'],
] as const

const abmAgents = [
  ['ComplaintAgent', 'A synthetic service request moving through the system.'],
  ['OfficerUnitAgent', 'Available field capacity, measured in officer minutes.'],
  ['DistrictAgent', 'A geographic area receiving and holding demand.'],
  ['SupervisorQueueAgent', 'Closure responses waiting for human approval.'],
  ['ResidentUpdateAgent', 'The approved update sent back to residents.'],
] as const

const abmRules = [
  'How many officer minutes are available?',
  'How long do different case types take?',
  'Which districts receive demand?',
  'When do supervisor queues grow?',
  'When does backlog risk increase?',
  'When are resident updates delayed?',
] as const

const couplingFlow = [
  'Historical 311 records',
  'Synthetic demand generator',
  'Synthetic complaint agents',
  'District and officer capacity model',
  'Supervisor queue',
  'Planning outputs',
] as const

const simulationOutputs = [
  'Backlog risk',
  'Stale case risk',
  'District overload',
  'Complaint type pressure',
  'Staff capacity needed',
  'Supervisor review pressure',
] as const

const whyItMatters = [
  ['For residents', 'Clearer intake, better status updates, and more consistent closure communication.'],
  ['For staff', 'Less manual review, stronger triage, and clearer workload visibility.'],
  ['For supervisors', 'Queue pressure, stale case risk, approval workload, and staffing scenarios in one view.'],
  ['For analytics and research', 'Transparent assumptions, reproducible simulation logic, and explainable outputs.'],
] as const

// The full stress-testing lineage, business-facing title + plain description
// first, with the technical table/view name kept small in a `tech` note.
const stressLineage = [
  [
    'Public 311 benchmark cases',
    'Real municipal complaint records used for POC benchmarking. These are public New York City 311 records, not Brampton operational data.',
    'municipal_complaints',
  ],
  [
    'Rules based synthetic patrol log generator',
    'A transparent, rules based generator estimates likely field activity, officer workload, supervisor review needs, and closure effort for each case. The estimates are synthetic — not a record of real patrol work.',
    'generate_synthetic_patrol_logs.py',
  ],
  [
    'Synthetic patrol logs',
    'The estimated field activity is stored as synthetic patrol logs. They are synthetic and rules based, not real Brampton patrol history.',
    'synthetic_patrol_logs (Supabase)',
  ],
  [
    'Aggregate workload views',
    'The logs are rolled up into workload signals by district, officer unit, and complaint type — estimated hours, supervisor review counts, and coverage.',
    'v_synthetic_patrol_workload_by_* views',
  ],
  [
    'Scenario simulation',
    'A scenario layer creates scenario adjusted demand and pressure outputs, running the workload through a district by district capacity model to see where queues build.',
    'CTGAN + ABM · ctgan_abm_* views',
  ],
  [
    'Red zone analysis',
    'The Stress Testing tab reads the current baseline, the projected trajectory, the worst case red zones, and the failure drivers behind them.',
    'Stress Testing tab',
  ],
  [
    'Supervisor prevention actions',
    'Each red zone comes with a recommended action — where to move review or field capacity before backlog compounds. Staff remain responsible for review and action.',
    'Recommended actions',
  ],
] as const

const governanceCards = [
  ['Public source data', 'Built on public NYC 311 service request records, not Brampton operational data.'],
  ['Labelled scenarios', 'Synthetic demand scenarios are clearly labelled as simulation, never real records.'],
  ['Human approval required', 'Case actions and resident messages always require staff approval.'],
  ['Auditable by design', 'Visible rules and reproducible logic make every output explainable.'],
] as const

export default function MethodologyPage() {
  return (
    <div className="container-page py-12 sm:py-16">
      {/* 1. Hero */}
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

      <div className="mt-12 space-y-12 sm:mt-16 sm:space-y-16">
        {/* 2. Workflow diagram — responsive cards with arrows */}
        <section>
          <SectionTitle eyebrow="How it works" title="From a resident complaint to an approved update" />
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-muted">
            Every step keeps a person in the loop. The POC structures the work and surfaces context; staff and
            supervisors make the decisions.
          </p>
          <ol className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch sm:gap-3">
            {workflowSteps.map(([n, title, detail], i) => (
              <li key={n} className="flex flex-col sm:flex-1 sm:basis-44 sm:flex-row sm:items-stretch">
                <div className="flex w-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-900 text-sm font-semibold text-white">
                    {n}
                  </span>
                  <h3 className="mt-3 text-sm font-semibold text-navy-900">{title}</h3>
                  <p className="mt-1 text-xs leading-snug text-ink-muted">{detail}</p>
                </div>
                {i < workflowSteps.length - 1 && (
                  <span
                    aria-hidden
                    className="flex shrink-0 items-center justify-center self-center text-lg text-slate-300 sm:px-0.5"
                  >
                    <span className="sm:hidden">↓</span>
                    <span className="hidden sm:inline">→</span>
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>

        {/* 3. CTGAN + ABM stress testing */}
        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 bg-navy-900 px-6 py-7 sm:px-8">
            <div className="text-xs font-semibold uppercase tracking-wider text-accent-300">Stress testing</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              AI Simulation &amp; Risk Modelling
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-navy-100">
              The POC moves beyond dashboards into a simulation layer. It tests where service pressure could create
              bottlenecks before they happen, and reports a current baseline, a projected trajectory, the worst case red
              zones, the failure drivers behind them, and the recommended prevention actions. This is planning simulation
              and decision support only — not live Brampton operational data, and not real Brampton patrol history. Staff
              remain responsible for review and action.
            </p>
          </div>

          <div className="space-y-8 px-6 py-8 sm:px-8">
            {/* How the stress testing data is created — business-friendly lineage,
                staff language first with technical names kept small. */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
              <h3 className="text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
                How the stress testing data is created
              </h3>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
                Each stage builds on the one before it, from real benchmark complaints to a recommended supervisor
                action. The numbers are an estimate for planning — they describe where pressure could build, not what
                has happened.
              </p>
              <ol className="mt-6 space-y-3">
                {stressLineage.map(([title, detail, tech], i) => (
                  <li key={title} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-900 text-sm font-semibold text-white">
                        {i + 1}
                      </span>
                      {i < stressLineage.length - 1 && <span aria-hidden className="mt-1 w-px flex-1 bg-slate-200" />}
                    </div>
                    <div className="flex-1 pb-2">
                      <h4 className="text-sm font-semibold text-navy-900">{title}</h4>
                      <p className="mt-1 text-sm leading-relaxed text-ink-muted">{detail}</p>
                      <span className="mt-1.5 inline-flex items-center gap-1.5 rounded bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-ink-subtle ring-1 ring-inset ring-slate-200">
                        {tech}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm leading-relaxed text-amber-900">
                <span className="font-semibold">What this is, and is not: </span>
                the public 311 benchmark cases are real municipal complaint records used for POC benchmarking. The patrol
                logs are synthetic and rules based — they estimate likely field activity, officer workload, supervisor
                review needs, and closure effort. This is not live Brampton operational data and not real Brampton patrol
                history. It is planning simulation and decision support only, and staff remain responsible for review and
                action.
              </div>
            </div>

            {/* CTGAN + ABM explainers */}
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-accent-100 px-2 py-0.5 text-xs font-semibold text-accent-800">
                    CTGAN
                  </span>
                  <h3 className="text-sm font-semibold text-navy-900">Synthetic demand generator</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                  CTGAN is a neural network architecture for synthetic tabular data. In this POC it learns statistical
                  patterns from 3.4M New York City 311 public records from the past 12 months — such as complaint type,
                  district, timing, backlog pressure, and closure patterns. It can generate realistic synthetic service
                  request scenarios that look statistically similar to historical demand, without claiming to be real
                  Brampton records.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-accent-100 px-2 py-0.5 text-xs font-semibold text-accent-800">
                    ABM
                  </span>
                  <h3 className="text-sm font-semibold text-navy-900">Explainable operations model</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                  An agent based model is a rules based simulation where each part of the operation is represented as an
                  agent. The rules are visible, so staff can understand why backlog, supervisor pressure, or district
                  overload appears.
                </p>
                <ul className="mt-4 space-y-1.5">
                  {abmAgents.map(([name, desc]) => (
                    <li key={name} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                      <span className="rounded bg-white px-1.5 py-0.5 font-mono font-semibold text-navy-800 ring-1 ring-inset ring-slate-200">
                        {name}
                      </span>
                      <span className="text-ink-muted">{desc}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* The rules are visible — core value proposition, large checklist cards */}
            <div className="rounded-2xl border border-accent-100 bg-accent-50/40 p-6 sm:p-8">
              <h3 className="text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">The rules are visible</h3>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
                The simulation answers plain questions that staff can read and challenge directly.
              </p>
              <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {abmRules.map((rule, i) => (
                  <li
                    key={rule}
                    className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-100 text-sm font-bold text-accent-800">
                      {i + 1}
                    </span>
                    <span className="text-lg font-semibold leading-snug text-navy-900 sm:text-xl">{rule}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* The coupling — mini pipeline diagram */}
            <div>
              <h3 className="text-sm font-semibold text-navy-900">The powerful part is the coupling</h3>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
                The AI demand generator creates plausible future complaint demand. The operations model then tests what
                happens when that demand hits staff, officers, districts, and supervisor queues.
              </p>
              <ol className="mt-4 flex flex-col gap-2 lg:flex-row lg:items-stretch">
                {couplingFlow.map((node, i) => (
                  <li key={node} className="flex flex-col items-stretch lg:flex-1 lg:flex-row">
                    <div className="flex flex-1 items-center justify-center rounded-xl border border-navy-100 bg-navy-50 px-3 py-3 text-center text-xs font-semibold text-navy-900">
                      {node}
                    </div>
                    {i < couplingFlow.length - 1 && (
                      <span
                        aria-hidden
                        className="flex shrink-0 items-center justify-center self-center text-navy-300 lg:px-1"
                      >
                        <span className="lg:hidden">↓</span>
                        <span className="hidden lg:inline">→</span>
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>

            {/* Outputs */}
            <div>
              <h3 className="text-sm font-semibold text-navy-900">Outputs — planning signals, not enforcement decisions</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {simulationOutputs.map((output) => (
                  <div
                    key={output}
                    className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm font-medium text-navy-900"
                  >
                    {output}
                  </div>
                ))}
              </div>
            </div>

            {/* Final summary banner */}
            <div className="rounded-2xl bg-navy-900 px-6 py-8 sm:px-10 sm:py-10">
              <p className="text-xl font-semibold leading-snug text-white sm:text-2xl lg:text-3xl">
                We run these simulations to find bottlenecks before residents and staff feel them.
              </p>
              <p className="mt-4 max-w-3xl text-sm leading-relaxed text-navy-100 sm:text-base">
                The goal is not to automate enforcement. The goal is to show which conditions create operational
                pressure, what to avoid, and where staffing, triage, or supervisor review capacity may need adjustment.
              </p>
            </div>
          </div>
        </section>

        {/* 4. Why this matters */}
        <section>
          <SectionTitle eyebrow="Why this matters" title="What each group gains" />
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {whyItMatters.map(([title, detail]) => (
              <div key={title} className="card card-hover flex flex-col p-5">
                <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 5. Governance */}
        <section>
          <SectionTitle eyebrow="Trust" title="Governance and data" />
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {governanceCards.map(([title, detail]) => (
              <div key={title} className="rounded-2xl border border-slate-200 bg-white p-5">
                <span className="block h-1 w-10 rounded-full bg-accent-500" />
                <h3 className="mt-3 text-sm font-semibold text-navy-900">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{detail}</p>
              </div>
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
