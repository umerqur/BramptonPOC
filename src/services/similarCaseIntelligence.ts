// Similar Case Intelligence — STRUCTURED similarity, not vector embeddings.
//
// Why this exists: resident intake text, NYC 311 benchmark descriptions, and
// by-law operational similarity do not align cleanly through semantic text
// similarity alone. Cohere embeddings + rerank produced weak, often misleading
// neighbours. This module replaces that with STRUCTURED similarity over the
// operational features that actually drive how a case behaves — service
// category, complaint type, district, priority / risk band, closure outcome,
// workflow stage, field-visit and assignment pattern, case age, and time
// context — with optional text overlap kept only as a small secondary signal.
//
// Candidate pool: a curated set of CTGAN-style synthetic benchmark cases
// (statistically plausible feature combinations) carrying ABM scenario behavior
// (how similar cases behaved under workload, staffing, weather, construction,
// event-parking, or supervisor-bottleneck pressure). It is labelled, in-repo
// decision-support reference data — never live enforcement data.
//
// THIS IS DECISION SUPPORT ONLY. It surfaces what similar cases SUGGEST so an
// officer can review them. It does not decide the enforcement outcome.

// ---------------------------------------------------------------------------
// Feature model
// ---------------------------------------------------------------------------

export type PriorityBand = 'P1' | 'P2' | 'P3' | 'P4'
export type RiskBand = 'High' | 'Medium' | 'Low'
export type TimeOfDay = 'Morning' | 'Afternoon' | 'Evening' | 'Overnight'
export type DayType = 'Weekday' | 'Weekend'
export type AssignmentPattern = 'Single officer' | 'Reassigned' | 'Unassigned'

// ABM scenario behavior tags. The first four mirror the stress-lab scenario keys
// (src/components/app/stressModel.ts); the operational flavors (construction
// corridor, event parking, weather event) extend them for richer field context.
export type AbmScenario =
  | 'complaint_surge'
  | 'officer_capacity'
  | 'supervisor_bottleneck'
  | 'stale_accumulation'
  | 'construction_corridor'
  | 'event_parking'
  | 'weather_event'
  | 'baseline'

/** The structured operational features a case is matched on. */
export type CaseFeatures = {
  serviceCategory: string
  complaintType: string
  district: string
  priorityBand: PriorityBand
  riskBand: RiskBand
  riskDrivers: string[]
  caseAgeDays: number
  timeOfDay: TimeOfDay
  dayType: DayType
  closureOutcome: string
  workflowStage: string
  fieldVisitRequired: boolean
  assignmentPattern: AssignmentPattern
  /** Free text (complaint type + description) — used ONLY as a minor 0.10 signal. */
  text: string
}

/** A curated CTGAN-synthetic benchmark case with ABM scenario behavior + lessons. */
export type BenchmarkCase = CaseFeatures & {
  caseId: string
  abmScenario: AbmScenario
  /** What happened next operationally on this similar case. */
  whatHappenedNext: string
  /** Officer-facing lesson, phrased as review guidance — never a decision. */
  recommendedLesson: string
}

/** A scored, presentation-ready similar case for the panel. */
export type SimilarCaseMatch = {
  caseId: string
  serviceCategory: string
  complaintType: string
  district: string
  statusOrOutcome: string
  /** Blended structured similarity, 0..1. */
  similarityScore: number
  similarityPct: number
  matchedDimensions: string[]
  similarityReason: string
  pastOutcome: string
  operationalNote: string
  recommendedLesson: string
  abmScenario: AbmScenario
}

// ---------------------------------------------------------------------------
// Scoring weights — exactly the structured-first blend from the spec.
// Text similarity is intentionally the smallest signal.
// ---------------------------------------------------------------------------

export const SIMILARITY_WEIGHTS = {
  category: 0.3, // service category + complaint type
  location: 0.2, // district / location cluster (+ time-of-day cluster)
  priorityRisk: 0.15, // priority band + risk band + risk drivers + case age
  closureWorkflow: 0.15, // closure outcome + workflow stage + ABM scenario fit
  fieldAssignment: 0.1, // field-visit flag + assignment pattern
  text: 0.1, // minor secondary text overlap
} as const

