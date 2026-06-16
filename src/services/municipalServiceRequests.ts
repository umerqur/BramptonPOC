import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { cases } from '../data/mockCases'
import { NYC_BOROUGH_BOUNDARIES } from '../data/nycBoroughBoundaries'
import { NYC_COUNCIL_DISTRICT_BOUNDARIES } from '../data/nycCouncilDistrictBoundaries'

// Primary data source for the authenticated Brampton complaint workflow app.
// NYC 311 Open Data public benchmark data is loaded into `municipal_complaints`
// to demonstrate the closure review workflow. NYC 311 has a richer service
// request schema that better mimics what Brampton internal enforcement systems
// would contain. This is not Brampton operational complaint data — it is a public
// benchmark, and the workflow is designed to connect to equivalent Brampton
// internal service request, patrol, inspection, ticket, and closure data during
// the POC.
export const COMPLAINTS_TABLE = 'municipal_complaints'
export const WARDS_TABLE = 'brampton_ward_boundaries'
// NYC 311 benchmark service-request volume per borough, aggregated from
// municipal_complaints (see migration 014_nyc311_rich_fields.sql).
export const NYC_WORKLOAD_VIEW = 'v_nyc_service_request_workload'
// NYC 311 benchmark service-request volume per City Council district — the finer,
// ward-like operational unit (boroughs are too broad). See migration
// 015_nyc_council_district_workload.sql.
export const NYC_COUNCIL_DISTRICT_WORKLOAD_VIEW = 'v_nyc_council_district_workload'
export const WORKFLOW_EVENTS_TABLE = 'workflow_events'
export const AI_TRIAGE_TABLE = 'ai_triage_results'
export const CASE_AI_REVIEWS_TABLE = 'case_ai_reviews'
export const WORKLOAD_INSIGHTS_TABLE = 'workload_insights_v1'
// Legacy table retained for rollback but no longer used by the main staff UI.
// The authenticated app now reads the statistical attention queue
// (v_statistical_attention_queue) for both Closure Review and Insights. The
// constant and the read helpers below are kept so a rollback is a one-line
// swap, not a re-import — no visible ML wording is surfaced from them.
export const WORKFLOW_ML_PREDICTIONS_TABLE = 'workflow_ml_predictions'

// Statistical Queue Insights — the current product direction. A transparent,
// classical statistical scoring layer (Review Attention Score) that replaces the
// previous ML framing in the UI. Read from the v_statistical_attention_queue view.
export const STATISTICAL_CASE_SCORES_TABLE = 'statistical_case_scores'
export const STATISTICAL_FEATURE_CORRELATIONS_TABLE = 'statistical_feature_correlations'
export const STATISTICAL_ATTENTION_QUEUE_VIEW = 'v_statistical_attention_queue'

/**
 * Standard advisory disclaimer for AI-assisted triage. The current POC triage is
 * rule based using existing columns in `municipal_complaints` — it is decision
 * support only, never a final enforcement decision.
 */
export const TRIAGE_ADVISORY =
  'AI-assisted triage is rule based POC decision support only. It is not a final enforcement decision. Authorized municipal staff review and decide every case.'

/** Product positioning note used across the authenticated app. */
export const DATA_POSITIONING =
  'NYC 311 public benchmark data is used to demonstrate the closure review workflow. This is a Brampton compatible Proactive Enforcement Response POC, designed to connect to equivalent Brampton internal data during the POC. It is not Brampton operational complaint data.'

/**
 * Shape of a row in the Supabase `municipal_complaints` table.
 */
export type MunicipalComplaintRow = {
  id: number
  case_id: string
  source_city: string
  source_dataset: string | null
  source_channel: string | null
  submitted_at: string | null
  status: string | null
  resolution_status: string | null
  workflow_stage: string | null
  fsa_or_area: string | null
  intersection_street_1: string | null
  intersection_street_2: string | null
  address_or_location: string | null
  ward_or_area: string | null
  complaint_type: string | null
  assigned_department: string | null
  department_unit: string | null
  priority: string | null
  ai_category: string | null
  ai_priority: string | null
  ai_summary: string | null
  ai_recommended_action: string | null
  human_decision: string | null
  closed_at: string | null
  latitude: number | null
  longitude: number | null
  description: string | null
  created_at: string | null
}

/**
 * Normalized view-model row used by the case queue table. Both real Supabase
 * rows and the mock fallback cases map into this shape so the UI does not need
 * to branch on the data source.
 */
export type ComplaintRow = {
  id: string
  submittedAt: string | null
  complaintType: string
  status: string
  workflowStage: string
  priority: string
  aiPriority: string
  aiCategory: string
  assignedDepartment: string
  departmentUnit: string
  wardOrArea: string
  address: string
  description: string
  aiSummary: string
  recommendedAction: string
}

export type ComplaintFilters = {
  status?: string
  priority?: string
  department?: string
  category?: string
  ward?: string
  workflowStage?: string
  search?: string
  // 'operational_priority' ranks High → Medium → Low → unknown (the order staff
  // should work a triage queue in). 'priority' is kept as a legacy alias and is
  // treated identically. Plain 'submitted_at'/'status' order by that column.
  sort?: 'submitted_at' | 'priority' | 'status' | 'operational_priority'
  limit?: number
}

export type ComplaintFilterOptions = {
  statuses: string[]
  priorities: string[]
  departments: string[]
  categories: string[]
  wards: string[]
}

export type ComplaintKpis = {
  total_cases: number
  in_progress_cases: number
  new_or_initiated_cases: number
  closed_or_completed_cases: number
  cancelled_cases: number
  complaint_types: number
  departments: number
  wards_or_areas: number
}

export type DepartmentWorkload = {
  assigned_department: string | null
  case_count: number
  closed_or_completed_count: number
  in_progress_count: number
}

export type ComplaintTypeCount = {
  complaint_type: string | null
  ai_category: string | null
  case_count: number
}

export type WardBoundary = {
  id: number
  objectid: number | null
  ward: string | null
  electoral_area: string | null
  source_city: string | null
  source_dataset: string | null
  geojson_geometry: unknown
}

