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
const ASK_CASE_AGENT_ENDPOINT = '/.netlify/functions/ask-case-agent'

/**
 * Linked operational records the case workspace already retrieved (with the
 * staff member's authenticated Supabase session) and sends along so the AI
 * packet is grounded in them. Patrol logs, ticket records, and the closure
 * template are SYNTHETIC POC operational context linked to real benchmark
 * case ids; the complaint trend is generated from the NYC 311 public
 * benchmark data. Optional: older callers or cases with no linked records
 * simply omit pieces.
 */
export type OperationalContextPayload = {
  patrolLogs: Array<{
    patrol_date: string | null
    officer_unit: string | null
    patrol_type: string | null
    observed_issue: string | null
    observation_result: string | null
  }>
  ticketRecords: Array<{
    ticket_number: string | null
    ticket_date: string | null
    enforcement_type: string | null
    violation_category: string | null
    outcome: string | null
    fine_amount: number | null
    status: string | null
  }>
  complaintTrend: {
    area: string | null
    complaint_type: string | null
    period_start: string | null
    period_end: string | null
    complaint_count: number
    prior_period_count: number
    change_percent: number | null
    repeat_location_count: number
    trend_label: string | null
  } | null
  closureScenario: string
  closureTemplate: {
    complaint_type: string
    scenario: string
    template_text: string
    required_context: string[]
    policy_note: string | null
  } | null
  closureReadiness: Array<{ label: string; status: string }>
}

/**
 * Exactly what the client sends: case snapshot + attention signal + deterministic
 * context. The `mlSignal` key name is retained only for backend type
 * compatibility with the existing AI Review Packet function — it is now fed the
 * statistical Review Attention values (no ML model is involved).
 */
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
  operationalContext?: OperationalContextPayload
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

// ---------------------------------------------------------------------------
// "Ask this case" assistant — a lightweight agentic chat over the SELECTED case.
// Same server-side key handling as above: the browser never sees the Anthropic
// key, nothing is written to Supabase, and the answer is draft guidance only.
// ---------------------------------------------------------------------------

/**
 * Request for the "Ask this case" assistant: the same case context shape the
 * review packet sends, plus the staff question. Reusing AiReviewPacketRequest
 * keeps the case snapshot / ML signal / deterministic context identical.
 */
export type AskCaseAgentRequest = AiReviewPacketRequest & {
  question: string
}

/**
 * Transparent record of the lightweight agentic steps the assistant followed:
 * the goal, the short plan, the in-request context surfaces it reasoned over
 * (selectedCaseContext, deterministicRules, needsAttentionSignal), and any
 * non-blocking notes. No similar-case retrieval in this version.
 */
export type AskCaseAgentTrace = {
  goal: string
  plan: string[]
  toolsUsed: string[]
  notes: string[]
}

/** Concise draft answer plus the agent trace and governance advisory. */
export type AskCaseAgentResponse = {
  answer: string
  agentTrace: AskCaseAgentTrace
  advisory: string
  model?: string
  prompt_version?: string
}

/**
 * Ask the server-side assistant a question about the single selected case.
 * Throws on any non-OK response (including the 503 when ANTHROPIC_API_KEY is not
 * configured) so the UI can show a non-blocking error.
 */
export async function askCaseAgent(input: AskCaseAgentRequest): Promise<AskCaseAgentResponse> {
  let res: Response
  try {
    res = await fetch(ASK_CASE_AGENT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch {
    throw new Error('Could not reach the case assistant. Please try again.')
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
        : `Case assistant request failed (status ${res.status}).`
    throw new Error(message)
  }

  return payload as AskCaseAgentResponse
}
