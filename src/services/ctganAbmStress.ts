import { supabase, isSupabaseConfigured } from '../lib/supabase'

const LATEST_RUN_VIEW = 'v_ctgan_abm_latest_run_summary'
const SCENARIO_SUMMARY_VIEW = 'v_ctgan_abm_scenario_summary'
const DAILY_SUMMARY_VIEW = 'v_ctgan_abm_daily_summary'
const DISTRICT_PRESSURE_VIEW = 'v_ctgan_abm_district_pressure'
const COMPLAINT_TYPE_PRESSURE_VIEW = 'v_ctgan_abm_complaint_type_pressure'

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
