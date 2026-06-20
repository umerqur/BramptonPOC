import { useState } from 'react'
import type { DemoCase } from '../../data/demoWorkflowTypes'
import {
  caseToSimilarQuery,
  fetchSimilarCases,
  SimilarCasesNotConfiguredError,
  type SimilarCase,
} from '../../services/similarCases'
import { ProvenanceBadge } from './ProvenanceLabels'

// "Similar historical cases" — the first real AI feature on the workbench.
//
// On demand, it embeds the active case's text fields (Cohere), retrieves nearby
// closed benchmark records from Qdrant, and reranks them (Cohere Rerank). All of
// that happens server-side in netlify/functions/similar-cases.ts — the browser
// only ever sees safe, non-PII benchmark fields and similarity scores.
//
// This is staff reference only. It does NOT decide the outcome, and it is not
// part of the resident closure message (which stays rules based and supervisor
// approved).

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; results: SimilarCase[] }
  | { status: 'unconfigured'; message: string }
  | { status: 'error'; message: string }

export default function SimilarHistoricalCasesCard({ c }: { c: DemoCase }) {
  const [state, setState] = useState<LoadState>({ status: 'idle' })

  async function runSearch() {
    setState({ status: 'loading' })
    try {
      const res = await fetchSimilarCases(caseToSimilarQuery(c), { caseId: c.id, topK: 5 })
      setState({ status: 'ready', results: res.results })
    } catch (err) {
      if (err instanceof SimilarCasesNotConfiguredError) {
        setState({ status: 'unconfigured', message: err.message })
      } else {
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-navy-900">Similar historical cases</h3>
          <p className="text-xs text-ink-subtle">
            Finds similar closed benchmark records for staff reference. It does not decide the outcome.
          </p>
        </div>
        <ProvenanceBadge kind="ai-retrieval" />
      </div>

      <div className="mt-3">
        <button
          onClick={runSearch}
          disabled={state.status === 'loading'}
          className="btn-secondary text-sm py-2 px-4"
        >
          {state.status === 'loading'
            ? 'Searching…'
            : state.status === 'ready'
              ? 'Refresh similar cases'
              : 'Find similar cases'}
        </button>
      </div>

      <div className="mt-4">
        {state.status === 'idle' && (
          <p className="text-xs text-ink-subtle">
            Retrieval runs on demand. Cohere embeds the case text, Qdrant returns the nearest closed records, and Cohere
            Rerank orders the top matches.
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

        {state.status === 'ready' && state.results.length === 0 && (
          <p className="text-xs text-ink-subtle">No similar closed benchmark cases were found for this record.</p>
        )}

        {state.status === 'ready' && state.results.length > 0 && (
          <ul className="space-y-2">
            {state.results.map((r, i) => (
              <SimilarCaseRow key={r.case_id ?? i} r={r} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function SimilarCaseRow({ r }: { r: SimilarCase }) {
  const meta = [r.borough, r.council_district ? `District ${r.council_district}` : null, r.agency]
    .filter(Boolean)
    .join(' · ')
  const rerankPct = Math.round((r.rerank_score ?? 0) * 100)

  return (
    <li className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-navy-900">{r.complaint_type || r.case_id || 'Case'}</span>
        <span
          className="badge bg-accent-50 text-accent-800 ring-1 ring-inset ring-accent-200 shrink-0"
          title="Cohere Rerank relevance"
        >
          {rerankPct}% match
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
