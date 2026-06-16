import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { isSupabaseConfigured } from '../../lib/supabase'
import {
  getStatisticalAttentionQueue,
  type StatisticalCaseScore,
} from '../../services/municipalServiceRequests'
import TorontoWardContextPanel from '../../components/app/TorontoWardContextPanel'

// Insights — a single, focused staff Insights experience built entirely around
// the statistical attention queue (Review Attention Score): a transparent,
// classical statistical queue rank over the NYC 311 public benchmark (case
// aging, repeat-location signals, area trends, type backlog, missing-context
// checks). It is NOT an ML model, NOT a probability, and NOT an automated
// decision — staff review every case. The older workload-density analytics
// section has been removed from the active staff workflow.

const QUEUE_DISCLAIMER =
  'NYC 311 benchmark data. Transparent statistical scoring, decision support only. Not Brampton operational data. Not automated enforcement.'

const EXAMPLE_DRIVERS = [
  'Older than similar cases',
  'Repeat location signal',
  'Area volume above baseline',
  'Missing closure context',
]

/**
 * Authenticated Insights page (/app/insights). Reads the statistical attention
 * queue from v_statistical_attention_queue (the main product signal) and
 * surfaces the Review Attention Score explanation and the top-ranked cases for
 * staff review. The former /app/statistical-insights route redirects here.
 */
export default function AppWorkloadInsightsPage() {
  const [queueRows, setQueueRows] = useState<StatisticalCaseScore[]>([])
  const [queueLoading, setQueueLoading] = useState(true)
  const [queueError, setQueueError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    if (!isSupabaseConfigured) {
      setQueueError('Supabase is not configured in this environment.')
      setQueueLoading(false)
      return
    }

    getStatisticalAttentionQueue(25)
      .then((data) => active && setQueueRows(data))
      .catch((err: unknown) => active && setQueueError(err instanceof Error ? err.message : String(err)))
      .finally(() => active && setQueueLoading(false))

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
        Review attention signals for staff workload planning and case review.
      </p>

      {/* Statistical Queue Insights — the only product signal on this page. */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight text-navy-900">Statistical Queue Insights</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Transparent statistical scoring over NYC 311 benchmark data to help staff identify which complaint files
          may need review first.
        </p>

        <div role="note" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">Decision support only:</span> {QUEUE_DISCLAIMER}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {/* Card 1 — Review Attention Score explanation */}
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
              probability and not a forecast of any enforcement outcome.
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

        <p className="mt-4 max-w-3xl text-[11px] leading-relaxed text-ink-subtle">
          NYC 311 benchmark data is used for decision support only — it is not Brampton operational data.
        </p>
      </section>

      {/* Area Context — a compact map/area visual aid below the Review Attention
          queue. Supporting context only, never the main product signal. Reuses
          the shared borough/area panel in its compact form. */}
      <section className="mt-12 border-t border-slate-200 pt-10">
        <h2 className="text-lg font-semibold tracking-tight text-navy-900">Area Context</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Benchmark area context for understanding where complaint activity appears in the source data.
        </p>
        <div role="note" className="mt-3 max-w-3xl text-[11px] leading-relaxed text-ink-subtle">
          NYC 311 benchmark geography only. Not Brampton operational hotspot data.
        </div>

        <div className="mt-5">
          <TorontoWardContextPanel showValidationLayers={false} />
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
