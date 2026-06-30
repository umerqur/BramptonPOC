import { useMemo, type Ref } from 'react'
import {
  computeSimilarCaseIntelligence,
  type CaseFeatures,
  type SimilarCaseMatch,
} from '../../services/similarCaseIntelligence'
import { ProvenanceBadge } from './ProvenanceLabels'

// Similar Case Intelligence — STRUCTURED operational matches, not vector
// embeddings. When an officer opens a case, this surfaces similar historical /
// synthetic benchmark cases that help them understand the likely action path,
// closure pattern, risk drivers, and workload impact.
//
// Matching is structured-first (category, location, priority/risk, closure
// outcome, field-visit/assignment) with text overlap as a small secondary
// signal. Candidates are CTGAN-style synthetic cases carrying ABM scenario
// behavior. This is DECISION SUPPORT ONLY — it shows what similar cases SUGGEST
// so the officer can review them; it does not decide the enforcement outcome.

export default function SimilarCaseIntelligencePanel({
  features,
  sectionRef,
}: {
  features: CaseFeatures | null
  sectionRef?: Ref<HTMLElement>
}) {
  const matches = useMemo(
    () => (features ? computeSimilarCaseIntelligence(features) : []),
    [features],
  )

  return (
    <section ref={sectionRef} className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-navy-900">Similar Case Intelligence</h3>
          <p className="mt-0.5 text-xs text-ink-subtle">
            Structured operational matches based on category, location, risk pattern, and simulated workload behavior.
          </p>
        </div>
        <ProvenanceBadge kind="structured-match" />
      </div>

      <div className="mt-4">
        {matches.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-ink-muted">
            <p className="font-semibold text-ink">No strong structured match yet.</p>
            <p className="mt-1">
              No benchmark case shares enough operational structure (category, location, risk, closure pattern) to act as
              a useful reference for this file.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {matches.map((m) => (
              <SimilarCaseCard key={m.caseId} m={m} />
            ))}
          </ul>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-ink-subtle">
          Decision support only. These are structured matches to synthetic benchmark cases — similar cases{' '}
          <span className="font-medium">suggest</span> likely patterns the officer should review. The system does not
          determine the enforcement outcome.
        </p>
      </div>
    </section>
  )
}

function SimilarCaseCard({ m }: { m: SimilarCaseMatch }) {
  return (
    <li className="rounded-lg border border-slate-200 px-3.5 py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="font-mono text-[13px] font-semibold text-navy-900">{m.caseId}</span>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="badge bg-slate-100 text-slate-700">{m.serviceCategory}</span>
            <span className="text-xs text-ink-subtle">{m.district}</span>
          </div>
        </div>
        <span
          className="badge shrink-0 bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-200"
          title="Structured similarity across category, location, priority/risk, closure pattern, field/assignment, and a minor text signal. Not a confidence or accuracy score."
        >
          {m.similarityPct}% match
        </span>
      </div>

      <div className="mt-2 flex items-start gap-2">
        <span className="badge bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200 shrink-0">
          {m.statusOrOutcome}
        </span>
      </div>

      <dl className="mt-2.5 space-y-1.5">
        <Line label="Similar because">{m.matchedDimensions.join(', ')}.</Line>
        <Line label="What happened next">{stripPrefix(m.pastOutcome, 'Past outcome: ')}</Line>
        <Line label="Operational note">{stripPrefix(m.operationalNote, 'Operational note: ')}</Line>
      </dl>

      <div className="mt-2.5 rounded-md border border-teal-200 bg-teal-50/70 px-2.5 py-2 text-[13px] leading-relaxed text-ink">
        <span className="font-semibold text-navy-900">Lesson for this case: </span>
        {m.recommendedLesson}
      </div>
    </li>
  )
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[auto,1fr] gap-x-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="text-[13px] leading-relaxed text-ink-muted">{children}</dd>
    </div>
  )
}

/** Drop a known sentence prefix the engine adds, so the card can relabel it. */
function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value
}
