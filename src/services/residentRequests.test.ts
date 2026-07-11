import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  StructuredFieldOutcomeUnavailableError,
  isStructuredFieldOutcomeUnavailableError,
  recordResidentFieldOutcome,
  repairResidentStructuredFieldOutcome,
  type FieldOutcomeInput,
} from './residentRequests'
import { makeCompleteOutcomeRow, makeIncompleteOutcomeRow } from '../test/fixtures'

// Recorded update attempt against the mocked Supabase client.
type UpdateCall = {
  payload: Record<string, unknown>
  filters: Array<[method: string, column: string, value: unknown]>
  columns: string
}

const h = vi.hoisted(() => {
  const state: {
    updateCalls: Array<{
      payload: Record<string, unknown>
      filters: Array<[string, string, unknown]>
      columns: string
    }>
    // Response queue for .single(); the last entry repeats once drained, so a
    // single enqueued error is returned for every column-tier retry.
    responses: Array<{ data: unknown; error: unknown }>
  } = { updateCalls: [], responses: [] }

  function makeBuilder() {
    const call: (typeof state.updateCalls)[number] = { payload: {}, filters: [], columns: '' }
    const builder = {
      update(payload: Record<string, unknown>) {
        call.payload = payload
        return builder
      },
      eq(column: string, value: unknown) {
        call.filters.push(['eq', column, value])
        return builder
      },
      is(column: string, value: unknown) {
        call.filters.push(['is', column, value])
        return builder
      },
      select(columns: string) {
        call.columns = columns
        return builder
      },
      single() {
        state.updateCalls.push(call)
        const response = state.responses.length > 1 ? state.responses.shift() : state.responses[0]
        return Promise.resolve(response ?? { data: null, error: { code: 'NO_RESPONSE_QUEUED' } })
      },
    }
    return builder
  }

  const addWorkflowEvent = vi.fn(async () => {})

  return { state, makeBuilder, addWorkflowEvent }
})

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from: () => h.makeBuilder() },
}))

vi.mock('./municipalServiceRequests', () => ({
  addWorkflowEvent: h.addWorkflowEvent,
}))

const OUTCOME: FieldOutcomeInput = {
  observedCondition: 'Vehicle parked across the driveway.',
  violationObserved: 'yes',
  enforcementAction: 'warning_education',
  actionTaken: 'Issued a verbal warning.',
  officerNotes: 'Owner moved the vehicle.',
  followUpRequired: false,
}

const MISSING_COLUMN_ERROR = {
  code: 'PGRST204',
  message: "Could not find the 'field_enforcement_action' column of 'resident_service_requests' in the schema cache",
}

beforeEach(() => {
  h.state.updateCalls.length = 0
  h.state.responses.length = 0
  h.addWorkflowEvent.mockClear()
})

describe('recordResidentFieldOutcome', () => {
  it('throws when structured enforcement columns are unavailable', async () => {
    // Supabase reports the missing columns as PGRST204 for every column tier.
    h.state.responses.push({ data: null, error: MISSING_COLUMN_ERROR })

    await expect(recordResidentFieldOutcome('RSR-20260709-7BX8', OUTCOME)).rejects.toBeInstanceOf(
      StructuredFieldOutcomeUnavailableError,
    )

    // Every attempted update must carry the FULL structured payload — no
    // base-only fallback write may ever run.
    expect(h.state.updateCalls.length).toBeGreaterThan(0)
    for (const call of h.state.updateCalls as UpdateCall[]) {
      expect(call.payload).toHaveProperty('field_enforcement_action', 'warning_education')
      expect(call.payload).toHaveProperty('field_visit_completed', true)
      expect(call.columns).toContain('field_enforcement_action')
    }
    expect(h.addWorkflowEvent).not.toHaveBeenCalled()
  })

  it('throws on a raw Postgres 42703 undefined-column error the same way', async () => {
    h.state.responses.push({ data: null, error: { code: '42703', message: 'column does not exist' } })

    const error = await recordResidentFieldOutcome('RSR-20260709-7BX8', OUTCOME).catch((e: unknown) => e)
    expect(isStructuredFieldOutcomeUnavailableError(error)).toBe(true)
    expect(h.addWorkflowEvent).not.toHaveBeenCalled()
  })

  it('rejects a returned row without field_enforcement_action', async () => {
    // The update reports success but the returned row's structured action is
    // still null — the outcome must NOT be treated as recorded.
    h.state.responses.push({ data: makeIncompleteOutcomeRow(), error: null })

    await expect(recordResidentFieldOutcome('RSR-20260709-7BX8', OUTCOME)).rejects.toThrow(
      /enforcement action was not saved/i,
    )
    expect(h.addWorkflowEvent).not.toHaveBeenCalled()
  })

  it('rejects a returned row whose field visit is not marked complete', async () => {
    h.state.responses.push({
      data: makeCompleteOutcomeRow({ field_visit_completed: false }),
      error: null,
    })

    await expect(recordResidentFieldOutcome('RSR-20260709-7BX8', OUTCOME)).rejects.toThrow(
      /field visit was not marked complete/i,
    )
    expect(h.addWorkflowEvent).not.toHaveBeenCalled()
  })

  it('resolves and records a workflow event when the database confirms the structured action', async () => {
    h.state.responses.push({ data: makeCompleteOutcomeRow(), error: null })

    const updated = await recordResidentFieldOutcome('RSR-20260709-7BX8', OUTCOME)

    expect(updated.field_visit_completed).toBe(true)
    expect(updated.field_enforcement_action).toBe('warning_education')
    expect(updated.status).toBe('in_review')
    expect(h.addWorkflowEvent).toHaveBeenCalledTimes(1)
    expect(h.addWorkflowEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'resident_request_field_outcome' }),
    )
  })
})