// Below this blended score a candidate is a weak structural neighbour, not a
// useful reference — filtered out so weak matches are never shown as matches.
export const MIN_VISIBLE_SCORE = 0.35
export const MAX_VISIBLE = 5

// ---------------------------------------------------------------------------
// Component scores (each returns 0..1)
// ---------------------------------------------------------------------------

const PRIORITY_INDEX: Record<PriorityBand, number> = { P1: 0, P2: 1, P3: 2, P4: 3 }
const RISK_INDEX: Record<RiskBand, number> = { High: 0, Medium: 1, Low: 2 }

function categoryScore(a: CaseFeatures, b: CaseFeatures): number {
  const sameCategory = eq(a.serviceCategory, b.serviceCategory)
  const sameType = eq(a.complaintType, b.complaintType)
  if (sameCategory && sameType) return 1
  if (sameCategory) return 0.7
  if (sameType) return 0.5
  return 0
}

function locationScore(a: CaseFeatures, b: CaseFeatures): number {
  // District match dominates; same time-of-day / day-type cluster is a minor add.
  let district = 0
  if (eq(a.district, b.district)) district = 1
  else if (sameLocationCluster(a.district, b.district)) district = 0.6
  const temporal = (a.timeOfDay === b.timeOfDay ? 0.5 : 0) + (a.dayType === b.dayType ? 0.5 : 0)
  return 0.85 * district + 0.15 * temporal
}

function priorityRiskScore(a: CaseFeatures, b: CaseFeatures): number {
  const priority = proximity(PRIORITY_INDEX[a.priorityBand], PRIORITY_INDEX[b.priorityBand], 3)
  const risk = proximity(RISK_INDEX[a.riskBand], RISK_INDEX[b.riskBand], 2)
  const drivers = jaccard(new Set(a.riskDrivers.map(norm)), new Set(b.riskDrivers.map(norm)))
  const age = ageProximity(a.caseAgeDays, b.caseAgeDays)
  return 0.45 * priority + 0.3 * risk + 0.15 * drivers + 0.1 * age
}

function closureWorkflowScore(a: CaseFeatures, b: CaseFeatures, scenarioMatch: boolean): number {
  const outcome = textOverlapLabel(a.closureOutcome, b.closureOutcome)
  const stage = eq(a.workflowStage, b.workflowStage) ? 1 : 0
  return 0.55 * outcome + 0.25 * stage + 0.2 * (scenarioMatch ? 1 : 0)
}

function fieldAssignmentScore(a: CaseFeatures, b: CaseFeatures): number {
  const field = a.fieldVisitRequired === b.fieldVisitRequired ? 1 : 0
  const assignment = a.assignmentPattern === b.assignmentPattern ? 1 : 0
  return 0.6 * field + 0.4 * assignment
}

// ---------------------------------------------------------------------------
// Scenario derivation — the likely ABM pressure context for the active case.
// Used both as a small scoring signal and to surface the operational note.
// ---------------------------------------------------------------------------

export function deriveScenario(f: CaseFeatures): AbmScenario {
  if (f.caseAgeDays >= 21) return 'stale_accumulation'
  if (eq(f.serviceCategory, 'Parking') && sameLocationCluster(f.district, 'Downtown core')) return 'event_parking'
  if ((f.priorityBand === 'P1' || f.priorityBand === 'P2') && f.riskBand === 'High') return 'complaint_surge'
  if (f.fieldVisitRequired && f.assignmentPattern === 'Unassigned') return 'supervisor_bottleneck'
  return 'baseline'
}

const SCENARIO_NOTE: Record<AbmScenario, string> = {
  complaint_surge:
    'Similar cases drove a sharp intake spike that strained triage capacity in the complaint-surge scenario.',
  officer_capacity:
    'Similar cases slowed when officer capacity was reduced, lengthening time-to-field-visit.',
  supervisor_bottleneck:
    'Similar cases created closure backlog while waiting on supervisor approval in the supervisor-bottleneck scenario.',
  stale_accumulation:
    'Similar cases aged into stale backlog when not actioned early in the stale-accumulation scenario.',
  construction_corridor:
    'Similar cases clustered along active construction corridors, raising repeat-complaint volume.',
  event_parking:
    'Similar cases surged around scheduled events, concentrating parking pressure in short windows.',
  weather_event:
    'Similar cases spiked after weather events, briefly overloading field response.',
  baseline:
    'Similar cases moved at a normal operational pace with no unusual workload pressure.',
}

