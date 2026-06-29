import type { ReactNode } from 'react'

// Shared compact queue-card standard. Every staff queue list (Supervisor
// Priority Queue, By-law Officer Field Console, and any CSR view of the queue)
// uses this one shell so the screens read as the same product system: same white
// card, border, radius, padding, shadow, spacing, and typography.
//
// The structure always answers, top to bottom:
//   1. What is the case?  → caseId
//   2. What needs attention? → status / priority pills
//   3. When? → date (right aligned)
//   4. What is the issue? → title (complaint type)
//   5. Where is it? → subtitle (location)
//   6. What's the decision / who owns it? → decision strip (visually apparent)
//   7. What do I click? → one primary action + secondary actions
//   8. Governance → small footer, only when needed
//
// Density is deliberately compact — this is a scan queue, not a case detail page.

export function QueueCard({
  caseId,
  pills,
  date,
  title,
  subtitle,
  decision,
  actions,
  footer,
}: {
  caseId: string
  pills?: ReactNode
  date?: ReactNode
  title: string
  subtitle?: string
  decision?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="card p-4">
      {/* Top row: case id + status/priority pills, with the date right-aligned. */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-semibold text-navy-900">{caseId}</span>
          {pills}
        </div>
        {date != null && <span className="shrink-0 text-xs text-ink-subtle tabular-nums">{date}</span>}
      </div>

      {/* Main row: complaint type + location in readable text. */}
      <div className="mt-1.5 min-w-0">
        <div className="truncate text-sm font-semibold text-navy-900">{title}</div>
        {subtitle && <div className="truncate text-sm text-ink-muted">{subtitle}</div>}
      </div>

      {/* Decision row: the soft highlighted strip — the value of the queue. */}
      {decision && <div className="mt-2.5">{decision}</div>}

      {/* Action row: one primary dark button + secondary outline buttons. */}
      {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>}

      {/* Footer: governance / helper text only. */}
      {footer && <div className="mt-2 text-[11px] leading-relaxed text-ink-subtle">{footer}</div>}
    </div>
  )
}

type StripTone = 'neutral' | 'teal' | 'amber' | 'emerald'

const STRIP_TONES: Record<StripTone, string> = {
  neutral: 'border-slate-200 bg-slate-50',
  teal: 'border-teal-200 bg-teal-50/70',
  amber: 'border-amber-200 bg-amber-50/70',
  emerald: 'border-emerald-200 bg-emerald-50/70',
}

/**
 * The decision strip — a soft highlighted band carrying the queue's decision
 * support value. Uses normal readable 13px text (NOT tiny muted text); muted
 * text is reserved for helper/governance lines via the QueueCard footer.
 */
export function DecisionStrip({ tone = 'neutral', children }: { tone?: StripTone; children: ReactNode }) {
  return (
    <div className={`rounded-lg border px-3 py-2 text-[13px] leading-relaxed text-ink ${STRIP_TONES[tone]}`}>
      {children}
    </div>
  )
}

/** A consistent pill, sharing the app-wide `badge` shape across every queue. */
export function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`badge ${className}`}>{children}</span>
}

/** The fit-score pill — visible but not loud (teal ring on white). */
export function FitPill({ score }: { score: number }) {
  return (
    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold tabular-nums text-teal-700 ring-1 ring-inset ring-teal-200">
      Fit {score}/100
    </span>
  )
}
