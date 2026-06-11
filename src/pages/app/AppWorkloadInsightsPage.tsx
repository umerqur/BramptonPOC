import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { isSupabaseConfigured } from '../../lib/supabase'
import {
  getWorkloadInsightsV1,
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

/** Sort a row set by workload score descending (the live query already does this;
 *  the static fallback is pre-sorted, but we normalize defensively). */
function byScoreDesc(rows: WorkloadInsightRow[]): WorkloadInsightRow[] {
  return [...rows].sort((a, b) => b.workload_score - a.workload_score)
}

/**
 * Authenticated Workload Insights page. Reads v1 model outputs from Supabase
 * (public.workload_insights_v1) as the primary source, ordered by workload score.
 * Falls back to the bundled static artifact only when Supabase is unavailable or
 * returns no rows — and labels that clearly.
 */
export default function AppWorkloadInsightsPage() {
  const [rows, setRows] = useState<WorkloadInsightRow[]>([])
  const [source, setSource] = useState<Source>('fallback-unconfigured')
  const [loading, setLoading] = useState(true)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)

    // No Supabase configured: go straight to the labelled static fallback.
    if (!isSupabaseConfigured) {
      setRows(byScoreDesc(workloadV1FallbackRows))
      setSource('fallback-unconfigured')
      setLoading(false)
      return
    }

    getWorkloadInsightsV1()
      .then((data) => {
        if (!active) return
        if (data.length === 0) {
          // Supabase reachable but empty → fallback, labelled.
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
        Workload patterns, area context, and benchmark service request signals for the POC.
      </p>

      {/* 1. Area Context — the real Toronto ward/area coding visualization first. */}
      <section className="mt-8">
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

      {/* 2. Workload Insights — the existing benchmark analytics, below the map. */}
      <section className="mt-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-navy-900">Workload Insights (v1)</h2>
            <p className="mt-1 max-w-3xl text-sm text-ink-muted">
              Where complaint workload concentrates across Toronto forward-sortation areas, to support capacity
              planning. This is a supporting benchmark analytics view — the core POC remains complaint workflow
              acceleration and staff review. It is a benchmark model output for decision support, not Brampton
              operational data and not automated enforcement.
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
      published v1 model run.
      {detail && <span className="mt-1 block font-mono text-[11px] text-ink-subtle">{detail}</span>}
    </div>
  )
}
