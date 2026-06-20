import { supabase, isSupabaseConfigured } from '../lib/supabase'

// Case Explorer + Open review queue readers for Insights.
//
// Case Explorer is a paginated, filtered window over the historical NYC 311
// public service requests in public.municipal_complaints — it NEVER loads all
// rows and NEVER asks for a row count. Every query is filtered, range-paginated,
// and ordered by an indexed column; pagination is cursor-style ("more results
// available") rather than an exact "page X of N". The Open review queue reads a
// separate, prioritized open-cases view (public.v_nyc_open_review_queue) when
// that dataset has been loaded; until then the reader surfaces a clear
// "not loaded" state rather than inventing data.

function requireClient() {
  if (!isSupabaseConfigured || !supabase) throw new Error('Live data service is not configured')
  return supabase
}

const COMPLAINTS_TABLE = 'municipal_complaints'

/**
 * Normalize a borough filter value to the stored canonical form for an INDEXED
 * equality match.
 *
 * NYC 311 stores borough as a normalized UPPERCASE name (e.g. "BROOKLYN",
 * "STATEN ISLAND"). The filter value can arrive two ways:
 *   * a friendly title-case label clicked on the borough map ("Brooklyn"), or
 *   * the stored value itself, picked from a dropdown facet ("BROOKLYN").
 * Folding both to a single uppercase form lets us use a plain equality match
 * instead of ILIKE. Equality can be served by the borough btree index
 * (idx_mc_nyc_borough_submitted); a case-insensitive ILIKE could not, and risked
 * a full scan / statement timeout on the ~3.4M-row complaints table. UI labels
 * stay friendly — this normalization happens only at query time.
 */
export function normalizeBoroughFilter(borough: string): string {
  return borough.trim().toUpperCase()
}

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
  /** Whether more rows exist beyond this page — computed WITHOUT any row count. */
  hasMore: boolean
  /** Next zero-based page index, or null when there are no more rows. */
  nextPage: number | null
  /** Optional UI guidance (e.g. the free-text search was narrowed for speed). */
  notice?: string
}

/** Minimum free-text length before a (non-exact-ID) wildcard search runs. */
const MIN_SEARCH_LENGTH = 3

