import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  caseAiReviewInputFromRow,
  operationalPriorityRank,
  type ComplaintRow,
} from '../../services/municipalServiceRequests'
import { PriorityBadge, StatusBadge } from './CaseQueueView'
import CaseAiReview from './CaseAiReview'

// ---------------------------------------------------------------------------
// Case attention logic — derived purely from existing complaint fields. No new
// backend data: each flag is computed from priority, workflow stage, status and
// the submitted date. "Aging" / "Recently submitted" are judged relative to a
// reference date (the newest submission in the loaded set) so the signal stays
// meaningful on a historical benchmark snapshot rather than wall-clock time.
// ---------------------------------------------------------------------------

export type AttentionTone = 'red' | 'amber' | 'orange' | 'sky' | 'slate'

export type AttentionFlag = { key: string; label: string; tone: AttentionTone }

const ATTENTION_TONE: Record<AttentionTone, string> = {
  red: 'bg-red-50 text-red-700 ring-red-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  orange: 'bg-orange-50 text-orange-800 ring-orange-200',
  sky: 'bg-sky-50 text-sky-800 ring-sky-200',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
}

const DAY_MS = 86_400_000

function isOpen(row: ComplaintRow): boolean {
  const stage = row.workflowStage.toLowerCase()
  const status = row.status.toLowerCase()
  return !(
    stage.includes('closed') ||
    stage.includes('cancel') ||
    status.includes('closed') ||
    status.includes('complete') ||
    status.includes('cancel')
  )
}

/**
 * Full set of attention flags for a case. `referenceDate` is the dataset-relative
 * "now" (ms) used to judge aging/recency; pass null to skip date-based flags.
 */
export function deriveAttention(row: ComplaintRow, referenceDate: number | null): AttentionFlag[] {
  const flags: AttentionFlag[] = []
  const stage = row.workflowStage.toLowerCase()
  const status = row.status.toLowerCase()
  const open = isOpen(row)
  const submitted = row.submittedAt ? new Date(row.submittedAt).getTime() : null
  const age = referenceDate && submitted ? referenceDate - submitted : null

  if (operationalPriorityRank(row.priority) === 0) flags.push({ key: 'high', label: 'High priority', tone: 'red' })
  if (stage.includes('need')) flags.push({ key: 'review', label: 'Needs review', tone: 'amber' })
  if (open && age !== null && age >= 30 * DAY_MS) flags.push({ key: 'aging', label: 'Aging', tone: 'orange' })
  if (open && age !== null && age <= 7 * DAY_MS) flags.push({ key: 'new', label: 'Recently submitted', tone: 'sky' })
  if (status.includes('progress') || stage.includes('assigned') || stage.includes('under review'))
    flags.push({ key: 'progress', label: 'In progress', tone: 'slate' })
  if (stage.includes('need') && (!row.aiSummary || row.aiSummary === 'No AI summary available.'))
    flags.push({ key: 'missing', label: 'Missing triage', tone: 'amber' })

  return flags
}

/**
 * Card-facing subset: the value-add signals that aren't already obvious from the
 * status / stage / priority badges (aging, recency, missing triage). Capped so
 * cards stay clean.
 */
export function displayAttention(flags: AttentionFlag[]): AttentionFlag[] {
  return flags.filter((f) => f.key === 'aging' || f.key === 'new' || f.key === 'missing').slice(0, 3)
}

