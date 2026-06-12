import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { isSupabaseConfigured } from '../../lib/supabase'
import { getStatisticalAttentionQueue } from '../../services/municipalServiceRequests'
import { getResidentRequests } from '../../services/residentRequests'

// Staff Workbench Home — the first screen authenticated staff land on after sign
// in. It answers one question: what needs attention right now? Three summary
// cards read the two active data sources (resident_service_requests and the
// v_statistical_attention_queue view), then a clear path into Closure Review.
// Counts are best-effort live reads; if they fail or Supabase is not configured,
// the cards fall back to their static labels and links.

type CountState = { value: number | null; loading: boolean }

/** Count of resident demo requests still in an active (not closed) status. */
function isActiveResidentStatus(status: string): boolean {
  return status !== 'closed'
}

export default function AppStaffHomePage() {
  const [residentCount, setResidentCount] = useState<CountState>({ value: null, loading: true })
  const [higherCount, setHigherCount] = useState<CountState>({ value: null, loading: true })

  useEffect(() => {
    let active = true
    if (!isSupabaseConfigured) {
      setResidentCount({ value: null, loading: false })
      setHigherCount({ value: null, loading: false })
      return
    }

    // Active resident requests (submitted / not yet closed).
    getResidentRequests(200)
      .then((rows) => {
        if (!active) return
        setResidentCount({ value: rows.filter((r) => isActiveResidentStatus(r.status)).length, loading: false })
      })
      .catch(() => active && setResidentCount({ value: null, loading: false }))

    // Higher attention rows from the statistical queue.
    getStatisticalAttentionQueue(200)
      .then((rows) => {
        if (!active) return
        const higher = rows.filter((r) => (r.attention_tier ?? '').toLowerCase().includes('high')).length
        setHigherCount({ value: higher, loading: false })
      })
      .catch(() => active && setHigherCount({ value: null, loading: false }))

    return () => {
      active = false
    }
  }, [])

  return (
    <div className="container-page py-12">
      <div className="max-w-3xl">
        <div className="section-eyebrow">Staff workbench</div>
        <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">
          What needs attention right now?
        </h1>
        <p className="mt-3 text-ink-muted">
          Start with resident intake, prioritize the higher attention cases, and use Closure Review to prepare a staff
          approved response.
        </p>
      </div>

      {/* Three summary cards over the two active data sources. */}
      <div className="mt-10 grid gap-6 md:grid-cols-3">
        <SummaryCard
          title="Resident requests"
          count={residentCount}
          countLabel="active demo requests"
          body="Demo complaints submitted by residents and waiting for staff intake."
          cta="Open Intake"
          to="/app/resident-intake"
        />
        <SummaryCard
          title="Higher attention cases"
          count={higherCount}
          countLabel="higher attention"
          tone="amber"
          body="Cases the statistical attention queue ranks as Higher for staff review first."
          cta="Open Closure Review"
          to="/app/closure-review"
        />
        <WorkflowCard />
      </div>

      {/* Primary path into the workbench. */}
      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Link to="/app/closure-review" className="btn-primary">
          Open Closure Review
        </Link>
        <Link to="/app/resident-intake" className="btn-secondary">
          Review Intake
        </Link>
      </div>

      <p className="mt-8 text-xs text-ink-subtle">
        Decision support only — not automated enforcement. Staff approve every enforcement decision and resident
        communication.
      </p>
    </div>
  )
}

function SummaryCard({
  title,
  count,
  countLabel,
  body,
  cta,
  to,
  tone = 'default',
}: {
  title: string
  count: CountState
  countLabel: string
  body: string
  cta: string
  to: string
  tone?: 'default' | 'amber'
}) {
  const valueColor = tone === 'amber' ? 'text-amber-800' : 'text-navy-900'
  return (
    <div className="card flex flex-col p-6">
      <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
      <div className="mt-3 min-h-[2.5rem]">
        {count.loading ? (
          <div className="text-sm text-ink-subtle">Loading…</div>
        ) : count.value == null ? (
          <div className="text-sm text-ink-subtle">{countLabel}</div>
        ) : (
          <div className="flex items-baseline gap-2">
            <span className={`text-3xl font-semibold tabular-nums ${valueColor}`}>{count.value}</span>
            <span className="text-xs text-ink-subtle">{countLabel}</span>
          </div>
        )}
      </div>
      <p className="mt-2 flex-1 text-sm text-ink-muted">{body}</p>
      <div className="mt-5">
        <Link to={to} className="text-sm font-semibold text-accent-600 hover:text-accent-700">
          {cta} <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  )
}

const WORKFLOW_STEPS = ['Intake', 'Insights', 'Closure Review', 'Staff-approved response']

function WorkflowCard() {
  return (
    <div className="card flex flex-col p-6">
      <h2 className="text-sm font-semibold text-navy-900">Staff workflow</h2>
      <ol className="mt-4 flex-1 space-y-2">
        {WORKFLOW_STEPS.map((step, i) => (
          <li key={step} className="flex items-center gap-2 text-sm text-ink-muted">
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-ink-muted">
              {i + 1}
            </span>
            <span className="text-navy-900">{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-xs text-ink-subtle">The active staff path from resident intake to a staff approved response.</p>
    </div>
  )
}
