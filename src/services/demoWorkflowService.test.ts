import { describe, expect, it } from 'vitest'
import {
  ENFORCEMENT_ACTION_LABELS,
  FIELD_OUTCOME_LABELS,
  deriveFieldVisitOutcome,
} from './demoWorkflowService'
import type { EnforcementAction } from '../data/demoWorkflowTypes'

// The shared violation + structured-action → disposition rules. Both the
// resident Supabase path and the local NYC benchmark path rely on these, so
// the mappings are pinned here — including the non-enforcement actions that
// keep infrastructure / service cases out of false enforcement outcomes.

describe('deriveFieldVisitOutcome', () => {
  it('maps each enforcement action to its disposition when a violation was observed', () => {
    expect(deriveFieldVisitOutcome('yes', 'ticket_issued')).toBe('ticket_issued')
    expect(deriveFieldVisitOutcome('yes', 'notice_issued')).toBe('notice_issued')
    expect(deriveFieldVisitOutcome('yes', 'warning_education')).toBe('warning_education')
    expect(deriveFieldVisitOutcome('yes', 'no_action')).toBe('resolved')
    expect(deriveFieldVisitOutcome('yes', 'other')).toBe('resolved')
  })

  it('records "no violation" over enforcement actions when no violation was observed', () => {
    expect(deriveFieldVisitOutcome('no', 'ticket_issued')).toBe('no_violation')
    expect(deriveFieldVisitOutcome('no', 'no_action')).toBe('no_violation')
    expect(deriveFieldVisitOutcome('no', null)).toBe('no_violation')
  })

  it('records a non-enforcement action even when no violation was observed', () => {
    // A fallen City stop sign: Violation observed "No" + a City service /
    // repair referral is a real recorded outcome — never "nothing was done".
    expect(deriveFieldVisitOutcome('no', 'city_service_referral')).toBe('city_service_referral')
    expect(deriveFieldVisitOutcome('no', 'referred_other_department')).toBe('referred_other_department')
    expect(deriveFieldVisitOutcome('no', 'public_safety_response')).toBe('public_safety_response')
    // And the same actions hold when a violation WAS observed or is unclear.
    expect(deriveFieldVisitOutcome('yes', 'city_service_referral')).toBe('city_service_referral')
    expect(deriveFieldVisitOutcome('unclear', 'public_safety_response')).toBe('public_safety_response')
  })

  it('maps an explicit "no violation found" action to the no-violation disposition', () => {
    expect(deriveFieldVisitOutcome('no', 'no_violation_found')).toBe('no_violation')
    expect(deriveFieldVisitOutcome('unclear', 'no_violation_found')).toBe('no_violation')
  })
})

describe('enforcement action labels', () => {
  it('labels every selectable action, including the non-enforcement outcomes', () => {
    const expected: Record<EnforcementAction, string> = {
      warning_education: 'Education / warning provided',
      notice_issued: 'Notice issued',
      ticket_issued: 'Ticket / penalty notice issued',
      city_service_referral: 'City service / repair referral',
      referred_other_department: 'Referred to another department',
      public_safety_response: 'Public safety response',
      no_violation_found: 'No violation found',
      no_action: 'No action taken',
      other: 'Other',
    }
    expect(ENFORCEMENT_ACTION_LABELS).toEqual(expected)
  })

  it('labels every derived field-visit outcome', () => {
    // Every action, with any violation answer, must land on a labelled outcome.
    const actions = Object.keys(ENFORCEMENT_ACTION_LABELS) as EnforcementAction[]
    for (const action of actions) {
      for (const violation of ['yes', 'no', 'unclear']) {
        const outcome = deriveFieldVisitOutcome(violation, action)
        expect(FIELD_OUTCOME_LABELS[outcome]).toBeTruthy()
      }
    }
  })
})
