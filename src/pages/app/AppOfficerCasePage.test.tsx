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

// Mirrors the real production route: App.tsx maps /app/field/:caseId to
// AppOfficerCasePage (the resident officer case page shown in the field
// console), so these tests exercise the exact component the live route serves.
function renderPage(caseId: string) {
  return render(
    <MemoryRouter initialEntries={[`/app/field/${caseId}`]}>
      <Routes>
        <Route path="/app/field/:caseId" element={<AppOfficerCasePage />} />
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

describe('AppOfficerCasePage enforcement action dropdown', () => {
  it('renders all nine enforcement actions, including the non-enforcement outcomes', async () => {
    renderPage('RSR-20260709-7BX8')
    await screen.findByText('Record field outcome')

    const select = screen.getByLabelText('Enforcement action') as HTMLSelectElement
    const optionLabels = Array.from(select.options).map((o) => o.textContent)
    expect(optionLabels).toEqual([
      'Select an enforcement action…',
      'Education / warning provided',
      'Notice issued',
      'Ticket / penalty notice issued',
      'City service / repair referral',
      'Referred to another department',
      'Public safety response',
      'No violation found',
      'No action taken',
      'Other',
    ])
    // Nothing is preselected — the officer must choose explicitly.
    expect(select.value).toBe('')
  })
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

  it('records a City service / repair referral for an infrastructure case without a false enforcement outcome', async () => {
    // A fallen City stop sign: Violation observed "No", enforcement action
    // "City service / repair referral", follow-up required. No ticket details
    // apply, and the officer selects the action explicitly — nothing defaults.
    vi.mocked(recordResidentFieldOutcome).mockResolvedValue(
      makeCompleteOutcomeRow({
        field_violation_observed: 'no',
        field_enforcement_action: 'city_service_referral',
        field_follow_up_required: true,
      }),
    )

    renderPage('RSR-20260709-7BX8')
    await screen.findByText('Record field outcome')

    fireEvent.change(screen.getByPlaceholderText('Describe what you observed on site…'), {
      target: { value: 'Stop sign at the corner has fallen and is lying on the boulevard.' },
    })
    fireEvent.change(screen.getByLabelText('Violation observed'), { target: { value: 'no' } })
    fireEvent.change(screen.getByLabelText('Enforcement action'), {
      target: { value: 'city_service_referral' },
    })
    fireEvent.change(
      screen.getByPlaceholderText(
        'Describe the action taken, notice issued, warning provided, or reason no action was required…',
      ),
      { target: { value: 'Submitted a repair referral for the fallen stop sign.' } },
    )
    fireEvent.click(screen.getByLabelText('Follow-up required'))
    fireEvent.click(screen.getByRole('button', { name: 'Field outcome complete' }))

    expect(await screen.findByText('Field outcome recorded')).toBeInTheDocument()
    expect(recordResidentFieldOutcome).toHaveBeenCalledWith(
      'RSR-20260709-7BX8',
      expect.objectContaining({
        violationObserved: 'no',
        enforcementAction: 'city_service_referral',
        followUpRequired: true,
        serviceMethod: undefined,
        referenceNumber: undefined,
      }),
    )
  })
})
