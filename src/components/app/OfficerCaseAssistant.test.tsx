import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import OfficerCaseAssistant, { type AssistantCaseContext } from './OfficerCaseAssistant'
import {
  askOfficerCaseAssistant,
  AssistantRateLimitError,
  AssistantServiceError,
  type AssistantResponse,
} from '../../services/officerCaseAssistant'

vi.mock('../../services/officerCaseAssistant', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/officerCaseAssistant')>()
  return { ...actual, askOfficerCaseAssistant: vi.fn() }
})

const CTX: AssistantCaseContext = {
  caseId: 'RSR-20260709-7BX8',
  category: 'Parking',
  complaintType: 'Parking issue',
  location: '123 Main St, Brampton',
  description: 'A car has been parked across my driveway for two days.',
  assignedOfficer: 'Officer Oakley',
}

function makeResponse(overrides: Partial<AssistantResponse> = {}): AssistantResponse {
  return {
    provider: 'groq',
    model: 'test-model',
    prompt_version: 'officer-case-assistant-v2',
    mode: 'briefing',
    poc_only: false,
    benchmarks_used: 0,
    benchmarks: [],
    location_history: null,
    form_readiness: null,
    expected_next_step: 'Complete the site visit and record the field outcome.',
    result: {
      answer: 'Grounded answer.',
      used_context: [],
      officer_checklist: [],
      missing_information: [],
      benchmark_notes: [],
      field_drafts: null,
      briefing: {
        attending: 'Attending a parking concern at 123 Main St.',
        verify: [],
        evidence: [],
        information_gaps: [],
        expected_next_step: 'Complete the site visit and record the field outcome.',
      },
      handoff: null,
      limitations: 'Decision support only. Staff remain responsible for enforcement decisions.',
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(askOfficerCaseAssistant).mockReset()
})

describe('OfficerCaseAssistant error handling', () => {
  it('keeps manual questions available when the automatic briefing fails', async () => {
    // Briefing fails with a temporary provider error; the follow-up manual
    // question succeeds.
    vi.mocked(askOfficerCaseAssistant)
      .mockRejectedValueOnce(new AssistantServiceError('Assistant service error. Please try again.'))
      .mockResolvedValueOnce(makeResponse({ mode: 'question' }))

    render(<OfficerCaseAssistant ctx={CTX} />)

    expect(
      await screen.findByText(/automatic field briefing is unavailable right now/i),
    ).toBeInTheDocument()

    // Ask input, quick actions, and the handoff button all stay enabled.
    const input = screen.getByPlaceholderText('Ask the AI about this case, risk factors, history, or next steps…')
    expect(input).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Prepare site checklist' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Supervisor handoff' })).toBeEnabled()

    // And asking actually works.
    fireEvent.change(input, { target: { value: 'What should I verify?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
    expect(await screen.findByText('Grounded answer.')).toBeInTheDocument()
  })

  it('shows a provider failure as a temporary service message, exactly once', async () => {
    vi.mocked(askOfficerCaseAssistant).mockRejectedValue(
      new AssistantServiceError('Assistant service error. Please try again.'),
    )

    render(<OfficerCaseAssistant ctx={CTX} />)

    expect(
      await screen.findByText('The assistant service is temporarily unavailable. Please try again.'),
    ).toBeInTheDocument()
    // ONE consolidated error surface — never the same failure twice.
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    // Never presented as a usage limit.
    expect(screen.queryByText(/limit reached/i)).not.toBeInTheDocument()
  })

  it('shows the hourly-limit message exactly once', async () => {
    vi.mocked(askOfficerCaseAssistant).mockRejectedValue(
      new AssistantRateLimitError('Assistant request limit reached.', 'ASSISTANT_HOURLY_LIMIT', 900),
    )

    render(<OfficerCaseAssistant ctx={CTX} />)

    expect(await screen.findByText('Assistant request limit reached.')).toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getAllByText('Assistant request limit reached.')).toHaveLength(1)
  })

  it('shows a temporary cooldown message and re-enables asking after retryAfterSeconds', async () => {
    vi.mocked(askOfficerCaseAssistant)
      .mockResolvedValueOnce(makeResponse()) // automatic briefing succeeds
      .mockRejectedValueOnce(
        new AssistantRateLimitError('Please wait a moment before sending another request.', 'ASSISTANT_COOLDOWN', 1),
      )

    render(<OfficerCaseAssistant ctx={CTX} />)
    expect(await screen.findByText(/attending a parking concern/i)).toBeInTheDocument()

    const input = screen.getByPlaceholderText('Ask the AI about this case, risk factors, history, or next steps…')
    fireEvent.change(input, { target: { value: 'What should I verify?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))

    // A small status message — not a red alert — and the controls pause.
    expect(await screen.findByText(/wait a moment before sending another request/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'Second question' } })
    expect(screen.getByRole('button', { name: 'Ask AI' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Prepare site checklist' })).toBeDisabled()

    // After retryAfterSeconds (1s) everything re-enables automatically.
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Ask AI' })).toBeEnabled(),
      { timeout: 3000 },
    )
    expect(screen.getByRole('button', { name: 'Prepare site checklist' })).toBeEnabled()
    expect(screen.queryByText(/wait a moment before sending another request/i)).not.toBeInTheDocument()
  })
})
