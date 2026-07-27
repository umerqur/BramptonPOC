import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import SolutionArchitectureDiagram, { DIAGRAM_TITLE_LINE_1 } from './SolutionArchitectureDiagram'

// The simplified executive architecture diagram is a City submission artifact.
// These tests pin its structure (six components, governance message, residency
// statements) and — just as importantly — that no internal implementation
// details leak into it.

describe('SolutionArchitectureDiagram', () => {
  it('renders exactly the six executive components and the two panels', () => {
    render(<SolutionArchitectureDiagram />)

    for (const component of [
      'Resident and City Staff',
      'Web Application',
      'Application Services',
      'AI Assisted Decision Support',
      'Data Platform',
      'Approved External Services',
    ]) {
      expect(screen.getByText(component)).toBeInTheDocument()
    }

    expect(screen.getByText('Data hosting and residency')).toBeInTheDocument()
    expect(screen.getByText('Key messages')).toBeInTheDocument()
  })

  it('carries the governance and key messages', () => {
    render(<SolutionArchitectureDiagram />)

    expect(
      screen.getByText(/does not automate enforcement decisions/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/responsible for reviewing and approving every outcome/),
    ).toBeInTheDocument()
    expect(screen.getByText('AI assisted decision support system')).toBeInTheDocument()
    expect(screen.getByText('Public benchmark and synthetic data only')).toBeInTheDocument()
    expect(screen.getByText('City operational data is not currently used')).toBeInTheDocument()
    expect(screen.getByText('Production architecture finalized with the City')).toBeInTheDocument()
  })

  it('states the corrected data hosting and residency position', () => {
    render(<SolutionArchitectureDiagram />)

    expect(
      screen.getByText('Public benchmark source data is stored in AWS object storage.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Application data is stored in a Canadian hosted Supabase environment.'),
    ).toBeInTheDocument()
    // Production caveat is word-wrapped across lines; match its start.
    expect(
      screen.getByText(/Any production use of City operational data remains subject/),
    ).toBeInTheDocument()
  })

  it('exposes no internal implementation details', () => {
    const { container } = render(<SolutionArchitectureDiagram />)
    const text = container.textContent ?? ''

    // Providers, models, functions, routes, tables, auth internals, and
    // retrieval configuration must not appear in the submission diagram.
    const forbidden = [
      /anthropic/i,
      /claude/i,
      /cohere/i,
      /qdrant/i,
      /groq/i,
      /mailjet/i,
      /netlify/i,
      /embed-english/i,
      /rerank/i,
      /top-?50/i,
      /anon key/i,
      /service.role/i,
      /magic link/i,
      /allowlist/i,
      /RLS|Row Level Security/,
      /\/app\/|\/resident/,
      /resident_service_requests|municipal_complaints|workflow_events/,
      /env var/i,
    ]
    for (const pattern of forbidden) {
      expect(text).not.toMatch(pattern)
    }
  })

  it('is an accessible, titled SVG', () => {
    const { container } = render(<SolutionArchitectureDiagram />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('role', 'img')
    expect(svg?.getAttribute('aria-label')).toContain(DIAGRAM_TITLE_LINE_1)
  })
})
