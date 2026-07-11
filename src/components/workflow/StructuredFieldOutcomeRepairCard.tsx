import { useState } from 'react'
import type { EnforcementAction, ServiceMethod } from '../../data/demoWorkflowTypes'
import {
  isStructuredFieldOutcomeUnavailableError,
  repairResidentStructuredFieldOutcome,
  type ResidentRequestRow,
} from '../../services/residentRequests'
import StructuredEnforcementActionFields from './StructuredEnforcementActionFields'

// Repair card for the invalid partial state where a resident request has
// field_visit_completed === true but field_enforcement_action === null (a
// legacy row, or a row left partial by the old base-only save fallback). Staff
// complete the RECORDED structured action here — the officer does not repeat
// the visit, and the action is never inferred from free-text notes. On success
// the caller re-ingests the repaired row so the closure draft is rebuilt from
// the actual enforcement action, with no page reload.

const fieldClass =
  'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-navy-900 focus:border-accent-500 focus:outline-none disabled:bg-slate-50'

export default function StructuredFieldOutcomeRepairCard({
  caseId,
  onRepaired,
}: {
  caseId: string
  onRepaired: (row: ResidentRequestRow) => void
}) {
  const [enforcementAction, setEnforcementAction] = useState<EnforcementAction | ''>('')
  // Same default as the officer form: "Served in person" is the most generally
  // applicable method (stored enum value stays handed_to_driver).
  const [serviceMethod, setServiceMethod] = useState<ServiceMethod>('handed_to_driver')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [actionTaken, setActionTaken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!enforcementAction) {
      setError('Select the enforcement action the officer actually took.')
      return
    }
    const isTicket = enforcementAction === 'ticket_issued'
    if (isTicket && !referenceNumber.trim()) {
      setError('Enter the ticket / penalty notice number before completing the recorded action.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const repaired = await repairResidentStructuredFieldOutcome(caseId, {
        enforcementAction,
        serviceMethod: isTicket ? serviceMethod : undefined,
        referenceNumber: isTicket ? referenceNumber : undefined,
        actionTaken: actionTaken.trim() || undefined,
      })
      onRepaired(repaired)
    } catch (err) {
      console.error('Failed to complete the structured field outcome:', err)
      if (isStructuredFieldOutcomeUnavailableError(err)) {
        setError(
          'The structured enforcement action could not be saved because the required database migration is missing. Contact an administrator before continuing.',
        )
        return
      }
      setError(
        err instanceof Error ? err.message : 'Could not save the structured enforcement action. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-4 card border-amber-300 bg-amber-50/50 p-5 ring-1 ring-amber-200">
      <span className="badge bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-300">
        Structured field outcome incomplete
      </span>
      <h2 className="mt-2 text-base font-semibold text-navy-900">Complete the recorded enforcement action</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted">
        The field visit was recorded, but the enforcement action was not saved. Complete the recorded action before
        preparing the closure response. Select what the officer actually did — it is never inferred from notes.
      </p>

      <div className="mt-4 max-w-xl space-y-4">
        <StructuredEnforcementActionFields
          enforcementAction={enforcementAction}
          onEnforcementActionChange={setEnforcementAction}
          serviceMethod={serviceMethod}
          onServiceMethodChange={setServiceMethod}
          referenceNumber={referenceNumber}
          onReferenceNumberChange={setReferenceNumber}
          disabled={busy}
        />

        <label className="block">
          <span className="stat-label">Action taken / resolution details</span>
          <textarea
            value={actionTaken}
            onChange={(e) => setActionTaken(e.target.value)}
            rows={2}
            disabled={busy}
            placeholder="Optional — updates the recorded action-taken notes…"
            className={fieldClass}
          />
        </label>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        )}

        <button onClick={submit} disabled={busy} className="btn-primary text-sm disabled:opacity-60">
          {busy ? 'Saving…' : 'Complete recorded action'}
        </button>
        <p className="text-[11px] text-ink-subtle">
          Saving rebuilds the closure draft from the recorded action and moves the case into supervisor closure review
          readiness. The officer does not repeat the visit.
        </p>
      </div>
    </section>
  )
}
