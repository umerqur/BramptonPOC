import type { EnforcementAction, ServiceMethod } from '../../data/demoWorkflowTypes'
import { ENFORCEMENT_ACTION_LABELS, SERVICE_METHOD_LABELS } from '../../services/demoWorkflowService'

// Shared structured enforcement-action controls, used by every surface that
// captures the officer's structured disposition: the resident Supabase
// field-outcome form, the local NYC benchmark form, and the Case Workbench
// repair card for incomplete outcomes. Selecting "Ticket / penalty notice
// issued" (a general by-law ticket / penalty notice, valid for any violation
// type) reveals the notice number and method-of-service fields. This only
// records what the officer did — it is not a payment or ticket-issuance system.

// Display order for the structured field-outcome dropdowns.
export const ENFORCEMENT_ACTION_ORDER: EnforcementAction[] = [
  'warning_education',
  'notice_issued',
  'ticket_issued',
  'no_action',
  'other',
]
// "Served in person" leads — it applies across violation types; the placed-on-
// vehicle option is no longer the default first choice. Stored enum values stay.
export const SERVICE_METHOD_ORDER: ServiceMethod[] = [
  'handed_to_driver',
  'placed_on_vehicle',
  'sent_by_mail',
  'other',
]

const fieldClass =
  'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-navy-900 focus:border-accent-500 focus:outline-none disabled:bg-slate-50'

type StructuredEnforcementActionFieldsProps = {
  enforcementAction: EnforcementAction | ''
  onEnforcementActionChange: (value: EnforcementAction | '') => void
  serviceMethod: ServiceMethod
  onServiceMethodChange: (value: ServiceMethod) => void
  referenceNumber: string
  onReferenceNumberChange: (value: string) => void
  disabled?: boolean
}

export default function StructuredEnforcementActionFields({
  enforcementAction,
  onEnforcementActionChange,
  serviceMethod,
  onServiceMethodChange,
  referenceNumber,
  onReferenceNumberChange,
  disabled = false,
}: StructuredEnforcementActionFieldsProps) {
  return (
    <>
      <label className="block">
        <span className="stat-label">Enforcement action</span>
        <select
          value={enforcementAction}
          onChange={(e) => onEnforcementActionChange(e.target.value as EnforcementAction | '')}
          disabled={disabled}
          className={fieldClass}
        >
          <option value="">Select an enforcement action…</option>
          {ENFORCEMENT_ACTION_ORDER.map((a) => (
            <option key={a} value={a}>
              {ENFORCEMENT_ACTION_LABELS[a]}
            </option>
          ))}
        </select>
      </label>

      {enforcementAction === 'ticket_issued' && (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
          <label className="block">
            <span className="stat-label">Ticket / penalty notice number</span>
            <input
              value={referenceNumber}
              onChange={(e) => onReferenceNumberChange(e.target.value)}
              disabled={disabled}
              placeholder="e.g. PN-0001234"
              className={fieldClass}
            />
          </label>
          <label className="block">
            <span className="stat-label">Method of service</span>
            <select
              value={serviceMethod}
              onChange={(e) => onServiceMethodChange(e.target.value as ServiceMethod)}
              disabled={disabled}
              className={fieldClass}
            >
              {SERVICE_METHOD_ORDER.map((m) => (
                <option key={m} value={m}>
                  {SERVICE_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] text-ink-subtle">
            Records what the officer did on site. This does not issue a ticket or take a payment.
          </p>
        </div>
      )}
    </>
  )
}
