// Normalized service-request schema — the single internal shape every
// operational case maps to, no matter which source it came from.
//
// The Work Queue treats resident intake and NYC open benchmark cases as one
// operational workflow. The resident form stays resident-friendly, but its
// fields are mapped here onto the SAME normalized schema the NYC sources use, so
// downstream code (workbench, lifecycle, audit) never has to special-case the
// source for the core record. Closure of an NYC open benchmark case is a POC
// workflow decision recorded in our app layer — it never changes NYC data.

import type { NormalizedServiceRequest } from '../data/demoWorkflowTypes'
import type { ResidentRequestRow } from './residentRequests'
import { sanitizeResidentDescription } from '../lib/residentDescription'
import type { OpenReviewRow } from './caseExplorer'

const cleaned = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  return s.length > 0 ? s : null
}

/** Combine non-empty parts with a separator, or null when none are present. */
function join(parts: (string | null | undefined)[], sep = ', '): string | null {
  const present = parts.map((p) => (p ?? '').trim()).filter((p) => p.length > 0)
  return present.length > 0 ? present.join(sep) : null
}

/**
 * Map a resident intake row (public.resident_service_requests) onto the
 * normalized service-request schema. `assignedDepartment` is the routing the
 * deterministic triage recommended (passed in so this stays dependency-light).
 */
export function residentRowToNormalized(
  row: ResidentRequestRow,
  assignedDepartment: string | null = null,
): NormalizedServiceRequest {
  return {
    case_id: row.case_id,
    source: 'resident_intake',
    submitted_at: row.created_at,
    status: row.status,
    complaint_type: cleaned(row.request_type),
    request_detail: cleaned(sanitizeResidentDescription(row.description)),
    location_type: cleaned(row.address_type),
    address_or_location: join([row.location, row.city]),
    ward_or_area: cleaned(row.province),
    assigned_department: cleaned(assignedDepartment) ?? cleaned(row.assigned_officer_name),
    priority_score: null,
    priority_reason: null,
    resolution_description: null,
    closure_status: row.status === 'closed' ? 'closed' : 'open',
  }
}

/**
 * Map an NYC open benchmark row (public.v_nyc_open_review_queue) onto the
 * normalized service-request schema. Priority score/reason come straight from
 * the review queue (internal decision support, not a NYC source field).
 */
export function openRowToNormalized(row: OpenReviewRow): NormalizedServiceRequest {
  const closed = (row.status ?? '').trim().toLowerCase() === 'closed'
  return {
    case_id: row.case_id,
    source: 'nyc_open_benchmark',
    submitted_at: row.submitted_at,
    status: row.status,
    complaint_type: cleaned(row.complaint_type),
    request_detail: cleaned(row.descriptor),
    location_type: cleaned(row.source.location_type),
    address_or_location: join([row.address_or_location, row.borough]),
    ward_or_area: cleaned(row.borough),
    assigned_department: cleaned(row.agency),
    priority_score: row.priority_score,
    priority_reason: cleaned(row.priority_reason),
    resolution_description: cleaned(row.source.resolution_description),
    closure_status: closed ? 'closed' : 'open',
  }
}
