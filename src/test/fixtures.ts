import type { ResidentRequestRow } from '../services/residentRequests'

/**
 * A complete resident_service_requests row fixture for tests. Defaults describe
 * a case assigned to Officer Oakley with no field outcome yet; override the
 * field-outcome columns per test to model partial / complete outcomes.
 */
export function makeResidentRow(overrides: Partial<ResidentRequestRow> = {}): ResidentRequestRow {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    case_id: 'RSR-20260709-7BX8',
    address_type: 'Street Address',
    location: '123 Main St',
    city: 'Brampton',
    province: 'ON',
    request_type: 'Parking issue',
    description: 'A car has been parked across my driveway for two days.',
    first_name: 'Jamie',
    last_name: 'Resident',
    resident_name: 'Jamie Resident',
    unit_number: null,
    postal_code: 'L6Y 1N4',
    country: 'Canada',
    resident_phone: null,
    resident_email: 'jamie.resident@example.com',
    resolution_followup: true,
    method_of_contact: 'Email',
    status: 'assigned',
    is_demo: true,
    created_at: '2026-07-09T12:00:00.000Z',
    updated_at: '2026-07-09T12:00:00.000Z',
    assigned_officer_email: 'officer.oakley@example.com',
    assigned_officer_name: 'Officer Oakley',
    assigned_at: '2026-07-09T13:00:00.000Z',
    field_visit_completed: false,
    field_observed_condition: null,
    field_violation_observed: null,
    field_enforcement_action: null,
    field_service_method: null,
    field_reference_number: null,
    field_action_taken: null,
    field_officer_notes: null,
    field_follow_up_required: false,
    field_outcome_recorded_at: null,
    supervisor_seen_at: null,
    nyc311_district: null,
    nyc311_complaint_type: null,
    nyc311_location_key: null,
    nyc311_alignment_version: null,
    ...overrides,
  }
}

/** The invalid partial state the repair flow fixes: visit recorded, no structured action. */
export function makeIncompleteOutcomeRow(overrides: Partial<ResidentRequestRow> = {}): ResidentRequestRow {
  return makeResidentRow({
    status: 'in_review',
    field_visit_completed: true,
    field_observed_condition: 'Vehicle parked across the driveway.',
    field_violation_observed: 'yes',
    field_action_taken: 'Spoke with the vehicle owner and issued a verbal warning.',
    field_officer_notes: 'Owner apologized and moved the vehicle.',
    field_outcome_recorded_at: '2026-07-10T20:48:27.803Z',
    field_enforcement_action: null,
    field_service_method: null,
    field_reference_number: null,
    ...overrides,
  })
}

/** A fully recorded structured outcome, ready for supervisor closure review. */
export function makeCompleteOutcomeRow(overrides: Partial<ResidentRequestRow> = {}): ResidentRequestRow {
  return makeIncompleteOutcomeRow({
    field_enforcement_action: 'warning_education',
    ...overrides,
  })
}
