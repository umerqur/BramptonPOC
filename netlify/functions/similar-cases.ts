// Server-side Netlify function: "AI assisted similar case retrieval".
//
// Given a resident intake case or NYC open benchmark case (its text fields), it
// finds similar HISTORICAL CLOSED benchmark cases for staff reference using text
// similarity. It is decision support only: it never writes anything, never
// decides an outcome, and is not part of the resident closure response (which
// stays rules based and supervisor approved).
//
// SECURITY
// --------
// The Cohere and Qdrant credentials are read from the Netlify environment
// (COHERE_API_KEY, QDRANT_URL, QDRANT_API_KEY) and used ONLY inside this
// server-side function. They are never sent to the browser, never exposed
// through a VITE_* variable, and never logged. Do not create VITE_ copies.
//
// PIPELINE
// --------
//   1. Compose a query string from the case text fields (same shape that was
//      indexed) or accept a raw `text` query.
//   2. Embed the query with Cohere (search_query input type).
//   3. Retrieve the top 50 nearest neighbours from Qdrant (vector search).
//   4. Rerank those candidates with Cohere Rerank down to the top N (<= 10).
//   5. Return only safe benchmark fields + similarity/rerank scores.
//
// This deliberately does NOT use Claude. Similar-case retrieval is the first AI
// feature and is intentionally limited to embeddings + rerank.

// Netlify Functions v2 web-standard handler. Node 20 provides a global fetch, so
// no SDK dependency is required. The client calls the reserved
// /.netlify/functions/similar-cases endpoint.

const RETRIEVAL_VERSION = 'similar-cases-v1'
const EMBED_MODEL = 'embed-english-v3.0'
const RERANK_MODEL = 'rerank-english-v3.0'

const COHERE_EMBED_URL = 'https://api.cohere.com/v1/embed'
const COHERE_RERANK_URL = 'https://api.cohere.com/v1/rerank'

// How many neighbours to pull from Qdrant before reranking, and the hard cap on
// how many reranked results we return to the client.
const CANDIDATE_POOL = 50
const MAX_RESULTS = 10
const DEFAULT_RESULTS = 5

const ADVISORY =
  'AI assisted retrieval for staff reference only. It surfaces similar closed ' +
  'benchmark records; it does not decide the outcome. The resident closure ' +
  'message remains rules based and supervisor approved.'

// The fields we embed for a case, in a fixed order, mirroring the indexing
// script so a query is compared against documents built the same way.
type QueryFields = {
  complaint_type?: string | null
  request_detail?: string | null
  resolution_description?: string | null
  borough?: string | null
  agency?: string | null
}

// The non-PII benchmark payload stored in Qdrant and returned to the client.
type CasePayload = {
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
}

type SimilarCaseResult = CasePayload & {
  similarity_score: number
  rerank_score: number
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

// Build the text we embed/rerank from a case's fields. Combines complaint type,
// request detail/descriptor, resolution description, borough and agency — the
// same combination used by the indexing script.
function composeCaseText(fields: QueryFields): string {
  const parts = [
    asString(fields.complaint_type),
    asString(fields.request_detail),
    asString(fields.resolution_description),
    asString(fields.borough),
    asString(fields.agency),
  ].filter(Boolean)
  return parts.join('\n')
}

// Compose the candidate document text the same way for reranking.
function payloadToText(payload: CasePayload): string {
  return composeCaseText({
    complaint_type: payload.complaint_type,
    request_detail: payload.request_detail,
    resolution_description: payload.resolution_description,
    borough: payload.borough,
    agency: payload.agency,
  })
}

async function embedQuery(apiKey: string, text: string): Promise<number[]> {
  const res = await fetch(COHERE_EMBED_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      texts: [text],
      input_type: 'search_query',
      truncate: 'END',
    }),
  })
  if (!res.ok) {
    throw new Error(`Cohere embed failed (status ${res.status}).`)
  }
  const data = (await res.json()) as { embeddings?: number[][] }
  const vector = data.embeddings?.[0]
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error('Cohere embed returned no vector.')
  }
  return vector
}

