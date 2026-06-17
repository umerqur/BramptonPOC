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

export type CaseExplorerPage = {
  rows: NycCaseRow[]
  /** Whether more rows exist beyond this page — computed WITHOUT an exact count. */
  hasMore: boolean
  /** Cheap planner estimate of total matching rows. Approximate; may be null. */
  estimatedTotal: number | null
}

/** Closure duration in whole days, or null when the case is not closed cleanly. */
export function closureDurationDays(row: { submitted_at: string | null; closed_at: string | null }): number | null {
  if (!row.submitted_at || !row.closed_at) return null
  const start = new Date(row.submitted_at).getTime()
  const end = new Date(row.closed_at).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return Math.round((end - start) / 86_400_000)
}

/**
 * One filtered page of NYC 311 cases for the Case Explorer drilldowns. `page` is
 * zero-based and pages are meant to accumulate ("Load more"), never to drive an
 * exact page count.
 *
 * IMPORTANT — no exact counts. Counting 3.4M rows filtered by a high-volume
 * complaint type (e.g. Illegal Parking) and ordered by submitted_at was blowing
 * the Postgres statement timeout (57014). Instead we:
 *   * fetch pageSize + 1 rows so we know if there is a next page without a count, and
 *   * ask only for a cheap PLANNED count (planner estimate) for an approximate
 *     "Approx. X matching cases" hint.
 * Combined with the partial indexes in migration 024, the ordered, limited slice
 * uses an index and returns quickly. We never load the full result set.
 */
export async function getNycCaseExplorerPage(
  filters: CaseExplorerFilters,
  page = 0,
  pageSize = 25,
): Promise<CaseExplorerPage> {
  const client = requireClient()
  let query = client
    .from(COMPLAINTS_TABLE)
    .select(EXPLORER_COLUMNS, { count: 'planned' })
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

  // Fetch one extra row to detect a next page without an exact count.
  const from = page * pageSize
  const { data, error, count } = await query
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .range(from, from + pageSize)

  if (error) throw error
  const all = (data ?? []) as NycCaseRow[]
  const hasMore = all.length > pageSize
  const rows = hasMore ? all.slice(0, pageSize) : all
  return { rows, hasMore, estimatedTotal: count ?? null }
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

// One row of the open review queue. Carries every field the open-case detail
// drawer renders, so a click never needs a second round trip and the detail
// always comes from the open dataset (v_nyc_open_review_queue) — never from the
// historical municipal_complaints table.
export type OpenReviewRow = {
  case_id: string
  complaint_type: string | null
  descriptor: string | null
  agency: string | null
  borough: string | null
  council_district: string | null
  status: string | null
  source_channel: string | null
  priority_score: number | null
  priority_tier: string | null
  priority_reason: string | null
  age_days: number | null
  due_date: string | null
  submitted_at: string | null
  address_or_location: string | null
  // Raw source-record fields from the public NYC 311 dataset, surfaced in the
  // collapsible "Source record details" section of the open-case drawer for
  // transparency. Not used for the curated operational summary.
  source: OpenSourceRecord
}

/** Verbatim fields from the public NYC 311 source record (nyc_open_service_requests). */
export type OpenSourceRecord = {
  unique_key: string | null
  location_type: string | null
  incident_zip: string | null
  incident_address: string | null
  street_name: string | null
  cross_street_1: string | null
  cross_street_2: string | null
  intersection_street_1: string | null
  intersection_street_2: string | null
  address_type: string | null
  city: string | null
  resolution_description: string | null
  resolution_action_updated_date: string | null
  latitude: number | null
  longitude: number | null
}

const OPEN_QUEUE_VIEW = 'v_nyc_open_review_queue'

const numOrNull = (v: unknown): number | null => {
  if (v == null) return null
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return Number.isFinite(n) ? n : null
}

const pick = (r: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) if (r[k] != null) return r[k]
  return null
}

const strOrNull = (v: unknown): string | null => {
  if (v == null) return null
  const s = String(v).trim()
  return s.length > 0 ? s : null
}

/** Pull the verbatim source-record fields from a raw queue row, reading names defensively. */
function mapOpenSource(r: Record<string, unknown>): OpenSourceRecord {
  return {
    unique_key: strOrNull(pick(r, ['unique_key', 'source_dataset_id', 'case_id', 'id'])),
    location_type: strOrNull(pick(r, ['location_type'])),
    incident_zip: strOrNull(pick(r, ['incident_zip', 'zip', 'postal_code'])),
    incident_address: strOrNull(pick(r, ['incident_address', 'address_or_location'])),
    street_name: strOrNull(pick(r, ['street_name'])),
    cross_street_1: strOrNull(pick(r, ['cross_street_1', 'cross_street_one'])),
    cross_street_2: strOrNull(pick(r, ['cross_street_2', 'cross_street_two'])),
    intersection_street_1: strOrNull(pick(r, ['intersection_street_1', 'intersection_street_one'])),
    intersection_street_2: strOrNull(pick(r, ['intersection_street_2', 'intersection_street_two'])),
    address_type: strOrNull(pick(r, ['address_type'])),
    city: strOrNull(pick(r, ['city'])),
    resolution_description: strOrNull(pick(r, ['resolution_description'])),
    resolution_action_updated_date: strOrNull(pick(r, ['resolution_action_updated_date'])),
    latitude: numOrNull(pick(r, ['latitude', 'lat'])),
    longitude: numOrNull(pick(r, ['longitude', 'lon', 'lng', 'long'])),
  }
}