/**
 * One real NYC borough boundary used as the geographic base layer for the NYC
 * 311 workload heat map. Geometry is bundled from NYC Open Data — Borough
 * Boundaries (nybb), EPSG:4326 GeoJSON (see src/data/nycBoroughBoundaries.ts).
 * `borough_name` is the join key to the per-borough NYC 311 workload counts.
 * This is NYC geography — never Toronto and never Brampton.
 */
export type NYCBoroughBoundary = {
  id: number
  boro_code: number
  borough_name: string
  short_label: string
  source_city: string
  source_dataset: string
  geojson_geometry: unknown
}

/**
 * NYC 311 benchmark complaint volume aggregated per borough, from
 * public.v_nyc_service_request_workload over public.municipal_complaints. Joined
 * to NYCBoroughBoundary by borough name. This is NYC 311 benchmark data —
 * decision support only, not Brampton operational complaint data, and never a
 * final enforcement decision.
 */
export type NYCBoroughWorkload = {
  borough: string
  complaint_volume: number
}

/**
 * One real NYC City Council district boundary — the operational, ward-like
 * geographic unit for the NYC 311 workload heat map (boroughs are too broad and
 * stay as the executive overview). Geometry is bundled from NYC Open Data — City
 * Council Districts (see src/data/nycCouncilDistrictBoundaries.ts). `council_district`
 * (as text) is the join key to the per-district NYC 311 workload counts.
 */
export type NYCCouncilDistrictBoundary = {
  id: number
  council_district: number
  short_label: string
  source_city: string
  source_dataset: string
  geojson_geometry: unknown
}

/**
 * NYC 311 benchmark complaint volume aggregated per City Council district, from
 * public.v_nyc_council_district_workload over public.municipal_complaints. `area`
 * is the council district number as text, matching council_district in the bundled
 * geometry. NYC 311 benchmark decision support only — not Brampton operational data.
 */
export type NYCCouncilDistrictWorkload = {
  area: string
  complaint_volume: number
}

export type WorkflowEvent = {
  id: number
  case_id: string
  event_type: string
  event_label: string | null
  from_status: string | null
  to_status: string | null
  actor_type: string | null
  notes: string | null
  created_at: string | null
}

function mapComplaintRow(row: MunicipalComplaintRow): ComplaintRow {
  return {
    id: row.case_id,
    submittedAt: row.submitted_at,
    complaintType: row.complaint_type || 'Uncategorized',
    status: row.status || 'Unknown',
    workflowStage: row.workflow_stage || 'Needs review',
    priority: row.priority || 'Low',
    aiPriority: row.ai_priority || '',
    aiCategory: row.ai_category || 'General municipal service',
    assignedDepartment: row.assigned_department || 'Unassigned',
    departmentUnit: row.department_unit || 'Unassigned',
    wardOrArea: row.ward_or_area || row.fsa_or_area || 'Unknown',
    address: row.address_or_location || row.fsa_or_area || 'Location not recorded',
    description: row.description || '',
    aiSummary: row.ai_summary || 'No AI summary available.',
    recommendedAction: row.ai_recommended_action || 'Validate details and assign to the responsible team.',
  }
}

function requireClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured')
  }
  return supabase
}

// Columns selected for the case queue list view. Keeps payloads small over the
// full complaint table.
const LIST_COLUMNS =
  'id, case_id, source_city, source_dataset, source_channel, submitted_at, status, resolution_status, workflow_stage, fsa_or_area, intersection_street_1, intersection_street_2, address_or_location, ward_or_area, complaint_type, assigned_department, department_unit, priority, ai_category, ai_priority, ai_summary, ai_recommended_action, human_decision, closed_at, latitude, longitude, description, created_at'

export async function getComplaintKpis(): Promise<ComplaintKpis> {
  const client = requireClient()
  const { data, error } = await client
    .from('v_municipal_complaint_kpis')
    .select('*')
    .single()

  if (error) throw error
  return data as ComplaintKpis
}

export async function getDepartmentWorkload(): Promise<DepartmentWorkload[]> {
  const client = requireClient()
  const { data, error } = await client
    .from('v_complaints_by_department')
    .select('*')
    .limit(10)

  if (error) throw error
  return (data ?? []) as DepartmentWorkload[]
}

export async function getComplaintTypes(): Promise<ComplaintTypeCount[]> {
  const client = requireClient()
  const { data, error } = await client
    .from('v_complaints_by_type')
    .select('*')
    .limit(10)

  if (error) throw error
  return (data ?? []) as ComplaintTypeCount[]
}

export async function getMunicipalComplaints(filters: ComplaintFilters = {}): Promise<ComplaintRow[]> {
  const client = requireClient()
  const {
    status,
    priority,
    department,
    category,
    ward,
    workflowStage,
    search,
    sort = 'submitted_at',
    limit = 500,
  } = filters

  let query = client.from(COMPLAINTS_TABLE).select(LIST_COLUMNS)

  if (status && status !== 'All') query = query.eq('status', status)
  if (priority && priority !== 'All') query = query.eq('priority', priority)
  if (department && department !== 'All') query = query.eq('assigned_department', department)
  if (category && category !== 'All') query = query.eq('ai_category', category)
  if (ward && ward !== 'All') query = query.eq('ward_or_area', ward)
  if (workflowStage && workflowStage !== 'All') query = query.eq('workflow_stage', workflowStage)

  const trimmed = search?.trim()
  if (trimmed) {
    const term = trimmed.replace(/[,()*%]/g, ' ').trim()
    if (term) {
      query = query.or(
        [
          `case_id.ilike.%${term}%`,
          `complaint_type.ilike.%${term}%`,
          `assigned_department.ilike.%${term}%`,
          `ward_or_area.ilike.%${term}%`,
          `address_or_location.ilike.%${term}%`,
          `ai_category.ilike.%${term}%`,
        ].join(','),
      )
    }
  }

  // PostgREST cannot ORDER BY a derived priority rank, so operational priority
  // is ranked client-side. Fetch newest-first from the server, then re-rank;
  // the tie-break on submitted_at keeps newest-first within each priority tier.
  // All server-side filters above are unaffected.
  const rankByPriority = sort === 'operational_priority' || sort === 'priority'
  const serverSort = rankByPriority ? 'submitted_at' : sort
  const ascending = serverSort === 'submitted_at' ? false : true
  const { data, error } = await query.order(serverSort, { ascending, nullsFirst: false }).limit(limit)

  if (error) throw error
  const mapped = ((data ?? []) as MunicipalComplaintRow[]).map(mapComplaintRow)
  return rankByPriority ? sortByOperationalPriority(mapped) : mapped
}