async function searchQdrant(
  qdrantUrl: string,
  apiKey: string | undefined,
  collection: string,
  vector: number[],
): Promise<Array<{ score: number; payload: CasePayload }>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (apiKey) headers['api-key'] = apiKey

  const res = await fetch(`${qdrantUrl.replace(/\/$/, '')}/collections/${collection}/points/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      vector,
      limit: CANDIDATE_POOL,
      with_payload: true,
    }),
  })
  if (!res.ok) {
    throw new Error(`Qdrant search failed (status ${res.status}).`)
  }
  const data = (await res.json()) as {
    result?: Array<{ score: number; payload: CasePayload }>
  }
  return Array.isArray(data.result) ? data.result : []
}

async function rerank(
  apiKey: string,
  query: string,
  documents: string[],
  topN: number,
): Promise<Array<{ index: number; relevance_score: number }>> {
  const res = await fetch(COHERE_RERANK_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: RERANK_MODEL,
      query,
      documents,
      top_n: topN,
    }),
  })
  if (!res.ok) {
    throw new Error(`Cohere rerank failed (status ${res.status}).`)
  }
  const data = (await res.json()) as {
    results?: Array<{ index: number; relevance_score: number }>
  }
  return Array.isArray(data.results) ? data.results : []
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405)
  }

  const cohereKey = process.env.COHERE_API_KEY
  const qdrantUrl = process.env.QDRANT_URL
  const qdrantKey = process.env.QDRANT_API_KEY
  const collection = process.env.QDRANT_COLLECTION || 'nyc_closed_cases'

  // Match the existing AI functions: a clear 503 when the feature is not wired
  // up in this environment, so the UI can show a calm "not configured" state.
  if (!cohereKey || !qdrantUrl) {
    return json({ error: 'Similar case retrieval is not configured on the server.' }, 503)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400)
  }

  const input = (body ?? {}) as {
    caseId?: unknown
    text?: unknown
    query?: unknown
    topK?: unknown
  }

  const caseId = asString(input.caseId) || null
  const rawText = asString(input.text)
  const queryFields = (input.query ?? {}) as QueryFields
  const queryText = rawText || composeCaseText(queryFields)

  if (!queryText) {
    return json(
      { error: 'Provide `text` or a `query` object with case fields to search on.' },
      400,
    )
  }

  const requestedK = typeof input.topK === 'number' ? Math.floor(input.topK) : DEFAULT_RESULTS
  const topN = Math.max(1, Math.min(MAX_RESULTS, requestedK || DEFAULT_RESULTS))

  try {
    const vector = await embedQuery(cohereKey, queryText)
    const candidates = await searchQdrant(qdrantUrl, qdrantKey, collection, vector)

    if (candidates.length === 0) {
      return json({
        retrieval_version: RETRIEVAL_VERSION,
        embed_model: EMBED_MODEL,
        rerank_model: RERANK_MODEL,
        provenance: 'ai_assisted_retrieval',
        query_case_id: caseId,
        results: [] as SimilarCaseResult[],
        advisory: ADVISORY,
      })
    }

    const documents = candidates.map((candidate) => payloadToText(candidate.payload))
    const ranked = await rerank(cohereKey, queryText, documents, Math.min(topN, candidates.length))

    const results: SimilarCaseResult[] = ranked.map((entry) => {
      const candidate = candidates[entry.index]
      return {
        ...candidate.payload,
        similarity_score: candidate.score,
        rerank_score: entry.relevance_score,
      }
    })

    return json({
      retrieval_version: RETRIEVAL_VERSION,
      embed_model: EMBED_MODEL,
      rerank_model: RERANK_MODEL,
      provenance: 'ai_assisted_retrieval',
      query_case_id: caseId,
      results,
      advisory: ADVISORY,
    })
  } catch (err) {
    // Never leak credentials; log only the message server-side.
    console.error('similar-cases failed:', errorText(err))
    return json({ error: 'Similar case retrieval is temporarily unavailable.' }, 502)
  }
}
