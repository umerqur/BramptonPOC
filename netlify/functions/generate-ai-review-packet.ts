// Server-side Netlify function that prepares an AI assisted "Closure Review"
// packet for ONE selected complaint case on /app/closure-review.
//
// AGENTIC ORCHESTRATION (lightweight)
// -----------------------------------
// On each explicit staff click this function runs a small, safe agentic
// workflow: read the selected complaint, retrieve its related patrol logs and
// ticket records (synthetic POC operational context linked to real benchmark
// case ids, fetched read-only by the authenticated case workspace and sent
// with the request), retrieve the complaint trend context (generated from the
// NYC 311 public benchmark), select the matching closure template, then
// call Claude to draft the staff summary, next step, resident update, and
// closure language grounded in those records — and return the draft for staff
// approval only. One read-only backend tool (findSimilarCases) additionally
// retrieves up to 3 similar benchmark cases for context. An agentTrace (goal,
// plan, tools used, notes) travels back with the packet. This is decision
// support drafting only — no autonomous enforcement, no automatic closure, no
// resident contact, and no write of any kind.
//
// SECURITY
// --------
// The Anthropic API key is read from the Netlify environment variable
// ANTHROPIC_API_KEY and is used ONLY inside this server-side function. It is
// never sent to the browser, never exposed through a VITE_* variable, never
// logged, and never handled by the Supabase client. Do not create
// VITE_ANTHROPIC_API_KEY. The Supabase anon key used by findSimilarCases is
// likewise read server-side only and never returned to the browser.
//
// SCOPE & GOVERNANCE
// ------------------
// This runs once per explicit staff click, for a single case. It receives the
// case snapshot, the V2 Needs Attention ML signal, and the deterministic
// context (rules fired, recommended action, missing-info checklist) that the
// frontend already computed. The only data it reads is a small, read-only
// SELECT of public benchmark similar cases (findSimilarCases). It does NOT
// write anything, does NOT close cases, does NOT contact residents, and makes
// NO enforcement decision. It prepares draft language for staff review only —
// the deterministic packet remains the governance baseline.

// Netlify Functions v2 web-standard handler. Node 20 provides a global fetch, so
// no Anthropic SDK dependency is required. The client calls the reserved
// /.netlify/functions/generate-ai-review-packet endpoint, which the SPA
// catch-all redirect never shadows.

// Use the same known-working Anthropic model as generate-case-ai-review.ts so
// this function stays on a model id the account/API actually serves.
const MODEL = 'claude-sonnet-4-6'
const PROMPT_VERSION = 'ai-review-packet-v3-operational-context'
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_TOKENS = 900

// Agentic layer: a fixed GOAL and a short PLAN the backend follows before and
// during the Claude call. These are surfaced verbatim in the agentTrace so the
// workflow's reasoning is transparent to staff. The plan is deliberately small
// and read-only — there is no autonomous action step.
const AGENT_GOAL =
  'Prepare a staff ready closure review packet for the selected complaint, grounded in its linked patrol logs, ticket records, complaint trend context, and matched closure template. Draft only; staff approval required.'

// The agent workflow, in order. Steps 2–5 operate over the linked records the
// authenticated case workspace retrieved (patrol logs, ticket records, trend
// context, closure template) plus the read-only similar-case lookup; step 6
// drafts; step 7 returns the draft for staff approval — nothing is closed,
// no enforcement decision is made, and no resident is contacted.
const AGENT_PLAN: string[] = [
  'Read the selected complaint.',
  'Retrieve the related patrol logs (synthetic POC records linked by case id).',
  'Retrieve the related ticket records (synthetic POC records linked by case id).',
  'Retrieve the complaint trend context (generated from the NYC 311 public benchmark).',
  'Select the matching closure template for the complaint type and scenario.',
  'Draft the staff summary, recommended next step, resident update, and closure language.',
  'Return the draft for staff approval only.',
]

