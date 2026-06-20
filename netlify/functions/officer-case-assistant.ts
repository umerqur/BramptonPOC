// Server-side Netlify function backing the "Officer Case Assistant" — a
// case-scoped, grounded municipal enforcement assistant powered by Cohere
// Command. It helps a By-law Officer (and supervisor / CSR) understand the
// current case, prepare for a field review, identify missing information,
// explain workflow requirements, and summarize retrieved benchmark context.
//
// This is NOT a generic chatbot. It answers ONLY about the one case it is
// scoped to, using:
//   * the current case context fetched from public.resident_service_requests,
//   * the recent workflow timeline from public.workflow_events,
//   * (optionally) top benchmark references from the existing Cohere + Qdrant
//     similar-cases retrieval pipeline.
//
// GOVERNANCE
// ----------
// The assistant is decision support only. It never writes to Supabase and never
// approves, closes, assigns, tickets, or otherwise modifies a case. It must not
// recommend an enforcement decision (ticket / fine / warning / closure) as a
// decision, and it must not invent facts, bylaws, numbers, or records.
//
// SECURITY
// --------
// COHERE_API_KEY and the Supabase service role key are read from the Netlify
// environment and used ONLY inside this server-side function. They are never
// sent to the browser, never exposed through a VITE_* variable, and never
// logged. Do not create VITE_ copies of any of these.
//
// Identity is resolved server-side when possible: the caller's Supabase access
// token (Authorization: Bearer …) is exchanged for the authenticated user via
// GoTrue, and that email — not any client-passed role/email — is used with the
// existing staff role/profile logic to decide what the user may ask about:
//   * An officer may only ask about cases assigned to their own officer email.
//   * Supervisor / CSR may ask about cases in the work queue.
// If the server-side Supabase environment is not configured, the function falls
// back to a clearly-marked POC mode that still validates the case id, never
// writes, and answers from the limited case context the client supplies.

import { allowedRolesForEmail } from '../../src/lib/roles'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROMPT_VERSION = 'officer-case-assistant-v1'
const COHERE_CHAT_URL = 'https://api.cohere.com/v1/chat'

// Cap the officer's free-text question so the prompt stays predictable.
const MAX_QUESTION_LEN = 600

// How many recent workflow events and benchmark references we forward.
const MAX_TIMELINE_EVENTS = 12
const MAX_BENCHMARKS = 5

// Always-present limitation note. The model is asked to include it; we also
// enforce it server-side so the UI can never present an answer without it.
const REQUIRED_LIMITATION =
  'Decision support only. Staff remain responsible for enforcement decisions.'

// The canned refusal for out-of-scope questions, matching the guardrail spec.
const SCOPE_REFUSAL = 'I can only help with this enforcement case and workflow context.'

// Guardrail preamble (system prompt) for Cohere Command.
const PREAMBLE = [
  'You are a municipal by-law enforcement Case Assistant for authorized staff.',
  'You can only answer using the provided case context, workflow events, and retrieved benchmark references.',
  'You are decision support only. You do not make enforcement decisions.',
  'You must not say that a ticket, fine, warning, or closure should be issued, approved, or sent.',
  'You must not update records or imply that any action was taken — you cannot take actions.',
  'You must not invent facts, numbers, policies, bylaws, statutes, or database records.',
  'If information is missing, say it is not available in the provided case file.',
  'You may explain workflow options and requirements, but never recommend an enforcement action as a decision.',
  `If the question is unrelated to this case or its workflow, respond with exactly: "${SCOPE_REFUSAL}"`,
  'Do not answer general chat, politics, personal opinions, internet searches, or requests for personal data not already in the case context.',
  '',
  'Return ONLY a single JSON object (no markdown, no code fences, no commentary) with exactly these fields:',
  '- answer: string — a concise, plain-language answer grounded only in the provided context.',
  '- used_context: string[] — short labels for the context you actually relied on (e.g. "case details", "workflow timeline", "benchmark references").',
  '- officer_checklist: string[] — concrete things to verify or do on site / before closure review, or [] if not applicable.',
  '- missing_information: string[] — important information not present in the case file, or [] if nothing is clearly missing.',
  '- benchmark_notes: string[] — neutral observations about the retrieved benchmark references, or [] if none were provided.',
  `- limitations: string — must include: "${REQUIRED_LIMITATION}"`,
].join('\n')

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

