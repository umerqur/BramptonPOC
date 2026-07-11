import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import StructuredFieldOutcomeRepairCard from './StructuredFieldOutcomeRepairCard'
import {
  StructuredFieldOutcomeUnavailableError,
  repairResidentStructuredFieldOutcome,
} from '../../services/residentRequests'
import { residentRowToCase } from '../../services/residentCaseBridge'
import { fieldOutcomeNeedsStructuredAction } from '../../services/demoWorkflowService'
import { makeCompleteOutcomeRow } from '../../test/fixtures'

vi.mock('../../services/residentRequests', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/residentRequests')>()
  return {
    ...actual,
    repairResidentStructuredFieldOutcome: vi.fn(),
  }
})

const CASE_ID = 'RSR-20260709-7BX8'

beforeEach(() => {
  vi.mocked(repairResidentStructuredFieldOutcome).mockReset()
})

describe('StructuredFieldOutcomeRepairCard', () => {
  it('allows staff to complete the missing structured action without repeating the visit', async () => {
    const repairedRow = makeCompleteOutcomeRow()
    vi.mocked(repairResidentStructuredFieldOutcome).mockResolvedValue(repairedRow)
    const onRepaired = vi.fn()

    render(<StructuredFieldOutcomeRepairCard caseId={CASE_ID} onRepaired={onRepaired} />)

    expect(screen.getByText('Structured field outcome incomplete')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Enforcement action'), {
      target: { value: 'warning_education' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Complete recorded action' }))

    await waitFor(() => expect(onRepaired).toHaveBeenCalledWith(repairedRow))
    expect(repairResidentStructuredFieldOutcome).toHaveBeenCalledWith(CASE_ID, {
      enforcementAction: 'warning_education',
      serviceMethod: undefined,
      referenceNumber: undefined,
      actionTaken: undefined,
    })

    // Re-ingesting the repaired row rebuilds the closure draft from the ACTUAL
    // recorded action — the case is now valid for supervisor closure review.
    const rebuilt = residentRowToCase(repairedRow)
    expect(fieldOutcomeNeedsStructuredAction(rebuilt.fieldAction)).toBe(false)
    expect(rebuilt.draft).not.toBeNull()
    expect(rebuilt.stage).toBe('staff-review')
  })

  it('requires a notice number before repairing with a ticket', async () => {
    render(<StructuredFieldOutcomeRepairCard caseId={CASE_ID} onRepaired={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Enforcement action'), {
      target: { value: 'ticket_issued' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Complete recorded action' }))

    expect(await screen.findByText(/enter the ticket \/ penalty notice number/i)).toBeInTheDocument()
    expect(repairResidentStructuredFieldOutcome).not.toHaveBeenCalled()
  })

  it('requires an enforcement action selection', async () => {
    render(<StructuredFieldOutcomeRepairCard caseId={CASE_ID} onRepaired={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Complete recorded action' }))

    expect(await screen.findByText(/select the enforcement action/i)).toBeInTheDocument()
    expect(repairResidentStructuredFieldOutcome).not.toHaveBeenCalled()
  })

  it('surfaces the typed migration-unavailable error', async () => {
    vi.mocked(repairResidentStructuredFieldOutcome).mockRejectedValue(
      new StructuredFieldOutcomeUnavailableError(),
    )
    const onRepaired = vi.fn()

    render(<StructuredFieldOutcomeRepairCard caseId={CASE_ID} onRepaired={onRepaired} />)

    fireEvent.change(screen.getByLabelText('Enforcement action'), {
      target: { value: 'no_action' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Complete recorded action' }))

    expect(
      await screen.findByText(/required database migration is missing/i),
    ).toBeInTheDocument()
    expect(onRepaired).not.toHaveBeenCalled()
  })
})
