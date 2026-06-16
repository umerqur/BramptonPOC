// Shared UI primitives for the staff closure-response workflow.
//
// These keep the end-to-end flow consistent across pages: a stepper that mirrors
// the lifecycle, stage badges, a confidence meter, and a compact decision-support
// guardrail footer.

import { Link } from 'react-router-dom'
import { DEMO_DATA_NOTE } from '../../services/demoWorkflowService'
import type { AutomationActor, DemoCase, WorkflowStage } from '../../data/demoWorkflowTypes'

// The canonical end-to-end flow, in order. `lane` drives the swimlane styling
// (who does the work): the AI workflow system vs. authorized by-law staff.
export type FlowStep = {
  key: string
  label: string
  lane: 'ai' | 'staff' | 'resident' | 'officer'
}

export const FLOW_STEPS: FlowStep[] = [
  { key: 'intake', label: 'Complaint intake', lane: 'resident' },
  { key: 'classified', label: 'AI classification', lane: 'ai' },
  { key: 'context', label: 'Enforcement context', lane: 'ai' },
  { key: 'summary', label: 'Case summary', lane: 'ai' },
  { key: 'confidence', label: 'Confidence check', lane: 'ai' },
  { key: 'assigned', label: 'Assigned to officer', lane: 'staff' },
  { key: 'field-visit', label: 'Officer field visit', lane: 'officer' },
  { key: 'staff-review', label: 'Staff review', lane: 'staff' },
  { key: 'closure-draft', label: 'Closure draft', lane: 'ai' },
  { key: 'approval', label: 'Final approval', lane: 'staff' },
  { key: 'resident-update', label: 'Resident update', lane: 'resident' },
]

/** Index of the furthest step a case has reached (for the progress stepper). */
export function stageProgress(stage: WorkflowStage): number {
  switch (stage) {
    case 'intake':
      return 0
    case 'classified':
      return 1
    case 'context':
      return 2
    case 'summary':
      return 3
    case 'needs-staff-attention':
      return 4 // diverted at the confidence gate
    case 'assigned':
      return 5 // assigned to an officer for a field visit
    case 'field-visit':
      return 6 // officer recorded the field outcome
    case 'staff-review':
      return 7 // draft prepared, awaiting approval
    case 'approved':
      return 9
    case 'closed':
      return 10
    default:
      return 0
  }
}

const LANE_DOT: Record<FlowStep['lane'], string> = {
  ai: 'bg-accent-600',
  staff: 'bg-navy-800',
  resident: 'bg-sky-600',
  officer: 'bg-emerald-600',
}

