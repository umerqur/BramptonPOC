// Deterministic, rules-based officer recommendation for intake assignment.
//
// This is DECISION SUPPORT ONLY. It suggests which By-law Officer is the best
// fit for a resident submission so a supervisor/CSR has a sensible default — but
// a human still approves every assignment. The recommendation is produced by
// transparent, deterministic rules (a weighted score over five named drivers),
// NOT by GAN, agent-based modelling (ABM), or any black-box ML. ABM stays in the
// scenario / capacity simulation surfaces; it never picks the operational
// assignee. Same input row always yields the same recommendation.
//
// The five drivers (and what each rewards):
//   * Ward match              — officer regularly patrols the case's ward.
//   * Category experience     — officer has handled this complaint category.
//   * Current workload        — officer has spare capacity (fewer open cases).
//   * Recent area familiarity — officer has recently worked in the case's area.
//   * Availability            — officer is on shift and able to take the case.

import type { StaffProfile } from './roles'
import { officerDisplayName } from './roles'
import type { DemoCategory } from '../data/demoWorkflowTypes'
import type { ResidentRequestRow } from '../services/residentRequests'
import { categoryForRequestType } from '../services/residentCaseBridge'

/** Number of municipal wards used for the deterministic ward derivation. */
const WARD_COUNT = 10

/** The five named scoring drivers, in display order. */
export type RecommendationDriverKey =
  | 'wardMatch'
  | 'categoryExperience'
  | 'currentWorkload'
  | 'recentAreaFamiliarity'
  | 'availability'

/** One driver's contribution to an officer's overall fit score. */
export type RecommendationDriver = {
  key: RecommendationDriverKey
  /** Short human label for the UI. */
  label: string
  /** Normalised 0–100 strength of this driver for this officer + case. */
  score: number
  /** Relative weight of this driver in the overall score (0–1, sums to 1). */
  weight: number
  /** Plain-language explanation of why this driver scored the way it did. */
  detail: string
}

/** A fully scored officer candidate for a case. */
export type OfficerScore = {
  officer: StaffProfile
  /** Officer's display identity, e.g. "Officer Qureshi". */
  name: string
  /** Weighted overall fit, 0–100. */
  total: number
  drivers: RecommendationDriver[]
}

/** The recommendation result for a case: the top officer plus the full ranking. */
export type OfficerRecommendation = {
  /** Best-fit officer by deterministic score (null only if there are no officers). */
  recommended: StaffProfile | null
  recommendedScore: OfficerScore | null
  /** All candidates, highest score first. */
  ranked: OfficerScore[]
  /** The ward the case was deterministically routed to (1..WARD_COUNT). */
  caseWard: number
  /** The complaint category used for the experience driver. */
  category: DemoCategory
  /** One-line rationale for the recommended officer. */
  rationale: string
}

/** Deterministic per-officer operational attributes used by the scoring rules. */
type OfficerAttributes = {
  /** Wards this officer regularly patrols. */
  homeWards: number[]
  /** Closed-case experience depth per category (higher = more experienced). */
  categoryExperience: Partial<Record<DemoCategory, number>>
  /** Current count of open assignments (lower = more spare capacity). */
  openCaseload: number
  /** Wards worked in the last ~2 weeks (recent area familiarity). */
  recentWards: number[]
  /** Whether the officer is currently on shift / assignable. */
  onShift: boolean
  /** Short, human note about the officer's availability. */
  availabilityNote: string
}

// Curated, plausible attributes for the named demo officers. These are stable
// stand-ins for what would, in production, come from the assignment system
// (patrol roster, closed-case history, live caseload, shift schedule). Every
// value here is deterministic; nothing is random.
const OFFICER_ATTRIBUTES: Record<string, OfficerAttributes> = {
  // Officer Qureshi — Property Standards / Parking lead for the central wards.
  'umer.qureshi@gmail.com': {
    homeWards: [1, 3, 4],
    categoryExperience: { 'Property Standards': 48, Parking: 41, 'Yard Maintenance': 22, Zoning: 14 },
    openCaseload: 4,
    recentWards: [1, 3],
    onShift: true,
    availabilityNote: 'On shift today',
  },
  // Officer Mann — Noise / Parking specialist for the east wards.
  'balraj_m7@hotmail.com': {
    homeWards: [7, 8, 9],
    categoryExperience: { Noise: 44, Parking: 30, 'Property Standards': 18 },
    openCaseload: 6,
    recentWards: [8, 9],
    onShift: true,
    availabilityNote: 'On shift today',
  },
  // Officer Ahmed — Illegal Dumping / Yard Maintenance for the north wards.
  'ousmaan_ahmed@icloud.com': {
    homeWards: [5, 6, 10],
    categoryExperience: { 'Illegal Dumping': 39, 'Yard Maintenance': 33, 'Property Standards': 20 },
    openCaseload: 3,
    recentWards: [5, 6],
    onShift: true,
    availabilityNote: 'On shift today',
  },
  // Officer Oakley — dedicated field officer, broad coverage, lighter caseload.
  'oakley.carpentry_worker@yahoo.com': {
    homeWards: [2, 4, 6],
    categoryExperience: { 'Property Standards': 26, 'Illegal Dumping': 19, Zoning: 16, Noise: 12 },
    openCaseload: 2,
    recentWards: [2, 4],
    onShift: true,
    availabilityNote: 'On shift today',
  },
  // Officer Shaz — zoning/parking, currently carrying a heavier load.
  'shahzadqu@gmail.com': {
    homeWards: [2, 3, 7],
    categoryExperience: { Zoning: 31, Parking: 24, 'Property Standards': 15 },
    openCaseload: 8,
    recentWards: [3, 7],
    onShift: true,
    availabilityNote: 'On shift, near capacity',
  },
}

