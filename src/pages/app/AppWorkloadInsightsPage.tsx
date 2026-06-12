import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { isSupabaseConfigured } from '../../lib/supabase'
import {
  getStatisticalAttentionQueue,
  getStatisticalFeatureCorrelations,
  getWorkloadInsightsV1,
  type StatisticalCaseScore,
  type StatisticalFeatureCorrelation,
  type WorkloadInsightRow,
} from '../../services/municipalServiceRequests'
import { workloadV1FallbackRows } from '../../data/workloadV1'
import TorontoWardContextPanel from '../../components/app/TorontoWardContextPanel'
import WorkloadAdvisory from '../../components/insights/WorkloadAdvisory'
import KeyQuestions from '../../components/insights/KeyQuestions'
import WorkloadTierSummary from '../../components/insights/WorkloadTierSummary'
import TopFsaTable from '../../components/insights/TopFsaTable'
import ModelPerformance from '../../components/insights/ModelPerformance'
import FeatureImportance from '../../components/insights/FeatureImportance'
import V2Direction from '../../components/insights/V2Direction'

type Source = 'live' | 'fallback-empty' | 'fallback-error' | 'fallback-unconfigured'

// Combined Insights — a single staff Insights experience. The statistical
// attention queue (Review Attention Score) leads because it is now the main
// product signal: a transparent, classical statistical queue rank over the
// Toronto 311 public benchmark (case aging, repeat-location signals, area
// trends, type backlog, missing-context checks). It is NOT an ML model, NOT a
// probability, and NOT an automated decision — staff review every case. The
// workload / area heatmap context sits lower as supporting management analytics.

const QUEUE_DISCLAIMER =
  'Toronto 311 benchmark data. Transparent statistical scoring, decision support only. Not Brampton operational data. Not automated enforcement.'

const EXAMPLE_DRIVERS = [
  'Older than similar cases',
  'Repeat location signal',
  'Area volume above baseline',
  'Missing closure context',
]

/** Sort a row set by workload score descending (the live query already does this;
 *  the static fallback is pre-sorted, but we normalize defensively). */
function byScoreDesc(rows: WorkloadInsightRow[]): WorkloadInsightRow[] {
  return [...rows].sort((a, b) => b.workload_score - a.workload_score)
}

/**
 * Authenticated combined Insights page (/app/insights). Top section reads the
 * statistical attention queue from v_statistical_attention_queue (the main
 * product signal); the lower section reads the v1 workload-density outputs from
 * public.workload_insights_v1 with the bundled static artifact as a labelled
 * fallback. The former /app/statistical-insights route now redirects here.
 */
