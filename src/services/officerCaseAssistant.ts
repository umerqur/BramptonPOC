import { supabase } from '../lib/supabase'

// Client wrapper for the server-side "Officer Case Assistant" Netlify function
// (netlify/functions/officer-case-assistant.ts).
//
// The Cohere Command key and the Supabase service role key live ONLY on the
// server. The browser sends the case id, the officer's question, and — when a
// Supabase session exists — the access token in the Authorization header so the
// server can resolve the authenticated staff identity and enforce case-scoped
// access. The assistant is case-scoped decision support; it never writes to
// Supabase and never decides an enforcement outcome.

const ENDPOINT = '/.netlify/functions/officer-case-assistant'

// Limited case context the client may supply. In the server-verified path this
// is ignored (the server fetches authoritative context from Supabase); it is
// only used in the clearly-marked POC fallback when server-side Supabase is not
// configured in the environment.
export type AssistantCaseContextInput = {
  issue_type?: string | null
  description?: string | null
  location?: string | null
  status?: string | null
  assigned_officer_name?: string | null
}

// A single retrieved benchmark reference (a similar closed case) with the
// retrieval scores that justify surfacing it. Used to show which case supports
// each benchmark note.
export type BenchmarkReference = {
  case_id: string
  complaint_type: string | null
  request_detail: string | null
  resolution_description: string | null
  closure_days: number | null
  similarity_score: number | null
  rerank_score: number | null
}

// A benchmark observation tied to the case_id of a retrieved benchmark.
export type BenchmarkNote = {
  case_id: string
  note: string
}

export type AssistantResult = {
  answer: string
  used_context: string[]
  officer_checklist: string[]
  missing_information: string[]
  benchmark_notes: BenchmarkNote[]
  limitations: string
}

export type AssistantResponse = {
  model: string
  prompt_version: string
  poc_only: boolean
  benchmarks_used: number
  /** The retrieved benchmark references that grounded the answer. */
  benchmarks: BenchmarkReference[]
  result: AssistantResult
}

/** Thrown on a 503 so the UI can show the calm "not configured" state. */
export class AssistantNotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssistantNotConfiguredError'
  }
}

export async function askOfficerCaseAssistant(
  caseId: string,
  question: string,
  caseContext?: AssistantCaseContextInput,
): Promise<AssistantResponse> {
  // Attach the Supabase access token when available so the server can verify
  // identity. Best-effort: if there is no session the server falls back to its
  // POC path (or returns 401 when server-side auth is configured).
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  try {
    const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
    const token = data.session?.access_token
    if (token) headers.authorization = `Bearer ${token}`
  } catch {
    // No session available — proceed without a token.
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ caseId, question, caseContext: caseContext ?? {} }),
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
    if (res.status === 503) throw new AssistantNotConfiguredError(message)
    throw new Error(message)
  }

  return payload as AssistantResponse
}
