import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { type ComplaintRow } from '../../services/municipalServiceRequests'
import { PriorityBadge, StatusBadge } from './CaseQueueView'

/**
 * Shared staff work-queue UI: a queue list of case cards plus a selected-case
 * preview panel. Used as the primary case interface inside the Workflow console
 * and on the live case queue page — never a horizontal-scrolling table. On
 * mobile it collapses to stacked cards (the preview panel is desktop-only).
 */
export function CaseQueueSplit({
  rows,
  casesPath,
  loading,
  emptyMessage = 'No cases match the current view.',
}: {
  rows: ComplaintRow[]
  casesPath: string
  loading: boolean
  emptyMessage?: string
}) {
  // Selected case for the desktop preview panel. Keep the selection valid as the
  // result set changes; default to the first row.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  useEffect(() => {
    if (rows.length === 0) {
      setSelectedId(null)
      return
    }
    setSelectedId((prev) => (prev && rows.some((r) => r.id === prev) ? prev : rows[0].id))
  }, [rows])

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId])

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* Left: queue list cards (stacked cards on mobile) */}
      <div className="lg:col-span-7">
        {loading && rows.length === 0 ? (
          <div className="card p-10 text-center text-sm text-ink-subtle">Loading cases…</div>
        ) : rows.length === 0 ? (
          <div className="card p-10 text-center text-sm text-ink-subtle">{emptyMessage}</div>
        ) : (
          <ul className="space-y-3">
            {rows.map((c) => (
              <li key={c.id}>
                <QueueCard
                  row={c}
                  casesPath={casesPath}
                  selected={c.id === selectedId}
                  onSelect={() => setSelectedId(c.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Right: selected case preview (desktop only) */}
      <aside className="hidden lg:col-span-5 lg:block">
        <div className="sticky top-24">
          <PreviewPanel row={selected} casesPath={casesPath} />
        </div>
      </aside>
    </div>
  )
}

/** Single complaint card in the staff queue list. */
export function QueueCard({
  row,
  casesPath,
  selected,
  onSelect,
}: {
  row: ComplaintRow
  casesPath: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={`card card-hover cursor-pointer p-4 ${
        selected ? 'border-accent-300 ring-2 ring-accent-200' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`${casesPath}/${encodeURIComponent(row.id)}`}
            onClick={(e) => e.stopPropagation()}
            className="font-semibold text-navy-900 hover:underline"
          >
            {row.id}
          </Link>
          <div className="mt-0.5 truncate text-sm text-ink">{row.complaintType}</div>
        </div>
        <div className="shrink-0 text-right text-xs text-ink-subtle tabular-nums">{formatDate(row.submittedAt)}</div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusBadge status={row.status} />
        <WorkflowStageBadge stage={row.workflowStage} />
        <PriorityBadge priority={row.priority} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-subtle">
        <span className="truncate">{row.assignedDepartment}</span>
        {row.wardOrArea && row.wardOrArea !== 'Unknown' && (
          <>
            <span aria-hidden className="text-slate-300">
              ·
            </span>
            <span className="truncate">{row.wardOrArea}</span>
          </>
        )}
      </div>

      {row.aiSummary && row.aiSummary !== 'No AI summary available.' && (
        <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{row.aiSummary}</p>
      )}
    </div>
  )
}

/** Selected-case preview panel for the desktop two-column layout. */
export function PreviewPanel({ row, casesPath }: { row: ComplaintRow | null; casesPath: string }) {
  if (!row) {
    return (
      <div className="card p-6 text-center text-sm text-ink-subtle">
        Select a case from the queue to preview it here.
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-ink-subtle">Case preview</div>
            <div className="mt-0.5 text-lg font-semibold text-navy-900">{row.id}</div>
            <div className="text-sm text-ink">{row.complaintType}</div>
          </div>
          <span className="shrink-0 text-xs text-ink-subtle tabular-nums">{formatDate(row.submittedAt)}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={row.status} />
          <WorkflowStageBadge stage={row.workflowStage} />
          <PriorityBadge priority={row.priority} />
        </div>
      </div>

      <div className="px-5 py-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Field label="Department" value={row.assignedDepartment} />
          <Field label="Ward or area" value={row.wardOrArea} />
          <Field label="AI category" value={row.aiCategory} />
          <Field label="Submitted" value={formatDate(row.submittedAt)} />
        </dl>

        {row.description && (
          <Block label="Description">
            <p className="text-sm text-ink-muted">{row.description}</p>
          </Block>
        )}

        <Block label="AI summary">
          <p className="text-sm text-ink-muted">{row.aiSummary}</p>
        </Block>

        {row.recommendedAction && (
          <Block label="AI recommended action">
            <p className="text-sm text-ink-muted">{row.recommendedAction}</p>
          </Block>
        )}

        <Link to={`${casesPath}/${encodeURIComponent(row.id)}`} className="btn-primary mt-5 w-full">
          Open full case detail
        </Link>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-ink">{value || '—'}</dd>
    </div>
  )
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  )
}

/** Neutral badge for the workflow stage, consistent with the existing badge system. */
export function WorkflowStageBadge({ stage }: { stage: string }) {
  if (!stage) return null
  return (
    <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
      {stage}
    </span>
  )
}

export function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}
