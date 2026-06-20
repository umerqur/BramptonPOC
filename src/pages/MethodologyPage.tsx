import type { ReactNode } from 'react'
import SectionHeading from '../components/SectionHeading'

// The single public explanation page for the POC. Honest about what is AI,
// what is rules-based, and what stays under human control.

const WORKFLOW_STEPS: { n: number; title: string; body: string }[] = [
  { n: 1, title: 'Resident intake', body: 'A resident submits a by-law or enforcement complaint and receives a case reference.' },
  { n: 2, title: 'Staff triage', body: 'The request is normalized into a staff work queue with routing, priority, and missing-information checks.' },
  { n: 3, title: 'Officer assignment', body: 'A supervisor or CSR assigns the case to a specific By-law Officer.' },
  { n: 4, title: 'Field outcome', body: 'The officer records findings, structured enforcement action, notes, and follow-up status.' },
  { n: 5, title: 'Closure review', body: 'A rules-based closure draft can be prepared from approved templates and structured case facts.' },
  { n: 6, title: 'Resident update', body: 'A supervisor reviews, edits, approves, and sends the resident communication.' },
]

const AI_SUPPORTS = [
  'Semantic retrieval: Cohere embeddings search indexed closed benchmark cases in Qdrant.',
  'Reranking: Cohere rerank orders retrieved cases so staff can review stronger references first.',
  'Future extension: generated staff summaries may be added only after retrieval quality and governance are validated.',
]

const RULES_CONTROL = [
  'Next recommended action',
  'Workflow gates',
  'Readiness checks',
  'Priority / attention scoring',
  'Closure templates',
  'Resident status updates',
]

const HUMANS_APPROVE = [
  'Officer assignment',
  'Field findings and enforcement action',
  'Priority overrides',
  'Closure response edits',
  'Final resident communication',
]

const DOES_NOT = [
  'Does not issue tickets automatically',
  'Does not decide enforcement action',
  'Does not close cases without staff approval',
  'Does not send resident communications without explicit staff action',
  'Does not use Brampton internal operational data in this demo phase',
]

const ARCHITECTURE_FLOW = [
  'Resident Intake',
  'Normalized Case Record',
  'Rules-Based Workflow Gates',
  'AI-Supported Benchmark Retrieval',
  'Officer Field Outcome',
  'Rules-Based Closure Template',
  'Supervisor Approval',
  'Resident Update',
]

const LEGEND: { label: string; body: string; cls: string }[] = [
  { label: 'AI', body: 'Semantic retrieval and reranking over indexed benchmark cases.', cls: 'bg-accent-50 text-accent-800 ring-1 ring-inset ring-accent-200' },
  { label: 'Rules', body: 'Workflow gates, next action guidance, readiness checks, and templates.', cls: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200' },
  { label: 'Humans', body: 'Assignment, field outcome, edits, approval, resident communication.', cls: 'bg-navy-50 text-navy-900 ring-1 ring-inset ring-navy-200' },
]

export default function MethodologyPage() {
  return (
    <div className="container-page py-12">
      <SectionHeading
        eyebrow="Methodology"
        title="Hybrid AI decision support for proactive enforcement response"
        description="This POC shows how resident complaints can move through intake, staff triage, officer field review, closure review, and resident updates while keeping enforcement decisions under human control."
      />

      <div className="mt-10 max-w-3xl space-y-8">
        {/* 1 — Problem */}
        <Section title="What problem this solves">
          <p className="text-ink-muted">
            Municipal enforcement teams receive high volumes of resident complaints. Staff must triage each request,
            understand context, assign work, record field outcomes, and close the loop with residents. The POC focuses
            on reducing manual review friction while preserving staff accountability.
          </p>
        </Section>

        {/* 2 — Workflow */}
        <Section title="End-to-end workflow">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {WORKFLOW_STEPS.map((s) => (
              <div key={s.n} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy-900 text-[11px] font-semibold text-white">
                    {s.n}
                  </span>
                  <span className="text-sm font-semibold text-navy-900">{s.title}</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ink-muted">{s.body}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* 3 — What AI supports */}
        <Section title="What AI supports">
          <p className="text-ink-muted">AI is used where it adds context, not where the City must make accountable decisions.</p>
          <BulletList items={AI_SUPPORTS} className="mt-3" />
        </Section>

        {/* 4 — What rules control */}
        <Section title="What rules control">
          <BulletList items={RULES_CONTROL} />
        </Section>

        {/* 5 — What humans approve */}
        <Section title="What humans approve">
          <BulletList items={HUMANS_APPROVE} />
        </Section>

        {/* 6 — What this system does not do */}
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

        {/* 7 — Current demo data */}
        <Section title="Current demo data">
          <p className="text-ink-muted">
            The staff analytics and similar-case retrieval use public NYC 311 benchmark data to simulate workload and
            historical closure patterns. Resident submissions in this demo are separate demo records. During a Brampton
            POC, equivalent internal enforcement records, patrol logs, ticket records, and complaint history would
            replace the benchmark data source.
          </p>
        </Section>

        {/* 8 — Architecture sketch */}
        <Section title="Architecture sketch">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
            {ARCHITECTURE_FLOW.map((step, i) => (
              <span key={step} className="flex items-center gap-1.5">
                <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-navy-900">
                  {step}
                </span>
                {i < ARCHITECTURE_FLOW.length - 1 && <span aria-hidden className="text-ink-subtle">→</span>}
              </span>
            ))}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {LEGEND.map((l) => (
              <div key={l.label} className="rounded-xl border border-slate-200 bg-white p-4">
                <span className={`badge ${l.cls}`}>{l.label}</span>
                <p className="mt-2 text-xs leading-relaxed text-ink-muted">{l.body}</p>
              </div>
            ))}
          </div>
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
