// Stress model — turns the planning-simulation outputs into the operational
// answers the Stress Testing tab is built to give:
//
//   Where does the workload break, why does it break, and what should
//   supervisors do to avoid it?
//
// It reads the same latest-run pressure rows the 3D map uses (district load,
// backlog, stale cases, supervisor queue, daily series) and INTERPRETS them into
// a baseline reading, a projected trajectory, four named worst-case scenarios,
// and a per-district red-zone analysis with a recommended action.
//
// Everything here is deterministic and transparent — no randomness, no live
// Brampton data. The scenario stressors are fixed multipliers applied to the
// current benchmark workload, so the same run always yields the same reading.
// Staff-facing language only: baseline, scenario, pressure, red zone, bottleneck,
// recommended action.

import type {
  CtganDailyMetricRow,
  CtganDistrictPressureRow,
  CtganComplaintTypePressureRow,
} from '../../services/ctganAbmStress'
import type { DistrictWorkload } from '../../services/stressTesting'

// A district scores into the red zone at/above this pressure (0–100).
export const RED_ZONE_THRESHOLD = 70
// Watch band floor — below this is manageable.
export const WATCH_THRESHOLD = 40

export type PressureTier = 'manageable' | 'watch' | 'red'

export function pressureTier(score: number): PressureTier {
  if (score >= RED_ZONE_THRESHOLD) return 'red'
  if (score >= WATCH_THRESHOLD) return 'watch'
  return 'manageable'
}

export type Trajectory = 'rising' | 'stable' | 'easing'

export type ScenarioKey =
  | 'complaint_surge'
  | 'officer_capacity'
  | 'supervisor_bottleneck'
  | 'stale_accumulation'

export type ScenarioCard = {
  key: ScenarioKey
  name: string
  /** System pressure under this scenario, 0–100. */
  pressure: number
  /** Count of districts pushed into the red zone by this scenario. */
  districtsAffected: number
  /** District numbers most affected (highest scenario pressure first), trimmed. */
  affectedDistrictNumbers: string[]
  /** Plain-language cause. */
  why: string
  /** Recommended supervisor action. */
  action: string
  /** The bottleneck this scenario stresses. */
  bottleneck: string
}

export type RedZoneDistrict = {
  districtNumber: string
  label: string
  /** Current benchmark pressure, 0–100. */
  currentPressure: number
  /** Pressure under this district's worst scenario, 0–100. */
  scenarioPressure: number
  /** scenarioPressure − currentPressure. */
  change: number
  /** Heaviest complaint types this run (run-wide; per-district type breakdown is not modeled). */
  topComplaintTypes: string[]
  /** The dominant bottleneck for this district. */
  bottleneck: string
  /** Recommended mitigation, naming the district. */
  mitigation: string
  /** True when the simulation flagged this district as overloaded. */
  isOverloaded: boolean
  /** Optional synthetic-workload context, when the patrol workload view is loaded. */
  reviewFlagged?: number
  officerUnits?: number
}

export type StressModel = {
  hasData: boolean
  baselinePressure: number
  trajectory: Trajectory
  /** Backlog change across the horizon (final − early), for the trajectory copy. */
  trajectoryDelta: number
  worstCasePressure: number
  worstScenario: ScenarioCard | null
  redZoneCount: number
  redZoneDistricts: RedZoneDistrict[]
  failureDriver: string
  preventionAction: string
  scenarios: ScenarioCard[]
  topComplaintTypes: string[]
  // Interpretation panel beside the 3D map.
  whatChanged: string
  whyItMatters: string
  whatToDoNext: string
}

// --- helpers ----------------------------------------------------------------

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const round = (x: number) => Math.round(x)
const districtNumber = (s: string): string => s.match(/(\d+)\s*$/)?.[1] ?? s

// Per-district normalized pressure components (each 0–1 across the run's districts).
type DistrictComp = {
  row: CtganDistrictPressureRow
  number: string
  loadN: number
  backlogN: number
  staleN: number
  supN: number
}

