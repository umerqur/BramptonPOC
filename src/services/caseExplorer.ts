import { supabase, isSupabaseConfigured } from '../lib/supabase'

// Case Explorer + Open review queue readers for Insights.
//
// Case Explorer is a paginated, filtered window over the historical NYC 311
// public service requests in public.municipal_complaints — it NEVER loads all
// rows (every query is filtered + range-paginated with an exact count). The Open
// review queue reads a separate, prioritized open-cases view
// (public.v_nyc_open_review_queue) when that dataset has been loaded; until then
// the reader surfaces a clear "not loaded" state rather than inventing data.

function requireClient() {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured')
  return supabase
}

const COMPLAINTS_TABLE = 'municipal_complaints'

// ---------------------------------------------------------------------------
// Case Explorer
// ---------------------------------------------------------------------------

export type CaseExplorerFilters = {
  /** Free text: case id, complaint type, address, dataset id. */
  search?: string
  complaintType?: string
  borough?: string
  councilDistrict?: string
  agency?: string
  status?: string
  /** Inclusive submitted-date range, YYYY-MM-DD. */
  dateFrom?: string
  dateTo?: string
}

export type NycCaseRow = {
  case_id: string
  source_dataset_id: string | null
  submitted_at: string | null
  closed_at: string | null
  status: string | null
  complaint_type: string | null
  request_detail: string | null
  request_detail_2: string | null
  agency: string | null
  agency_name: string | null
  assigned_department: string | null
  borough: string | null
  council_district: string | null
  address_or_location: string | null
  ward_or_area: string | null
  resolution_description: string | null
}

const EXPLORER_COLUMNS =
  'case_id, source_dataset_id, submitted_at, closed_at, status, complaint_type, request_detail, request_detail_2, agency, agency_name, assigned_department, borough, council_district, address_or_location, ward_or_area, resolution_description'

export type CaseExplorerPage = { rows: NycCaseRow[]; total: number }

/** Closure duration in whole days, or null when the case is not closed cleanly. */
export function closureDurationDays(row: { submitted_at: string | null; closed_at: string | null }): number | null {
  if (!row.submitted_at || !row.closed_at) return null
  const start = new Date(row.submitted_at).getTime()
  const end = new Date(row.closed_at).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return Math.round((end - start) / 86_400_000)
}

/**
 * One filtered, paginated page of NYC 311 cases. `page` is zero-based. Returns
 * the rows and the exact total matching the filters (for pagination).
 */
export async function getNycCaseExplorerPage(
  filters: CaseExplorerFilters,
  page = 0,
  pageSize = 25,
): Promise<CaseExplorerPage> {
  const client = requireClient()
  let query = client
    .from(COMPLAINTS_TABLE)
    .select(EXPLORER_COLUMNS, { count: 'exact' })
    .eq('source_city', 'NYC')

  const term = filters.search?.trim().replace(/[,()*%]/g, ' ').trim()
  if (term) {
    query = query.or(
      [
        `case_id.ilike.%${term}%`,
        `source_dataset_id.ilike.%${term}%`,
        `complaint_type.ilike.%${term}%`,
        `address_or_location.ilike.%${term}%`,
        `request_detail.ilike.%${term}%`,
      ].join(','),
    )
  }
  if (filters.complaintType) query = query.eq('complaint_type', filters.complaintType)
  // Case-insensitive exact match so a borough label from the map ("Brooklyn")
  // matches stored values ("BROOKLYN").
  if (filters.borough) query = query.ilike('borough', filters.borough)
  if (filters.councilDistrict) {
    const plain = String(Number(filters.councilDistrict))
    const padded = plain.padStart(2, '0')
    query = query.in('council_district', Array.from(new Set([plain, padded, filters.councilDistrict])))
  }
  if (filters.agency) {
    query = query.or(
      [
        `assigned_department.eq.${filters.agency}`,
        `agency_name.eq.${filters.agency}`,
        `agency.eq.${filters.agency}`,
      ].join(','),
    )
  }
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.dateFrom) query = query.gte('submitted_at', filters.dateFrom)
  if (filters.dateTo) query = query.lte('submitted_at', `${filters.dateTo}T23:59:59`)

  const from = page * pageSize
  const { data, error, count } = await query
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .range(from, from + pageSize - 1)

  if (error) throw error
  const rows = (data ?? []) as NycCaseRow[]
  return { rows, total: count ?? rows.length }
}

