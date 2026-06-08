import { useEffect, useState } from 'react'
import { isSupabaseConfigured } from '../../lib/supabase'
import {
  getWorkflowMlPredictionsV2,
  type WorkflowMlPrediction,
} from '../../services/municipalServiceRequests'

// Model-evaluation facts from reports/modeling/v2/metrics.json. These are static
// documentation of the trained result — the per-case predictions table below is
// read live from Supabase (public.workflow_ml_predictions).
const ROUTING_WITH_TYPE_MACRO_F1 = 0.997
const ROUTING_NO_TYPE_MACRO_F1 = 0.297
const STALE_TOP_OPEN_SHARE = 0.736 // top 10% by score
const STALE_BASE_RATE = 0.278
const STALE_LIFT = 2.6

const DISCLAIMER =
  'Toronto 311 benchmark data. Staff decision support only. Not Brampton operational data. Not automated enforcement.'

/**
 * Read-only V2 Workflow ML Results page. The per-case "Needs Attention" ranking is
 * read live from Supabase (public.workflow_ml_predictions, full scored benchmark).
 * Routing results are explained as research-only and are NOT wired into operational
 * case handling. Decision support only — not geographic prediction, not automated
 * enforcement.
 */
export default function AppV2MlResultsPage() {
  const [rows, setRows] = useState<WorkflowMlPrediction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pct = (n: number) => `${Math.round(n * 100)}%`

  useEffect(() => {
    let active = true
    if (!isSupabaseConfigured) {
      setError('Supabase is not configured in this environment.')
      setLoading(false)
      return
    }
    getWorkflowMlPredictionsV2(25)
      .then((data) => active && setRows(data))
      .catch((err: unknown) => active && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="container-page py-10">
      <div className="section-eyebrow">V2 ML Results</div>
      <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">
        V2 Workflow ML Results
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-ink-muted">
        Benchmark results for two workflow ML baselines trained on Toronto 311 data. The Needs Attention ranking is read
        live from Supabase; routing is shown for research context only and is not wired into operational case handling.
      </p>

      <div role="note" className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <span className="font-semibold">Decision support only:</span> {DISCLAIMER}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Card 1 — Routing classifier */}
        <section className="card p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-navy-900">Routing classifier</h2>
            <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-ink-muted">
              Research only — not wired
            </span>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            Suggests which department should handle a complaint. Trained two ways to test how much it relied on the
            existing <code>complaint_type</code> label.
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3">
            <MiniStat label="With complaint_type" value={ROUTING_WITH_TYPE_MACRO_F1.toFixed(3)} hint="macro F1" />
            <MiniStat label="Without complaint_type" value={ROUTING_NO_TYPE_MACRO_F1.toFixed(3)} hint="macro F1" />
          </dl>
          <p className="mt-4 text-[11px] leading-relaxed text-ink-subtle">
            With <code>complaint_type</code> the model performed almost perfectly; without it, performance dropped
            sharply — so it mostly learned a <code>complaint_type</code> → department lookup rather than independent
            signal. It would add little beyond information a case already carries, so it is{' '}
            <span className="font-medium">not wired into the case queue</span>. Its real value appears later on free-text
            intake where the type is not pre-assigned.
          </p>
        </section>

        {/* Card 2 — Needs Attention */}
        <section className="card p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-navy-900">Needs Attention model</h2>
            <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
              Better candidate
            </span>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            A model-assisted attention rank that helps surface which open cases may need staff attention first — a proxy
            on current handling state, not a deadline or time-to-close prediction.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <MiniStat label="Top-rank open share" value={pct(STALE_TOP_OPEN_SHARE)} hint="top 10% by score" />
            <MiniStat label="Base rate" value={pct(STALE_BASE_RATE)} hint="all cases" />
            <MiniStat label="Lift" value={`${STALE_LIFT}×`} hint="vs base rate" />
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-ink-subtle">
            Top-ranked cases were about <span className="font-medium">{pct(STALE_TOP_OPEN_SHARE)} open</span> versus a{' '}
            <span className="font-medium">{pct(STALE_BASE_RATE)} base rate</span> — roughly{' '}
            <span className="font-medium">{STALE_LIFT}× lift</span>. Use it as a{' '}
            <span className="font-medium">relative queue ranking (Higher / Medium / Lower), not a probability</span>.
          </p>
        </section>
      </div>

      {/* Live sample table from Supabase */}
      <section className="mt-6 card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-navy-900">Top Needs Attention cases</h2>
            <p className="text-xs text-ink-subtle">Read live from Supabase — model-assisted attention rank.</p>
          </div>
          <DataSourceBadge loading={loading} error={error} count={rows.length} />
        </div>

        {loading ? (
          <div className="flex min-h-[140px] items-center justify-center text-sm text-ink-subtle">
            Loading predictions…
          </div>
        ) : error ? (
          <div className="px-5 py-6 text-sm text-ink-muted">
            <div className="font-semibold text-navy-900">Predictions unavailable from Supabase.</div>
            <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-xs text-ink-subtle">{error}</pre>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-6 text-sm text-ink-subtle">No workflow ML predictions found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-ink-subtle">
                <tr className="text-left">
                  <Th>Case</Th>
                  <Th>Complaint type</Th>
                  <Th>Predicted dept (research)</Th>
                  <Th className="text-right">Routing conf.</Th>
                  <Th>Status</Th>
                  <Th>Attention</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={r.source_record_id ?? i} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-muted">{r.source_record_id ?? '—'}</td>
                    <td className="px-4 py-2.5 text-navy-900">{r.complaint_type ?? '—'}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{r.predicted_department ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                      {r.routing_confidence == null ? '—' : r.routing_confidence.toFixed(3)}
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">{r.status ?? '—'}</td>
                    <td className="px-4 py-2.5"><AttentionChip tier={r.attention_tier} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-ink-subtle">
          Attention is a relative tier (model-assisted attention rank), not an automated decision. Staff review required
          for every case. Predicted department is research-only and is not an operational routing recommendation.
        </p>
      </section>

      {/* Next production step */}
      <section className="mt-6 card p-5">
        <h2 className="text-sm font-semibold text-navy-900">Next production step</h2>
        <p className="mt-2 text-sm text-ink-muted">
          The Needs Attention rank can later be added to the Case Queue as a small{' '}
          <span className="font-medium">Higher / Medium / Lower</span> tier on open cases, complementing the existing
          rules-based aging surfacing — decision support, with staff review required.
        </p>
      </section>

      {/* Future V3 */}
      <section className="mt-6 card p-5">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
            Future
          </span>
          <h2 className="text-sm font-semibold text-navy-900">V3 assisted workflow</h2>
        </div>
        <p className="mt-2 text-sm text-ink-muted">
          Later, an assistant could read these attention ranks to decide which open cases to look at first, pull the case
          context, prepare a summary, suggest a next action, and draft staff-facing language — then{' '}
          <span className="font-medium">wait for human approval</span>. It would never auto-assign, auto-close, or
          auto-enforce; a staff member remains the decision-maker and every action is logged.
        </p>
      </section>
    </div>
  )
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-center">
      <div className="text-xl font-semibold text-navy-900 tabular-nums">{value}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className="text-[10px] text-ink-subtle">{hint}</div>
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${className}`}>
      {children}
    </th>
  )
}

function AttentionChip({ tier }: { tier: string | null }) {
  const t = tier ?? '—'
  const styles: Record<string, string> = {
    Higher: 'bg-amber-100 text-amber-800',
    Medium: 'bg-slate-100 text-slate-700',
    Lower: 'bg-slate-50 text-ink-subtle',
  }
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles[t] ?? 'bg-slate-50 text-ink-subtle'}`}>{t}</span>
}

function DataSourceBadge({ loading, error, count }: { loading: boolean; error: string | null; count: number }) {
  if (loading) {
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-ink-muted"><span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />Loading…</span>
  }
  if (error) {
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-800"><span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500" />Unavailable</span>
  }
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800"><span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />Live Supabase · {count} cases</span>
}
