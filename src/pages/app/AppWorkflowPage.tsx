import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import StatCard from '../../components/StatCard'
import SectionHeading from '../../components/SectionHeading'
import { PriorityBadge } from '../../components/cases/CaseQueueView'
import { CaseQueueSplit } from '../../components/cases/CaseQueuePanel'
import {
  DATA_POSITIONING,
  getComplaintKpis,
  getMunicipalComplaints,
  getRecentWorkflowEvents,
  getStaffActionSummary,
  getWorkflowStageCounts,
  type ComplaintKpis,
  type WorkflowStageCount,
} from '../../services/municipalServiceRequests'

const TRIAGE_STAGE = 'Needs review'

// Lifecycle ordering + presentation for the workflow stages. Counts are live;
// this only controls the order and accent of the stage rail.
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
 * state so a single failing query (e.g. a view that has not been created yet)
 * only degrades that section — it never takes down the whole console and never
 * silently substitutes mock data into the authenticated app.
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
 * Operations Workflow Console — a live operational view over the Toronto 311
 * benchmark workflow data in municipal_complaints / workflow_events. Each panel
 * loads independently from live Supabase; on failure a panel shows an inline
 * warning rather than falling back to sample data, so no mock cases or fake
 * addresses ever appear inside the authenticated app.
 */
