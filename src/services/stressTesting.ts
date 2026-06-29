import { supabase, isSupabaseConfigured } from '../lib/supabase'

// Stress Testing — synthetic field-workload readers for the Stress Testing tab.
//
// These functions read four small, precomputed aggregate views over
// public.synthetic_patrol_logs (migration 032). The underlying rows are
// SYNTHETIC, rules-based field activity estimated from public NYC 311 benchmark
// cases — they are NOT Brampton operational data and NOT a record of real
// officer performance. The app only ever reads these compact aggregates, never
// the raw rows, and never writes. They power capacity planning and stress
// testing only; they do not make enforcement decisions and do not score officers.
//
// There is NO hardcoded fallback data: when a view cannot be loaded the caller
// surfaces a clear "pending / unavailable" state rather than inventing numbers.
//
// Column names below mirror migration 032 exactly (total_logs, distinct_cases,
// total_estimated_hours, supervisor_review_count, …) so a select never asks for
// a column the view does not expose.

const WORKLOAD_BY_OFFICER_UNIT_VIEW = 'v_synthetic_patrol_workload_by_officer_unit'
const WORKLOAD_BY_DISTRICT_VIEW = 'v_synthetic_patrol_workload_by_district'

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

// Shared synthetic-workload measures present on the officer-unit and district views.
type WorkloadMeasures = {
  total_logs: number
  distinct_cases: number
  total_estimated_minutes: number
  total_estimated_hours: number
  avg_estimated_minutes: number
  supervisor_review_count: number
}

export type OfficerUnitWorkload = WorkloadMeasures & { officer_unit: string }
export type DistrictWorkload = WorkloadMeasures & {
  district_or_area: string
  distinct_officer_units: number
}

function mapMeasures(r: Record<string, unknown>): WorkloadMeasures {
  return {
    total_logs: num(r.total_logs),
    distinct_cases: num(r.distinct_cases),
    total_estimated_minutes: num(r.total_estimated_minutes),
    total_estimated_hours: num(r.total_estimated_hours),
    avg_estimated_minutes: num(r.avg_estimated_minutes),
    supervisor_review_count: num(r.supervisor_review_count),
  }
}

const MEASURE_COLUMNS =
  'total_logs, distinct_cases, total_estimated_minutes, total_estimated_hours, avg_estimated_minutes, supervisor_review_count'

/** Synthetic workload by officer unit, ranked by estimated field hours (desc). */
export async function getWorkloadByOfficerUnit(): Promise<OfficerUnitWorkload[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(WORKLOAD_BY_OFFICER_UNIT_VIEW)
    .select(`officer_unit, ${MEASURE_COLUMNS}`)
    .order('total_estimated_hours', { ascending: false })
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
    .select(`district_or_area, distinct_officer_units, ${MEASURE_COLUMNS}`)
    .order('total_estimated_hours', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    district_or_area: str(r.district_or_area, 'Unknown'),
    distinct_officer_units: num(r.distinct_officer_units),
    ...mapMeasures(r),
  }))
}
