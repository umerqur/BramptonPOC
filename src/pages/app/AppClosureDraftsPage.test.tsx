import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AppClosureDraftsPage from './AppClosureDraftsPage'
import { residentRowToCase } from '../../services/residentCaseBridge'
import type { DemoCase } from '../../data/demoWorkflowTypes'
import { makeCompleteOutcomeRow, makeIncompleteOutcomeRow } from '../../test/fixtures'

// The case under review, swapped per test. The store hooks are mocked so the
// page renders exactly the case each test constructs from a Supabase row.
const h = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('../../lib/useDemoCase', () => ({
  useDemoCase: () => h.current,
}))

vi.mock('../../lib/workflowStore', () => ({
  useWorkflow: () => ({
    cases: h.current ? [h.current] : [],
    activeCase: h.current,
    setActiveCase: vi.fn(),
    editDraftBody: vi.fn(),
    approveClosure: vi.fn(),
    sendToStaffReview: vi.fn(),
    role: 'supervisor',
  }),
}))

function renderPage(demoCase: DemoCase) {
  h.current = demoCase
  return render(
    <MemoryRouter>
      <AppClosureDraftsPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  h.current = null
})

describe('Closure Review with an incomplete structured field outcome', () => {
  it('blocks approval while the structured action is missing', () => {
    const demoCase = residentRowToCase(makeIncompleteOutcomeRow())
    renderPage(demoCase)

    // The block explains the exact state: visit recorded, action missing.
    expect(screen.getByText('Field outcome incomplete')).toBeInTheDocument()
    expect(screen.getByText('Field visit recorded, action incomplete')).toBeInTheDocument()
    expect(
      screen.getByText(/officer completed the visit, but the structured enforcement action is missing/i),
    ).toBeInTheDocument()

    // No approval is possible in this state.
    expect(screen.queryByRole('button', { name: /approve final response/i })).not.toBeInTheDocument()

    // The path forward routes to the Case Workbench repair card.
    const workbenchLink = screen.getByRole('link', { name: 'Open Case Workbench' })
    expect(workbenchLink).toHaveAttribute('href', `/app/workbench?case=${demoCase.id}`)
  })
})

describe('Closure Review with a complete officer field outcome', () => {
  it('allows supervisor approval after a complete officer field outcome', () => {
    const demoCase = residentRowToCase(makeCompleteOutcomeRow())
    renderPage(demoCase)

    // The valid flow: draft prepared from the recorded structured action, and
    // the supervisor approval button is available and enabled.
    expect(screen.queryByText('Field visit recorded, action incomplete')).not.toBeInTheDocument()
    expect(screen.getByText(/Based on a recorded field visit/i)).toBeInTheDocument()

    const approveButton = screen.getByRole('button', { name: /approve final response/i })
    expect(approveButton).toBeEnabled()
  })
})
