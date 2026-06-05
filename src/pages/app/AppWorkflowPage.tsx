import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import SectionHeading from '../../components/SectionHeading'
import { PriorityBadge, StatusBadge } from '../../components/cases/CaseQueueView'
import {
  AttentionChips,
  CaseQueueSplit,
  WorkflowStageBadge,
  deriveAttention,
  displayAttention,
  formatDate,
} from '../../components/cases/CaseQueuePanel'
import WorkflowLifecycle from '../../components/workflow/WorkflowLifecycle'
import WorkflowRoadmap from '../../components/workflow/WorkflowRoadmap'
import {
  DATA_POSITIONING,
  getAgingOpenComplaints,
  getComplaintKpis,
  getMunicipalComplaints,
  getRecentWorkflowEvents,
  getStaffActionSummary,
  getWorkflowStageCounts,
  operationalPriorityRank,
  type ComplaintRow,
  type WorkflowStageCount,
} from '../../services/municipalServiceRequests'

const TRIAGE_STAGE = 'Needs review'
const TRIAGE_LIMIT = 18
const AGING_LIMIT = 15

// Illustrative staff decision options shown in the Human decision section. These
// are labelled demo-only on this overview; real decisions (assignment,
// inspection, closure, …) are recorded as workflow events from the case detail
// page. Nothing here triggers a backend action.
const DECISION_OPTIONS = [
  'Assign to officer',
  'Schedule inspection',
  'Merge duplicate',
  'Escalate',
  'Request more information',
  'Prepare closure',
  'Close case',
]

// Lifecycle ordering + presentation for the workflow stages. Counts are live;
// this only controls the order and accent of the stage strip.
const STAGE_ORDER = [
  'Needs review',
  'Intake and validation',
  'Assigned and under review',
  'Closed',
  'Cancelled',
]

/**
 * Case-queue deep link for a workflow stage. The triage stage ("Needs review")
 * opens with operational priority ordering so staff see the cases to handle
 * first; other stages keep the queue's default ordering.
 */
function stageQueueHref(stage: string): string {
  const base = `/app/cases?stage=${encodeURIComponent(stage)}`
  return stage === TRIAGE_STAGE ? `${base}&sort=operational_priority` : base
}

function stageAccent(stage: string): string {
  const s = stage.toLowerCase()
  if (s.includes('need')) return 'bg-amber-500'
  if (s.includes('intake')) return 'bg-sky-500'
  if (s.includes('assigned') || s.includes('review')) return 'bg-indigo-500'
  if (s.includes('closed') || s.includes('complete')) return 'bg-accent-500'
  if (s.includes('cancel')) return 'bg-slate-400'
  return 'bg-navy-500'
}

function orderStages(stages: WorkflowStageCount[]): WorkflowStageCount[] {
  return [...stages].sort((a, b) => {
    const ia = STAGE_ORDER.indexOf(a.workflow_stage)
    const ib = STAGE_ORDER.indexOf(b.workflow_stage)
    if (ia !== -1 && ib !== -1) return ia - ib
    if (ia !== -1) return -1
    if (ib !== -1) return 1
    return b.case_count - a.case_count
  })
}

type AsyncState<T> = { data: T | null; loading: boolean; error: string | null }

/**
 * Loads one section independently. Each section owns its own loading/error
 * state so a single failing query only degrades that section — it never takes
 * down the whole console and never silently substitutes mock data into the
 * authenticated app.
 */
