// Client-side state store for the end-to-end demo workflow.
//
// Holds the synthetic case list and the active case, and exposes the staff
// actions (approve routing, request more info, override priority, send to
// review, edit draft, approve closure). Every action appends to the case audit
// trail and, where relevant, records a StaffDecision — so the audit trail and
// "where workload is reduced" metrics stay coherent as you click through the
// demo. State is persisted to localStorage so a page refresh keeps the demo.
//
// State here is self-contained (synthetic cases + localStorage). The one action
// that reaches outside is closure approval: when a case carries a deliverable
// resident email, the closure page sends the staff-approved closure response to
// the resident through the server-side Netlify email function, and passes the
// delivery result into approveClosure so the audit trail records what happened.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  DemoCase,
  OfficerFieldAction,
  Priority,
  ResidentComplaintInput,
  SupervisorMetrics,
} from '../data/demoWorkflowTypes'
import {
  auditEvent,
  buildClosureDraft,
  buildSeedCases,
  computeSupervisorMetrics,
  deriveFieldVisitOutcome,
  FIELD_OUTCOME_LABELS,
  runWorkflow,
} from '../services/demoWorkflowService'
import { residentRowToCase } from '../services/residentCaseBridge'
import { openRowToCase } from '../services/openCaseBridge'
import type { ResidentRequestRow } from '../services/residentRequests'
import type { OpenReviewRow } from '../services/caseExplorer'
import {
  ROLE_ACTOR_NAME,
  allowedRolesForEmail,
  canUseRole,
  defaultRoleForEmail,
  type StaffProfile,
  type StaffRole,
} from './roles'

// Bumped to v3 when cases gained a `source` + normalized service-request shape
// (unified resident intake + NYC open benchmark lifecycle), so older persisted
// cases without those fields are reseeded rather than rendered half-populated.
const STORAGE_KEY = 'brampton-demo-workflow-v3'
const STAFF_NAME = 'M. Okafor (By-law Officer)'

/**
 * What an officer enters when recording a field investigation. This mirrors the
 * resident Supabase field-outcome form (Officer Oakley's structure), so the
 * local NYC benchmark path records the same fields and the outcome is DERIVED
 * from the recorded violation + action — not picked from a dropdown.
 */
export type FieldActionInput = {
  observedCondition: string
  violationObserved: 'yes' | 'no' | 'unclear'
  actionTaken: string
  officerNotes?: string
  followUpRequired: boolean
}

/**
 * An officer assignment target. Accepts a full StaffProfile (from
 * officerProfiles()) or any object carrying the officer's name + login email —
 * assignment is always tied to a specific officer email, never a fake name.
 */
export type OfficerAssignment = Pick<StaffProfile, 'name' | 'email'>

type WorkflowState = {
  cases: DemoCase[]
  activeCaseId: string | null
  /** Demo role the reviewer is currently acting as (RBAC for the workflow). */
  role: StaffRole
}

type WorkflowContextValue = {
  cases: DemoCase[]
  activeCase: DemoCase | null
  metrics: SupervisorMetrics
  staffName: string
  /** Current role (constrained to the signed-in user's staff profile) + setter. */
  role: StaffRole
  setRole: (role: StaffRole) => void
  /** Email of the signed-in user (drives staff identity + role separation). */
  userEmail: string | null
  /** The roles the signed-in user's staff profile allows them to act as. */
  allowedRoles: StaffRole[]
  /** Whether this user may switch roles (true only when >1 allowed role). */
  canSwitchRole: boolean
  submitComplaint: (input: ResidentComplaintInput) => string
  ingestResidentCase: (row: ResidentRequestRow) => string
  ingestOpenCase: (row: OpenReviewRow) => string
  setActiveCase: (id: string | null) => void
  approveRouting: (id: string) => void
  requestMoreInfo: (id: string, note?: string) => void
  overridePriority: (id: string, priority: Priority) => void
  assignToOfficer: (id: string, officer: OfficerAssignment) => void
  recordFieldAction: (id: string, input: FieldActionInput) => void
  sendToStaffReview: (id: string) => void
  editDraftBody: (id: string, body: string) => void
  approveClosure: (id: string, delivery?: ClosureDelivery) => void
  resetDemo: () => void
}

/**
 * Outcome of trying to email the resident the approved closure response.
 *   attempted=false → no deliverable resident email was on file (nothing sent).
 *   attempted=true, emailSent=true  → the closure email was accepted by the service.
 *   attempted=true, emailSent=false → send was attempted but failed (e.g. email
 *                                     not configured in this environment).
 */
export type ClosureDelivery = { attempted: boolean; emailSent: boolean }

