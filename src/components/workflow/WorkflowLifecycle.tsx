import { Link } from 'react-router-dom'

/**
 * "Intake → Triage → Staff review → Closure" lifecycle visualization for the
 * Workflow console. Presentational only: it lays out the eight enforcement
 * intake-to-closure stages grouped under the four macro phases, with each stage
 * tagged by how it is handled (automated, rule based, on staff click, or a human
 * decision). Live counts are passed in from the console's Supabase queries so the
 * rail reflects real data; everything else is fixed copy.
 *
 * Styling reuses the existing design tokens (card, badge palettes, navy/accent
 * colors) — no new visual language is introduced.
 */

type AutomationTag = 'automated' | 'rule' | 'ai' | 'human'

const TAG_META: Record<AutomationTag, { label: string; badge: string; dot: string }> = {
  automated: {
    label: 'Automated',
    badge: 'bg-sky-50 text-sky-700 ring-sky-200',
    dot: 'bg-sky-500',
  },
  rule: {
    label: 'Rule based',
    badge: 'bg-amber-50 text-amber-800 ring-amber-200',
    dot: 'bg-amber-500',
  },
  ai: {
    label: 'On staff click',
    badge: 'bg-accent-50 text-accent-800 ring-accent-200',
    dot: 'bg-accent-500',
  },
  human: {
    label: 'Human decision',
    badge: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    dot: 'bg-indigo-500',
  },
}

type Stage = {
  n: number
  title: string
  body: string
  tag: AutomationTag
  metric?: { value: string; label: string }
  href?: string
  hrefLabel?: string
}

type MacroPhase = {
  key: string
  title: string
  blurb: string
  accent: string // top border + dot color
  stages: Stage[]
}

export type WorkflowLifecycleMetrics = {
  intakeTotal?: number
  triageCount?: number
  closedCount?: number
  triageHref: string
  queueHref: string
}

function num(value: number | undefined): string {
  return value === undefined ? '—' : value.toLocaleString()
}

function buildPhases(m: WorkflowLifecycleMetrics): MacroPhase[] {
  return [
    {
      key: 'intake',
      title: 'Intake',
      blurb: 'A complaint is received and normalized into the municipal case schema.',
      accent: 'border-sky-500',
      stages: [
        {
          n: 1,
          title: 'New complaint received',
          body: 'A resident complaint arrives from a 311-style channel — web, phone, mobile, or walk-in. In this POC, NYC 311 public benchmark records stand in for live municipal intake.',
          tag: 'automated',
          metric: { value: num(m.intakeTotal), label: 'cases in system' },
        },
        {
          n: 2,
          title: 'Normalized into municipal case schema',
          body: 'Each record is mapped into the standard municipal case schema — complaint type, location, ward or area, and responsible department — so every case is comparable and queryable.',
          tag: 'automated',
        },
      ],
    },
    {
      key: 'triage',
      title: 'Triage',
      blurb: 'The case is risk scored with explainable drivers and routed to staff.',
      accent: 'border-amber-500',
      stages: [
        {
          n: 3,
          title: 'Risk scored with explainable drivers',
          body: 'Rule based POC triage assigns a priority and category from complaint type, division, and status. The drivers are shown, not hidden — it is not machine learning and not a risk prediction.',
          tag: 'rule',
        },
        {
          n: 4,
          title: 'Routed into staff triage queue',
          body: 'Scored cases land in the staff triage queue, ordered by operational priority so the cases to handle first surface at the top.',
          tag: 'automated',
          metric: { value: num(m.triageCount), label: 'need review' },
          href: m.triageHref,
          hrefLabel: 'Open triage queue',
        },
      ],
    },
    {
      key: 'review',
      title: 'Staff review',
      blurb: 'A staff member opens a case, can request an AI review, and decides the next action.',
      accent: 'border-indigo-500',
      stages: [
        {
          n: 5,
          title: 'Staff opens selected case',
          body: 'An authorized staff member opens a case to see the original complaint, the rule based triage, similar cases, and the full audit trail.',
          tag: 'human',
          href: m.queueHref,
          hrefLabel: 'Open case queue',
        },
        {
          n: 6,
          title: 'Optional AI assisted review generated on click',
          body: 'On an explicit staff click, Claude generates a structured review for that one case — summary, recommended next action, missing information, and a resident response draft. It never runs automatically and never batch processes records.',
          tag: 'ai',
        },
        {
          n: 7,
          title: 'Staff edits or approves next action',
          body: 'Staff edit or approve the next action. The human decides every case — the rules and the AI review only support the decision, they never make it.',
          tag: 'human',
        },
      ],
    },
    {
      key: 'closure',
      title: 'Closure',
      blurb: 'The chosen outcome is recorded to the audit trail.',
      accent: 'border-accent-500',
      stages: [
        {
          n: 8,
          title: 'Closure or escalation is logged',
          body: 'The chosen outcome — closure, escalation, referral, ticket, or no violation — is recorded as a workflow event in the audit trail, giving every case a defensible, reviewable history.',
          tag: 'human',
          metric: { value: num(m.closedCount), label: 'closed to date' },
        },
      ],
    },
  ]
}

