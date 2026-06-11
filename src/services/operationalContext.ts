import { supabase, isSupabaseConfigured } from '../lib/supabase'

// Linked operational POC records for the Closure Review Workbench (migration
// 009/010): patrol logs, ticket records, complaint trends, closure templates.
//
// POSITIONING: complaint_trends is generated from the Toronto 311 public
// benchmark complaints. patrol_logs, ticket_records, and closure_templates are
// SYNTHETIC POC operational context linked to real benchmark complaint
// case_ids — clearly labelled, never Brampton operational data. Everything
// here is read-only decision support: no enforcement decision, no automatic
// closure, no resident contact.

export const PATROL_LOGS_TABLE = 'patrol_logs'
export const TICKET_RECORDS_TABLE = 'ticket_records'
export const COMPLAINT_TRENDS_TABLE = 'complaint_trends'
export const CLOSURE_TEMPLATES_TABLE = 'closure_templates'

/** Label shown wherever synthetic linked records are rendered. */
export const SYNTHETIC_CONTEXT_LABEL =
  'Synthetic POC operational context linked to real benchmark complaint case ids — not Brampton operational data.'

/** Label for the benchmark-derived trend aggregates. */
export const TREND_CONTEXT_LABEL =
  'Generated from Toronto 311 public benchmark complaint data — not Brampton operational data.'

export type PatrolLog = {
  id: string
  case_id: string
  patrol_date: string | null
  officer_unit: string | null
  patrol_type: string | null
  area: string | null
  location: string | null
  observed_issue: string | null
  observation_result: string | null
  notes: string | null
  created_at: string | null
}

export type TicketRecord = {
  id: string
  case_id: string
  ticket_number: string | null
  ticket_date: string | null
  enforcement_type: string | null
  violation_category: string | null
  outcome: string | null
  fine_amount: number | null
  status: string | null
  notes: string | null
  created_at: string | null
}

export type ComplaintTrend = {
  id: string
  area: string | null
  complaint_type: string | null
  period_start: string | null
  period_end: string | null
  complaint_count: number
  prior_period_count: number
  change_percent: number | null
  repeat_location_count: number
  trend_label: string | null
  created_at: string | null
}

export type ClosureTemplate = {
  id: string
  complaint_type: string
  scenario: string
  template_text: string
  required_context: string[]
  policy_note: string | null
  active: boolean
  created_at: string | null
}

/** Deterministic closure scenario derived from the case + linked records. */
export type ClosureScenario =
  | 'resolved'
  | 'no_violation_found'
  | 'enforcement_issued'
  | 'referred'
  | 'insufficient_information'
  | 'in_progress_update'

export const SCENARIO_LABELS: Record<ClosureScenario, string> = {
  resolved: 'Resolved',
  no_violation_found: 'No violation found',
  enforcement_issued: 'Enforcement issued',
  referred: 'Referred',
  insufficient_information: 'Insufficient information',
  in_progress_update: 'In progress update',
}

export type ClosureReadinessItem = {
  label: string
  ok: boolean
  detail: string
}

/** Everything the case workspace (and AI packet) needs about one case. */
export type CaseOperationalContext = {
  patrolLogs: PatrolLog[]
  ticketRecords: TicketRecord[]
  trend: ComplaintTrend | null
  scenario: ClosureScenario
  template: ClosureTemplate | null
  readiness: ClosureReadinessItem[]
}

function requireClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured')
  }
  return supabase
}

/** Synthetic POC patrol logs linked to one benchmark complaint case_id. */
export async function getPatrolLogsForCase(caseId: string): Promise<PatrolLog[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(PATROL_LOGS_TABLE)
    .select('*')
    .eq('case_id', caseId)
    .order('patrol_date', { ascending: true, nullsFirst: false })

  if (error) throw error
  return (data ?? []) as PatrolLog[]
}

/** Synthetic POC ticket records linked to one benchmark complaint case_id. */
export async function getTicketRecordsForCase(caseId: string): Promise<TicketRecord[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(TICKET_RECORDS_TABLE)
    .select('*')
    .eq('case_id', caseId)
    .order('ticket_date', { ascending: true, nullsFirst: false })

  if (error) throw error
  return (data ?? []) as TicketRecord[]
}

/**
 * Benchmark-derived trend row for the case's area + complaint type. Falls back
 * to the highest-volume trend row for the complaint type alone when there is
 * no exact area match, so staff still see a type-level signal.
 */
export async function getComplaintTrendForCase(
  area: string | null,
  complaintType: string | null,
): Promise<ComplaintTrend | null> {
  if (!complaintType) return null
  const client = requireClient()

  if (area) {
    const { data, error } = await client
      .from(COMPLAINT_TRENDS_TABLE)
      .select('*')
      .eq('area', area)
      .eq('complaint_type', complaintType)
      .limit(1)
      .maybeSingle()
    if (error) throw error
    if (data) return data as ComplaintTrend
  }

  const { data, error } = await client
    .from(COMPLAINT_TRENDS_TABLE)
    .select('*')
    .eq('complaint_type', complaintType)
    .order('complaint_count', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as ComplaintTrend) ?? null
}

/**
 * The active closure template matching the scenario, preferring an exact
 * complaint-type template over the generic 'Any' fallback.
 */
export async function getMatchingClosureTemplate(
  complaintType: string | null,
  scenario: ClosureScenario,
): Promise<ClosureTemplate | null> {
  const client = requireClient()
  const types = complaintType ? [complaintType, 'Any'] : ['Any']
  const { data, error } = await client
    .from(CLOSURE_TEMPLATES_TABLE)
    .select('*')
    .eq('active', true)
    .eq('scenario', scenario)
    .in('complaint_type', types)

  if (error) throw error
  const rows = (data ?? []) as ClosureTemplate[]
  if (!rows.length) return null
  return rows.find((t) => t.complaint_type !== 'Any') ?? rows[0]
}

