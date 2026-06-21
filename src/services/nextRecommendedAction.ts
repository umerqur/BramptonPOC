import type { DemoCase } from '../data/demoWorkflowTypes'
import { fieldOutcomeNeedsStructuredAction } from './demoWorkflowService'

// "Next recommended action" — the Case Workbench's primary decision-support
// feature. It tells staff the single next best action and explains why, while
// keeping the human in control.
//
// This is DETERMINISTIC, stage-aware, auditable rules — no LLM, no enforcement
// decision, no email generation. It only recommends; staff confirm, decide, and
// can override. The order of the checks below IS the priority: the first match
// wins, so the recommendation always reflects where the case actually is in the
// officer-first lifecycle (assign → field outcome → closure review).

export type NextActionKind =
  | 'closed'
  | 'request_info'
  | 'assign_officer'
  | 'wait_for_outcome'
  | 'complete_structured_action'
  | 'follow_up'
  | 'prepare_closure'
  | 'review_closure'

export type NextRecommendedAction = {
  kind: NextActionKind
  /** Short imperative action label. */
  label: string
  /** Plain-language explanation of why this is the next step. */
  why: string
  /** Constant human-in-the-loop reminder. */
  staffNote: string
}

const STAFF_NOTE = 'Decision support only. Staff confirm and decide.'

/**
 * The deterministic next-best-action for a case. Pure function of the case
 * state — safe to call on every render and to show in the audit trail.
 */
export function getNextRecommendedAction(c: DemoCase): NextRecommendedAction {
  // 1. Closed and locked — nothing further to do.
  if (c.stage === 'closed') {
    return {
      kind: 'closed',
      label: 'No action required',
      why: 'This case has already been closed and locked.',
      staffNote: STAFF_NOTE,
    }
  }

  // 2. Not enough intake detail to assign or close confidently (pre-assignment).
  if (
    !c.assignedOfficer &&
    !c.fieldAction &&
    (c.triage.missingInformation.length > 0 || c.triage.confidenceLevel === 'Low')
  ) {
    return {
      kind: 'request_info',
      label: 'Request more information',
      why: 'The complaint does not have enough detail for staff to assign or close confidently.',
      staffNote: STAFF_NOTE,
    }
  }

  // 3. No officer assigned yet — a field outcome is required before closure.
  if (!c.assignedOfficer) {
    return {
      kind: 'assign_officer',
      label: 'Assign this case to a By-law Officer',
      why: 'A field outcome is required before closure can be prepared. A supervisor should assign an officer.',
      staffNote: STAFF_NOTE,
    }
  }

  // 4. Assigned, but the officer has not recorded findings yet.
  if (!c.fieldAction) {
    return {
      kind: 'wait_for_outcome',
      label: 'Wait for the officer field outcome',
      why: `The assigned officer${c.assignedOfficer ? ` (${c.assignedOfficer})` : ''} must record findings before closure review.`,
      staffNote: STAFF_NOTE,
    }
  }

  // 5. Field visit completed but the structured enforcement action is missing.
  if (fieldOutcomeNeedsStructuredAction(c.fieldAction)) {
    return {
      kind: 'complete_structured_action',
      label: 'Complete the structured field outcome',
      why: 'A legacy or incomplete field outcome exists. Staff must select the recorded enforcement action before a resident closure draft is prepared.',
      staffNote: STAFF_NOTE,
    }
  }

  // 6. Field outcome recorded, but the officer flagged follow-up.
  if (c.fieldAction.followUpRequired) {
    return {
      kind: 'follow_up',
      label: 'Schedule follow-up or keep under review',
      why: 'The officer recorded that follow-up is required, so the case should not proceed directly to closure.',
      staffNote: STAFF_NOTE,
    }
  }

  // 8. A closure draft has already been prepared and is awaiting review/approval.
  if (c.draft && (c.stage === 'staff-review' || c.stage === 'approved')) {
    return {
      kind: 'review_closure',
      label: 'Review and approve the closure response',
      why: 'The draft has been prepared from approved templates and the structured case facts. A supervisor reviews and approves before anything is sent.',
      staffNote: STAFF_NOTE,
    }
  }

  // 7. Field outcome recorded, no follow-up — ready to prepare the closure draft.
  return {
    kind: 'prepare_closure',
    label: 'Prepare closure draft from officer outcome',
    why: 'A field outcome has been recorded and the file is ready for supervisor closure review.',
    staffNote: STAFF_NOTE,
  }
}