/** Map a raw queue view row to an OpenReviewRow, reading field names defensively. */
function mapOpenRow(r: Record<string, unknown>): OpenReviewRow {
  return {
    case_id: String(pick(r, ['case_id', 'unique_key', 'id']) ?? ''),
    complaint_type: (pick(r, ['complaint_type', 'request_type']) as string | null) ?? null,
    descriptor: (pick(r, ['descriptor', 'request_detail', 'request_detail_2']) as string | null) ?? null,
    agency: (pick(r, ['agency_name', 'agency', 'assigned_department']) as string | null) ?? null,
    borough: (r.borough as string | null) ?? null,
    council_district: r.council_district == null ? null : String(r.council_district),
    status: (r.status as string | null) ?? null,
    source_channel:
      (pick(r, ['source_channel', 'open_data_channel_type', 'channel', 'source']) as string | null) ?? null,
    priority_score: numOrNull(pick(r, ['priority_score', 'review_priority_score', 'score'])),
    priority_tier: (pick(r, ['priority_tier', 'review_priority_tier', 'tier']) as string | null) ?? null,
    priority_reason: (pick(r, ['priority_reason', 'reason', 'review_reason']) as string | null) ?? null,
    age_days: numOrNull(pick(r, ['age_days', 'age', 'days_open'])),
    due_date: (pick(r, ['due_date', 'due_at']) as string | null) ?? null,
    submitted_at: (pick(r, ['submitted_at', 'created_at', 'created_date']) as string | null) ?? null,
    address_or_location: (pick(r, ['address_or_location', 'incident_address']) as string | null) ?? null,
    source: mapOpenSource(r),
  }
}

export type OpenQueueFilters = {
  priorityTier?: string
  complaintType?: string
  borough?: string
  councilDistrict?: string
  status?: string
}

export type OpenQueuePage = { rows: OpenReviewRow[]; total: number }

/** Apply the shared open-queue filters to a PostgREST query builder. */
function applyOpenFilters<T>(query: T, filters: OpenQueueFilters): T {
  // The query builder is chainable; cast keeps this readable without pulling in
  // the full Supabase generic types.
  let q = query as unknown as {
    eq: (c: string, v: unknown) => typeof q
    ilike: (c: string, v: string) => typeof q
    in: (c: string, v: unknown[]) => typeof q
  }
  if (filters.priorityTier) q = q.eq('priority_tier', filters.priorityTier)
  if (filters.complaintType) q = q.eq('complaint_type', filters.complaintType)
  if (filters.borough) q = q.ilike('borough', filters.borough)
  if (filters.status) q = q.eq('status', filters.status)
  if (filters.councilDistrict) {
    const plain = String(Number(filters.councilDistrict))
    const padded = plain.padStart(2, '0')
    q = q.in('council_district', Array.from(new Set([plain, padded, filters.councilDistrict])))
  }
  return q as unknown as T
}

/**
 * One filtered, paginated page of the open NYC review queue, sorted by review
 * priority (highest first), from public.v_nyc_open_review_queue. `page` is
 * zero-based. Returns the rows plus the exact total matching the filters.
 * Throws if the view does not exist yet so the UI can show a clear
 * "open cases not loaded" notice (no fake data).
 */
export async function getNycOpenQueuePage(
  filters: OpenQueueFilters = {},
  page = 0,
  pageSize = 25,
): Promise<OpenQueuePage> {
  const client = requireClient()
  let query = client.from(OPEN_QUEUE_VIEW).select('*', { count: 'exact' })
  query = applyOpenFilters(query, filters)
  const from = page * pageSize
  const { data, error, count } = await query
    .order('priority_score', { ascending: false, nullsFirst: false })
    .range(from, from + pageSize - 1)
  if (error) throw error
  const rows = ((data ?? []) as Record<string, unknown>[]).map(mapOpenRow)
  return { rows, total: count ?? rows.length }
}

/**
 * A diversified slice of the highest-priority open cases: still priority-ranked,
 * but interleaved by complaint type so the first screen is not dominated by a
 * single category (e.g. Graffiti). Pulls a bounded high-priority pool and
 * round-robins across complaint types client-side. Raw priority order remains
 * available via {@link getNycOpenQueuePage}.
 */
