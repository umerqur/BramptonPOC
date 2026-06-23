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

const WORKFLOW_STEPS: { n: number; title: string; body: string }[] = [
  {
    n: 1,
    title: 'Intake',
    body: 'A complaint or service request is captured with location, category, description, and contact details where applicable.',
  },
  {
    n: 2,
    title: 'Triage',
    body: 'Rules and workflow checks help staff identify routing, priority, missing information, and next actions.',
  },
  {
    n: 3,
    title: 'Operational insight',
    body: 'Dashboards show workload patterns, hotspots, open backlog, and closure pressure across geography and case types.',
  },
  {
    n: 4,
    title: 'Field review',
    body: 'Authorized staff or officers review the case, record findings, and decide the appropriate action.',
  },
  {
    n: 5,
    title: 'Closure review',
    body: 'The system can help prepare a draft closure update from approved templates and structured case facts.',
  },
  {
    n: 6,
    title: 'Approval',
    body: 'A supervisor or authorized staff member reviews, edits, approves, and sends the final resident update.',
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

      <div className="mt-10 max-w-4xl space-y-8">
        <Section title="At a glance">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {GLANCE_FLOW.map((step) => (
              <FlowCard key={step.title} n={step.n} title={step.title} body={step.body} />
            ))}
          </div>
        </Section>

        <Section title="What problem this solves">
          <p className="text-ink-muted">
            Municipal enforcement teams receive high volumes of resident complaints and service requests.
            Staff need to understand the issue, check context, assign work, record field outcomes, and close
            the loop with residents. This POC reduces manual review friction while preserving staff accountability.
          </p>
        </Section>

        <Section title="Current data source">
          <div className="grid gap-3 sm:grid-cols-3">
            {DATA_SOURCE.map((item) => (
              <InfoCard key={item.title} title={item.title} body={item.body} />
            ))}
          </div>
        </Section>

        <Section title="What the system does">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SYSTEM_DOES.map((item) => (
              <InfoCard key={item.title} title={item.title} body={item.body} />
            ))}
          </div>
        </Section>

        <Section title="What this system does not do">
          <ul className="space-y-1.5">
            {DOES_NOT.map((item) => (
              <li key={item} className="flex gap-2 text-sm text-ink">
                <span aria-hidden className="mt-0.5 text-rose-500">✕</span>
                {item}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="End-to-end staff workflow">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {WORKFLOW_STEPS.map((step) => (
              <FlowCard key={step.title} n={step.n} title={step.title} body={step.body} />
            ))}
          </div>
        </Section>

        <Section title="Clear responsibility model">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-navy-900">Rules and workflow checks</h3>
              <BulletList items={RULES_CONTROL} className="mt-3" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-navy-900">Humans approve</h3>
              <BulletList items={HUMANS_APPROVE} className="mt-3" />
            </div>
          </div>
        </Section>

        <Section title="Simple architecture">
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
            support.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            The current demo uses public benchmark data. In a Brampton POC, approved City data sources would connect
            into the same case and insights structure.
          </p>
        </Section>

        <Section title="For technical reviewers">
          <p className="text-ink-muted">
            The POC uses a hybrid approach: deterministic workflow controls first, with AI support only where it
            adds context for staff review. The architecture is designed so retrieval, summaries, and future automation
            remain auditable and subject to human approval.
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

function FlowCard({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy-900 text-[11px] font-semibold text-white">
          {n}
        </span>
        <span className="text-sm font-semibold text-navy-900">{title}</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-muted">{body}</p>
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