export default function WorkflowLifecycle(props: WorkflowLifecycleMetrics) {
  const phases = buildPhases(props)
  return (
    <div>
      {/* Flow strip: the four macro phases, left to right. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm font-medium text-navy-900">
        {phases.map((p, i) => (
          <span key={p.key} className="flex items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-navy-900/5 px-3 py-1">
              <span className={`h-2 w-2 rounded-full ${p.accent.replace('border-', 'bg-')}`} />
              {p.title}
            </span>
            {i < phases.length - 1 && (
              <span aria-hidden className="text-slate-300">
                →
              </span>
            )}
          </span>
        ))}
      </div>

      {/* Phase columns, each holding its numbered stages. */}
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {phases.map((p) => (
          <div key={p.key} className={`card border-t-2 ${p.accent} p-5`}>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${p.accent.replace('border-', 'bg-')}`} />
              <h3 className="text-sm font-semibold text-navy-900">{p.title}</h3>
            </div>
            <p className="mt-1 text-xs text-ink-subtle">{p.blurb}</p>

            <ol className="mt-4 space-y-4">
              {p.stages.map((s) => (
                <li key={s.n} className="flex gap-3">
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[11px] font-semibold tabular-nums text-white">
                    {String(s.n).padStart(2, '0')}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-navy-900">{s.title}</div>
                    <TagBadge tag={s.tag} />
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{s.body}</p>
                    {s.metric && (
                      <div className="mt-2 inline-flex items-baseline gap-1.5">
                        <span className="text-base font-semibold tabular-nums text-navy-900">{s.metric.value}</span>
                        <span className="text-[11px] text-ink-subtle">{s.metric.label}</span>
                      </div>
                    )}
                    {s.href && s.hrefLabel && (
                      <div className="mt-1.5">
                        <Link to={s.href} className="text-xs font-medium text-navy-700 hover:text-navy-900">
                          {s.hrefLabel} →
                        </Link>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>

      {/* Legend + reaffirmation that AI is on demand and the human always decides. */}
      <div className="mt-5 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(TAG_META) as AutomationTag[]).map((tag) => (
            <TagBadge key={tag} tag={tag} />
          ))}
        </div>
        <p className="text-[11px] leading-relaxed text-ink-subtle sm:max-w-md">
          AI assisted review is on demand only — it runs when a staff member clicks, never automatically. Authorized
          municipal staff review and decide every case.
        </p>
      </div>
    </div>
  )
}

function TagBadge({ tag }: { tag: AutomationTag }) {
  const meta = TAG_META[tag]
  return (
    <span
      className={`mt-1 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${meta.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  )
}
