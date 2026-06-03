// Server-side Netlify function that generates a Claude-powered "AI assisted
// staff review" for ONE selected municipal complaint case.
//
// SECURITY
// --------
// The Anthropic API key is read from the Netlify environment variable
// ANTHROPIC_API_KEY and is used ONLY inside this server-side function. It is
// never sent to the browser, never exposed through a VITE_* variable, never
// logged, and never handled by the Supabase client. Do not create
// VITE_ANTHROPIC_API_KEY.
//
// SCOPE
// -----
// This runs once per click, for a single case. It only ever receives the
// explicit allow-listed fields of the one selected case (see ALLOWED_FIELDS).
// It does not read the database, does not batch process records, and is not
// invoked for the case queue list or automatically on page load — the frontend
// only calls it when a staff user clicks "Generate AI review".
//
// This is decision support only. It does not replace the existing rule based
// POC triage and does not make any final enforcement decision.

// Netlify Functions v2 web-standard handler. Node 20 runtime provides a global
// fetch, so no Anthropic SDK dependency is required. The client calls the
// reserved /.netlify/functions/generate-case-ai-review endpoint, which the SPA
// catch-all redirect never shadows.

// Identify the model and prompt contract so persisted results are auditable.
const MODEL = 'claude-sonnet-4-6'
const PROMPT_VERSION = 'case-ai-review-v1'
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

// Only these fields of the single selected case are ever forwarded to Claude.
const ALLOWED_FIELDS = [
  'case_id',
  'complaint_type',
  'description',
  'status',
  'workflow_stage',
  'priority',
  'department',
  'ward_or_area',
  'ai_category',
  'ai_summary',
  'ai_recommended_action',
] as const

type AllowedField = (typeof ALLOWED_FIELDS)[number]
type CaseInput = Partial<Record<AllowedField, string>>

// Structured contract returned to the client and stored in case_ai_reviews.
const RESULT_KEYS = [
  'staff_summary',
  'recommended_next_action',
  'missing_information',
  'resident_response_draft',
  'priority_rationale',
  'human_review_note',
] as const

const SYSTEM_PROMPT = [
  'You are a careful assistant supporting authorized municipal staff who are reviewing a single complaint case in a proof-of-concept tool.',
  '',
  'Important constraints:',
  '- This is decision support only. You never make a final enforcement decision and you must not imply that you do.',
  '- A human staff review is always required. Defer enforcement, legal, and closure decisions to staff.',
  '- You do not replace the existing rule based triage. Treat any provided ai_category, ai_summary, ai_recommended_action and priority as existing rule based triage context, not as your own conclusions.',
  '- The data is benchmark/demonstration complaint data, not Brampton operational complaint data. Do not assert it is real operational data.',
  '- Work only from the single case provided. Do not invent facts, names, addresses, dates, or statutes that are not present.',
  '',
  'Return ONLY a single minified or pretty JSON object (no markdown, no code fences, no commentary) with exactly these string fields:',
  '- staff_summary: a short neutral summary of the case for a staff reviewer.',
  '- recommended_next_action: a suggested next operational step, framed as a recommendation for staff to consider.',
  '- missing_information: what important information appears to be missing or unclear and should be gathered.',
  '- resident_response_draft: a polite draft acknowledgement to the resident that staff must review and edit before sending.',
  '- priority_rationale: a plain-language rationale discussing the existing priority, without overriding the rule based triage.',
  '- human_review_note: an explicit note reminding staff that this is AI assistance requiring human review and is not a final decision.',
].join('\n')

function buildUserPrompt(input: CaseInput): string {
  const lines = ALLOWED_FIELDS.map((field) => {
    const value = input[field]
    return `${field}: ${value && value.trim() ? value.trim() : '(not provided)'}`
  })
  return [
    'Generate an AI assisted staff review for this single selected case.',
    '',
    'Selected case fields:',
    ...lines,
  ].join('\n')
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// Keep only the allow-listed string fields; ignore anything else the client
// might send so the case payload stays minimal and predictable.
function sanitizeInput(raw: unknown): CaseInput {
  const out: CaseInput = {}
  if (!raw || typeof raw !== 'object') return out
  const obj = raw as Record<string, unknown>
  for (const field of ALLOWED_FIELDS) {
    const value = obj[field]
    if (typeof value === 'string') out[field] = value
    else if (typeof value === 'number') out[field] = String(value)
  }
  return out
}

// Pull the JSON object out of the model's text response, tolerating an
// occasional code fence or stray prose around it.
function extractResult(text: string): Record<string, string> {
  let candidate = text.trim()
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fence) candidate = fence[1].trim()
  if (!candidate.startsWith('{')) {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) candidate = candidate.slice(start, end + 1)
  }
  const parsed = JSON.parse(candidate) as Record<string, unknown>
  const result: Record<string, string> = {}
  for (const key of RESULT_KEYS) {
    const value = parsed[key]
    if (typeof value === 'string') result[key] = value
    else if (Array.isArray(value)) result[key] = value.map(String).join('\n')
    else if (value != null) result[key] = String(value)
    else result[key] = ''
  }
  return result
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed. Use POST.' }, 405)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // Never echo the key or its absence in a way that leaks secrets — this is a
    // configuration error, not sensitive data.
    return json({ error: 'AI review is not configured on the server.' }, 503)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400)
  }

  const input = sanitizeInput(body)
  if (!input.case_id) {
    return json({ error: 'A single case with a case_id is required.' }, 400)
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
        max_tokens: 1600,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(input) }],
      }),
    })
  } catch (err) {
    console.error('AI review request failed to reach Anthropic:', errorText(err))
    return json({ error: 'Could not reach the AI service. Try again.' }, 502)
  }

  if (!anthropicRes.ok) {
    // Log status only — not the API key or full request.
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

  let result: Record<string, string>
  try {
    result = extractResult(text)
  } catch (err) {
    console.error('Failed to parse structured AI review JSON:', errorText(err))
    return json({ error: 'AI service did not return a structured review.' }, 502)
  }

  return json({
    case_id: input.case_id,
    model: MODEL,
    prompt_version: PROMPT_VERSION,
    result,
  })
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