describe('repairResidentStructuredFieldOutcome', () => {
  it('completes the structured action only on rows in the repairable partial state', async () => {
    h.state.responses.push({ data: makeCompleteOutcomeRow(), error: null })

    const repaired = await repairResidentStructuredFieldOutcome('RSR-20260709-7BX8', {
      enforcementAction: 'warning_education',
    })

    expect(repaired.field_enforcement_action).toBe('warning_education')

    const call = h.state.updateCalls[0] as UpdateCall
    // Server-side guard: only a completed visit whose structured action is
    // still null may be repaired — a complete outcome is never overwritten.
    expect(call.filters).toContainEqual(['eq', 'case_id', 'RSR-20260709-7BX8'])
    expect(call.filters).toContainEqual(['eq', 'field_visit_completed', true])
    expect(call.filters).toContainEqual(['is', 'field_enforcement_action', null])
    // No actionTaken given — the recorded action-taken text must not be touched.
    expect(call.payload).not.toHaveProperty('field_action_taken')
    expect(call.payload).toHaveProperty('field_enforcement_action', 'warning_education')

    expect(h.addWorkflowEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'resident_request_field_outcome_repaired' }),
    )
  })

  it('only records ticket details for a ticket_issued repair', async () => {
    h.state.responses.push({
      data: makeCompleteOutcomeRow({
        field_enforcement_action: 'ticket_issued',
        field_service_method: 'handed_to_driver',
        field_reference_number: 'PN-0001234',
      }),
      error: null,
    })

    await repairResidentStructuredFieldOutcome('RSR-20260709-7BX8', {
      enforcementAction: 'ticket_issued',
      serviceMethod: 'handed_to_driver',
      referenceNumber: 'PN-0001234',
      actionTaken: 'Ticket issued to the registered owner.',
    })

    const call = h.state.updateCalls[0] as UpdateCall
    expect(call.payload).toMatchObject({
      field_enforcement_action: 'ticket_issued',
      field_service_method: 'handed_to_driver',
      field_reference_number: 'PN-0001234',
      field_action_taken: 'Ticket issued to the registered owner.',
    })
  })

  it('throws the typed error when structured enforcement columns are unavailable', async () => {
    h.state.responses.push({ data: null, error: MISSING_COLUMN_ERROR })

    await expect(
      repairResidentStructuredFieldOutcome('RSR-20260709-7BX8', { enforcementAction: 'no_action' }),
    ).rejects.toBeInstanceOf(StructuredFieldOutcomeUnavailableError)
    expect(h.addWorkflowEvent).not.toHaveBeenCalled()
  })

  it('explains when no row is in the repairable partial state', async () => {
    h.state.responses.push({ data: null, error: { code: 'PGRST116', message: '0 rows' } })

    await expect(
      repairResidentStructuredFieldOutcome('RSR-20260709-7BX8', { enforcementAction: 'no_action' }),
    ).rejects.toThrow(/no incomplete structured field outcome/i)
  })
})