// Composite weights — load and backlog dominate, stale and supervisor share add
// the second-order operational pain. They sum to 1 so the score lands in 0–100.
const W = { load: 0.4, backlog: 0.3, stale: 0.2, sup: 0.1 }

function composite(load: number, backlog: number, stale: number, sup: number): number {
  return 100 * (W.load * load + W.backlog * backlog + W.stale * stale + W.sup * sup)
}

// Fixed per-scenario stressors. Each amplifies the component its named stress
// would hit hardest, leaving the others near baseline. These are planning
// assumptions, surfaced in the UI, not fitted parameters.
const STRESSORS: Record<ScenarioKey, { load: number; backlog: number; stale: number; sup: number }> = {
  complaint_surge: { load: 1.6, backlog: 1.35, stale: 1.1, sup: 1.2 },
  officer_capacity: { load: 1.0, backlog: 1.7, stale: 1.35, sup: 1.1 },
  supervisor_bottleneck: { load: 1.0, backlog: 1.2, stale: 1.15, sup: 1.9 },
  stale_accumulation: { load: 1.0, backlog: 1.25, stale: 1.9, sup: 1.1 },
}

const SCENARIO_META: Record<ScenarioKey, { name: string; bottleneck: string }> = {
  complaint_surge: { name: 'Complaint surge', bottleneck: 'Incoming demand' },
  officer_capacity: { name: 'Officer capacity reduction', bottleneck: 'Officer capacity' },
  supervisor_bottleneck: { name: 'Supervisor review bottleneck', bottleneck: 'Supervisor review' },
  stale_accumulation: { name: 'Stale case accumulation', bottleneck: 'Stale backlog' },
}

function baseDistrictPressure(c: DistrictComp): number {
  let p = composite(c.loadN, c.backlogN, c.staleN, c.supN)
  if (c.row.overload_flag) p = Math.max(p, 72) // a flagged district always reads red
  return Math.min(100, p)
}

function scenarioDistrictPressure(c: DistrictComp, key: ScenarioKey): number {
  const s = STRESSORS[key]
  let p = composite(
    clamp01(c.loadN * s.load),
    clamp01(c.backlogN * s.backlog),
    clamp01(c.staleN * s.stale),
    clamp01(c.supN * s.sup),
  )
  if (c.row.overload_flag) p = Math.max(p, 75)
  return Math.min(100, p)
}

// System pressure from a set of district pressures: a blend of the worst district
// (what breaks first) and the average (how broad the pressure is).
function systemPressure(values: number[]): number {
  if (values.length === 0) return 0
  const max = Math.max(...values)
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return round(0.6 * max + 0.4 * mean)
}

// Which component drives a district — used to name its bottleneck and mitigation.
function dominantBottleneck(c: DistrictComp): ScenarioKey {
  const entries: [ScenarioKey, number][] = [
    ['supervisor_bottleneck', c.supN * 1.1],
    ['stale_accumulation', c.staleN],
    ['officer_capacity', c.backlogN],
    ['complaint_surge', c.loadN * 0.9],
  ]
  return entries.reduce((best, e) => (e[1] > best[1] ? e : best))[0]
}

function mitigationFor(key: ScenarioKey, districtLabel: string, topType?: string): string {
  const typeClause = topType ? ` Prioritize ${topType} cases` : ' Prioritize the highest-volume cases'
  switch (key) {
    case 'supervisor_bottleneck':
      return `Move review capacity toward ${districtLabel} and clear the oldest review-flagged cases first.${typeClause} before backlog compounds.`
    case 'stale_accumulation':
      return `Clear stale cases in ${districtLabel} first — they age into escalations if left.${typeClause} that are sitting unworked.`
    case 'officer_capacity':
      return `Add field capacity in ${districtLabel} so daily demand is worked down.${typeClause} before they queue.`
    case 'complaint_surge':
      return `Stage extra intake capacity in ${districtLabel} ahead of the surge.${typeClause} as volume climbs.`
  }
}

// --- builder ----------------------------------------------------------------

