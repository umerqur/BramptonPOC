import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  DATA_POSITIONING,
  type ComplaintFilterOptions,
  type ComplaintRow,
} from '../../services/municipalServiceRequests'

export type SortKey = 'submitted_at' | 'priority' | 'status'

export type CaseQueueFilters = {
  query: string
  status: string
  priority: string
  department: string
  category: string
  ward: string
  workflowStage: string
  sortKey: SortKey
}

type CaseQueueViewProps = {
  eyebrow: string
  /** Base path used for case links, e.g. "/cases" or "/app/cases". */
  casesPath: string
  rows: ComplaintRow[]
  options: ComplaintFilterOptions
  loading: boolean
  filters: CaseQueueFilters
  onChange: (patch: Partial<CaseQueueFilters>) => void
  statusSlot?: React.ReactNode
  /** Active workflow-stage deep-link filter (rendered as a removable chip). */
  activeStage?: string
  onClearStage?: () => void
}

const COLUMN_COUNT = 11

/**
 * Presentational complaint case queue. Filter state is owned by the container,
 * which supplies either client-filtered mock rows (public demo) or
 * server-filtered Supabase rows (authenticated app).
 */
export default function CaseQueueView({
  eyebrow,
  casesPath,
  rows,
  options,
  loading,
  filters,
  onChange,
  statusSlot,
  activeStage,
  onClearStage,
}: CaseQueueViewProps) {
  const statusOptions = useMemo(() => ['All', ...options.statuses], [options.statuses])
  const priorityOptions = useMemo(() => ['All', ...options.priorities], [options.priorities])
  const departmentOptions = useMemo(() => ['All', ...options.departments], [options.departments])
  const categoryOptions = useMemo(() => ['All', ...options.categories], [options.categories])
  const wardOptions = useMemo(() => ['All', ...options.wards], [options.wards])

  return (
    <div className="container-page py-10">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="section-eyebrow">{eyebrow}</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">All complaints</h1>
          <p className="mt-2 text-sm text-ink-muted max-w-3xl">{DATA_POSITIONING}</p>
          <p className="mt-1 text-sm text-ink-subtle">
            {loading ? 'Loading…' : `${rows.length.toLocaleString()} records shown`}
          </p>
          {activeStage && (
            <div className="mt-2">
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
        </div>
        {statusSlot}
      </div>

      <div className="mt-6 card p-4">
        <div className="grid gap-3 md:grid-cols-12 items-end">
          <div className="md:col-span-12 lg:col-span-3">
            <label className="text-xs font-medium text-ink-subtle">Search</label>
            <input
              value={filters.query}
              onChange={(e) => onChange({ query: e.target.value })}
              placeholder="Search case ID, complaint type, department, ward, or location"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
            />
          </div>
          <Select
            label="Status"
            value={filters.status}
            options={statusOptions}
            onChange={(v) => onChange({ status: v })}
          />
          <Select
            label="Priority"
            value={filters.priority}
            options={priorityOptions}
            onChange={(v) => onChange({ priority: v })}
          />
          <Select
            label="Department"
            value={filters.department}
            options={departmentOptions}
            onChange={(v) => onChange({ department: v })}
          />
          <Select
            label="AI category"
            value={filters.category}
            options={categoryOptions}
            onChange={(v) => onChange({ category: v })}
          />
          <Select
            label="Ward or area"
            value={filters.ward}
            options={wardOptions}
            onChange={(v) => onChange({ ward: v })}
          />
          <div className="md:col-span-3 lg:col-span-1">
            <label className="text-xs font-medium text-ink-subtle">Sort by</label>
            <select
              value={filters.sortKey}
              onChange={(e) => onChange({ sortKey: e.target.value as SortKey })}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="submitted_at">Submitted</option>
              <option value="priority">Priority</option>
              <option value="status">Status</option>
            </select>
          </div>
        </div>
      </div>

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
                <Th>Unit</Th>
                <Th>Ward or area</Th>
                <Th>Location</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td>
                    <Link
                      to={`${casesPath}/${encodeURIComponent(c.id)}`}
                      className="font-medium text-navy-900 hover:underline"
                    >
                      {c.id}
                    </Link>
                  </Td>
                  <Td className="text-ink-muted tabular-nums">{formatDate(c.submittedAt)}</Td>
                  <Td>{c.complaintType}</Td>
                  <Td><StatusBadge status={c.status} /></Td>
                  <Td className="text-ink-muted">{c.workflowStage}</Td>
                  <Td><PriorityBadge priority={c.priority} /></Td>
                  <Td className="text-ink-muted">{c.aiCategory}</Td>
                  <Td>{c.assignedDepartment}</Td>
                  <Td className="text-ink-muted">{c.departmentUnit}</Td>
                  <Td>{c.wardOrArea}</Td>
                  <Td className="text-ink-muted">{c.address}</Td>
                </tr>
              ))}
              {loading && (
                <tr>
                  <td colSpan={COLUMN_COUNT} className="px-4 py-10 text-center text-ink-subtle text-sm">
                    Loading complaints…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMN_COUNT} className="px-4 py-10 text-center text-ink-subtle text-sm">
                    No complaints match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
    <div className="md:col-span-3 lg:col-span-2">
      <label className="text-xs font-medium text-ink-subtle">{label}</label>
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
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${className}`}>
      {children}
    </th>
  )
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 whitespace-nowrap ${className}`}>{children}</td>
}

export function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase()
  const cls = s.includes('closed') || s.includes('complete')
    ? 'bg-accent-50 text-accent-800 ring-accent-200'
    : s.includes('cancel')
      ? 'bg-slate-100 text-slate-600 ring-slate-200'
      : s.includes('progress')
        ? 'bg-sky-50 text-sky-800 ring-sky-200'
        : 'bg-amber-50 text-amber-800 ring-amber-200'
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      {status}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: string }) {
  const p = priority.toLowerCase()
  const cls = p.includes('high') || p.includes('urgent') || p === 'p1'
    ? 'bg-red-50 text-red-700 ring-red-200'
    : p.includes('medium') || p === 'p2' || p === 'p3'
      ? 'bg-amber-50 text-amber-800 ring-amber-200'
      : 'bg-slate-100 text-slate-600 ring-slate-200'
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      {priority}
    </span>
  )
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}
