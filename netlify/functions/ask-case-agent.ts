// Server-side Netlify function backing the "Ask this case" assistant on
// /app/closure-review. It lets staff ask a free-text question about the ONE
// selected complaint case and returns concise draft guidance.
//
// AGENTIC ORCHESTRATION (lightweight)
// -----------------------------------
// On each explicit staff question this function runs a small, safe agentic loop:
// it defines a GOAL, follows a short fixed PLAN (review the selected case, the
// Needs Attention signal, and the deterministic rules, then answer using only
// that context), and returns the answer alongside an agentTrace (goal, plan,
// tools used, notes). The "tools" here are the in-request context surfaces the
// agent reasoned over — selectedCaseContext, deterministicRules,
// needsAttentionSignal — not external calls. This version does NOT retrieve
// similar cases. It is decision-support drafting only: no autonomous action, no
// enforcement decision, no Supabase read or write of any kind.
//
// SECURITY
// --------
// The Anthropic API key is read from the Netlify environment variable
// ANTHROPIC_API_KEY and is used ONLY inside this server-side function. It is
// never sent to the browser, never exposed through a VITE_* variable, never
// logged, and never handled by the Supabase client. Do not create
// VITE_ANTHROPIC_API_KEY.
//
// SCOPE & GOVERNANCE
// ------------------
// Runs once per explicit staff question, for a single case. It receives only the
// case snapshot, the V2 Needs Attention ML signal, the deterministic context the
// frontend already computed, and the staff question. It does NOT read the
// database, does NOT write anything, does NOT close cases, does NOT contact
// residents, and makes NO enforcement decision. It prepares draft guidance for
// staff review only.

// Same known-working Anthropic model as generate-ai-review-packet.ts so this
// function stays on a model id the account/API actually serves.
const MODEL = 'claude-sonnet-4-6'
const PROMPT_VERSION = 'ask-case-agent-v1'
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_TOKENS = 600

// Cap the staff question so the prompt stays predictable and focused.
const MAX_QUESTION_LEN = 500

// Agentic layer: a fixed GOAL and short PLAN the backend follows. These are
// surfaced verbatim in the agentTrace so the assistant's reasoning is
// transparent to staff. The plan is read-only — there is no autonomous action.
const AGENT_GOAL =
  'Answer the staff question about the selected case using only the supplied context. Draft guidance only; staff approval required.'

const AGENT_PLAN: string[] = [
  'Review the selected case.',
  'Review the Needs Attention signal.',
  'Review the deterministic rules.',
  'Answer the staff question using only the provided context.',
  'Return draft-only staff guidance.',
]

// The context surfaces the agent reasoned over. Stable for this version: the
// assistant always grounds its answer in these three in-request surfaces.
const TOOLS_USED: string[] = ['selectedCaseContext', 'deterministicRules', 'needsAttentionSignal']

// Always-present governance line, server-owned so the UI can never present the
// answer as an action.
const DEFAULT_ADVISORY =
  'Assistant response is draft guidance only. Staff must review before taking action. No case was closed and no resident was contacted.'

const SYSTEM_PROMPT = [
  'You are assisting municipal enforcement staff with one selected complaint case.',
  'You answer staff questions about the selected case.',
  'You do not decide enforcement outcomes.',
  'You do not close cases.',
  'You do not contact residents.',
  'You prepare draft guidance for staff review only.',
  'Use only the supplied case context (case snapshot, Needs Attention signal, deterministic rules). Do not invent facts.',
  'If the answer depends on information that is missing, say what is missing.',
  'Return JSON only.',
  '',
  'Answer style rules:',
  '- Keep the answer concise: 2 to 5 sentences maximum.',
  '- A short bullet list is allowed only if it genuinely helps; otherwise use plain sentences.',
  '- Use plain municipal operations language. This is a staff workflow aid.',
  '- Do not make a final determination.',
  '- Do not make or imply an enforcement decision.',
  '- Do not imply any case was closed or any resident was contacted.',
  '- Do not call the Needs Attention score a priority score. Call it a Needs Attention signal or queue attention signal.',
  '- Do not use the phrase "model anomaly".',
  '- Staff approval remains required.',
  '',
  'Return ONLY a single JSON object (no markdown, no code fences, no commentary) with exactly this field:',
  '- answer: string — the concise draft guidance answering the staff question.',
].join('\n')

type CaseSnapshot = {
  source_record_id: string | null
  complaint_type: string | null
  description: string | null
  ward_or_area: string | null
  status: string | null
  assigned_department: string | null
}

type MlSignal = {
  needs_attention_score: number | null
  attention_tier: string | null
  attention_rank: number | null
}

type DeterministicContext = {
  rulesFired: string[]
  recommendedAction: string
  missingInformationChecklist: Array<{ label: string; status: string }>
}