export function buildStressModel(input: {
  districtRows: CtganDistrictPressureRow[]
  dailyRows: CtganDailyMetricRow[]
  complaintRows: CtganComplaintTypePressureRow[]
  runSummary: Record<string, unknown> | null
  patrolByDistrict?: DistrictWorkload[]
}): StressModel {
  const { districtRows, dailyRows, complaintRows, patrolByDistrict } = input

  const topComplaintTypes = complaintRows.slice(0, 3).map((r) => r.complaint_type)

  const empty: StressModel = {
    hasData: false,
    baselinePressure: 0,
    trajectory: 'stable',
    trajectoryDelta: 0,
    worstCasePressure: 0,
    worstScenario: null,
    redZoneCount: 0,
    redZoneDistricts: [],
    failureDriver: '—',
    preventionAction: '—',
    scenarios: [],
    topComplaintTypes,
    whatChanged: '',
    whyItMatters: '',
    whatToDoNext: '',
  }

  if (districtRows.length === 0) return empty

  // Normalize each component across the districts present in this run.
  const maxLoad = Math.max(1, ...districtRows.map((r) => r.total_cases))
  const maxBacklog = Math.max(1, ...districtRows.map((r) => r.backlog))
  const maxStale = Math.max(1, ...districtRows.map((r) => r.stale_cases))
  const maxShare = Math.max(0.0001, ...districtRows.map((r) => r.share_of_cases))

  const comps: DistrictComp[] = districtRows.map((row) => ({
    row,
    number: districtNumber(row.district_or_area),
    loadN: clamp01(row.total_cases / maxLoad),
    backlogN: clamp01(row.backlog / maxBacklog),
    staleN: clamp01(row.stale_cases / maxStale),
    supN: clamp01(row.share_of_cases / maxShare),
  }))

  // Optional synthetic-workload enrichment, keyed by district number.
  const patrolByNum = new Map<string, DistrictWorkload>()
  for (const p of patrolByDistrict ?? []) patrolByNum.set(districtNumber(p.district_or_area), p)

  // Baseline = current benchmark workload.
  const baseScores = comps.map(baseDistrictPressure)
  const baselinePressure = systemPressure(baseScores)

  // Scenario cards — each a worst-case stress applied to the baseline.
  const keys: ScenarioKey[] = [
    'complaint_surge',
    'officer_capacity',
    'supervisor_bottleneck',
    'stale_accumulation',
  ]
  const scenarios: ScenarioCard[] = keys.map((key) => {
    const scored = comps.map((c) => ({ c, p: scenarioDistrictPressure(c, key) }))
    const affected = scored
      .filter((x) => x.p >= RED_ZONE_THRESHOLD)
      .sort((a, b) => b.p - a.p)
    const pressure = systemPressure(scored.map((x) => x.p))
    const topNums = affected.slice(0, 4).map((x) => x.c.number)
    const meta = SCENARIO_META[key]
    const lead = topNums[0] ? `District ${topNums[0]}` : 'the busiest districts'
    const topType = topComplaintTypes[0]
    return {
      key,
      name: meta.name,
      pressure,
      districtsAffected: affected.length,
      affectedDistrictNumbers: topNums,
      bottleneck: meta.bottleneck,
      why: scenarioWhy(key, lead, topType),
      action: mitigationFor(key, lead, topType),
    }
  })

  const worstScenario = scenarios.reduce((best, s) => (s.pressure > best.pressure ? s : best), scenarios[0])
  const worstCasePressure = worstScenario.pressure

  // Red zone analysis — every district red under baseline OR under its worst
  // scenario. Each district's scenarioPressure is its own worst across scenarios.
  const redZoneDistricts: RedZoneDistrict[] = comps
    .map((c, i) => {
      const current = baseScores[i]
      const scenarioPressure = Math.max(...keys.map((k) => scenarioDistrictPressure(c, k)))
      const domKey = dominantBottleneck(c)
      const patrol = patrolByNum.get(c.number)
      const label = `District ${c.number}`
      return {
        districtNumber: c.number,
        label,
        currentPressure: round(current),
        scenarioPressure: round(scenarioPressure),
        change: round(scenarioPressure - current),
        topComplaintTypes,
        bottleneck: SCENARIO_META[domKey].bottleneck,
        mitigation: mitigationFor(domKey, label, topComplaintTypes[0]),
        isOverloaded: c.row.overload_flag > 0,
        reviewFlagged: patrol?.supervisor_review_count,
        officerUnits: patrol?.distinct_officer_units,
      }
    })
    .filter((d) => d.scenarioPressure >= RED_ZONE_THRESHOLD || d.currentPressure >= RED_ZONE_THRESHOLD || d.isOverloaded)
    .sort((a, b) => b.scenarioPressure - a.scenarioPressure)

  // Trajectory — direction of backlog across the modeled horizon.
  const { trajectory, delta } = readTrajectory(dailyRows)

  const failureDriver = worstScenario.bottleneck
  const preventionAction = worstScenario.action

  const leadDistrict =
    redZoneDistricts[0]?.label ??
    (worstScenario.affectedDistrictNumbers[0]
      ? `District ${worstScenario.affectedDistrictNumbers[0]}`
      : 'the busiest districts')

  return {
    hasData: true,
    baselinePressure,
    trajectory,
    trajectoryDelta: delta,
    worstCasePressure,
    worstScenario,
    redZoneCount: redZoneDistricts.length,
    redZoneDistricts,
    failureDriver,
    preventionAction,
    scenarios,
    topComplaintTypes,
    whatChanged: whatChangedCopy(baselinePressure, worstScenario, redZoneDistricts.length),
    whyItMatters: whyItMattersCopy(worstScenario, leadDistrict, topComplaintTypes[0]),
    whatToDoNext: preventionAction,
  }
}

