import { describe, it, expect } from 'vitest'
import {
  RESIDENT_STAGES,
  STATUS_LABELS,
  stageIndexForStatus,
  type ResidentStatus,
} from '../../src/services/residentRequests'

// Part 10: status mapping for the resident-facing tracker.
describe('stageIndexForStatus', () => {
  it('maps each canonical status to its ordered stage index', () => {
    const expected: Array<[ResidentStatus, number]> = [
      ['submitted', 0],
      ['received', 1],
      ['assigned', 2],
      ['in_review', 3],
      ['closed', 4],
    ]
    for (const [status, index] of expected) {
      expect(stageIndexForStatus(status)).toBe(index)
    }
  })

  it('defaults an unknown status to the first stage', () => {
    expect(stageIndexForStatus('nonsense')).toBe(0)
    expect(stageIndexForStatus('')).toBe(0)
  })

  it('keeps the stage list and labels aligned', () => {
    expect(RESIDENT_STAGES).toHaveLength(5)
    for (const stage of RESIDENT_STAGES) {
      expect(STATUS_LABELS[stage.key]).toBe(stage.label)
    }
  })
})

describe('STATUS_LABELS', () => {
  it('has a human label for every status', () => {
    expect(STATUS_LABELS.submitted).toBe('Submitted')
    expect(STATUS_LABELS.received).toBe('Received')
    expect(STATUS_LABELS.assigned).toBe('Assigned')
    expect(STATUS_LABELS.in_review).toBe('Under review')
    expect(STATUS_LABELS.closed).toBe('Closed')
  })
})
