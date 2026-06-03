import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import StatCard from '../../components/StatCard'
import SectionHeading from '../../components/SectionHeading'
import { PriorityBadge, StatusBadge } from '../../components/cases/CaseQueueView'
import {
  DATA_POSITIONING,
  getComplaintKpis,
  getMunicipalComplaints,
  getRecentWorkflowEvents,
  getStaffActionSummary,
  getWorkflowStageCounts,
  mockComplaintKpis,
  mockComplaintRows,
  mockWorkflowStageCounts,
  type ComplaintKpis,
  type ComplaintRow,
  type StaffActionSummary,
  type WorkflowEvent,
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

/**
 * Operations Workflow Console — a live operational view over the Toronto 311
 * benchmark workflow data in municipal_complaints / workflow_events. It shows
 * live stage counts, recent cases, the triage queue, recorded staff actions,
 * and program success metrics, and drives staff into the case detail to record
 * an action.
 */
export default function AppWorkflowPage() {
  const [stages, setStages] = useState<WorkflowStageCount[]>([])
  const [kpis, setKpis] = useState<ComplaintKpis | null>(null)
  const [recent, setRecent] = useState<ComplaintRow[]>([])
  const [triage, setTriage] = useState<ComplaintRow[]>([])
  const [events, setEvents] = useState<WorkflowEvent[]>([])
  const [staff, setStaff] = useState<{ total: number; actors: number; actions: StaffActionSummary[] }>({
    total: 0,
    actors: 0,
    actions: [],
  })
  const [loading, setLoading] = useState(true)
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setFallback(false)

    Promise.all([
      getWorkflowStageCounts(),
      getComplaintKpis(),
      getMunicipalComplaints({ sort: 'submitted_at', limit: 8 }),
      getMunicipalComplaints({ workflowStage: TRIAGE_STAGE, sort: 'priority', limit: 6 }),
      getRecentWorkflowEvents(12),
      getStaffActionSummary(),
    ])
      .then(([stageData, kpiData, recentData, triageData, eventData, staffData]) => {
        if (!active) return
        if (!kpiData || kpiData.total_cases === 0) {
          useMock()
          return
        }
        setStages(stageData)
        setKpis(kpiData)
        setRecent(recentData)
        setTriage(triageData)
        setEvents(eventData)
        setStaff(staffData)
      })
      .catch((err) => {
        console.error('Failed to load workflow console data, falling back to sample:', err)
        if (active) useMock()
      })
      .finally(() => active && setLoading(false))

    function useMock() {
      const rows = mockComplaintRows()
      setStages(mockWorkflowStageCounts())
      setKpis(mockComplaintKpis())
      setRecent(rows.slice(0, 8))
      setTriage(rows.filter((r) => r.priority === 'High').slice(0, 6))
      setEvents([])
      setStaff({ total: 0, actors: 0, actions: [] })
      setFallback(true)
    }

    return () => {
      active = false
    }
  }, [])

  const orderedStages = useMemo(() => orderStages(stages), [stages])
  const program = useMemo(() => deriveProgramMetrics(kpis), [kpis])
  const totalCases = kpis?.total_cases ?? 0

  return (
    <div className="container-page py-10">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="section-eyebrow">Live Operations</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">
            Operations Workflow Console
          </h1>
          <p className="mt-2 text-sm text-ink-muted max-w-3xl">{DATA_POSITIONING}</p>
        </div>
        <SourceBadge fallback={fallback} loading={loading} />
      </div>

      {/* CTA banner */}
      <div className="mt-6 flex flex-col gap-3 rounded-xl border border-navy-100 bg-gradient-to-r from-navy-900 to-navy-800 px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold">Work a case and record an action</div>
          <div className="mt-0.5 text-xs text-white/70">
            Open a case from the triage queue, review the AI-assisted triage, and log a staff decision to the audit
            trail.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/app/cases?stage=${encodeURIComponent(TRIAGE_STAGE)}`}
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
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {orderedStages.map((s) => (
            <Link
              key={s.workflow_stage}
              to={`/app/cases?stage=${encodeURIComponent(s.workflow_stage)}`}
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
          {loading && orderedStages.length === 0 && (
            <div className="card p-5 text-sm text-ink-subtle">Loading stages…</div>
          )}
        </div>
      </div>

      {/* Program success metrics */}
      <div className="mt-10">
        <SectionHeading eyebrow="Program Success" title="Program success metrics" />
        <p className="mt-2 text-sm text-ink-muted max-w-3xl">
          Operational outcomes computed live from the workflow data — the measures a municipal complaint program is
          tracked on over time.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Total cases" value={fmt(totalCases, loading)} hint="all complaints" />
          <StatCard label="Open backlog" value={fmt(program.backlog, loading)} hint="not yet closed" />
          <StatCard label="In progress" value={fmt(kpis?.in_progress_cases, loading)} hint="active workflow" />
          <StatCard label="Closed or completed" value={fmt(kpis?.closed_or_completed_cases, loading)} hint="resolved" />
          <StatCard
            label="Closure rate"
            value={loading || program.closureRate === null ? '—' : `${program.closureRate}%`}
            hint="closed ÷ total"
          />
          <StatCard label="Awaiting triage" value={fmt(kpis?.new_or_initiated_cases, loading)} hint="needs review" />
        </div>
      </div>

      {/* Recent cases + triage queue */}
      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h3 className="text-sm font-semibold text-navy-900">Recent cases</h3>
            <Link to="/app/cases" className="text-xs font-medium text-navy-700 hover:text-navy-900">
              Open full queue →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-ink-subtle">
                <tr className="text-left">
                  <Th>Case ID</Th>
                  <Th>Submitted</Th>
                  <Th>Type</Th>
                  <Th>Stage</Th>
                  <Th>Status</Th>
                  <Th>Priority</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <Link to={`/app/cases/${encodeURIComponent(c.id)}`} className="font-medium text-navy-900 hover:underline">
                        {c.id}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted tabular-nums whitespace-nowrap">{formatDate(c.submittedAt)}</td>
                    <td className="px-4 py-2.5">{c.complaintType}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{c.workflowStage}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-2.5"><PriorityBadge priority={c.priority} /></td>
                  </tr>
                ))}
                {loading && recent.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-subtle">Loading recent cases…</td></tr>
                )}
                {!loading && recent.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-subtle">No recent cases.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Triage queue preview */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h3 className="text-sm font-semibold text-navy-900">Triage queue</h3>
            <span className="badge bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200">Needs review</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {triage.map((c) => (
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
            {loading && triage.length === 0 && <li className="px-5 py-6 text-sm text-ink-subtle">Loading triage queue…</li>}
            {!loading && triage.length === 0 && (
              <li className="px-5 py-6 text-sm text-ink-subtle">No cases currently need review.</li>
            )}
          </ul>
          <div className="border-t border-slate-100 px-5 py-3">
            <Link
              to={`/app/cases?stage=${encodeURIComponent(TRIAGE_STAGE)}`}
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
      </div>

      {/* Recent workflow events + staff action summary */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-navy-900">Recent workflow events</h3>
            <span className="text-xs text-ink-subtle">{events.length ? `${events.length} latest` : 'audit trail'}</span>
          </div>
          {events.length === 0 ? (
            <p className="mt-4 text-sm text-ink-subtle">
              No workflow events recorded yet. Open a case and record an action to populate the audit trail.
            </p>
          ) : (
            <ul className="mt-4 space-y-3 text-xs">
              {events.map((e) => (
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

        <div className="card p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-navy-900">Staff action summary</h3>
            <span className="text-xs text-ink-subtle">
              {staff.total.toLocaleString()} actions · {staff.actors.toLocaleString()} actor{staff.actors === 1 ? '' : 's'}
            </span>
          </div>
          {staff.actions.length === 0 ? (
            <p className="mt-4 text-sm text-ink-subtle">
              No staff actions recorded yet. Recorded decisions (reviews, assignments, inspections, tickets, closures)
              are summarized here.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {staff.actions.map((a) => {
                const max = Math.max(...staff.actions.map((x) => x.count), 1)
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
  const backlog = Math.max(
    kpis.total_cases - kpis.closed_or_completed_cases - kpis.cancelled_cases,
    0,
  )
  const closureRate = kpis.total_cases > 0 ? Math.round((kpis.closed_or_completed_cases / kpis.total_cases) * 100) : null
  return { backlog, closureRate }
}

function SourceBadge({ fallback, loading }: { fallback: boolean; loading: boolean }) {
  if (fallback) {
    return (
      <div className="flex items-center gap-2 text-xs text-amber-700">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        Sample data · Supabase unavailable
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 text-xs text-ink-subtle">
      <span className="h-2 w-2 rounded-full bg-accent-500" />
      {loading ? 'Loading…' : 'Live data · Supabase'}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap">{children}</th>
}

function fmt(value: number | undefined, loading: boolean): string {
  if (loading || value === undefined) return '—'
  return value.toLocaleString()
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString()
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}