/**
 * Oldest still-open complaints (workflow_stage not Closed/Cancelled), ordered by
 * submitted date ascending so the longest-waiting cases surface first. Used by
 * the Workflow console to flag aging / stale cases. Read-only over existing
 * columns — no schema change. "Aging" is judged dataset-relative in the UI (vs.
 * the newest submission in the loaded set), since the benchmark data is a
 * historical snapshot rather than live wall-clock intake.
 */
export async function getAgingOpenComplaints(limit = 15): Promise<ComplaintRow[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(COMPLAINTS_TABLE)
    .select(LIST_COLUMNS)
    .not('workflow_stage', 'in', '("Closed","Cancelled")')
    .order('submitted_at', { ascending: true, nullsFirst: false })
    .limit(limit)

  if (error) throw error
  return ((data ?? []) as MunicipalComplaintRow[]).map(mapComplaintRow)
}

/**
 * Drilldown filter for the Insights dashboard. When a supervisor clicks a map
 * area, a complaint type, or a bottleneck row, we fetch the individual records
 * behind that aggregate — a small, filtered, limited slice of
 * municipal_complaints, never the full table — so they can open each case file.
 */
export type InsightsDrilldownFilter = {
  complaintType?: string
  councilDistrict?: string
  department?: string
}

/**
 * Individual NYC 311 benchmark records behind an Insights aggregate, newest
 * first. The council-district filter matches both the plain and zero-padded
 * stored forms (e.g. "5" and "05"). Throws on any Supabase error so the caller
 * can surface it.
 */
export async function getInsightsDrilldownCases(
  filter: InsightsDrilldownFilter,
  limit = 50,
): Promise<ComplaintRow[]> {
  const client = requireClient()
  let query = client.from(COMPLAINTS_TABLE).select(LIST_COLUMNS).eq('source_city', 'NYC')

  if (filter.complaintType) {
    if (filter.complaintType === 'Uncategorized') {
      query = query.or('complaint_type.is.null,complaint_type.eq.')
    } else {
      query = query.eq('complaint_type', filter.complaintType)
    }
  }

  if (filter.councilDistrict) {
    const plain = String(Number(filter.councilDistrict))
    const padded = plain.padStart(2, '0')
    query = query.in('council_district', Array.from(new Set([plain, padded, filter.councilDistrict])))
  }

  if (filter.department) {
    // Department on the dashboard is assigned_department, falling back to the
    // NYC agency name/code; match any of those so the drilldown lines up.
    query = query.or(
      [
        `assigned_department.eq.${filter.department}`,
        `agency_name.eq.${filter.department}`,
        `agency.eq.${filter.department}`,
      ].join(','),
    )
  }

  const { data, error } = await query
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw error
  return ((data ?? []) as MunicipalComplaintRow[]).map(mapComplaintRow)
}

export async function getComplaintByCaseId(caseId: string): Promise<MunicipalComplaintRow | null> {
  const client = requireClient()
  const { data, error } = await client
    .from(COMPLAINTS_TABLE)
    .select('*')
    .eq('case_id', caseId)
    .maybeSingle()

  if (error) throw error
  return (data as MunicipalComplaintRow) ?? null
}

/**
 * Resolve a complaint for the case detail route opened from Closure Review.
 *
 * Closure Review rows link by workflow_ml_predictions.source_record_id, which
 * the scoring batch populates directly from municipal_complaints.case_id, so the
 * case_id lookup is the primary (and expected) path. As a defensive fallback —
 * only when the id is a plain, safe integer string — we also try the integer
 * primary key (municipal_complaints.id). No fuzzy matching: exact case_id, then
 * exact numeric id. Returns null when neither matches.
 */
export async function getComplaintByCaseIdOrSourceRecordId(
  id: string,
): Promise<MunicipalComplaintRow | null> {
  const byCaseId = await getComplaintByCaseId(id)
  if (byCaseId) return byCaseId

  // municipal_complaints.id is an integer column, so only attempt the numeric
  // fallback when id is an exact, non-overflowing integer string (type-safe).
  if (/^\d+$/.test(id)) {
    const numericId = Number(id)
    if (Number.isSafeInteger(numericId)) {
      const client = requireClient()
      const { data, error } = await client
        .from(COMPLAINTS_TABLE)
        .select('*')
        .eq('id', numericId)
        .maybeSingle()
      if (error) throw error
      return (data as MunicipalComplaintRow) ?? null
    }
  }

  return null
}

export async function getComplaintFilterOptions(): Promise<ComplaintFilterOptions> {
  const client = requireClient()

  const [statusRes, priorityRes, departmentRes, categoryRes, wardRes] = await Promise.all([
    client.from(COMPLAINTS_TABLE).select('status').not('status', 'is', null).limit(5000),
    client.from(COMPLAINTS_TABLE).select('priority').not('priority', 'is', null).limit(5000),
    client.from(COMPLAINTS_TABLE).select('assigned_department').not('assigned_department', 'is', null).limit(5000),
    client.from(COMPLAINTS_TABLE).select('ai_category').not('ai_category', 'is', null).limit(5000),
    client.from(COMPLAINTS_TABLE).select('ward_or_area').not('ward_or_area', 'is', null).limit(5000),
  ])

  for (const res of [statusRes, priorityRes, departmentRes, categoryRes, wardRes]) {
    if (res.error) throw res.error
  }

  const uniq = (values: Array<string | null | undefined>) =>
    Array.from(new Set(values.filter(Boolean) as string[])).sort()

  const col = <T extends string>(rows: unknown, key: T): Array<string | null> =>
    ((rows ?? []) as Array<Record<string, string | null>>).map((r) => r[key])

  return {
    statuses: uniq(col(statusRes.data, 'status')),
    priorities: uniq(col(priorityRes.data, 'priority')),
    departments: uniq(col(departmentRes.data, 'assigned_department')),
    categories: uniq(col(categoryRes.data, 'ai_category')),
    wards: uniq(col(wardRes.data, 'ward_or_area')),
  }
}