/** Stable FNV-1a hash of a string → unsigned 32-bit int (deterministic). */
function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    // FNV prime, kept in 32-bit range.
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Deterministically derive synthetic attributes for an officer with no curated
 * entry, seeded only by their email — so unknown officers still get stable,
 * plausible coverage, experience, caseload, and availability.
 */
function deriveAttributes(email: string): OfficerAttributes {
  const seed = hashString(email.trim().toLowerCase())
  const homeBase = (seed % WARD_COUNT) + 1
  const homeWards = [homeBase, ((homeBase + 2) % WARD_COUNT) + 1]
  const categories: DemoCategory[] = [
    'Property Standards',
    'Illegal Dumping',
    'Noise',
    'Parking',
    'Yard Maintenance',
    'Zoning',
  ]
  const primary = categories[seed % categories.length]
  const secondary = categories[(seed >> 3) % categories.length]
  const categoryExperience: Partial<Record<DemoCategory, number>> = {
    [primary]: 12 + (seed % 18),
    [secondary]: 6 + ((seed >> 5) % 12),
  }
  return {
    homeWards,
    categoryExperience,
    openCaseload: 3 + ((seed >> 7) % 7),
    recentWards: [homeBase],
    onShift: (seed >> 11) % 5 !== 0, // ~1 in 5 derived officers off shift
    availabilityNote: (seed >> 11) % 5 !== 0 ? 'On shift today' : 'Off shift / unavailable',
  }
}

function attributesFor(officer: StaffProfile): OfficerAttributes {
  return OFFICER_ATTRIBUTES[officer.email.trim().toLowerCase()] ?? deriveAttributes(officer.email)
}

/**
 * Deterministically route a resident submission to a ward (1..WARD_COUNT). Real
 * deployments would geocode the address to a ward; here we hash the most
 * specific available locator so the same submission always maps to the same
 * ward.
 */
export function caseWardForRow(row: ResidentRequestRow): number {
  const locator = (row.postal_code || row.location || row.city || row.case_id || '').trim().toLowerCase()
  return (hashString(locator) % WARD_COUNT) + 1
}

/** Ward ring-adjacency: ward n borders n-1 and n+1, wrapping at the ends. */
function isAdjacentWard(a: number, b: number): boolean {
  const diff = Math.abs(a - b)
  return diff === 1 || diff === WARD_COUNT - 1
}

// Driver weights — sum to 1. Ward match and category experience carry the most
// weight (right officer for the right place and complaint), then capacity,
// recency, and availability.
const DRIVER_WEIGHTS: Record<RecommendationDriverKey, number> = {
  wardMatch: 0.3,
  categoryExperience: 0.25,
  currentWorkload: 0.2,
  recentAreaFamiliarity: 0.15,
  availability: 0.1,
}

/** Highest curated/derived category experience used to normalise the driver. */
const EXPERIENCE_SCALE = 48
/** Caseload at or above which the workload driver scores zero. */
const CASELOAD_CEILING = 10