function strOrNull(value: unknown): string | null {
  const s = asString(value).trim()
  return s ? s : null
}

function strArray(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(asString)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, limit)
}

function normalizeEmail(value: unknown): string {
  return asString(value).trim().toLowerCase()
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Only the operational fields the assistant is allowed to reason over. No
// resident contact details (name beyond officer, email, phone) are forwarded.
type CaseContext = {
  case_id: string | null
  issue_type: string | null
  description: string | null
  location: string | null
  status: string | null
  priority: string | null
  submitted_at: string | null
  assigned_officer_name: string | null
  assigned_officer_email: string | null
  field_visit_completed: boolean | null
  field_violation_observed: string | null
  field_enforcement_action: string | null
  field_observed_condition: string | null
  field_action_taken: string | null
  field_officer_notes: string | null
  field_follow_up_required: boolean | null
  closure_status: string | null
}

type TimelineEvent = {
  event_label: string | null
  actor_type: string | null
  created_at: string | null
  notes: string | null
}

type BenchmarkRef = {
  complaint_type: string | null
  request_detail: string | null
  resolution_description: string | null
  closure_days: number | null
  rerank_score: number | null
}

type AssistantResult = {
  answer: string
  used_context: string[]
  officer_checklist: string[]
  missing_information: string[]
  benchmark_notes: string[]
  limitations: string
}

// ---------------------------------------------------------------------------
// Supabase (server-side, raw REST — no SDK dependency, matching sibling fns)
// ---------------------------------------------------------------------------

type ServerCase = {
  context: CaseContext
  timeline: TimelineEvent[]
  /** Lowercased assigned officer email, for the access check. */
  assignedOfficerEmail: string
  /** Text used to drive benchmark retrieval. */
  retrievalText: string
}

/** Resolve the authenticated user's email from a Supabase access token. */
async function resolveAuthedEmail(
  supabaseUrl: string,
  anonOrServiceKey: string,
  token: string,
): Promise<string | null> {
  const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
    headers: {
      apikey: anonOrServiceKey,
      authorization: `Bearer ${token}`,
    },
  })
  if (!res.ok) return null
  const user = (await res.json()) as { email?: string }
  return normalizeEmail(user.email) || null
}

const CASE_SELECT = [
  'case_id',
  'request_type',
  'description',
  'location',
  'city',
  'province',
  'status',
  'created_at',
  'assigned_officer_name',
  'assigned_officer_email',
  'field_visit_completed',
  'field_violation_observed',
  'field_enforcement_action',
  'field_observed_condition',
  'field_action_taken',
  'field_officer_notes',
  'field_follow_up_required',
].join(',')