export async function getNycOpenQueueDiversified(
  filters: OpenQueueFilters = {},
  limit = 50,
  poolSize = 400,
): Promise<OpenReviewRow[]> {
  const client = requireClient()
  let query = client.from(OPEN_QUEUE_VIEW).select('*')
  query = applyOpenFilters(query, filters)
  const { data, error } = await query
    .order('priority_score', { ascending: false, nullsFirst: false })
    .limit(poolSize)
  if (error) throw error
  const pool = ((data ?? []) as Record<string, unknown>[]).map(mapOpenRow)

  // Group by complaint type, each group already in priority order, then take one
  // from each group per round so varied types surface near the top.
  const groups = new Map<string, OpenReviewRow[]>()
  for (const r of pool) {
    const key = r.complaint_type ?? 'Uncategorized'
    const g = groups.get(key)
    if (g) g.push(r)
    else groups.set(key, [r])
  }
  // Order groups by their best (first) priority so the strongest type still leads.
  const ordered = [...groups.values()].sort(
    (a, b) => (b[0].priority_score ?? -Infinity) - (a[0].priority_score ?? -Infinity),
  )
  const out: OpenReviewRow[] = []
  let round = 0
  while (out.length < limit) {
    let added = false
    for (const g of ordered) {
      if (g[round]) {
        out.push(g[round])
        added = true
        if (out.length >= limit) break
      }
    }
    if (!added) break
    round += 1
  }
  return out
}

// --- Open-case aggregates (full population, not just the loaded page) --------

export type OpenAgingBucket = { bucket: string; sort_order: number; total_cases: number }

/** Open-case aging buckets across the full review queue (v_nyc_open_aging_buckets). */
export async function getNycOpenAgingBuckets(): Promise<OpenAgingBucket[]> {
  const client = requireClient()
  const { data, error } = await client
    .from('v_nyc_open_aging_buckets')
    .select('bucket, sort_order, total_cases')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[])
    .map((r) => ({
      bucket: String(r.bucket ?? ''),
      sort_order: Number(r.sort_order ?? 0),
      total_cases: Number(r.total_cases ?? 0),
    }))
    .filter((b) => b.sort_order <= 3)
}

export type OpenStatusMixRow = { status: string; total_cases: number }

/** Open case status mix across the active review queue (v_nyc_open_status_mix). */
export async function getNycOpenStatusMix(): Promise<OpenStatusMixRow[]> {
  const client = requireClient()
  const { data, error } = await client
    .from('v_nyc_open_status_mix')
    .select('status, total_cases')
    .order('total_cases', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    status: (r.status as string) || 'Unknown',
    total_cases: Number(r.total_cases ?? 0),
  }))
}

// --- Open-queue snapshot summary (total + high-priority tier) ----------------

export type OpenQueueSummary = {
  /** Total active open cases in the review queue. */
  total: number
  /** Open cases in the "High" priority tier, or null when no tier breakdown is available. */
  highPriority: number | null
}

/**
 * One-shot summary of the ACTIVE open review queue for the Insights snapshot:
 * the total open-case count and the High-priority-tier count.
 *
 * Prefers the precomputed tier-volume aggregate (v_nyc_open_tier_volume, from
 * migration 022) — a single tiny read yields both the total and the High count.
 * If that view is not present yet, falls back to an exact head count over the
 * open review queue (total only, no tier breakdown). If neither the tier view
 * nor the queue view is available, this throws so the caller can show a clear
 * "Open queue not loaded" state — never fabricated numbers.
 */
export async function getNycOpenQueueSummary(): Promise<OpenQueueSummary> {
  const client = requireClient()

  // Preferred path: the precomputed tier volume (migration 022).
  try {
    const { data, error } = await client.from('v_nyc_open_tier_volume').select('priority_tier, total_cases')
    if (error) throw error
    const rows = (data ?? []) as Record<string, unknown>[]
    if (rows.length > 0) {
      const total = rows.reduce((n, r) => n + Number(r.total_cases ?? 0), 0)
      const high = rows
        .filter((r) => String(r.priority_tier ?? '').trim().toLowerCase() === 'high')
        .reduce((n, r) => n + Number(r.total_cases ?? 0), 0)
      return { total, highPriority: high }
    }
  } catch {
    // Tier view not applied yet — fall through to a plain count.
  }

  // Fallback: exact count over the open review queue (no tier breakdown).
  const { count, error } = await client.from(OPEN_QUEUE_VIEW).select('*', { count: 'exact', head: true })
  if (error) throw error
  return { total: count ?? 0, highPriority: null }
}

export type OpenQueueOptions = {
  priorityTiers: string[]
  complaintTypes: string[]
  boroughs: string[]
  councilDistricts: string[]
  statuses: string[]
}

/** Filter dropdown options for the Open-cases tab, from the small facet views. */
export async function getOpenQueueOptions(): Promise<OpenQueueOptions> {
  const [priorityTiers, complaintTypes, boroughs, councilDistricts, statuses] = await Promise.all([
    pluck('v_nyc_open_tier_volume', 'priority_tier'),
    pluck('v_nyc_open_complaint_type_volume', 'complaint_type'),
    pluck('v_nyc_open_borough_volume', 'borough'),
    pluck('v_nyc_open_council_district_volume', 'council_district'),
    pluck('v_nyc_open_status_mix', 'status'),
  ])
  const districts = Array.from(new Set(councilDistricts.map((d) => String(Number(d))).filter((d) => d !== 'NaN'))).sort(
    (a, b) => Number(a) - Number(b),
  )
  return { priorityTiers, complaintTypes, boroughs, councilDistricts: districts, statuses }
}