/** Horizontal progress stepper used on every case-centric page. */
export function WorkflowStepper({ stage }: { stage: WorkflowStage }) {
  const current = stageProgress(stage)
  const diverted = stage === 'needs-staff-attention'
  return (
    <div className="overflow-x-auto">
      <ol className="flex min-w-max items-center gap-1">
        {FLOW_STEPS.map((step, i) => {
          const done = i < current
          const active = i === current
          return (
            <li key={step.key} className="flex items-center">
              <div
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? diverted
                      ? 'border-amber-300 bg-amber-50 text-amber-900'
                      : 'border-accent-300 bg-accent-50 text-accent-800'
                    : done
                      ? 'border-slate-200 bg-white text-navy-900'
                      : 'border-slate-200 bg-slate-50 text-ink-subtle'
                }`}
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    done || active ? LANE_DOT[step.lane] : 'bg-slate-300'
                  }`}
                />
                {step.label}
              </div>
              {i < FLOW_STEPS.length - 1 && (
                <span className={`mx-0.5 h-px w-4 ${i < current ? 'bg-accent-300' : 'bg-slate-200'}`} />
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** Badge that calls out who is responsible for a step. */
export function AutomationBadge({ kind }: { kind: 'ai' | 'review' | 'approval' }) {
  if (kind === 'ai') {
    return (
      <span className="badge bg-accent-50 text-accent-800 ring-1 ring-inset ring-accent-200">
        <Gear /> Decision support
      </span>
    )
  }
  if (kind === 'review') {
    return (
      <span className="badge bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200">
        <Person /> Needs staff review
      </span>
    )
  }
  return (
    <span className="badge bg-navy-50 text-navy-900 ring-1 ring-inset ring-navy-200">
      <Shield /> Human approval required
    </span>
  )
}

const ACTOR_STYLES: Record<AutomationActor, string> = {
  ai: 'bg-accent-50 text-accent-800 ring-1 ring-inset ring-accent-200',
  staff: 'bg-navy-50 text-navy-900 ring-1 ring-inset ring-navy-200',
  officer: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200',
  resident: 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200',
  system: 'bg-slate-100 text-slate-700',
}

export function ActorBadge({ actor, label }: { actor: AutomationActor; label: string }) {
  return <span className={`badge ${ACTOR_STYLES[actor]}`}>{label}</span>
}

/** File-readiness meter for the "Is the file ready for staff review?" gate. */
export function ConfidenceMeter({ value, level }: { value: number; level: 'High' | 'Medium' | 'Low' }) {
  const pct = Math.round(value * 100)
  const color = level === 'High' ? 'bg-accent-500' : level === 'Medium' ? 'bg-amber-400' : 'bg-rose-400'
  const text = level === 'High' ? 'text-accent-700' : level === 'Medium' ? 'text-amber-700' : 'text-rose-700'
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-subtle">File readiness</span>
        <span className={`text-sm font-semibold ${text}`}>
          {pct}% · {level}
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

const STAGE_LABEL: Record<WorkflowStage, { label: string; cls: string }> = {
  intake: { label: 'Intake captured', cls: 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200' },
  classified: { label: 'Classified', cls: 'bg-accent-50 text-accent-800 ring-1 ring-inset ring-accent-200' },
  context: { label: 'Context gathered', cls: 'bg-accent-50 text-accent-800 ring-1 ring-inset ring-accent-200' },
  summary: { label: 'Summary built', cls: 'bg-accent-50 text-accent-800 ring-1 ring-inset ring-accent-200' },
  'needs-staff-attention': { label: 'Needs staff attention', cls: 'bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200' },
  assigned: { label: 'Assigned to officer', cls: 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200' },
  'field-visit': { label: 'Field visit recorded', cls: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200' },
  'staff-review': { label: 'Staff review — draft ready', cls: 'bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200' },
  approved: { label: 'Approved', cls: 'bg-accent-50 text-accent-800 ring-1 ring-inset ring-accent-200' },
  closed: { label: 'Closed', cls: 'bg-accent-100 text-accent-900 ring-1 ring-inset ring-accent-300' },
}

export function StageBadge({ stage }: { stage: WorkflowStage }) {
  const s = STAGE_LABEL[stage]
  return <span className={`badge ${s.cls}`}>{s.label}</span>
}

/** Compact one-line summary of a case for list rows / pickers. */
export function CaseChipLine({ c }: { c: DemoCase }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-semibold text-navy-900">{c.id}</span>
      <span className="text-sm text-ink-muted">{c.triage.category}</span>
      <StageBadge stage={c.stage} />
    </div>
  )
}

/** Shown when a page needs an active case but none is selected. */
export function NoCaseState() {
  return (
    <div className="card p-10 text-center">
      <h2 className="text-base font-semibold text-navy-900">No active case yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
        Open a case from the Work Queue to load it here.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link to="/app" className="btn-primary">
          Go to Work Queue →
        </Link>
      </div>
    </div>
  )
}

/** Compact picker to switch the focused case across workbench pages. */
export function CaseSwitcher({
  cases,
  activeId,
  onPick,
}: {
  cases: DemoCase[]
  activeId: string | null
  onPick: (id: string) => void
}) {
  if (cases.length <= 1) return null
  return (
    <label className="flex items-center gap-2 text-xs text-ink-subtle">
      <span className="hidden sm:inline">Case</span>
      <select
        value={activeId ?? ''}
        onChange={(e) => onPick(e.target.value)}
        className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-navy-900 focus:border-accent-500 focus:outline-none"
      >
        {cases.map((c) => (
          <option key={c.id} value={c.id}>
            {c.id} · {c.triage.category}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Compact decision-support guardrail shown at the foot of staff pages. */
export function GuardrailFooter() {
  return (
    <div className="mt-12 rounded-xl border border-navy-200 bg-navy-50 px-5 py-4">
      <div className="flex items-start gap-3">
        <Shield className="mt-0.5 text-navy-700" />
        <div>
          <p className="text-sm font-semibold text-navy-900">Decision support only</p>
          <p className="mt-1 text-xs text-ink-muted">
            Assignments, field outcomes, and closure responses require authorized staff review.
          </p>
        </div>
      </div>
    </div>
  )
}

/** Small inline demo-data note. */
export function DemoDataNote() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
      {DEMO_DATA_NOTE}
    </div>
  )
}

// --- tiny inline icons (no dependency) ---

function Gear({ className = '' }: { className?: string }) {
  return (
    <svg className={`mr-1 ${className}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function Person({ className = '' }: { className?: string }) {
  return (
    <svg className={`mr-1 ${className}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

export function Shield({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}
