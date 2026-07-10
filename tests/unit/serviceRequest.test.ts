import { describe, it, expect } from 'vitest'
import { residentRowToNormalized } from '../../src/services/serviceRequest'
import { categoryForRequestType } from '../../src/services/residentCaseBridge'
import { deriveFieldVisitOutcome } from '../../src/services/demoWorkflowService'
import type { ResidentRequestRow } from '../../src/services/residentRequests'

// Part 10: API payload builders (resident submission -> normalized service
// request), request-type -> category mapping, and the officer field-outcome
// state transition used by closure.

function residentRow(overrides: Partial<ResidentRequestRow> = {}): ResidentRequestRow {
  return {
    id: 'row-1',
    case_id: 'RSR-20260620-AB12',
    address_type: 'Street Address',
    location: '24 Main St N',
    city: 'Brampton',
    province: 'Ontario',
    request_type: 'Property standards',
    description: 'Overgrown yard with debris.',
    first_name: 'Jordan',
    last_name: 'Resident',
    resident_name: 'Jordan Resident',
    unit_number: null,
    postal_code: 'L6V 1A1',
    country: 'Canada',
    resident_phone: '905-555-0100',
    resident_email: 'jordan.resident@example.com',
    resolution_followup: true,
    method_of_contact: 'Email',
    status: 'submitted',
    is_demo: true,
    created_at: '2026-06-20T12:00:00.000Z',
    updated_at: '2026-06-20T12:00:00.000Z',
    assigned_officer_email: null,
    assigned_officer_name: null,
    assigned_at: null,
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
    ...overrides,
  }
}

describe('residentRowToNormalized', () => {
  it('maps a resident row onto the normalized service-request schema', () => {
    const out = residentRowToNormalized(residentRow(), 'Property Standards')
    expect(out.case_id).toBe('RSR-20260620-AB12')
    expect(out.source).toBe('resident_intake')
    expect(out.complaint_type).toBe('Property standards')
    expect(out.address_or_location).toBe('24 Main St N, Brampton')
    expect(out.assigned_department).toBe('Property Standards')
    expect(out.closure_status).toBe('open')
  })

  it('marks a closed row as closed', () => {
    expect(residentRowToNormalized(residentRow({ status: 'closed' })).closure_status).toBe('closed')
  })

  it('falls back to the assigned officer name when no department is given', () => {
    const out = residentRowToNormalized(residentRow({ assigned_officer_name: 'Officer Oakley' }))
    expect(out.assigned_department).toBe('Officer Oakley')
  })
})

describe('categoryForRequestType', () => {
  it('maps known resident request types to internal categories', () => {
    expect(categoryForRequestType('Parking issue')).toBe('Parking')
    expect(categoryForRequestType('Noise complaint')).toBe('Noise')
    expect(categoryForRequestType('Illegal dumping')).toBe('Illegal Dumping')
  })

  it('defaults an unknown type to Property Standards', () => {
    expect(categoryForRequestType('Something unmapped')).toBe('Property Standards')
  })
})

describe('deriveFieldVisitOutcome', () => {
  it('records no_violation when no violation was observed, regardless of action', () => {
    expect(deriveFieldVisitOutcome('no', 'ticket_issued')).toBe('no_violation')
  })

  it('claims a ticket only when the officer selected ticket_issued', () => {
    expect(deriveFieldVisitOutcome('yes', 'ticket_issued')).toBe('ticket_issued')
    expect(deriveFieldVisitOutcome('yes', 'warning_education')).toBe('warning_education')
    expect(deriveFieldVisitOutcome('yes', 'notice_issued')).toBe('notice_issued')
  })

  it('resolves when no further action was required', () => {
    expect(deriveFieldVisitOutcome('yes', 'no_action')).toBe('resolved')
    expect(deriveFieldVisitOutcome('unclear', null)).toBe('resolved')
  })
})
