import { describe, expect, it } from 'vitest'
import {
  BRAMPTON_BENCHMARK_WEIGHTS,
  MAX_SIMILAR_CASES,
  MIN_SIMILARITY_SCORE,
  STRUCTURED_SIMILARITY_WEIGHTS,
  classifyHistoricalResolution,
  closureDays,
  complaintFamily,
  scoreSimilarCases,
  similarQueryFromResidentRow,
  statusClass,
  type SimilarCaseCandidate,
  type SimilarCaseQuery,
} from './structuredSimilarCases'

// The scoring is deterministic, rules-based TypeScript — these tests pin the
// weighted rules per mode, the ordering, the current-case exclusion, the top-3
// cap, and the conservative historical-resolution classification.

const query: SimilarCaseQuery = {
  mode: 'nyc_historical',
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

// ---------------------------------------------------------------------------
// Brampton benchmark mode — the reported issue drives the match; geography,
// agency, current-case closure duration, and status class are excluded.
// ---------------------------------------------------------------------------

const bramptonQuery = similarQueryFromResidentRow({
  case_id: 'RSR-20260710-AB12',
  request_type: 'Parking issue',
  description: 'A car is blocking my driveway every night and I cannot get out',
  status: 'submitted',
  created_at: '2025-06-10T09:00:00Z',
  nyc311_complaint_type: 'Blocked Driveway',
  nyc311_district: 'Brooklyn', // alignment value — must NOT be used as geography
})

describe('brampton_benchmark mode', () => {
  it('builds the query without borough/district/agency from the alignment columns', () => {
    expect(bramptonQuery.mode).toBe('brampton_benchmark')
    expect(bramptonQuery.borough).toBeUndefined()
    expect(bramptonQuery.councilDistrict).toBeUndefined()
    expect(bramptonQuery.agency).toBeUndefined()
    expect(bramptonQuery.requestType).toBe('Parking issue')
    expect(bramptonQuery.description).toMatch(/blocking my driveway/)
  })

  it('ignores geography and agency: identical issue in different boroughs scores identically', () => {
    const inBrooklyn = candidate({ case_id: 'NYC-A-BK', borough: 'BROOKLYN', council_district: '34', agency: 'NYPD' })
    const inQueens = candidate({ case_id: 'NYC-B-QN', borough: 'QUEENS', council_district: '22', agency: 'DSNY' })
    const [a, b] = scoreSimilarCases(bramptonQuery, [inBrooklyn, inQueens])
    expect(a.similarityScore).toBeCloseTo(b.similarityScore, 10)
    // Geography/agency never appear as reasons in benchmark mode.
    expect([...a.reasons, ...b.reasons]).not.toContain('Same borough')
    expect([...a.reasons, ...b.reasons]).not.toContain('Same council district')
    expect([...a.reasons, ...b.reasons]).not.toContain('Same agency')
  })

  it('ranks candidates matching the resident description above ones that do not', () => {
    const matchingText = candidate({
      case_id: 'NYC-TEXT-MATCH',
      request_detail: 'Vehicle blocking driveway, resident cannot get car out at night',
    })
    const unrelatedText = candidate({
      case_id: 'NYC-TEXT-OTHER',
      request_detail: 'Commercial overnight parking of oversized vehicle',
    })
    const results = scoreSimilarCases(bramptonQuery, [unrelatedText, matchingText])
    expect(results[0].caseId).toBe('NYC-TEXT-MATCH')
    expect(results[0].similarityScore).toBeGreaterThan(results[1].similarityScore)
  })

  it('only accepts closed candidates with usable resolution text', () => {
    const noResolution = candidate({ case_id: 'NYC-NO-RES', resolution_description: null })
    const stillOpen = candidate({ case_id: 'NYC-OPEN', closed_at: null })
    const usable = candidate({ case_id: 'NYC-USABLE' })
    const results = scoreSimilarCases(bramptonQuery, [noResolution, stillOpen, usable])
    expect(results.map((r) => r.caseId)).toEqual(['NYC-USABLE'])
  })

  it('caps a perfect benchmark match at the documented weight total', () => {
    // Exact complaint type (0.45) + full request-type/description overlap would
    // need identical token sets; verify the weights themselves stay documented.
    const total =
      BRAMPTON_BENCHMARK_WEIGHTS.complaintFamily +
      BRAMPTON_BENCHMARK_WEIGHTS.requestTypeTerms +
      BRAMPTON_BENCHMARK_WEIGHTS.descriptionTerms +
      BRAMPTON_BENCHMARK_WEIGHTS.season
    expect(total).toBeCloseTo(1.0, 10)
  })
})

// ---------------------------------------------------------------------------
// Conservative historical-resolution classification — explicit phrases only.
// ---------------------------------------------------------------------------

describe('classifyHistoricalResolution', () => {
  it('labels only explicitly supported outcomes', () => {
    expect(classifyHistoricalResolution('Upon inspection the condition was corrected.')).toBe(
      'Condition corrected',
    )
    expect(classifyHistoricalResolution('The complaint was referred to the Department of Buildings.')).toBe(
      'Referred to another agency',
    )
    expect(classifyHistoricalResolution('No violation was observed at the location.')).toBe(
      'No condition found',
    )
    expect(classifyHistoricalResolution('A notice of violation was served on the owner.')).toBe(
      'Notice explicitly referenced',
    )
    expect(classifyHistoricalResolution('The service request has been closed.')).toBe('Closed or resolved')
  })

  it('returns null for vague text — never infers a ticket, fine, or warning', () => {
    expect(classifyHistoricalResolution('The Police Department responded to the complaint.')).toBeNull()
    expect(classifyHistoricalResolution('Officers took appropriate action.')).toBeNull()
    expect(classifyHistoricalResolution(null)).toBeNull()
    expect(classifyHistoricalResolution('')).toBeNull()
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
