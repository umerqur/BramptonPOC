import { useEffect, useState, type Ref } from 'react'
import { Link } from 'react-router-dom'
import {
  getStructuredSimilarCases,
  type SimilarCaseQuery,
  type StructuredSimilarCase,
} from '../../services/structuredSimilarCases'
import { ProvenanceBadge } from './ProvenanceLabels'

// Similar Case Intelligence — RULES-BASED structured similarity over the real
// historical NYC 311 records (public.municipal_complaints). No CTGAN, no ABM,
// no embeddings, no Qdrant, no reranking: candidates are narrowed with indexed
// structured filters and scored with a transparent weighted rule set
// (see structuredSimilarCases.ts for the documented weights).
//
// It shows AT MOST the top 3 comparable closed cases. Each row is clickable and
// opens the full historical case page (/app/nyc_case/:caseId) via normal React
// Router navigation, so the officer can inspect it and come back.
//
// DECISION SUPPORT ONLY — it surfaces comparable public benchmark records for
// staff reference. It does not decide the enforcement outcome, and it exposes
// no resident personal information.

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; matches: StructuredSimilarCase[] }
  | { status: 'error' }

export default function SimilarCaseIntelligencePanel({
  query,
  sectionRef,
}: {
  query: SimilarCaseQuery | null
  sectionRef?: Ref<HTMLElement>
}) {
  const [state, setState] = useState<LoadState>({ status: 'idle' })

  // Key the effect on the structural fields so a stable case does not refetch.
  const queryKey = query
    ? [query.currentCaseId, query.complaintType, query.borough, query.councilDistrict].join('|')
    : null

  useEffect(() => {
    if (!query) {
      setState({ status: 'idle' })
      return
    }
    let active = true
    setState({ status: 'loading' })
    getStructuredSimilarCases(query)
      .then((matches) => active && setState({ status: 'ready', matches }))
      .catch((err: unknown) => {
        console.error('Similar case lookup failed:', err)
        if (active) setState({ status: 'error' })
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey])

  // Resident (Brampton) cases get benchmark framing: NYC records are reference
  // context for how a comparable issue was handled — never Brampton precedents.
  const isBenchmark = query?.mode === 'brampton_benchmark'
  const title = isBenchmark ? 'Comparable NYC benchmark outcomes' : 'Similar Case Intelligence'
  const subtitle = isBenchmark
    ? 'Closed public NYC 311 records involving a comparable reported issue. Review how those records were handled and resolved. These are benchmark references, not Brampton precedents.'
    : 'Top comparable closed cases from the historical NYC 311 record, matched on structured fields (complaint type, descriptor, agency, area, closure timing).'

  return (
    <section ref={sectionRef} className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
          <p className="mt-0.5 text-xs text-ink-subtle">{subtitle}</p>
        </div>
        <ProvenanceBadge kind="structured-match" />
      </div>

      <div className="mt-4">
        {(state.status === 'idle' || state.status === 'loading') && (
          <p className="text-xs text-ink-subtle">Finding comparable closed cases…</p>
        )}

        {state.status === 'error' && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-ink-muted">
            Comparable case lookup is unavailable right now.
          </div>
        )}

        {state.status === 'ready' && state.matches.length === 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-ink-muted">
            <p className="font-semibold text-ink">No comparable closed cases found.</p>
            <p className="mt-1">
              No historical case shares enough structured fields (complaint type, descriptor, area, closure
              pattern) with this file to act as a useful reference.
            </p>
          </div>
        )}

        {state.status === 'ready' && state.matches.length > 0 && (
          <ul className="space-y-3">
            {state.matches.map((m) => (
              <SimilarCaseRow key={m.caseId} m={m} />
            ))}
          </ul>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-ink-subtle">
          Decision support only. Rules-based matches to public historical benchmark records — similar cases{' '}
          <span className="font-medium">suggest</span> likely patterns the officer should review. The system does
          not determine the enforcement outcome.
        </p>
      </div>
    </section>
  )
}

function SimilarCaseRow({ m }: { m: StructuredSimilarCase }) {
  return (
    <li>
      <Link
        to={`/app/nyc_case/${encodeURIComponent(m.caseId)}`}
        className="block rounded-lg border border-slate-200 px-3.5 py-3 text-sm transition hover:border-teal-400 hover:bg-teal-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        aria-label={`Open similar case ${m.caseId}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="font-mono text-[13px] font-semibold text-navy-900">{m.caseId}</span>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {m.complaintType && <span className="badge bg-slate-100 text-slate-700">{m.complaintType}</span>}
              <span className="text-xs text-ink-subtle">{m.area}</span>
            </div>
          </div>
          <span
            className="badge shrink-0 bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-200"
            title="Deterministic rules-based similarity across complaint type, descriptor, agency, area, closure timing, season, and status. Not a confidence or accuracy score."
          >
            {m.similarityPct}% match
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          {m.status && (
            <span className="badge bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200">{m.status}</span>
          )}
          {/* Conservative label derived only from explicit resolution phrasing —
              shown for reference, never as a recommendation for this case. */}
          {m.historicalResolution && (
            <span className="badge bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200">
              {m.historicalResolution}
            </span>
          )}
          {m.agency && <span className="text-ink-subtle">{m.agency}</span>}
          {m.closureDays != null && (
            <span className="text-ink-subtle">
              · Closed in {m.closureDays} day{m.closureDays === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {m.resolutionSummary && (
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-muted">
            <span className="font-semibold text-ink">Historical resolution: </span>
            {m.resolutionSummary}
          </p>
        )}

        <p className="mt-2 text-[11px] text-ink-subtle">
          <span className="font-semibold uppercase tracking-wide">Similar because</span>{' '}
          {m.reasons.join(' · ')}
        </p>
      </Link>
    </li>
  )
}
