import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useWorkflow } from '../../lib/workflowStore'
import { DEMO_OFFICER, roleForEmail } from '../../lib/roles'
import { formatDateTime } from '../../services/demoWorkflowService'
import {
  STATUS_LABELS,
  getResidentRequests,
  type ResidentRequestRow,
} from '../../services/residentRequests'

// Officer Field Console — the By-law Officer's only landing surface. It shows
// ONLY cases a supervisor has assigned to this officer (never the citywide Work
// Queue and never supervisor Insights). Cases and field outcomes are read from
// the shared Supabase resident_service_requests table so the supervisor's
// assignment is visible to the officer.

type OfficerTab = 'assigned' | 'due_today' | 'in_review' | 'follow_up' | 'completed'

const TABS: { key: OfficerTab; label: string }[] = [
  { key: 'assigned', label: 'My assigned cases' },
  { key: 'due_today', label: 'Due today' },
  { key: 'in_review', label: 'In field review' },
  { key: 'follow_up', label: 'Follow up required' },
  { key: 'completed', label: 'Completed field outcomes' },
]

function isToday(iso: string | null): boolean {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  )
}

export default function AppOfficerConsolePage() {
  const { role, userEmail } = useWorkflow()
  const [rows, setRows] = useState<ResidentRequestRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<OfficerTab>('assigned')

  // The officer whose cases this console shows: the signed-in officer, or the
  // demo officer when a supervisor is previewing the officer view.
  const officerEmail = (roleForEmail(userEmail) === 'officer' ? userEmail : DEMO_OFFICER.email)?.toLowerCase() ?? ''

  const load = useCallback(() => {
    setError(null)
    setRows(null)
    getResidentRequests(200)
      .then((all) => setRows(all.filter((r) => (r.assigned_officer_email ?? '').toLowerCase() === officerEmail)))
      .catch((err: unknown) => {
        console.error('Failed to load assigned cases:', err)
        setError('Could not load your assigned cases. Please try again.')
        setRows([])
      })
  }, [officerEmail])

  useEffect(() => {
    load()
  }, [load])

  const groups = useMemo(() => {
    const mine = rows ?? []
    const open = mine.filter((r) => r.status !== 'closed')
    return {
      assigned: open.filter((r) => !r.field_visit_completed),
      due_today: open.filter((r) => !r.field_visit_completed && isToday(r.assigned_at)),
      in_review: mine.filter((r) => r.field_visit_completed && r.status === 'in_review'),
      follow_up: mine.filter((r) => r.field_follow_up_required),
      completed: mine.filter((r) => r.field_visit_completed),
    } satisfies Record<OfficerTab, ResidentRequestRow[]>
  }, [rows])

  // Supervisors/coordinators are not meant to live here; send them to the queue.
  if (role !== 'officer') return <Navigate to="/app" replace />

  const visible = groups[tab]

  return (
    <div className="container-page py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <div className="section-eyebrow">By-law Officer</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">Officer Field Console</h1>
          <p className="mt-2 text-ink-muted">
            Cases a supervisor has assigned to you for a field investigation. Open a case to review the details and
            record your field outcome — your outcome feeds closure review, and a supervisor approves the final closure.
          </p>
        </div>
        <button onClick={load} className="btn-secondary text-sm py-2 px-4" disabled={rows === null}>
          {rows === null ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="mt-8 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium transition ${
              tab === t.key
                ? 'border-accent-600 text-navy-900'
                : 'border-transparent text-ink-subtle hover:text-navy-900'
            }`}
          >
            {t.label}
            <span
              className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${
                tab === t.key ? 'bg-accent-100 text-accent-800' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {groups[t.key].length}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-6">
        {error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">{error}</div>
        ) : rows === null ? (
          <div className="card p-8 text-center text-sm text-ink-subtle">Loading your assigned cases…</div>
        ) : (rows ?? []).length === 0 ? (
          <EmptyState />
        ) : visible.length === 0 ? (
          <div className="card p-8 text-center text-sm text-ink-subtle">No cases in this list right now.</div>
        ) : (
          <ul className="space-y-4">
            {visible.map((row) => (
              <li key={row.case_id}>
                <OfficerCaseCard row={row} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function OfficerCaseCard({ row }: { row: ResidentRequestRow }) {
  return (
    <Link
      to={`/app/field/${encodeURIComponent(row.case_id)}`}
      className="card block p-5 transition hover:border-accent-300 hover:shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-navy-900">{row.case_id}</span>
            <span className="badge bg-slate-100 text-slate-700">{STATUS_LABELS[row.status]}</span>
            <span className="badge bg-slate-100 text-slate-700">{row.request_type}</span>
            {row.field_follow_up_required && (
              <span className="badge bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200">Follow-up</span>
            )}
            {row.field_visit_completed && (
              <span className="badge bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200">
                Field outcome recorded
              </span>
            )}
          </div>
          <div className="mt-1 text-sm text-ink-muted">{[row.location, row.city].filter(Boolean).join(', ')}</div>
        </div>
        <span className="shrink-0 text-xs text-ink-subtle tabular-nums">
          Assigned {row.assigned_at ? formatDateTime(row.assigned_at) : '—'}
        </span>
      </div>
      <div className="mt-3 text-sm font-semibold text-accent-600">
        {row.field_visit_completed ? 'View field outcome →' : 'Open case & record field outcome →'}
      </div>
    </Link>
  )
}

function EmptyState() {
  return (
    <div className="card p-8 text-center">
      <h3 className="text-base font-semibold text-navy-900">No assigned cases yet</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
        No assigned cases yet. A supervisor must assign a case before it appears here.
      </p>
    </div>
  )
}
