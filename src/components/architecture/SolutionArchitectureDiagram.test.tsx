import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import SolutionArchitectureDiagram, { DIAGRAM_TITLE_LINE_1 } from './SolutionArchitectureDiagram'

// The architecture diagram is a submission artifact for City reviewers, so
// these tests pin the structural content: the nine trust zones, all twelve
// numbered flows, the honesty labels, and the governance/residency panels.

describe('SolutionArchitectureDiagram', () => {
  it('renders every trust zone and the required panels', () => {
    render(<SolutionArchitectureDiagram />)

    for (const zone of [
      'Public User Zone',
      'Authorized City Staff Zone',
      'Application Presentation',
      'Server-Side Processing',
      'Data Platform Zone',
      'AI Services Zone',
      'Communications Zone',
      'Benchmark & POC Data',
    ]) {
      expect(screen.getByText(zone)).toBeInTheDocument()
    }

    // The future production zone is a distinct dashed boundary.
    expect(
      screen.getByText(/FUTURE CITY PRODUCTION ZONE — proposed control model/),
    ).toBeInTheDocument()

    expect(screen.getByText('Numbered data flows')).toBeInTheDocument()
    expect(screen.getByText('Data classification legend')).toBeInTheDocument()
    expect(screen.getByText('Security controls (current POC)')).toBeInTheDocument()
    expect(screen.getByText('Data residency')).toBeInTheDocument()
  })

  it('shows all twelve numbered flows plus the AI governance guardrails', () => {
    const { container } = render(<SolutionArchitectureDiagram />)
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent ?? '')

    // Flow badges 1–12 all appear at least once (list panel + on-diagram badges).
    for (let n = 1; n <= 12; n++) {
      expect(texts).toContain(String(n))
    }

    expect(screen.getByText('No autonomous enforcement decisions')).toBeInTheDocument()
    expect(screen.getByText('No autonomous case closure')).toBeInTheDocument()
    expect(screen.getByText('No direct resident communication')).toBeInTheDocument()
    expect(screen.getByText('NOT Brampton operational data')).toBeInTheDocument()
  })

  it('is an accessible, titled SVG that does not overclaim residency', () => {
    const { container } = render(<SolutionArchitectureDiagram />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('role', 'img')
    expect(svg?.getAttribute('aria-label')).toContain(DIAGRAM_TITLE_LINE_1)

    // Residency honesty: the POC column never claims Canadian hosting. Panel
    // text is word-wrapped across <text> lines, so match single-line fragments.
    expect(screen.getByText('No City of Brampton operational data')).toBeInTheDocument()
    expect(screen.getByText('Canadian data residency is a')).toBeInTheDocument()
  })
})
