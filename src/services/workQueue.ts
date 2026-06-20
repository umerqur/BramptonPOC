// Unified active Work Queue model.
//
// The Work Queue is where ACTIVE review work lives. It normalizes two live
// sources into one row shape so staff can triage across them:
//
//   1. Resident intake requests — public.resident_service_requests, submitted
//      through the app's public intake form. Source label: "Resident intake".
//   2. NYC open benchmark cases — public.v_nyc_open_review_queue (the active open
//      NYC 311 queue). Source label: "NYC open benchmark".
//
// Historical CLOSED NYC cases (public.municipal_complaints) are deliberately NOT
// part of the active queue — they belong in the Insights Case Explorer only.
//
// REVIEW PRIORITY IS DECISION SUPPORT, NOT ML. The priority score is
// deterministic feature engineering — age, due-date pressure, historical
// complaint-type volume, historical area/district workload, and historical
// closure pressure. It surfaces cases that may deserve EARLIER STAFF REVIEW. It
// is never an automated enforcement decision, an AI decision, or a risk score. A
// human reviews and decides.

import { STATUS_LABELS, type ResidentRequestRow, type ResidentStatus } from './residentRequests'
import { residentRowToCase } from './residentCaseBridge'
import { getNycOpenQueuePage, type OpenReviewRow } from './caseExplorer'
import type { Priority } from '../data/demoWorkflowTypes'

// ---------------------------------------------------------------------------
// Source + priority vocabulary
// ---------------------------------------------------------------------------

export type WorkQueueSource = 'resident' | 'nyc_open'

/** Plain, operational source labels shown on every row. */
export const SOURCE_LABELS: Record<WorkQueueSource, string> = {
  resident: 'Resident intake',
  nyc_open: 'NYC open benchmark',
}

export type ReviewPriorityTier = 'High' | 'Medium' | 'Low' | 'Unscored'

/**
 * One transparent contribution to a deterministic review-priority score. This is
 * decision-support feature engineering — never an ML weight, a risk score, or an
 * automated decision. `points` is null when a source row does not expose the
 * individual weight (e.g. the precomputed NYC open queue score).
 */
export type PriorityComponent = {
  label: string
  points: number | null
  explanation: string
}

/**
 * The plain-language explanation of what review priority means. Framed as
 * decision support / routing support — never automated enforcement.
 */
export const REVIEW_PRIORITY_EXPLAINER =
  'Higher priority means the case may deserve earlier staff review because it is older, due or past due, in a high-workload area, or belongs to a historically high-pressure complaint type.'

/** The deterministic, engineered factors behind the review-priority score. */
export const REVIEW_PRIORITY_FACTORS = [
  'Age of the open request',
  'Due-date pressure',
  'Historical complaint-type volume',
  'Historical area / district workload pressure',
  'Historical closure pressure by complaint type',
] as const

// ---------------------------------------------------------------------------
// Normalized row
// ---------------------------------------------------------------------------

