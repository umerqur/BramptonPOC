import { Fragment, type ReactNode } from 'react'
import SectionHeading from '../components/SectionHeading'

// Public explanation page for the Proactive Enforcement Response POC.
// Tone goal: citizen friendly, transparent, and credible for City reviewers.
// The system is decision support only. Staff remain accountable for enforcement,
// closure approval, and resident communication.

const GLANCE_FLOW: { n: number; title: string; body: string }[] = [
  {
    n: 1,
    title: 'Resident request',
    body: 'A resident submits a by-law or enforcement service request and receives a case reference.',
  },
  {
    n: 2,
    title: 'Case organized',
    body: 'The request is converted into a structured case record so staff can review it consistently.',
  },
  {
    n: 3,
    title: 'Staff review',
    body: 'Staff see the case details, missing information, workload context, and suggested next steps.',
  },
  {
    n: 4,
    title: 'Officer follow up',
    body: 'A By-law Officer or authorized staff member reviews the issue and records the outcome.',
  },
  {
    n: 5,
    title: 'Closure draft',
    body: 'A closure draft can be prepared from approved templates and structured case facts.',
  },
  {
    n: 6,
    title: 'Supervisor approval',
    body: 'A supervisor or authorized staff member reviews, edits, and approves the final response.',
  },
  {
    n: 7,
    title: 'Resident update',
    body: 'The resident receives a clear update after staff approval.',
  },
]

const SYSTEM_DOES: { title: string; body: string }[] = [
  {
    title: 'Organizes incoming requests',
    body: 'Turns service requests into structured case records so staff can work from a common view.',
  },
  {
    title: 'Shows workload hotspots',
    body: 'Highlights where complaint volume, open backlog, or closure pressure may need attention.',
  },
  {
    title: 'Flags stale or incomplete cases',
    body: 'Surfaces cases that may need missing details, follow up, or supervisor review.',
  },
  {
    title: 'Finds similar historical cases',
    body: 'Helps staff compare a current case with similar public benchmark records or future approved City data.',
  },
  {
    title: 'Helps prepare consistent updates',
    body: 'Supports clearer closure language using approved templates and case facts.',
  },
  {
    title: 'Keeps staff in control',
    body: 'Human staff review assignments, field outcomes, closure language, and resident communications.',
  },
]

const DOES_NOT = [
  'Does not issue tickets automatically',
  'Does not decide enforcement action',
  'Does not close cases without staff approval',
  'Does not send resident communications without explicit staff action',
  'Does not use Brampton internal operational data in this demo phase',
]

const HUMANS_APPROVE = [
  'Officer assignment',
  'Field findings and enforcement action',
  'Priority overrides',
  'Closure response edits',
  'Final resident communication',
]

const RULES_CONTROL = [
  'Workflow gates',
  'Missing information checks',
  'Readiness checks',
  'Next recommended action',
  'Priority and attention scoring',
  'Closure templates',
]

const DATA_SOURCE: { title: string; body: string }[] = [
  {
    title: 'Demo data',
    body: 'Public NYC 311 service request data is used as a realistic municipal benchmark for this demo.',
  },
  {
    title: 'Not Brampton operational data',
    body: 'This demo does not use Brampton private complaint, patrol, ticket, inspection, or officer note data.',
  },
  {
    title: 'POC ready',
    body: 'During a Brampton POC, approved City data sources can replace or supplement the benchmark data.',
  },
]

// Two-row architecture diagram: the people-facing workflow above the system layer
// that supports it. Each entry becomes a card with an arrow to the next.
const WORKFLOW_ROW = ['Resident request', 'Staff triage', 'Officer review', 'Supervisor approval', 'Resident update']

const SYSTEM_ROW = [
  'Public benchmark data',
  'Normalized case records',
  'Supabase aggregate views',
  'Insights dashboard',
  'Human reviewed outputs',
]

const TECHNICAL_REVIEWER_ITEMS = [
  'Dashboard charts read from precomputed Supabase aggregate views, so the Insights pages do not scan millions of records on every page load.',
  'Semantic retrieval can search indexed historical or benchmark cases so staff can compare similar records.',
  'Similarity search and reranking are optional support layers that help staff compare cases — they are not automated enforcement and never close a case or contact a resident.',
  'Cohere embeddings and Qdrant can support similarity search when the retrieval layer is enabled.',
  'Generated summaries or agentic workflows should only be added after data quality, retrieval quality, governance, and human approval controls are validated.',
]