/** Fetch the case row + recent workflow timeline using the service role key. */
async function fetchServerCase(
  supabaseUrl: string,
  serviceKey: string,
  caseId: string,
): Promise<ServerCase | null> {
  const base = supabaseUrl.replace(/\/$/, '')
  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` }

  const caseRes = await fetch(
    `${base}/rest/v1/resident_service_requests?case_id=eq.${encodeURIComponent(caseId)}&select=${encodeURIComponent(
      CASE_SELECT,
    )}&limit=1`,
    { headers },
  )
  if (!caseRes.ok) throw new Error(`Supabase case read failed (status ${caseRes.status}).`)
  const rows = (await caseRes.json()) as Record<string, unknown>[]
  const row = rows[0]
  if (!row) return null

  const location = [row.location, row.city, row.province]
    .map((v) => asString(v).trim())
    .filter(Boolean)
    .join(', ')

  const context: CaseContext = {
    case_id: strOrNull(row.case_id),
    issue_type: strOrNull(row.request_type),
    description: strOrNull(row.description),
    location: location || null,
    status: strOrNull(row.status),
    // resident_service_requests has no dedicated priority column; left null.
    priority: null,
    submitted_at: strOrNull(row.created_at),
    assigned_officer_name: strOrNull(row.assigned_officer_name),
    assigned_officer_email: strOrNull(row.assigned_officer_email),
    field_visit_completed: typeof row.field_visit_completed === 'boolean' ? row.field_visit_completed : null,
    field_violation_observed: strOrNull(row.field_violation_observed),
    field_enforcement_action: strOrNull(row.field_enforcement_action),
    field_observed_condition: strOrNull(row.field_observed_condition),
    field_action_taken: strOrNull(row.field_action_taken),
    field_officer_notes: strOrNull(row.field_officer_notes),
    field_follow_up_required:
      typeof row.field_follow_up_required === 'boolean' ? row.field_follow_up_required : null,
    closure_status: row.status === 'closed' ? 'closed' : row.status === 'in_review' ? 'ready_for_closure_review' : null,
  }

  // Recent workflow timeline (best-effort: never block the answer on it).
  let timeline: TimelineEvent[] = []
  try {
    const evRes = await fetch(
      `${base}/rest/v1/workflow_events?case_id=eq.${encodeURIComponent(
        caseId,
      )}&select=event_label,actor_type,created_at,notes&order=created_at.desc&limit=${MAX_TIMELINE_EVENTS}`,
      { headers },
    )
    if (evRes.ok) {
      const events = (await evRes.json()) as Record<string, unknown>[]
      timeline = events.map((e) => ({
        event_label: strOrNull(e.event_label),
        actor_type: strOrNull(e.actor_type),
        created_at: strOrNull(e.created_at),
        notes: strOrNull(e.notes),
      }))
    }
  } catch (err) {
    console.error('officer-case-assistant: workflow_events read failed:', errorText(err))
  }

  const retrievalText = [context.issue_type, context.description, context.location]
    .filter(Boolean)
    .join('\n')

  return {
    context,
    timeline,
    assignedOfficerEmail: normalizeEmail(context.assigned_officer_email),
    retrievalText,
  }
}

// ---------------------------------------------------------------------------
// Benchmark retrieval — reuse the existing similar-cases pipeline (best-effort)
// ---------------------------------------------------------------------------

async function fetchBenchmarks(caseId: string | null, text: string): Promise<BenchmarkRef[]> {
  const siteBase = process.env.URL || process.env.DEPLOY_PRIME_URL
  // Only worth calling when the retrieval pipeline is wired up in this env.
  if (!siteBase || !process.env.QDRANT_URL || !process.env.COHERE_API_KEY || !text.trim()) {
    return []
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(`${siteBase.replace(/\/$/, '')}/.netlify/functions/similar-cases`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caseId, text, topK: MAX_BENCHMARKS }),
      signal: controller.signal,
    })
    if (!res.ok) return []
    const data = (await res.json()) as {
      results?: Array<Record<string, unknown>>
    }
    return (data.results ?? []).slice(0, MAX_BENCHMARKS).map((r) => ({
      complaint_type: strOrNull(r.complaint_type),
      request_detail: strOrNull(r.request_detail),
      resolution_description: strOrNull(r.resolution_description),
      closure_days: typeof r.closure_days === 'number' ? r.closure_days : null,
      rerank_score: typeof r.rerank_score === 'number' ? r.rerank_score : null,
    }))
  } catch (err) {
    // Qdrant rebuilding / unavailable: degrade gracefully to no benchmarks.
    console.error('officer-case-assistant: benchmark retrieval skipped:', errorText(err))
    return []
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Prompt building + response parsing
// ---------------------------------------------------------------------------

function buildMessage(args: {
  context: CaseContext
  timeline: TimelineEvent[]
  benchmarks: BenchmarkRef[]
  question: string
}): string {
  const { context: c, timeline, benchmarks, question } = args
  const field = (label: string, value: string | number | boolean | null) =>
    `${label}: ${value === null || value === '' ? '(not available in case file)' : String(value)}`

  const timelineLines = timeline.length
    ? timeline.map((e) => `- [${e.created_at ?? '—'}] ${e.event_label ?? 'event'} (${e.actor_type ?? 'staff'})${e.notes ? ` — ${e.notes}` : ''}`)
    : ['- (no workflow events available)']

  const benchmarkLines = benchmarks.length
    ? benchmarks.map((b, i) =>
        `${i + 1}. ${b.complaint_type ?? 'benchmark case'}${b.request_detail ? ` — ${b.request_detail}` : ''}` +
        `${b.resolution_description ? ` | resolution: ${b.resolution_description}` : ''}` +
        `${b.closure_days != null ? ` | closure_days: ${b.closure_days}` : ''}`,
      )
    : ['(no benchmark references retrieved — answer from the current case context only)']

  return [
    'Answer the staff question about THIS ONE case, using only the context below.',
    '',
    'CURRENT CASE CONTEXT',
    field('case_id', c.case_id),
    field('issue_type', c.issue_type),
    field('description', c.description),
    field('location', c.location),
    field('status', c.status),
    field('priority', c.priority),
    field('submitted_at', c.submitted_at),
    field('assigned_officer', c.assigned_officer_name),
    field('field_visit_completed', c.field_visit_completed),
    field('field_violation_observed', c.field_violation_observed),
    field('field_enforcement_action', c.field_enforcement_action),
    field('field_observed_condition', c.field_observed_condition),
    field('field_action_taken', c.field_action_taken),
    field('field_officer_notes', c.field_officer_notes),
    field('field_follow_up_required', c.field_follow_up_required),
    field('closure_status', c.closure_status),
    '',
    'RECENT WORKFLOW TIMELINE (most recent first)',
    ...timelineLines,
    '',
    'BENCHMARK REFERENCES (similar closed cases, for reference only — not this case)',
    ...benchmarkLines,
    '',
    'STAFF QUESTION',
    question,
  ].join('\n')
}

// Pull the JSON object out of the model text, tolerating a stray code fence.
function parseResult(text: string): AssistantResult {
  let candidate = text.trim()
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fence) candidate = fence[1].trim()
  if (!candidate.startsWith('{')) {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) candidate = candidate.slice(start, end + 1)
  }
  const parsed = JSON.parse(candidate) as Record<string, unknown>

  const answer = asString(parsed.answer).trim()
  let limitations = asString(parsed.limitations).trim()
  if (!limitations.includes(REQUIRED_LIMITATION)) {
    limitations = limitations ? `${limitations} ${REQUIRED_LIMITATION}` : REQUIRED_LIMITATION
  }

  return {
    answer,
    used_context: strArray(parsed.used_context),
    officer_checklist: strArray(parsed.officer_checklist),
    missing_information: strArray(parsed.missing_information),
    benchmark_notes: strArray(parsed.benchmark_notes),
    limitations,
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed. Use POST.' }, 405)
  }

  const cohereKey = process.env.COHERE_API_KEY
  const commandModel = process.env.COHERE_COMMAND_MODEL || process.env.COHERE_CHAT_MODEL
  // Calm 503 when the assistant is not wired up in this environment.
  if (!cohereKey || !commandModel) {
    return json({ error: 'Officer Case Assistant is not configured.' }, 503)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400)
  }

  const input = (body ?? {}) as Record<string, unknown>
  const caseId = asString(input.caseId || input.case_id).trim()
  const question = asString(input.question).trim().slice(0, MAX_QUESTION_LEN)

  if (!caseId) return json({ error: 'A caseId is required.' }, 400)
  if (!question) return json({ error: 'A question about the case is required.' }, 400)

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  let context: CaseContext
  let timeline: TimelineEvent[] = []
  let retrievalText = ''
  let pocOnly = false

  if (supabaseUrl && serviceKey) {
    // ---- Server-verified path -------------------------------------------
    const authHeader = req.headers.get('authorization') || ''
    const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''
    if (!token) {
      return json({ error: 'Sign in to use the Officer Case Assistant.' }, 401)
    }

    let authedEmail: string | null
    try {
      authedEmail = await resolveAuthedEmail(supabaseUrl, serviceKey, token)
    } catch (err) {
      console.error('officer-case-assistant: auth resolution failed:', errorText(err))
      return json({ error: 'Could not verify your session. Please sign in again.' }, 401)
    }
    if (!authedEmail) {
      return json({ error: 'Could not verify your session. Please sign in again.' }, 401)
    }

    let serverCase: ServerCase | null
    try {
      serverCase = await fetchServerCase(supabaseUrl, serviceKey, caseId)
    } catch (err) {
      console.error('officer-case-assistant: case read failed:', errorText(err))
      return json({ error: 'Could not load this case.' }, 502)
    }
    if (!serverCase) {
      return json({ error: 'This case could not be found.' }, 404)
    }

    // Access control: an officer may only ask about a case assigned to their own
    // email; supervisor / CSR may ask about any work-queue case. Role comes from
    // the existing staff profile logic, keyed on the server-resolved email.
    const roles = allowedRolesForEmail(authedEmail)
    const isAssignedOfficer =
      serverCase.assignedOfficerEmail !== '' && serverCase.assignedOfficerEmail === authedEmail
    const canQueue = roles.includes('supervisor') || roles.includes('csr')
    if (!isAssignedOfficer && !canQueue) {
      return json({ error: 'This case is not assigned to you.' }, 403)
    }

    context = serverCase.context
    timeline = serverCase.timeline
    retrievalText = serverCase.retrievalText
  } else {
    // ---- POC fallback path ----------------------------------------------
    // Server-side Supabase is not configured. We cannot verify identity here, so
    // this pass is clearly marked POC-only. We still validate the case id, never
    // write anything, and answer from the limited context the client supplies.
    pocOnly = true
    const clientCtx = (input.caseContext ?? {}) as Record<string, unknown>
    context = {
      case_id: caseId,
      issue_type: strOrNull(clientCtx.issue_type ?? clientCtx.complaintType),
      description: strOrNull(clientCtx.description),
      location: strOrNull(clientCtx.location),
      status: strOrNull(clientCtx.status),
      priority: strOrNull(clientCtx.priority),
      submitted_at: strOrNull(clientCtx.submitted_at),
      assigned_officer_name: strOrNull(clientCtx.assigned_officer_name ?? clientCtx.assignedOfficer),
      assigned_officer_email: null,
      field_visit_completed: null,
      field_violation_observed: strOrNull(clientCtx.field_violation_observed),
      field_enforcement_action: strOrNull(clientCtx.field_enforcement_action),
      field_observed_condition: strOrNull(clientCtx.field_observed_condition),
      field_action_taken: strOrNull(clientCtx.field_action_taken),
      field_officer_notes: strOrNull(clientCtx.field_officer_notes),
      field_follow_up_required: null,
      closure_status: null,
    }
    retrievalText = [context.issue_type, context.description, context.location].filter(Boolean).join('\n')
  }

  // Optional benchmark references (best-effort; degrades to none).
  const benchmarks = await fetchBenchmarks(caseId, retrievalText)

  // Call Cohere Command.
  let cohereRes: Response
  try {
    cohereRes = await fetch(COHERE_CHAT_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cohereKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: commandModel,
        preamble: PREAMBLE,
        message: buildMessage({ context, timeline, benchmarks, question }),
        temperature: 0.2,
        max_tokens: 900,
      }),
    })
  } catch (err) {
    console.error('officer-case-assistant: Cohere request failed:', errorText(err))
    return json({ error: 'Could not reach the assistant service. Try again.' }, 502)
  }

  if (!cohereRes.ok) {
    console.error('officer-case-assistant: Cohere returned non-OK status:', cohereRes.status)
    return json({ error: 'Assistant service error. Please try again.' }, 502)
  }

  let text: string
  try {
    const data = (await cohereRes.json()) as { text?: string }
    text = asString(data.text).trim()
  } catch (err) {
    console.error('officer-case-assistant: unreadable Cohere response:', errorText(err))
    return json({ error: 'Assistant service returned an unreadable response.' }, 502)
  }

  let result: AssistantResult
  try {
    result = parseResult(text)
  } catch (err) {
    console.error('officer-case-assistant: failed to parse assistant JSON:', errorText(err))
    return json({ error: 'Assistant service did not return a structured answer.' }, 502)
  }
  if (!result.answer) {
    return json({ error: 'Assistant service returned an empty answer.' }, 502)
  }

  // Audit: intentionally NOT persisted. The assistant never writes to Supabase,
  // and we do not store free-text prompts in this POC.
  return json({
    model: commandModel,
    prompt_version: PROMPT_VERSION,
    poc_only: pocOnly,
    benchmarks_used: benchmarks.length,
    result,
  })
}