function scoreDrivers(
  attrs: OfficerAttributes,
  caseWard: number,
  category: DemoCategory,
): RecommendationDriver[] {
  // Ward match: full credit for the home ward, partial for an adjacent ward.
  const wardScore = attrs.homeWards.includes(caseWard)
    ? 100
    : attrs.homeWards.some((w) => isAdjacentWard(w, caseWard))
      ? 55
      : 15
  const wardDetail = attrs.homeWards.includes(caseWard)
    ? `Regularly patrols ward ${caseWard}`
    : attrs.homeWards.some((w) => isAdjacentWard(w, caseWard))
      ? `Patrols an adjacent ward (covers ${attrs.homeWards.join(', ')})`
      : `Patrols wards ${attrs.homeWards.join(', ')} — outside ward ${caseWard}`

  // Category experience: depth of closed cases in this complaint category.
  const experience = attrs.categoryExperience[category] ?? 0
  const experienceScore = Math.min(100, Math.round((experience / EXPERIENCE_SCALE) * 100))
  const experienceDetail =
    experience > 0
      ? `${experience} prior ${category} cases handled`
      : `No prior ${category} cases on record`

  // Current workload: fewer open cases → more spare capacity → higher score.
  const workloadScore = Math.max(0, Math.round((1 - attrs.openCaseload / CASELOAD_CEILING) * 100))
  const workloadDetail = `${attrs.openCaseload} open case${attrs.openCaseload === 1 ? '' : 's'} in progress`

  // Recent area familiarity: worked the same ward (or an adjacent one) recently.
  const recentScore = attrs.recentWards.includes(caseWard)
    ? 100
    : attrs.recentWards.some((w) => isAdjacentWard(w, caseWard))
      ? 50
      : 10
  const recentDetail = attrs.recentWards.includes(caseWard)
    ? `Worked ward ${caseWard} in the last two weeks`
    : attrs.recentWards.some((w) => isAdjacentWard(w, caseWard))
      ? `Recently worked a nearby ward (${attrs.recentWards.join(', ')})`
      : `No recent activity in ward ${caseWard}`

  // Availability: on shift and assignable.
  const availabilityScore = attrs.onShift ? 100 : 0

  return [
    { key: 'wardMatch', label: 'Ward match', score: wardScore, weight: DRIVER_WEIGHTS.wardMatch, detail: wardDetail },
    {
      key: 'categoryExperience',
      label: 'Category experience',
      score: experienceScore,
      weight: DRIVER_WEIGHTS.categoryExperience,
      detail: experienceDetail,
    },
    {
      key: 'currentWorkload',
      label: 'Current workload',
      score: workloadScore,
      weight: DRIVER_WEIGHTS.currentWorkload,
      detail: workloadDetail,
    },
    {
      key: 'recentAreaFamiliarity',
      label: 'Recent area familiarity',
      score: recentScore,
      weight: DRIVER_WEIGHTS.recentAreaFamiliarity,
      detail: recentDetail,
    },
    {
      key: 'availability',
      label: 'Availability',
      score: availabilityScore,
      weight: DRIVER_WEIGHTS.availability,
      detail: attrs.availabilityNote,
    },
  ]
}

/** Weighted overall fit (0–100) from a driver breakdown. */
function totalFromDrivers(drivers: RecommendationDriver[]): number {
  const raw = drivers.reduce((sum, d) => sum + d.score * d.weight, 0)
  return Math.round(raw * 10) / 10
}

/**
 * Score and rank a list of officers for a resident submission, then return the
 * deterministic recommendation. Officers are ranked by weighted fit; ties break
 * by the officer's existing order (stable). The recommended officer is simply
 * the highest score — Officer Qureshi is recommended only when his score wins.
 */
export function recommendOfficer(
  row: ResidentRequestRow,
  officers: StaffProfile[],
): OfficerRecommendation {
  const caseWard = caseWardForRow(row)
  const category = categoryForRequestType(row.request_type)

  const ranked: OfficerScore[] = officers
    .map((officer) => {
      const drivers = scoreDrivers(attributesFor(officer), caseWard, category)
      return {
        officer,
        name: officerDisplayName(officer),
        total: totalFromDrivers(drivers),
        drivers,
      }
    })
    // Stable sort by total descending; original order preserved on ties.
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score.total - a.score.total || a.index - b.index)
    .map(({ score }) => score)

  const recommendedScore = ranked[0] ?? null
  const recommended = recommendedScore?.officer ?? null

  const rationale = recommendedScore
    ? buildRationale(recommendedScore, caseWard, category)
    : 'No assignable officers are available.'

  return { recommended, recommendedScore, ranked, caseWard, category, rationale }
}

/** Short "why this officer" phrase — the single strongest driver. */
function buildRationale(score: OfficerScore, caseWard: number, category: DemoCategory): string {
  const top = [...score.drivers].sort((a, b) => b.score * b.weight - a.score * a.weight)[0]
  switch (top?.key) {
    case 'categoryExperience':
      return `Strongest ${category} experience`
    case 'wardMatch':
      return `Best coverage for ward ${caseWard}`
    case 'currentWorkload':
      return 'Most spare capacity'
    case 'recentAreaFamiliarity':
      return `Recent work in ward ${caseWard}`
    default:
      return 'Currently available'
  }
}