type AskRequest = {
  caseSnapshot: CaseSnapshot
  mlSignal: MlSignal
  deterministic: DeterministicContext
  question: string
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function str(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

function strOrNull(value: unknown): string | null {
  if (value == null) return null
  const s = str(value)
  return s.trim() ? s : null
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(str).map((s) => s.trim()).filter(Boolean)
}

// Lightly validate and normalize the incoming request so the prompt stays
// predictable. Anything unexpected is coerced or dropped rather than trusted.
function sanitizeRequest(raw: unknown): AskRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const snap = (obj.caseSnapshot ?? {}) as Record<string, unknown>
  const ml = (obj.mlSignal ?? {}) as Record<string, unknown>
  const det = (obj.deterministic ?? {}) as Record<string, unknown>

  const checklistRaw = Array.isArray(det.missingInformationChecklist)
    ? (det.missingInformationChecklist as unknown[])
    : []

  const question = str(obj.question).trim().slice(0, MAX_QUESTION_LEN)

  return {
    caseSnapshot: {
      source_record_id: strOrNull(snap.source_record_id),
      complaint_type: strOrNull(snap.complaint_type),
      description: strOrNull(snap.description),
      ward_or_area: strOrNull(snap.ward_or_area),
      status: strOrNull(snap.status),
      assigned_department: strOrNull(snap.assigned_department),
    },
    mlSignal: {
      needs_attention_score: num(ml.needs_attention_score),
      attention_tier: strOrNull(ml.attention_tier),
      attention_rank: num(ml.attention_rank),
    },
    deterministic: {
      rulesFired: strArray(det.rulesFired),
      recommendedAction: str(det.recommendedAction),
      missingInformationChecklist: checklistRaw
        .map((c) => {
          const cc = (c ?? {}) as Record<string, unknown>
          return { label: str(cc.label), status: str(cc.status) }
        })
        .filter((c) => c.label),
    },
    question,
  }
}

function buildUserPrompt(input: AskRequest): string {
  const { caseSnapshot: c, mlSignal: m, deterministic: d, question } = input
  const field = (label: string, value: string | number | null) =>
    `${label}: ${value === null || value === '' ? '(not provided)' : value}`

  const checklist = d.missingInformationChecklist.length
    ? d.missingInformationChecklist.map((c2) => `- ${c2.label}: ${c2.status || '(unknown)'}`).join('\n')
    : '- (none provided)'

  const rules = d.rulesFired.length ? d.rulesFired.map((r) => `- ${r}`).join('\n') : '- (none fired)'

  return [
    'AGENT GOAL',
    AGENT_GOAL,
    '',
    'AGENT PLAN',
    ...AGENT_PLAN.map((step, i) => `${i + 1}. ${step}`),
    '',
    'Answer the staff question about this single selected case, using only the context below.',
    '',
    'CASE SNAPSHOT',
    field('source_record_id', c.source_record_id),
    field('complaint_type', c.complaint_type),
    field('description', c.description),
    field('ward_or_area', c.ward_or_area),
    field('status', c.status),
    field('assigned_department', c.assigned_department),
    '',
    'NEEDS ATTENTION ML SIGNAL (relative queue ranking, decision support only)',
    field('needs_attention_score', m.needs_attention_score),
    field('attention_tier', m.attention_tier),
    field('attention_rank', m.attention_rank),
    '',
    'DETERMINISTIC CONTEXT (governance baseline — do not override)',
    `recommended_action: ${d.recommendedAction || '(not provided)'}`,
    'rules_fired:',
    rules,
    'missing_information_checklist:',
    checklist,
    '',
    'STAFF QUESTION',
    question,
  ].join('\n')
}

// Pull the JSON object out of the model's text response, tolerating an
// occasional code fence or stray prose around it.
function extractAnswer(text: string): string {
  let candidate = text.trim()
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fence) candidate = fence[1].trim()
  if (!candidate.startsWith('{')) {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) candidate = candidate.slice(start, end + 1)
  }
  const parsed = JSON.parse(candidate) as Record<string, unknown>
  return str(parsed.answer).trim()
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed. Use POST.' }, 405)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return json({ error: 'Case assistant is not configured in this environment.' }, 503)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400)
  }

  const input = sanitizeRequest(body)
  if (!input) {
    return json({ error: 'A case question request object is required.' }, 400)
  }
  if (!input.question) {
    return json({ error: 'A question about the selected case is required.' }, 400)
  }
  if (!input.caseSnapshot.complaint_type && !input.caseSnapshot.description) {
    return json({ error: 'A case snapshot with a complaint type or description is required.' }, 400)
  }

  let anthropicRes: Response
  try {
    anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(input) }],
      }),
    })
  } catch (err) {
    console.error('Case assistant request failed to reach Anthropic:', errorText(err))
    return json({ error: 'Could not reach the AI service. Try again.' }, 502)
  }

  if (!anthropicRes.ok) {
    let detail = ''
    try {
      detail = (await anthropicRes.text()).slice(0, 2000)
    } catch (err) {
      detail = `<unreadable response body: ${errorText(err)}>`
    }
    console.error('Anthropic API returned a non-OK status:', anthropicRes.status, detail)
    return json({ error: 'AI service error. Please check the server logs.' }, 502)
  }

  let text: string
  try {
    const data = (await anthropicRes.json()) as {
      content?: Array<{ type: string; text?: string }>
    }
    text = (data.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('\n')
      .trim()
  } catch (err) {
    console.error('Failed to read AI service response:', errorText(err))
    return json({ error: 'AI service returned an unreadable response.' }, 502)
  }

  let answer: string
  try {
    answer = extractAnswer(text)
  } catch (err) {
    console.error('Failed to parse structured case assistant JSON:', errorText(err))
    return json({ error: 'AI service did not return a structured answer.' }, 502)
  }
  if (!answer) {
    return json({ error: 'AI service returned an empty answer.' }, 502)
  }

  // Agent trace is server-owned and deterministic: the goal and plan the backend
  // followed, the context surfaces it reasoned over, and a non-blocking note.
  const agentTrace = {
    goal: AGENT_GOAL,
    plan: AGENT_PLAN,
    toolsUsed: TOOLS_USED,
    notes: ['Answered from selected case context only. No similar cases retrieved. Read only — nothing was written.'],
  }

  return json({
    model: MODEL,
    prompt_version: PROMPT_VERSION,
    answer,
    agentTrace,
    advisory: DEFAULT_ADVISORY,
  })
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
