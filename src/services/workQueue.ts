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

  // Deterministic, transparent scoring — no model, no risk score.
  let score = PRIORITY_BASE[priority] ?? 30
  score += Math.min(20, age * 2) // older intake → earlier review
  if (attachmentCount > 0) score += 8 // evidence on file → more actionable
  if (readyForClosure) score += 12 // a recorded field outcome is waiting on review
  else if (inProgress) score += 6
  score = Math.max(0, Math.min(100, Math.round(score)))

  const reasonParts: string[] = []
  if (priority === 'P1' || priority === 'P2') reasonParts.push(`High-pressure category (${category})`)
  else reasonParts.push(`Category: ${category}`)
  if (age >= 1) reasonParts.push(`${age} day${age === 1 ? '' : 's'} in queue`)
  if (attachmentCount > 0) reasonParts.push('Evidence attached')
  if (readyForClosure) reasonParts.push('Field outcome ready for closure review')
  else if (inProgress) reasonParts.push('Under active review')

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
    priority_tier: tierFromScore(score),
    priority_reason: reasonParts.join(' · '),
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