// How many similar benchmark cases to surface as context, at most.
const MAX_SIMILAR_CASES = 3
// Keep retrieved descriptions short so the prompt stays focused and no long
// free-text is echoed back into the draft.
const SIMILAR_DESC_MAX_LEN = 160

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
  'Output style rules:',
  '- Use concise municipal operations language. This is a staff workflow aid, not a report.',
  '- Do not write a long letter. Keep each section short.',
  '- Do not include sign off placeholders like [Staff Name], [Department], or [Contact Information].',
  '- Do not call the ML score a priority score. Call it a Needs Attention signal or queue attention signal.',
  '- Do not use the phrase "model anomaly".',
  '- Do not overemphasize NYC, a specific borough, council district, or ZIP unless needed as source context.',
  '- When referring to location, say "the recorded service area" or "the source record area" where possible.',
  '- missingInformationNotes: at most 2 bullets.',
  '- supervisorFlags: at most 2 bullets.',
  '- residentUpdateDraft: 2 to 4 sentences.',
  '- plainEnglishReason: 2 to 3 sentences.',
  '- Do not invent urgency.',
  '- Do not imply enforcement action was taken.',
  '- Do not imply resident contact happened.',
  '- Staff approval remains required.',
  '',
  'The supplied deterministic rules and recommended action are the governance baseline. You may improve the wording and add useful review notes, but do not contradict or override them, and do not assert a final determination.',
  '',
  'Linked operational records rules:',
  '- The request may include related patrol logs, ticket records, a complaint trend, a closure scenario, a matched closure template, and a closure readiness checklist for the selected case.',
  '- Ground the staff summary, next step, resident update, and closure language in these records. Refer to what they actually say; do not invent patrols, tickets, or outcomes that are not listed.',
  '- Patrol logs, ticket records, and the closure template are SYNTHETIC POC operational context linked to real benchmark complaint case ids. Treat them as the case file for drafting, but never present them as real Brampton operational activity.',
  '- The complaint trend is generated from NYC 311 public benchmark data. Use it as area context only; it implies no outcome for this case.',
  '- Never include ticket numbers, fine amounts, or penalty details in the resident update or closure language.',
  '- When a matched closure template is supplied, base the closure language on it: keep its structure and tone, and adapt it with the specific facts from the patrol logs and ticket records. Respect its policy note.',
  '- If the closure readiness checklist shows items that are not ready, reflect that in the recommended next step rather than drafting closure language prematurely.',
  '',
  'Similar cases rules:',
  '- A list of similar cases may be supplied as context only.',
  '- Use similar cases only if they help staff understand workflow context.',
  '- Do not claim the selected case has the same outcome as any similar case.',
  '- Do not infer policy, precedent, or a determination from similar cases.',
  '- Do not invent any relationship between the selected case and similar cases.',
  '- Similar cases contain no resident identifiers; do not introduce any.',
  '',
  'Return ONLY a single JSON object (no markdown, no code fences, no commentary) with exactly these fields:',
  '- staffSummary: string — a short neutral summary of the case for a staff reviewer.',
  '- recommendedNextStep: string — a suggested next operational step, framed for staff to consider, consistent with the supplied recommended action.',
  '- missingInformationNotes: string[] — specific information that appears missing or unclear and should be gathered (max 2). Use an empty array if nothing is missing.',
  '- residentUpdateDraft: string — a polite 2 to 4 sentence draft update to the resident that staff must review and edit before sending.',
  '- closureLanguage: string or null — draft closure wording ONLY if the case status indicates it is completed or closed; otherwise null.',
  '- supervisorFlags: string[] — any review flags (e.g. safety wording, repeat issue), max 2. Use an empty array if none.',
  '- plainEnglishReason: string — a 2 to 3 sentence plain-English explanation of why this case is positioned the way it is, referring to the Needs Attention signal rather than a priority score.',
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

