import { describe, expect, it } from 'vitest'
import { assessFieldOutcomeReadiness, isFieldMissing } from './fieldOutcomeReadiness'

// The readiness verdict is deterministic TypeScript — these tests pin the exact
// rules the form, the submit handler, and the assistant server all rely on.

const completeDraft = {
  observedCondition: 'Vehicle parked across the driveway.',
  violationObserved: 'yes',
  enforcementAction: 'warning_education',
  referenceNumber: '',
  actionTaken: 'Issued a verbal warning.',
  followUpRequired: false,
}

describe('assessFieldOutcomeReadiness', () => {
  it('marks a complete non-ticket outcome as ready', () => {
    const r = assessFieldOutcomeReadiness(completeDraft)
    expect(r.ready).toBe(true)
    expect(r.missingLabels).toEqual([])
    // Reference number is explicitly "not required" for non-ticket actions.
    const ref = r.items.find((i) => i.field === 'reference_number')
    expect(ref?.status).toBe('complete')
    expect(ref?.detail).toMatch(/not required/i)
  })

  it('flags every required field on an empty draft', () => {
    const r = assessFieldOutcomeReadiness({
      observedCondition: '',
      violationObserved: '',
      enforcementAction: '',
      referenceNumber: '',
      actionTaken: '',
      followUpRequired: false,
    })
    expect(r.ready).toBe(false)
    expect(r.missingLabels).toEqual([
      'Observed condition',
      'Violation observed',
      'Enforcement action',
      'Action taken / resolution details',
    ])
  })

  it('treats whitespace-only text as missing', () => {
    const r = assessFieldOutcomeReadiness({ ...completeDraft, observedCondition: '   ' })
    expect(r.ready).toBe(false)
    expect(isFieldMissing(r, 'observed_condition')).toBe(true)
  })

  it('requires the reference number only when a ticket was issued', () => {
    const withoutRef = assessFieldOutcomeReadiness({
      ...completeDraft,
      enforcementAction: 'ticket_issued',
      referenceNumber: '',
    })
    expect(withoutRef.ready).toBe(false)
    expect(withoutRef.missingLabels).toEqual(['Ticket / penalty notice number'])

    const withRef = assessFieldOutcomeReadiness({
      ...completeDraft,
      enforcementAction: 'ticket_issued',
      referenceNumber: 'PN-2026-0042',
    })
    expect(withRef.ready).toBe(true)
  })

  it('accepts the non-enforcement actions without requiring a reference number', () => {
    // A fallen City stop sign: Violation observed "No", a City service /
    // repair referral, follow-up required — a complete, submittable outcome.
    for (const action of [
      'city_service_referral',
      'referred_other_department',
      'public_safety_response',
      'no_violation_found',
    ]) {
      const r = assessFieldOutcomeReadiness({
        ...completeDraft,
        violationObserved: 'no',
        enforcementAction: action,
        actionTaken: 'Reported the fallen stop sign for repair.',
        followUpRequired: true,
      })
      expect(r.ready).toBe(true)
      expect(r.missingLabels).toEqual([])
      const ref = r.items.find((i) => i.field === 'reference_number')
      expect(ref?.status).toBe('complete')
      expect(ref?.detail).toMatch(/not required/i)
    }
  })

  it('flags "unclear" violation as attention without blocking readiness', () => {
    const r = assessFieldOutcomeReadiness({ ...completeDraft, violationObserved: 'unclear' })
    expect(r.ready).toBe(true)
    expect(r.attentionLabels).toEqual(['Violation observed'])
    expect(isFieldMissing(r, 'violation_observed')).toBe(false)
  })

  it('treats a missing violation selection as missing, not attention', () => {
    const r = assessFieldOutcomeReadiness({ ...completeDraft, violationObserved: null })
    expect(r.ready).toBe(false)
    expect(isFieldMissing(r, 'violation_observed')).toBe(true)
  })

  it('always reports the follow-up selection so the officer confirms it', () => {
    const yes = assessFieldOutcomeReadiness({ ...completeDraft, followUpRequired: true })
    const followUp = yes.items.find((i) => i.field === 'follow_up_required')
    expect(followUp?.status).toBe('complete')
    expect(followUp?.detail).toMatch(/follow-up required/i)
  })
})
