import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SimilarCaseIntelligencePanel from './SimilarCaseIntelligencePanel'
import { getStructuredSimilarCases } from '../../services/structuredSimilarCases'
import type { StructuredSimilarCase } from '../../services/structuredSimilarCases'

vi.mock('../../services/structuredSimilarCases', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/structuredSimilarCases')>()
  return { ...actual, getStructuredSimilarCases: vi.fn() }
})

const QUERY = {
  mode: 'nyc_historical' as const,
  currentCaseId: 'NYC-311-CURRENT',
  complaintType: 'Blocked Driveway',
  borough: 'BROOKLYN',
}

const BENCHMARK_QUERY = {
  mode: 'brampton_benchmark' as const,
  currentCaseId: 'RSR-20260701-TEST',
  complaintType: 'Blocked Driveway',
  requestType: 'Parking issue',
  description: 'A car keeps blocking my driveway',
}

function match(overrides: Partial<StructuredSimilarCase>): StructuredSimilarCase {
  return {
    caseId: 'NYC-311-0001',
    complaintType: 'Blocked Driveway',
    area: 'BROOKLYN · District 34',
    agency: 'New York City Police Department',
    status: 'Closed',
    closureDays: 5,
    resolutionSummary: 'The condition was corrected by the property owner.',
    historicalResolution: 'Condition corrected',
    similarityScore: 0.9,
    similarityPct: 90,
    reasons: ['Same complaint type', 'Same borough'],
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(getStructuredSimilarCases).mockReset()
})

describe('SimilarCaseIntelligencePanel', () => {
  it('renders each similar case as a link to the NYC case route', async () => {
    vi.mocked(getStructuredSimilarCases).mockResolvedValue([
      match({ caseId: 'NYC-311-0001' }),
      match({ caseId: 'NYC-311-0002', similarityPct: 80 }),
    ])

    render(
      <MemoryRouter>
        <SimilarCaseIntelligencePanel query={QUERY} />
      </MemoryRouter>,
    )

    const link = await screen.findByRole('link', { name: /open similar case NYC-311-0001/i })
    expect(link).toHaveAttribute('href', '/app/nyc_case/NYC-311-0001')
    expect(screen.getByRole('link', { name: /open similar case NYC-311-0002/i })).toHaveAttribute(
      'href',
      '/app/nyc_case/NYC-311-0002',
    )
    // Row content: score, closure duration, and the plain-language reasons.
    expect(screen.getByText('90% match')).toBeInTheDocument()
    expect(screen.getAllByText(/Closed in 5 days/)).not.toHaveLength(0)
    expect(screen.getAllByText(/Same complaint type · Same borough/)).not.toHaveLength(0)
  })

  it('uses benchmark framing and shows agency + resolution for resident cases', async () => {
    vi.mocked(getStructuredSimilarCases).mockResolvedValue([match({ caseId: 'NYC-311-0009' })])

    render(
      <MemoryRouter>
        <SimilarCaseIntelligencePanel query={BENCHMARK_QUERY} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Comparable NYC benchmark outcomes')).toBeInTheDocument()
    expect(
      screen.getByText(/benchmark references, not Brampton precedents/i),
    ).toBeInTheDocument()
    // Row shows the agency, the conservative resolution label, and the text.
    expect(screen.getByText('New York City Police Department')).toBeInTheDocument()
    expect(screen.getByText('Condition corrected')).toBeInTheDocument()
    expect(screen.getByText(/condition was corrected by the property owner/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open similar case NYC-311-0009/i })).toHaveAttribute(
      'href',
      '/app/nyc_case/NYC-311-0009',
    )
  })

  it('shows the empty state when no comparable cases exist', async () => {
    vi.mocked(getStructuredSimilarCases).mockResolvedValue([])

    render(
      <MemoryRouter>
        <SimilarCaseIntelligencePanel query={QUERY} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('No comparable closed cases found.')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
