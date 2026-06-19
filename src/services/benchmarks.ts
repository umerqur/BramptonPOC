// Plain-language NYC 311 benchmark context, derived from the closed public NYC
// 311 history. These constants give case-level priority explanations and KPI
// cards a human reference point ("is this slow or normal?") without statistical
// jargon. Live aggregates (v_insights_kpis) carry the exact figures for the
// Insights dashboard; these constants are the stable reference used where a live
// fetch would be overkill (e.g. a single case page).

/** Typical time a similar historical case took to close (plain "typical", not a mean label). */
export const NYC_TYPICAL_CLOSURE_DAYS = 6.5

/**
 * Slow-case threshold: most similar historical cases closed within this many
 * days. Deliberately phrased operationally — we never surface "P90" to staff.
 */
export const NYC_SLOW_CASE_THRESHOLD_DAYS = 14

/**
 * Build a plain-language, case-level priority explanation from a case's age.
 * Returns null when the age is unknown. Example:
 *   "This case is 30.6 days old."
 *   "Similar historical cases usually closed in 6.5 days."
 *   "This case is slower than typical, so it is prioritized for review."
 */
export function buildCasePriorityContext(ageDays: number | null): string[] | null {
  if (ageDays == null || !Number.isFinite(ageDays)) return null
  const lines = [
    `This case is ${ageDays.toFixed(1)} days old.`,
    `Similar historical cases usually closed in ${NYC_TYPICAL_CLOSURE_DAYS} days.`,
  ]
  if (ageDays > NYC_SLOW_CASE_THRESHOLD_DAYS) {
    lines.push('This case is past the slow-case threshold, so it is prioritized for review.')
  } else if (ageDays > NYC_TYPICAL_CLOSURE_DAYS) {
    lines.push('This case is slower than typical, so it is prioritized for review.')
  } else {
    lines.push('This case is still within the typical closure window.')
  }
  return lines
}