function isClosedStatus(status: string | null): boolean {
  const s = (status ?? '').toLowerCase()
  return s.includes('complete') || s.includes('closed')
}

/**
 * Deterministic closure scenario from the case status, description, and the
 * linked synthetic records. Rules only — no model call.
 */
export function deriveClosureScenario(input: {
  status: string | null
  description: string | null
  patrolLogs: PatrolLog[]
  ticketRecords: TicketRecord[]
}): ClosureScenario {
  const { status, description, patrolLogs, ticketRecords } = input
  const closed = isClosedStatus(status)
  const ticketIssued = ticketRecords.some((t) => (t.outcome ?? '').toLowerCase().includes('ticket issued'))
  const noViolation = patrolLogs.some((l) => (l.observation_result ?? '').toLowerCase().includes('no issue'))
  const resolvedOnSite = patrolLogs.some((l) => (l.observation_result ?? '').toLowerCase().includes('resolved'))

  if (ticketIssued) return 'enforcement_issued'
  if ((description ?? '').trim().length < 25 && patrolLogs.length === 0) return 'insufficient_information'
  if (resolvedOnSite) return 'resolved'
  if (closed && noViolation) return 'no_violation_found'
  if (closed) return 'resolved'
  return 'in_progress_update'
}

/**
 * Closure readiness checklist over the complaint + linked records. Deterministic
 * and advisory: it tells staff what is on file, it never closes anything.
 */
export function buildClosureReadiness(input: {
  description: string | null
  area: string | null
  status: string | null
  patrolLogs: PatrolLog[]
  ticketRecords: TicketRecord[]
  trend: ComplaintTrend | null
  template: ClosureTemplate | null
}): ClosureReadinessItem[] {
  const { description, area, status, patrolLogs, ticketRecords, trend, template } = input
  const hasObservation = patrolLogs.some((l) => (l.observation_result ?? '').trim())
  const noViolation = patrolLogs.some((l) => (l.observation_result ?? '').toLowerCase().includes('no issue'))
  const resolvedOnSite = patrolLogs.some((l) => (l.observation_result ?? '').toLowerCase().includes('resolved'))
  const hasOutcome = ticketRecords.length > 0 || noViolation || resolvedOnSite

  return [
    {
      label: 'Complaint details on file',
      ok: Boolean((description ?? '').trim()),
      detail: (description ?? '').trim() ? 'Description recorded on the complaint.' : 'Description missing or empty.',
    },
    {
      label: 'Area or location recorded',
      ok: Boolean((area ?? '').trim()),
      detail: (area ?? '').trim() ? 'Service area is recorded.' : 'No area recorded on the complaint.',
    },
    {
      label: 'Patrol log on file',
      ok: patrolLogs.length > 0,
      detail: patrolLogs.length
        ? `${patrolLogs.length} linked patrol log${patrolLogs.length === 1 ? '' : 's'} (synthetic POC records).`
        : 'No linked patrol log found.',
    },
    {
      label: 'Patrol observation recorded',
      ok: hasObservation,
      detail: hasObservation ? 'Latest patrol records an observation result.' : 'No observation result on file.',
    },
    {
      label: 'Enforcement outcome recorded',
      ok: hasOutcome,
      detail: ticketRecords.length
        ? `${ticketRecords.length} linked ticket record${ticketRecords.length === 1 ? '' : 's'} (synthetic POC records).`
        : hasOutcome
          ? 'Patrol observation indicates resolution or no violation.'
          : 'No ticket record or conclusive patrol observation on file.',
    },
    {
      label: 'Complaint trend context available',
      ok: trend != null,
      detail: trend
        ? `Trend for ${trend.complaint_type ?? 'this type'} in ${trend.area ?? 'the area'}: ${trend.trend_label ?? 'n/a'}.`
        : 'No benchmark trend row matched this area and complaint type.',
    },
    {
      label: 'Closure template matched',
      ok: template != null,
      detail: template
        ? `Matched "${SCENARIO_LABELS[template.scenario as ClosureScenario] ?? template.scenario}" template (${template.complaint_type}).`
        : 'No active closure template matched the derived scenario.',
    },
    {
      label: 'Status supports closure',
      ok: isClosedStatus(status),
      detail: isClosedStatus(status)
        ? 'Source status is completed or closed.'
        : 'Source status is still open — closure language should wait for staff confirmation.',
    },
  ]
}

/**
 * Load everything the Case File Workspace needs for one selected case: the
 * linked patrol logs and ticket records (synthetic POC), the benchmark-derived
 * complaint trend, the deterministic closure scenario, the matched closure
 * template, and the closure readiness checklist. Read-only throughout.
 */
export async function getCaseOperationalContext(input: {
  caseId: string | null
  area: string | null
  complaintType: string | null
  status: string | null
  description: string | null
}): Promise<CaseOperationalContext> {
  const { caseId, area, complaintType, status, description } = input

  const [patrolLogs, ticketRecords, trend] = await Promise.all([
    caseId ? getPatrolLogsForCase(caseId) : Promise.resolve([] as PatrolLog[]),
    caseId ? getTicketRecordsForCase(caseId) : Promise.resolve([] as TicketRecord[]),
    getComplaintTrendForCase(area, complaintType),
  ])

  const scenario = deriveClosureScenario({ status, description, patrolLogs, ticketRecords })
  const template = await getMatchingClosureTemplate(complaintType, scenario)
  const readiness = buildClosureReadiness({
    description,
    area,
    status,
    patrolLogs,
    ticketRecords,
    trend,
    template,
  })

  return { patrolLogs, ticketRecords, trend, scenario, template, readiness }
}
