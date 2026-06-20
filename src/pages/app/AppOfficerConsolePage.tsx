import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useWorkflow } from '../../lib/workflowStore'
import { formatDateTime } from '../../services/demoWorkflowService'
import {
  STATUS_LABELS,
  getResidentRequests,
  type ResidentRequestRow,
} from '../../services/residentRequests'
import type { DemoCase } from '../../data/demoWorkflowTypes'

// Officer Field Console — the By-law Officer's only landing surface. It shows
// ONLY cases assigned to the SIGNED-IN officer's email (never the citywide Work
// Queue and never supervisor Insights). It draws from BOTH:
//   a. Supabase resident_service_requests where assigned_officer_email matches
//      the signed-in officer (resident intake — the existing flow, unchanged), and
//   b. Local workflow DemoCase records where assignedOfficerEmail matches the
//      signed-in officer, which is how NYC open benchmark cases assigned in the
//      Workbench reach the officer (they live only in the local workflow store).

// One normalized officer work item, regardless of which source it came from.
type OfficerItem = {
  caseId: string
  complaintType: string
  location: string
  statusLabel: string
  assignedAt: string | null
  fieldVisitCompleted: boolean
  followUpRequired: boolean
  isClosed: boolean
  /** Field outcome recorded and awaiting supervisor closure review. */
  inReview: boolean
  source: 'resident' | 'nyc_open'
}

function residentToItem(row: ResidentRequestRow): OfficerItem {
  return {
    caseId: row.case_id,
    complaintType: row.request_type,
    location: [row.location, row.city].filter(Boolean).join(', '),
    statusLabel: STATUS_LABELS[row.status],
    assignedAt: row.assigned_at,
    fieldVisitCompleted: row.field_visit_completed,
    followUpRequired: row.field_follow_up_required,
    isClosed: row.status === 'closed',
    inReview: row.field_visit_completed && row.status === 'in_review',
    source: 'resident',
  }
}

function localCaseToItem(c: DemoCase): OfficerItem {
  const recorded = Boolean(c.fieldAction)
  const isClosed = c.stage === 'closed'
  const assignedAt = c.decisions.find((d) => d.action.startsWith('Assigned'))?.at ?? null
  return {
    caseId: c.id,
    complaintType: c.normalized.complaint_type ?? c.triage.category,
    location: c.input.location,
    statusLabel: isClosed ? 'Closed' : recorded ? 'Field outcome recorded' : 'Assigned',
    assignedAt,
    fieldVisitCompleted: recorded,
    followUpRequired: c.fieldAction?.followUpRequired ?? false,
    isClosed,
    inReview: recorded && !isClosed,
    source: 'nyc_open',
  }
}

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
  const { role, userEmail, cases } = useWorkflow()
  const [rows, setRows] = useState<ResidentRequestRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<OfficerTab>('assigned')

  // The officer whose cases this console shows is always the signed-in officer.
  // Only officer-role accounts reach this page (non-officers are redirected
  // below), so there is no supervisor "preview" of someone else's queue.
  const officerEmail = (userEmail ?? '').trim().toLowerCase()

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

  // NYC open benchmark cases assigned to this officer live only in the local
  // workflow store — surface them alongside the Supabase resident cases. Match on
  // the assigned officer EMAIL, so the console only shows this officer's cases.
  const localItems = useMemo(
    () =>
      cases
        .filter(
          (c) =>
            c.source.kind === 'nyc_open' &&
            (c.assignedOfficerEmail ?? '').toLowerCase() === officerEmail,
        )
        .map(localCaseToItem),
    [cases, officerEmail],
  )

  const items = useMemo(() => [...(rows ?? []).map(residentToItem), ...localItems], [rows, localItems])

  const groups = useMemo(() => {
    const open = items.filter((i) => !i.isClosed)
    return {
      assigned: open.filter((i) => !i.fieldVisitCompleted),
      due_today: open.filter((i) => !i.fieldVisitCompleted && isToday(i.assignedAt)),
      in_review: items.filter((i) => i.inReview),
      follow_up: items.filter((i) => i.followUpRequired),
      completed: items.filter((i) => i.fieldVisitCompleted),
    } satisfies Record<OfficerTab, OfficerItem[]>
  }, [items])

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
        ) : items.length === 0 ? (
          <EmptyState />
        ) : visible.length === 0 ? (
          <div className="card p-8 text-center text-sm text-ink-subtle">No cases in this list right now.</div>
        ) : (
          <ul className="space-y-4">
            {visible.map((item) => (
              <li key={item.caseId}>
                <OfficerCaseCard item={item} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function OfficerCaseCard({ item }: { item: OfficerItem }) {
  return (
    <Link
      to={`/app/field/${encodeURIComponent(item.caseId)}`}
      className="card block p-5 transition hover:border-accent-300 hover:shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-navy-900">{item.caseId}</span>
            <span className="badge bg-slate-100 text-slate-700">{item.statusLabel}</span>
            <span className="badge bg-slate-100 text-slate-700">{item.complaintType}</span>
            {item.source === 'nyc_open' && (
              <span className="badge bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-200">NYC open benchmark</span>
            )}
            {item.followUpRequired && (
              <span className="badge bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200">Follow-up</span>
            )}
            {item.fieldVisitCompleted && (
              <span className="badge bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200">
                Field outcome recorded
              </span>
            )}
          </div>
          <div className="mt-1 text-sm text-ink-muted">{item.location || 'Location not provided'}</div>
        </div>
        <span className="shrink-0 text-xs text-ink-subtle tabular-nums">
          Assigned {item.assignedAt ? formatDateTime(item.assignedAt) : '—'}
        </span>
      </div>
      <div className="mt-3 text-sm font-semibold text-accent-600">
        {item.fieldVisitCompleted ? 'View field outcome →' : 'Open case & record field outcome →'}
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