/** Whether any equality/range filter is set that narrows the candidate set. */
function hasNarrowingFilter(f: CaseExplorerFilters): boolean {
  return Boolean(
    f.complaintType || f.borough || f.councilDistrict || f.agency || f.status || f.dateFrom || f.dateTo,
  )
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
 * zero-based and pages are meant to accumulate ("Load more").
 *
 * IMPORTANT — no row counts of any kind. Counting 3.4M rows filtered by a
 * high-volume complaint type (e.g. Illegal Parking) and ordered by submitted_at
 * blew the Postgres statement timeout (57014). Instead we fetch pageSize + 1 rows
 * so we know whether a next page exists without ever counting, then trim back to
 * pageSize. Combined with the partial indexes in migration 025, the ordered,
 * limited slice is served straight from an index and returns quickly.
 *
 * Exact-ID search short circuit: when the search term is an exact case ID (or
 * source dataset ID) — historical OR open review queue — we resolve it directly
 * to a single row so searching an open case like "NYC-OPEN-68296525" works even
 * though that case does not live in the historical table.
 */
export async function getNycCaseExplorerPage(
  filters: CaseExplorerFilters,
  page = 0,
  pageSize = 25,
): Promise<CaseExplorerPage> {
  const client = requireClient()

  const term = filters.search?.trim()

  if (term) {
    // Try an exact ID match first (historical or open review queue). Defensive:
    // a missing open queue view must never break ordinary text search, so any
    // lookup error falls through to the normal filtered query below.
    try {
      const exact = await getUnifiedNycCaseDetail(term)
      if (exact) {
        return {
          rows: [caseDetailToExplorerRow(exact)],
          hasMore: false,
          nextPage: null,
        }
      }
    } catch {
      // Ignore — fall through to the filtered text search.
    }
  }

  let query = client.from(COMPLAINTS_TABLE).select(EXPLORER_COLUMNS).eq('source_city', 'NYC')

  let notice: string | undefined

  if (term) {
    // The exact-ID short circuit above already handled a full case ID. A very
    // short term would force a wildcard scan over 3.4M rows, so require a
    // minimum length and guide the user instead.
    if (term.length < MIN_SEARCH_LENGTH) {
      return {
        rows: [],
        hasMore: false,
        nextPage: null,
        notice: 'Enter at least 3 characters, or search by an exact case ID.',
      }
    }
    const safeTerm = term.replace(/[,()*%]/g, ' ').trim()
    if (safeTerm) {
      // A broad OR ILIKE across complaint_type / address / request_detail is only
      // affordable once a filter has narrowed the candidate set. With no filter,
      // restrict free text to the (trigram-indexed) ID columns so the default
      // search can never trip the 57014 statement timeout on the full table.
      const narrowed = hasNarrowingFilter(filters)
      const cols = narrowed
        ? ['case_id', 'source_dataset_id', 'complaint_type', 'address_or_location', 'request_detail']
        : ['case_id', 'source_dataset_id']
      query = query.or(cols.map((col) => `${col}.ilike.%${safeTerm}%`).join(','))
      if (!narrowed) {
        notice =
          'Searched by case ID only. Use a case ID or add a filter (complaint type, borough, district, status, or date range) for faster free-text search.'
      }
    }
  }

  if (filters.complaintType) query = query.eq('complaint_type', filters.complaintType)
  // Indexed equality on the normalized (uppercase) borough name, so a map label
  // ("Brooklyn") and a stored value ("BROOKLYN") both match and the borough btree
  // index can serve the filter. See normalizeBoroughFilter.
  if (filters.borough) query = query.eq('borough', normalizeBoroughFilter(filters.borough))
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

  // Fetch one extra row to detect a next page without a row count.
  const from = page * pageSize
  const to = from + pageSize
  const { data, error } = await query
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .range(from, to)

  if (error) throw error
  const rows = (data ?? []) as NycCaseRow[]
  const hasMore = rows.length > pageSize

  return {
    rows: rows.slice(0, pageSize),
    hasMore,
    nextPage: hasMore ? page + 1 : null,
    notice,
  }
}

// ---------------------------------------------------------------------------
// Unified case detail — resolves a case ID to its full source record from
// EITHER the historical NYC 311 history (public.municipal_complaints) or the
// active open review queue (public.v_nyc_open_review_queue). Powers the full
// NYC case page and the Case Explorer exact-ID search.
// ---------------------------------------------------------------------------

/**
 * Full detail for one case, drawn verbatim from its source record. `sourceType`
 * tells the UI which dataset the record came from so it can label it honestly
 * (historical public 311 record vs. active open review queue) and only show
 * review-priority fields for open cases. `raw` carries every source column for a
 * transparent "raw source record" view — no invented fields.
 */
export type UnifiedNycCaseDetail = {
  sourceType: 'historical' | 'open_review'
  case_id: string
  source_dataset_id: string | null
  submitted_at: string | null
  closed_at: string | null
  due_date: string | null
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
  resolution_description: string | null
  /** Intake channel the request came in on (phone, online, mobile, …) — a NYC source field. */
  source_channel: string | null
  priority_score: number | null
  priority_tier: string | null
  priority_reason: string | null
  age_days: number | null
  /** Verbatim public 311 source-record fields (location, coordinates, resolution metadata). */
  source: OpenSourceRecord
  raw: Record<string, unknown>
}

export async function getUnifiedNycCaseDetail(caseId: string): Promise<UnifiedNycCaseDetail | null> {
  const client = requireClient()
  const id = caseId.trim()

  const historical = await client
    .from(COMPLAINTS_TABLE)
    .select('*')
    .or(`case_id.eq.${id},source_dataset_id.eq.${id}`)
    .maybeSingle()

  if (historical.error) throw historical.error

  if (historical.data) {
    const r = historical.data as Record<string, unknown>
    return {
      sourceType: 'historical',
      case_id: String(r.case_id ?? id),
      source_dataset_id: r.source_dataset_id == null ? null : String(r.source_dataset_id),
      submitted_at: r.submitted_at == null ? null : String(r.submitted_at),
      closed_at: r.closed_at == null ? null : String(r.closed_at),
      due_date: null,
      status: r.status == null ? null : String(r.status),
      complaint_type: r.complaint_type == null ? null : String(r.complaint_type),
      request_detail: r.request_detail == null ? null : String(r.request_detail),
      request_detail_2: r.request_detail_2 == null ? null : String(r.request_detail_2),
      agency: r.agency == null ? null : String(r.agency),
      agency_name: r.agency_name == null ? null : String(r.agency_name),
      assigned_department: r.assigned_department == null ? null : String(r.assigned_department),
      borough: r.borough == null ? null : String(r.borough),
      council_district: r.council_district == null ? null : String(r.council_district),
      address_or_location: r.address_or_location == null ? null : String(r.address_or_location),
      resolution_description: r.resolution_description == null ? null : String(r.resolution_description),
      source_channel: strOrNull(pick(r, ['source_channel', 'open_data_channel_type', 'channel', 'source'])),
      priority_score: null,
      priority_tier: null,
      priority_reason: null,
      age_days: null,
      source: mapOpenSource(r),
      raw: r,
    }
  }

  const open = await client.from(OPEN_QUEUE_VIEW).select('*').eq('case_id', id).maybeSingle()

  if (open.error) throw open.error

  if (!open.data) return null

  const r = open.data as Record<string, unknown>

  return {
    sourceType: 'open_review',
    case_id: String(r.case_id ?? id),
    source_dataset_id: r.source_dataset_id == null ? null : String(r.source_dataset_id),
    submitted_at: r.submitted_at == null ? null : String(r.submitted_at),
    // The open review queue / nyc_open_service_requests can carry a closure
    // timestamp under closed_at OR closed_date — a Closed case is no longer
    // "open" even though it lives in the open-review source view. Mapping it
    // (instead of hardcoding null) lets the case page render a closed timeline.
    closed_at: strOrNull(pick(r, ['closed_at', 'closed_date'])),
    due_date: r.due_date == null ? null : String(r.due_date),
    status: r.status == null ? null : String(r.status),
    complaint_type: r.complaint_type == null ? null : String(r.complaint_type),
    request_detail: r.request_detail == null ? null : String(r.request_detail),
    request_detail_2: r.request_detail_2 == null ? null : String(r.request_detail_2),
    agency: r.agency == null ? null : String(r.agency),
    agency_name: r.agency_name == null ? null : String(r.agency_name),
    assigned_department: r.assigned_department == null ? null : String(r.assigned_department),
    borough: r.borough == null ? null : String(r.borough),
    council_district: r.council_district == null ? null : String(r.council_district),
    address_or_location: r.address_or_location == null ? null : String(r.address_or_location),
    resolution_description: r.resolution_description == null ? null : String(r.resolution_description),
    source_channel: strOrNull(pick(r, ['source_channel', 'open_data_channel_type', 'channel', 'source'])),
    priority_score: r.priority_score == null ? null : Number(r.priority_score),
    priority_tier: r.priority_tier == null ? null : String(r.priority_tier),
    priority_reason: r.priority_reason == null ? null : String(r.priority_reason),
    age_days: r.age_days == null ? null : Number(r.age_days),
    source: mapOpenSource(r),
    raw: r,
  }
}

/** Project a unified detail record into a Case Explorer table row. */
function caseDetailToExplorerRow(row: UnifiedNycCaseDetail): NycCaseRow {
  return {
    case_id: row.case_id,
    source_dataset_id: row.source_dataset_id,
    submitted_at: row.submitted_at,
    closed_at: row.closed_at,
    status: row.status,
    complaint_type: row.complaint_type,
    request_detail: row.request_detail,
    request_detail_2: row.request_detail_2,
    agency: row.agency,
    agency_name: row.agency_name,
    assigned_department: row.assigned_department,
    borough: row.borough,
    council_district: row.council_district,
    address_or_location: row.address_or_location,
    ward_or_area: null,
    resolution_description: row.resolution_description,
  }
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

export type OpenQueuePage = { rows: OpenReviewRow[]; hasMore: boolean }

/** Apply the shared open-queue filters to a PostgREST query builder. */
function applyOpenFilters<T>(query: T, filters: OpenQueueFilters): T {
  // The query builder is chainable; cast keeps this readable without pulling in
  // the full Supabase generic types.
  let q = query as unknown as {
    eq: (c: string, v: unknown) => typeof q
    in: (c: string, v: unknown[]) => typeof q
  }
  if (filters.priorityTier) q = q.eq('priority_tier', filters.priorityTier)
  if (filters.complaintType) q = q.eq('complaint_type', filters.complaintType)
  // Indexed equality on the normalized (uppercase) borough name — see
  // normalizeBoroughFilter. Replaces ILIKE so the match is index-friendly.
  if (filters.borough) q = q.eq('borough', normalizeBoroughFilter(filters.borough))
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
 * zero-based.
 *
 * IMPORTANT — no row count. Asking PostgREST for `count: 'exact'` forces a full
 * count over the filtered queue on every page load, which (like the Case
 * Explorer) can blow the Postgres statement timeout (57014). Instead we fetch
 * pageSize + 1 rows so we know whether another page exists, then trim back to
 * pageSize — mirroring getNycCaseExplorerPage. Throws if the view does not exist
 * yet so the UI can show a clear "open cases not loaded" notice (no fake data).
 */
export async function getNycOpenQueuePage(
  filters: OpenQueueFilters = {},
  page = 0,
  pageSize = 25,
): Promise<OpenQueuePage> {
  const client = requireClient()
  let query = client.from(OPEN_QUEUE_VIEW).select('*')
  query = applyOpenFilters(query, filters)

  const from = page * pageSize
  const to = from + pageSize

  const { data, error } = await query
    .order('priority_score', { ascending: false, nullsFirst: false })
    .range(from, to)

  if (error) throw error

  const raw = (data ?? []) as Record<string, unknown>[]
  return {
    rows: raw.slice(0, pageSize).map(mapOpenRow),
    hasMore: raw.length > pageSize,
  }
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