function useSection<T>(loader: () => Promise<T>): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null })
  useEffect(() => {
    let active = true
    setState({ data: null, loading: true, error: null })
    loader()
      .then((data) => active && setState({ data, loading: false, error: null }))
      .catch((err: unknown) => {
        console.error('Workflow console section failed to load:', err)
        if (active) setState({ data: null, loading: false, error: sectionError(err) })
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return state
}

/**
 * Operations Workflow Console — the authenticated staff command centre. It walks
 * an authorized project reviewer through a guided municipal enforcement flow over
 * the NYC 311 benchmark data in municipal_complaints / workflow_events: see what
 * needs attention, pick a case from the triage worklist, review it in the command
 * panel, optionally generate an on-demand AI staff briefing, decide the next
 * action, and log it. Every panel loads independently from live Supabase; on
 * failure a panel shows an inline warning rather than falling back to sample data.
 * This is decision support only — it never makes or performs an enforcement action.
 */
export default function AppWorkflowPage() {
  const stages = useSection(getWorkflowStageCounts)
  const kpis = useSection(getComplaintKpis)
  const triage = useSection(() =>
    getMunicipalComplaints({ workflowStage: TRIAGE_STAGE, sort: 'operational_priority', limit: TRIAGE_LIMIT }),
  )
  const aging = useSection(() => getAgingOpenComplaints(AGING_LIMIT))
  const events = useSection(() => getRecentWorkflowEvents(10))
  const staff = useSection(getStaffActionSummary)

  const orderedStages = stages.data ? orderStages(stages.data) : []

  // Dataset-relative "now" used to judge aging / recency on a historical
  // benchmark snapshot: the newest submission across the loaded worklists.
  const loadedRows: ComplaintRow[] = [...(triage.data ?? []), ...(aging.data ?? [])]
  const referenceDate =
    loadedRows.reduce((max, r) => {
      const t = r.submittedAt ? new Date(r.submittedAt).getTime() : NaN
      return Number.isFinite(t) && t > max ? t : max
    }, 0) || null

  const getAttention = (row: ComplaintRow) => displayAttention(deriveAttention(row, referenceDate))

  // Staff priority card values (live aggregates where available; aging is derived
  // from the oldest-open worklist relative to the dataset).
  const needsReviewCount =
    stages.data?.find((s) => s.workflow_stage === TRIAGE_STAGE)?.case_count ?? kpis.data?.new_or_initiated_cases
  const highPriorityCount = stages.data
    ? stages.data.reduce((n, s) => n + s.high_priority_count, 0)
    : undefined
  const inProgressCount = kpis.data?.in_progress_cases
  const closedCount = kpis.data?.closed_or_completed_cases

  const agingRows = (aging.data ?? []).filter((r) =>
    deriveAttention(r, referenceDate).some((f) => f.key === 'aging'),
  )
  const agingValue = aging.loading
    ? '—'
    : `${agingRows.length}${agingRows.length === AGING_LIMIT ? '+' : ''}`

  const highLabel = loadedRows.find((r) => operationalPriorityRank(r.priority) === 0)?.priority ?? 'High'
  const inProgressStage = stages.data?.find((s) => /assigned|under review|progress/i.test(s.workflow_stage))?.workflow_stage
  const closedStage = stages.data?.find((s) => /closed|complete/i.test(s.workflow_stage))?.workflow_stage

  return (
    <div className="container-page py-10">
      {/* Hero */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="section-eyebrow">Staff Workspace</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">
            Operations Workflow Console
          </h1>
          <p className="mt-2 text-sm text-ink-muted max-w-3xl">
            Start here to triage complaints, review priority cases, and prepare staff action.
          </p>
          <p className="mt-1 text-sm text-ink-subtle max-w-3xl">{DATA_POSITIONING}</p>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <div className="flex items-center gap-2 text-xs text-ink-subtle">
            <span className="h-2 w-2 rounded-full bg-accent-500" />
            Live data · Supabase
          </div>
          <Link to={stageQueueHref(TRIAGE_STAGE)} className="btn-primary text-sm py-2 px-4">
            Open Needs review queue
          </Link>
        </div>
      </div>

      {/* Demo framing — who you are, what this is, what it is not */}
      <div className="mt-6 card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200">Demo workspace</span>
              <span className="badge bg-navy-900/5 text-navy-900">Decision support</span>
            </div>
            <p className="mt-3 text-sm text-ink leading-relaxed">
              You are viewing a Brampton compatible enforcement workflow demo using benchmark complaint data. This is not
              Brampton operational data and does not perform real enforcement actions.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:max-w-xl">
            <FrameItem
              label="Your demo role"
              value="Municipal enforcement supervisor / authorized project reviewer"
            />
            <FrameItem
              label="Purpose"
              value="Review complaint workload, triage priority cases, prepare staff action"
            />
            <FrameItem
              label="Boundaries"
              value="Supports staff decisions — it does not make enforcement decisions, and is not connected to Brampton case systems yet"
            />
          </div>
        </div>
      </div>

      {/* 1. Start of day — what needs attention now */}
      <div className="mt-10">
        <SectionHeading
          eyebrow="Start of day"
          title="What needs attention now"
          description="Your operational workload at a glance. Counts are live from Supabase; open any card to work that part of the queue."
        />
        {kpis.error && stages.error ? (
          <SectionError className="mt-5" label="workload summary" error={kpis.error} />
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <PriorityCard
              label="Needs review"
              value={fmt(needsReviewCount, stages.loading && kpis.loading)}
              hint="awaiting triage"
              tone="amber"
              href={stageQueueHref(TRIAGE_STAGE)}
              cta="Open triage queue"
            />
            <PriorityCard
              label="High priority"
              value={fmt(highPriorityCount, stages.loading)}
              hint="across all stages"
              tone="red"
              href={`/app/cases?priority=${encodeURIComponent(highLabel)}&sort=operational_priority`}
              cta="View high priority"
            />
            <PriorityCard
              label="Aging or stale"
              value={agingValue}
              hint="open longest"
              tone="orange"
              href="#aging"
              cta="View aging cases"
            />
            <PriorityCard
              label="In progress"
              value={fmt(inProgressCount, kpis.loading)}
              hint="active workflow"
              tone="sky"
              href={inProgressStage ? stageQueueHref(inProgressStage) : '/app/cases'}
              cta="View in progress"
            />
            <PriorityCard
              label="Closed or completed"
              value={fmt(closedCount, kpis.loading)}
              hint="resolved"
              tone="accent"
              href={closedStage ? stageQueueHref(closedStage) : '/app/cases'}
              cta="View closed"
            />
          </div>
        )}
      </div>

      {/* Stage workload strip — what stage is the workload in */}
      <div className="mt-6">
        {stages.error ? (
          <SectionError label="workflow stage counts" error={stages.error} />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-ink-subtle">Workload by stage:</span>
            {orderedStages.map((s) => (
              <Link
                key={s.workflow_stage}
                to={stageQueueHref(s.workflow_stage)}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-navy-900 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <span className={`h-2 w-2 rounded-full ${stageAccent(s.workflow_stage)}`} />
                {s.workflow_stage}
                <span className="font-semibold tabular-nums">{s.case_count.toLocaleString()}</span>
              </Link>
            ))}
            {stages.loading && <span className="text-xs text-ink-subtle">Loading stages…</span>}
          </div>
        )}
      </div>

      {/* 2 + 3. Pick a case → review it in the command panel */}
      <div id="worklist" className="mt-10 scroll-mt-24">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading eyebrow="Pick a case" title="Triage queue — your worklist" />
          <Link to={stageQueueHref(TRIAGE_STAGE)} className="text-xs font-medium text-navy-700 hover:text-navy-900">
            Open full triage queue →
          </Link>
        </div>
        <p className="mt-2 text-sm text-ink-muted max-w-3xl">
          Highest-priority cases needing review first. Select a case to load it into the command panel on the right,
          review the details and rule based triage, then open the full record to record a staff decision.
        </p>
        <div className="mt-5">
          {triage.error ? (
            <SectionError label="triage worklist" error={triage.error} />
          ) : (
            <CaseQueueSplit
              rows={triage.data ?? []}
              casesPath="/app/cases"
              loading={triage.loading}
              emptyMessage="No cases currently need review."
              getAttention={getAttention}
            />
          )}
        </div>
      </div>

      {/* Aging / longest-open cases */}
      <div id="aging" className="mt-10 scroll-mt-24">
        <SectionHeading
          eyebrow="Aging"
          title="Aging & longest-open cases"
          description="Open cases that have been waiting longest. Aging is judged relative to the most recent submission in this benchmark dataset, not wall-clock time."
        />
        {aging.error ? (
          <SectionError className="mt-5" label="aging cases" error={aging.error} />
        ) : aging.loading ? (
          <div className="mt-5 card p-8 text-center text-sm text-ink-subtle">Loading oldest-open cases…</div>
        ) : (aging.data?.length ?? 0) === 0 ? (
          <div className="mt-5 card p-8 text-center text-sm text-ink-subtle">No open cases found.</div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {aging.data!.map((c) => (
              <Link
                key={c.id}
                to={`/app/cases/${encodeURIComponent(c.id)}`}
                className="card card-hover p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-navy-900">{c.id}</div>
                    <div className="mt-0.5 truncate text-sm text-ink">{c.complaintType}</div>
                  </div>
                  <span className="shrink-0 text-xs text-ink-subtle tabular-nums">{formatDate(c.submittedAt)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={c.status} />
                  <WorkflowStageBadge stage={c.workflowStage} />
                  <PriorityBadge priority={c.priority} />
                </div>
                <div className="mt-2">
                  <AttentionChips flags={displayAttention(deriveAttention(c, referenceDate))} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* 4 note + 5. Human decision — what staff decide next */}
      <div className="mt-10">
        <SectionHeading
          eyebrow="Human decision"
          title="What staff decide next"
          description="After reviewing a case — and optionally generating an AI staff briefing — an authorized staff member chooses the next action. The system records the decision; it never decides, assigns, closes, enforces, or sends anything on its own."
        />
        <div className="mt-5 card p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-navy-900">Staff action options</span>
            <span className="badge bg-slate-100 text-slate-600">Demo · illustrative</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {DECISION_OPTIONS.map((o) => (
              <button
                key={o}
                type="button"
                disabled
                title="Demo only — staff record decisions from the case detail page"
                className="btn-secondary text-sm py-1.5 px-3 cursor-not-allowed opacity-70"
              >
                {o}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-subtle">
            These options are illustrative on this overview and are not wired to backend actions here. Open a case to
            record a real staff decision (mark reviewed, assign, inspection required, close case, …) to the case audit
            trail.
          </p>
          <div className="mt-3">
            <Link to={stageQueueHref(TRIAGE_STAGE)} className="text-xs font-medium text-navy-700 hover:text-navy-900">
              Open a case to record a decision →
            </Link>
          </div>
        </div>
      </div>

      {/* 6. Audit trail framing */}
      <div className="mt-10">
        <SectionHeading
          eyebrow="Audit trail"
          title="Decisions are logged and reviewable"
          description="Every staff decision should be recorded and auditable. Recorded workflow events and a summary of the decisions taken so far appear here."
        />
        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          {/* Recent workflow events */}
          <div className="card p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-navy-900">Recent workflow events</h3>
              <span className="text-xs text-ink-subtle">
                {events.data?.length ? `${events.data.length} latest` : 'audit trail'}
              </span>
            </div>
            {events.error ? (
              <SectionError className="mt-4" label="workflow events" error={events.error} />
            ) : events.loading ? (
              <p className="mt-4 text-sm text-ink-subtle">Loading workflow events…</p>
            ) : (events.data?.length ?? 0) === 0 ? (
              <p className="mt-4 text-sm text-ink-subtle">
                No workflow events recorded yet. Open a case and record a staff decision to populate the audit trail.
              </p>
            ) : (
              <ul className="mt-4 space-y-3 text-xs">
                {events.data!.map((e) => (
                  <li key={e.id} className="flex items-start gap-3">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-300 shrink-0" />
                    <div className="flex-1">
                      <div className="text-ink">
                        <Link
                          to={`/app/cases/${encodeURIComponent(e.case_id)}`}
                          className="font-medium text-navy-900 hover:underline"
                        >
                          {e.case_id}
                        </Link>
                        <span className="mx-1.5 text-ink-subtle">·</span>
                        {e.event_label || e.event_type}
                      </div>
                      {(e.from_status || e.to_status) && (
                        <div className="text-ink-subtle">{[e.from_status, e.to_status].filter(Boolean).join(' → ')}</div>
                      )}
                      <div className="text-ink-subtle">{(e.actor_type || 'staff')} · {formatDateTime(e.created_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Staff action summary */}
          <div className="card p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-navy-900">Staff action summary</h3>
              {staff.data && (
                <span className="text-xs text-ink-subtle">
                  {staff.data.total.toLocaleString()} actions · {staff.data.actors.toLocaleString()} actor
                  {staff.data.actors === 1 ? '' : 's'}
                </span>
              )}
            </div>
            {staff.error ? (
              <SectionError className="mt-4" label="staff action summary" error={staff.error} />
            ) : staff.loading ? (
              <p className="mt-4 text-sm text-ink-subtle">Loading staff actions…</p>
            ) : (staff.data?.actions.length ?? 0) === 0 ? (
              <p className="mt-4 text-sm text-ink-subtle">
                No staff actions recorded yet. Recorded decisions (reviews, assignments, inspections, tickets, closures)
                are summarized here.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {staff.data!.actions.map((a) => {
                  const max = Math.max(...staff.data!.actions.map((x) => x.count), 1)
                  return (
                    <li key={a.event_type}>
                      <div className="flex justify-between text-sm">
                        <span className="text-ink">{a.event_label}</span>
                        <span className="font-medium text-navy-900 tabular-nums">{a.count.toLocaleString()}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-navy-700" style={{ width: `${(a.count / max) * 100}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Supporting: intake → closure lifecycle */}
      <div className="mt-12">
        <SectionHeading
          eyebrow="Workflow"
          title="Intake to triage to staff review to closure"
          description="How a complaint moves through the console: received and normalized, risk scored and routed, opened and reviewed by staff with optional AI assistance on click, then closed or escalated to the audit trail. Stage counts are live; the AI review is on demand only and a human decides every case."
        />
        <div className="mt-6">
          <WorkflowLifecycle
            intakeTotal={kpis.data?.total_cases}
            triageCount={needsReviewCount}
            closedCount={closedCount}
            triageHref={stageQueueHref(TRIAGE_STAGE)}
            queueHref="/app/cases"
          />
        </div>
      </div>

      {/* Supporting: phased roadmap */}
      <div className="mt-12">
        <SectionHeading
          eyebrow="Roadmap"
          title="Where this goes next"
          description="The POC is Phase 1 today. Later phases describe the intended direction only — they are not built yet."
        />
        <div className="mt-6">
          <WorkflowRoadmap />
        </div>
      </div>
    </div>
  )
}

type Tone = 'amber' | 'red' | 'orange' | 'sky' | 'accent'

const TONE_DOT: Record<Tone, string> = {
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  sky: 'bg-sky-500',
  accent: 'bg-accent-500',
}

/**
 * Operational priority card. Links to a filtered queue view (or an on-page
 * anchor for aging). Built to feel like a work target, not a marketing stat.
 */
function PriorityCard({
  label,
  value,
  hint,
  tone,
  href,
  cta,
}: {
  label: string
  value: string
  hint: string
  tone: Tone
  href: string
  cta: string
}) {
  const isAnchor = href.startsWith('#')
  const className = 'card card-hover p-5 group block'
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${TONE_DOT[tone]}`} />
        <span className="text-xs font-medium text-ink-muted">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-navy-900 tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] text-ink-subtle">{hint}</div>
      <div className="mt-3 text-xs font-medium text-navy-700 group-hover:text-navy-900">{cta} →</div>
    </>
  )
  return isAnchor ? (
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <Link to={href} className={className}>
      {body}
    </Link>
  )
}

function FrameItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className="mt-1 text-xs leading-relaxed text-ink">{value}</div>
    </div>
  )
}

function SectionError({ label, error, className = '' }: { label: string; error: string; className?: string }) {
  return (
    <div className={`rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800 ${className}`}>
      <span className="font-semibold">Couldn’t load {label} from Supabase.</span>{' '}
      <span className="text-rose-700">{error}</span>
    </div>
  )
}

function fmt(value: number | undefined, loading: boolean): string {
  if (loading || value === undefined) return '—'
  return value.toLocaleString()
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}

function sectionError(err: unknown): string {
  if (err == null) return 'Unknown error'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>
    const parts = [e.message, e.details, e.hint, e.code].filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    )
    if (parts.length > 0) return parts.join(' — ')
  }
  return String(err)
}
