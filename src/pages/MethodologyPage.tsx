import { Fragment, type ReactNode } from 'react'

// Public methodology page for the AI-assisted Proactive Enforcement Response POC.
// Visual-first: a hero, a full architecture diagram (workflow + supporting
// layers), a "why this matters" grid, the Stress Testing / Simulation Lab
// preview, a data-and-governance note, and governance guardrails.
//
// This page is PUBLIC. It intentionally avoids private database details,
// infrastructure specifics, and any claim of live Brampton operational data.
// The system is decision support only — staff stay in control at every step.

// ---------------------------------------------------------------------------
// Content data
// ---------------------------------------------------------------------------

// Main complaint-to-update workflow. Each step is one short, plain-language node.
const WORKFLOW_STEPS = [
  { n: 1, title: 'Resident intake', detail: 'Issue submitted by a resident' },
  { n: 2, title: 'Structured service request', detail: 'Captured as clean, reviewable data' },
  { n: 3, title: 'Staff triage & priority review', detail: 'Staff assess priority and context' },
  { n: 4, title: 'Field follow up', detail: 'Officer records the observed condition' },
  { n: 5, title: 'Closure draft support', detail: 'Draft wording prepared for review' },
  { n: 6, title: 'Supervisor approval', detail: 'Supervisor signs off before closure' },
  { n: 7, title: 'Resident update', detail: 'Approved response sent to the resident' },
]

// Three supporting layers that sit beneath the workflow.
const SUPPORT_LAYERS: {
  title: string
  accent: 'navy' | 'accent' | 'amber'
  items: string[]
}[] = [
  {
    title: 'Benchmark intelligence',
    accent: 'navy',
    items: ['NYC 311 public data', 'Similar case retrieval', 'Closure pattern analysis'],
  },
  {
    title: 'Operational analytics',
    accent: 'accent',
    items: ['Work queue', 'Heat map', 'Closure duration', 'Complaint type pressure', 'District workload'],
  },
  {
    title: 'Stress Testing / Simulation Lab',
    accent: 'amber',
    items: ['Synthetic patrol logs', 'Officer capacity', 'Backlog growth', 'CTGAN demand shocks', 'ABM operations simulation'],
  },
]

// "Why this matters" value cards.
const VALUE_CARDS: { title: string; detail: string; icon: ReactNode }[] = [
  {
    title: 'Cleaner intake',
    detail: 'Residents submit structured requests that are easier for staff to review.',
    icon: <IconClipboard />,
  },
  {
    title: 'Faster triage',
    detail: 'Staff can see priority context, similar cases, and workload pressure earlier.',
    icon: <IconBolt />,
  },
  {
    title: 'More consistent closure responses',
    detail: 'Draft closure language can be grounded in similar historical cases, but remains staff reviewed.',
    icon: <IconChat />,
  },
  {
    title: 'Capacity planning',
    detail: 'Stress testing can estimate when complaint volume, follow ups, and officer workload create backlog risk.',
    icon: <IconGauge />,
  },
]

// Stress Testing mini-flow (generative scenarios → simulation → planning signals).
const STRESS_FLOW = [
  'CTGAN demand scenarios',
  'ABM enforcement operations model',
  'Officer capacity depletion',
  'Backlog growth',
  'Stress zones',
]

// Plain-language explanation of the stress-testing techniques. Careful framing:
// generative scenario modelling and capacity planning, never automated decisions.
const STRESS_NOTES: { term: string; detail: string }[] = [
  {
    term: 'CTGAN',
    detail: 'A generative AI technique used to create plausible demand scenarios from benchmark data.',
  },
  {
    term: 'ABM',
    detail: 'Simulates how different agents interact — complaints, officer units, districts, supervisor queues, and resident attention.',
  },
  {
    term: 'GPU accelerated training',
    detail: 'Can speed up scenario generation when larger benchmark datasets are used locally.',
  },
  {
    term: 'The output',
    detail: 'Planning insight, not enforcement decisions.',
  },
]

const GOVERNANCE_NOTES = [
  'The current demo uses NYC 311 public benchmark data, not Brampton operational data.',
  'Brampton data can be connected later with City approval.',
  'Resident messages and enforcement actions remain under human control.',
  'The system preserves provenance, auditability, and clear labelling of benchmark versus operational data.',
]

