import { supabase, isSupabaseConfigured } from '../lib/supabase'

const LATEST_RUN_VIEW = 'v_ctgan_abm_latest_run_summary'
const SCENARIO_SUMMARY_VIEW = 'v_ctgan_abm_scenario_summary'
const DAILY_SUMMARY_VIEW = 'v_ctgan_abm_daily_summary'
const DISTRICT_PRESSURE_VIEW = 'v_ctgan_abm_district_pressure'
const COMPLAINT_TYPE_PRESSURE_VIEW = 'v_ctgan_abm_complaint_type_pressure'

// Per-scenario views (migration 035) — let the Simulation Lab read one
// calibrated scenario at a time. Public 311 benchmark synthetic demand for
// capacity planning / decision support only; not live Brampton data, not
// enforcement decisioning.
const SCENARIO_OPTIONS_VIEW = 'v_ctgan_abm_scenario_options'
const DAILY_BY_SCENARIO_VIEW = 'v_ctgan_abm_daily_by_scenario'
const DISTRICT_BY_SCENARIO_VIEW = 'v_ctgan_abm_district_pressure_by_scenario'
const COMPLAINT_BY_SCENARIO_VIEW = 'v_ctgan_abm_complaint_type_pressure_by_scenario'

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

export type CtganDistrictPressureRow = { district_or_area: string; total_cases: number; estimated_hours: number }
export type CtganComplaintTypePressureRow = { complaint_type: string; total_cases: number; estimated_hours: number }

// Returns null when no run has been loaded yet (the view is empty) rather than
// throwing — an empty framework is a valid "pending load" state, not an error.
export async function getCtganLatestRunSummary(): Promise<Record<string, unknown> | null> {
  const client = requireClient()
  const { data, error } = await client.from(LATEST_RUN_VIEW).select('*').limit(1).maybeSingle()
  if (error) throw error
  return (data ?? null) as Record<string, unknown> | null
}

export async function getCtganScenarioSummary(): Promise<Record<string, unknown>[]> {
  const client = requireClient()
  const { data, error } = await client.from(SCENARIO_SUMMARY_VIEW).select('*')
  if (error) throw error
  return (data ?? []) as Record<string, unknown>[]
}

export async function getCtganDailySummary(): Promise<{ day: string; total_cases: number }[]> {
  const client = requireClient()
  const { data, error } = await client.from(DAILY_SUMMARY_VIEW).select('day, total_cases')
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ day: String(r.day), total_cases: num(r.total_cases) }))
}

export async function getCtganDistrictPressure(): Promise<CtganDistrictPressureRow[]> {
  const client = requireClient()
  const { data, error } = await client.from(DISTRICT_PRESSURE_VIEW).select('*')
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    district_or_area: str(r.district_or_area, 'Unknown'),
    total_cases: num(r.total_cases),
    estimated_hours: num(r.estimated_hours),
  }))
}

export async function getCtganComplaintTypePressure(): Promise<CtganComplaintTypePressureRow[]> {
  const client = requireClient()
  const { data, error } = await client.from(COMPLAINT_TYPE_PRESSURE_VIEW).select('*')
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    complaint_type: str(r.complaint_type, 'Uncategorized'),
    total_cases: num(r.total_cases),
    estimated_hours: num(r.estimated_hours),
  }))
}

// ---------------------------------------------------------------------------
// Per-scenario reads (migration 035) — the Simulation Lab scenario selector.
// One calibrated scenario at a time: scenario dropdown, day slider, per-scenario
// district pressure (3D map / red-zone list) and complaint-type pressure.
// ---------------------------------------------------------------------------

export type CtganScenarioOption = {
  scenario_id: string
  name: string
  description: string
  run_id: string
  run_date: string
  generated_cases: number
  processed_cases: number
  closed_cases: number
  final_backlog: number
}

export type CtganDailyRow = {
  scenario_id: string
  run_id: string
  day: string
  total_cases: number
  processed: number
  backlog: number
  stale_cases: number
  supervisor_queue_size: number
}

export type CtganDistrictScenarioRow = {
  scenario_id: string
  run_id: string
  district_or_area: string
  total_cases: number
  backlog: number
  stale_cases: number
  /** Integer 0/1 (NOT boolean). A red zone is overload_flag === 1. */
  overload_flag: number
  estimated_hours: number
}

export type CtganComplaintScenarioRow = {
  scenario_id: string
  run_id: string
  complaint_type: string
  total_cases: number
  estimated_hours: number
}

// Scenario dropdown options (one row per scenario, joined to its run).
export async function getCtganScenarioOptions(): Promise<CtganScenarioOption[]> {
  const client = requireClient()
  const { data, error } = await client.from(SCENARIO_OPTIONS_VIEW).select('*')
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    scenario_id: str(r.scenario_id, 'unknown'),
    name: str(r.name, str(r.scenario_id, 'Scenario')),
    description: str(r.description),
    run_id: str(r.run_id),
    run_date: str(r.run_date),
    generated_cases: num(r.generated_cases),
    processed_cases: num(r.processed_cases),
    closed_cases: num(r.closed_cases),
    final_backlog: num(r.final_backlog),
  }))
}

// Daily trajectory for one scenario (drives the day slider + daily cards).
export async function getCtganDailyByScenario(scenarioId: string): Promise<CtganDailyRow[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(DAILY_BY_SCENARIO_VIEW)
    .select('*')
    .eq('scenario_id', scenarioId)
    .order('day', { ascending: true })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    scenario_id: str(r.scenario_id),
    run_id: str(r.run_id),
    day: str(r.day),
    total_cases: num(r.total_cases),
    processed: num(r.processed),
    backlog: num(r.backlog),
    stale_cases: num(r.stale_cases),
    supervisor_queue_size: num(r.supervisor_queue_size),
  }))
}

// End-of-run district pressure for one scenario (3D map + red-zone list).
export async function getCtganDistrictPressureByScenario(
  scenarioId: string,
): Promise<CtganDistrictScenarioRow[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(DISTRICT_BY_SCENARIO_VIEW)
    .select('*')
    .eq('scenario_id', scenarioId)
    .order('backlog', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    scenario_id: str(r.scenario_id),
    run_id: str(r.run_id),
    district_or_area: str(r.district_or_area, 'Unknown'),
    total_cases: num(r.total_cases),
    backlog: num(r.backlog),
    stale_cases: num(r.stale_cases),
    overload_flag: num(r.overload_flag),
    estimated_hours: num(r.estimated_hours),
  }))
}

// Complaint-type pressure for one scenario.
export async function getCtganComplaintTypePressureByScenario(
  scenarioId: string,
): Promise<CtganComplaintScenarioRow[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(COMPLAINT_BY_SCENARIO_VIEW)
    .select('*')
    .eq('scenario_id', scenarioId)
    .order('total_cases', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    scenario_id: str(r.scenario_id),
    run_id: str(r.run_id),
    complaint_type: str(r.complaint_type, 'Uncategorized'),
    total_cases: num(r.total_cases),
    estimated_hours: num(r.estimated_hours),
  }))
}