// Explicit column list for the Brampton ward boundary context view. Selecting
// named columns (rather than `*`) keeps the payload predictable and matches the
// WardBoundary type exactly.
const WARD_COLUMNS = 'id, objectid, ward, electoral_area, source_city, source_dataset, geojson_geometry'

export async function getBramptonWardBoundaries(): Promise<WardBoundary[]> {
  const client = requireClient()
  // The supabase-js client targets the `public` schema by default, so this
  // reads public.brampton_ward_boundaries. Any Supabase/RLS error is thrown so
  // the caller can surface it — we never silently return an empty array.
  const { data, error } = await client
    .from(WARDS_TABLE)
    .select(WARD_COLUMNS)
    .order('ward', { ascending: true })

  if (error) throw error
  return (data ?? []) as WardBoundary[]
}

/**
 * Returns the real NYC borough polygons used as the geographic base layer of the
 * NYC 311 workload heat map. Geometry is bundled (NYC Open Data — Borough
 * Boundaries, EPSG:4326 GeoJSON) rather than read from Supabase, so the map is
 * always available and never falls back to any Toronto geometry. Async to keep a
 * uniform load contract with the workload query.
 */
export async function getNYCBoroughBoundaries(): Promise<NYCBoroughBoundary[]> {
  return NYC_BOROUGH_BOUNDARIES.map((b, idx) => ({
    id: idx + 1,
    boro_code: b.boro_code,
    borough_name: b.borough_name,
    short_label: b.short_label,
    source_city: 'NYC',
    source_dataset: 'NYC Open Data — Borough Boundaries (nybb)',
    geojson_geometry: b.geojson_geometry,
  }))
}

// Raw shape of a public.v_nyc_service_request_workload row.
type NYCWorkloadRow = {
  area: string | null
  complaint_volume: number | string | null
}

/**
 * Reads real NYC 311 benchmark complaint volume per borough from
 * public.v_nyc_service_request_workload (aggregated over municipal_complaints),
 * highest volume first. Joined to the borough geometry by borough name. This is
 * decision-support benchmark data — never Brampton operational complaint data.
 * Any Supabase/RLS error is thrown so the caller can fall back to the benchmark
 * sample.
 */
export async function getNYCWorkloadByBorough(): Promise<NYCBoroughWorkload[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(NYC_WORKLOAD_VIEW)
    .select('area, complaint_volume')
    .order('complaint_volume', { ascending: false })

  if (error) throw error
  return ((data ?? []) as NYCWorkloadRow[])
    .map((r) => ({
      borough: (r.area ?? '').trim(),
      complaint_volume: Number(r.complaint_volume) || 0,
    }))
    // Drop empty / unspecified buckets so the heat map only reflects real boroughs.
    .filter((r) => r.borough.length > 0 && r.borough.toLowerCase() !== 'unknown')
}

/**
 * Representative NYC 311 benchmark complaint volume per borough, used when the
 * live Supabase view is unavailable so the workload heat map still renders. These
 * are illustrative benchmark figures (Brooklyn and Queens carry the most 311
 * volume), not Brampton operational data.
 */
export function mockNYCWorkloadByBorough(): NYCBoroughWorkload[] {
  return [
    { borough: 'Brooklyn', complaint_volume: 31240 },
    { borough: 'Queens', complaint_volume: 25890 },
    { borough: 'Bronx', complaint_volume: 21470 },
    { borough: 'Manhattan', complaint_volume: 18650 },
    { borough: 'Staten Island', complaint_volume: 7980 },
  ]
}

/**
 * Returns the real NYC City Council district polygons used as the finer,
 * ward-like base layer of the NYC 311 workload heat map. Geometry is bundled
 * (NYC Open Data — City Council Districts) rather than read from Supabase, so the
 * map is always available. Async to keep a uniform load contract with the
 * workload query.
 */
export async function getNYCCouncilDistrictBoundaries(): Promise<NYCCouncilDistrictBoundary[]> {
  return NYC_COUNCIL_DISTRICT_BOUNDARIES.map((d, idx) => ({
    id: idx + 1,
    council_district: d.council_district,
    short_label: d.short_label,
    source_city: 'NYC',
    source_dataset: 'NYC Open Data — City Council Districts (872g-cjhh)',
    geojson_geometry: d.geojson_geometry,
  }))
}

/**
 * Reads real NYC 311 benchmark complaint volume per City Council district from
 * public.v_nyc_council_district_workload (aggregated over municipal_complaints),
 * highest volume first. `area` is normalized to a plain district number string so
 * it joins to the bundled geometry. Any Supabase/RLS error is thrown so the caller
 * can fall back to the benchmark sample.
 */
export async function getNYCWorkloadByCouncilDistrict(): Promise<NYCCouncilDistrictWorkload[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(NYC_COUNCIL_DISTRICT_WORKLOAD_VIEW)
    .select('area, complaint_volume')
    .order('complaint_volume', { ascending: false })

  if (error) throw error
  return ((data ?? []) as NYCWorkloadRow[])
    .map((r) => ({
      // Normalize to a plain number string ("05" / " 5 " → "5") to match geometry.
      area: String(Number((r.area ?? '').trim())),
      complaint_volume: Number(r.complaint_volume) || 0,
    }))
    .filter((r) => r.area.length > 0 && r.area !== 'NaN' && r.area !== '0')
}

/**
 * Representative NYC 311 benchmark complaint volume per City Council district,
 * used when the live Supabase view is unavailable so the heat map still renders.
 * Illustrative benchmark figures across all 51 districts (not Brampton data).
 */
export function mockNYCWorkloadByCouncilDistrict(): NYCCouncilDistrictWorkload[] {
  // Deterministic spread so every district shades; outer-borough districts carry
  // more 311 volume, mirroring the real benchmark distribution.
  return NYC_COUNCIL_DISTRICT_BOUNDARIES.map((d) => {
    const n = d.council_district
    const base = 2400 + ((n * 1373) % 7600)
    const wave = Math.round(1600 * (1 + Math.sin(n / 2.3)))
    return { area: String(n), complaint_volume: base + wave }
  })
}