export function AttentionChips({ flags }: { flags: AttentionFlag[] }) {
  if (flags.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {flags.map((f) => (
        <span
          key={f.key}
          className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${ATTENTION_TONE[f.tone]}`}
        >
          {f.label}
        </span>
      ))}
    </div>
  )
}

/**
 * Shared staff work-queue UI: a queue list of case cards plus a selected-case
 * preview panel. Used as the primary case interface inside the Workflow console
 * and on the live case queue page — never a horizontal-scrolling table. On
 * mobile it collapses to stacked cards (the preview panel is desktop-only).
 *
 * Two modes:
 * - Default (live case queue): clicking a card selects it into the preview panel.
 * - `cardOpensDetail` (Workflow worklist): the card is a worklist link that opens
 *   the full ticket on click; hovering/focusing a card updates the desktop
 *   preview. In this mode `showPanelAiReview` is set false so the on-demand AI
 *   review stays on the full case detail page, not in the worklist side panel.
 */
export function CaseQueueSplit({
  rows,
  casesPath,
  loading,
  emptyMessage = 'No cases match the current view.',
  getAttention,
  cardOpensDetail = false,
  showPanelAiReview = true,
}: {
  rows: ComplaintRow[]
  casesPath: string
  loading: boolean
  emptyMessage?: string
  /** Optional per-row attention chips (Workflow console). Omitted elsewhere. */
  getAttention?: (row: ComplaintRow) => AttentionFlag[]
  /** Workflow worklist: card click opens the full ticket; preview follows hover/focus. */
  cardOpensDetail?: boolean
  /** Render the on-demand AI review inside the preview panel (default true). */
  showPanelAiReview?: boolean
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
                  attention={getAttention?.(c)}
                  asLink={cardOpensDetail}
                />
                {/* Mobile: in select mode the command panel appears under the
                    selected card. In cardOpensDetail mode a tap navigates
                    straight to the ticket, so no inline panel is shown. */}
                {!cardOpensDetail && c.id === selectedId && (
                  <div className="mt-3 lg:hidden">
                    <PreviewPanel row={c} casesPath={casesPath} showAiReview={showPanelAiReview} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Right: selected case — sticky preview panel (desktop only). */}
      <aside className="hidden lg:col-span-5 lg:block">
        <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-1">
          <PreviewPanel row={selected} casesPath={casesPath} showAiReview={showPanelAiReview} />
        </div>
      </aside>
    </div>
  )
}

/**
 * Single complaint card in the staff queue list.
 *
 * - Default: a role="button" that selects the case into the preview panel, with
 *   the case id linking to the full ticket.
 * - `asLink` (Workflow worklist): the whole card is a worklist link that opens
 *   the full ticket on click; hovering/focusing it updates the preview panel.
 *   The id renders as plain text to avoid a nested anchor.
 */
export function QueueCard({
  row,
  casesPath,
  selected,
  onSelect,
  attention,
  asLink = false,
}: {
  row: ComplaintRow
  casesPath: string
  selected: boolean
  onSelect: () => void
  attention?: AttentionFlag[]
  asLink?: boolean
}) {
  const detailPath = `${casesPath}/${encodeURIComponent(row.id)}`
  const className = `card card-hover p-4 block ${selected ? 'border-accent-300 ring-2 ring-accent-200' : ''}`

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {asLink ? (
            <div className="font-semibold text-navy-900">{row.id}</div>
          ) : (
            <Link
              to={detailPath}
              onClick={(e) => e.stopPropagation()}
              className="font-semibold text-navy-900 hover:underline"
            >
              {row.id}
            </Link>
          )}
          <div className="mt-0.5 truncate text-sm text-ink">{row.complaintType}</div>
        </div>
        <div className="shrink-0 text-right text-xs text-ink-subtle tabular-nums">{formatDate(row.submittedAt)}</div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusBadge status={row.status} />
        <WorkflowStageBadge stage={row.workflowStage} />
        <PriorityBadge priority={row.priority} />
      </div>

      {attention && attention.length > 0 && (
        <div className="mt-2">
          <AttentionChips flags={attention} />
        </div>
      )}

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
    </>
  )

  // Workflow worklist: the card itself opens the full ticket; hover/focus drives
  // the desktop preview so the panel stays in sync without a click.
  if (asLink) {
    return (
      <Link to={detailPath} onMouseEnter={onSelect} onFocus={onSelect} className={className}>
        {inner}
      </Link>
    )
  }

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
      className={`${className} cursor-pointer`}
    >
      {inner}
    </div>
  )
}

/**
 * Selected-case preview panel: case context up top, the rule based triage, then
 * the link to the full record.
 *
 * When `showAiReview` is true (live case queue) the on-demand AI assisted staff
 * review renders inside this panel. The Workflow worklist sets it false so the
 * panel stays a compact preview — the AI review lives on the full case detail
 * page, where staff review the whole case.
 */
export function PreviewPanel({
  row,
  casesPath,
  showAiReview = true,
}: {
  row: ComplaintRow | null
  casesPath: string
  showAiReview?: boolean
}) {
  if (!row) {
    return (
      <div className="card p-6 text-center text-sm text-ink-subtle">
        Select a case from the queue to preview it here.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Selected case command panel */}
      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-wide text-ink-subtle">Selected case</div>
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
            <Field label="Complaint type" value={row.complaintType} />
            <Field label="Priority" value={row.priority} />
            <Field label="Workflow stage" value={row.workflowStage} />
            <Field label="Department" value={row.assignedDepartment} />
            <Field label="Ward or area" value={row.wardOrArea} />
            <Field label="Submitted" value={formatDate(row.submittedAt)} />
          </dl>

          {row.description && (
            <Block label="Complaint description">
              <p className={`text-sm text-ink-muted ${showAiReview ? '' : 'line-clamp-3'}`}>{row.description}</p>
            </Block>
          )}

          {/* Rule based triage (POC) — distinct from the optional Claude AI review below. */}
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-navy-900">Rule based triage</span>
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                POC · not ML
              </span>
            </div>
            <div className="mt-2.5 space-y-2.5">
              <PanelLine label="Category" value={row.aiCategory} />
              <PanelLine label="Triage summary" value={row.aiSummary} />
              {row.recommendedAction && <PanelLine label="Recommended action" value={row.recommendedAction} emphasis />}
            </div>
          </div>
        </div>
      </div>

      {/* AI assisted staff review for the selected case only — on staff click.
          Keyed to the case so it resets when the selection changes. On the
          Workflow worklist this is replaced by a short note: the review lives on
          the full case detail page to keep the worklist panel a compact preview. */}
      {showAiReview ? (
        <CaseAiReview key={row.id} input={caseAiReviewInputFromRow(row)} compact />
      ) : (
        <p className="text-[11px] text-ink-subtle">AI review lives on full ticket.</p>
      )}

      <Link to={`${casesPath}/${encodeURIComponent(row.id)}`} className="btn-secondary w-full">
        Open full case detail
      </Link>
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

function PanelLine({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</div>
      <p className={`mt-0.5 text-sm ${emphasis ? 'font-medium text-navy-900' : 'text-ink-muted'}`}>{value || '—'}</p>
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
