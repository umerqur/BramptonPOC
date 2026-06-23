import { Fragment, type ReactNode } from 'react'
import SectionHeading from '../components/SectionHeading'

// Public methodology page for the Proactive Enforcement Response POC.
// Visual-first and intentionally short: a hero, a complaint-to-closure flow
// diagram, a small support layer, guardrails, and a one-line data note.
// The system is decision support only — staff stay in control at every step.

const FLOW_STEPS = [
  { n: 1, title: 'Intake', detail: 'Resident submits issue' },
  { n: 2, title: 'Triage', detail: 'Staff reviews priority' },
  { n: 3, title: 'Field review', detail: 'Officer records outcome' },
  { n: 4, title: 'Approval', detail: 'Supervisor approves closure' },
  { n: 5, title: 'Update', detail: 'Resident receives response' },
]

const SUPPORTS: { title: string; detail: string }[] = [
  { title: 'Workload view', detail: 'Shows queue pressure' },
  { title: 'Similar cases', detail: 'Adds context' },
  { title: 'Closure draft', detail: 'Prepares staff-reviewed wording' },
]

const GUARDRAILS = [
  'No automatic tickets',
  'No automatic enforcement decisions',
  'No automatic case closure',
  'No resident message without approval',
]

export default function MethodologyPage() {
  return (
    <div className="container-page py-12">
      <SectionHeading
        eyebrow="Methodology"
        title="How the POC works"
        description="A complaint moves through intake, staff review, field follow-up, supervisor approval, and resident update. Staff stay in control at every step."
      />

      <div className="mt-10 max-w-5xl space-y-8">
        {/* B. Large visual flow card — the complaint-to-closure diagram. */}
        <Section title="Complaint to closure flow">
          <MethodologyFlowDiagram steps={FLOW_STEPS} />
        </Section>

        {/* C. Small support layer — three compact cards. */}
        <Section title="What the system supports">
          <div className="grid gap-3 sm:grid-cols-3">
            {SUPPORTS.map((item) => (
              <div key={item.title} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <h3 className="text-sm font-semibold text-navy-900">{item.title}</h3>
                <p className="mt-1 text-xs text-ink-muted">{item.detail}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* D. Guardrails — compact cross rows. */}
        <Section title="What it does not do">
          <ul className="grid gap-2 sm:grid-cols-2">
            {GUARDRAILS.map((item) => (
              <li
                key={item}
                className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50/50 px-3 py-2 text-sm text-rose-900"
              >
                <span aria-hidden className="text-rose-500">✕</span>
                {item}
              </li>
            ))}
          </ul>
        </Section>

        {/* E. Data note — one short card. */}
        <Section title="Demo data">
          <p className="text-sm leading-relaxed text-ink-muted">
            This demo uses public NYC 311 benchmark data. Brampton operational data can be connected later with City
            approval.
          </p>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card p-6">
      <h2 className="text-lg font-semibold text-navy-900">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

// Compact visual flow diagram. Rectangular cards with a number circle, a short
// title, and one short line — joined by arrows. Horizontal row with right-arrows
// from md up, vertical stack with down-arrows on mobile, so it reads as a diagram
// rather than an article at every width.
function MethodologyFlowDiagram({ steps }: { steps: typeof FLOW_STEPS }) {
  return (
    <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-stretch">
      {steps.map((step, index) => (
        <Fragment key={step.n}>
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-6 text-center shadow-sm">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-navy-900 text-base font-semibold text-white">
              {step.n}
            </span>
            <span className="text-sm font-semibold text-navy-900">{step.title}</span>
            <span className="text-xs text-ink-muted">{step.detail}</span>
          </div>
          {index < steps.length - 1 && (
            <span aria-hidden className="self-center text-lg text-ink-subtle md:rotate-0">
              <span className="md:hidden">↓</span>
              <span className="hidden md:inline">→</span>
            </span>
          )}
        </Fragment>
      ))}
    </div>
  )
}