// Linked operational records retrieved by the authenticated case workspace and
// sent with the request, so the draft is grounded in the actual case file.
// Patrol logs / ticket records / closure template are synthetic POC context
// linked to real benchmark case ids; the trend is benchmark-derived.
type PatrolLogContext = {
  patrol_date: string | null
  officer_unit: string | null
  patrol_type: string | null
  observed_issue: string | null
  observation_result: string | null
}

type TicketRecordContext = {
  ticket_number: string | null
  ticket_date: string | null
  enforcement_type: string | null
  violation_category: string | null
  outcome: string | null
  fine_amount: number | null
  status: string | null
}

type ComplaintTrendContext = {
  area: string | null
  complaint_type: string | null
  period_start: string | null
  period_end: string | null
  complaint_count: number | null
  prior_period_count: number | null
  change_percent: number | null
  repeat_location_count: number | null
  trend_label: string | null
}

type ClosureTemplateContext = {
  complaint_type: string | null
  scenario: string | null
  template_text: string | null
  required_context: string[]
  policy_note: string | null
}

type OperationalContext = {
  patrolLogs: PatrolLogContext[]
  ticketRecords: TicketRecordContext[]
  complaintTrend: ComplaintTrendContext | null
  closureScenario: string
  closureTemplate: ClosureTemplateContext | null
  closureReadiness: Array<{ label: string; status: string }>
}

type PacketRequest = {
  caseSnapshot: CaseSnapshot
  mlSignal: MlSignal
  deterministic: DeterministicContext
  operationalContext: OperationalContext | null
}

// Caps that keep the prompt bounded no matter what the client sends.
const MAX_PATROL_LOGS = 5
const MAX_TICKET_RECORDS = 5
const MAX_READINESS_ITEMS = 12
const TEMPLATE_TEXT_MAX_LEN = 900
const CONTEXT_FIELD_MAX_LEN = 200

// A concise, non-sensitive similar-case summary used as context only. No
// resident identifiers and no source_record_id are ever included here.
type SimilarCase = {
  complaint_type: string | null
  assigned_department: string | null
  status: string | null
  ward_or_area: string | null
  description: string | null
}

