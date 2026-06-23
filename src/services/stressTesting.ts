import { supabase, isSupabaseConfigured } from '../lib/supabase'

// Stress Testing — synthetic field-workload readers for the Simulation Lab.
//
// These functions read four small, precomputed aggregate views over
// public.synthetic_patrol_logs. The underlying rows are SYNTHETIC field
// activity generated from public NYC 311 benchmark patterns — they are NOT
// Brampton operational data and NOT a record of real officer performance.
// The app only ever reads these compact aggregates, never the raw rows, and
// never writes. This powers capacity planning and stress testing only; it does
// not make enforcement decisions and does not score officers.
//
// There is NO hardcoded fallback data: when a view cannot be loaded the caller
// surfaces a clear "Live data unavailable" state rather than inventing numbers.

const WORKLOAD_BY_OFFICER_UNIT_VIEW = 'v_synthetic_patrol_workload_by_officer_unit'
const WORKLOAD_BY_DISTRICT_VIEW = 'v_synthetic_patrol_workload_by_district'
const WORKLOAD_BY_CLOSURE_BUCKET_VIEW = 'v_synthetic_patrol_workload_by_closure_bucket'
const WORKLOAD_BY_COMPLAINT_TYPE_VIEW = 'v_synthetic_patrol_workload_by_complaint_type'

function requireClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Live data service is not configured')
  }
  return supabase
}

// A view aggregate may arrive as a Postgres numeric (string) or number; normalize.
function num(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : (value as number)
  return Number.isFinite(n) ? n : 0
}

function str(value: unknown, fallback: string): string {
  if (value == null) return fallback
  const s = String(value).trim()
  return s.length > 0 ? s : fallback
}

// Shared numeric workload measures present on every view.
type WorkloadMeasures = {
  log_count: number
  case_count: number
  estimated_minutes: number
  estimated_hours: number
  supervisor_review_count: number
}

export type OfficerUnitWorkload = WorkloadMeasures & { officer_unit: string }
export type DistrictWorkload = WorkloadMeasures & { district_or_area: string }
export type ClosureBucketWorkload = WorkloadMeasures & { closure_bucket: string }
export type ComplaintTypeWorkload = WorkloadMeasures & { complaint_type: string }

// The four views expose the same measure columns; map them once.
function mapMeasures(r: Record<string, unknown>): WorkloadMeasures {
  return {
    log_count: num(r.log_count),
    case_count: num(r.case_count),
    estimated_minutes: num(r.estimated_minutes),
    estimated_hours: num(r.estimated_hours),
    supervisor_review_count: num(r.supervisor_review_count),
  }
}

const MEASURE_COLUMNS = 'log_count, case_count, estimated_minutes, estimated_hours, supervisor_review_count'

/** Synthetic workload by officer unit, ranked by estimated field hours (desc). */
export async function getWorkloadByOfficerUnit(): Promise<OfficerUnitWorkload[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(WORKLOAD_BY_OFFICER_UNIT_VIEW)
    .select(`officer_unit, ${MEASURE_COLUMNS}`)
    .order('estimated_hours', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    officer_unit: str(r.officer_unit, 'Unassigned'),
    ...mapMeasures(r),
  }))
}

/** Synthetic workload by district/area, ranked by estimated field hours (desc). */
export async function getWorkloadByDistrict(): Promise<DistrictWorkload[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(WORKLOAD_BY_DISTRICT_VIEW)
    .select(`district_or_area, ${MEASURE_COLUMNS}`)
    .order('estimated_hours', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    district_or_area: str(r.district_or_area, 'Unknown'),
    ...mapMeasures(r),
  }))
}

/** Synthetic workload by closure-timing bucket, ranked by estimated field hours (desc). */
export async function getWorkloadByClosureBucket(): Promise<ClosureBucketWorkload[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(WORKLOAD_BY_CLOSURE_BUCKET_VIEW)
    .select(`closure_bucket, ${MEASURE_COLUMNS}`)
    .order('estimated_hours', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    closure_bucket: str(r.closure_bucket, 'Unknown'),
    ...mapMeasures(r),
  }))
}

/** Synthetic workload by complaint type, ranked by estimated field hours (desc). */
export async function getWorkloadByComplaintType(): Promise<ComplaintTypeWorkload[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(WORKLOAD_BY_COMPLAINT_TYPE_VIEW)
    .select(`complaint_type, ${MEASURE_COLUMNS}`)
    .order('estimated_hours', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    complaint_type: str(r.complaint_type, 'Uncategorized'),
    ...mapMeasures(r),
  }))
}
