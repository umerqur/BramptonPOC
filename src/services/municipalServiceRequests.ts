import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { cases } from '../data/mockCases'

// Primary data source for the authenticated Brampton complaint workflow app.
// Toronto 311 public benchmark complaints are loaded into `municipal_complaints`
// to demonstrate the complaint workflow; Brampton GeoHub ward boundaries provide
// real local context. This is not Brampton operational complaint data.
export const COMPLAINTS_TABLE = 'municipal_complaints'
export const WARDS_TABLE = 'brampton_ward_boundaries'
export const WORKFLOW_EVENTS_TABLE = 'workflow_events'
export const AI_TRIAGE_TABLE = 'ai_triage_results'

/**
 * Standard advisory disclaimer for AI-assisted triage. The current POC triage is
 * rule based using existing columns in `municipal_complaints` — it is decision
 * support only, never a final enforcement decision.
 */
export const TRIAGE_ADVISORY =
  'AI-assisted triage is rule based POC decision support only. It is not a final enforcement decision. Authorized municipal staff review and decide every case.'

/** Product positioning note used across the authenticated app. */
export const DATA_POSITIONING =
  'Toronto 311 public benchmark data is used to demonstrate the complaint workflow. Brampton GeoHub ward boundaries provide real local context. This is not Brampton operational complaint data.'

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
  aiCategory: string
  assignedDepartment: string
  departmentUnit: string
  wardOrArea: string
  address: string
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
  sort?: 'submitted_at' | 'priority' | 'status'
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
    aiCategory: row.ai_category || 'General municipal service',
    assignedDepartment: row.assigned_department || 'Unassigned',
    departmentUnit: row.department_unit || 'Unassigned',
    wardOrArea: row.ward_or_area || row.fsa_or_area || 'Unknown',
    address: row.address_or_location || row.fsa_or_area || 'Location not recorded',
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

  const ascending = sort === 'submitted_at' ? false : true
  const { data, error } = await query.order(sort, { ascending, nullsFirst: false }).limit(limit)

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
// Synthetic Brampton ward workload scenario overlay
// ---------------------------------------------------------------------------

/**
 * A row in public.brampton_ward_workload_scenarios. SYNTHETIC, illustrative
 * workload keyed by Brampton ward name — NOT Brampton operational complaint
 * data. Used only to demonstrate the ward heatmap. Toronto 311 benchmark
 * records are never plotted onto Brampton wards.
 */
export type WardWorkloadScenario = {
  id: number
  ward: string
  scenario_name: string
  complaint_volume: number
  open_cases: number
  in_progress_cases: number
  closed_cases: number
  escalations: number
  top_category: string
  estimated_hours_saved: number
  source_note: string
}

export async function getWardWorkloadScenarios(): Promise<WardWorkloadScenario[]> {
  const client = requireClient()
  const { data, error } = await client
    .from('brampton_ward_workload_scenarios')
    .select(
      'id, ward, scenario_name, complaint_volume, open_cases, in_progress_cases, closed_cases, escalations, top_category, estimated_hours_saved, source_note',
    )
    .order('ward', { ascending: true })
  if (error) throw error
  return (data ?? []) as WardWorkloadScenario[]
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
    aiCategory: c.category,
    assignedDepartment: DEPARTMENT_BY_CATEGORY[c.category] ?? 'General Municipal Services',
    departmentUnit: `${c.ward} unit`,
    wardOrArea: c.ward,
    address: c.address,
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
      if (sort === 'priority') return priorityRank(b.priority) - priorityRank(a.priority)
      if (sort === 'status') return a.status.localeCompare(b.status)
      // submitted_at — newest first
      return (b.submittedAt ?? '').localeCompare(a.submittedAt ?? '')
    })
}

function priorityRank(priority: string): number {
  const order: Record<string, number> = { High: 3, Medium: 2, Low: 1 }
  return order[priority] ?? 0
}