// ---------------------------------------------------------------------------
// Operations Workflow Console
// ---------------------------------------------------------------------------

export type WorkflowStageCount = {
  workflow_stage: string
  case_count: number
  high_priority_count: number
  in_progress_count: number
  closed_count: number
}

/** Live counts by workflow_stage, from the v_workflow_stage_counts view. */
export async function getWorkflowStageCounts(): Promise<WorkflowStageCount[]> {
  const client = requireClient()
  const { data, error } = await client.from('v_workflow_stage_counts').select('*')
  if (error) throw error
  return (data ?? []) as WorkflowStageCount[]
}

/** Most recent staff workflow events, from the v_recent_workflow_events view. */
export async function getRecentWorkflowEvents(limit = 15): Promise<WorkflowEvent[]> {
  const client = requireClient()
  const { data, error } = await client
    .from('v_recent_workflow_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as WorkflowEvent[]
}

export type StaffActionSummary = {
  event_type: string
  event_label: string
  count: number
}

/**
 * Summary of recorded staff actions, aggregated client-side from the workflow
 * events audit trail. Used by the console's "Staff action summary" panel.
 */
export async function getStaffActionSummary(): Promise<{ total: number; actors: number; actions: StaffActionSummary[] }> {
  const client = requireClient()
  const { data, error } = await client
    .from(WORKFLOW_EVENTS_TABLE)
    .select('event_type, event_label, actor_type')
    .limit(2000)
  if (error) throw error

  const rows = (data ?? []) as Array<{ event_type: string; event_label: string | null; actor_type: string | null }>
  const byType = new Map<string, StaffActionSummary>()
  const actors = new Set<string>()
  for (const r of rows) {
    if (r.actor_type) actors.add(r.actor_type)
    const key = r.event_type
    const entry = byType.get(key) ?? { event_type: key, event_label: r.event_label || key, count: 0 }
    entry.count += 1
    byType.set(key, entry)
  }
  return {
    total: rows.length,
    actors: actors.size,
    actions: Array.from(byType.values()).sort((a, b) => b.count - a.count),
  }
}

// ---------------------------------------------------------------------------
// Workload Insights (v1 model outputs)
// ---------------------------------------------------------------------------

/**
 * A row in public.workload_insights_v1 — one scored location per model run.
 *
 * These are OUTPUTS of the v1 workload-density model over NYC 311 public
 * benchmark data. They are NOT Brampton operational complaint data, and never a
 * final enforcement decision. Provenance (source_city/source_dataset/
 * model_version/feature_window/scoring_period) and the advisory text travel with
 * every row so the UI can label them honestly.
 */
export type WorkloadInsightRow = {
  source_city: string
  source_dataset: string
  model: string
  model_version: string
  feature_set_version: string
  feature_window: string
  scoring_period: string
  location_unit: string
  location_id: string
  workload_score: number
  predicted_tier: string
  prior_complaint_count: number | null
  actual_volume: number | null
  high_workload_area_true: boolean | null
  top_factors: string[] | null
  advisory: string
  generated_at: string
}

const WORKLOAD_INSIGHTS_COLUMNS =
  'source_city, source_dataset, model, model_version, feature_set_version, feature_window, scoring_period, location_unit, location_id, workload_score, predicted_tier, prior_complaint_count, actual_volume, high_workload_area_true, top_factors, advisory, generated_at'

/**
 * Reads the v1 workload insights from public.workload_insights_v1, highest
 * workload score first. Any Supabase/RLS error is thrown so the caller can
 * decide whether to fall back to the bundled static artifact.
 */
export async function getWorkloadInsightsV1(): Promise<WorkloadInsightRow[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(WORKLOAD_INSIGHTS_TABLE)
    .select(WORKLOAD_INSIGHTS_COLUMNS)
    .order('workload_score', { ascending: false })

  if (error) throw error
  return (data ?? []) as WorkloadInsightRow[]
}

// ---------------------------------------------------------------------------
// V2 workflow ML predictions (read-only)
// ---------------------------------------------------------------------------

/**
 * A row in public.workflow_ml_predictions — one V2 model-scored complaint over
 * the NYC 311 benchmark. `needs_attention_score` / `attention_tier` are the
 * "Needs Attention" handling-path ranking (relative, decision support only).
 * `predicted_department` / `routing_confidence` are RESEARCH ONLY (NYC routing
 * mostly learned complaint_type -> department). Not Brampton operational data and
 * not automated enforcement.
 */
export type WorkflowMlPrediction = {
  source_record_id: string | null
  complaint_type: string | null
  description: string | null
  ward_or_area: string | null
  status: string | null
  assigned_department: string | null
  predicted_department: string | null
  routing_confidence: number | null
  needs_attention_score: number | null
  attention_tier: string | null
  attention_rank: number | null
  model_version: string
  advisory: string
}

const WORKFLOW_ML_PREDICTION_COLUMNS =
  'source_record_id, complaint_type, description, ward_or_area, status, assigned_department, predicted_department, routing_confidence, needs_attention_score, attention_tier, attention_rank, model_version, advisory'

/**
 * Reads V2 workflow ML predictions from public.workflow_ml_predictions, highest
 * Needs Attention rank first. `limit` keeps the payload small (the table holds the
 * full scored benchmark). Any Supabase/RLS error is thrown so the caller can
 * surface it. Decision-support benchmark data — never Brampton operational
 * complaint data and never an automated decision.
 */
export async function getWorkflowMlPredictionsV2(limit = 50): Promise<WorkflowMlPrediction[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(WORKFLOW_ML_PREDICTIONS_TABLE)
    .select(WORKFLOW_ML_PREDICTION_COLUMNS)
    .eq('prediction_type', 'needs_attention')
    .order('needs_attention_score', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as WorkflowMlPrediction[]
}

/**
 * LEGACY (rollback only) — superseded by getClosureReviewStatisticalCases.
 *
 * Reads the former Needs Attention predictions for the Closure Review Workflow
 * from the legacy workflow_ml_predictions table. The main staff UI no longer
 * calls this; it is retained unchanged so a rollback is a one-line swap.
 * Decision support only — never Brampton operational data and never an
 * automated decision.
 */
export async function getClosureReviewCases(limit = 60): Promise<WorkflowMlPrediction[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(WORKFLOW_ML_PREDICTIONS_TABLE)
    .select(WORKFLOW_ML_PREDICTION_COLUMNS)
    .eq('prediction_type', 'needs_attention')
    .order('needs_attention_score', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as WorkflowMlPrediction[]
}

// ---------------------------------------------------------------------------
// Statistical Queue Insights (read-only) — Review Attention Score
// ---------------------------------------------------------------------------

/**
 * One ranked case from public.v_statistical_attention_queue. The Review
 * Attention Score is a transparent, RELATIVE queue rank (Higher / Medium /
 * Lower) built from classical statistics — case aging z-scores, repeat-location
 * counts, area-volume trends, complaint-type backlog percentiles, and
 * missing-context checks. It is NOT a probability, NOT a machine-learning model,
 * and NOT an automated decision. NYC 311 benchmark data, decision support
 * only.
 */
export type StatisticalCaseScore = {
  case_id: string | null
  source_record_id: string | null
  complaint_type: string | null
  status: string | null
  workflow_stage: string | null
  assigned_department: string | null
  ward_or_area: string | null
  address_or_location: string | null
  attention_score: number | null
  attention_tier: string | null
  attention_rank: number | null
  top_driver_1: string | null
  top_driver_2: string | null
  top_driver_3: string | null
  advisory: string | null
  score_version: string | null
}

const STATISTICAL_ATTENTION_QUEUE_COLUMNS =
  'case_id, source_record_id, complaint_type, status, workflow_stage, assigned_department, ward_or_area, address_or_location, attention_score, attention_tier, attention_rank, top_driver_1, top_driver_2, top_driver_3, advisory, score_version'

/**
 * Reads the top-ranked Review Attention cases from the
 * v_statistical_attention_queue view (lowest attention_rank = review first).
 * Any Supabase error — including the view not existing because scores have not
 * been generated yet — is thrown so the caller can surface it clearly rather
 * than silently showing an empty queue.
 */
export async function getStatisticalAttentionQueue(limit = 50): Promise<StatisticalCaseScore[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(STATISTICAL_ATTENTION_QUEUE_VIEW)
    .select(STATISTICAL_ATTENTION_QUEUE_COLUMNS)
    .order('attention_rank', { ascending: true, nullsFirst: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as StatisticalCaseScore[]
}

/**
 * Reads the statistical attention queue for the Closure Review Workbench,
 * highest Review Attention Score first (lowest attention_rank), so the case
 * queue surfaces the files staff should review first. This is the current
 * product signal and replaces the former workflow ML predictions slice — the
 * closure/review workflow layers deterministic, client-side rules on top of
 * these rows (no Supabase writes). Decision support only — never Brampton
 * operational data and never an automated decision.
 */
export async function getClosureReviewStatisticalCases(limit = 60): Promise<StatisticalCaseScore[]> {
  return getStatisticalAttentionQueue(limit)
}

/** A feature/target correlation row backing the explainability summary. */
export type StatisticalFeatureCorrelation = {
  feature_name: string
  target_name: string
  correlation_coefficient: number | null
  direction: string | null
  interpretation: string | null
  sample_size: number | null
  score_version: string | null
}

/**
 * Reads feature/target correlation coefficients (strongest first) from
 * public.statistical_feature_correlations. Returns an empty array when the table
 * is not yet populated; the caller shows a clear "not populated yet" placeholder.
 */
export async function getStatisticalFeatureCorrelations(limit = 20): Promise<StatisticalFeatureCorrelation[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(STATISTICAL_FEATURE_CORRELATIONS_TABLE)
    .select('feature_name, target_name, correlation_coefficient, direction, interpretation, sample_size, score_version')
    .order('correlation_coefficient', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as StatisticalFeatureCorrelation[]
}

export async function addWorkflowEvent(input: {
  case_id: string
  event_type: string
  event_label?: string
  from_status?: string
  to_status?: string
  actor_type?: string
  notes?: string
}) {
  const client = requireClient()
  const { data, error } = await client
    .from(WORKFLOW_EVENTS_TABLE)
    .insert({
      case_id: input.case_id,
      event_type: input.event_type,
      event_label: input.event_label ?? input.event_type,
      from_status: input.from_status ?? null,
      to_status: input.to_status ?? null,
      actor_type: input.actor_type ?? 'staff',
      notes: input.notes ?? null,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getWorkflowEvents(caseId: string): Promise<WorkflowEvent[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(WORKFLOW_EVENTS_TABLE)
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as WorkflowEvent[]
}

/**
 * Similar complaints by the same complaint type and ward/area, excluding the
 * current case. Used by the case detail "Similar cases" panel.
 */
export async function getSimilarComplaints(
  current: MunicipalComplaintRow,
  limit = 5,
): Promise<MunicipalComplaintRow[]> {
  const client = requireClient()
  let query = client.from(COMPLAINTS_TABLE).select(LIST_COLUMNS).neq('case_id', current.case_id)

  if (current.complaint_type) query = query.eq('complaint_type', current.complaint_type)
  if (current.ward_or_area) query = query.eq('ward_or_area', current.ward_or_area)

  const { data, error } = await query.order('submitted_at', { ascending: false, nullsFirst: false }).limit(limit)
  if (error) throw error
  return (data ?? []) as MunicipalComplaintRow[]
}

// ---------------------------------------------------------------------------
// Mock fallback helpers — used by the public demo pages and when Supabase is
// unavailable, so the POC still renders without a live backend. These derive
// from the bundled sample cases and intentionally use Brampton/Ontario framing.
// Do not remove.
// ---------------------------------------------------------------------------

const DEPARTMENT_BY_CATEGORY: Record<string, string> = {
  'Property Standards': 'By-law Enforcement',
  Parking: 'By-law Enforcement',
  Noise: 'By-law Enforcement',
  Waste: 'Public Works',
  Zoning: 'Planning & Development',
  Licensing: 'Licensing & Permits',
  'Illegal Dumping': 'Public Works',
  'Grass and Weeds': 'Parks & Forestry',
}

function mockPriority(c: (typeof cases)[number]): string {
  if (c.risk === 'Critical' || c.risk === 'High') return 'High'
  if (c.risk === 'Medium') return 'Medium'
  return 'Low'
}

function mockStatus(c: (typeof cases)[number], index: number): string {
  if (c.status === 'New') return 'New'
  // Give the sample some closed/cancelled variety for the KPI cards.
  if (index % 5 === 0) return 'Closed'
  if (index % 11 === 0) return 'Cancelled'
  return 'In Progress'
}

function mockSubmittedAt(c: (typeof cases)[number]): string {
  const d = new Date()
  d.setDate(d.getDate() - (c.daysOpen ?? 0))
  return d.toISOString()
}

export function mockComplaintRows(): ComplaintRow[] {
  return cases.map((c, i) => ({
    id: c.id,
    submittedAt: mockSubmittedAt(c),
    complaintType: c.category,
    status: mockStatus(c, i),
    workflowStage: c.status,
    priority: mockPriority(c),
    aiPriority: c.priority,
    aiCategory: c.category,
    assignedDepartment: DEPARTMENT_BY_CATEGORY[c.category] ?? 'General Municipal Services',
    departmentUnit: `${c.ward} unit`,
    wardOrArea: c.ward,
    address: c.address,
    description: c.summary,
    aiSummary: c.summary,
    recommendedAction: c.recommendedAction,
  }))
}

export function mockComplaintFilterOptions(): ComplaintFilterOptions {
  const rows = mockComplaintRows()
  const uniq = (values: string[]) => Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
  return {
    statuses: uniq(rows.map((r) => r.status)),
    priorities: uniq(rows.map((r) => r.priority)),
    departments: uniq(rows.map((r) => r.assignedDepartment)),
    categories: uniq(rows.map((r) => r.aiCategory)),
    wards: uniq(rows.map((r) => r.wardOrArea)),
  }
}

export function mockComplaintKpis(): ComplaintKpis {
  const rows = mockComplaintRows()
  const count = (pred: (r: ComplaintRow) => boolean) => rows.filter(pred).length
  return {
    total_cases: rows.length,
    in_progress_cases: count((r) => r.status === 'In Progress'),
    new_or_initiated_cases: count((r) => r.status === 'New'),
    closed_or_completed_cases: count((r) => r.status === 'Closed'),
    cancelled_cases: count((r) => r.status === 'Cancelled'),
    complaint_types: new Set(rows.map((r) => r.complaintType)).size,
    departments: new Set(rows.map((r) => r.assignedDepartment)).size,
    wards_or_areas: new Set(rows.map((r) => r.wardOrArea)).size,
  }
}

export function mockDepartmentWorkload(): DepartmentWorkload[] {
  const rows = mockComplaintRows()
  const byDept = new Map<string, DepartmentWorkload>()
  for (const r of rows) {
    const dept = r.assignedDepartment
    const entry =
      byDept.get(dept) ??
      { assigned_department: dept, case_count: 0, closed_or_completed_count: 0, in_progress_count: 0 }
    entry.case_count += 1
    if (r.status === 'Closed') entry.closed_or_completed_count += 1
    if (r.status === 'In Progress') entry.in_progress_count += 1
    byDept.set(dept, entry)
  }
  return Array.from(byDept.values())
    .sort((a, b) => b.case_count - a.case_count)
    .slice(0, 10)
}

export function mockComplaintTypes(): ComplaintTypeCount[] {
  const rows = mockComplaintRows()
  const byType = new Map<string, ComplaintTypeCount>()
  for (const r of rows) {
    const key = r.complaintType
    const entry = byType.get(key) ?? { complaint_type: key, ai_category: r.aiCategory, case_count: 0 }
    entry.case_count += 1
    byType.set(key, entry)
  }
  return Array.from(byType.values())
    .sort((a, b) => b.case_count - a.case_count)
    .slice(0, 10)
}

/** Mock workflow_stage counts derived from the bundled sample cases. */
export function mockWorkflowStageCounts(): WorkflowStageCount[] {
  const rows = mockComplaintRows()
  const byStage = new Map<string, WorkflowStageCount>()
  for (const r of rows) {
    const key = r.workflowStage || 'Needs review'
    const entry =
      byStage.get(key) ??
      { workflow_stage: key, case_count: 0, high_priority_count: 0, in_progress_count: 0, closed_count: 0 }
    entry.case_count += 1
    if (r.priority === 'High') entry.high_priority_count += 1
    if (r.status === 'In Progress') entry.in_progress_count += 1
    if (r.status === 'Closed' || r.status === 'Completed') entry.closed_count += 1
    byStage.set(key, entry)
  }
  return Array.from(byStage.values()).sort((a, b) => b.case_count - a.case_count)
}

/** Client-side equivalent of the server filters, for the mock fallback path. */
export function filterMockComplaints(rows: ComplaintRow[], filters: ComplaintFilters): ComplaintRow[] {
  const { status, priority, department, category, ward, search, sort = 'submitted_at' } = filters
  const q = search?.trim().toLowerCase()
  const matches = (sel: string | undefined, value: string) => !sel || sel === 'All' || sel === value
  return rows
    .filter((r) => matches(status, r.status))
    .filter((r) => matches(priority, r.priority))
    .filter((r) => matches(department, r.assignedDepartment))
    .filter((r) => matches(category, r.aiCategory))
    .filter((r) => matches(ward, r.wardOrArea))
    .filter((r) => {
      if (!q) return true
      return (
        r.id.toLowerCase().includes(q) ||
        r.complaintType.toLowerCase().includes(q) ||
        r.assignedDepartment.toLowerCase().includes(q) ||
        r.wardOrArea.toLowerCase().includes(q) ||
        r.address.toLowerCase().includes(q) ||
        r.aiCategory.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      if (sort === 'priority' || sort === 'operational_priority') return compareByOperationalPriority(a, b)
      if (sort === 'status') return a.status.localeCompare(b.status)
      // submitted_at — newest first
      return (b.submittedAt ?? '').localeCompare(a.submittedAt ?? '')
    })
}

/**
 * Operational triage rank for a priority value: High first (0), then Medium (1),
 * then Low (2), then anything unknown or blank (3). This is the order municipal
 * staff should work a triage queue in — not the alphabetical order of the raw
 * priority text column.
 */
export function operationalPriorityRank(priority: string | null | undefined): number {
  const p = (priority ?? '').toLowerCase()
  if (p.includes('high') || p.includes('urgent') || p === 'p1') return 0
  if (p.includes('medium') || p === 'p2' || p === 'p3') return 1
  if (p.includes('low') || p === 'p4') return 2
  return 3
}

/** Compare two rows by operational priority, newest-first within the same tier. */
function compareByOperationalPriority(a: ComplaintRow, b: ComplaintRow): number {
  const rank = operationalPriorityRank(a.priority) - operationalPriorityRank(b.priority)
  if (rank !== 0) return rank
  return (b.submittedAt ?? '').localeCompare(a.submittedAt ?? '')
}

/** Stable operational-priority ordering for an already-fetched set of rows. */
function sortByOperationalPriority(rows: ComplaintRow[]): ComplaintRow[] {
  return [...rows].sort(compareByOperationalPriority)
}

// ---------------------------------------------------------------------------
// AI assisted staff review (Claude, server-side only)
// ---------------------------------------------------------------------------
//
// The Anthropic API key lives ONLY in the server-side Netlify function. The
// browser never sees it: the client posts the selected case's allow-listed
// fields to the function and receives structured JSON back. This is decision
// support only — it never replaces the rule based POC triage and never makes a
// final enforcement decision. Staff review is always required.

/** Endpoint of the server-side Netlify function (reserved path, never shadowed). */
const CASE_AI_REVIEW_ENDPOINT = '/.netlify/functions/generate-case-ai-review'

/** Exactly the fields of the single selected case that are sent to the server. */
export type CaseAiReviewInput = {
  case_id: string
  complaint_type: string
  description: string
  status: string
  workflow_stage: string
  priority: string
  department: string
  ward_or_area: string
  ai_category: string
  ai_summary: string
  ai_recommended_action: string
}

/** Structured review returned by the function. */
export type CaseAiReviewResult = {
  staff_summary: string
  recommended_next_action: string
  missing_information: string
  resident_response_draft: string
  priority_rationale: string
  human_review_note: string
}

export type CaseAiReviewResponse = {
  case_id: string
  model: string
  prompt_version: string
  result: CaseAiReviewResult
}

/** A persisted row in public.case_ai_reviews. */
export type CaseAiReviewRow = {
  id: string
  case_id: string
  model: string
  prompt_version: string
  result_json: CaseAiReviewResult
  created_at: string | null
}

const EMPTY_FIELD = ''

/** Map the live complaint detail row to the exact server input fields. */
export function caseAiReviewInputFromComplaint(row: MunicipalComplaintRow): CaseAiReviewInput {
  return {
    case_id: row.case_id,
    complaint_type: row.complaint_type ?? EMPTY_FIELD,
    description: row.description ?? EMPTY_FIELD,
    status: row.status ?? EMPTY_FIELD,
    workflow_stage: row.workflow_stage ?? EMPTY_FIELD,
    priority: row.priority ?? EMPTY_FIELD,
    department: row.assigned_department ?? EMPTY_FIELD,
    ward_or_area: row.ward_or_area ?? EMPTY_FIELD,
    ai_category: row.ai_category ?? EMPTY_FIELD,
    ai_summary: row.ai_summary ?? EMPTY_FIELD,
    ai_recommended_action: row.ai_recommended_action ?? EMPTY_FIELD,
  }
}

/** Map the queue/preview view-model row to the exact server input fields. */
export function caseAiReviewInputFromRow(row: ComplaintRow): CaseAiReviewInput {
  return {
    case_id: row.id,
    complaint_type: row.complaintType ?? EMPTY_FIELD,
    description: row.description ?? EMPTY_FIELD,
    status: row.status ?? EMPTY_FIELD,
    workflow_stage: row.workflowStage ?? EMPTY_FIELD,
    priority: row.priority ?? EMPTY_FIELD,
    department: row.assignedDepartment ?? EMPTY_FIELD,
    ward_or_area: row.wardOrArea ?? EMPTY_FIELD,
    ai_category: row.aiCategory ?? EMPTY_FIELD,
    ai_summary: row.aiSummary ?? EMPTY_FIELD,
    ai_recommended_action: row.recommendedAction ?? EMPTY_FIELD,
  }
}

/**
 * Call the server-side Netlify function to generate an AI assisted staff review
 * for a SINGLE selected case. Only ever invoked from an explicit staff click —
 * never on page load and never for the queue list.
 */
export async function generateCaseAiReview(input: CaseAiReviewInput): Promise<CaseAiReviewResponse> {
  const res = await fetch(CASE_AI_REVIEW_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })

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
        : `AI review failed (status ${res.status}).`
    throw new Error(message)
  }

  return payload as CaseAiReviewResponse
}

/**
 * Persist a generated review into public.case_ai_reviews. Best-effort: the
 * generated review is still shown to staff even if persistence fails (for
 * example before the migration is applied), so a failure here is surfaced but
 * not fatal to the caller.
 */
export async function saveCaseAiReview(review: CaseAiReviewResponse): Promise<CaseAiReviewRow> {
  const client = requireClient()
  const { data, error } = await client
    .from(CASE_AI_REVIEWS_TABLE)
    .insert({
      case_id: review.case_id,
      model: review.model,
      prompt_version: review.prompt_version,
      result_json: review.result,
    })
    .select()
    .single()

  if (error) throw error
  return data as CaseAiReviewRow
}

/** Most recent persisted AI review for a case, or null if none/unavailable. */
export async function getLatestCaseAiReview(caseId: string): Promise<CaseAiReviewRow | null> {
  const client = requireClient()
  const { data, error } = await client
    .from(CASE_AI_REVIEWS_TABLE)
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as CaseAiReviewRow) ?? null
}