// Outcome of the one backend tool. Always non-throwing: on any problem it
// returns an empty list plus a non-blocking note so the AI packet still works.
type SimilarCasesResult = {
  cases: SimilarCase[]
  toolUsed: boolean
  notes: string[]
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

// Clamp a nullable free-text field so no single value can bloat the prompt.
function clamped(value: unknown, maxLen = CONTEXT_FIELD_MAX_LEN): string | null {
  const s = strOrNull(value)
  return s ? s.slice(0, maxLen) : null
}

// Normalize the optional linked-records context. Each piece is individually
// optional; anything malformed is dropped rather than trusted.
function sanitizeOperationalContext(raw: unknown): OperationalContext | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  const patrolLogs: PatrolLogContext[] = (Array.isArray(obj.patrolLogs) ? obj.patrolLogs : [])
    .slice(0, MAX_PATROL_LOGS)
    .map((l) => {
      const log = (l ?? {}) as Record<string, unknown>
      return {
        patrol_date: clamped(log.patrol_date),
        officer_unit: clamped(log.officer_unit),
        patrol_type: clamped(log.patrol_type),
        observed_issue: clamped(log.observed_issue),
        observation_result: clamped(log.observation_result),
      }
    })

  const ticketRecords: TicketRecordContext[] = (Array.isArray(obj.ticketRecords) ? obj.ticketRecords : [])
    .slice(0, MAX_TICKET_RECORDS)
    .map((t) => {
      const ticket = (t ?? {}) as Record<string, unknown>
      return {
        ticket_number: clamped(ticket.ticket_number),
        ticket_date: clamped(ticket.ticket_date),
        enforcement_type: clamped(ticket.enforcement_type),
        violation_category: clamped(ticket.violation_category),
        outcome: clamped(ticket.outcome),
        fine_amount: num(ticket.fine_amount),
        status: clamped(ticket.status),
      }
    })

  let complaintTrend: ComplaintTrendContext | null = null
  if (obj.complaintTrend && typeof obj.complaintTrend === 'object') {
    const tr = obj.complaintTrend as Record<string, unknown>
    complaintTrend = {
      area: clamped(tr.area),
      complaint_type: clamped(tr.complaint_type),
      period_start: clamped(tr.period_start),
      period_end: clamped(tr.period_end),
      complaint_count: num(tr.complaint_count),
      prior_period_count: num(tr.prior_period_count),
      change_percent: num(tr.change_percent),
      repeat_location_count: num(tr.repeat_location_count),
      trend_label: clamped(tr.trend_label),
    }
  }

  let closureTemplate: ClosureTemplateContext | null = null
  if (obj.closureTemplate && typeof obj.closureTemplate === 'object') {
    const tpl = obj.closureTemplate as Record<string, unknown>
    closureTemplate = {
      complaint_type: clamped(tpl.complaint_type),
      scenario: clamped(tpl.scenario),
      template_text: clamped(tpl.template_text, TEMPLATE_TEXT_MAX_LEN),
      required_context: strArray(tpl.required_context),
      policy_note: clamped(tpl.policy_note, 400),
    }
  }

  const closureReadiness = (Array.isArray(obj.closureReadiness) ? obj.closureReadiness : [])
    .slice(0, MAX_READINESS_ITEMS)
    .map((c) => {
      const cc = (c ?? {}) as Record<string, unknown>
      return { label: str(cc.label).slice(0, CONTEXT_FIELD_MAX_LEN), status: str(cc.status).slice(0, 40) }
    })
    .filter((c) => c.label)

  const hasAnything =
    patrolLogs.length > 0 ||
    ticketRecords.length > 0 ||
    complaintTrend != null ||
    closureTemplate != null ||
    closureReadiness.length > 0
  if (!hasAnything) return null

  return {
    patrolLogs,
    ticketRecords,
    complaintTrend,
    closureScenario: str(obj.closureScenario).slice(0, 60),
    closureTemplate,
    closureReadiness,
  }
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
    operationalContext: sanitizeOperationalContext(obj.operationalContext),
  }
}

// Read the Supabase connection from the server environment. Prefer the
// server-style names, fall back to the VITE_* names the frontend already sets
// (Netlify exposes those to functions too). The ANON key only — never the
// service_role key. These are used solely for a read-only SELECT.
function supabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  return { url: url.replace(/\/+$/, ''), anonKey }
}

