import { supabase, isSupabaseConfigured } from '../lib/supabase'

// Synthetic patrol activity reader for the NYC case detail page.
//
// This reads public.synthetic_patrol_logs — a SIMULATED field-activity log
// generated from NYC 311 benchmark timing and status patterns. It is NOT
// Brampton operational patrol history and NOT an automated enforcement record.
// It exists to demonstrate how an officer patrol timeline could look once real
// Brampton operational data is connected.
//
// Rows are keyed to a case by case_id (the NYC case id) and ordered by
// log_sequence. The reader returns an empty array when a case has no synthetic
// activity; the caller renders a calm "no activity" state rather than an error.

const SYNTHETIC_PATROL_LOGS_TABLE = 'synthetic_patrol_logs'

function requireClient() {
  if (!isSupabaseConfigured || !supabase) throw new Error('Live data service is not configured')
  return supabase
}

export type SyntheticPatrolLog = {
  log_sequence: number
  activity_at: string | null
  patrol_activity_type: string | null
  patrol_status: string | null
  officer_unit: string | null
  outcome_summary: string | null
  recommended_next_step: string | null
}

/** A view aggregate may arrive as a Postgres int (string) or number; normalize. */
function num(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : (value as number)
  return Number.isFinite(n) ? n : 0
}

function str(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s.length > 0 ? s : null
}

/**
 * Synthetic patrol activity for one NYC case, ordered by log_sequence ascending.
 * Returns [] when the case has no synthetic activity. Throws on a real service
 * error so the caller can distinguish "no activity" from "could not load".
 */
export async function getSyntheticPatrolLogs(caseId: string): Promise<SyntheticPatrolLog[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(SYNTHETIC_PATROL_LOGS_TABLE)
    .select(
      'log_sequence, activity_at, patrol_activity_type, patrol_status, officer_unit, outcome_summary, recommended_next_step',
    )
    .eq('case_id', caseId)
    .order('log_sequence', { ascending: true })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    log_sequence: num(r.log_sequence),
    activity_at: str(r.activity_at),
    patrol_activity_type: str(r.patrol_activity_type),
    patrol_status: str(r.patrol_status),
    officer_unit: str(r.officer_unit),
    outcome_summary: str(r.outcome_summary),
    recommended_next_step: str(r.recommended_next_step),
  }))
}
