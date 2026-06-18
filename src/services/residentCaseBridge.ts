// Bridge between the two worlds of the POC:
//   * Resident submissions live in Supabase (public.resident_service_requests).
//   * The staff workbench / closure flow runs on the synthetic in-browser
//     workflow store (DemoCase objects).
//
// When a resident files a complaint it lands in Supabase and shows up in the
// Staff Inbox. When staff click "Open case", we turn that row into a workbench
// DemoCase using the same deterministic AI workflow that powers the POC
// Walkthrough — so staff get an AI-style triage, summary, confidence, and
// recommended action even though no real model result exists yet.
//
// This is decision support only: every department / priority / confidence value
// here is a generated placeholder, and every closure still requires explicit
// staff approval.

import type {
  DemoCase,
  DemoCategory,
  FieldVisitOutcome,
  OfficerFieldAction,
  ResidentComplaintInput,
  ContactPreference,
} from '../data/demoWorkflowTypes'
import { runWorkflow, buildClosureDraft } from './demoWorkflowService'
import { residentRowToNormalized } from './serviceRequest'
import type { ResidentRequestRow } from './residentRequests'

/**
 * Deterministic mapping from a resident-facing issue type to the internal
 * by-law category that drives recommended department, priority, and policy
 * match in the workflow engine:
 *
 *   Parking issue        → Parking Enforcement
 *   Property standards   → Property Standards
 *   Noise complaint      → By-law Enforcement
 *   Illegal dumping      → Public Works / Waste Enforcement
 *   Yard maintenance     → Property Standards
 *   Zoning concern       → Zoning Review
 *   Other bylaw concern  → By-law Enforcement (generic)
 */
export const RESIDENT_TYPE_TO_CATEGORY: Record<string, DemoCategory> = {
  'Parking issue': 'Parking',
  'Property standards': 'Property Standards',
  'Noise complaint': 'Noise',
  'Illegal dumping': 'Illegal Dumping',
  'Yard maintenance': 'Yard Maintenance',
  'Zoning concern': 'Zoning',
  'Other bylaw concern': 'Property Standards',
}

/** Best-fit category for a resident request type (defaults to Property Standards). */
export function categoryForRequestType(requestType: string): DemoCategory {
  return RESIDENT_TYPE_TO_CATEGORY[requestType] ?? 'Property Standards'
}

function methodToPreference(method: string | null): ContactPreference {
  if (method === 'Phone') return 'Phone'
  return 'Email'
}

/**
 * Deterministically map the officer's recorded field outcome (whether a
 * violation was observed + the free-text action taken) to a standard by-law
 * enforcement disposition. This is what converts the officer's raw finding into
 * a professional, resident-facing closure paragraph; the officer's raw notes
 * stay internal. No automated enforcement decision — a supervisor still approves
 * the closure.
 */
function deriveFieldOutcome(
  violationObserved: string | null,
  actionTaken: string | null,
): FieldVisitOutcome {
  const violation = (violationObserved ?? '').trim().toLowerCase()
  const action = (actionTaken ?? '').trim().toLowerCase()

  if (violation === 'no') return 'no_violation'

  if (/ticket|fine|citation|penalt/.test(action)) return 'ticket_issued'
  if (/notice|order|warn|comply|compliance/.test(action)) return 'notice_issued'
  if (/resolv|complied|cleared|cleaned|removed|fixed|corrected|no further|no action/.test(action))
    return 'resolved'

  // Violation seen but the action wording is generic → treat as a notice; if the
  // visit was inconclusive (unclear) with no clear action, treat as no violation.
  return violation === 'yes' ? 'notice_issued' : 'no_violation'
}

/**
 * Build a recorded OfficerFieldAction from the resident request's field-outcome
 * columns, or null when the officer has not recorded an outcome yet. The
 * observed condition + officer notes are kept as internal observations.
 */
function fieldActionFromRow(row: ResidentRequestRow): OfficerFieldAction | null {
  if (!row.field_visit_completed) return null
  const recordedAt = row.field_outcome_recorded_at ?? row.assigned_at ?? row.created_at
  const internalObservation = [row.field_observed_condition, row.field_officer_notes]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(' — ')
  return {
    officerName: row.assigned_officer_name ?? 'Officer Oakley',
    visitedAt: recordedAt,
    recordedAt,
    outcome: deriveFieldOutcome(row.field_violation_observed, row.field_action_taken),
    observations: internalObservation,
    referenceNumber: null,
    followUpRequired: row.field_follow_up_required,
  }
}

/**
 * Turn a resident Supabase row into a staff workbench case shape. The resident
 * case id (RSR-…) is preserved so deep links from the inbox resolve, and the
 * resident's chosen issue type forces the classification (no free-text guessing).
 *
 * This does NOT touch the synthetic seed cases used by the POC Walkthrough — it
 * only converts a real resident submission on demand.
 */
export function residentRowToCase(row: ResidentRequestRow): DemoCase {
  const input: ResidentComplaintInput = {
    description: row.description ?? '',
    location: [row.location, row.city].filter(Boolean).join(', '),
    channel: '311 Web',
    hasPhoto: false,
    contactPreference: methodToPreference(row.method_of_contact),
    submittedAt: row.created_at,
    residentName: row.resident_name,
    residentEmail: row.resident_email,
  }
  const demoCase = runWorkflow(input, {
    forcedCategory: categoryForRequestType(row.request_type),
    caseId: row.case_id,
  })

  // Map the resident submission onto the shared normalized service-request
  // schema (the resident form stays friendly; the record is normalized here).
  demoCase.normalized = residentRowToNormalized(row, demoCase.triage.recommendedDepartment)

  if (row.assigned_officer_name) demoCase.assignedOfficer = row.assigned_officer_name

  // When the officer has recorded a field outcome, pull it into the case so
  // closure review reflects it: rebuild the closure draft from the recorded
  // outcome (professional, resident-facing language) and move the case to staff
  // review (ready for closure review). Raw officer notes remain internal.
  const fieldAction = fieldActionFromRow(row)
  if (fieldAction && row.status !== 'closed') {
    const now = new Date().toISOString()
    demoCase.fieldAction = fieldAction
    demoCase.draft = buildClosureDraft(input, demoCase.triage, demoCase.context, now, fieldAction)
    demoCase.stage = 'staff-review'
  }

  return demoCase
}
