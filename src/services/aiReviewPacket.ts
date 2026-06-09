// Frontend helper for the AI Assisted Review Packet on /app/closure-review.
//
// This calls the server-side Netlify function
// (/.netlify/functions/generate-ai-review-packet), which holds the Anthropic API
// key. The browser never sees the key. The function prepares draft language only
// — staff review and approval are always required, and nothing is written to
// Supabase or sent to a resident. It is only ever invoked from an explicit staff
// click, never on page load.

/** Reserved server-side endpoint (never shadowed by the SPA catch-all). */
const AI_REVIEW_PACKET_ENDPOINT = '/.netlify/functions/generate-ai-review-packet'

/** Exactly what the client sends: case snapshot + ML signal + deterministic context. */
export type AiReviewPacketRequest = {
  caseSnapshot: {
    source_record_id: string | null
    complaint_type: string | null
    description: string | null
    ward_or_area: string | null
    status: string | null
    assigned_department: string | null
  }
  mlSignal: {
    needs_attention_score: number | null
    attention_tier: string | null
    attention_rank: number | null
  }
  deterministic: {
    rulesFired: string[]
    recommendedAction: string
    missingInformationChecklist: Array<{ label: string; status: string }>
  }
}

/**
 * Transparent record of the lightweight agentic workflow the backend ran:
 * the goal it pursued, the plan it followed, the read-only tool(s) it used, how
 * many similar cases it retrieved for context, and any non-blocking notes (e.g.
 * similar-case retrieval was skipped or returned nothing). Rendered as the
 * compact "Agent workflow trace" below the AI packet. May be absent on older
 * responses, so treat it as optional.
 */
export type AgentTrace = {
  goal: string
  plan: string[]
  toolsUsed: string[]
  similarCasesFound: number
  notes: string[]
}

/** Structured draft packet returned by the function for staff review. */
export type AiReviewPacketResponse = {
  staffSummary: string
  recommendedNextStep: string
  missingInformationNotes: string[]
  residentUpdateDraft: string
  closureLanguage: string | null
  supervisorFlags: string[]
  plainEnglishReason: string
  advisory: string
  model?: string
  prompt_version?: string
  agentTrace?: AgentTrace
}

/**
 * Call the server-side function to generate an AI assisted review packet for the
 * single selected case. Throws on any non-OK response (including the 503 when
 * ANTHROPIC_API_KEY is not configured) so the page can show a non-blocking error
 * and keep the deterministic packet visible.
 */
export async function generateAiReviewPacket(
  input: AiReviewPacketRequest,
): Promise<AiReviewPacketResponse> {
  let res: Response
  try {
    res = await fetch(AI_REVIEW_PACKET_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch {
    throw new Error('Could not reach the AI review service. Please try again.')
  }

  let payload: unknown = null
  try {
    payload = await res.json()
  } catch {
    // fall through to the status-based error below
  }

  if (!res.ok) {
    const message =
      payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).error === 'string'
        ? ((payload as Record<string, unknown>).error as string)
        : `AI review packet failed (status ${res.status}).`
    throw new Error(message)
  }

  return payload as AiReviewPacketResponse
}
