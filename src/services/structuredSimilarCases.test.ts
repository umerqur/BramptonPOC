import { describe, expect, it } from 'vitest'
import {
  MAX_SIMILAR_CASES,
  MIN_SIMILARITY_SCORE,
  STRUCTURED_SIMILARITY_WEIGHTS,
  closureDays,
  complaintFamily,
  scoreSimilarCases,
  statusClass,
  type SimilarCaseCandidate,
  type SimilarCaseQuery,
} from './structuredSimilarCases'

// The scoring is deterministic, rules-based TypeScript — these tests pin the
// weighted rules, the ordering, the current-case exclusion, and the top-3 cap.

const query: SimilarCaseQuery = {
  currentCaseId: 'NYC-CURRENT',
  complaintType: 'Blocked Driveway',
  descriptor: 'No Access',
  agency: 'NYPD',
  borough: 'BROOKLYN',
  councilDistrict: '34',
  status: 'Closed',
  submittedAt: '2025-06-10T09:00:00Z',
  closedAt: '2025-06-15T09:00:00Z', // 5-day closure — the reference duration
}

function candidate(overrides: Partial<SimilarCaseCandidate>): SimilarCaseCandidate {
  return {
    case_id: 'NYC-X',
    complaint_type: 'Blocked Driveway',
    request_detail: 'No Access',
    agency: 'NYPD',
    agency_name: null,
    assigned_department: null,
    borough: 'BROOKLYN',
    council_district: '34',
    status: 'Closed',
    submitted_at: '2025-06-01T09:00:00Z',
    closed_at: '2025-06-06T09:00:00Z', // 5-day closure, same as reference
    resolution_description: 'The Police Department responded and took action.',
    ...overrides,
  }
}

describe('scoreSimilarCases weighting', () => {
  it('scores a full structured match at 1.0 with complete reasons', () => {
    const [top] = scoreSimilarCases(query, [candidate({ case_id: 'NYC-FULL' })])
    expect(top.caseId).toBe('NYC-FULL')
    expect(top.similarityScore).toBeCloseTo(1.0, 5)
    expect(top.similarityPct).toBe(100)
    expect(top.reasons).toContain('Same complaint type')
    expect(top.closureDays).toBe(5)
    expect(top.resolutionSummary).toMatch(/Police Department/)
  })

  it('weights an exact complaint-type mismatch by exactly its documented weight', () => {
    // Same everything except a different complaint family: loses the full 0.30
    // complaint weight and the 0.15 descriptor weight stays (same descriptor).
    const [full] = scoreSimilarCases(query, [candidate({ case_id: 'NYC-FULL' })])
    const [other] = scoreSimilarCases(query, [
      candidate({ case_id: 'NYC-OTHER-TYPE', complaint_type: 'Illegal Dumping' }),
    ])
    expect(full.similarityScore - other.similarityScore).toBeCloseTo(
      STRUCTURED_SIMILARITY_WEIGHTS.complaintType,
      5,
    )
  })

  it('gives half the complaint weight for a same-family subtype', () => {
    const q: SimilarCaseQuery = { ...query, complaintType: 'Noise - Residential' }
    const [sameFamily] = scoreSimilarCases(q, [
      candidate({ case_id: 'NYC-FAM', complaint_type: 'Noise - Street/Sidewalk' }),
    ])
    expect(sameFamily.reasons).toContain('Same complaint family')
    // 1.0 minus half of the 0.30 complaint-type weight.
    expect(sameFamily.similarityScore).toBeCloseTo(1 - STRUCTURED_SIMILARITY_WEIGHTS.complaintType / 2, 5)
  })

  it('scores closure-duration proximity against the current case duration', () => {
    const near = candidate({
      case_id: 'NYC-NEAR',
      submitted_at: '2025-06-01T09:00:00Z',
      closed_at: '2025-06-07T09:00:00Z', // 6 days vs reference 5
    })
    const far = candidate({
      case_id: 'NYC-FAR',
      submitted_at: '2025-03-01T09:00:00Z',
      closed_at: '2025-05-30T09:00:00Z', // 90 days vs reference 5
    })
    const [a, b] = scoreSimilarCases(query, [far, near])
    expect(a.caseId).toBe('NYC-NEAR')
    expect(a.similarityScore).toBeGreaterThan(b.similarityScore)
  })
})

describe('scoreSimilarCases ordering and caps', () => {
  it('excludes the current case even on a perfect match', () => {
    const result = scoreSimilarCases(query, [candidate({ case_id: 'NYC-CURRENT' })])
    expect(result).toEqual([])
  })

  it('returns at most 3 results', () => {
    const pool = Array.from({ length: 10 }, (_, i) => candidate({ case_id: `NYC-${i}` }))
    expect(scoreSimilarCases(query, pool)).toHaveLength(MAX_SIMILAR_CASES)
  })

  it('orders deterministically: score descending, then case id', () => {
    const strong = candidate({ case_id: 'NYC-B' })
    const strongTie = candidate({ case_id: 'NYC-A' })
    const weaker = candidate({ case_id: 'NYC-0', borough: 'QUEENS', council_district: '22' })
    const first = scoreSimilarCases(query, [strong, weaker, strongTie])
    const second = scoreSimilarCases(query, [weaker, strongTie, strong])
    expect(first.map((r) => r.caseId)).toEqual(['NYC-A', 'NYC-B', 'NYC-0'])
    // Input order must not change the output order (stable + deterministic).
    expect(second.map((r) => r.caseId)).toEqual(first.map((r) => r.caseId))
  })

  it('returns an empty list when nothing clears the minimum score', () => {
    const unrelated = candidate({
      case_id: 'NYC-UNRELATED',
      complaint_type: 'Illegal Dumping',
      request_detail: 'Construction debris',
      agency: 'DSNY',
      borough: 'QUEENS',
      council_district: '22',
      status: 'Open',
      closed_at: null,
      submitted_at: '2025-01-05T09:00:00Z',
    })
    const result = scoreSimilarCases(query, [unrelated])
    // Everything mismatches; whatever tiny residue remains sits below the floor.
    expect(result.every((r) => r.similarityScore >= MIN_SIMILARITY_SCORE)).toBe(true)
    expect(result).toEqual([])
  })
})

describe('helpers', () => {
  it('derives the complaint family from the text before the dash', () => {
    expect(complaintFamily('Noise - Residential')).toBe('noise')
    expect(complaintFamily('Blocked Driveway')).toBe('blocked driveway')
    expect(complaintFamily(null)).toBe('')
  })

  it('computes closure days and status classes', () => {
    expect(closureDays('2025-06-10T00:00:00Z', '2025-06-15T00:00:00Z')).toBe(5)
    expect(closureDays('2025-06-10T00:00:00Z', null)).toBeNull()
    expect(statusClass('Closed')).toBe('closed')
    expect(statusClass('In Progress')).toBe('open')
    expect(statusClass('Open', '2025-06-15T00:00:00Z')).toBe('closed')
  })
})
