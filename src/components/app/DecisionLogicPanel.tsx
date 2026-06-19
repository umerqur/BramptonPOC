import type { PriorityComponent, ReviewPriorityTier, WorkQueueRow } from '../../services/workQueue'

// Decision Logic — a transparent, rules-based explanation of WHY a case received
// its review priority. This is decision support for staff review order only. It
// does not decide enforcement action, penalty, closure, or resident
// communication, and it is not AI, risk prediction, or automated triage.

const GUARDRAIL =
  'Review priority orders staff attention only. It does not decide enforcement action, penalty, closure, or resident communication.'

const COMPONENTS_UNAVAILABLE_NOTE =
  'Detailed component weights are not available for this source row. The open queue score comes from the deterministic NYC open review queue view. Shown factors are the available source fields and priority reason.'

const TIER_STYLES: Record<ReviewPriorityTier, string> = {
  High: 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200',
  Medium: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  Low: 'bg-slate-100 text-slate-700',
  Unscored: 'bg-slate-100 text-slate-500',
}

export type DecisionLogicData = {
  score: number | null
  tier: ReviewPriorityTier
  reason: string | null
  /** Deterministic component breakdown (resident intakes). */
  components?: PriorityComponent[] | null
  /** Available source fields, shown when component weights are not exposed (NYC open rows). */
  sourceFields?: { label: string; value: string }[] | null
}

/** Build decision-logic data from a normalized Work Queue row. */
export function decisionLogicFromWorkRow(row: WorkQueueRow): DecisionLogicData {
  if (row.source_type === 'resident' && row.priority_components?.length) {
    return {
      score: row.priority_score,
      tier: row.priority_tier,
      reason: row.priority_reason,
      components: row.priority_components,
    }
  }
  // NYC open benchmark — no exposed component weights; show available fields.
  const open = row.open
  const sourceFields: { label: string; value: string }[] = [
    { label: 'Priority score', value: row.priority_score == null ? '—' : String(row.priority_score) },
    { label: 'Priority tier', value: row.priority_tier },
    { label: 'Complaint type', value: row.complaint_type ?? '—' },
    { label: 'Age in queue', value: open?.age_days == null ? '—' : `${open.age_days} day${open.age_days === 1 ? '' : 's'}` },
    { label: 'Due date', value: open?.due_date ?? '—' },
    {
      label: 'Borough / district',
      value:
        [open?.borough, open?.council_district ? `District ${Number(open.council_district)}` : null]
          .filter(Boolean)
          .join(' · ') || '—',
    },
  ]
  return { score: row.priority_score, tier: row.priority_tier, reason: row.priority_reason, sourceFields }
}

function TierBadge({ tier }: { tier: ReviewPriorityTier }) {
  return (
    <span className={`badge ${TIER_STYLES[tier]}`}>
      {tier === 'Unscored' ? 'Unscored' : `${tier} priority`}
    </span>
  )
}

/** The shared decision-logic body: score, tier, why review, breakdown, guardrail. */
function DecisionLogicBody({ score, tier, reason, components, sourceFields }: DecisionLogicData) {
  const total = score == null ? null : score
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <TierBadge tier={tier} />
        <span className="text-[11px] tabular-nums text-ink-subtle">
          {score == null ? 'Unscored' : `Review priority ${score}`}
        </span>
      </div>

      {reason && (
        <p className="text-xs text-ink-muted">
          <span className="font-medium text-ink">Why review:</span> {reason}
        </p>
      )}

      {components && components.length > 0 ? (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">Score breakdown</div>
          <ul className="mt-1.5 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {components.map((c) => (
              <li key={c.label} className="flex items-start justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium text-navy-900">{c.label}</div>
                  <div className="text-[11px] text-ink-subtle">{c.explanation}</div>
                </div>
                <div className="shrink-0 tabular-nums text-ink-muted">
                  {c.points == null ? '—' : `+${c.points}`}
                </div>
              </li>
            ))}
            {total != null && (
              <li className="flex items-center justify-between gap-3 bg-slate-50 px-3 py-2">
                <span className="font-semibold text-navy-900">Total review priority</span>
                <span className="shrink-0 font-semibold tabular-nums text-navy-900">{total}</span>
              </li>
            )}
          </ul>
        </div>
      ) : (
        <div>
          {sourceFields && sourceFields.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-slate-200 px-3 py-2.5">
              {sourceFields.map((f) => (
                <div key={f.label} className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-wider text-ink-subtle">{f.label}</dt>
                  <dd className="truncate text-ink">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">{COMPONENTS_UNAVAILABLE_NOTE}</p>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-ink-subtle">{GUARDRAIL}</p>
    </div>
  )
}

/**
 * Compact disclosure for a Work Queue row. Collapsed by default so the row stays
 * tight; expands to the full rules-based breakdown.
 */
export function DecisionLogicDisclosure({ data }: { data: DecisionLogicData }) {
  return (
    <details className="group mt-3 rounded-lg border border-slate-200 bg-slate-50/50">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2">
        <span className="flex items-center gap-2 text-xs font-medium text-ink-muted">
          <span className="badge bg-accent-50 text-accent-800 ring-1 ring-inset ring-accent-200">Decision logic</span>
          Why this review priority — rules based, not AI.
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="h-4 w-4 shrink-0 text-ink-subtle transition-transform group-open:rotate-180"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="border-t border-slate-200 px-3 py-3">
        <DecisionLogicBody {...data} />
      </div>
    </details>
  )
}

/** Full card panel for the Case Workbench right column. */
export default function DecisionLogicPanel({ data }: { data: DecisionLogicData }) {
  return (
    <section className="card p-5">
      <h3 className="text-sm font-semibold text-navy-900">Decision logic</h3>
      <p className="text-xs text-ink-subtle">Rules based review priority</p>
      <div className="mt-3">
        <DecisionLogicBody {...data} />
      </div>
    </section>
  )
}
