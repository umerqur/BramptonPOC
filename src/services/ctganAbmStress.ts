import { supabase, isSupabaseConfigured } from '../lib/supabase'

// All reads are scoped to the LATEST CTGAN ABM run via the latest-run views
// (migration 035). The older all-run aggregate views are left in place for
// compatibility but are intentionally not read here — mixing a single run's
// header with all-run totals is exactly the incoherence this module avoids.
const LATEST_RUN_SUMMARY_VIEW = 'v_ctgan_abm_latest_run_summary'
const SCENARIO_SUMMARY_VIEW = 'v_ctgan_abm_scenario_summary'
const LATEST_DAILY_METRICS_VIEW = 'v_ctgan_abm_latest_daily_metrics'
const LATEST_DISTRICT_PRESSURE_VIEW = 'v_ctgan_abm_latest_district_pressure'
const LATEST_COMPLAINT_TYPE_PRESSURE_VIEW = 'v_ctgan_abm_latest_complaint_type_pressure'

function requireClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Live data service is not configured')
  }
  return supabase
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}

function str(v: unknown, fallback = ''): string {
  if (v == null) return fallback
  const s = String(v).trim()
  return s.length ? s : fallback
}

// One row of the latest run's daily ABM time series.
export type CtganDailyMetricRow = {
  day: string
  total_cases: number
  processed: number
  backlog: number
  stale_cases: number
  supervisor_queue_size: number
}

export type CtganDistrictPressureRow = {
  district_or_area: string
  total_cases: number
  backlog: number
  stale_cases: number
  overload_flag: number
  estimated_hours: number
  share_of_cases: number
}

export type CtganComplaintTypePressureRow = {
  complaint_type: string
  total_cases: number
  estimated_hours: number
  share_of_cases: number
}

// Returns null when no run has been loaded yet (the view is empty) rather than
// throwing — an empty framework is a valid "pending load" state, not an error.
export async function getCtganLatestRunSummary(): Promise<Record<string, unknown> | null> {
  const client = requireClient()
  const { data, error } = await client.from(LATEST_RUN_SUMMARY_VIEW).select('*').limit(1).maybeSingle()
  if (error) throw error
  return (data ?? null) as Record<string, unknown> | null
}

export async function getCtganScenarioSummary(): Promise<Record<string, unknown>[]> {
  const client = requireClient()
  const { data, error } = await client.from(SCENARIO_SUMMARY_VIEW).select('*')
  if (error) throw error
  return (data ?? []) as Record<string, unknown>[]
}

export async function getCtganLatestDailyMetrics(): Promise<CtganDailyMetricRow[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(LATEST_DAILY_METRICS_VIEW)
    .select('day, total_cases, processed, backlog, stale_cases, supervisor_queue_size')
    .order('day', { ascending: true })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    day: String(r.day),
    total_cases: num(r.total_cases),
    processed: num(r.processed),
    backlog: num(r.backlog),
    stale_cases: num(r.stale_cases),
    supervisor_queue_size: num(r.supervisor_queue_size),
  }))
}

export async function getCtganLatestDistrictPressure(): Promise<CtganDistrictPressureRow[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(LATEST_DISTRICT_PRESSURE_VIEW)
    .select('*')
    .order('total_cases', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    district_or_area: str(r.district_or_area, 'Unknown'),
    total_cases: num(r.total_cases),
    backlog: num(r.backlog),
    stale_cases: num(r.stale_cases),
    overload_flag: num(r.overload_flag),
    estimated_hours: num(r.estimated_hours),
    share_of_cases: num(r.share_of_cases),
  }))
}

export async function getCtganLatestComplaintTypePressure(): Promise<CtganComplaintTypePressureRow[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(LATEST_COMPLAINT_TYPE_PRESSURE_VIEW)
    .select('*')
    .order('total_cases', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    complaint_type: str(r.complaint_type, 'Uncategorized'),
    total_cases: num(r.total_cases),
    estimated_hours: num(r.estimated_hours),
    share_of_cases: num(r.share_of_cases),
  }))
}
