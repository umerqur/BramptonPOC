import { useEffect, useState, type Ref } from 'react'
import type { DemoCase } from '../../data/demoWorkflowTypes'
import type { SimilarCase } from '../../services/similarCases'
import { useSimilarCases, type SimilarCasesController } from './useSimilarCases'
import { ProvenanceBadge } from './ProvenanceLabels'

// "Similar benchmark references" — optional, on-demand staff support.
//
// On demand, it embeds the active case's text fields (Cohere), retrieves nearby
// closed benchmark records from Qdrant, and reranks them (Cohere Rerank). All of
// that happens server-side in netlify/functions/similar-cases.ts — the browser
// only ever sees safe, non-PII benchmark fields and similarity scores.
//
// This is staff reference only. It does NOT decide the outcome, and it is not
// part of the resident closure message (which stays rules based and supervisor
// approved). Low-relevance neighbours are filtered out so weak matches are never
// presented as useful examples.

// Default number of strong results shown before "Show more".
const MAX_VISIBLE = 3
// Below this Cohere rerank relevance a result is a weak semantic neighbour, not a
// useful staff reference — filtered out before rendering so low scores (e.g. 8%)
// are never shown as if they were matches.
const MIN_VISIBLE_RERANK_SCORE = 0.2

export default function SimilarHistoricalCasesCard({
  c,
  controller,
  sectionRef,
}: {
  c: DemoCase
  controller?: SimilarCasesController
  sectionRef?: Ref<HTMLElement>
}) {
  const own = useSimilarCases(c)
  const { state, runSearch } = controller ?? own
  const [showAll, setShowAll] = useState(false)

  // Collapse "Show more" again whenever a new search runs or the case changes.
  useEffect(() => {
    setShowAll(false)
  }, [c.id, state.status])

  const loading = state.status === 'loading'

  // Only results that clear the relevance threshold are useful staff references.
  const strong =
    state.status === 'ready'
      ? [...state.results]
          .filter((r) => (r.rerank_score ?? 0) >= MIN_VISIBLE_RERANK_SCORE)
          .sort((a, b) => (b.rerank_score ?? 0) - (a.rerank_score ?? 0))
      : []
  const visible = showAll ? strong : strong.slice(0, MAX_VISIBLE)

  return (
    <section ref={sectionRef} className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-navy-900">Similar benchmark references</h3>
          <p className="text-xs text-ink-subtle">
            Optional semantic retrieval over closed NYC 311 benchmark records. Use only as background reference.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ProvenanceBadge kind="ai-retrieval" />
          <button
            onClick={runSearch}
            disabled={loading}
            className="btn-primary text-sm py-1.5 px-3 disabled:opacity-60"
          >
            {loading ? 'Searching…' : state.status === 'ready' ? 'Refresh search' : 'Find similar cases'}
          </button>
        </div>
      </div>

      <div className="mt-4">
        {state.status === 'idle' && (
          <p className="text-xs text-ink-subtle">
            Runs on demand: Cohere embeds the case text, Qdrant returns nearby closed records, and Cohere rerank orders
            the strongest matches. Only relevant matches are shown.
          </p>
        )}

        {state.status === 'unconfigured' && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-700">
            <span className="font-semibold">Not configured in this environment.</span> {state.message} Set
            <code className="mx-1 rounded bg-slate-200 px-1">COHERE_API_KEY</code> and
            <code className="mx-1 rounded bg-slate-200 px-1">QDRANT_URL</code> in the server environment, then index the
            historical cases.
          </div>
        )}

        {state.status === 'error' && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
            <span className="font-semibold">Retrieval unavailable.</span> {state.message}
          </div>
        )}

        {state.status === 'ready' && strong.length === 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-ink-muted">
            <p className="font-semibold text-ink">No strong similar benchmark case found.</p>
            <p className="mt-1">
              The retrieval system found weak semantic neighbours, but none were relevant enough to display as staff
              reference.
            </p>
          </div>
        )}

        {state.status === 'ready' && strong.length > 0 && (
          <>
            <ul className="space-y-2">
              {visible.map((r, i) => (
                <SimilarCaseRow key={r.case_id ?? i} r={r} />
              ))}
            </ul>

            {!showAll && strong.length > MAX_VISIBLE && (
              <button
                onClick={() => setShowAll(true)}
                className="mt-2 text-xs font-semibold text-accent-600 hover:text-accent-700"
              >
                Show more ({strong.length - MAX_VISIBLE} more)
              </button>
            )}

            <p className="mt-3 text-[11px] leading-relaxed text-ink-subtle">
              Retrieved examples from closed NYC benchmark cases — not Brampton policy guidance, not recommended
              enforcement action, and not closure language.
            </p>
          </>
        )}
      </div>
    </section>
  )
}

function SimilarCaseRow({ r }: { r: SimilarCase }) {
  const meta = [r.borough, r.council_district ? `District ${r.council_district}` : null, r.agency]
    .filter(Boolean)
    .join(' · ')
  const relevancePct = Math.round((r.rerank_score ?? 0) * 100)

  return (
    <li className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-navy-900">{r.complaint_type || r.case_id || 'Case'}</span>
        <span
          className="badge bg-slate-100 text-slate-600 shrink-0"
          title="Cohere rerank relevance score. Not accuracy, not confidence, not a recommendation."
        >
          Relevance {relevancePct}%
        </span>
      </div>
      {r.request_detail && <div className="text-xs text-ink-muted">{r.request_detail}</div>}
      {r.resolution_description && (
        <p className="mt-1 line-clamp-2 text-xs text-ink">{r.resolution_description}</p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-subtle">
        {meta && <span>{meta}</span>}
        {typeof r.closure_days === 'number' && <span>Closed in {r.closure_days} days</span>}
        {r.case_id && <span>Ref {r.case_id}</span>}
      </div>
    </li>
  )
}