// ONE backend tool. Read-only: a single SELECT against the public benchmark
// table public.workflow_ml_predictions (the same Needs Attention slice the
// page reads). It NEVER writes, NEVER uses the service_role key, and NEVER
// throws — any missing config or query error degrades gracefully to an empty
// list plus a non-blocking internal note, so the AI packet still works.
async function findSimilarCases(snapshot: CaseSnapshot): Promise<SimilarCasesResult> {
  const notes: string[] = []
  const env = supabaseEnv()
  if (!env) {
    notes.push('Similar case retrieval skipped: Supabase is not configured in this environment.')
    return { cases: [], toolUsed: false, notes }
  }

  // Build the most relevant similarity filter from the fields we actually have.
  // complaint_type is the strongest similarity signal; assigned_department is a
  // secondary fallback. Over-constraining (requiring every field) tends to
  // return nothing, which is unhelpful context, so we match on one primary
  // field and exclude the case itself.
  const params = new URLSearchParams()
  params.set(
    'select',
    'source_record_id,complaint_type,assigned_department,status,ward_or_area,description',
  )
  params.set('prediction_type', 'eq.needs_attention')

  const matchedOn: string[] = []
  if (snapshot.complaint_type) {
    params.append('complaint_type', `eq.${snapshot.complaint_type}`)
    matchedOn.push('complaint_type')
  } else if (snapshot.assigned_department) {
    params.append('assigned_department', `eq.${snapshot.assigned_department}`)
    matchedOn.push('assigned_department')
  } else {
    notes.push('Similar case retrieval skipped: selected case has no complaint type or department to match on.')
    return { cases: [], toolUsed: false, notes }
  }

  // Narrow further by department/area when present, but tolerate empty results.
  if (snapshot.complaint_type && snapshot.assigned_department) {
    params.append('assigned_department', `eq.${snapshot.assigned_department}`)
    matchedOn.push('assigned_department')
  }
  if (snapshot.source_record_id) {
    params.append('source_record_id', `neq.${snapshot.source_record_id}`)
  }
  // Fetch a couple extra so trimming self / empties still leaves up to 3.
  params.set('limit', String(MAX_SIMILAR_CASES + 2))

  const requestUrl = `${env.url}/rest/v1/workflow_ml_predictions?${params.toString()}`

  let res: Response
  try {
    res = await fetch(requestUrl, {
      method: 'GET',
      headers: {
        apikey: env.anonKey,
        authorization: `Bearer ${env.anonKey}`,
        accept: 'application/json',
      },
    })
  } catch (err) {
    notes.push('Similar case retrieval failed (network); continued without similar case context.')
    console.error('findSimilarCases network error:', errorText(err))
    return { cases: [], toolUsed: true, notes }
  }

  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 500)
    } catch {
      /* ignore */
    }
    notes.push('Similar case retrieval returned an error; continued without similar case context.')
    console.error('findSimilarCases non-OK status:', res.status, detail)
    return { cases: [], toolUsed: true, notes }
  }

  let rows: unknown
  try {
    rows = await res.json()
  } catch (err) {
    notes.push('Similar case retrieval returned an unreadable response; continued without it.')
    console.error('findSimilarCases unreadable response:', errorText(err))
    return { cases: [], toolUsed: true, notes }
  }

  const list = Array.isArray(rows) ? rows : []
  const cases: SimilarCase[] = list
    .map((r) => {
      const row = (r ?? {}) as Record<string, unknown>
      const desc = strOrNull(row.description)
      return {
        complaint_type: strOrNull(row.complaint_type),
        assigned_department: strOrNull(row.assigned_department),
        status: strOrNull(row.status),
        ward_or_area: strOrNull(row.ward_or_area),
        description: desc ? desc.slice(0, SIMILAR_DESC_MAX_LEN) : null,
      }
    })
    .slice(0, MAX_SIMILAR_CASES)

  if (cases.length) {
    notes.push(`Retrieved ${cases.length} similar case(s) by ${matchedOn.join(' + ')} (context only, read only).`)
  } else {
    notes.push('No similar cases found; continued without similar case context.')
  }
  return { cases, toolUsed: true, notes }
}

