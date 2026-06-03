import { Link } from 'react-router-dom'
import StatCard from '../StatCard'
import SectionHeading from '../SectionHeading'
import {
  DATA_POSITIONING,
  type ComplaintKpis,
  type ComplaintTypeCount,
  type DepartmentWorkload,
} from '../../services/municipalServiceRequests'

type DashboardViewProps = {
  kpis: ComplaintKpis | null
  departmentWorkload: DepartmentWorkload[]
  complaintTypes: ComplaintTypeCount[]
  loading: boolean
  eyebrow: string
  /** Base path used for case links, e.g. "/cases" (public) or "/app/cases" (live). */
  casesPath: string
  /** Small badge rendered on the right of the header (data source indicator). */
  statusSlot?: React.ReactNode
}

/**
 * Presentational dashboard for the Brampton complaint workflow and closure
 * platform. Source-agnostic: the public demo feeds it mock data and the
 * authenticated app feeds it live Supabase KPI views.
 */
export default function DashboardView({
  kpis,
  departmentWorkload,
  complaintTypes,
  loading,
  eyebrow,
  casesPath,
  statusSlot,
}: DashboardViewProps) {
  const maxDept = Math.max(...departmentWorkload.map((d) => d.case_count), 1)
  const maxType = Math.max(...complaintTypes.map((t) => t.case_count), 1)

  return (
    <div className="container-page py-10">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="section-eyebrow">{eyebrow}</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">
            Complaint workflow overview
          </h1>
          <p className="mt-2 text-sm text-ink-muted max-w-3xl">{DATA_POSITIONING}</p>
        </div>
        {statusSlot}
      </div>

      {/* KPI cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total cases" value={fmt(kpis?.total_cases, loading)} hint="complaints in dataset" />
        <StatCard label="New or initiated" value={fmt(kpis?.new_or_initiated_cases, loading)} hint="awaiting triage" />
        <StatCard label="In progress" value={fmt(kpis?.in_progress_cases, loading)} hint="active workflow" />
        <StatCard
          label="Closed or completed"
          value={fmt(kpis?.closed_or_completed_cases, loading)}
          hint="resolved cases"
        />
        <StatCard label="Cancelled" value={fmt(kpis?.cancelled_cases, loading)} hint="withdrawn or invalid" />
        <StatCard label="Complaint types" value={fmt(kpis?.complaint_types, loading)} hint="distinct categories" />
        <StatCard label="Departments" value={fmt(kpis?.departments, loading)} hint="responsible teams" />
        <StatCard label="Wards or areas" value={fmt(kpis?.wards_or_areas, loading)} hint="geographic areas" />
      </div>

      {/* Workload by department + top complaint types */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-navy-900">Workload by department</h3>
            <span className="text-xs text-ink-subtle">Cases assigned</span>
          </div>
          <ul className="mt-4 space-y-3">
            {departmentWorkload.map((d) => (
              <li key={d.assigned_department ?? 'unassigned'}>
                <div className="flex justify-between text-sm">
                  <span className="text-ink">{d.assigned_department ?? 'Unassigned'}</span>
                  <span className="font-medium text-navy-900 tabular-nums">{d.case_count.toLocaleString()}</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-navy-700" style={{ width: `${(d.case_count / maxDept) * 100}%` }} />
                </div>
                <div className="mt-1 text-[11px] text-ink-subtle">
                  {d.in_progress_count.toLocaleString()} in progress · {d.closed_or_completed_count.toLocaleString()}{' '}
                  closed
                </div>
              </li>
            ))}
            {!loading && departmentWorkload.length === 0 && (
              <li className="text-sm text-ink-subtle">No department workload data available.</li>
            )}
          </ul>
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-navy-900">Top complaint types</h3>
            <span className="text-xs text-ink-subtle">By volume</span>
          </div>
          <ul className="mt-4 space-y-3">
            {complaintTypes.map((t) => (
              <li key={t.complaint_type ?? 'uncategorized'}>
                <div className="flex justify-between text-sm">
                  <span className="text-ink">{t.complaint_type ?? 'Uncategorized'}</span>
                  <span className="font-medium text-navy-900 tabular-nums">{t.case_count.toLocaleString()}</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-accent-600" style={{ width: `${(t.case_count / maxType) * 100}%` }} />
                </div>
                {t.ai_category && <div className="mt-1 text-[11px] text-ink-subtle">AI category: {t.ai_category}</div>}
              </li>
            ))}
            {!loading && complaintTypes.length === 0 && (
              <li className="text-sm text-ink-subtle">No complaint type data available.</li>
            )}
          </ul>
        </div>
      </div>

      {/* Program success metrics */}
      <div className="mt-10">
        <SectionHeading
          eyebrow="Program Success"
          title="What this platform is measured on"
        />
        <p className="mt-2 text-sm text-ink-muted max-w-3xl">
          The value of this platform is workflow, closure, workload visibility, and program success measurement. The
          metrics below are the operational outcomes a municipal complaint program tracks over time.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROGRAM_METRICS.map((m) => (
            <div key={m.label} className="card p-5">
              <div className="text-sm font-semibold text-navy-900">{m.label}</div>
              <p className="mt-1 text-xs text-ink-muted leading-relaxed">{m.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8">
        <Link to={casesPath} className="text-sm font-medium text-navy-700 hover:text-navy-900">
          Open the case queue →
        </Link>
      </div>
    </div>
  )
}

const PROGRAM_METRICS: { label: string; description: string }[] = [
  { label: 'Complaint volume', description: 'Total complaints received across all channels and source datasets.' },
  { label: 'Backlog size', description: 'Open complaints not yet closed — the current outstanding workload.' },
  { label: 'Time to first review', description: 'Elapsed time from intake to the first human review of a complaint.' },
  { label: 'Time to assignment', description: 'How long before a complaint is assigned to a responsible department or unit.' },
  { label: 'Time to closure', description: 'End-to-end time from intake to a closed or completed resolution.' },
  { label: 'Repeat complaints', description: 'Complaints about the same location or issue, signalling unresolved root causes.' },
  { label: 'Callbacks and escalations', description: 'Cases reopened, escalated, or returned for additional action.' },
  { label: 'Cases per officer', description: 'Active caseload per staff member — a workload distribution measure.' },
  { label: 'SLA breaches', description: 'Cases that exceeded their target response or closure window.' },
  { label: 'Staff workload reduction', description: 'Reduction in manual triage and routing effort from AI-assisted triage.' },
  { label: 'Estimated triage time saved', description: 'Approximate staff hours saved by rule based POC triage and pre-routing.' },
]

function fmt(value: number | undefined, loading: boolean): string {
  if (loading || value === undefined) return '—'
  return value.toLocaleString()
}