// ---------------------------------------------------------------------------
// Main entry — score the candidate pool against the active case features.
// ---------------------------------------------------------------------------

export function computeSimilarCaseIntelligence(
  active: CaseFeatures,
  pool: BenchmarkCase[] = BENCHMARK_POOL,
): SimilarCaseMatch[] {
  const activeScenario = deriveScenario(active)

  const scored = pool.map((cand) => {
    const scenarioMatch = cand.abmScenario === activeScenario
    const components = {
      category: categoryScore(active, cand),
      location: locationScore(active, cand),
      priorityRisk: priorityRiskScore(active, cand),
      closureWorkflow: closureWorkflowScore(active, cand, scenarioMatch),
      fieldAssignment: fieldAssignmentScore(active, cand),
      text: textSimilarity(active.text, cand.text),
    }
    const similarityScore =
      SIMILARITY_WEIGHTS.category * components.category +
      SIMILARITY_WEIGHTS.location * components.location +
      SIMILARITY_WEIGHTS.priorityRisk * components.priorityRisk +
      SIMILARITY_WEIGHTS.closureWorkflow * components.closureWorkflow +
      SIMILARITY_WEIGHTS.fieldAssignment * components.fieldAssignment +
      SIMILARITY_WEIGHTS.text * components.text

    const matchedDimensions = describeMatch(active, cand, components)

    return { cand, similarityScore, matchedDimensions }
  })

  return scored
    .filter((s) => s.similarityScore >= MIN_VISIBLE_SCORE)
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, MAX_VISIBLE)
    .map(({ cand, similarityScore, matchedDimensions }) => ({
      caseId: cand.caseId,
      serviceCategory: cand.serviceCategory,
      complaintType: cand.complaintType,
      district: cand.district,
      statusOrOutcome: cand.closureOutcome,
      similarityScore,
      similarityPct: Math.round(similarityScore * 100),
      matchedDimensions,
      similarityReason: `Similar because: ${matchedDimensions.join(', ')}.`,
      pastOutcome: `Past outcome: ${cand.whatHappenedNext}`,
      operationalNote: `Operational note: ${SCENARIO_NOTE[cand.abmScenario]}`,
      recommendedLesson: cand.recommendedLesson,
      abmScenario: cand.abmScenario,
    }))
}

/** Human-readable reasons for the strongest matching dimensions (for the card). */
function describeMatch(
  a: CaseFeatures,
  b: CaseFeatures,
  c: { category: number; location: number; priorityRisk: number; closureWorkflow: number; fieldAssignment: number },
): string[] {
  const out: string[] = []
  if (eq(a.serviceCategory, b.serviceCategory)) out.push('same category')
  else if (eq(a.complaintType, b.complaintType)) out.push('same complaint type')
  if (eq(a.district, b.district)) out.push('same district')
  else if (c.location >= 0.5) out.push('nearby district')
  if (a.priorityBand === b.priorityBand) out.push(`same priority band (${a.priorityBand})`)
  if (a.riskBand === b.riskBand) out.push(`${a.riskBand.toLowerCase()} risk band`)
  if (a.fieldVisitRequired && b.fieldVisitRequired) out.push('field visit required')
  if (a.assignmentPattern === b.assignmentPattern && a.assignmentPattern !== 'Unassigned')
    out.push('same assignment pattern')
  if (c.closureWorkflow >= 0.5 && out.length < 4) out.push('comparable closure path')
  // Always return at least one reason; cap to keep the card readable.
  if (out.length === 0) out.push('overlapping operational profile')
  return out.slice(0, 4)
}

// ---------------------------------------------------------------------------
// Small helpers (no embeddings, no external calls)
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return s.trim().toLowerCase()
}
function eq(a: string, b: string): boolean {
  return norm(a) === norm(b) && norm(a).length > 0
}

/** 1 when identical, decaying linearly with index distance over `span`. */
function proximity(ia: number, ib: number, span: number): number {
  return Math.max(0, 1 - Math.abs(ia - ib) / span)
}