/** Full detail for one case (all columns), or null if not found. */
export async function getNycCaseDetail(caseId: string): Promise<NycCaseRow | null> {
  const client = requireClient()
  const { data, error } = await client.from(COMPLAINTS_TABLE).select('*').eq('case_id', caseId).maybeSingle()
  if (error) throw error
  return (data as NycCaseRow) ?? null
}

// ---------------------------------------------------------------------------
// Filter options — sourced from the small Insights aggregate views (fast), not
// distinct scans over the full table.
// ---------------------------------------------------------------------------

export type CaseExplorerOptions = {
  complaintTypes: string[]
  boroughs: string[]
  councilDistricts: string[]
  agencies: string[]
  statuses: string[]
}

async function pluck(view: string, column: string, limit = 60): Promise<string[]> {
  const client = requireClient()
  const { data, error } = await client.from(view).select(column).limit(limit)
  if (error) throw error
  return ((data ?? []) as unknown as Record<string, unknown>[])
    .map((r) => (r[column] == null ? '' : String(r[column])))
    .filter((s) => s.length > 0)
}

export async function getCaseExplorerOptions(): Promise<CaseExplorerOptions> {
  const [complaintTypes, boroughs, councilDistricts, agencies, statuses] = await Promise.all([
    pluck('v_insights_complaint_type_volume', 'complaint_type'),
    pluck('v_nyc_service_request_workload', 'area'),
    pluck('v_nyc_council_district_workload', 'area'),
    pluck('v_insights_department_workload', 'department'),
    pluck('v_insights_status_mix', 'status'),
  ])
  const districts = Array.from(new Set(councilDistricts.map((d) => String(Number(d))).filter((d) => d !== 'NaN'))).sort(
    (a, b) => Number(a) - Number(b),
  )
  return { complaintTypes, boroughs, councilDistricts: districts, agencies, statuses }
}

// ---------------------------------------------------------------------------
// Open NYC review queue (loaded separately as open cases). Reads
// public.v_nyc_open_review_queue when present; otherwise the caller shows a
// clear "not loaded yet" state.
// ---------------------------------------------------------------------------

export type OpenReviewRow = {
  case_id: string
  complaint_type: string | null
  borough: string | null
  council_district: string | null
  status: string | null
  priority_score: number | null
  priority_tier: string | null
  priority_reason: string | null
  age_days: number | null
  due_date: string | null
  submitted_at: string | null
  address_or_location: string | null
}

const numOrNull = (v: unknown): number | null => {
  if (v == null) return null
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return Number.isFinite(n) ? n : null
}

/**
 * Top open NYC cases by review priority, from public.v_nyc_open_review_queue.
 * Field names are read defensively so this works with reasonable variations of
 * the view. Throws if the view does not exist yet so the UI can show a clear
 * "open cases not loaded" notice (no fake data).
 */
export async function getNycOpenReviewQueue(limit = 100): Promise<OpenReviewRow[]> {
  const client = requireClient()
  const { data, error } = await client.from('v_nyc_open_review_queue').select('*').limit(limit)
  if (error) throw error
  const rows = (data ?? []) as Record<string, unknown>[]
  const pick = (r: Record<string, unknown>, keys: string[]): unknown => {
    for (const k of keys) if (r[k] != null) return r[k]
    return null
  }
  return rows
    .map((r) => ({
      case_id: String(pick(r, ['case_id', 'unique_key', 'id']) ?? ''),
      complaint_type: (pick(r, ['complaint_type', 'request_type']) as string | null) ?? null,
      borough: (r.borough as string | null) ?? null,
      council_district: r.council_district == null ? null : String(r.council_district),
      status: (r.status as string | null) ?? null,
      priority_score: numOrNull(pick(r, ['priority_score', 'review_priority_score', 'score'])),
      priority_tier: (pick(r, ['priority_tier', 'review_priority_tier', 'tier']) as string | null) ?? null,
      priority_reason: (pick(r, ['priority_reason', 'reason', 'review_reason']) as string | null) ?? null,
      age_days: numOrNull(pick(r, ['age_days', 'age', 'days_open'])),
      due_date: (pick(r, ['due_date', 'due_at']) as string | null) ?? null,
      submitted_at: (pick(r, ['submitted_at', 'created_at', 'created_date']) as string | null) ?? null,
      address_or_location: (pick(r, ['address_or_location', 'incident_address']) as string | null) ?? null,
    }))
    .sort((a, b) => (b.priority_score ?? -Infinity) - (a.priority_score ?? -Infinity))
}