function scenarioWhy(key: ScenarioKey, lead: string, topType?: string): string {
  const t = topType ? ` ${topType} volume` : ' complaint volume'
  switch (key) {
    case 'complaint_surge':
      return `A spike in incoming complaints pushes more cases into queues faster than they clear, concentrating in ${lead} where${t} is already high.`
    case 'officer_capacity':
      return `Fewer available officer hours mean daily demand is not worked down, so backlog builds in ${lead} and cases start to age.`
    case 'supervisor_bottleneck':
      return `Worked cases wait for sign-off faster than review capacity can clear them, so the review queue grows and ${lead} stalls at closure.`
    case 'stale_accumulation':
      return `Older cases left unworked tip past the stale threshold, compounding pressure in ${lead} and crowding out new work.`
  }
}

function whatChangedCopy(baseline: number, worst: ScenarioCard, redCount: number): string {
  return `Under the worst case (${worst.name.toLowerCase()}), system pressure rises from a ${round(
    baseline,
  )} baseline to ${worst.pressure}. ${redCount} district${redCount === 1 ? '' : 's'} enter the red zone, concentrated where ${worst.bottleneck.toLowerCase()} becomes the binding constraint.`
}

function whyItMattersCopy(worst: ScenarioCard, leadDistrict: string, topType?: string): string {
  const typeClause = topType ? ` ${topType} cases stay high while` : ''
  return `${leadDistrict} breaks first because${typeClause} ${worst.bottleneck.toLowerCase()} runs out of headroom. Left unaddressed, backlog compounds and resident closure updates slip.`
}

// Backlog trajectory across the daily series: compare the early horizon to the
// end. A meaningful rise/fall is ≥10% of peak backlog; otherwise it's stable.
function readTrajectory(rows: CtganDailyMetricRow[]): { trajectory: Trajectory; delta: number } {
  if (rows.length < 2) return { trajectory: 'stable', delta: 0 }
  const peak = Math.max(1, ...rows.map((r) => r.backlog))
  const early = rows[Math.min(2, rows.length - 1)].backlog
  const end = rows[rows.length - 1].backlog
  const delta = end - early
  const band = 0.1 * peak
  if (delta > band) return { trajectory: 'rising', delta }
  if (delta < -band) return { trajectory: 'easing', delta }
  return { trajectory: 'stable', delta }
}