/** Case-age closeness on a log-ish scale so 2 vs 4 days ≈ close, 2 vs 60 ≈ far. */
function ageProximity(a: number, b: number): number {
  const diff = Math.abs(a - b)
  return Math.max(0, 1 - diff / 30)
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

/** Location-cluster heuristic: shared significant token ⇒ same operational area. */
function sameLocationCluster(a: string, b: string): boolean {
  const ta = new Set(tokenize(a))
  const tb = tokenize(b)
  return tb.some((t) => ta.has(t))
}

/** Soft label overlap for closure outcomes (token Jaccard, lightly boosted). */
function textOverlapLabel(a: string, b: string): number {
  const j = jaccard(new Set(tokenize(a)), new Set(tokenize(b)))
  return Math.min(1, j * 1.5)
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'after', 'before',
  'was', 'were', 'is', 'are', 'no', 'not', 'this', 'that', 'by', 'as', 'from', 'core', 'ward',
])

function tokenize(s: string): string[] {
  return norm(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
}

/** Minor secondary text signal — token Jaccard only. NEVER the main retrieval. */
export function textSimilarity(a: string, b: string): number {
  return jaccard(new Set(tokenize(a)), new Set(tokenize(b)))
}

// ---------------------------------------------------------------------------
// Adapter — build CaseFeatures from the fields available on a resident /
// benchmark case, with deterministic risk + field-visit derivation.
// ---------------------------------------------------------------------------

export type CaseFeatureInput = {
  requestType: string
  serviceCategory: string
  district: string | null
  priority: PriorityBand
  createdAt: string | null
  /** Normalized status / workflow stage label. */
  status: string
  fieldVisitCompleted: boolean
  assignedOfficerName: string | null
  isClosed: boolean
  description?: string | null
}

const FIELD_VISIT_ALWAYS = new Set(['property standards', 'parking', 'illegal dumping', 'yard maintenance', 'zoning'])

export function featuresFromCase(input: CaseFeatureInput): CaseFeatures {
  const ageDays = daysSince(input.createdAt)
  const priorityBand = input.priority
  const riskBand = riskBandFor(priorityBand, ageDays)
  const cat = norm(input.serviceCategory)
  const fieldVisitRequired = FIELD_VISIT_ALWAYS.has(cat) || priorityBand === 'P1' || priorityBand === 'P2'

  return {
    serviceCategory: input.serviceCategory,
    complaintType: input.requestType,
    district: input.district?.trim() || 'Unknown',
    priorityBand,
    riskBand,
    riskDrivers: deriveRiskDrivers(input.serviceCategory, priorityBand, ageDays, fieldVisitRequired),
    caseAgeDays: ageDays,
    timeOfDay: timeOfDay(input.createdAt),
    dayType: dayType(input.createdAt),
    closureOutcome: closureOutcomeLabel(input),
    workflowStage: workflowStageLabel(input),
    fieldVisitRequired,
    assignmentPattern: input.assignedOfficerName ? 'Single officer' : 'Unassigned',
    text: [input.requestType, input.serviceCategory, input.description ?? ''].join(' '),
  }
}

function riskBandFor(priority: PriorityBand, ageDays: number): RiskBand {
  if (priority === 'P1') return 'High'
  if (priority === 'P2') return ageDays >= 14 ? 'High' : 'Medium'
  if (priority === 'P3') return ageDays >= 21 ? 'Medium' : 'Low'
  return 'Low'
}

function deriveRiskDrivers(category: string, priority: PriorityBand, ageDays: number, fieldVisit: boolean): string[] {
  const drivers: string[] = []
  if (priority === 'P1' || priority === 'P2') drivers.push('High priority')
  if (ageDays >= 14) drivers.push('Aging case')
  const byCategory: Record<string, string> = {
    'Property Standards': 'Property condition',
    Parking: 'Right-of-way obstruction',
    Noise: 'Repeat disturbance',
    'Illegal Dumping': 'Environmental hazard',
    'Yard Maintenance': 'Property condition',
    Zoning: 'Land-use compliance',
  }
  const c = byCategory[category]
  if (c) drivers.push(c)
  if (fieldVisit) drivers.push('Field visit required')
  return drivers
}

function closureOutcomeLabel(input: CaseFeatureInput): string {
  if (input.isClosed) return 'Closed — resolved'
  if (input.fieldVisitCompleted) return 'Field outcome recorded — pending closure approval'
  if (input.assignedOfficerName) return 'Under active investigation'
  return 'New intake — awaiting triage'
}

function workflowStageLabel(input: CaseFeatureInput): string {
  if (input.isClosed) return 'Closed'
  if (input.fieldVisitCompleted) return 'Ready for closure'
  if (input.assignedOfficerName) return 'Assigned'
  return 'New'
}

function daysSince(iso: string | null): number {
  if (!iso) return 0
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return 0
  return Math.max(0, Math.floor(ms / 86_400_000))
}

function timeOfDay(iso: string | null): TimeOfDay {
  if (!iso) return 'Afternoon'
  const h = new Date(iso).getHours()
  if (Number.isNaN(h)) return 'Afternoon'
  if (h < 6) return 'Overnight'
  if (h < 12) return 'Morning'
  if (h < 18) return 'Afternoon'
  return 'Evening'
}

function dayType(iso: string | null): DayType {
  if (!iso) return 'Weekday'
  const d = new Date(iso).getDay()
  return d === 0 || d === 6 ? 'Weekend' : 'Weekday'
}

// ---------------------------------------------------------------------------
// CTGAN-synthetic benchmark pool with ABM scenario behavior.
//
// Statistically plausible feature combinations across the by-law categories,
// each labelled with how the cohort behaved under an ABM pressure scenario, plus
// a concrete "what happened next" and an officer-facing review lesson. Reference
// data only — never live enforcement records.
// ---------------------------------------------------------------------------

export const BENCHMARK_POOL: BenchmarkCase[] = [
  {
    caseId: 'SYN-PS-0412',
    serviceCategory: 'Property Standards',
    complaintType: 'Property standards',
    district: 'Downtown core',
    priorityBand: 'P2',
    riskBand: 'High',
    riskDrivers: ['High priority', 'Property condition', 'Field visit required'],
    caseAgeDays: 9,
    timeOfDay: 'Morning',
    dayType: 'Weekday',
    closureOutcome: 'Closed — resolved after inspection and owner notice',
    workflowStage: 'Closed',
    fieldVisitRequired: true,
    assignmentPattern: 'Single officer',
    text: 'property standards exterior disrepair broken fence peeling paint owner notice',
    abmScenario: 'supervisor_bottleneck',
    whatHappenedNext: 'resolved after inspection and an owner notice with a 14-day correction window',
    recommendedLesson:
      'Officer should confirm the property owner of record before issuing notice — similar cases closed fastest when the notice named the correct owner on the first visit.',
  },
  {
    caseId: 'SYN-PK-0731',
    serviceCategory: 'Parking',
    complaintType: 'Parking issue',
    district: 'Downtown core',
    priorityBand: 'P3',
    riskBand: 'Low',
    riskDrivers: ['Right-of-way obstruction', 'Field visit required'],
    caseAgeDays: 2,
    timeOfDay: 'Evening',
    dayType: 'Weekend',
    closureOutcome: 'Closed — ticket issued, vehicle relocated',
    workflowStage: 'Closed',
    fieldVisitRequired: true,
    assignmentPattern: 'Single officer',
    text: 'parking obstruction blocked driveway event overflow ticket relocated vehicle',
    abmScenario: 'event_parking',
    whatHappenedNext: 'ticket issued on site and the vehicle was relocated within the same shift',
    recommendedLesson:
      'Officer should review the event schedule for the area — similar cases clustered in short windows around events and benefited from a same-shift sweep rather than a repeat visit.',
  },
  {
    caseId: 'SYN-NO-0188',
    serviceCategory: 'Noise',
    complaintType: 'Noise complaint',
    district: 'Springdale',
    priorityBand: 'P2',
    riskBand: 'Medium',
    riskDrivers: ['High priority', 'Repeat disturbance'],
    caseAgeDays: 5,
    timeOfDay: 'Overnight',
    dayType: 'Weekend',
    closureOutcome: 'Closed — warning issued, no repeat',
    workflowStage: 'Closed',
    fieldVisitRequired: true,
    assignmentPattern: 'Single officer',
    text: 'noise amplified music late night repeat disturbance warning education',
    abmScenario: 'complaint_surge',
    whatHappenedNext: 'verbal warning and written education issued; no repeat complaint within 30 days',
    recommendedLesson:
      'Officer should check for prior overnight complaints at the address — similar repeat-disturbance cases resolved with education when the history was reviewed before escalating.',
  },
  {
    caseId: 'SYN-ID-0903',
    serviceCategory: 'Illegal Dumping',
    complaintType: 'Illegal dumping',
    district: 'Bramalea',
    priorityBand: 'P1',
    riskBand: 'High',
    riskDrivers: ['High priority', 'Environmental hazard', 'Field visit required'],
    caseAgeDays: 1,
    timeOfDay: 'Morning',
    dayType: 'Weekday',
    closureOutcome: 'Closed — cleared and referred to Public Works',
    workflowStage: 'Closed',
    fieldVisitRequired: true,
    assignmentPattern: 'Single officer',
    text: 'illegal dumping construction debris roadside environmental hazard public works cleanup',
    abmScenario: 'construction_corridor',
    whatHappenedNext: 'site cleared, evidence photographed, and the file referred to Public Works for cost recovery',
    recommendedLesson:
      'Officer should photograph and document debris before clearance — similar hazard cases that captured evidence early supported cost-recovery referral; those that did not could not recover costs.',
  },
  {
    caseId: 'SYN-YM-0277',
    serviceCategory: 'Yard Maintenance',
    complaintType: 'Yard maintenance',
    district: 'Heart Lake',
    priorityBand: 'P3',
    riskBand: 'Low',
    riskDrivers: ['Property condition'],
    caseAgeDays: 24,
    timeOfDay: 'Afternoon',
    dayType: 'Weekday',
    closureOutcome: 'Closed — corrected after second notice',
    workflowStage: 'Closed',
    fieldVisitRequired: true,
    assignmentPattern: 'Reassigned',
    text: 'yard maintenance long grass weeds overgrowth notice correction reinspection',
    abmScenario: 'stale_accumulation',
    whatHappenedNext: 'corrected after a second notice; the file aged ~3 weeks before reinspection',
    recommendedLesson:
      'Officer should set a reinspection date when issuing the first notice — similar low-priority yard cases aged into backlog when no follow-up date was scheduled.',
  },
  {
    caseId: 'SYN-ZO-0540',
    serviceCategory: 'Zoning',
    complaintType: 'Zoning concern',
    district: 'Mount Pleasant',
    priorityBand: 'P3',
    riskBand: 'Medium',
    riskDrivers: ['Land-use compliance', 'Aging case'],
    caseAgeDays: 31,
    timeOfDay: 'Afternoon',
    dayType: 'Weekday',
    closureOutcome: 'Open — under zoning review',
    workflowStage: 'Assigned',
    fieldVisitRequired: true,
    assignmentPattern: 'Single officer',
    text: 'zoning unpermitted use home business land-use compliance review planning referral',
    abmScenario: 'stale_accumulation',
    whatHappenedNext: 'referred to Zoning Review; remained open pending a planning determination',
    recommendedLesson:
      'Officer should confirm whether a zoning determination is already in progress — similar cases stalled when field and planning tracks ran in parallel without a shared reference number.',
  },
  {
    caseId: 'SYN-PS-0619',
    serviceCategory: 'Property Standards',
    complaintType: 'Property standards',
    district: 'Bramalea',
    priorityBand: 'P1',
    riskBand: 'High',
    riskDrivers: ['High priority', 'Property condition', 'Field visit required'],
    caseAgeDays: 18,
    timeOfDay: 'Morning',
    dayType: 'Weekday',
    closureOutcome: 'Field outcome recorded — pending closure approval',
    workflowStage: 'Ready for closure',
    fieldVisitRequired: true,
    assignmentPattern: 'Single officer',
    text: 'property standards unsafe structure vacant building safety hazard order to comply',
    abmScenario: 'supervisor_bottleneck',
    whatHappenedNext: 'field outcome recorded with an order to comply; waited several days on supervisor closure approval',
    recommendedLesson:
      'Officer should flag high-risk safety files for priority closure review — similar cases sat in the supervisor queue and aged while waiting on approval.',
  },
  {
    caseId: 'SYN-PK-0356',
    serviceCategory: 'Parking',
    complaintType: 'Parking issue',
    district: 'Springdale',
    priorityBand: 'P4',
    riskBand: 'Low',
    riskDrivers: ['Right-of-way obstruction'],
    caseAgeDays: 3,
    timeOfDay: 'Afternoon',
    dayType: 'Weekday',
    closureOutcome: 'Closed — no violation found',
    workflowStage: 'Closed',
    fieldVisitRequired: false,
    assignmentPattern: 'Single officer',
    text: 'parking complaint legally parked no violation observed warning not required',
    abmScenario: 'baseline',
    whatHappenedNext: 'no violation found on attendance; file closed with a note to the resident',
    recommendedLesson:
      'Officer should verify signage and permit status before attending — similar low-priority parking reports were often legally parked and closed without action.',
  },
  {
    caseId: 'SYN-NO-0461',
    serviceCategory: 'Noise',
    complaintType: 'Noise complaint',
    district: 'Downtown core',
    priorityBand: 'P3',
    riskBand: 'Low',
    riskDrivers: ['Repeat disturbance'],
    caseAgeDays: 7,
    timeOfDay: 'Evening',
    dayType: 'Weekend',
    closureOutcome: 'Closed — resolved after construction-hours notice',
    workflowStage: 'Closed',
    fieldVisitRequired: true,
    assignmentPattern: 'Single officer',
    text: 'noise construction site after hours work permitted hours notice corridor',
    abmScenario: 'construction_corridor',
    whatHappenedNext: 'construction-hours notice served; work moved back into permitted hours',
    recommendedLesson:
      'Officer should check permitted construction hours for the corridor — similar cases resolved quickly once the permitted-hours window was confirmed and cited.',
  },
  {
    caseId: 'SYN-ID-0214',
    serviceCategory: 'Illegal Dumping',
    complaintType: 'Illegal dumping',
    district: 'Gore Meadows',
    priorityBand: 'P2',
    riskBand: 'Medium',
    riskDrivers: ['High priority', 'Environmental hazard', 'Field visit required'],
    caseAgeDays: 12,
    timeOfDay: 'Morning',
    dayType: 'Weekday',
    closureOutcome: 'Open — awaiting officer capacity',
    workflowStage: 'Assigned',
    fieldVisitRequired: true,
    assignmentPattern: 'Reassigned',
    text: 'illegal dumping household waste vacant lot environmental reassigned capacity delay',
    abmScenario: 'officer_capacity',
    whatHappenedNext: 'reassigned twice and delayed when officer capacity dropped; field visit slipped past a week',
    recommendedLesson:
      'Officer should escalate environmental hazards that are waiting on capacity — similar cases lengthened materially each time they were reassigned rather than actioned.',
  },
  {
    caseId: 'SYN-PS-0808',
    serviceCategory: 'Property Standards',
    complaintType: 'Property standards',
    district: 'Heart Lake',
    priorityBand: 'P3',
    riskBand: 'Low',
    riskDrivers: ['Property condition'],
    caseAgeDays: 6,
    timeOfDay: 'Afternoon',
    dayType: 'Weekday',
    closureOutcome: 'Closed — voluntary compliance',
    workflowStage: 'Closed',
    fieldVisitRequired: true,
    assignmentPattern: 'Single officer',
    text: 'property standards waste containers stored improperly voluntary compliance education',
    abmScenario: 'baseline',
    whatHappenedNext: 'resident brought the property into voluntary compliance after an education visit',
    recommendedLesson:
      'Officer should lead with education on first-time property-standards files — similar cases reached voluntary compliance without a formal order.',
  },
  {
    caseId: 'SYN-PK-0925',
    serviceCategory: 'Parking',
    complaintType: 'Parking issue',
    district: 'Mount Pleasant',
    priorityBand: 'P2',
    riskBand: 'Medium',
    riskDrivers: ['High priority', 'Right-of-way obstruction', 'Field visit required'],
    caseAgeDays: 1,
    timeOfDay: 'Morning',
    dayType: 'Weekday',
    closureOutcome: 'Closed — fire-route obstruction cleared',
    workflowStage: 'Closed',
    fieldVisitRequired: true,
    assignmentPattern: 'Single officer',
    text: 'parking fire route obstruction safety hazard ticket immediate tow priority',
    abmScenario: 'complaint_surge',
    whatHappenedNext: 'attended as a priority, ticketed the fire-route obstruction, and arranged a tow',
    recommendedLesson:
      'Officer should treat fire-route obstructions as immediate-attendance safety files — similar cases were prioritised over routine parking reports.',
  },
  {
    caseId: 'SYN-YM-0633',
    serviceCategory: 'Yard Maintenance',
    complaintType: 'Yard maintenance',
    district: 'Springdale',
    priorityBand: 'P4',
    riskBand: 'Low',
    riskDrivers: ['Property condition'],
    caseAgeDays: 15,
    timeOfDay: 'Afternoon',
    dayType: 'Weekday',
    closureOutcome: 'Closed — seasonal, monitored',
    workflowStage: 'Closed',
    fieldVisitRequired: false,
    assignmentPattern: 'Single officer',
    text: 'yard maintenance seasonal growth monitored no order minor low priority',
    abmScenario: 'baseline',
    whatHappenedNext: 'monitored as a seasonal condition and closed without a formal order',
    recommendedLesson:
      'Officer should distinguish seasonal conditions from sustained neglect — similar low-priority yard files were closed with monitoring rather than enforcement.',
  },
  {
    caseId: 'SYN-PS-0157',
    serviceCategory: 'Property Standards',
    complaintType: 'Property standards',
    district: 'Downtown core',
    priorityBand: 'P2',
    riskBand: 'Medium',
    riskDrivers: ['High priority', 'Property condition', 'Field visit required'],
    caseAgeDays: 28,
    timeOfDay: 'Morning',
    dayType: 'Weekend',
    closureOutcome: 'Open — aged past target, backlog',
    workflowStage: 'Assigned',
    fieldVisitRequired: true,
    assignmentPattern: 'Reassigned',
    text: 'property standards graffiti exterior aged backlog past target reinspection downtown',
    abmScenario: 'stale_accumulation',
    whatHappenedNext: 'aged past the service target and entered backlog before a second officer picked it up',
    recommendedLesson:
      'Officer should action aging downtown files before they pass target — similar cases that slipped became backlog and needed a second assignment.',
  },
  {
    caseId: 'SYN-NO-0742',
    serviceCategory: 'Noise',
    complaintType: 'Noise complaint',
    district: 'Bramalea',
    priorityBand: 'P1',
    riskBand: 'High',
    riskDrivers: ['High priority', 'Repeat disturbance', 'Field visit required'],
    caseAgeDays: 4,
    timeOfDay: 'Overnight',
    dayType: 'Weekend',
    closureOutcome: 'Field outcome recorded — pending closure approval',
    workflowStage: 'Ready for closure',
    fieldVisitRequired: true,
    assignmentPattern: 'Single officer',
    text: 'noise large gathering repeat overnight ticket issued escalation supervisor review',
    abmScenario: 'supervisor_bottleneck',
    whatHappenedNext: 'ticket issued for a repeat overnight disturbance; held for supervisor closure approval',
    recommendedLesson:
      'Officer should attach the prior-complaint history to the field outcome — similar escalated noise files cleared supervisor review faster when the repeat pattern was documented.',
  },
  {
    caseId: 'SYN-ID-0488',
    serviceCategory: 'Illegal Dumping',
    complaintType: 'Illegal dumping',
    district: 'Gore Meadows',
    priorityBand: 'P3',
    riskBand: 'Low',
    riskDrivers: ['Environmental hazard'],
    caseAgeDays: 8,
    timeOfDay: 'Afternoon',
    dayType: 'Weekday',
    closureOutcome: 'Closed — cleared after weather event',
    workflowStage: 'Closed',
    fieldVisitRequired: true,
    assignmentPattern: 'Single officer',
    text: 'illegal dumping scattered debris after storm weather event cleanup spike',
    abmScenario: 'weather_event',
    whatHappenedNext: 'cleared after a post-storm debris spike; volume briefly overloaded field response',
    recommendedLesson:
      'Officer should expect short post-weather debris spikes — similar cases benefited from batching nearby reports into a single sweep.',
  },
]