export type WorkQueueRow = {
  /** Stable React key — namespaced by source so ids never collide across sources. */
  key: string
  case_id: string
  source_type: WorkQueueSource
  source_label: string
  submitted_at: string | null
  status: string | null
  status_label: string
  complaint_type: string | null
  location: string | null
  /** Review-priority score (higher = review earlier). Decision support, not ML. */
  priority_score: number | null
  priority_tier: ReviewPriorityTier
  priority_reason: string | null
  /**
   * Transparent breakdown of how the score was reached. Populated for resident
   * intakes (deterministic, fully decomposable); omitted for NYC open rows whose
   * precomputed score does not expose individual component weights.
   */
  priority_components?: PriorityComponent[]
  /** Assigned staff / officer where available (resident flow only). */
  assigned_to: string | null
  /** Human-readable workflow stage where available. */
  workflow_stage: string | null
  /** Field outcome recorded, awaiting supervisor closure review (resident flow). */
  ready_for_closure: boolean
  /** Actively being worked: assigned or under review (resident flow). */
  in_progress: boolean
  // Back-references so the page can open the right detail/action per source.
  resident?: ResidentRequestRow
  open?: OpenReviewRow
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTIVE_RESIDENT_STATUSES: ResidentStatus[] = ['submitted', 'received', 'assigned', 'in_review']

/** Whether a resident request is active work (not yet closed). */
export function isActiveResident(row: ResidentRequestRow): boolean {
  return ACTIVE_RESIDENT_STATUSES.includes(row.status)
}

/** Whole days since an ISO timestamp, or null when unparseable. */
function ageDays(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return null
  return Math.max(0, Math.floor(ms / 86_400_000))
}

/** Normalize a free-form tier string to the canonical tier set. */
export function normalizeTier(tier: string | null): ReviewPriorityTier {
  switch ((tier ?? '').trim().toLowerCase()) {
    case 'high':
      return 'High'
    case 'medium':
    case 'med':
      return 'Medium'
    case 'low':
      return 'Low'
    default:
      return 'Unscored'
  }
}

/** Tier from a 0–100 review-priority score. */
function tierFromScore(score: number): ReviewPriorityTier {
  if (score >= 65) return 'High'
  if (score >= 45) return 'Medium'
  return 'Low'
}

// ---------------------------------------------------------------------------
// Resident intake → normalized row (with derived review priority)
// ---------------------------------------------------------------------------

// Base contribution by the deterministic intake-triage priority (P1 highest).
const PRIORITY_BASE: Record<Priority, number> = { P1: 72, P2: 56, P3: 42, P4: 28 }

/** Inputs to the deterministic resident review-priority calculation. */
export type ResidentPriorityInput = {
  priority: Priority
  category: string
  ageDays: number
  attachmentCount: number
  readyForClosure: boolean
  inProgress: boolean
}

export type ResidentPriorityResult = {
  score: number
  tier: ReviewPriorityTier
  reason: string
  components: PriorityComponent[]
}

/**
 * The single, deterministic, transparent resident review-priority calculation —
 * no model, no risk score. Shared by the Work Queue row mapping and the Case
 * Workbench decision-logic panel so both show the SAME rules-based breakdown.
 * Each component's points sum to the score (before the 0–100 clamp).
 */
export function computeResidentPriority(input: ResidentPriorityInput): ResidentPriorityResult {
  const { priority, category, ageDays: age, attachmentCount, readyForClosure, inProgress } = input

  const basePoints = PRIORITY_BASE[priority] ?? 30
  const agePoints = Math.min(20, Math.max(0, age) * 2) // older intake → earlier review
  const evidencePoints = attachmentCount > 0 ? 8 : 0 // evidence on file → more actionable
  const closurePoints = readyForClosure ? 12 : 0 // recorded field outcome waiting on review
  const stagePoints = !readyForClosure && inProgress ? 6 : 0 // assigned / under review

  const score = Math.max(0, Math.min(100, Math.round(basePoints + agePoints + evidencePoints + closurePoints + stagePoints)))

  const components: PriorityComponent[] = [
    {
      label: 'Base category pressure',
      points: basePoints,
      explanation:
        priority === 'P1' || priority === 'P2'
          ? `High-pressure intake category (${category}, ${priority}).`
          : `Intake category ${category} (${priority}).`,
    },
    {
      label: 'Age in queue',
      points: agePoints,
      explanation:
        age <= 0
          ? 'Submitted today — no age pressure yet.'
          : `${age} day${age === 1 ? '' : 's'} waiting · 2 points per day, capped at 20.`,
    },
    {
      label: 'Evidence attached',
      points: evidencePoints,
      explanation:
        evidencePoints > 0
          ? 'Resident attached photos or documents, so the file is more actionable.'
          : 'No resident evidence on file.',
    },
    {
      label: 'Closure readiness',
      points: closurePoints,
      explanation:
        closurePoints > 0
          ? 'A field outcome is recorded and waiting on closure review.'
          : 'No field outcome is waiting on closure review.',
    },
    {
      label: 'Workflow stage',
      points: stagePoints,
      explanation:
        stagePoints > 0
          ? 'Assigned or under active review.'
          : readyForClosure
            ? 'Counted under closure readiness above.'
            : 'Not yet assigned or under review.',
    },
  ]

  const reasonParts: string[] = []
  if (priority === 'P1' || priority === 'P2') reasonParts.push(`High-pressure category (${category})`)
  else reasonParts.push(`Category: ${category}`)
  if (age >= 1) reasonParts.push(`${age} day${age === 1 ? '' : 's'} in queue`)
  if (attachmentCount > 0) reasonParts.push('Evidence attached')
  if (readyForClosure) reasonParts.push('Field outcome ready for closure review')
  else if (inProgress) reasonParts.push('Under active review')

  return { score, tier: tierFromScore(score), reason: reasonParts.join(' · '), components }
}

/**
 * Map a resident intake request to a normalized Work Queue row. The review
 * priority is DERIVED deterministically from: the intake category/urgency
 * (triage priority), how long it has waited (submitted time), whether evidence
 * was attached, and the staff workflow stage. Decision support only.
 */
export function mapResidentToWorkRow(row: ResidentRequestRow, attachmentCount = 0): WorkQueueRow {
  const triageCase = residentRowToCase(row)
  const priority = triageCase.triage.recommendedPriority
  const category = triageCase.triage.category

  const age = ageDays(row.created_at) ?? 0
  const readyForClosure = row.field_visit_completed && row.status !== 'closed'
  const inProgress = row.status === 'assigned' || row.status === 'in_review'

  const { score, tier, reason, components } = computeResidentPriority({
    priority,
    category,
    ageDays: age,
    attachmentCount,
    readyForClosure,
    inProgress,
  })

  return {
    key: `resident:${row.case_id}`,
    case_id: row.case_id,
    source_type: 'resident',
    source_label: SOURCE_LABELS.resident,
    submitted_at: row.created_at,
    status: row.status,
    status_label: STATUS_LABELS[row.status] ?? row.status,
    complaint_type: row.request_type,
    location: [row.location, row.city].filter(Boolean).join(', ') || null,
    priority_score: score,
    priority_tier: tier,
    priority_reason: reason,
    priority_components: components,
    assigned_to: row.assigned_officer_name,
    workflow_stage: STATUS_LABELS[row.status] ?? row.status,
    ready_for_closure: readyForClosure,
    in_progress: inProgress,
    resident: row,
  }
}

// ---------------------------------------------------------------------------
// NYC open benchmark → normalized row (priority straight from the review queue)
// ---------------------------------------------------------------------------

/**
 * Map an open NYC 311 benchmark case to a normalized Work Queue row. The review
 * priority comes directly from public.v_nyc_open_review_queue — the same
 * deterministic, engineered score used in Insights Open Cases.
 */
export function mapOpenToWorkRow(row: OpenReviewRow): WorkQueueRow {
  const age = row.age_days
  return {
    key: `nyc:${row.case_id}`,
    case_id: row.case_id,
    source_type: 'nyc_open',
    source_label: SOURCE_LABELS.nyc_open,
    submitted_at: row.submitted_at,
    status: row.status,
    status_label: row.status ?? '—',
    complaint_type: row.complaint_type,
    location: [row.address_or_location, row.borough].filter(Boolean).join(', ') || null,
    priority_score: row.priority_score,
    priority_tier: normalizeTier(row.priority_tier),
    priority_reason:
      row.priority_reason ?? (age != null ? `${age} day${age === 1 ? '' : 's'} open` : 'Open benchmark case'),
    assigned_to: null,
    workflow_stage: 'Open · awaiting review',
    ready_for_closure: false,
    in_progress: false,
    open: row,
  }
}

/**
 * Load the highest-review-priority open NYC benchmark cases as normalized rows.
 * Reads public.v_nyc_open_review_queue; throws if that view is not loaded so the
 * caller can show a clear "Open benchmark queue not loaded" state — never fake data.
 */
export async function loadOpenBenchmarkWorkRows(limit = 50): Promise<{ rows: WorkQueueRow[]; hasMore: boolean }> {
  const page = await getNycOpenQueuePage({}, 0, limit)
  return { rows: page.rows.map(mapOpenToWorkRow), hasMore: page.hasMore }
}

/**
 * Sort normalized rows by review priority (highest first), then by most recent
 * submission. Rows without a score sort last.
 */
export function sortByReviewPriority(rows: WorkQueueRow[]): WorkQueueRow[] {
  return [...rows].sort((a, b) => {
    const sa = a.priority_score ?? -Infinity
    const sb = b.priority_score ?? -Infinity
    if (sb !== sa) return sb - sa
    const ta = a.submitted_at ? new Date(a.submitted_at).getTime() : 0
    const tb = b.submitted_at ? new Date(b.submitted_at).getTime() : 0
    return tb - ta
  })
}
