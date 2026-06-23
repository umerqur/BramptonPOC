import { useCallback, useEffect, useState } from 'react'
import type { DemoCase } from '../../data/demoWorkflowTypes'
import {
  caseToSimilarQuery,
  fetchSimilarCases,
  SimilarCasesNotConfiguredError,
  type SimilarCase,
} from '../../services/similarCases'

// On-demand "Similar benchmark references" search state, lifted out of the card
// so the Case Workbench can share one search between a top action strip and the
// card lower on the page. Server-side retrieval (Cohere embeddings + Qdrant +
// Cohere rerank) is untouched — this is client state only.

export type SimilarCasesLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; results: SimilarCase[] }
  | { status: 'unconfigured'; message: string }
  | { status: 'error'; message: string }

export type SimilarCasesController = {
  state: SimilarCasesLoadState
  runSearch: () => void
}

// How many reranked results we request from the server.
export const SIMILAR_TOP_K = 5

/**
 * Shared, on-demand similar-cases search. Resets to idle when the focused case
 * changes so stale results never carry across cases.
 */
export function useSimilarCases(c: DemoCase | null): SimilarCasesController {
  const [state, setState] = useState<SimilarCasesLoadState>({ status: 'idle' })

  useEffect(() => {
    setState({ status: 'idle' })
  }, [c?.id])

  const runSearch = useCallback(async () => {
    if (!c) return
    setState({ status: 'loading' })
    try {
      const res = await fetchSimilarCases(caseToSimilarQuery(c), { caseId: c.id, topK: SIMILAR_TOP_K })
      setState({ status: 'ready', results: res.results })
    } catch (err) {
      if (err instanceof SimilarCasesNotConfiguredError) {
        setState({ status: 'unconfigured', message: err.message })
      } else {
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    }
  }, [c])

  return { state, runSearch }
}