const GUARDRAILS = [
  'No automated tickets',
  'No automated enforcement decisions',
  'No automatic case closure',
  'No resident message without staff approval',
  'No officer replacement or performance scoring',
  'Benchmark data clearly labelled',
]

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MethodologyPage() {
  return (
    <div className="container-page py-12 sm:py-16">
      {/* 1. Hero ------------------------------------------------------------ */}
      <header className="max-w-3xl">
        <div className="section-eyebrow">Methodology</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          How the AI assisted enforcement POC works
        </h1>
        <p className="mt-4 text-base leading-relaxed text-ink-muted sm:text-lg">
          This proof of concept shows how resident complaints can move from structured intake to staff review, field
          follow up, supervisor approved closure communication, and workload intelligence. The system supports municipal
          staff with decision support, not automated enforcement.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {['Decision support', 'Human approval', 'Benchmark data', 'Capacity planning'].map((tag) => (
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
        {/* 2. Architecture diagram --------------------------------------- */}
        <section>
          <SectionTitle
            eyebrow="System architecture"
            title="From a resident complaint to a workload signal"
          />
          <div className="mt-6">
            <MethodologyArchitectureDiagram />
          </div>
        </section>

        {/* 3. Why this matters ------------------------------------------- */}
        <section>
          <SectionTitle eyebrow="Why this matters" title="What staff gain at each step" />
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {VALUE_CARDS.map((card) => (
              <div key={card.title} className="card card-hover flex flex-col p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-50 text-accent-700">
                  {card.icon}
                </span>
                <h3 className="mt-4 text-sm font-semibold text-navy-900">{card.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{card.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 4. Stress Testing and Simulation Lab -------------------------- */}
        <StressTestingSection />

        {/* 5. Data and governance ---------------------------------------- */}
        <section>
          <SectionTitle eyebrow="Trust" title="Data and governance" />
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {GOVERNANCE_NOTES.map((note) => (
              <div key={note} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <span aria-hidden className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-50 text-navy-700">
                  <IconCheck />
                </span>
                <p className="text-sm leading-relaxed text-ink-muted">{note}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 6. Governance guardrails -------------------------------------- */}
        <section>
          <SectionTitle eyebrow="Limits by design" title="Governance guardrails" />
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {GUARDRAILS.map((item) => (
              <li
                key={item}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3"
              >
                <span
                  aria-hidden
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600 ring-1 ring-inset ring-rose-100"
                >
                  <IconShieldNo />
                </span>
                <span className="text-sm font-medium text-navy-900">{item}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Architecture diagram
// ---------------------------------------------------------------------------

const LAYER_ACCENTS = {
  navy: { dot: 'bg-navy-500', chip: 'bg-navy-50 text-navy-700 ring-navy-100', bar: 'bg-navy-500' },
  accent: { dot: 'bg-accent-500', chip: 'bg-accent-50 text-accent-700 ring-accent-100', bar: 'bg-accent-500' },
  amber: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-800 ring-amber-100', bar: 'bg-amber-400' },
} as const

// The full picture: a numbered workflow on top, then the three intelligence
// layers that support it. Native React + Tailwind — cards, connectors, badges.
function MethodologyArchitectureDiagram() {
  return (
    <div className="card overflow-hidden p-6 sm:p-8">
      {/* Main workflow row — wraps responsively; arrows turn down on mobile. */}
      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-stretch">
        {WORKFLOW_STEPS.map((step, index) => (
          <Fragment key={step.n}>
            <div className="flex flex-1 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3.5 shadow-sm lg:min-w-[150px] lg:flex-col lg:items-center lg:gap-2 lg:px-3 lg:py-4 lg:text-center">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-900 text-sm font-semibold text-white">
                {step.n}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight text-navy-900">{step.title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-ink-muted">{step.detail}</span>
              </span>
            </div>
            {index < WORKFLOW_STEPS.length - 1 && (
              <span aria-hidden className="flex items-center justify-center text-ink-subtle lg:px-0.5">
                <span className="lg:hidden">↓</span>
                <span className="hidden lg:inline">→</span>
              </span>
            )}
          </Fragment>
        ))}
      </div>

      {/* Connector label: the workflow runs on top of three support layers. */}
      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
          Supported by
        </span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      {/* Three supporting layers. */}
      <div className="grid gap-4 lg:grid-cols-3">
        {SUPPORT_LAYERS.map((layer) => {
          const a = LAYER_ACCENTS[layer.accent]
          return (
            <div key={layer.title} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5">
              <span className={`h-1 w-10 rounded-full ${a.bar}`} />
              <div className="mt-3 flex items-center gap-2">
                <span aria-hidden className={`h-2 w-2 rounded-full ${a.dot}`} />
                <h3 className="text-sm font-semibold text-navy-900">{layer.title}</h3>
              </div>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {layer.items.map((item) => (
                  <li
                    key={item}
                    className={`rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${a.chip}`}
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stress Testing and Simulation Lab section
// ---------------------------------------------------------------------------

function StressTestingSection() {
  return (
    <section className="card overflow-hidden">
      {/* Header band — visually marks this as the forward-looking layer. */}
      <div className="border-b border-slate-200 bg-navy-900 px-6 py-6 sm:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Stress Testing and Simulation Lab
          </h2>
          <span className="inline-flex items-center rounded-full bg-amber-400/20 px-2.5 py-0.5 text-xs font-semibold text-amber-200 ring-1 ring-inset ring-amber-400/30">
            Next layer
          </span>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-navy-100">
          The next layer turns historical complaint patterns into planning scenarios. Synthetic patrol logs translate
          complaint volume into estimated field actions, officer minutes, follow ups, supervisor review pressure, and
          backlog risk. This lets the City test operational questions before they become real bottlenecks.
        </p>
      </div>

      <div className="px-6 py-7 sm:px-8">
        {/* Mini flow: generative scenarios → simulation → planning signals. */}
        <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
          {STRESS_FLOW.map((label, index) => (
            <Fragment key={label}>
              <div className="flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-center text-sm font-semibold text-navy-900 lg:min-w-[120px]">
                {label}
              </div>
              {index < STRESS_FLOW.length - 1 && (
                <span aria-hidden className="flex items-center justify-center text-ink-subtle">
                  <span className="lg:hidden">↓</span>
                  <span className="hidden lg:inline">→</span>
                </span>
              )}
            </Fragment>
          ))}
        </div>

        {/* Technique explanations. */}
        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          {STRESS_NOTES.map((note) => (
            <div key={note.term} className="rounded-xl border border-slate-200 bg-white p-4">
              <dt className="text-sm font-semibold text-navy-900">{note.term}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-ink-muted">{note.detail}</dd>
            </div>
          ))}
        </dl>

        {/* Careful-language summary line. */}
        <p className="mt-6 rounded-xl bg-accent-50 px-4 py-3 text-sm leading-relaxed text-accent-800 ring-1 ring-inset ring-accent-100">
          GPU accelerated stress testing and generative scenario modelling are used for capacity planning and decision
          support only. Every result is reviewed by staff, and human approval is always required before any action.
        </p>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="max-w-3xl">
      <div className="section-eyebrow">{eyebrow}</div>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900">{title}</h2>
    </div>
  )
}

// Inline SVG icons (no icon library — matches the rest of the app).
function svgProps(className = 'h-5 w-5') {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className,
  }
}

function IconClipboard() {
  return (
    <svg {...svgProps()}>
      <rect x="8" y="4" width="8" height="4" rx="1" />
      <path d="M8 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2M9 13h6M9 17h4" />
    </svg>
  )
}

function IconBolt() {
  return (
    <svg {...svgProps()}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </svg>
  )
}

function IconChat() {
  return (
    <svg {...svgProps()}>
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z" />
    </svg>
  )
}

function IconGauge() {
  return (
    <svg {...svgProps()}>
      <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 14l3-3M5 19a9 9 0 1 1 14 0" />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg {...svgProps('h-3.5 w-3.5')} strokeWidth={2.2}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function IconShieldNo() {
  return (
    <svg {...svgProps('h-4 w-4')}>
      <path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6l-8-3Z" />
      <path d="M9.5 9.5 14.5 14.5" />
    </svg>
  )
}