export default function AppWorkflowPage() {
  const stages = useSection(getWorkflowStageCounts)
  const kpis = useSection(getComplaintKpis)
  const cases = useSection(async () => {
    const [recent, triage] = await Promise.all([
      getMunicipalComplaints({ sort: 'submitted_at', limit: 12 }),
      getMunicipalComplaints({ workflowStage: TRIAGE_STAGE, sort: 'operational_priority', limit: 6 }),
    ])
    return { recent, triage }
  })
  const events = useSection(() => getRecentWorkflowEvents(12))
  const staff = useSection(getStaffActionSummary)

  const orderedStages = stages.data ? orderStages(stages.data) : []
  const program = deriveProgramMetrics(kpis.data)

  return (
    <div className="container-page py-10">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="section-eyebrow">Live Operations</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">
            Workflow console
          </h1>
          <p className="mt-2 text-sm text-ink-muted max-w-3xl">
            The main staff workspace: what needs attention, what stage each complaint is in, which cases to open next,
            what action to take, and what has been closed.
          </p>
          <p className="mt-1 text-sm text-ink-subtle max-w-3xl">{DATA_POSITIONING}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-subtle">
          <span className="h-2 w-2 rounded-full bg-accent-500" />
          Live data · Supabase
        </div>
      </div>

      {/* CTA banner */}
      <div className="mt-6 flex flex-col gap-3 rounded-xl border border-navy-100 bg-gradient-to-r from-navy-900 to-navy-800 px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold">Work a case and record an action</div>
          <div className="mt-0.5 text-xs text-white/70">
            Open a case from the triage queue, review the rule-based POC triage, and log a staff decision to the audit
            trail.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to={stageQueueHref(TRIAGE_STAGE)}
            className="btn bg-white text-navy-900 hover:bg-slate-100 text-sm py-2 px-4"
          >
            Open triage queue
          </Link>
          <Link to="/app/cases" className="btn border border-white/30 text-white hover:bg-white/10 text-sm py-2 px-4">
            Full case queue
          </Link>
        </div>
      </div>

      {/* Live counts by workflow stage */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-navy-900">Live counts by workflow stage</h2>
          <span className="text-xs text-ink-subtle">Click a stage to open it in the case queue</span>
        </div>
        {stages.error ? (
          <SectionError className="mt-4" label="workflow stage counts" error={stages.error} />
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {orderedStages.map((s) => (
              <Link
                key={s.workflow_stage}
                to={stageQueueHref(s.workflow_stage)}
                className="card card-hover p-5 group"
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${stageAccent(s.workflow_stage)}`} />
                  <span className="text-xs font-medium text-ink-muted">{s.workflow_stage}</span>
                </div>
                <div className="mt-2 text-2xl font-semibold text-navy-900 tabular-nums">
                  {s.case_count.toLocaleString()}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-subtle">
                  <span>{s.high_priority_count.toLocaleString()} high</span>
                  <span>{s.in_progress_count.toLocaleString()} active</span>
                  <span>{s.closed_count.toLocaleString()} closed</span>
                </div>
                <div className="mt-3 text-xs font-medium text-navy-700 group-hover:text-navy-900">Open in queue →</div>
              </Link>
            ))}
            {stages.loading && <div className="card p-5 text-sm text-ink-subtle">Loading stages…</div>}
          </div>
        )}
      </div>

      {/* Program success metrics */}
      <div className="mt-10">
        <SectionHeading eyebrow="Program Success" title="Program success metrics" />
        <p className="mt-2 text-sm text-ink-muted max-w-3xl">
          Operational outcomes computed live from the workflow data — the measures a municipal complaint program is
          tracked on over time.
        </p>
        {kpis.error ? (
          <SectionError className="mt-5" label="program metrics" error={kpis.error} />
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Total cases" value={fmt(kpis.data?.total_cases, kpis.loading)} hint="all complaints" />
            <StatCard label="Open backlog" value={fmt(program.backlog, kpis.loading)} hint="not yet closed" />
            <StatCard label="In progress" value={fmt(kpis.data?.in_progress_cases, kpis.loading)} hint="active workflow" />
            <StatCard
              label="Closed or completed"
              value={fmt(kpis.data?.closed_or_completed_cases, kpis.loading)}
              hint="resolved"
            />
            <StatCard
              label="Closure rate"
              value={kpis.loading || program.closureRate === null ? '—' : `${program.closureRate}%`}
              hint="closed ÷ total"
            />
            <StatCard
              label="Awaiting triage"
              value={fmt(kpis.data?.new_or_initiated_cases, kpis.loading)}
              hint="needs review"
            />
          </div>
        )}
      </div>

      {/* Staff work queue — which cases to open next */}
      <div className="mt-10">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading eyebrow="Work Queue" title="Staff work queue" />
          <Link to="/app/cases" className="text-xs font-medium text-navy-700 hover:text-navy-900">
            Open full filtered queue →
          </Link>
        </div>
        <p className="mt-2 text-sm text-ink-muted max-w-3xl">
          Which cases to open next. Select a case to preview it, then open the full record to review the rule-based POC
          triage and record a staff action.
        </p>
        <div className="mt-5">
          {cases.error ? (
            <SectionError label="staff work queue" error={cases.error} />
          ) : (
            <CaseQueueSplit
              rows={cases.data?.recent ?? []}
              casesPath="/app/cases"
              loading={cases.loading}
              emptyMessage="No recent cases."
            />
          )}
        </div>
      </div>

      {/* What needs attention + audit trail */}
      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {/* Triage queue — what needs attention */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h3 className="text-sm font-semibold text-navy-900">What needs attention</h3>
            <span className="badge bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200">Needs review</span>
          </div>
          {cases.error ? (
            <SectionError className="m-5" label="triage queue" error={cases.error} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {(cases.data?.triage ?? []).map((c) => (
                <li key={c.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link to={`/app/cases/${encodeURIComponent(c.id)}`} className="font-medium text-navy-900 hover:underline text-sm">
                      {c.id}
                    </Link>
                    <PriorityBadge priority={c.priority} />
                  </div>
                  <div className="mt-0.5 text-xs text-ink-muted truncate">{c.complaintType} · {c.wardOrArea}</div>
                  <Link
                    to={`/app/cases/${encodeURIComponent(c.id)}`}
                    className="mt-1 inline-block text-xs font-medium text-accent-700 hover:text-accent-800"
                  >
                    Open &amp; record action →
                  </Link>
                </li>
              ))}
              {cases.loading && <li className="px-5 py-6 text-sm text-ink-subtle">Loading triage queue…</li>}
              {!cases.loading && (cases.data?.triage.length ?? 0) === 0 && (
                <li className="px-5 py-6 text-sm text-ink-subtle">No cases currently need review.</li>
              )}
            </ul>
          )}
          <div className="border-t border-slate-100 px-5 py-3">
            <Link
              to={stageQueueHref(TRIAGE_STAGE)}
              className="text-xs font-medium text-navy-700 hover:text-navy-900"
            >
              Open triage queue →
            </Link>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
              Priority is rule-based POC triage generated from complaint type, division, and status. It is not machine
              learning and not a risk prediction.
            </p>
          </div>
        </div>

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
              No workflow events recorded yet. Open a case and record an action to populate the audit trail.
            </p>
          ) : (
            <ul className="mt-4 space-y-3 text-xs">
              {events.data!.map((e) => (
                <li key={e.id} className="flex items-start gap-3">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-300 shrink-0" />
                  <div className="flex-1">
                    <div className="text-ink">
                      <Link to={`/app/cases/${encodeURIComponent(e.case_id)}`} className="font-medium text-navy-900 hover:underline">
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
  )
}

function deriveProgramMetrics(kpis: ComplaintKpis | null): {
  backlog: number | undefined
  closureRate: number | null
} {
  if (!kpis) return { backlog: undefined, closureRate: null }
  const backlog = Math.max(kpis.total_cases - kpis.closed_or_completed_cases - kpis.cancelled_cases, 0)
  const closureRate = kpis.total_cases > 0 ? Math.round((kpis.closed_or_completed_cases / kpis.total_cases) * 100) : null
  return { backlog, closureRate }
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