export default function MethodologyPage() {
  return (
    <div className="container-page py-12">
      <SectionHeading
        eyebrow="Methodology"
        title="How the Proactive Enforcement Response POC works"
        description="This POC shows how resident service requests can be organized, reviewed, investigated, and closed with clearer staff support while keeping enforcement decisions under human control."
      />

      <div className="mt-10 max-w-5xl space-y-8">
        {/* Lead with the diagram: the full complaint-to-closure journey. */}
        <Section title="From complaint to closure">
          <p className="text-xs text-ink-subtle">
            One connected flow — a resident request becomes a structured case, gets reviewed and investigated, then
            closed with a staff-approved update.
          </p>
          <Pipeline steps={GLANCE_FLOW} className="mt-4" />
          <p className="mt-4 text-xs leading-relaxed text-ink-muted">
            Decision support only: the system organizes and surfaces information, but staff decide enforcement, approve
            closures, and communicate with residents.
          </p>
        </Section>

        {/* How it is built — the architecture, as a diagram. */}
        <Section title="How it is built">
          <div className="space-y-3">
            <DiagramRow
              accent="navy"
              label="Resident and staff workflow"
              caption="How a request moves from a resident to a resolved update."
              items={WORKFLOW_ROW}
            />
            <DiagramRow
              accent="accent"
              label="System layer"
              caption="How the system organizes data to support each step above."
              items={SYSTEM_ROW}
            />
          </div>
          <p className="mt-4 text-xs leading-relaxed text-ink-muted">
            Data is organized once, then reused across staff review, workload insights, and resident communication
            support. The demo uses public benchmark data; in a Brampton POC, approved City data sources connect into the
            same case and insights structure.
          </p>
        </Section>

        {/* Who decides what — rules vs humans, side by side. */}
        <Section title="Who decides what">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex items-center gap-2">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-accent-500" />
                <h3 className="text-sm font-semibold text-navy-900">Rules and workflow checks</h3>
              </div>
              <BulletList items={RULES_CONTROL} className="mt-3" />
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex items-center gap-2">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-navy-900" />
                <h3 className="text-sm font-semibold text-navy-900">Humans approve</h3>
              </div>
              <BulletList items={HUMANS_APPROVE} className="mt-3" />
            </div>
          </div>
        </Section>

        {/* What it does / does not do — visual cards + a clear guardrail list. */}
        <Section title="What the system does">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SYSTEM_DOES.map((item) => (
              <InfoCard key={item.title} title={item.title} body={item.body} />
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/50 p-4">
            <h3 className="text-sm font-semibold text-rose-900">What it does not do</h3>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {DOES_NOT.map((item) => (
                <li key={item} className="flex gap-2 text-sm text-rose-900/90">
                  <span aria-hidden className="mt-0.5 text-rose-500">✕</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Section>

        {/* Data source — three compact cards. */}
        <Section title="Current data source">
          <div className="grid gap-3 sm:grid-cols-3">
            {DATA_SOURCE.map((item) => (
              <InfoCard key={item.title} title={item.title} body={item.body} />
            ))}
          </div>
        </Section>

        <Section title="For technical reviewers">
          <p className="text-ink-muted">
            Hybrid by design: deterministic workflow controls first, with AI support only where it adds context for staff
            review — so retrieval, summaries, and future automation stay auditable and subject to human approval.
          </p>
          <BulletList items={TECHNICAL_REVIEWER_ITEMS} className="mt-3" />
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card p-6">
      <h2 className="text-lg font-semibold text-navy-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

// The hero complaint-to-closure diagram: numbered, connected stages with a short
// description under each. Stacks vertically with down-arrows on mobile and flows
// left → right with right-arrows from lg up, so it reads as one pipeline.
function Pipeline({
  steps,
  className = '',
}: {
  steps: { n: number; title: string; body: string }[]
  className?: string
}) {
  return (
    <div className={`flex flex-col gap-2 lg:flex-row lg:items-stretch ${className}`}>
      {steps.map((step, index) => (
        <Fragment key={step.title}>
          <div className="flex flex-1 flex-col rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[11px] font-semibold text-white">
                {step.n}
              </span>
              <span className="text-[13px] font-semibold leading-tight text-navy-900">{step.title}</span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">{step.body}</p>
          </div>
          {index < steps.length - 1 && (
            <span aria-hidden className="self-center rotate-90 text-base text-ink-subtle lg:rotate-0">
              →
            </span>
          )}
        </Fragment>
      ))}
    </div>
  )
}

function InfoCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
      <p className="mt-2 text-xs leading-relaxed text-ink-muted">{body}</p>
    </div>
  )
}

// One labelled row of the architecture diagram: a clear row header with an accent
// dot, then numbered, equal-width cards joined by arrows. Cards stack vertically
// (arrows point down) on mobile and sit in a row (arrows point right) from sm up.
function DiagramRow({
  label,
  caption,
  items,
  accent,
}: {
  label: string
  caption: string
  items: string[]
  accent: 'navy' | 'accent'
}) {
  const dot = accent === 'navy' ? 'bg-navy-900' : 'bg-accent-500'
  const ring = accent === 'navy' ? 'ring-navy-100' : 'ring-accent-100'
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex items-center gap-2">
        <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        <h3 className="text-sm font-semibold text-navy-900">{label}</h3>
      </div>
      <p className="mt-0.5 text-xs text-ink-subtle">{caption}</p>
      <div className="mt-3 flex flex-col items-stretch gap-2 sm:flex-row sm:items-stretch">
        {items.map((item, index) => (
          <Fragment key={item}>
            <div
              className={`flex flex-1 flex-col items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-3 text-center shadow-sm ring-1 ${ring}`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full ${dot} text-[10px] font-semibold text-white`}
              >
                {index + 1}
              </span>
              <span className="text-xs font-semibold text-navy-900">{item}</span>
            </div>
            {index < items.length - 1 && (
              <span aria-hidden className="self-center rotate-90 text-base text-ink-subtle sm:rotate-0">
                →
              </span>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function BulletList({ items, className = '' }: { items: string[]; className?: string }) {
  return (
    <ul className={`space-y-1.5 ${className}`}>
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-sm text-ink">
          <span aria-hidden className="mt-0.5 text-accent-500">•</span>
          {item}
        </li>
      ))}
    </ul>
  )
}
