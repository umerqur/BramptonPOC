// Operational Pressure Model
//
// A DERIVED, planning-only scoring layer over the existing CTGAN + ABM stress
// outputs. It does NOT retrain anything, requires no Supabase reload, and reads
// only the per-scenario CTGAN ABM rows the Simulation Lab already loads.
//
// It is a municipal application of the general multi-channel pressure-threshold
// activation idea from the information-propagation literature (e.g. Granovetter
// 1978 / Watts 2002 threshold models): combine several weighted pressure signals
// into one score, and treat crossing a threshold as the entity "activating" into
// a watch or red zone. Here the domain is bylaw / 311 operations, the signals are
// municipal, and the score is a planning lens — NOT a causal model, NOT a
// forecast, and NEVER an enforcement decision. Every enforcement decision stays
// human reviewed.
//
// Conceptual formula (per entity i at time t):
//
//   P_i,t = αC·C_i,t + αL·L_i,t + αR·R_i,t + αQ·Q_i,t + αS·S_i,t
//
//   C = complaint category pressure        (demand mix / dominant category load)
//   L = location / district hotspot pressure (relative case load of the area)
//   R = repeat complaint pressure          (persistent / recurring aged load)
//   Q = queue and capacity pressure        (open backlog vs. throughput capacity)
//   S = severity / safety pressure         (overload flag + workload intensity)
//
// Each channel is normalized to [0,1] across the scenario, so P falls in [0,1].
// An entity enters WATCH at P >= OPERATIONAL_PRESSURE_WATCH_THRESHOLD and a RED
// ZONE at P >= OPERATIONAL_PRESSURE_RED_THRESHOLD.
//
// Field provenance — existing CTGAN ABM fields only:
//   L <- total_cases ; Q <- backlog ; S <- overload_flag + estimated_hours ;
//   R <- stale_cases ; C <- scenario dominant complaint_type share.
// Where a clean municipal signal is not yet present in the CTGAN output (a true
// repeat-complaint count), a documented proxy is used (aged/stale load). This is
// planning support, not proof.

export const OPERATIONAL_PRESSURE_WEIGHTS = { C: 0.2, L: 0.25, R: 0.15, Q: 0.25, S: 0.15 } as const
export const OPERATIONAL_PRESSURE_WATCH_THRESHOLD = 0.4
export const OPERATIONAL_PRESSURE_RED_THRESHOLD = 0.7
export const OPERATIONAL_PRESSURE_FORMULA = 'P = αC·C + αL·L + αR·R + αQ·Q + αS·S'
export const OPERATIONAL_PRESSURE_MODEL_NAME = 'Operational Pressure Model'

export type PressureChannels = { C: number; L: number; R: number; Q: number; S: number }
export type PressureZone = 'normal' | 'watch' | 'red'

export type DistrictInput = {
  district_or_area: string
  total_cases: number
  backlog: number
  stale_cases: number
  overload_flag: number
  estimated_hours: number
}

export type ComplaintInput = { complaint_type: string; total_cases: number; estimated_hours: number }

export type ScoredDistrict = DistrictInput & {
  channels: PressureChannels
  /** Combined pressure P in [0,1]. */
  pressure: number
  zone: PressureZone
  /** The channel contributing the most to P (αk·channelₖ), i.e. the lever. */
  dominantChannel: keyof PressureChannels
}

export const CHANNEL_LABELS: Record<keyof PressureChannels, string> = {
  C: 'Complaint category',
  L: 'District hotspot',
  R: 'Repeat pressure',
  Q: 'Queue & capacity',
  S: 'Severity / safety',
}

export function classifyZone(p: number): PressureZone {
  if (p >= OPERATIONAL_PRESSURE_RED_THRESHOLD) return 'red'
  if (p >= OPERATIONAL_PRESSURE_WATCH_THRESHOLD) return 'watch'
  return 'normal'
}

/** Max of a list, floored at 1 so it is always a safe divisor. */
function safeMax(xs: number[]): number {
  return xs.reduce((m, x) => Math.max(m, x), 0) || 1
}

/**
 * Score every district in one scenario with the Operational Pressure Model.
 * Channels are normalized across the scenario's districts; the dominant complaint
 * category contributes a single scenario-level C term. Returns rows sorted by
 * descending pressure.
 */
