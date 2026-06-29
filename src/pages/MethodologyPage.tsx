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

// How the stress testing data is created — a staff-friendly 6-stage pipeline.
// Short label + short description + a simple vector icon per stage. No internal
// implementation details: no script names, table names, view names, migrations,
// or file paths are ever surfaced here.
type StageIcon = 'benchmark' | 'pattern' | 'workload' | 'capacity' | 'pressure' | 'action'

const stressPipeline: { label: string; detail: string; icon: StageIcon }[] = [
  {
    label: 'Public 311 benchmark',
    detail:
      'Real New York City 311 complaint patterns are used as the public benchmark for the proof of concept. This is not Brampton operational data.',
    icon: 'benchmark',
  },
  {
    label: 'Pattern extraction',
    detail:
      'The system reads benchmark patterns such as complaint type mix, location pressure, repeat issue signals, closure pressure, and likely review needs.',
    icon: 'pattern',
  },
  {
    label: 'Synthetic workload estimate',
    detail:
      'Synthetic patrol and workload activity is estimated from those benchmark patterns. This is benchmark based — not random, and not real patrol history.',
    icon: 'workload',
  },
  {
    label: 'Capacity simulation',
    detail:
      'The synthetic demand is passed through district queues, officer capacity, supervisor review, and closure update pressure.',
    icon: 'capacity',
  },
  {
    label: 'Pressure signals',
    detail:
      'The model identifies where queue pressure, backlog, supervisor review, or district pressure could build under the scenario.',
    icon: 'pressure',
  },
  {
    label: 'Supervisor action',
    detail:
      'The view recommends planning actions, such as where to shift review capacity or field capacity. Staff remain responsible for review and action.',
    icon: 'action',
  },
]

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
            {/* How the stress testing data is created — a visual, staff-friendly
                pipeline. No code names, table names, view names, or file paths. */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
              <h3 className="text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
                How the stress testing data is created
              </h3>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
                Each stage builds on the one before it — from a public benchmark to a recommended supervisor action. The
                numbers are an estimate for capacity planning. They describe where operational pressure could build, not
                what has happened.
              </p>

              {/* Stacked on mobile, horizontal flow on desktop, with connectors. */}
              <ol className="mt-6 flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-0">
                {stressPipeline.map((stage, i) => (
                  <li key={stage.label} className="flex flex-col lg:flex-1 lg:flex-row lg:items-stretch">
                    <div className="flex h-full w-full flex-col rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                      <div className="flex items-center gap-2">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-navy-900 text-accent-300">
                          <StageGlyph icon={stage.icon} />
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
                          Stage {i + 1}
                        </span>
                      </div>
                      <h4 className="mt-3 text-sm font-semibold text-navy-900">{stage.label}</h4>
                      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{stage.detail}</p>
                    </div>
                    {i < stressPipeline.length - 1 && (
                      <span
                        aria-hidden
                        className="flex shrink-0 items-center justify-center self-center py-1 text-slate-300 lg:px-1 lg:py-0"
                      >
                        {/* Down arrow on mobile, right arrow on desktop. */}
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

              <p className="mt-6 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm leading-relaxed text-ink-muted">
                This is a capacity planning simulation. It uses public 311 benchmark patterns to estimate synthetic
                workload pressure. It is not live Brampton operational data, not a record of real patrol activity, and not
                enforcement decisioning.
              </p>
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

// Simple vector glyphs for the "How the stress testing data is created" pipeline.
// Plain line icons (no library) so each stage reads as a product diagram step.
function StageGlyph({ icon }: { icon: StageIcon }) {
  const common = {
    viewBox: '0 0 24 24',
    className: 'h-5 w-5',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (icon) {
    case 'benchmark': // database / public benchmark
      return (
        <svg {...common}>
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
          <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
        </svg>
      )
    case 'pattern': // pattern extraction / signal scan
      return (
        <svg {...common}>
          <path d="M3 12h3l2-7 4 16 2-9h4" />
        </svg>
      )
    case 'workload': // synthetic workload estimate / layers
      return (
        <svg {...common}>
          <path d="m12 3 9 5-9 5-9-5 9-5Z" />
          <path d="m3 13 9 5 9-5" />
        </svg>
      )
    case 'capacity': // capacity simulation / queues
      return (
        <svg {...common}>
          <rect x="3" y="4" width="6" height="16" rx="1" />
          <rect x="10.5" y="8" width="6" height="12" rx="1" />
          <rect x="18" y="12" width="3" height="8" rx="1" />
        </svg>
      )
    case 'pressure': // pressure signals / gauge
      return (
        <svg {...common}>
          <path d="M12 13 16 9" />
          <path d="M4 18a8 8 0 1 1 16 0" />
          <circle cx="12" cy="18" r="1" />
        </svg>
      )
    case 'action': // supervisor action / check
      return (
        <svg {...common}>
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      )
  }
}
