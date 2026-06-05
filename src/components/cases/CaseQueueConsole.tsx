import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  type ComplaintFilterOptions,
  type ComplaintRow,
} from '../../services/municipalServiceRequests'
import { PriorityBadge, StatusBadge, type CaseQueueFilters, type SortKey } from './CaseQueueView'
import { CaseQueueSplit, formatDate } from './CaseQueuePanel'

type CaseQueueConsoleProps = {
  eyebrow: string
  /** Base path used for case links, e.g. "/app/cases". */
  casesPath: string
  rows: ComplaintRow[]
  options: ComplaintFilterOptions
  loading: boolean
  /** Explicit Supabase error message, or null. */
  error: string | null
  onRetry: () => void
  filters: CaseQueueFilters
  onChange: (patch: Partial<CaseQueueFilters>) => void
  statusSlot?: React.ReactNode
  /** Active workflow-stage deep-link filter (rendered as a removable chip). */
  activeStage?: string
  onClearStage?: () => void
}

// POC storytelling lines shown above the queue. Kept factual: public benchmark
// municipal service request data demonstrating the workflow, with Brampton ward
// context handled separately — never implying these are Brampton operational
// complaints.
const POC_NOTES = [
  'Public benchmark municipal service request data',
  'Brampton ward context is used separately',
  'Not Brampton operational complaint data',
]

/**
 * Authenticated staff work queue for individual complaints. Renders an
 * operations-style two-column layout (queue list + selected case preview) on
 * desktop and a stacked card list on mobile — never a horizontal-scrolling table
 * as the primary UI. Live Supabase rows only; no mock fallback.
 */
