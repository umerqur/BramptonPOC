import type { DemoCase } from '../data/demoWorkflowTypes'

// Client wrapper for the "AI assisted similar case retrieval" Netlify function.
//
// The Cohere and Qdrant credentials live ONLY on the server (read by
// netlify/functions/similar-cases.ts via process.env). The browser never sees
// them — it only calls the reserved /.netlify/functions/similar-cases endpoint
// with the active case's non-PII text fields and renders the results.
//
// This is decision support only: it surfaces similar closed benchmark records
// for staff reference. It does not decide the outcome, and it is never part of
// the resident closure response (which stays rules based and supervisor
// approved).

const SIMILAR_CASES_ENDPOINT = '/.netlify/functions/similar-cases'

// The text fields used to search. These mirror exactly what the indexing script
// embeds for each historical record: complaint type, request detail/descriptor,
// resolution description, borough, and agency.
export type SimilarCaseQuery = {
  complaint_type?: string | null
  request_detail?: string | null
  resolution_description?: string | null
  borough?: string | null
  agency?: string | null
}

// A single similar historical case. Only safe, non-PII benchmark fields plus the
// retrieval scores are ever returned by the server.
export type SimilarCase = {
  case_id?: string
  complaint_type?: string
  request_detail?: string
  resolution_description?: string
  borough?: string
  council_district?: string
  agency?: string
  submitted_at?: string
  closed_at?: string
  closure_days?: number
  /** Qdrant vector-search cosine score for the candidate (pre-rerank). */
  similarity_score: number
  /** Cohere Rerank relevance score (the order results are shown in). */
  rerank_score: number
}

export type SimilarCasesResponse = {
  retrieval_version: string
  embed_model: string
  rerank_model: string
  provenance: 'ai_assisted_retrieval'
  query_case_id: string | null
  results: SimilarCase[]
  advisory: string
}

// Thrown when the server says the feature is not configured (503), so the UI can
// show a calm "not wired up in this environment" state instead of an error.
export class SimilarCasesNotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SimilarCasesNotConfiguredError'
  }
}

// Project a DemoCase (resident intake OR NYC open benchmark) onto the query
// fields. NYC benchmark cases carry richer borough/agency/descriptor detail;
// resident cases fall back to the normalized service-request fields.
export function caseToSimilarQuery(c: DemoCase): SimilarCaseQuery {
  const nyc = c.source.kind === 'nyc_open' ? c.source.nyc : undefined
  return {
    complaint_type: c.normalized.complaint_type ?? nyc?.complaintType ?? null,
    request_detail: c.normalized.request_detail ?? nyc?.descriptor ?? null,
    resolution_description: c.normalized.resolution_description ?? nyc?.resolutionDescription ?? null,
    borough: nyc?.borough ?? null,
    agency: nyc?.agency ?? c.normalized.assigned_department ?? null,
  }
}

export async function fetchSimilarCases(
  query: SimilarCaseQuery,
  options: { caseId?: string | null; topK?: number } = {},
): Promise<SimilarCasesResponse> {
  const res = await fetch(SIMILAR_CASES_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      caseId: options.caseId ?? null,
      query,
      topK: options.topK ?? 5,
    }),
  })

  let payload: unknown = null
  try {
    payload = await res.json()
  } catch {
    // Non-JSON response — fall through to the status-based error below.
  }

  if (!res.ok) {
    const message =
      (payload as { error?: string } | null)?.error ?? `Request failed (status ${res.status}).`
    if (res.status === 503) throw new SimilarCasesNotConfiguredError(message)
    throw new Error(message)
  }

  return payload as SimilarCasesResponse
}
