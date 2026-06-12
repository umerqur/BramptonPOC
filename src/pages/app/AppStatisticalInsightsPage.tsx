import { useEffect, useState } from 'react'
import { isSupabaseConfigured } from '../../lib/supabase'
import {
  getStatisticalAttentionQueue,
  getStatisticalFeatureCorrelations,
  type StatisticalCaseScore,
  type StatisticalFeatureCorrelation,
} from '../../services/municipalServiceRequests'

// Statistical Queue Insights — a transparent, classical statistical scoring
// layer over the Toronto 311 public benchmark. The hero output is the Review
// Attention Score: a relative queue rank (Higher / Medium / Lower) built from
// case aging, repeat-location signals, area trends, type backlog, and
// missing-context checks. It is NOT an ML model, NOT a probability, and NOT an
// automated decision — staff review every case.

const DISCLAIMER =
  'Toronto 311 benchmark data. Transparent statistical scoring, decision support only. Not Brampton operational data. Not automated enforcement.'

const EXAMPLE_DRIVERS = [
  'Older than similar cases',
  'Repeat location signal',
  'Area volume above baseline',
  'Missing closure context',
]

export default function AppStatisticalInsightsPage() {
  const [rows, setRows] = useState<StatisticalCaseScore[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [correlations, setCorrelations] = useState<StatisticalFeatureCorrelation[]>([])
  const [correlationsAvailable, setCorrelationsAvailable] = useState(false)

  useEffect(() => {
    let active = true
    if (!isSupabaseConfigured) {
      setError('Supabase is not configured in this environment.')
      setLoading(false)
      return
    }
    getStatisticalAttentionQueue(25)
      .then((data) => active && setRows(data))
      .catch((err: unknown) => active && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => active && setLoading(false))

    // Correlations are explainability context — a failure here (e.g. table not
    // populated yet) should not break the page; we just show the placeholder.
    getStatisticalFeatureCorrelations(8)
      .then((data) => {
        if (!active) return
        setCorrelations(data)
        setCorrelationsAvailable(data.length > 0)
      })
      .catch(() => active && setCorrelationsAvailable(false))

    return () => {
      active = false
    }
  }, [])

  return (
    <div className="container-page py-10">
      <div className="section-eyebrow">Statistical Queue Insights</div>
      <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">
        Statistical Queue Insights
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-ink-muted">
        Transparent statistical scoring over Toronto 311 benchmark data to help staff identify which complaint files may
        need review first.
      </p>

      <div role="note" className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <span className="font-semibold">Decision support only:</span> {DISCLAIMER}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Card 1 — Review Attention Score */}
        <section className="card p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-navy-900">Review Attention Score</h2>
            <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
              Primary signal
            </span>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            A transparent statistical queue rank that surfaces which open complaint files may need staff review first.
            It is a relative tier — <span className="font-medium text-navy-900">Higher / Medium / Lower</span> — not a
            probability and not a prediction of any enforcement outcome.
          </p>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-subtle">
            Built from classical statistics: case aging z-scores, repeat-location counts, area-volume trends, complaint
            type backlog percentiles, and missing-context checks. Every driver is explainable.
          </p>
        </section>

        {/* Card 2 — Top drivers */}
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-navy-900">Top drivers</h2>
          <p className="mt-2 text-xs text-ink-muted">
            Each ranked case shows the statistical reasons it surfaced. Common drivers include:
          </p>
          <ul className="mt-3 space-y-1.5">
            {EXAMPLE_DRIVERS.map((d) => (
              <li key={d} className="flex items-start gap-2 text-xs text-ink">
                <span aria-hidden className="mt-1 inline-block h-1.5 w-1.5 flex-none rounded-full bg-navy-400" />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Card 3 — Correlation summary */}
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-navy-900">Correlation summary</h2>
          {correlationsAvailable ? (
            <dl className="mt-3 space-y-2">
              {correlations.map((c) => (
                <div key={`${c.feature_name}-${c.target_name}`} className="flex items-center justify-between gap-2">
                  <dt className="truncate text-xs text-ink-muted" title={c.feature_name}>
                    {c.feature_name}
                  </dt>
                  <dd className="tabular-nums text-xs font-semibold text-navy-900">
                    {c.correlation_coefficient == null ? '—' : c.correlation_coefficient.toFixed(2)}
                  </dd>
                </div>
              ))}
              <p className="pt-1 text-[11px] text-ink-subtle">
                Correlation of each feature with the aging / closure-burden target.
              </p>
            </dl>
          ) : (
            <p className="mt-3 text-xs text-ink-subtle">Correlation table not populated yet.</p>
          )}
        </section>
      </div>

      {/* Top Review Attention cases */}
      <section className="mt-6 card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-navy-900">Top Review Attention cases</h2>
            <p className="text-xs text-ink-subtle">Read live from Supabase — statistical attention rank.</p>
          </div>
          <DataSourceBadge loading={loading} error={error} count={rows.length} />
        </div>

        {loading ? (
          <div className="flex min-h-[140px] items-center justify-center text-sm text-ink-subtle">
            Loading statistical scores…
          </div>
        ) : error ? (
          <div className="px-5 py-6 text-sm text-ink-muted">
            <div className="font-semibold text-navy-900">Statistical scores unavailable from Supabase.</div>
            <p className="mt-1.5 text-xs text-ink-subtle">
              The <code>v_statistical_attention_queue</code> view returned no data. Generate scores with{' '}
              <code>scripts/build_statistical_attention_scores.py</code>, then reload.
            </p>
            <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-xs text-ink-subtle">{error}</pre>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-6 text-sm text-ink-subtle">
            No statistical attention scores found yet. Run{' '}
            <code>scripts/build_statistical_attention_scores.py</code> to populate the queue.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-ink-subtle">
                <tr className="text-left">
                  <Th>Attention</Th>
                  <Th>Case</Th>
                  <Th>Complaint type</Th>
                  <Th>Status</Th>
                  <Th>Area</Th>
                  <Th>Top drivers</Th>
                  <Th>Score version</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={r.source_record_id ?? i} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5"><AttentionChip tier={r.attention_tier} /></td>
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-muted">
                      {r.source_record_id ?? r.case_id ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-navy-900">{r.complaint_type ?? '—'}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{r.status ?? '—'}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{r.ward_or_area ?? '—'}</td>
                    <td className="px-4 py-2.5 text-ink-subtle">{driverText(r)}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-ink-subtle">{r.score_version ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-ink-subtle">
          Attention is a relative statistical tier, not an automated decision. Staff review is required for every case.
        </p>
      </section>
    </div>
  )
}

function driverText(r: StatisticalCaseScore): string {
  const drivers = [r.top_driver_1, r.top_driver_2, r.top_driver_3].filter((d): d is string => Boolean(d))
  return drivers.length > 0 ? drivers.join(' · ') : '—'
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
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles[t] ?? 'bg-slate-50 text-ink-subtle'}`}>
      {t}
    </span>
  )
}

function DataSourceBadge({ loading, error, count }: { loading: boolean; error: string | null; count: number }) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-ink-muted">
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />
        Loading…
      </span>
    )
  }
  if (error) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-800">
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500" />
        Unavailable
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Live Supabase · {count} cases
    </span>
  )
}
