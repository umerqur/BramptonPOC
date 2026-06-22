// Bridge between the two worlds of the POC:
//   * Resident submissions live in Supabase (public.resident_service_requests).
//   * The staff workbench / closure flow runs on the synthetic in-browser
//     workflow store (DemoCase objects).
//
// When a resident files a complaint it lands in Supabase and shows up in the
// Staff Inbox. When staff click "Open case", we turn that row into a workbench
// DemoCase using the same deterministic decision-support workflow that powers
// the POC Walkthrough — so staff get a classification check, summary, file
// readiness, and recommended action, all rules-based.
//
// This is decision support only: every department / priority / confidence value
// here is a generated placeholder, and every closure still requires explicit
// staff approval.

import type {
  DemoCase,
  DemoCategory,
  EnforcementAction,
  OfficerFieldAction,
  ResidentComplaintInput,
  ServiceMethod,
  ContactPreference,
} from '../data/demoWorkflowTypes'
import { runWorkflow, buildClosureDraft, deriveFieldVisitOutcome } from './demoWorkflowService'
import { residentRowToNormalized } from './serviceRequest'
import type { ResidentRequestRow } from './residentRequests'
import { sanitizeResidentDescription } from '../lib/residentDescription'

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

/** Normalize a stored violation-observed value to the recorded union, or null. */
function normalizeViolation(value: string | null): 'yes' | 'no' | 'unclear' | null {
  const v = (value ?? '').trim().toLowerCase()
  return v === 'yes' || v === 'no' || v === 'unclear' ? v : null
}

const ENFORCEMENT_ACTIONS: EnforcementAction[] = [
  'warning_education',
  'notice_issued',
  'ticket_issued',
  'no_action',
  'other',
]
const SERVICE_METHODS: ServiceMethod[] = ['placed_on_vehicle', 'handed_to_driver', 'sent_by_mail', 'other']

/** Normalize a stored enforcement-action value to the union, or null. */
function normalizeEnforcementAction(value: string | null): EnforcementAction | null {
  const v = (value ?? '').trim()
  return (ENFORCEMENT_ACTIONS as string[]).includes(v) ? (v as EnforcementAction) : null
}

/** Normalize a stored method-of-service value to the union, or null. */
function normalizeServiceMethod(value: string | null): ServiceMethod | null {
  const v = (value ?? '').trim()
  return (SERVICE_METHODS as string[]).includes(v) ? (v as ServiceMethod) : null
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
  const clean = (s: string | null): string | null => {
    const t = (s ?? '').trim()
    return t.length > 0 ? t : null
  }
  const enforcementAction = normalizeEnforcementAction(row.field_enforcement_action)
  return {
    officerName: row.assigned_officer_name ?? 'Officer Oakley',
    visitedAt: recordedAt,
    recordedAt,
    outcome: deriveFieldVisitOutcome(row.field_violation_observed, enforcementAction),
    observations: internalObservation,
    // Ticket / penalty notice number, only when a ticket was issued.
    referenceNumber: enforcementAction === 'ticket_issued' ? clean(row.field_reference_number) : null,
    followUpRequired: row.field_follow_up_required,
    // Verbatim recorded fields, so the closure draft reflects the real action.
    violationObserved: normalizeViolation(row.field_violation_observed),
    enforcementAction,
    serviceMethod:
      enforcementAction === 'ticket_issued' ? normalizeServiceMethod(row.field_service_method) : null,
    actionTaken: clean(row.field_action_taken),
    observedCondition: clean(row.field_observed_condition),
    officerNotes: clean(row.field_officer_notes),
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
    description: sanitizeResidentDescription(row.description),
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

  // Resident cases already carry the assigned officer email in Supabase — keep
  // that as the officer identity the Field Console filters on.
  if (row.assigned_officer_name) demoCase.assignedOfficer = row.assigned_officer_name
  if (row.assigned_officer_email)
    demoCase.assignedOfficerEmail = row.assigned_officer_email.trim().toLowerCase()

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