function buildUserPrompt(input: PacketRequest, similarCases: SimilarCase[]): string {
  const { caseSnapshot: c, mlSignal: m, deterministic: d } = input
  const field = (label: string, value: string | number | null) =>
    `${label}: ${value === null || value === '' ? '(not provided)' : value}`

  const checklist = d.missingInformationChecklist.length
    ? d.missingInformationChecklist.map((c2) => `- ${c2.label}: ${c2.status || '(unknown)'}`).join('\n')
    : '- (none provided)'

  const rules = d.rulesFired.length ? d.rulesFired.map((r) => `- ${r}`).join('\n') : '- (none fired)'

  const ctx = input.operationalContext
  const patrolLines = ctx?.patrolLogs.length
    ? ctx.patrolLogs
        .map((l, i) =>
          [
            `- Patrol log ${i + 1}:`,
            `    patrol_date: ${l.patrol_date ?? '(not provided)'}`,
            `    officer_unit: ${l.officer_unit ?? '(not provided)'}`,
            `    patrol_type: ${l.patrol_type ?? '(not provided)'}`,
            `    observed_issue: ${l.observed_issue ?? '(not provided)'}`,
            `    observation_result: ${l.observation_result ?? '(not provided)'}`,
          ].join('\n'),
        )
        .join('\n')
    : '- (no linked patrol logs on file)'

  const ticketLines = ctx?.ticketRecords.length
    ? ctx.ticketRecords
        .map((t, i) =>
          [
            `- Ticket record ${i + 1}:`,
            `    ticket_date: ${t.ticket_date ?? '(not provided)'}`,
            `    enforcement_type: ${t.enforcement_type ?? '(not provided)'}`,
            `    violation_category: ${t.violation_category ?? '(not provided)'}`,
            `    outcome: ${t.outcome ?? '(not provided)'}`,
            `    status: ${t.status ?? '(not provided)'}`,
          ].join('\n'),
        )
        .join('\n')
    : '- (no linked ticket records on file)'

  const trend = ctx?.complaintTrend
  const trendLines = trend
    ? [
        `area: ${trend.area ?? '(not provided)'}`,
        `complaint_type: ${trend.complaint_type ?? '(not provided)'}`,
        `period: ${trend.period_start ?? '?'} to ${trend.period_end ?? '?'}`,
        `complaint_count: ${trend.complaint_count ?? '(not provided)'}`,
        `prior_period_count: ${trend.prior_period_count ?? '(not provided)'}`,
        `change_percent: ${trend.change_percent ?? '(not available)'}`,
        `repeat_location_count: ${trend.repeat_location_count ?? '(not provided)'}`,
        `trend_label: ${trend.trend_label ?? '(not provided)'}`,
      ].join('\n')
    : '(no matching trend row for this area and complaint type)'

  const template = ctx?.closureTemplate
  const templateLines = template
    ? [
        `matched_for_complaint_type: ${template.complaint_type ?? '(not provided)'}`,
        `scenario: ${template.scenario ?? '(not provided)'}`,
        `required_context: ${template.required_context.length ? template.required_context.join(', ') : '(none)'}`,
        `policy_note: ${template.policy_note ?? '(none)'}`,
        'template_text:',
        template.template_text ?? '(not provided)',
      ].join('\n')
    : '(no matching closure template — draft closure language only if status is completed or closed, using the standard rules above)'

  const readinessLines = ctx?.closureReadiness.length
    ? ctx.closureReadiness.map((c) => `- ${c.label}: ${c.status || '(unknown)'}`).join('\n')
    : '- (not provided)'

  const similar = similarCases.length
    ? similarCases
        .map((s, i) =>
          [
            `- Similar case ${i + 1}:`,
            `    complaint_type: ${s.complaint_type ?? '(not provided)'}`,
            `    assigned_department: ${s.assigned_department ?? '(not provided)'}`,
            `    status: ${s.status ?? '(not provided)'}`,
            `    ward_or_area: ${s.ward_or_area ?? '(not provided)'}`,
            `    short_description: ${s.description ?? '(not provided)'}`,
          ].join('\n'),
        )
        .join('\n')
    : '- (no similar cases retrieved — proceed using the selected case only)'

  return [
    'AGENT GOAL',
    AGENT_GOAL,
    '',
    'AGENT PLAN',
    ...AGENT_PLAN.map((step, i) => `${i + 1}. ${step}`),
    '',
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
    '',
    'RELATED PATROL LOGS (synthetic POC operational context linked to this benchmark case id)',
    patrolLines,
    '',
    'RELATED TICKET RECORDS (synthetic POC operational context linked to this benchmark case id)',
    ticketLines,
    '',
    'COMPLAINT TREND CONTEXT (generated from NYC 311 public benchmark data — area context only)',
    trendLines,
    '',
    `CLOSURE SCENARIO (deterministic): ${ctx?.closureScenario || '(not derived)'}`,
    '',
    'MATCHED CLOSURE TEMPLATE (base the closure language on this; adapt with the facts above)',
    templateLines,
    '',
    'CLOSURE READINESS CHECKLIST',
    readinessLines,
    '',
    'SIMILAR CASES (context only — same complaint area from the public benchmark set).',
    'These are NOT the selected case and imply no outcome, policy, or precedent for it.',
    similar,
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

// Transparent record of the agentic steps the backend took. Returned to the
// client and rendered as the compact "Agent workflow trace" so the agentic
// behavior (goal, plan, tool use, retrieved context) is visible to staff.
type AgentTrace = {
  goal: string
  plan: string[]
  toolsUsed: string[]
  similarCasesFound: number
  notes: string[]
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

  // Agentic step: run the one read-only backend tool to retrieve similar-case
  // context. This never throws and never blocks the packet — on any problem it
  // returns an empty list plus a non-blocking note.
  const similar = await findSimilarCases(input.caseSnapshot)
  const agentNotes = [...similar.notes]

  // Linked operational records (patrol logs, ticket records, trend, closure
  // template, readiness) were retrieved read-only by the authenticated case
  // workspace and arrive with the request. Record what the draft is grounded in.
  const ctx = input.operationalContext
  const contextTools: string[] = []
  if (ctx) {
    contextTools.push(
      'getPatrolLogsForCase (read only, via case workspace)',
      'getTicketRecordsForCase (read only, via case workspace)',
      'getComplaintTrendForCase (read only, via case workspace)',
      'getMatchingClosureTemplate (read only, via case workspace)',
    )
    agentNotes.push(
      `Grounded in ${ctx.patrolLogs.length} patrol log(s) and ${ctx.ticketRecords.length} ticket record(s) — synthetic POC operational context linked to the benchmark case id.`,
      ctx.complaintTrend
        ? `Complaint trend context: ${ctx.complaintTrend.trend_label ?? 'n/a'} for ${ctx.complaintTrend.complaint_type ?? 'this type'} in ${ctx.complaintTrend.area ?? 'the area'} (benchmark derived).`
        : 'No matching complaint trend row for this area and complaint type.',
      ctx.closureTemplate
        ? `Matched closure template: ${ctx.closureTemplate.scenario ?? 'unknown scenario'} (${ctx.closureTemplate.complaint_type ?? 'Any'}).`
        : 'No matching closure template; closure language follows the standard status rules.',
    )
  } else {
    agentNotes.push(
      'No linked operational records were supplied; the draft is grounded in the case snapshot and deterministic context only.',
    )
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
        messages: [{ role: 'user', content: buildUserPrompt(input, similar.cases) }],
      }),
    })
  } catch (err) {
    console.error('AI review packet request failed to reach Anthropic:', errorText(err))
    return json({ error: 'Could not reach the AI service. Try again.' }, 502)
  }

  if (!anthropicRes.ok) {
    // Read the upstream body safely for server-side diagnosis (e.g. an invalid
    // model id surfaces here). This is logged only — never returned to the
    // browser — and the API key and full prompt are never logged.
    let detail = ''
    try {
      detail = (await anthropicRes.text()).slice(0, 2000)
    } catch (err) {
      detail = `<unreadable response body: ${errorText(err)}>`
    }
    console.error(
      'Anthropic API returned a non-OK status:',
      anthropicRes.status,
      detail,
    )
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

  let result: PacketResult
  try {
    result = extractResult(text)
  } catch (err) {
    console.error('Failed to parse structured AI review packet JSON:', errorText(err))
    return json({ error: 'AI service did not return a structured review packet.' }, 502)
  }

  const agentTrace: AgentTrace = {
    goal: AGENT_GOAL,
    plan: AGENT_PLAN,
    toolsUsed: [...contextTools, ...(similar.toolUsed ? ['findSimilarCases (read only)'] : [])],
    similarCasesFound: similar.cases.length,
    notes: agentNotes,
  }

  return json({ model: MODEL, prompt_version: PROMPT_VERSION, ...result, agentTrace })
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