export function scoreDistricts(districts: DistrictInput[], complaints: ComplaintInput[]): ScoredDistrict[] {
  if (districts.length === 0) return []

  const maxTotal = safeMax(districts.map((d) => d.total_cases))
  const maxBacklog = safeMax(districts.map((d) => d.backlog))
  const maxStale = safeMax(districts.map((d) => d.stale_cases))
  const maxHours = safeMax(districts.map((d) => d.estimated_hours))

  // C is a scenario-level demand-mix signal: the share of the most-demanded
  // complaint category. Shared across districts (same scenario demand mix).
  const demandTotal = complaints.reduce((n, c) => n + c.total_cases, 0)
  const topComplaint = complaints.reduce<ComplaintInput | null>(
    (best, c) => (best == null || c.total_cases > best.total_cases ? c : best),
    null,
  )
  const C = demandTotal > 0 && topComplaint ? topComplaint.total_cases / demandTotal : 0

  return districts
    .map((d) => {
      const L = d.total_cases / maxTotal
      const Q = d.backlog / maxBacklog
      const R = d.stale_cases / maxStale
      // Severity: an overloaded district is maximal; otherwise scale by workload
      // intensity (estimated hours) so heavier areas read as more severe.
      const S = Math.max(d.overload_flag === 1 ? 1 : 0, d.estimated_hours / maxHours)
      const channels: PressureChannels = { C, L, R, Q, S }

      const pressure =
        OPERATIONAL_PRESSURE_WEIGHTS.C * C +
        OPERATIONAL_PRESSURE_WEIGHTS.L * L +
        OPERATIONAL_PRESSURE_WEIGHTS.R * R +
        OPERATIONAL_PRESSURE_WEIGHTS.Q * Q +
        OPERATIONAL_PRESSURE_WEIGHTS.S * S

      const dominantChannel = (Object.keys(channels) as (keyof PressureChannels)[]).reduce(
        (best, k) =>
          OPERATIONAL_PRESSURE_WEIGHTS[k] * channels[k] > OPERATIONAL_PRESSURE_WEIGHTS[best] * channels[best]
            ? k
            : best,
        'Q' as keyof PressureChannels,
      )

      return { ...d, channels, pressure, zone: classifyZone(pressure), dominantChannel }
    })
    .sort((a, b) => b.pressure - a.pressure)
}

export type Mitigation = { title: string; body: string }

/**
 * One data-grounded mitigation, keyed off the dominant pressure channel of the
 * highest-pressure district (with a supervisor-queue override). A planning
 * heuristic — not a causal claim and not an enforcement instruction.
 */
export function recommendMitigation(
  source: ScoredDistrict | null,
  supervisorShare: number,
  redCount: number,
): Mitigation {
  if (supervisorShare >= 0.5) {
    return {
      title: 'Increase supervisor review capacity',
      body: 'The review queue holds a large share of in-flight work, so adding sign-off capacity clears more backlog here than adding field time.',
    }
  }
  if (!source) {
    return {
      title: 'Add officer field capacity',
      body: 'Backlog is demand-driven across districts; additional officer minutes clear it most directly.',
    }
  }
  switch (source.dominantChannel) {
    case 'S':
      return {
        title: 'Prioritize the overloaded / safety-pressured districts',
        body: `Severity pressure leads in ${source.district_or_area}. Direct field capacity and a safety-first triage to the ${redCount || 'top'} red-zone district(s) before lower-pressure areas.`,
      }
    case 'R':
      return {
        title: 'Add a stale / repeat-case triage pass',
        body: `Repeat and aged-case pressure leads in ${source.district_or_area}. A dedicated triage of the oldest cases shortens the stale tail before it compounds.`,
      }
    case 'L':
      return {
        title: `Surge officer minutes to ${source.district_or_area}`,
        body: 'Demand is concentrated in this district hotspot; re-allocating field minutes there reduces overload fastest.',
      }
    case 'C':
      return {
        title: 'Run a category-targeted response',
        body: 'A single complaint category dominates demand; a targeted crew or response template for that category clears the most cases per officer hour.',
      }
    case 'Q':
    default:
      return {
        title: 'Add officer field capacity',
        body: `Queue and capacity pressure leads in ${source.district_or_area}; additional officer minutes clear the open backlog most directly.`,
      }
  }
}
