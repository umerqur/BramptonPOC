// Client-side state store for the end-to-end demo workflow.
//
// Holds the synthetic case list and the active case, and exposes the staff
// actions (approve routing, request more info, override priority, send to
// review, edit draft, approve closure). Every action appends to the case audit
// trail and, where relevant, records a StaffDecision — so the audit trail and
// "where workload is reduced" metrics stay coherent as you click through the
// demo. State is persisted to localStorage so a page refresh keeps the demo.
//
// Nothing here touches Supabase or sends a real message — it is a self-contained
// demo of AI-assisted closure-response automation with a human approval gate.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  DemoCase,
  Priority,
  ResidentComplaintInput,
  SupervisorMetrics,
} from '../data/demoWorkflowTypes'
import {
  auditEvent,
  buildClosureDraft,
  buildSeedCases,
  computeSupervisorMetrics,
  runWorkflow,
} from '../services/demoWorkflowService'

const STORAGE_KEY = 'brampton-demo-workflow-v1'
const STAFF_NAME = 'M. Okafor (By-law Officer)'

type WorkflowState = {
  cases: DemoCase[]
  activeCaseId: string | null
}

type WorkflowContextValue = {
  cases: DemoCase[]
  activeCase: DemoCase | null
  metrics: SupervisorMetrics
  staffName: string
  submitComplaint: (input: ResidentComplaintInput) => string
  setActiveCase: (id: string | null) => void
  approveRouting: (id: string) => void
  requestMoreInfo: (id: string, note?: string) => void
  overridePriority: (id: string, priority: Priority) => void
  sendToStaffReview: (id: string) => void
  editDraftBody: (id: string, body: string) => void
  approveClosure: (id: string) => void
  resetDemo: () => void
}

const WorkflowContext = createContext<WorkflowContextValue | null>(null)

function loadState(): WorkflowState {
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as WorkflowState
        if (Array.isArray(parsed.cases)) return parsed
      }
    } catch {
      // fall through to seed
    }
  }
  const cases = buildSeedCases()
  return { cases, activeCaseId: cases[0]?.id ?? null }
}

export function WorkflowProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkflowState>(loadState)

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
    setState((s) => ({ cases: [next, ...s.cases], activeCaseId: next.id }))
    return next.id
  }, [])

  const setActiveCase = useCallback((id: string | null) => {
    setState((s) => ({ ...s, activeCaseId: id }))
  }, [])

  const approveRouting = useCallback(
    (id: string) => {
      const now = new Date().toISOString()
      updateCase(id, (c) => ({
        ...c,
        decisions: [...c.decisions, { action: 'Approved AI routing', by: STAFF_NAME, at: now }],
        audit: [...c.audit, auditEvent('staff', 'Routing approved', `Staff confirmed the ${c.triage.category} classification and routing to ${c.triage.recommendedDepartment}.`, now)],
      }))
    },
    [updateCase],
  )

  const requestMoreInfo = useCallback(
    (id: string, note?: string) => {
      const now = new Date().toISOString()
      updateCase(id, (c) => ({
        ...c,
        stage: 'needs-staff-attention',
        decisions: [...c.decisions, { action: 'Requested more information', by: STAFF_NAME, at: now, note }],
        audit: [...c.audit, auditEvent('staff', 'More information requested', note || 'Staff requested additional details from the resident before closure.', now)],
      }))
    },
    [updateCase],
  )

  const overridePriority = useCallback(
    (id: string, priority: Priority) => {
      const now = new Date().toISOString()
      updateCase(id, (c) => ({
        ...c,
        priorityOverride: priority,
        decisions: [...c.decisions, { action: `Overrode priority to ${priority}`, by: STAFF_NAME, at: now }],
        audit: [...c.audit, auditEvent('staff', 'Priority overridden', `Staff changed priority from ${c.triage.recommendedPriority} to ${priority}.`, now)],
      }))
    },
    [updateCase],
  )

  const sendToStaffReview = useCallback(
    (id: string) => {
      const now = new Date().toISOString()
      updateCase(id, (c) => {
        const draft = c.draft ?? buildClosureDraft(c.input, c.triage, c.context, now)
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
      updateCase(id, (c) => (c.draft ? { ...c, draft: { ...c.draft, body } } : c))
    },
    [updateCase],
  )

  const approveClosure = useCallback(
    (id: string) => {
      const now = new Date().toISOString()
      updateCase(id, (c) => {
        if (!c.draft) return c
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
            auditEvent('system', 'Resident updated', 'Closure update delivered to the resident (demo — not actually sent).', now),
            auditEvent('system', 'Case closed', 'Case status changed to Closed and logged in the audit trail.', now),
          ],
        }
      })
    },
    [updateCase],
  )

  const resetDemo = useCallback(() => {
    const cases = buildSeedCases()
    setState({ cases, activeCaseId: cases[0]?.id ?? null })
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
    submitComplaint,
    setActiveCase,
    approveRouting,
    requestMoreInfo,
    overridePriority,
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