export default function AppWorkloadInsightsPage() {
  // Statistical attention queue (top section).
  const [queueRows, setQueueRows] = useState<StatisticalCaseScore[]>([])
  const [queueLoading, setQueueLoading] = useState(true)
  const [queueError, setQueueError] = useState<string | null>(null)
  const [correlations, setCorrelations] = useState<StatisticalFeatureCorrelation[]>([])
  const [correlationsAvailable, setCorrelationsAvailable] = useState(false)

  // Workload / area context (lower section).
  const [rows, setRows] = useState<WorkloadInsightRow[]>([])
  const [source, setSource] = useState<Source>('fallback-unconfigured')
  const [loading, setLoading] = useState(true)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)

    if (!isSupabaseConfigured) {
      setQueueError('Supabase is not configured in this environment.')
      setQueueLoading(false)
      setRows(byScoreDesc(workloadV1FallbackRows))
      setSource('fallback-unconfigured')
      setLoading(false)
      return
    }

    // Top section — statistical attention queue.
    getStatisticalAttentionQueue(25)
      .then((data) => active && setQueueRows(data))
      .catch((err: unknown) => active && setQueueError(err instanceof Error ? err.message : String(err)))
      .finally(() => active && setQueueLoading(false))

    // Correlations are explainability context — a failure here (e.g. table not
    // populated yet) should not break the page; we just show the placeholder.
    getStatisticalFeatureCorrelations(8)
      .then((data) => {
        if (!active) return
        setCorrelations(data)
        setCorrelationsAvailable(data.length > 0)
      })
      .catch(() => active && setCorrelationsAvailable(false))

    // Lower section — workload-density insights, with labelled static fallback.
    getWorkloadInsightsV1()
      .then((data) => {
        if (!active) return
        if (data.length === 0) {
          setRows(byScoreDesc(workloadV1FallbackRows))
          setSource('fallback-empty')
        } else {
          setRows(data)
          setSource('live')
        }
      })
      .catch((err: unknown) => {
        if (!active) return
        setRows(byScoreDesc(workloadV1FallbackRows))
        setSource('fallback-error')
        setErrorDetail(err instanceof Error ? err.message : String(err))
      })
      .finally(() => active && setLoading(false))

    return () => {
      active = false
    }
  }, [])

  return (
    <div className="container-page py-10">
      {/* Page header */}
      <div className="section-eyebrow">Insights</div>
      <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">Insights</h1>
      <p className="mt-2 max-w-3xl text-sm text-ink-muted">
        The statistical attention queue leads — which open complaint files may need staff review first — followed by
        workload and area context for capacity planning.
      </p>

      {/* ===================================================================== */}
      {/* TOP SECTION — Statistical Queue Insights (the main product signal).    */}
      {/* ===================================================================== */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight text-navy-900">Statistical Queue Insights</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Transparent statistical scoring over Toronto 311 benchmark data to help staff identify which complaint files
          may need review first.
        </p>

        <div role="note" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">Decision support only:</span> {QUEUE_DISCLAIMER}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {/* Card 1 — Review Attention Score */}
          <section className="card p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-navy-900">Review Attention Score</h3>
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
            <h3 className="text-sm font-semibold text-navy-900">Top drivers</h3>
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
            <h3 className="text-sm font-semibold text-navy-900">Correlation summary</h3>
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
              <h3 className="text-sm font-semibold text-navy-900">Top Review Attention cases</h3>
              <p className="text-xs text-ink-subtle">Read live from Supabase — statistical attention rank.</p>
            </div>
            <QueueBadge loading={queueLoading} error={queueError} count={queueRows.length} />
          </div>

          {queueLoading ? (
            <div className="flex min-h-[140px] items-center justify-center text-sm text-ink-subtle">
              Loading statistical scores…
            </div>
          ) : queueError ? (
            <div className="px-5 py-6 text-sm text-ink-muted">
              <div className="font-semibold text-navy-900">Statistical scores unavailable from Supabase.</div>
              <p className="mt-1.5 text-xs text-ink-subtle">
                The <code>v_statistical_attention_queue</code> view returned no data. Generate scores with{' '}
                <code>scripts/build_statistical_attention_scores.py</code>, then reload.
              </p>
              <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-xs text-ink-subtle">{queueError}</pre>
            </div>
          ) : queueRows.length === 0 ? (
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
                    <Th>Benchmark area</Th>
                    <Th>Top drivers</Th>
                    <Th>Action</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {queueRows.map((r, i) => {
                    const caseId = r.source_record_id ?? r.case_id ?? null
                    return (
                      <tr key={caseId ?? i} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5"><AttentionChip tier={r.attention_tier} /></td>
                        <td className="px-4 py-2.5 font-mono text-xs text-ink-muted whitespace-nowrap">
                          {caseId ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-navy-900">{r.complaint_type ?? '—'}</td>
                        <td className="px-4 py-2.5 text-ink-muted">{r.status ?? '—'}</td>
                        <td className="px-4 py-2.5 text-ink-muted">{r.ward_or_area ?? '—'}</td>
                        <td className="px-4 py-2.5 text-ink-subtle">{driverText(r)}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <Link
                            to={
                              caseId
                                ? `/app/closure-review?case=${encodeURIComponent(caseId)}`
                                : '/app/closure-review'
                            }
                            className="inline-flex items-center gap-1 text-xs font-semibold text-accent-600 hover:text-accent-700"
                          >
                            Review case
                            <span aria-hidden>→</span>
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-ink-subtle">
            Attention is a relative statistical tier, not an automated decision. Staff review is required for every case.
            {queueRows.length > 0 && (
              <> Source: <code>v_statistical_attention_queue</code> · score version{' '}
                <span className="font-mono">{scoreVersionNote(queueRows)}</span>.</>
            )}
          </p>
        </section>
      </section>

      {/* ===================================================================== */}
      {/* LOWER SECTION — Workload / area context (supporting analytics).        */}
      {/* ===================================================================== */}

      {/* Area Context — the real Toronto ward/area coding visualization. */}
      <section className="mt-12 border-t border-slate-200 pt-10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-navy-900">Area Context</h2>
          <Link
            to="/app/wards"
            className="inline-flex items-center gap-1 text-sm font-semibold text-accent-600 hover:text-accent-700"
          >
            Open full ward context
            <span aria-hidden>→</span>
          </Link>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-ink-subtle">
          Benchmark context only. Brampton operational data can replace this layer during the POC.
        </p>

        {/* Reused real ward/area map. Compact embed: the secondary geometry and
            Brampton future-context layers stay on the full /app/wards page. */}
        <TorontoWardContextPanel showValidationLayers={false} />
      </section>

      {/* Workload Insights — the existing benchmark analytics, below the map. */}
      <section className="mt-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-navy-900">Workload Insights (v1)</h2>
            <p className="mt-1 max-w-3xl text-sm text-ink-muted">
              Where complaint workload concentrates across Toronto forward-sortation areas, to support capacity
              planning. This is a supporting benchmark analytics view — the core POC remains complaint workflow
              acceleration and staff review. It is a benchmark workload-density signal for decision support, not
              Brampton operational data and not automated enforcement.
            </p>
          </div>
          <DataSourceBadge source={source} loading={loading} count={rows.length} />
        </div>

        <div className="mt-6 space-y-6">
          <WorkloadAdvisory />

          {source !== 'live' && !loading && <FallbackNotice source={source} detail={errorDetail} />}

          <KeyQuestions />

          {loading ? (
            <div className="card flex min-h-[160px] items-center justify-center text-sm text-ink-subtle">
              Loading workload insights…
            </div>
          ) : (
            <>
              <WorkloadTierSummary rows={rows} />
              <TopFsaTable rows={rows} />
              <div className="grid gap-6 lg:grid-cols-2">
                <ModelPerformance />
                <FeatureImportance />
              </div>
              <V2Direction />
            </>
          )}
        </div>
      </section>
    </div>
  )
}

/** Plain-text join of a case's top statistical drivers (no pill tags). */
function driverText(r: StatisticalCaseScore): string {
  const drivers = [r.top_driver_1, r.top_driver_2, r.top_driver_3].filter((d): d is string => Boolean(d))
  return drivers.length > 0 ? drivers.join(' · ') : '—'
}

/** Score version / provenance, surfaced as a small footer note rather than a column. */
function scoreVersionNote(rows: StatisticalCaseScore[]): string {
  const versions = Array.from(new Set(rows.map((r) => r.score_version).filter((v): v is string => Boolean(v))))
  return versions.length > 0 ? versions.join(', ') : '—'
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

/** Live/loading/error badge for the statistical attention queue table. */
function QueueBadge({ loading, error, count }: { loading: boolean; error: string | null; count: number }) {
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

/** Small badge showing whether the table is live Supabase data or local fallback. */
function DataSourceBadge({ source, loading, count }: { source: Source; loading: boolean; count: number }) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-ink-muted">
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />
        Loading…
      </span>
    )
  }
  if (source === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Live Supabase · {count} areas
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-ink-muted">
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />
      Local fallback · {count} areas
    </span>
  )
}

/** Explains why the static fallback is being shown instead of live data. */
function FallbackNotice({ source, detail }: { source: Source; detail: string | null }) {
  const reason =
    source === 'fallback-unconfigured'
      ? 'Supabase is not configured in this environment, so bundled local data is shown.'
      : source === 'fallback-empty'
        ? 'Supabase returned no workload rows, so bundled local data is shown.'
        : 'Supabase could not be reached, so bundled local data is shown.'
  return (
    <div role="note" className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-ink-muted">
      <span className="font-semibold text-navy-900">Local fallback data.</span> {reason} The figures mirror the last
      published v1 workload run.
      {detail && <span className="mt-1 block font-mono text-[11px] text-ink-subtle">{detail}</span>}
    </div>
  )
}
