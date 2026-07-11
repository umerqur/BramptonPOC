import { describe, expect, it } from 'vitest'
import { residentFieldOutcomeNeedsRepair, residentRowToCase } from './residentCaseBridge'
import { fieldOutcomeNeedsStructuredAction } from './demoWorkflowService'
import type { ResidentRequestRow } from './residentRequests'
import { makeCompleteOutcomeRow, makeIncompleteOutcomeRow, makeResidentRow } from '../test/fixtures'

describe('residentFieldOutcomeNeedsRepair', () => {
  it('marks a completed visit with no structured action as requiring repair', () => {
    const row = {
      field_visit_completed: true,
      field_enforcement_action: null,
    }

    expect(residentFieldOutcomeNeedsRepair(row as ResidentRequestRow)).toBe(true)
  })

  it('does not require repair when a valid structured action is recorded', () => {
    expect(residentFieldOutcomeNeedsRepair(makeCompleteOutcomeRow())).toBe(false)
  })

  it('does not require repair before the field visit is completed', () => {
    expect(residentFieldOutcomeNeedsRepair(makeResidentRow())).toBe(false)
  })

  it('treats an unknown stored enforcement-action value as requiring repair', () => {
    expect(
      residentFieldOutcomeNeedsRepair(makeIncompleteOutcomeRow({ field_enforcement_action: 'gave_a_warning' })),
    ).toBe(true)
  })
})

describe('residentRowToCase', () => {
  it('never invents an enforcement action from officer free text', () => {
    // The officer's notes SAY a warning was given, but no structured action was
    // recorded — the case must remain distinguishable as incomplete, never
    // silently mapped to warning_education.
    const row = makeIncompleteOutcomeRow({
      field_action_taken: 'Gave the owner a warning about the driveway.',
      field_officer_notes: 'Verbal warning provided.',
    })

    const demoCase = residentRowToCase(row)

    expect(demoCase.fieldAction).not.toBeNull()
    expect(demoCase.fieldAction?.enforcementAction).toBeNull()
    expect(fieldOutcomeNeedsStructuredAction(demoCase.fieldAction)).toBe(true)
  })

  it('rebuilds the closure draft from the recorded structured action for a complete outcome', () => {
    const demoCase = residentRowToCase(makeCompleteOutcomeRow())

    expect(demoCase.fieldAction?.enforcementAction).toBe('warning_education')
    expect(fieldOutcomeNeedsStructuredAction(demoCase.fieldAction)).toBe(false)
    expect(demoCase.stage).toBe('staff-review')
    expect(demoCase.draft).not.toBeNull()
    expect(demoCase.draft?.body).toContain('education or a warning')
  })

  it('returns no field action when the visit has not been completed', () => {
    expect(residentRowToCase(makeResidentRow()).fieldAction).toBeNull()
  })
})
