// Deterministic field-outcome readiness validation.
//
// This is the SINGLE source of truth for whether the officer's field-outcome
// form is complete enough for supervisor closure review. It is plain
// TypeScript — no language model is involved. The Officer Case Assistant may
// EXPLAIN what is missing in natural language, but the readiness verdict and
// the per-field statuses always come from this module: it runs in the browser
// (form highlighting + submit validation) and inside the officer-case-assistant
// Netlify function (so the model receives the deterministic result as ground
// truth instead of judging readiness itself).
//
// Rules mirror the form's submit requirements exactly:
//   * Observed condition          — required free text.
//   * Violation observed          — must be an explicit selection; "Unclear" is
//                                   submittable but flagged for attention.
//   * Enforcement action          — required selection.
//   * Action taken                — required free text.
//   * Reference number            — required ONLY when a ticket / penalty
//                                   notice was issued; otherwise not applicable.
//   * Follow-up required          — a yes/no selection; always answered (the
//                                   checkbox is binary) and reported so the
//                                   officer consciously confirms it.

export type ReadinessStatus = 'complete' | 'missing' | 'attention'

export type ReadinessFieldKey =
  | 'observed_condition'
  | 'violation_observed'
  | 'enforcement_action'
  | 'action_taken'
  | 'reference_number'
  | 'follow_up_required'

export type ReadinessItem = {
  field: ReadinessFieldKey
  /** Human-readable form label (never a raw column name). */
  label: string
  status: ReadinessStatus
  /** Short deterministic explanation shown next to the status. */
  detail: string
}

export type FormReadiness = {
  /** True when nothing REQUIRED is missing ("attention" items do not block). */
  ready: boolean
  items: ReadinessItem[]
  /** Labels of the required fields that are still missing. */
  missingLabels: string[]
  /** Labels flagged for attention (submittable, but worth confirming). */
  attentionLabels: string[]
}

/** The draft shape the validator reads — a subset of OfficerFieldDraft using
 *  the same camelCase keys, so both the form and the server can call it. */
export type ReadinessDraftInput = {
  observedCondition?: string | null
  violationObserved?: string | null
  enforcementAction?: string | null
  referenceNumber?: string | null
  actionTaken?: string | null
  followUpRequired?: boolean | null
}

const has = (v: string | null | undefined): boolean => !!v && v.trim().length > 0

export function assessFieldOutcomeReadiness(draft: ReadinessDraftInput): FormReadiness {
  const items: ReadinessItem[] = []

  items.push(
    has(draft.observedCondition)
      ? {
          field: 'observed_condition',
          label: 'Observed condition',
          status: 'complete',
          detail: 'Recorded.',
        }
      : {
          field: 'observed_condition',
          label: 'Observed condition',
          status: 'missing',
          detail: 'Describe what you observed on site.',
        },
  )

  const violation = (draft.violationObserved ?? '').trim().toLowerCase()
  if (violation === 'yes' || violation === 'no') {
    items.push({
      field: 'violation_observed',
      label: 'Violation observed',
      status: 'complete',
      detail: violation === 'yes' ? 'Yes.' : 'No.',
    })
  } else if (violation === 'unclear') {
    items.push({
      field: 'violation_observed',
      label: 'Violation observed',
      status: 'attention',
      detail: 'Still marked "Unclear" — confirm on site if possible.',
    })
  } else {
    items.push({
      field: 'violation_observed',
      label: 'Violation observed',
      status: 'missing',
      detail: 'Select whether a violation was observed.',
    })
  }

  const isTicket = (draft.enforcementAction ?? '').trim() === 'ticket_issued'
  items.push(
    has(draft.enforcementAction)
      ? {
          field: 'enforcement_action',
          label: 'Enforcement action',
          status: 'complete',
          detail: 'Selected.',
        }
      : {
          field: 'enforcement_action',
          label: 'Enforcement action',
          status: 'missing',
          detail: 'Select the enforcement action you took.',
        },
  )

  items.push(
    has(draft.actionTaken)
      ? {
          field: 'action_taken',
          label: 'Action taken / resolution details',
          status: 'complete',
          detail: 'Recorded.',
        }
      : {
          field: 'action_taken',
          label: 'Action taken / resolution details',
          status: 'missing',
          detail: 'Describe the action taken or why no action was required.',
        },
  )

  if (isTicket) {
    items.push(
      has(draft.referenceNumber)
        ? {
            field: 'reference_number',
            label: 'Ticket / penalty notice number',
            status: 'complete',
            detail: 'Recorded.',
          }
        : {
            field: 'reference_number',
            label: 'Ticket / penalty notice number',
            status: 'missing',
            detail: 'A ticket / penalty notice was issued — enter its reference number.',
          },
    )
  } else {
    items.push({
      field: 'reference_number',
      label: 'Ticket / penalty notice number',
      status: 'complete',
      detail: 'Not required for the selected enforcement action.',
    })
  }

  // The follow-up checkbox is binary, so it always carries an answer; surface
  // the current answer so the officer consciously confirms it before submitting.
  items.push({
    field: 'follow_up_required',
    label: 'Follow-up required',
    status: 'complete',
    detail: draft.followUpRequired ? 'Yes — follow-up required.' : 'No follow-up recorded.',
  })

  const missingLabels = items.filter((i) => i.status === 'missing').map((i) => i.label)
  const attentionLabels = items.filter((i) => i.status === 'attention').map((i) => i.label)

  return {
    ready: missingLabels.length === 0,
    items,
    missingLabels,
    attentionLabels,
  }
}

/** Convenience: true when this field should be visually highlighted as missing. */
export function isFieldMissing(readiness: FormReadiness, field: ReadinessFieldKey): boolean {
  return readiness.items.some((i) => i.field === field && i.status === 'missing')
}
