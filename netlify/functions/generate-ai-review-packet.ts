// Server-side Netlify function that prepares an AI assisted "Closure Review"
// packet for ONE selected complaint case on /app/closure-review.
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
// This runs once per explicit staff click, for a single case. It receives only
// the case snapshot, the V2 Needs Attention ML signal, and the deterministic
// context (rules fired, recommended action, missing-info checklist) that the
// frontend already computed. It does NOT read the database, does NOT write
// anything, does NOT close cases, does NOT contact residents, and makes NO
// enforcement decision. It prepares draft language for staff review only — the
// deterministic packet remains the governance baseline.

// Netlify Functions v2 web-standard handler. Node 20 provides a global fetch, so
// no Anthropic SDK dependency is required. The client calls the reserved
// /.netlify/functions/generate-ai-review-packet endpoint, which the SPA
// catch-all redirect never shadows.

// Small, cheap Claude model — this is short drafting, not heavy reasoning.
const MODEL = 'claude-3-5-haiku-latest'
const PROMPT_VERSION = 'ai-review-packet-v1'
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_TOKENS = 900

// Always-present governance line. Even if the model omits it, the response
// carries this so the UI can never present the draft as an action.
const DEFAULT_ADVISORY =
  'AI prepares a draft only. Staff review and approval are required before any action. No case was closed and no resident was contacted.'

const SYSTEM_PROMPT = [
  'You are assisting municipal enforcement staff.',
  'You do not decide enforcement outcomes.',
  'You do not close cases.',
  'You do not contact residents.',
  'You prepare draft language for staff review only.',
  'Use only the supplied case context.',
  'Do not invent facts.',
  'If information is missing, say what is missing.',
  'Keep language plain, neutral, policy aligned, and professional.',
  'Return JSON only.',
  '',
  'The supplied deterministic rules and recommended action are the governance baseline. You may improve the wording and add useful review notes, but do not contradict or override them, and do not assert a final determination.',
  '',
  'Return ONLY a single JSON object (no markdown, no code fences, no commentary) with exactly these fields:',
  '- staffSummary: string — a short neutral summary of the case for a staff reviewer.',
  '- recommendedNextStep: string — a suggested next operational step, framed for staff to consider, consistent with the supplied recommended action.',
  '- missingInformationNotes: string[] — specific information that appears missing or unclear and should be gathered. Use an empty array if nothing is missing.',
  '- residentUpdateDraft: string — a polite draft update to the resident that staff must review and edit before sending.',
  '- closureLanguage: string or null — draft closure wording ONLY if the case status indicates it is completed or closed; otherwise null.',
  '- supervisorFlags: string[] — any risk or supervisor-review flags (e.g. safety wording, repeat issue). Use an empty array if none.',
  '- plainEnglishReason: string — a plain-English explanation of why this case is positioned the way it is.',
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

type PacketRequest = {
  caseSnapshot: CaseSnapshot
  mlSignal: MlSignal
  deterministic: DeterministicContext
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
function sanitizeRequest(raw: unknown): PacketRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const snap = (obj.caseSnapshot ?? {}) as Record<string, unknown>
  const ml = (obj.mlSignal ?? {}) as Record<string, unknown>
  const det = (obj.deterministic ?? {}) as Record<string, unknown>

  const checklistRaw = Array.isArray(det.missingInformationChecklist)
    ? (det.missingInformationChecklist as unknown[])
    : []

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
  }
}

function buildUserPrompt(input: PacketRequest): string {
  const { caseSnapshot: c, mlSignal: m, deterministic: d } = input
  const field = (label: string, value: string | number | null) =>
    `${label}: ${value === null || value === '' ? '(not provided)' : value}`

  const checklist = d.missingInformationChecklist.length
    ? d.missingInformationChecklist.map((c2) => `- ${c2.label}: ${c2.status || '(unknown)'}`).join('\n')
    : '- (none provided)'

  const rules = d.rulesFired.length ? d.rulesFired.map((r) => `- ${r}`).join('\n') : '- (none fired)'

  return [
    'Prepare an AI assisted review packet for this single selected case.',
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
  ].join('\n')
}

type PacketResult = {
  staffSummary: string
  recommendedNextStep: string
  missingInformationNotes: string[]
  residentUpdateDraft: string
  closureLanguage: string | null
  supervisorFlags: string[]
  plainEnglishReason: string
  advisory: string
}

// Pull the JSON object out of the model's text response, tolerating an
// occasional code fence or stray prose around it.
function extractResult(text: string): PacketResult {
  let candidate = text.trim()
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fence) candidate = fence[1].trim()
  if (!candidate.startsWith('{')) {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) candidate = candidate.slice(start, end + 1)
  }
  const parsed = JSON.parse(candidate) as Record<string, unknown>
  return {
    staffSummary: str(parsed.staffSummary),
    recommendedNextStep: str(parsed.recommendedNextStep),
    missingInformationNotes: strArray(parsed.missingInformationNotes),
    residentUpdateDraft: str(parsed.residentUpdateDraft),
    closureLanguage: strOrNull(parsed.closureLanguage),
    supervisorFlags: strArray(parsed.supervisorFlags),
    plainEnglishReason: str(parsed.plainEnglishReason),
    // Governance line is server-owned: prefer the model's if present, else fixed.
    advisory: str(parsed.advisory).trim() || DEFAULT_ADVISORY,
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed. Use POST.' }, 405)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // Clear, non-secret configuration message. The frontend keeps the
    // deterministic packet visible when it sees this 503.
    return json({ error: 'AI review packet is not configured in this environment.' }, 503)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400)
  }

  const input = sanitizeRequest(body)
  if (!input) {
    return json({ error: 'A review packet request object is required.' }, 400)
  }
  // Light required-field validation: we need at least something to describe.
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
    console.error('AI review packet request failed to reach Anthropic:', errorText(err))
    return json({ error: 'Could not reach the AI service. Try again.' }, 502)
  }

  if (!anthropicRes.ok) {
    console.error('Anthropic API returned a non-OK status:', anthropicRes.status)
    return json({ error: `AI service error (status ${anthropicRes.status}).` }, 502)
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

  let result: PacketResult
  try {
    result = extractResult(text)
  } catch (err) {
    console.error('Failed to parse structured AI review packet JSON:', errorText(err))
    return json({ error: 'AI service did not return a structured review packet.' }, 502)
  }

  return json({ model: MODEL, prompt_version: PROMPT_VERSION, ...result })
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
