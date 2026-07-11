import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AppOfficerCasePage from './AppOfficerCasePage'
import {
  StructuredFieldOutcomeUnavailableError,
  getResidentRequestByCaseId,
  recordResidentFieldOutcome,
} from '../../services/residentRequests'
import { makeCompleteOutcomeRow, makeResidentRow } from '../../test/fixtures'

// The signed-in officer the page authorizes against (must match the fixture's
// assigned_officer_email).
const OFFICER_EMAIL = 'officer.oakley@example.com'

vi.mock('../../lib/workflowStore', () => ({
  useWorkflow: () => ({ role: 'officer', cases: [], userEmail: OFFICER_EMAIL }),
}))

// Support panels with their own data dependencies — not under test here.
vi.mock('../../components/app/OfficerCaseAssistant', () => ({ default: () => null }))
vi.mock('../../components/app/ResidentAttachments', () => ({ default: () => null }))
vi.mock('../../components/app/SimilarCaseIntelligencePanel', () => ({ default: () => null }))
vi.mock('../../services/structuredSimilarCases', () => ({
  similarQueryFromDemoCase: () => null,
  similarQueryFromResidentRow: () => null,
}))

vi.mock('../../services/residentRequests', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/residentRequests')>()
  return {
    ...actual,
    getResidentRequestByCaseId: vi.fn(),
    recordResidentFieldOutcome: vi.fn(),
  }
})

function renderPage(caseId: string) {
  return render(
    <MemoryRouter initialEntries={[`/case/${caseId}`]}>
      <Routes>
        <Route path="/case/:caseId" element={<AppOfficerCasePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function fillAndSubmitCompleteForm() {
  await screen.findByText('Record field outcome')

  fireEvent.change(screen.getByPlaceholderText('Describe what you observed on site…'), {
    target: { value: 'Vehicle parked across the driveway.' },
  })
  fireEvent.change(screen.getByLabelText('Enforcement action'), {
    target: { value: 'warning_education' },
  })
  fireEvent.change(
    screen.getByPlaceholderText(
      'Describe the action taken, notice issued, warning provided, or reason no action was required…',
    ),
    { target: { value: 'Issued a verbal warning.' } },
  )
  fireEvent.click(screen.getByRole('button', { name: 'Field outcome complete' }))
}

beforeEach(() => {
  vi.mocked(getResidentRequestByCaseId).mockResolvedValue(makeResidentRow())
  vi.mocked(recordResidentFieldOutcome).mockReset()
})

describe('AppOfficerCasePage field outcome submission', () => {
  it('does not show success when the structured action was not saved', async () => {
    // The save fails with the typed migration-unavailable error — the officer
    // must see a clear error, never "Field outcome recorded".
    vi.mocked(recordResidentFieldOutcome).mockRejectedValue(new StructuredFieldOutcomeUnavailableError())

    renderPage('RSR-20260709-7BX8')
    await fillAndSubmitCompleteForm()

    expect(
      await screen.findByText(
        /structured enforcement action could not be saved because the required database migration is missing/i,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Field outcome recorded')).not.toBeInTheDocument()
    expect(screen.queryByText(/Ready for supervisor closure review/)).not.toBeInTheDocument()
  })

  it('does not show success when the returned row lacks the structured action', async () => {
    // Defensive UI check: even if the service resolved, an incomplete returned
    // row must not flip the page into the success state.
    vi.mocked(recordResidentFieldOutcome).mockResolvedValue(
      makeCompleteOutcomeRow({ field_enforcement_action: null }),
    )

    renderPage('RSR-20260709-7BX8')
    await fillAndSubmitCompleteForm()

    expect(await screen.findByText(/complete field outcome was not saved/i)).toBeInTheDocument()
    expect(screen.queryByText('Field outcome recorded')).not.toBeInTheDocument()
  })

  it('shows the success state when the database confirms the complete structured outcome', async () => {
    vi.mocked(recordResidentFieldOutcome).mockResolvedValue(makeCompleteOutcomeRow())

    renderPage('RSR-20260709-7BX8')
    await fillAndSubmitCompleteForm()

    expect(await screen.findByText('Field outcome recorded')).toBeInTheDocument()
    expect(screen.getByText(/Ready for supervisor closure review/)).toBeInTheDocument()
  })
})