export default function CaseQueueConsole({
  eyebrow,
  casesPath,
  rows,
  options,
  loading,
  error,
  onRetry,
  filters,
  onChange,
  statusSlot,
  activeStage,
  onClearStage,
}: CaseQueueConsoleProps) {
  const statusOptions = useMemo(() => ['All', ...options.statuses], [options.statuses])
  const priorityOptions = useMemo(() => ['All', ...options.priorities], [options.priorities])
  const departmentOptions = useMemo(() => ['All', ...options.departments], [options.departments])
  const categoryOptions = useMemo(() => ['All', ...options.categories], [options.categories])
  const wardOptions = useMemo(() => ['All', ...options.wards], [options.wards])

  // Mobile filter panel + optional dense table view.
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [denseView, setDenseView] = useState(false)

  const activeFilterCount = useMemo(() => {
    let n = 0
    if (filters.status !== 'All') n++
    if (filters.priority !== 'All') n++
    if (filters.department !== 'All') n++
    if (filters.category !== 'All') n++
    if (filters.ward !== 'All') n++
    return n
  }, [filters])

  return (
    <div className="container-page py-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="section-eyebrow">{eyebrow}</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">Case queue</h1>
          <p className="mt-2 text-sm text-ink-muted max-w-3xl">
            Staff work queue for individual complaints. Aggregate stages and program metrics live in the Workflow
            console; open a case for the full investigation record.
          </p>
        </div>
        {statusSlot}
      </div>

      {/* POC storytelling summary */}
      <div className="mt-4 card p-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-subtle">
          <span className="inline-flex items-center gap-1.5 font-semibold text-navy-900">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-accent-500" />
            {loading ? 'Loading live benchmark records…' : `${rows.length.toLocaleString()} live benchmark records shown`}
          </span>
          {POC_NOTES.map((note) => (
            <span key={note} className="flex items-center gap-2">
              <span aria-hidden className="text-slate-300">
                ·
              </span>
              {note}
            </span>
          ))}
        </div>
      </div>

      {activeStage && (
        <div className="mt-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-navy-900/5 px-3 py-1 text-xs font-medium text-navy-900">
            Workflow stage: {activeStage}
            {onClearStage && (
              <button
                onClick={onClearStage}
                className="text-ink-subtle hover:text-navy-900"
                aria-label="Clear workflow stage filter"
              >
                ✕
              </button>
            )}
          </span>
        </div>
      )}

      {/* Filter toolbar */}
      <div className="mt-6 card p-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={filters.query}
              onChange={(e) => onChange({ query: e.target.value })}
              placeholder="Search case ID, complaint type, department, ward, or location"
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
            />
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              className="btn-secondary lg:hidden"
            >
              Filters
              {activeFilterCount > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-navy-900 px-1.5 text-[11px] font-semibold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <select
              value={filters.sortKey}
              onChange={(e) => onChange({ sortKey: e.target.value as SortKey })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent-500"
              aria-label="Sort by"
            >
              <option value="submitted_at">Sort: Submitted</option>
              <option value="operational_priority">Sort: Priority rank</option>
              <option value="status">Sort: Status</option>
            </select>
            <button
              type="button"
              onClick={() => setDenseView((v) => !v)}
              aria-pressed={denseView}
              className={denseView ? 'btn-primary' : 'btn-secondary'}
            >
              Dense view
            </button>
          </div>

          {/* Selects: always shown on desktop; collapsible on mobile */}
          <div className={`${filtersOpen ? 'grid' : 'hidden'} lg:grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2`}>
            <Select label="Status" value={filters.status} options={statusOptions} onChange={(v) => onChange({ status: v })} />
            <Select label="Priority" value={filters.priority} options={priorityOptions} onChange={(v) => onChange({ priority: v })} />
            <Select label="Department" value={filters.department} options={departmentOptions} onChange={(v) => onChange({ department: v })} />
            <Select label="AI category" value={filters.category} options={categoryOptions} onChange={(v) => onChange({ category: v })} />
            <Select label="Ward or area" value={filters.ward} options={wardOptions} onChange={(v) => onChange({ ward: v })} />
          </div>
        </div>
      </div>

      {/* Body */}
      {error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : denseView ? (
        <DenseTable rows={rows} loading={loading} casesPath={casesPath} />
      ) : (
        <div className="mt-6">
          <CaseQueueSplit
            rows={rows}
            casesPath={casesPath}
            loading={loading}
            emptyMessage="No complaints match the current filters."
            cardOpensDetail
            showPanelAiReview={false}
          />
        </div>
      )}
    </div>
  )
}

/** Optional dense table view (opt-in via the Dense view toggle). */
function DenseTable({
  rows,
  loading,
  casesPath,
}: {
  rows: ComplaintRow[]
  loading: boolean
  casesPath: string
}) {
  return (
    <div className="mt-6 card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-ink-subtle">
            <tr className="text-left">
              <Th>Case ID</Th>
              <Th>Submitted</Th>
              <Th>Complaint type</Th>
              <Th>Status</Th>
              <Th>Workflow stage</Th>
              <Th>Priority</Th>
              <Th>AI category</Th>
              <Th>Department</Th>
              <Th>Ward or area</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="whitespace-nowrap px-4 py-3">
                  <Link
                    to={`${casesPath}/${encodeURIComponent(c.id)}`}
                    className="font-medium text-navy-900 hover:underline"
                  >
                    {c.id}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-ink-muted tabular-nums">{formatDate(c.submittedAt)}</td>
                <td className="whitespace-nowrap px-4 py-3">{c.complaintType}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <StatusBadge status={c.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{c.workflowStage}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <PriorityBadge priority={c.priority} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{c.aiCategory}</td>
                <td className="whitespace-nowrap px-4 py-3">{c.assignedDepartment}</td>
                <td className="whitespace-nowrap px-4 py-3">{c.wardOrArea}</td>
              </tr>
            ))}
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-sm text-ink-subtle">
                  Loading complaints…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-sm text-ink-subtle">
                  No complaints match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-6 card p-6">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-navy-900">Could not load the live case queue from Supabase.</div>
          <p className="mt-1 text-sm text-ink-muted">
            The authenticated queue uses live Supabase data only and does not fall back to sample cases. Check the
            connection and try again.
          </p>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-rose-800">
            {message}
          </pre>
          <button type="button" onClick={onRetry} className="btn-primary mt-3">
            Retry
          </button>
        </div>
      </div>
    </div>
  )
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-ink-subtle">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent-500"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider">{children}</th>
}