/** Add N seconds to an ISO timestamp (keeps audit events strictly ordered). */
function addSecondsIso(iso: string, secs: number): string {
  return new Date(new Date(iso).getTime() + secs * 1000).toISOString()
}

const WorkflowContext = createContext<WorkflowContextValue | null>(null)

function loadState(): WorkflowState {
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<WorkflowState>
        if (Array.isArray(parsed.cases)) {
          return {
            cases: parsed.cases,
            activeCaseId: parsed.activeCaseId ?? parsed.cases[0]?.id ?? null,
            // Default older persisted state (no role) to supervisor.
            role: parsed.role ?? 'supervisor',
          }
        }
      }
    } catch {
      // fall through to seed
    }
  }
  const cases = buildSeedCases()
  return { cases, activeCaseId: cases[0]?.id ?? null, role: 'supervisor' }
}

export function WorkflowProvider({
  children,
  userEmail = null,
}: {
  children: ReactNode
  userEmail?: string | null
}) {
  const [state, setState] = useState<WorkflowState>(loadState)
  // Roles are constrained to the signed-in user's staff profile. Switching is
  // only offered when the profile allows more than one role. This is POC
  // staff-profile-based access control, not a free persona switcher.
  const allowedRoles = useMemo(() => allowedRolesForEmail(userEmail), [userEmail])
  const canSwitchRole = allowedRoles.length > 1

  // Keep the active role inside the profile's allowed set. If the persisted role
  // is not allowed for this email (e.g. a stale 'officer' from a previous
  // session, or a supervisor whose profile never allows officer), snap back to
  // the profile's default role. This is what prevents a supervisor account from
  // acting as Officer Oakley.
  useEffect(() => {
    setState((s) =>
      allowedRoles.includes(s.role) ? s : { ...s, role: defaultRoleForEmail(userEmail) },
    )
  }, [userEmail, allowedRoles])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // ignore quota / private-mode errors — demo still works in memory
    }
  }, [state])

  /** Apply a transform to a single case by id. */
  const updateCase = useCallback((id: string, fn: (c: DemoCase) => DemoCase) => {
    setState((s) => ({ ...s, cases: s.cases.map((c) => (c.id === id ? fn(c) : c)) }))
  }, [])

  const submitComplaint = useCallback((input: ResidentComplaintInput): string => {
    const next = runWorkflow(input)
    setState((s) => ({ ...s, cases: [next, ...s.cases], activeCaseId: next.id }))
    return next.id
  }, [])

  const setRole = useCallback(
    (role: StaffRole) => {
      // Refuse any role the signed-in user's staff profile does not allow. A
      // supervisor/CSR account can never select By-law Officer this way.
      if (!canUseRole(userEmail, role)) return
      setState((s) => ({ ...s, role }))
    },
    [userEmail],
  )

  // Bridge a resident Supabase submission into the workbench. Reuses the case if
  // it has already been opened (so staff actions are preserved), otherwise
  // converts the row into a workbench case with generated AI triage. Synthetic
  // seed cases are never touched.
  const ingestResidentCase = useCallback((row: ResidentRequestRow): string => {
    setState((s) => {
      const existing = s.cases.find((c) => c.id === row.case_id)
      if (existing) {
        // Refresh a previously-opened case when the officer has since recorded —
        // or RE-recorded — a field outcome, so closure review reflects the latest
        // Supabase truth and never keeps a stale localStorage fieldAction. We
        // refresh when there is a recorded outcome but no cached fieldAction, OR
        // when the Supabase recorded-at differs from the cached fieldAction's
        // recordedAt (a newer / changed outcome). Closed cases are never re-derived.
        const rowRecordedAt = row.field_outcome_recorded_at
        const staleFieldOutcome =
          row.field_visit_completed &&
          existing.stage !== 'closed' &&
          (!existing.fieldAction ||
            (rowRecordedAt != null && rowRecordedAt !== existing.fieldAction.recordedAt))
        if (!staleFieldOutcome) return { ...s, activeCaseId: row.case_id }
        const refreshed = residentRowToCase(row)
        return {
          ...s,
          cases: s.cases.map((c) => (c.id === row.case_id ? refreshed : c)),
          activeCaseId: row.case_id,
        }
      }
      const next = residentRowToCase(row)
      return { ...s, cases: [next, ...s.cases], activeCaseId: row.case_id }
    })
    return row.case_id
  }, [])

  // Bridge an NYC open benchmark case into the workbench. Reuses the case if it
  // has already been opened (so staff actions / closure decisions are preserved),
  // otherwise converts the public 311 source record into a workbench case. The
  // verbatim NYC record is carried on the case; nothing is written back to NYC.
  const ingestOpenCase = useCallback((row: OpenReviewRow): string => {
    setState((s) => {
      const existing = s.cases.find((c) => c.id === row.case_id)
      if (existing) return { ...s, activeCaseId: row.case_id }
      const next = openRowToCase(row)
      return { ...s, cases: [next, ...s.cases], activeCaseId: row.case_id }
    })
    return row.case_id
  }, [])

  const setActiveCase = useCallback((id: string | null) => {
    setState((s) => ({ ...s, activeCaseId: id }))
  }, [])

  const approveRouting = useCallback(
    (id: string) => {
      const now = new Date().toISOString()
      updateCase(id, (c) => {
        if (c.stage === 'closed') return c
        return {
        ...c,
        decisions: [...c.decisions, { action: 'Approved AI routing', by: STAFF_NAME, at: now }],
        audit: [...c.audit, auditEvent('staff', 'Routing approved', `Staff confirmed the ${c.triage.category} classification and routing to ${c.triage.recommendedDepartment}.`, now)],
        }
      })
    },
    [updateCase],
  )

  const requestMoreInfo = useCallback(
    (id: string, note?: string) => {
      const now = new Date().toISOString()
      updateCase(id, (c) => {
        if (c.stage === 'closed') return c
        return {
        ...c,
        stage: 'needs-staff-attention',
        decisions: [...c.decisions, { action: 'Requested more information', by: STAFF_NAME, at: now, note }],
        audit: [...c.audit, auditEvent('staff', 'More information requested', note || 'Staff requested additional details from the resident before closure.', now)],
        }
      })
    },
    [updateCase],
  )

  const overridePriority = useCallback(
    (id: string, priority: Priority) => {
      const now = new Date().toISOString()
      updateCase(id, (c) => {
        if (c.stage === 'closed') return c
        return {
        ...c,
        priorityOverride: priority,
        decisions: [...c.decisions, { action: `Overrode priority to ${priority}`, by: STAFF_NAME, at: now }],
        audit: [...c.audit, auditEvent('staff', 'Priority overridden', `Staff changed priority from ${c.triage.recommendedPriority} to ${priority}.`, now)],
        }
      })
    },
    [updateCase],
  )

  // Supervisor / CSR assigns the case to a specific officer for a field visit.
  // Assignment is tied to the officer's login email (assignedOfficerEmail) — the
  // Officer Field Console filters on that email — not just a display name.
  const assignToOfficer = useCallback(
    (id: string, officer: OfficerAssignment) => {
      const now = new Date().toISOString()
      const officerName = officer.name
      const officerEmail = officer.email.trim().toLowerCase()
      updateCase(id, (c) => {
        if (c.stage === 'closed') return c
        return {
        ...c,
        stage: 'assigned',
        assignedOfficer: officerName,
        assignedOfficerEmail: officerEmail,
        decisions: [...c.decisions, { action: `Assigned to ${officerName}`, by: STAFF_NAME, at: now }],
        audit: [
          ...c.audit,
          auditEvent('staff', 'Assigned to officer', `Case assigned to ${officerName} for a field investigation.`, now),
        ],
        }
      })
    },
    [updateCase],
  )

  // Officer records what actually happened on the field visit. The closure draft
  // is rebuilt from that outcome so the resident letter only states real actions.
  const recordFieldAction = useCallback(
    (id: string, input: FieldActionInput) => {
      const now = new Date().toISOString()
      updateCase(id, (c) => {
        if (c.stage === 'closed') return c
        const officerName = c.assignedOfficer ?? ROLE_ACTOR_NAME.officer
        const observedCondition = input.observedCondition.trim()
        const actionTaken = input.actionTaken.trim()
        const officerNotes = input.officerNotes?.trim() ?? ''
        // Derive the disposition from the recorded violation + action using the
        // SAME shared rules as the resident Supabase path — a "yes" violation
        // never implies a ticket.
        const outcome = deriveFieldVisitOutcome(input.violationObserved, actionTaken)
        const fieldAction: OfficerFieldAction = {
          officerName,
          visitedAt: now,
          outcome,
          observations: [observedCondition, officerNotes].filter(Boolean).join(' — '),
          referenceNumber: null,
          followUpRequired: input.followUpRequired,
          recordedAt: now,
          // Carry the verbatim recorded fields so the closure draft reflects the
          // real action taken, not an assumed disposition.
          violationObserved: input.violationObserved,
          actionTaken: actionTaken || null,
          observedCondition: observedCondition || null,
          officerNotes: officerNotes || null,
        }
        // Regenerate the closure draft grounded in the recorded outcome.
        const draft = buildClosureDraft(c.input, c.triage, c.context, now, fieldAction)
        return {
          ...c,
          stage: 'field-visit',
          fieldAction,
          draft,
          decisions: [...c.decisions, { action: `Recorded field outcome: ${FIELD_OUTCOME_LABELS[outcome]}`, by: officerName, at: now }],
          audit: [
            ...c.audit,
            auditEvent('officer', 'Field visit recorded', `${officerName} attended the location and recorded the outcome: ${FIELD_OUTCOME_LABELS[outcome]}.`, now),
            auditEvent('ai', 'Closure draft updated', 'Closure response regenerated to reflect the recorded field outcome.', addSecondsIso(now, 1)),
          ],
        }
      })
    },
    [updateCase],
  )

  const sendToStaffReview = useCallback(
    (id: string) => {
      const now = new Date().toISOString()
      updateCase(id, (c) => {
        if (c.stage === 'closed') return c
        // Build (or rebuild) the draft from whatever field outcome is on file —
        // null means the letter stays review-only and claims no site visit.
        const draft = c.draft ?? buildClosureDraft(c.input, c.triage, c.context, now, c.fieldAction)
        const audit = [...c.audit]
        if (!c.draft) audit.push(auditEvent('ai', 'Closure draft prepared', 'Staff sent the case to review — a closure-response draft was prepared.', now))
        audit.push(auditEvent('staff', 'Sent to staff review', 'Case moved into the closure-draft review queue.', now))
        return {
          ...c,
          stage: 'staff-review',
          draft,
          decisions: [...c.decisions, { action: 'Sent to staff review', by: STAFF_NAME, at: now }],
          audit,
        }
      })
    },
    [updateCase],
  )

  const editDraftBody = useCallback(
    (id: string, body: string) => {
      updateCase(id, (c) => (c.stage !== 'closed' && c.draft ? { ...c, draft: { ...c.draft, body } } : c))
    },
    [updateCase],
  )

  const approveClosure = useCallback(
    (id: string, delivery?: ClosureDelivery) => {
      const now = new Date().toISOString()
      updateCase(id, (c) => {
        if (!c.draft) return c
        // Already closed — do not re-approve or append a second closure record.
        if (c.stage === 'closed') return c
        // Record the real outcome of the resident email send (driven by the
        // closure page) so the audit trail never claims an email was delivered
        // when it was not.
        const residentAudit = !delivery?.attempted
          ? auditEvent(
              'system',
              'Resident update recorded',
              'Closure approved. No deliverable resident email was on file, so no email was sent.',
              now,
            )
          : delivery.emailSent
            ? auditEvent(
                'system',
                'Resident emailed',
                'The approved closure response was emailed to the resident.',
                now,
              )
            : auditEvent(
                'system',
                'Resident email not sent',
                'Closure approved, but the closure email could not be sent (email service unavailable in this environment).',
                now,
              )
        return {
          ...c,
          stage: 'closed',
          closureMessage: c.draft.body,
          approvedBy: STAFF_NAME,
          approvedAt: now,
          decisions: [...c.decisions, { action: 'Approved closure response', by: STAFF_NAME, at: now }],
          audit: [
            ...c.audit,
            auditEvent('staff', 'Closure approved', `Final closure response approved by ${STAFF_NAME}.`, now),
            residentAudit,
            auditEvent('system', 'Case closed', 'Case status changed to Closed and logged in the audit trail.', now),
          ],
        }
      })
    },
    [updateCase],
  )

  const resetDemo = useCallback(() => {
    const cases = buildSeedCases()
    setState((s) => ({ ...s, cases, activeCaseId: cases[0]?.id ?? null }))
  }, [])

  const activeCase = useMemo(
    () => state.cases.find((c) => c.id === state.activeCaseId) ?? null,
    [state.cases, state.activeCaseId],
  )

  const metrics = useMemo(() => computeSupervisorMetrics(state.cases), [state.cases])

  const value: WorkflowContextValue = {
    cases: state.cases,
    activeCase,
    metrics,
    staffName: STAFF_NAME,
    role: state.role,
    setRole,
    userEmail,
    allowedRoles,
    canSwitchRole,
    submitComplaint,
    ingestResidentCase,
    ingestOpenCase,
    setActiveCase,
    approveRouting,
    requestMoreInfo,
    overridePriority,
    assignToOfficer,
    recordFieldAction,
    sendToStaffReview,
    editDraftBody,
    approveClosure,
    resetDemo,
  }

  return <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>
}

export function useWorkflow(): WorkflowContextValue {
  const ctx = useContext(WorkflowContext)
  if (!ctx) throw new Error('useWorkflow must be used within a WorkflowProvider')
  return ctx
}
