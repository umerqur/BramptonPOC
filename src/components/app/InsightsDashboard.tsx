import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import NYCWorkloadMapPanel, { type AreaUnit } from './NYCWorkloadMapPanel'
import type { AreaMetricValue, MapMetric } from './mapMetrics'
import {
  getNYCCouncilDistrictBoundariesCached,
  type NYCCouncilDistrictBoundary,
} from '../../services/municipalServiceRequests'

// The 3D pressure map (deck.gl) is heavy — lazy-load it like NYCWorkloadMapPanel does.
const SimulationPressureDeck = lazy(() => import('./NYCWorkload3DDeck'))
import {
  getInsightsKpis,
  getInsightsComplaintTypeVolume,
  getInsightsClosureBottlenecks,
  getInsightsAreaBottlenecks,
  getInsightsDepartmentWorkload,
  getInsightsMonthlyTrend,
  getInsightsChannelMix,
  getInsightsClosureDurationDistribution,
  getInsightsSourceMeta,
  isChannelMixMeaningful,
  formatPlainDate,
  type InsightsSourceMeta,
  type InsightsKpis,
  type ComplaintTypeVolume,
  type ClosureBottleneck,
  type AreaBottleneck,
  type InsightsDepartmentWorkload,
  type MonthlyTrendPoint,
  type ChannelMixRow,
  type ClosureDurationBucket,
} from '../../services/insightsDashboard'
import {
  getNycCaseExplorerPage,
  getCaseExplorerOptions,
  getNycOpenQueuePage,
  getNycOpenQueueDiversified,
  getNycOpenAgingBuckets,
  getNycOpenStatusMix,
  getNycOpenQueueSummary,
  getOpenQueueOptions,
  closureDurationDays,
  type CaseExplorerFilters,
  type NycCaseRow,
  type CaseExplorerOptions,
  type OpenReviewRow,
  type OpenQueueFilters,
  type OpenQueueOptions,
  type OpenAgingBucket,
  type OpenStatusMixRow,
  type OpenQueueSummary,
} from '../../services/caseExplorer'
import {
  getCtganScenarioOptions,
  getCtganDailyByScenario,
  getCtganDistrictPressureByScenario,
  getCtganComplaintTypePressureByScenario,
  type CtganScenarioOption,
  type CtganDailyRow,
  type CtganDistrictScenarioRow,
  type CtganComplaintScenarioRow,
} from '../../services/ctganAbmStress'
import {
  scoreDistricts,
  recommendMitigation,
  CHANNEL_LABELS,
  OPERATIONAL_PRESSURE_WEIGHTS,
  OPERATIONAL_PRESSURE_FORMULA,
  OPERATIONAL_PRESSURE_MODEL_NAME,
  OPERATIONAL_PRESSURE_WATCH_THRESHOLD,
  OPERATIONAL_PRESSURE_RED_THRESHOLD,
  type PressureChannels,
  type PressureZone,
} from '../../services/municipalPressureModel'

// Insights — operational workload intelligence over a public 311 benchmark
// service-request dataset. Tabs: Overview (map, KPIs, charts), Case Explorer
// (paginated, filtered case search + detail), Open cases (review priority queue,
// when the open dataset is loaded), and Stress Testing (the CTGAN + ABM planning
// simulation framework). Every aggregate reads a small materialized view; the
// Case Explorer reads paginated, filtered rows — never the full table. No fake
// placeholder values: a failed live read shows a clear state, never invented data.

type Tab = 'overview' | 'explorer' | 'open' | 'simulations'

// ---------------------------------------------------------------------------
// Live-data hook (aggregates) — on failure expose a dev-friendly error.
// ---------------------------------------------------------------------------

type LiveState<T> = { data: T | null; loading: boolean; error: string | null }

function errorMessage(err: unknown): string {
  if (err == null) return 'Unknown error'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>
    const parts = [e.message, e.details, e.hint, e.code].filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    )
    if (parts.length > 0) return parts.join(' — ')
  }
  return String(err)
}

function useLive<T>(load: () => Promise<T>): LiveState<T> {
  const [state, setState] = useState<LiveState<T>>({ data: null, loading: true, error: null })
  useEffect(() => {
    let active = true
    setState({ data: null, loading: true, error: null })
    load()
      .then((d) => active && setState({ data: d, loading: false, error: null }))
      .catch((err: unknown) => {
        console.error('Insights live aggregate failed:', err)
        if (active) setState({ data: null, loading: false, error: errorMessage(err) })
      })
    return () => {
      active = false
    }
    // load is a stable module-level function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return state
}

// ---------------------------------------------------------------------------
// Formatting + palette
// ---------------------------------------------------------------------------

const fmtInt = (n: number) => n.toLocaleString()
const fmtDays = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)} d`)
const fmtDate = (v: string | null) => formatPlainDate(v) ?? '—'

/**
 * Share as a percentage that never rounds a real, non-zero value down to "0%".
 * A category with a handful of cases out of millions shows "<1%", not "0%".
 */
const fmtPct = (value: number, total: number): string => {
  if (total <= 0 || value <= 0) return '0%'
  const pct = (value / total) * 100
  if (pct < 1) return '<1%'
  return `${pct.toFixed(pct < 10 ? 1 : 0)}%`
}

// --- Closure pressure classification (shared by leaderboard + scatter) -------
//
// Deterministic, explainable thresholds on historical closure times. Not a
// prediction — just a plain-language label for how long closures take.
type Pressure = 'normal' | 'watch' | 'critical'

function closurePressure(p90: number | null, avg: number | null): Pressure {
  const p = p90 ?? 0
  const a = avg ?? 0
  if (p >= 120 || a >= 60) return 'critical'
  if (p >= 45 || a >= 30) return 'watch'
  return 'normal'
}

const PRESSURE_META: Record<Pressure, { label: string; badge: string; bar: string; dot: string }> = {
  normal: { label: 'Normal', badge: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200', bar: 'bg-emerald-400', dot: '#10b981' },
  watch: { label: 'Watch', badge: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200', bar: 'bg-amber-400', dot: '#f59e0b' },
  critical: { label: 'Critical', badge: 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200', bar: 'bg-rose-500', dot: '#ef4444' },
}

/** A labelled horizontal bar (volume / duration) for the closure leaderboard. */
function MetricBar({ label, pct, barClass, valueText }: { label: string; pct: number; barClass: string; valueText: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-[10px] uppercase tracking-wider text-ink-subtle">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right text-[10px] tabular-nums text-ink-subtle">{valueText}</span>
    </div>
  )
}

const PALETTE = ['#2563eb', '#0ea5e9', '#7c3aed', '#f59e0b', '#10b981', '#94a3b8']

// ---------------------------------------------------------------------------
// Data source banner — states the real source with live record count + range.
// ---------------------------------------------------------------------------

export function InsightsSourceBanner() {
  const { data, loading, error } = useLive<InsightsSourceMeta>(getInsightsSourceMeta)
  const earliest = formatPlainDate(data?.earliest ?? null)
  const latest = formatPlainDate(data?.latest ?? null)
  const range = earliest && latest ? `${earliest} to ${latest}` : error ? 'Unavailable' : '—'
  const records = error ? 'Unavailable' : data ? data.record_count.toLocaleString() : '—'
  const status = error ? 'Live data unavailable' : loading ? 'Connecting…' : 'Connected to live data'

  return (
    <section className="mt-6 rounded-xl border border-sky-200 bg-sky-50/60 p-4">
      <div className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
        <SourceLine label="Data source" value="Public 311 benchmark service requests" />
        <SourceLine label="Records loaded" value={records} />
        <SourceLine label="Date range" value={range} />
        <SourceLine label="Status" value={status} emphasis={error ? 'error' : 'ok'} />
      </div>
      {error && <p className="mt-3 font-mono text-[11px] text-amber-800">Data connection error: {error}</p>}
    </section>
  )
}

function SourceLine({ label, value, emphasis }: { label: string; value: string; emphasis?: 'ok' | 'error' }) {
  const valueClass = emphasis === 'error' ? 'text-amber-800' : emphasis === 'ok' ? 'text-emerald-700' : 'text-navy-900'
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-900/70">{label}:</span>
      <span className={`text-sm ${valueClass}`}>{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard shell + tabs
// ---------------------------------------------------------------------------

const VALID_TABS: Tab[] = ['overview', 'explorer', 'open', 'simulations']

export default function InsightsDashboard() {
  // The top nav links Stress-Testing to /app/insights?tab=simulations, so honor a
  // `tab` query param (validated against the known tabs) and keep it in sync if
  // the user navigates to a tab URL while already on the page.
  const [searchParams] = useSearchParams()
  const paramTab = searchParams.get('tab')
  const [tab, setTab] = useState<Tab>(() =>
    VALID_TABS.includes(paramTab as Tab) ? (paramTab as Tab) : 'overview',
  )
  const [filters, setFilters] = useState<CaseExplorerFilters>({})

  useEffect(() => {
    if (paramTab && VALID_TABS.includes(paramTab as Tab)) setTab(paramTab as Tab)
  }, [paramTab])

  // Drill into the Case Explorer from any chart segment.
  const explore = (f: CaseExplorerFilters) => {
    setFilters(f)
    setTab('explorer')
  }

  return (
    <div className="mt-6">
      <div
        role="tablist"
        aria-label="Insights sections"
        className="-mx-1 grid grid-cols-2 gap-2 px-1 pb-1 sm:flex sm:gap-2 sm:overflow-x-auto"
      >
        {INSIGHTS_TABS.map((t) => (
          <InsightsTabCard key={t.id} tab={t} active={tab === t.id} onClick={() => setTab(t.id)} />
        ))}
      </div>

      {tab === 'overview' && <Overview onExplore={explore} />}
      {tab === 'explorer' && <CaseExplorer filters={filters} onFiltersChange={setFilters} />}
      {tab === 'open' && <OpenCasesQueue />}
      {tab === 'simulations' && <SimulationLab />}
    </div>
  )
}

type InsightsTab = { id: Tab; title: string; subtitle: string; icon: React.ReactNode }

// Three distinct modes of the Insights workspace: aggregate intelligence,
// historical drilldown, and the active review queue.
const INSIGHTS_TABS: InsightsTab[] = [
  {
    id: 'overview',
    title: 'Overview',
    subtitle: 'Workload trends and map',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        <path d="M3 3v18h18" />
        <path d="M7 14l3-3 3 3 4-5" />
      </svg>
    ),
  },
  {
    id: 'explorer',
    title: 'Case Explorer',
    subtitle: 'Search historical cases',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
    ),
  },
  {
    id: 'open',
    title: 'Open Cases',
    subtitle: 'Active review queue',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        <path d="M4 13h4l2 3h4l2-3h4" />
        <path d="M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2Z" />
      </svg>
    ),
  },
  {
    id: 'simulations',
    title: 'Simulation Lab',
    subtitle: 'Backlog clearance under staffing assumptions',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        <path d="M3 3v18h18" />
        <path d="M7 16l3-4 3 2 4-6" />
        <path d="M17 8h2v2" />
      </svg>
    ),
  },
]

/** Soft segmented tab-card: title + helper subtitle + icon, with a clear active state. */
function InsightsTabCard({ tab, active, onClick }: { tab: InsightsTab; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`group relative flex min-w-0 flex-1 items-start gap-2.5 overflow-hidden rounded-xl border px-3.5 py-2.5 text-left transition sm:min-w-[168px] ${
        active
          ? 'border-accent-300 bg-white shadow-sm ring-1 ring-accent-200'
          : 'border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-slate-100'
      }`}
    >
      {/* Accent top border marks the active mode. */}
      {active && <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-accent-500" />}
      <span className={`mt-0.5 shrink-0 ${active ? 'text-accent-600' : 'text-ink-subtle group-hover:text-navy-900'}`}>
        {tab.icon}
      </span>
      <span className="min-w-0">
        {/* Title stays fully visible (no truncation); subtitle may truncate. */}
        <span className={`block text-sm font-semibold ${active ? 'text-navy-900' : 'text-ink-muted group-hover:text-navy-900'}`}>
          {tab.title}
        </span>
        <span className="block truncate text-[11px] text-ink-subtle">{tab.subtitle}</span>
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function Overview({ onExplore }: { onExplore: (f: CaseExplorerFilters) => void }) {
  return (
    <div className="mt-6 space-y-6">
      <OperationalSnapshot />
      {/* Geographic heat map of service-request workload. */}
      <NYCWorkloadMapPanel />
      <ComplaintTypeRanked onExplore={onExplore} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ChannelMixDonut />
        <OpenStatusMixDonut />
      </div>
      <TrendSection onExplore={onExplore} />
      <ClosureDurationDistribution />
      <ClosureScatter onExplore={onExplore} />
      <ClosureBottlenecks onExplore={onExplore} />
      {/* District workload pressure (leaderboard) needs full width so the bars
          and closure timing stay readable; department workload share is
          supporting context below it. Stacked full-width on desktop and mobile. */}
      <AreaBottlenecks onExplore={onExplore} />
      <DepartmentWorkload onExplore={onExplore} />
    </div>
  )
}
// --- Operational snapshot --------------------------------------------------

/**
 * Operational snapshot — six KPI cards that summarize the analytics shown below.
 * Grounded only in aggregate services (no synthetic workflow-store figures): the
 * open review queue (v_nyc_open_review_queue) and the closed NYC 311 benchmark
 * (v_insights_kpis, v_insights_closure_bottlenecks). Every value is NYC 311
 * BENCHMARK data, not a live Brampton operational backlog.
 */
function OperationalSnapshot() {
  const hist = useLive<InsightsKpis>(getInsightsKpis)
  const open = useLive<OpenQueueSummary>(getNycOpenQueueSummary)
  // Closure bottlenecks power the "Longest closure pressure" KPI. Loaded
  // independently so a bottleneck-view failure never breaks the snapshot.
  const bottle = useLive<ClosureBottleneck[]>(() => getInsightsClosureBottlenecks(40))

  const k = hist.data

  // Each value cell degrades to "…" while loading and "—" on error or null.
  const fromOpen = (n: number | null | undefined) =>
    open.loading ? '…' : open.error || n == null ? '—' : fmtInt(n)
  const fromHist = (s: string | null) => (hist.loading ? '…' : hist.error ? '—' : s ?? '—')

  // Longest closure pressure — the high-volume complaint type with the highest
  // p90 closure time. Degrades on its own; never blocks the snapshot.
  const longestClosure = useMemo(() => {
    const highVol = (bottle.data ?? []).filter((r) => r.total_cases >= HIGH_VOLUME_MIN && r.p90_closure_days != null)
    return highVol.length ? highVol.reduce((a, b) => (b.p90_closure_days! > a.p90_closure_days! ? b : a)) : null
  }, [bottle.data])
  const longestValue =
    bottle.loading ? '…' : bottle.error || !longestClosure ? '—' : longestClosure.complaint_type
  const longestDetail = longestClosure ? `90% closed within ${fmtDays(longestClosure.p90_closure_days)}` : undefined

  const topPressure =
    [k?.top_complaint_type, k?.busiest_council_district ? `District ${k.busiest_council_district}` : null]
      .filter(Boolean)
      .join(' · ') || null

  // POC interpretation thresholds (not an official City SLA). These read the NYC
  // 311 benchmark, so the open-case count is benchmark workload, NOT a live
  // Brampton backlog — labelled "Benchmark" to avoid that misread.
  const highCount = open.data?.highPriority ?? null
  const p90 = k?.p90_closure_days ?? null
  const highTone: KpiTone = highCount != null && highCount > 0 ? 'priority' : 'neutral'
  const p90Tone: KpiTone = p90 != null && p90 >= 30 ? 'watch' : 'benchmark'

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-navy-900">Operational snapshot</h2>
          <p className="mt-0.5 text-xs text-ink-subtle">
            A summary of the workload analytics below, from the public 311 benchmark (open review queue and closed
            records). Benchmark data, not a live Brampton backlog.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-subtle">
          Benchmark data
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          title="Benchmark open cases"
          value={fromOpen(open.data?.total)}
          tone="benchmark"
          statusLabel="Benchmark"
          helper="Open cases in the public 311 benchmark review queue — not a live Brampton backlog"
        />
        <KpiCard
          title="High priority cases"
          value={fromOpen(open.data?.highPriority)}
          tone={highTone}
          statusLabel="High priority"
          helper="Benchmark open cases surfaced for priority review"
        />
        <KpiCard
          title="Typical historical closure"
          value={fromHist(k?.avg_closure_days == null ? null : `${k.avg_closure_days.toFixed(1)} d`)}
          tone="benchmark"
          statusLabel="Benchmark"
          helper="Average closure time across closed benchmark records"
        />
        <KpiCard
          title="90% closed within"
          value={fromHist(k?.p90_closure_days == null ? null : `${Math.round(k.p90_closure_days)} d`)}
          tone={p90Tone}
          statusLabel={p90Tone === 'watch' ? 'Watch' : 'Benchmark'}
          helper="Long tail closure benchmark for closed records"
        />
        <KpiCard
          title="Top workload pressure"
          value={fromHist(topPressure)}
          valueClass="text-lg font-semibold leading-snug"
          tone="pressure"
          statusLabel="Pressure"
          helper="Highest workload issue and district in the benchmark view"
        />
        <KpiCard
          title="Longest closure pressure"
          value={longestValue}
          valueClass="text-lg font-semibold leading-snug truncate"
          detail={longestDetail}
          tone="pressure"
          statusLabel="Pressure"
          helper="Slowest-closing high-volume complaint type by 90% closure time"
        />
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-ink-subtle">
        Signals are based on POC thresholds, not official City SLA.
        {hist.data && ` Based on ${fmtInt(hist.data.closed_requests)} closed public 311 benchmark records and the benchmark open review queue.`}
      </p>
    </section>
  )
}

// Subtle status treatment for the snapshot KPI cards — a tinted left border, a
// small coloured status label, and a faint tinted background. These are POC interpretation cues,
// NOT an official City SLA. Kept restrained: one accent per card, soft tints.
type KpiTone = 'neutral' | 'benchmark' | 'watch' | 'pressure' | 'priority'

const KPI_TONE: Record<KpiTone, { border: string; card: string; label: string }> = {
  neutral: { border: 'border-l-slate-300', card: 'bg-white', label: 'text-slate-600' },
  benchmark: { border: 'border-l-emerald-400', card: 'bg-emerald-50/30', label: 'text-emerald-700' },
  watch: { border: 'border-l-amber-400', card: 'bg-amber-50/30', label: 'text-amber-700' },
  pressure: { border: 'border-l-orange-500', card: 'bg-orange-50/30', label: 'text-orange-700' },
  priority: { border: 'border-l-rose-500', card: 'bg-rose-50/40', label: 'text-rose-700' },
}

/**
 * One KPI card: a title, a value, an optional secondary detail line, and a
 * plain-language helper. Values come only from aggregate benchmark services — no
 * targets or synthetic baselines. An optional tone + status label give a subtle,
 * POC-threshold reading of the metric.
 */
function KpiCard({
  title,
  value,
  helper,
  detail,
  valueClass = 'text-3xl font-bold',
  tone = 'neutral',
  statusLabel,
}: {
  title: string
  value: string
  helper: string
  detail?: string
  valueClass?: string
  tone?: KpiTone
  statusLabel?: string
}) {
  const t = KPI_TONE[tone]
  return (
    <div className={`rounded-xl border border-l-4 border-slate-200 p-4 ${t.border} ${t.card}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{title}</div>
        {statusLabel && (
          <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wider ${t.label}`}>
            {statusLabel}
          </span>
        )}
      </div>
      <div className={`mt-1.5 tabular-nums text-navy-900 ${valueClass}`}>{value}</div>
      {detail && <div className="mt-1 text-xs font-medium text-ink-muted">{detail}</div>}
      <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">{helper}</p>
    </div>
  )
}

// --- Donuts ----------------------------------------------------------------

type Slice = { label: string; value: number; color: string; onClick?: () => void }

function Donut({ slices, size = 132, showCounts = false }: { slices: Slice[]; size?: number; showCounts?: boolean }) {
  const total = slices.reduce((n, s) => n + s.value, 0)
  const stroke = 18
  const r = size / 2 - stroke / 2
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Distribution">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
        {total > 0 &&
          slices.map((s) => {
            const len = (s.value / total) * c
            const el = (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={stroke}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                className={s.onClick ? 'cursor-pointer' : ''}
                onClick={s.onClick}
              >
                <title>{`${s.label}: ${fmtInt(s.value)} (${fmtPct(s.value, total)})`}</title>
              </circle>
            )
            offset += len
            return el
          })}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.map((s) => (
          <li key={s.label}>
            <button
              type="button"
              onClick={s.onClick}
              disabled={!s.onClick}
              className={`flex w-full items-center justify-between gap-2 text-left text-xs ${s.onClick ? 'hover:text-navy-900' : ''}`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="truncate text-ink">{s.label}</span>
              </span>
              <span className="shrink-0 tabular-nums text-ink-subtle">
                {total > 0 ? (showCounts ? `${fmtInt(s.value)} · ${fmtPct(s.value, total)}` : fmtPct(s.value, total)) : '—'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Top 5 by value + a combined "Other" slice. */
function topNplusOther<T>(rows: T[], label: (r: T) => string, value: (r: T) => number, n = 5): Slice[] {
  const sorted = [...rows].sort((a, b) => value(b) - value(a))
  const top = sorted.slice(0, n)
  const otherTotal = sorted.slice(n).reduce((s, r) => s + value(r), 0)
  const slices: Slice[] = top.map((r, i) => ({ label: label(r), value: value(r), color: PALETTE[i % PALETTE.length] }))
  if (otherTotal > 0) slices.push({ label: 'Other', value: otherTotal, color: PALETTE[5] })
  return slices
}

const RANKED_TYPE_LIMIT = 15

/**
 * Ranked Top-N complaint types as a horizontal bar chart with counts and shares.
 * Replaces the old donut, whose dominant slice was a meaningless "Other". Bars
 * are clickable and drill into the Case Explorer filtered to that type. The share
 * is computed against the full request total so it reads as the operational story.
 */
function ComplaintTypeRanked({ onExplore }: { onExplore: (f: CaseExplorerFilters) => void }) {
  // Pull the full type distribution so the percentage denominator is the real
  // total; display only the Top N.
  const { data, loading, error } = useLive<ComplaintTypeVolume[]>(() => getInsightsComplaintTypeVolume(500))
  const { rows, total, max } = useMemo(() => {
    const all = data ?? []
    const grand = all.reduce((n, r) => n + r.total_cases, 0)
    const top = all.slice(0, RANKED_TYPE_LIMIT)
    return { rows: top, total: grand, max: Math.max(1, ...top.map((r) => r.total_cases)) }
  }, [data])
  return (
    <SectionShell
      name="complaint type ranking"
      title="Top complaint types"
      subtitle={`Top ${RANKED_TYPE_LIMIT} by volume, with share of all requests. Select a type to explore its cases.`}
      loading={loading}
      error={error}
      empty={data?.length === 0}
    >
      {data && (
        <ul className="space-y-2.5">
          {rows.map((row, i) => (
            <li key={row.complaint_type}>
              <button
                type="button"
                onClick={() => onExplore({ complaintType: row.complaint_type })}
                className="group w-full rounded-md px-1.5 py-1 text-left transition hover:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-ink-subtle">{i + 1}</span>
                    <span className="truncate text-ink group-hover:text-navy-900">{row.complaint_type}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-muted">
                    {fmtInt(row.total_cases)} <span className="text-ink-subtle">· {fmtPct(row.total_cases, total)}</span>
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-accent-500" style={{ width: `${Math.max(2, (row.total_cases / max) * 100)}%` }} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionShell>
  )
}

/**
 * Open case status mix — the ACTIVE review queue (v_nyc_open_status_mix), not the
 * historical source-label distribution. Shows counts and shares with no "0%" for
 * non-zero categories.
 */
function OpenStatusMixDonut() {
  const { data, loading, error } = useLive<OpenStatusMixRow[]>(getNycOpenStatusMix)
  const slices = useMemo(
    () =>
      (data ?? []).length
        ? topNplusOther(
            data!,
            (r) => r.status,
            (r) => r.total_cases,
          )
        : [],
    [data],
  )
  return (
    <SectionShell
      name="the open case status mix"
      title="Open case status mix"
      subtitle="Active review queue — where open cases currently sit."
      loading={loading}
      error={error}
      empty={data?.length === 0}
    >
      {data && <Donut slices={slices} showCounts />}
    </SectionShell>
  )
}

function ChannelMixDonut() {
  const { data, loading, error } = useLive<ChannelMixRow[]>(getInsightsChannelMix)
  const meaningful = data ? isChannelMixMeaningful(data) : false
  const slices = useMemo(
    () => (data ?? []).map((r, i) => ({ label: r.channel, value: r.total_cases, color: PALETTE[i % PALETTE.length] })),
    [data],
  )
  return (
    <SectionShell name="the channel mix" title="Channel mix" subtitle="How requests arrive." loading={loading} error={error}>
      {data && !meaningful && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-ink-subtle">
          Channel data unavailable for this dataset.
        </div>
      )}
      {data && meaningful && <Donut slices={slices} />}
    </SectionShell>
  )
}

// --- Closure time distribution --------------------------------------------

/**
 * Closure time distribution — a simple horizontal bar distribution of how long
 * closed historical requests took to close, from same-day closures to the long
 * 6-month-plus tail. Reads a precomputed aggregate view (never raw rows). This
 * is descriptive historical context, not a prediction.
 */
function ClosureDurationDistribution() {
  const { data, loading, error } = useLive<ClosureDurationBucket[]>(getInsightsClosureDurationDistribution)
  const { rows, total, max } = useMemo(() => {
    const all = data ?? []
    const grand = all.reduce((n, r) => n + r.total_cases, 0)
    return { rows: all, total: grand, max: Math.max(1, ...all.map((r) => r.total_cases)) }
  }, [data])
  return (
    <SectionShell
      name="the closure time distribution"
      title="Closure time distribution"
      subtitle="How long historical requests took to close. This shows the long tail of slower cases, not a prediction."
      loading={loading}
      error={error}
      empty={data?.length === 0 || total === 0}
    >
      {data && total > 0 && (
        <ul className="space-y-2.5">
          {rows.map((row) => (
            <li key={row.bucket_order}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-ink">{row.closure_bucket}</span>
                <span className="shrink-0 tabular-nums text-ink-muted">
                  {fmtInt(row.total_cases)} <span className="text-ink-subtle">· {fmtPct(row.total_cases, total)}</span>
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-accent-500"
                  style={{ width: `${Math.max(2, (row.total_cases / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionShell>
  )
}

// --- High volume + slow closure scatter -----------------------------------

function ClosureScatter({ onExplore }: { onExplore: (f: CaseExplorerFilters) => void }) {
  const { data, loading, error } = useLive<ClosureBottleneck[]>(() => getInsightsClosureBottlenecks(50))
  const points = useMemo(
    () => (data ?? []).filter((d) => d.avg_closure_days != null && d.total_cases > 0),
    [data],
  )
  return (
    <SectionShell name="the volume vs closure view" title="Volume vs closure time" subtitle="Each point is a complaint type. Upper-right means high volume and slower closure." loading={loading} error={error} empty={points.length === 0}>
      {data && points.length > 0 && <Scatter points={points} onExplore={onExplore} />}
    </SectionShell>
  )
}

function Scatter({ points, onExplore }: { points: ClosureBottleneck[]; onExplore: (f: CaseExplorerFilters) => void }) {
  const W = 560
  const H = 260
  const pad = 40
  // Log-scaled x so one very high-volume type doesn't squash everything into the
  // bottom-left. Y (avg closure days) stays linear and intuitive.
  const xs = points.map((p) => p.total_cases)
  const minX = Math.max(1, Math.min(...xs))
  const maxX = Math.max(minX + 1, ...xs)
  const lMinX = Math.log10(minX)
  const lMaxX = Math.log10(maxX)
  const maxY = Math.max(1, ...points.map((p) => p.avg_closure_days ?? 0))
  const x = (v: number) => pad + ((Math.log10(Math.max(1, v)) - lMinX) / (lMaxX - lMinX)) * (W - pad * 1.5)
  const y = (v: number) => H - pad - (v / maxY) * (H - pad * 1.5)

  // Median crosshair splits the plot into four readable quadrants.
  const sortedX = [...xs].sort((a, b) => a - b)
  const sortedY = points.map((p) => p.avg_closure_days ?? 0).sort((a, b) => a - b)
  const medX = sortedX[Math.floor(sortedX.length / 2)] ?? minX
  const medY = sortedY[Math.floor(sortedY.length / 2)] ?? 0
  const cx = x(medX)
  const cy = y(medY)

  // Top 5 "pressure" points (high volume × slow closure) get a text label.
  const topLabels = new Set(
    [...points]
      .sort((a, b) => (b.total_cases * (b.avg_closure_days ?? 0)) - (a.total_cases * (a.avg_closure_days ?? 0)))
      .slice(0, 5)
      .map((p) => p.complaint_type),
  )

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Total cases (log scale) versus average closure days by complaint type">
        {/* Median crosshair + quadrant labels */}
        <line x1={cx} y1={6} x2={cx} y2={H - pad} stroke="#e2e8f0" strokeDasharray="3 3" />
        <line x1={pad} y1={cy} x2={W - 6} y2={cy} stroke="#e2e8f0" strokeDasharray="3 3" />
        <text x={pad + 4} y={14} className="fill-ink-subtle" style={{ fontSize: 8 }}>Lower volume / slower</text>
        <text x={W - 8} y={14} textAnchor="end" className="fill-ink-subtle" style={{ fontSize: 8 }}>Higher volume / slower</text>
        <text x={pad + 4} y={H - pad - 4} className="fill-ink-subtle" style={{ fontSize: 8 }}>Lower volume / faster</text>
        <text x={W - 8} y={H - pad - 4} textAnchor="end" className="fill-ink-subtle" style={{ fontSize: 8 }}>Higher volume / faster</text>

        {/* Axes */}
        <line x1={pad} y1={H - pad} x2={W - 6} y2={H - pad} stroke="#cbd5e1" />
        <line x1={pad} y1={6} x2={pad} y2={H - pad} stroke="#cbd5e1" />
        <text x={(W + pad) / 2} y={H - 6} textAnchor="middle" className="fill-ink-subtle" style={{ fontSize: 9 }}>Total cases (log scale) →</text>
        <text x={10} y={H / 2} textAnchor="middle" transform={`rotate(-90 10 ${H / 2})`} className="fill-ink-subtle" style={{ fontSize: 9 }}>Avg closure days →</text>

        {points.map((p) => {
          const px = x(p.total_cases)
          const py = y(p.avg_closure_days ?? 0)
          const dot = PRESSURE_META[closurePressure(p.p90_closure_days, p.avg_closure_days)].dot
          const labelled = topLabels.has(p.complaint_type)
          return (
            <g key={p.complaint_type}>
              <circle cx={px} cy={py} r={labelled ? 5.5 : 4.5} fill={dot} fillOpacity={0.7} className="cursor-pointer" onClick={() => onExplore({ complaintType: p.complaint_type })}>
                <title>{`${p.complaint_type}\nCases: ${fmtInt(p.total_cases)}\nAvg closure: ${fmtDays(p.avg_closure_days)}\n90% closed within: ${fmtDays(p.p90_closure_days)}`}</title>
              </circle>
              {labelled && (
                <text x={px} y={py - 8} textAnchor={px > W * 0.7 ? 'end' : 'middle'} className="pointer-events-none fill-navy-900" style={{ fontSize: 8, fontWeight: 600 }}>
                  {p.complaint_type.length > 22 ? `${p.complaint_type.slice(0, 21)}…` : p.complaint_type}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-subtle">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: PRESSURE_META.normal.dot }} /> Normal</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: PRESSURE_META.watch.dot }} /> Watch</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: PRESSURE_META.critical.dot }} /> Critical</span>
        <span>Select a point to explore that complaint type’s cases.</span>
      </div>
    </div>
  )
}

// --- Trend -----------------------------------------------------------------

/** Date part (YYYY-MM-DD) of an ISO date/timestamp string, or null. */
const isoDate = (v: string | null): string | null => {
  if (!v) return null
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v)
  return m ? m[1] : null
}

function TrendSection({ onExplore }: { onExplore: (f: CaseExplorerFilters) => void }) {
  const { data, loading, error } = useLive<MonthlyTrendPoint[]>(() => getInsightsMonthlyTrend(24))
  const meta = useLive<InsightsSourceMeta>(getInsightsSourceMeta)
  const from = isoDate(meta.data?.earliest ?? null)
  const to = isoDate(meta.data?.latest ?? null)
  return (
    <SectionShell name="the service request trend" title="Service request trend" subtitle="Monthly volume (bars) and average closure days (line). Select a month to explore it." loading={loading} error={error} empty={data?.length === 0}>
      {data && data.length > 0 && (
        <>
          <TrendChart points={data} onExplore={onExplore} />
          <p className="mt-2 text-[11px] text-ink-subtle">Trend uses complete calendar months only — partial boundary months are excluded.</p>
          {from && to && <p className="mt-0.5 text-[11px] text-ink-subtle">Source range: {from} to {to}.</p>}
        </>
      )}
    </SectionShell>
  )
}

function monthRange(month: string): CaseExplorerFilters {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return {}
  const end = new Date(y, m, 0).getDate()
  return { dateFrom: `${month}-01`, dateTo: `${month}-${String(end).padStart(2, '0')}` }
}

function TrendChart({ points, onExplore }: { points: MonthlyTrendPoint[]; onExplore: (f: CaseExplorerFilters) => void }) {
  const W = 760
  const H = 220
  const padL = 8
  const padT = 12
  const padB = 26
  const innerW = W - padL * 2
  const innerH = H - padT - padB
  const maxVol = Math.max(1, ...points.map((p) => p.request_volume))
  const closureVals = points.map((p) => p.avg_closure_days).filter((v): v is number => v != null)
  const maxClose = Math.max(1, ...closureVals)
  const step = innerW / points.length
  const barGap = 4
  const lineX = (i: number) => padL + i * step + step / 2
  const lineY = (v: number) => padT + innerH - (v / maxClose) * innerH
  const linePts = points
    .map((p, i) => (p.avg_closure_days == null ? null : `${lineX(i).toFixed(1)},${lineY(p.avg_closure_days).toFixed(1)}`))
    .filter((s): s is string => s != null)
    .join(' ')
  const labelEvery = Math.ceil(points.length / 8)
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Monthly request volume and average closure days">
        {points.map((p, i) => {
          const h = (p.request_volume / maxVol) * innerH
          return (
            <rect key={p.month} x={padL + i * step + barGap / 2} y={padT + innerH - h} width={Math.max(1, step - barGap)} height={Math.max(0, h)} rx={1.5} className="cursor-pointer fill-sky-200 hover:fill-sky-300" onClick={() => onExplore(monthRange(p.month))}>
              <title>{`${p.month}\nRequests: ${fmtInt(p.request_volume)}\nAvg closure: ${fmtDays(p.avg_closure_days)}`}</title>
            </rect>
          )
        })}
        {linePts && <polyline points={linePts} fill="none" stroke="#0f766e" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {points.map((p, i) => (p.avg_closure_days == null ? null : <circle key={`pt-${p.month}`} cx={lineX(i)} cy={lineY(p.avg_closure_days)} r={2.4} className="fill-teal-700" />))}
        {points.map((p, i) => (i % labelEvery === 0 ? <text key={`l-${p.month}`} x={lineX(i)} y={H - 8} textAnchor="middle" className="fill-ink-subtle" style={{ fontSize: 9 }}>{p.month}</text> : null))}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-ink-subtle">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-3 rounded-sm bg-sky-200" /> Monthly request volume</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded bg-teal-700" /> Avg closure days</span>
      </div>
    </div>
  )
}

// --- Closure bottlenecks (high-volume default) ----------------------------

const HIGH_VOLUME_MIN = 1000

function ClosureBottlenecks({ onExplore }: { onExplore: (f: CaseExplorerFilters) => void }) {
  const { data, loading, error } = useLive<ClosureBottleneck[]>(() => getInsightsClosureBottlenecks(40))
  const [highVolumeOnly, setHighVolumeOnly] = useState(true)
  const [view, setView] = useState<'leaderboard' | 'table'>('leaderboard')
  const rows = useMemo(() => {
    const all = data ?? []
    const filtered = highVolumeOnly ? all.filter((r) => r.total_cases >= HIGH_VOLUME_MIN) : all
    return filtered.slice(0, 12)
  }, [data, highVolumeOnly])
  return (
    <SectionShell name="the closure leaderboard" title="Where closure takes longest" subtitle="Complaint types with high volume and longer closure times. These are historical closure patterns, not predictions." loading={loading} error={error} empty={data?.length === 0}
      action={
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
            <input type="checkbox" checked={highVolumeOnly} onChange={(e) => setHighVolumeOnly(e.target.checked)} />
            High volume only (≥ {fmtInt(HIGH_VOLUME_MIN)})
          </label>
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[11px] font-semibold">
            {(['leaderboard', 'table'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-md px-2.5 py-1 capitalize transition ${view === v ? 'bg-white text-navy-900 shadow-sm ring-1 ring-slate-200' : 'text-ink-subtle hover:text-navy-900'}`}
              >
                {v === 'leaderboard' ? 'Leaderboard' : 'Table'}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {data && view === 'leaderboard' && <ClosureLeaderboard rows={rows} onExplore={onExplore} />}
      {data && view === 'table' && (
        <Table
          head={['Complaint type', 'Total', 'Avg', 'Median', '90% closed within', 'Pressure']}
          align={['left', 'right', 'right', 'right', 'right', 'left']}
          rows={rows.map((row) => ({
            key: row.complaint_type,
            onClick: () => onExplore({ complaintType: row.complaint_type }),
            cells: [row.complaint_type, fmtInt(row.total_cases), fmtDays(row.avg_closure_days), fmtDays(row.median_closure_days), fmtDays(row.p90_closure_days), PRESSURE_META[closurePressure(row.p90_closure_days, row.avg_closure_days)].label],
          }))}
        />
      )}
    </SectionShell>
  )
}

/** Visual leaderboard of the slowest-closing complaint types (default view). */
function ClosureLeaderboard({ rows, onExplore }: { rows: ClosureBottleneck[]; onExplore: (f: CaseExplorerFilters) => void }) {
  const maxVolume = Math.max(1, ...rows.map((r) => r.total_cases))
  const maxDuration = Math.max(1, ...rows.map((r) => r.p90_closure_days ?? 0))
  return (
    <ul className="space-y-2">
      {rows.map((row, i) => {
        const meta = PRESSURE_META[closurePressure(row.p90_closure_days, row.avg_closure_days)]
        const volPct = Math.round((row.total_cases / maxVolume) * 100)
        const durPct = Math.round(((row.p90_closure_days ?? 0) / maxDuration) * 100)
        return (
          <li key={row.complaint_type}>
            <button
              type="button"
              onClick={() => onExplore({ complaintType: row.complaint_type })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-left transition hover:bg-slate-50"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="w-5 shrink-0 text-[11px] tabular-nums text-ink-subtle">{i + 1}.</span>
                  <span className="truncate text-sm font-medium text-navy-900">{row.complaint_type}</span>
                  <span className={`badge ${meta.badge}`}>{meta.label}</span>
                </div>
                <div className="flex shrink-0 items-center gap-4 text-[11px] tabular-nums text-ink-subtle">
                  <span><span className="font-semibold text-ink">{fmtInt(row.total_cases)}</span> cases</span>
                  <span>Median <span className="font-semibold text-ink">{fmtDays(row.median_closure_days)}</span></span>
                  <span>90% within <span className="font-semibold text-ink">{fmtDays(row.p90_closure_days)}</span></span>
                </div>
              </div>
              <div className="mt-2 space-y-1.5">
                <MetricBar label="Volume" pct={volPct} barClass="bg-sky-300" valueText={fmtInt(row.total_cases)} />
                <MetricBar label="90% closed within" pct={durPct} barClass={meta.bar} valueText={fmtDays(row.p90_closure_days)} />
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// --- Leaderboard / Table view toggle (shared) ------------------------------

/** Small segmented control to switch a section between the visual leaderboard
 *  (default) and the raw table — same control used on "Where closure takes longest". */
function ViewToggle({ view, onChange }: { view: 'leaderboard' | 'table'; onChange: (v: 'leaderboard' | 'table') => void }) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[11px] font-semibold">
      {(['leaderboard', 'table'] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1 transition ${view === v ? 'bg-white text-navy-900 shadow-sm ring-1 ring-slate-200' : 'text-ink-subtle hover:text-navy-900'}`}
        >
          {v === 'leaderboard' ? 'Leaderboard' : 'Table'}
        </button>
      ))}
    </div>
  )
}

// --- District workload pressure --------------------------------------------

function AreaBottlenecks({ onExplore }: { onExplore: (f: CaseExplorerFilters) => void }) {
  const { data, loading, error } = useLive<AreaBottleneck[]>(() => getInsightsAreaBottlenecks(12))
  const [view, setView] = useState<'leaderboard' | 'table'>('leaderboard')
  return (
    <SectionShell name="district workload pressure" title="District workload pressure" subtitle="Districts with the highest workload. Longer bars mean more cases; closure timing is shown as supporting context." loading={loading} error={error} empty={data?.length === 0}
      action={data && data.length > 0 ? <ViewToggle view={view} onChange={setView} /> : undefined}
    >
      {data && view === 'leaderboard' && <DistrictLeaderboard rows={data} onExplore={onExplore} />}
      {data && view === 'table' && (
        <Table
          head={['Council district', 'Total', 'Avg', '90% closed within', 'Top complaint type']}
          align={['left', 'right', 'right', 'right', 'left']}
          rows={data.map((row) => ({
            key: row.council_district,
            onClick: () => onExplore({ councilDistrict: row.council_district }),
            cells: [`District ${row.council_district}`, fmtInt(row.total_cases), fmtDays(row.avg_closure_days), fmtDays(row.p90_closure_days), row.top_complaint_type ?? '—'],
          }))}
        />
      )}
    </SectionShell>
  )
}

/** Visual leaderboard of districts by workload (default view). */
function DistrictLeaderboard({ rows, onExplore }: { rows: AreaBottleneck[]; onExplore: (f: CaseExplorerFilters) => void }) {
  const maxVolume = Math.max(1, ...rows.map((r) => r.total_cases))
  return (
    <ul className="space-y-2">
      {rows.map((row, i) => (
        <li key={row.council_district}>
          <button
            type="button"
            onClick={() => onExplore({ councilDistrict: row.council_district })}
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-left transition hover:bg-slate-50"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="w-5 shrink-0 text-[11px] tabular-nums text-ink-subtle">{i + 1}.</span>
                <span className="truncate text-sm font-medium text-navy-900">District {row.council_district}</span>
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-ink-subtle">
                <span className="font-semibold text-ink">{fmtInt(row.total_cases)}</span> cases
              </span>
            </div>
            <div className="mt-1 text-[11px] text-ink-subtle">
              Top issue: <span className="text-ink-muted">{row.top_complaint_type ?? '—'}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-subtle">
              <span>Avg closure: <span className="font-medium text-ink">{fmtDays(row.avg_closure_days)}</span></span>
              <span aria-hidden>·</span>
              <span>90% closed within: <span className="font-medium text-ink">{fmtDays(row.p90_closure_days)}</span></span>
            </div>
            <div className="mt-2">
              <MetricBar label="Volume" pct={Math.round((row.total_cases / maxVolume) * 100)} barClass="bg-sky-300" valueText={fmtInt(row.total_cases)} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}

// --- Department / agency workload ------------------------------------------

// Department workload is a part-to-whole composition: which department owns what
// share of the total service request workload. A donut reads that share directly,
// where a leaderboard only ranks. Up to 12 departments, so an extended palette
// keeps neighbouring slices visually distinct.
const DEPARTMENT_PALETTE = [
  '#2563eb', '#0ea5e9', '#7c3aed', '#f59e0b', '#10b981', '#ef4444',
  '#6366f1', '#14b8a6', '#db2777', '#84cc16', '#f97316', '#64748b',
]

function DepartmentWorkload({ onExplore }: { onExplore: (f: CaseExplorerFilters) => void }) {
  const { data, loading, error } = useLive<InsightsDepartmentWorkload[]>(() => getInsightsDepartmentWorkload(12))
  const [view, setView] = useState<'donut' | 'table'>('donut')
  const slices = useMemo<Slice[]>(
    () =>
      (data ?? []).map((row, i) => ({
        label: row.department,
        value: row.total_cases,
        color: DEPARTMENT_PALETTE[i % DEPARTMENT_PALETTE.length],
        onClick: () => onExplore({ agency: row.department }),
      })),
    [data, onExplore],
  )
  return (
    <SectionShell
      name="department workload share"
      title="Department workload share"
      subtitle="Share of total service request workload by department or agency. Select a slice to review matching cases."
      loading={loading}
      error={error}
      empty={data?.length === 0}
      action={
        data && data.length > 0 ? (
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[11px] font-semibold">
            {(['donut', 'table'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-md px-2.5 py-1 capitalize transition ${view === v ? 'bg-white text-navy-900 shadow-sm ring-1 ring-slate-200' : 'text-ink-subtle hover:text-navy-900'}`}
              >
                {v === 'donut' ? 'Donut' : 'Table'}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      {data && view === 'donut' && <Donut slices={slices} showCounts />}
      {data && view === 'table' && (
        <Table
          head={['Department / agency', 'Total', 'Open', 'Closed', 'Avg closure']}
          align={['left', 'right', 'right', 'right', 'right']}
          rows={data.map((row) => ({
            key: row.department,
            onClick: () => onExplore({ agency: row.department }),
            cells: [row.department, fmtInt(row.total_cases), fmtInt(row.open_cases), fmtInt(row.closed_cases), fmtDays(row.avg_closure_days)],
          }))}
        />
      )}
    </SectionShell>
  )
}

// ---------------------------------------------------------------------------
// Simulations tab — CTGAN + ABM stress testing framework
// ---------------------------------------------------------------------------
//
// CTGAN generates synthetic service-request demand from public 311 benchmark
// patterns; an agent-based model (ABM) runs that demand through each district's
// intake queue, constrained by officer daily minutes, with a supervisor review
// queue as a second bottleneck. This view reads five precomputed, read-only
// Supabase views via ../../services/ctganAbmStress and never writes. It is a
// planning simulation for capacity and backlog stress testing — decision
// support only, not live Brampton operational data and not enforcement
// decisioning.

// Shown verbatim wherever a CTGAN ABM view is empty or missing. Deliberately
// calm, non-technical language for a pending load — never an error/failure tone.
const CTGAN_PENDING_MESSAGE =
  'CTGAN ABM outputs are ready for loading. Schema alignment is complete. Data loading is pending manual approval.'

const ctDate = (v: unknown): string => formatPlainDate(v == null ? null : String(v)) ?? '—'

/**
 * SimulationLab — the CTGAN + ABM stress testing framework (Stress Testing tab).
 * Loads all five CTGAN ABM service reads with useLive and renders the framework
 * regardless of load state. When every view is empty/missing it shows a single
 * calm "pending manual approval" state. Planning simulation only; never an
 * enforcement decision and never live Brampton operational data.
 */
// Friendly labels for the calibrated scenario IDs.
const SCENARIO_LABELS: Record<string, string> = {
  baseline_calibrated: 'Baseline',
  rainstorm_pothole_mud_tracking: 'Rainstorm road condition surge',
  construction_corridor: 'Construction corridor',
  event_parking_noise: 'Event parking and noise',
  staff_capacity_drop: 'Staff capacity drop',
  supervisor_review_bottleneck: 'Supervisor review bottleneck',
}

function scenarioLabel(o: CtganScenarioOption): string {
  return SCENARIO_LABELS[o.scenario_id] ?? o.name ?? o.scenario_id
}

function SimulationLab() {
  const options = useLive<CtganScenarioOption[]>(getCtganScenarioOptions)
  const optionRows = useMemo(() => options.data ?? [], [options.data])

  // Selected scenario — default to the calibrated baseline once options load.
  const [scenarioId, setScenarioId] = useState<string>('')
  useEffect(() => {
    if (scenarioId || optionRows.length === 0) return
    const def = optionRows.find((o) => o.scenario_id === 'baseline_calibrated') ?? optionRows[0]
    setScenarioId(def.scenario_id)
  }, [optionRows, scenarioId])

  // Per-scenario data bundle, reloaded whenever the scenario changes.
  const [daily, setDaily] = useState<CtganDailyRow[]>([])
  const [districtRows, setDistrictRows] = useState<CtganDistrictScenarioRow[]>([])
  const [complaintRows, setComplaintRows] = useState<CtganComplaintScenarioRow[]>([])
  const [bundleLoading, setBundleLoading] = useState(false)
  const [bundleError, setBundleError] = useState<string | null>(null)

  useEffect(() => {
    if (!scenarioId) return
    let active = true
    setBundleLoading(true)
    setBundleError(null)
    Promise.all([
      getCtganDailyByScenario(scenarioId),
      getCtganDistrictPressureByScenario(scenarioId),
      getCtganComplaintTypePressureByScenario(scenarioId),
    ])
      .then(([d, di, c]) => {
        if (!active) return
        setDaily(d)
        setDistrictRows(di)
        setComplaintRows(c)
        setBundleLoading(false)
      })
      .catch((err: unknown) => {
        if (!active) return
        console.error('CTGAN scenario load failed:', err)
        setBundleError(errorMessage(err))
        setBundleLoading(false)
      })
    return () => {
      active = false
    }
  }, [scenarioId])

  const selectedOption = useMemo(
    () => optionRows.find((o) => o.scenario_id === scenarioId) ?? null,
    [optionRows, scenarioId],
  )

  // Day slider — defaults to the last simulated day (end of run) per scenario.
  const [dayIdx, setDayIdx] = useState(0)
  useEffect(() => {
    setDayIdx(daily.length > 0 ? daily.length - 1 : 0)
  }, [daily])
  const dayCount = daily.length
  const clampedDay = Math.min(dayIdx, Math.max(0, dayCount - 1))
  const selectedDay = daily[clampedDay] ?? null

  // Scenario-level (end-of-run) measures.
  const redZoneCount = useMemo(() => districtRows.filter((d) => d.overload_flag === 1).length, [districtRows])
  const finalBacklog = selectedOption?.final_backlog ?? (dayCount ? daily[dayCount - 1].backlog : 0)
  const supervisorPeak = useMemo(
    () => daily.reduce((m, r) => Math.max(m, r.supervisor_queue_size), 0),
    [daily],
  )
  const endStale = dayCount ? daily[dayCount - 1].stale_cases : 0
  const maxBacklog = useMemo(() => daily.reduce((m, r) => Math.max(m, r.backlog), 0) || 1, [daily])
  const topDistricts = useMemo(
    () => [...districtRows].sort((a, b) => b.backlog - a.backlog).slice(0, 10),
    [districtRows],
  )
  const topComplaints = useMemo(
    () => [...complaintRows].sort((a, b) => b.total_cases - a.total_cases).slice(0, 10),
    [complaintRows],
  )

  const showPending = !options.loading && optionRows.length === 0
  const redStatus: SimStatus = redZoneCount === 0 ? 'good' : redZoneCount <= 20 ? 'watch' : 'critical'

  return (
    <div className="mt-6 space-y-6">
      {/* Overview banner — frames the whole tab as a planning simulation. */}
      <section className="card overflow-hidden">
        <div className="border-b border-slate-200 bg-navy-900 px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-white">CTGAN ABM Stress Testing Framework</h2>
            <span className="inline-flex items-center rounded-full bg-sky-400/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-200 ring-1 ring-inset ring-sky-400/30">
              Planning simulation
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-navy-100">
            A conditional GAN (CTGAN) generates synthetic service-request demand from public 311 benchmark patterns, and
            an agent-based model (ABM) runs that demand through each district&rsquo;s intake queue. Officer daily minutes
            are the constrained resource, and a supervisor review queue forms the second bottleneck. This is capacity
            planning and stress testing only — decision support, not live Brampton operational data, and never an
            enforcement decision.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {['CTGAN demand', 'Agent-based model', 'Capacity planning', 'Decision support only', 'Not enforcement decisioning'].map(
              (tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-medium text-navy-100 ring-1 ring-inset ring-white/15"
                >
                  {tag}
                </span>
              ),
            )}
          </div>
        </div>
      </section>

      {/* Framework cards — the four-stage model, shown even with no data loaded. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FrameworkCard
          step={1}
          title="CTGAN demand generation"
          body="A conditional GAN synthesizes service-request demand from public 311 benchmark patterns to feed the simulation's arrival stream."
        />
        <FrameworkCard
          step={2}
          title="ABM district queue simulation"
          body="Generated demand flows into per-district intake queues that the agent-based model advances day by day."
        />
        <FrameworkCard
          step={3}
          title="Officer daily minutes"
          body="Each officer has a fixed daily minute budget. When demand exceeds available minutes, cases queue — the model's binding constraint."
        />
        <FrameworkCard
          step={4}
          title="Supervisor review queue"
          body="Cases needing sign-off enter a supervisor review queue after field work — a second bottleneck where backlog can accumulate."
        />
      </div>

      {showPending ? (
        <CtganSection title="Scenario selector" subtitle="Pick a calibrated scenario to explore its capacity-constrained queue pressure.">
          <CtganPendingNote />
        </CtganSection>
      ) : (
        <>
          {/* Scenario selector + day slider — no in-browser re-simulation. */}
          <CtganSection
            title="Scenario selector"
            subtitle="Pick a calibrated scenario and scrub the simulated day. Scenario dropdown and day slider only — synthetic demand is precomputed; nothing re-runs in the browser."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">Scenario</span>
                <select
                  value={scenarioId}
                  onChange={(e) => setScenarioId(e.target.value)}
                  className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  {optionRows.map((o) => (
                    <option key={o.scenario_id} value={o.scenario_id}>
                      {scenarioLabel(o)}
                    </option>
                  ))}
                </select>
                {selectedOption?.description && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ink-subtle">{selectedOption.description}</p>
                )}
              </label>
              <div className="block">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">Simulated day</span>
                  <span className="text-xs font-medium text-navy-900">
                    {selectedDay ? `Day ${clampedDay + 1} of ${dayCount} (${ctDate(selectedDay.day)})` : '—'}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={Math.max(1, dayCount)}
                  value={clampedDay + 1}
                  onChange={(e) => setDayIdx(Number(e.target.value) - 1)}
                  disabled={dayCount === 0}
                  className="mt-3 w-full accent-sky-600 disabled:opacity-40"
                />
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-subtle">
                  The day slider changes the daily cards and trajectory only. District pressure below is end-of-run data.
                </p>
              </div>
            </div>
            {bundleError && (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
                Could not load scenario data: {bundleError}
              </p>
            )}
          </CtganSection>

          {/* Scenario summary — end-of-run measures for the selected scenario. */}
          <CtganSection
            title="Scenario summary"
            subtitle="End-of-run capacity-constrained queue pressure for the selected scenario. Planning estimate, not a forecast."
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SimCard label="Final backlog" value={fmtInt(finalBacklog)} helper="Open queue at the end of the run" status="watch" />
              <SimCard
                label="Red zone districts"
                value={`${fmtInt(redZoneCount)} / ${fmtInt(districtRows.length)}`}
                helper="Districts flagged overloaded (overload_flag = 1)"
                status={redStatus}
              />
              <SimCard label="Supervisor queue peak" value={fmtInt(supervisorPeak)} helper="Highest review queue across the run" />
              <SimCard label="Stale cases (end)" value={fmtInt(endStale)} helper="Cases aged past the stale threshold at run end" />
            </div>
          </CtganSection>

          {/* Pressure propagation — derived operational pressure chain,
              scored by the Operational Pressure Model. */}
          <CtganSection
            title="Pressure propagation"
            subtitle="How workload pressure moves through districts, complaint types, officer capacity, supervisor review, stale cases, and backlog under the selected scenario."
          >
            <PressurePropagation
              daily={daily}
              districtRows={districtRows}
              complaintRows={complaintRows}
              finalBacklog={finalBacklog}
              supervisorPeak={supervisorPeak}
              endStale={endStale}
              redZoneCount={redZoneCount}
              loading={bundleLoading}
            />
          </CtganSection>

          {/* Selected-day cards + backlog trajectory (day slider). */}
          <CtganSection
            title="Selected day — operational pressure"
            subtitle="Daily queue pressure on the chosen simulated day. These cards and the trajectory update with the day slider."
          >
            {bundleLoading ? (
              <div className="animate-pulse rounded-md bg-slate-100/70 py-4 text-center text-sm text-ink-subtle">
                Loading scenario daily trajectory…
              </div>
            ) : selectedDay ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <SimCard label="Backlog" value={fmtInt(selectedDay.backlog)} helper={`Open queue on day ${clampedDay + 1}`} />
                  <SimCard label="Stale cases" value={fmtInt(selectedDay.stale_cases)} helper="Aged cases still waiting" />
                  <SimCard label="Supervisor queue" value={fmtInt(selectedDay.supervisor_queue_size)} helper="Cases awaiting review that day" />
                  <SimCard label="Processed (cumulative)" value={fmtInt(selectedDay.processed)} helper="Cases worked through this day" />
                </div>
                <div className="mt-4">
                  <div className="flex h-16 items-end gap-0.5">
                    {daily.map((r, i) => (
                      <button
                        key={r.day}
                        type="button"
                        onClick={() => setDayIdx(i)}
                        title={`Day ${i + 1} (${ctDate(r.day)}): ${fmtInt(r.backlog)} backlog`}
                        aria-label={`Select day ${i + 1}`}
                        className="flex-1 rounded-t transition-colors"
                        style={{
                          height: `${Math.max(3, (r.backlog / maxBacklog) * 100)}%`,
                          backgroundColor: i === clampedDay ? '#0f172a' : '#bae6fd',
                        }}
                      />
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ink-subtle">
                    Backlog trajectory across {dayCount} days — selected day highlighted. Click a bar to jump to that day.
                  </p>
                </div>
              </>
            ) : (
              <CtganPendingNote />
            )}
          </CtganSection>

          {/* 3D district pressure map — updates by scenario, not by day. */}
          <CtganSection
            title="District pressure map"
            subtitle="End-of-run district queue pressure for the selected scenario, shaded by open backlog. The map updates by scenario, not by day — district data is end-of-run, not daily."
          >
            <SimulationPressureMap districtRows={districtRows} loading={bundleLoading} />
          </CtganSection>

          {/* Top districts by queue pressure — with red-zone flags. */}
          <CtganSection
            title="Top districts by queue pressure"
            subtitle="Highest end-of-run backlog districts for the selected scenario. A red zone is an overloaded district (overload_flag = 1)."
          >
            <TopDistrictsTable rows={topDistricts} loading={bundleLoading} />
          </CtganSection>

          {/* Top complaint type pressure. */}
          <CtganSection
            title="Top complaint type pressure"
            subtitle="Which complaint types drive the most simulated workload in the selected scenario."
          >
            {bundleLoading ? (
              <div className="animate-pulse rounded-md bg-slate-100/70 py-4 text-center text-sm text-ink-subtle">
                Loading complaint-type pressure…
              </div>
            ) : (
              <CtganPressureTable
                firstColLabel="Complaint type"
                rows={topComplaints.map((r) => ({ label: r.complaint_type, total_cases: r.total_cases, estimated_hours: r.estimated_hours }))}
              />
            )}
          </CtganSection>
        </>
      )}

      {/* Clear note — planning simulation only, not enforcement decisioning. */}
      <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="text-sm font-semibold text-navy-900">Planning simulation only — not enforcement decisioning</div>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-subtle">
          This framework uses CTGAN-generated synthetic demand from public 311 benchmark patterns and an agent-based
          model to stress test capacity, backlog, and review sequencing — operational pressure and queue pressure under
          capacity-constrained queue pressure. It is decision support for staffing and planning conversations. It does
          not use live Brampton operational data, does not score officers, does not automate enforcement, and is never
          used to make enforcement decisions.
        </p>
      </section>
    </div>
  )
}

// The 3D district pressure map for a selected scenario. Reuses the deck.gl
// workload deck, joining CTGAN end-of-run district backlog onto NYC council
// district geometry (by district number). Falls back to a ranked red-zone list
// if geometry is unavailable or nothing joins — never a blank or fake map.
function SimulationPressureMap({ districtRows, loading }: { districtRows: CtganDistrictScenarioRow[]; loading: boolean }) {
  const units = useLive<NYCCouncilDistrictBoundary[]>(getNYCCouncilDistrictBoundariesCached)
  const unitList = useMemo<AreaUnit[]>(
    () =>
      (units.data ?? []).map((d) => ({
        id: String(d.id),
        key: String(d.council_district),
        label: `District ${d.council_district}`,
        short: d.short_label,
        geometry: d.geojson_geometry,
      })),
    [units.data],
  )
  const unitKeys = useMemo(() => new Set(unitList.map((u) => u.key)), [unitList])
  const values = useMemo<AreaMetricValue[]>(
    () =>
      districtRows.map((r) => {
        const m = r.district_or_area.match(/\d+/)
        const key = m ? String(Number(m[0])) : r.district_or_area
        return {
          key,
          label: r.district_or_area,
          value: r.backlog,
          open_backlog: r.backlog,
          total_requests: r.total_cases,
          high_priority_open: r.stale_cases,
        }
      }),
    [districtRows],
  )
  const matched = useMemo(() => values.filter((v) => unitKeys.has(v.key)), [values, unitKeys])
  const maxVal = useMemo(() => matched.reduce((m, v) => Math.max(m, v.open_backlog ?? 0), 0), [matched])

  if (loading || units.loading) {
    return (
      <div className="flex h-[320px] w-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white/60 text-sm text-ink-subtle sm:h-[440px]">
        Loading district pressure map…
      </div>
    )
  }

  // Honest fallback — no geometry or nothing joined: show the ranked red-zone list.
  if (unitList.length === 0 || matched.length === 0) {
    return (
      <TopDistrictsTable
        rows={[...districtRows].sort((a, b) => b.backlog - a.backlog).slice(0, 10)}
        loading={false}
        note="3D map geometry is unavailable, so district pressure is shown as a ranked list."
      />
    )
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-[320px] w-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white/60 text-sm text-ink-subtle sm:h-[440px]">
          Loading 3D pressure view…
        </div>
      }
    >
      <SimulationPressureDeck
        units={unitList}
        values={values}
        metric={'open_backlog' as MapMetric}
        min={0}
        max={Math.max(1, maxVal)}
        unitLabel="council district"
        activeKey={null}
        mode="district"
        onHover={() => {}}
        onSelect={() => {}}
      />
      <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
        Shaded by end-of-run open backlog per council district. Public 311 benchmark synthetic demand — capacity
        planning and decision support only, not live Brampton data and not enforcement decisioning.
      </p>
    </Suspense>
  )
}

// Ranked districts table with red-zone flags (overload_flag = 1). Also used as
// the SimulationPressureMap fallback.
function TopDistrictsTable({
  rows,
  loading,
  note,
}: {
  rows: CtganDistrictScenarioRow[]
  loading?: boolean
  note?: string
}) {
  if (loading) {
    return (
      <div className="animate-pulse rounded-md bg-slate-100/70 py-4 text-center text-sm text-ink-subtle">
        Loading districts…
      </div>
    )
  }
  if (rows.length === 0) return <CtganPendingNote />
  const maxBacklog = rows.reduce((m, r) => Math.max(m, r.backlog), 0) || 1
  return (
    <div className="overflow-x-auto">
      {note && <p className="mb-2 text-[11px] leading-relaxed text-ink-subtle">{note}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-ink-subtle">
            <th className="py-2 pr-3 font-semibold">District / area</th>
            <th className="py-2 pr-3 text-right font-semibold">Backlog</th>
            <th className="py-2 pr-3 text-right font-semibold">Stale</th>
            <th className="hidden py-2 pr-3 font-semibold sm:table-cell">Queue pressure</th>
            <th className="py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.district_or_area} className="border-b border-slate-100 last:border-0">
              <td className="py-2 pr-3 text-navy-900">{r.district_or_area}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-navy-900">{fmtInt(r.backlog)}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-ink-subtle">{fmtInt(r.stale_cases)}</td>
              <td className="hidden py-2 pr-3 sm:table-cell">
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${r.overload_flag === 1 ? 'bg-rose-500' : 'bg-sky-500'}`}
                    style={{ width: `${Math.max(2, Math.min(100, (r.backlog / maxBacklog) * 100))}%` }}
                  />
                </div>
              </td>
              <td className="py-2">
                {r.overload_flag === 1 ? (
                  <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                    Red zone
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    OK
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// A four-stage framework explainer card. Always rendered so the methodology is
// visible even before any CTGAN ABM data is loaded.
function FrameworkCard({ step, title, body }: { step: number; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[10px] font-semibold text-white">
          {step}
        </span>
        <div className="text-sm font-semibold text-navy-900">{title}</div>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-subtle">{body}</p>
    </div>
  )
}

// A titled framework section shell (header + body) for the CTGAN ABM view.
function CtganSection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-slate-200 px-5 py-4">
        <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-subtle">{subtitle}</p>
      </div>
      <div className="px-5 py-5">{children}</div>
    </section>
  )
}

type CtganPressureRow = { label: string; total_cases: number; estimated_hours: number }

// Compact, mobile-responsive ranked table for district / complaint-type pressure.
function CtganPressureTable({ firstColLabel, rows }: { firstColLabel: string; rows: CtganPressureRow[] }) {
  if (rows.length === 0) return <CtganPendingNote />
  const maxCases = rows.reduce((m, r) => Math.max(m, r.total_cases), 0) || 1
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-ink-subtle">
            <th className="py-2 pr-3 font-semibold">{firstColLabel}</th>
            <th className="py-2 pr-3 text-right font-semibold">Cases</th>
            <th className="py-2 pr-3 text-right font-semibold">Est. hours</th>
            <th className="hidden py-2 font-semibold sm:table-cell">Share of cases</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-slate-100 last:border-0">
              <td className="py-2 pr-3 text-navy-900">{r.label}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-navy-900">{fmtInt(r.total_cases)}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-ink-subtle">{fmtInt(r.estimated_hours)}</td>
              <td className="hidden py-2 sm:table-cell">
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-sky-500"
                    style={{ width: `${Math.max(2, Math.min(100, (r.total_cases / maxCases) * 100))}%` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// The single, exact pending state shown wherever a CTGAN ABM view is empty or
// missing. Calm, informational styling — never error/failure language.
function CtganPendingNote() {
  return (
    <div className="rounded-md border border-sky-200 bg-sky-50/70 px-4 py-3 text-sm text-sky-900">
      <div className="font-semibold">Data loading pending</div>
      <p className="mt-0.5 leading-relaxed">{CTGAN_PENDING_MESSAGE}</p>
    </div>
  )
}

// Card status — deterministic green (manageable) / amber (pressure) / red
// (critical), or neutral when no threshold applies.
type SimStatus = 'neutral' | 'good' | 'watch' | 'critical'

const SIM_CARD_STATUS: Record<SimStatus, { container: string; value: string }> = {
  neutral: { container: 'border-slate-200 bg-white', value: 'text-navy-900' },
  good: { container: 'border-emerald-200 bg-emerald-50/60', value: 'text-emerald-800' },
  watch: { container: 'border-amber-200 bg-amber-50/60', value: 'text-amber-900' },
  critical: { container: 'border-rose-200 bg-rose-50/60', value: 'text-rose-800' },
}

function SimCard({
  label,
  value,
  helper,
  status = 'neutral',
}: {
  label: string
  value: string
  helper: string
  status?: SimStatus
}) {
  const s = SIM_CARD_STATUS[status]
  return (
    <div className={`rounded-xl border p-4 ${s.container}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className={`mt-1.5 truncate text-2xl font-bold tabular-nums ${s.value}`}>{value}</div>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">{helper}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pressure propagation — a DERIVED operational-pressure view.
//
// It scores the selected scenario's districts with the Operational Pressure
// Model (see services/municipalPressureModel.ts), then lays the result
// out as the operational dependency chain the ABM encodes: source pressure ->
// pathway (the five pressure channels) -> affected district -> affected complaint
// type -> officer queue -> supervisor review -> stale backlog -> mitigation.
// Edges are operational dependencies, NOT causal proof; this is not a learned
// causal graph. Not live Brampton data; enforcement decisions stay human reviewed.
// ---------------------------------------------------------------------------

const ZONE_STATUS: Record<PressureZone, SimStatus> = { red: 'critical', watch: 'watch', normal: 'good' }
const ZONE_LABEL: Record<PressureZone, string> = { red: 'Red zone', watch: 'Watch', normal: 'Normal' }

type PressureStage = { key: string; step: string; label: string; value: string; detail: string; status: SimStatus }

function PressurePropagation({
  daily,
  districtRows,
  complaintRows,
  finalBacklog,
  supervisorPeak,
  endStale,
  redZoneCount,
  loading,
}: {
  daily: CtganDailyRow[]
  districtRows: CtganDistrictScenarioRow[]
  complaintRows: CtganComplaintScenarioRow[]
  finalBacklog: number
  supervisorPeak: number
  endStale: number
  redZoneCount: number
  loading: boolean
}) {
  const model = useMemo(() => {
    if (districtRows.length === 0 && complaintRows.length === 0) return null
    const scored = scoreDistricts(districtRows, complaintRows)
    const source = scored[0] ?? null
    const mopmRed = scored.filter((s) => s.zone === 'red').length
    const mopmWatch = scored.filter((s) => s.zone === 'watch').length
    const topComplaint = [...complaintRows].sort((a, b) => b.total_cases - a.total_cases)[0] ?? null
    const demandTotal = complaintRows.reduce((n, c) => n + c.total_cases, 0)
    const peakBacklog = daily.reduce((m, r) => Math.max(m, r.backlog), 0) || finalBacklog
    const peakStale = daily.reduce((m, r) => Math.max(m, r.stale_cases), 0) || endStale
    const supervisorShare = peakBacklog > 0 ? supervisorPeak / peakBacklog : 0
    const mitigation = recommendMitigation(source, supervisorShare, mopmRed)

    const stages: PressureStage[] = [
      {
        key: 'district',
        step: 'Affected district',
        label: source?.district_or_area ?? '—',
        value: source ? fmtInt(source.backlog) : '—',
        detail: source ? `${ZONE_LABEL[source.zone]} · lead channel ${CHANNEL_LABELS[source.dominantChannel]}` : 'Highest-pressure district',
        status: source ? ZONE_STATUS[source.zone] : 'neutral',
      },
      {
        key: 'complaint',
        step: 'Affected complaint type',
        label: topComplaint?.complaint_type ?? '—',
        value: topComplaint ? fmtInt(topComplaint.total_cases) : '—',
        detail:
          demandTotal > 0 && topComplaint
            ? `${fmtPct(topComplaint.total_cases, demandTotal)} of simulated demand — dominant category`
            : 'Top CTGAN demand driver',
        status: 'watch',
      },
      {
        key: 'officer',
        step: 'Officer queue effect',
        label: 'Field queue',
        value: fmtInt(peakBacklog),
        detail: 'Peak open field queue — officer daily minutes are the binding constraint',
        status: 'watch',
      },
      {
        key: 'supervisor',
        step: 'Supervisor review effect',
        label: 'Review queue',
        value: fmtInt(supervisorPeak),
        detail:
          supervisorShare >= 0.4
            ? 'Peak sign-off queue — a major share of work waits on review'
            : 'Peak cases awaiting supervisor sign-off',
        status: supervisorShare >= 0.5 ? 'critical' : supervisorShare >= 0.2 ? 'watch' : 'neutral',
      },
      {
        key: 'stale',
        step: 'Stale backlog effect',
        label: 'Aged cases',
        value: fmtInt(Math.max(peakStale, endStale)),
        detail: 'Cases aged past the stale threshold as the queue holds',
        status: endStale > 0 ? 'watch' : 'neutral',
      },
      {
        key: 'final',
        step: 'Final backlog impact',
        label: 'End-of-run backlog',
        value: fmtInt(finalBacklog),
        detail: redZoneCount > 0 ? `${fmtInt(redZoneCount)} district(s) end overloaded (ABM flag)` : 'Open queue remaining at end of run',
        status: redZoneCount > 0 ? 'critical' : 'watch',
      },
    ]

    return { scored, source, mopmRed, mopmWatch, mitigation, stages }
  }, [daily, districtRows, complaintRows, finalBacklog, supervisorPeak, endStale, redZoneCount])

  if (loading) {
    return (
      <div className="animate-pulse rounded-md bg-slate-100/70 py-4 text-center text-sm text-ink-subtle">
        Deriving pressure propagation…
      </div>
    )
  }
  if (!model || !model.source) return <CtganPendingNote />

  const src = model.source

  return (
    <div>
      {/* Source pressure — the highest-P entity, with its zone + score. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className={`rounded-xl border p-4 ${SIM_CARD_STATUS[ZONE_STATUS[src.zone]].container}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">Source pressure</span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                src.zone === 'red'
                  ? 'bg-rose-100 text-rose-700'
                  : src.zone === 'watch'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              {ZONE_LABEL[src.zone]}
            </span>
          </div>
          <div className="mt-1.5 truncate text-sm font-semibold text-navy-900" title={src.district_or_area}>
            {src.district_or_area}
          </div>
          <div className={`mt-0.5 text-2xl font-bold tabular-nums ${SIM_CARD_STATUS[ZONE_STATUS[src.zone]].value}`}>
            P = {src.pressure.toFixed(2)}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
            Lead channel: {CHANNEL_LABELS[src.dominantChannel]} — the signal contributing most to this district&rsquo;s
            pressure.
          </p>
        </div>

        {/* Pressure pathway — the five weighted channels behind P. */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">Pressure pathway</span>
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-ink-muted">{OPERATIONAL_PRESSURE_FORMULA}</code>
          </div>
          <div className="mt-2.5">
            <PressureChannelBars channels={src.channels} />
          </div>
        </div>
      </div>

      {/* Reconciliation — ABM direct flags vs. pressure-model derived zones. */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">ABM overload flags</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-navy-900">
            {fmtInt(redZoneCount)} <span className="text-sm font-medium text-ink-subtle">district(s)</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
            Direct simulation output — districts the ABM flagged with overload_flag = 1.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">Pressure model watch / red zones</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-navy-900">
            {fmtInt(model.mopmWatch)} <span className="text-sm font-medium text-ink-subtle">watch</span>
            <span className="mx-1.5 text-ink-subtle">·</span>
            {fmtInt(model.mopmRed)} <span className="text-sm font-medium text-ink-subtle">red</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
            Derived pressure interpretation — the Operational Pressure Model&rsquo;s reading (watch ≥{' '}
            {OPERATIONAL_PRESSURE_WATCH_THRESHOLD}, red ≥ {OPERATIONAL_PRESSURE_RED_THRESHOLD}).
          </p>
        </div>
      </div>

      {/* Propagation chain — operational dependencies between stages. */}
      <ol className="mt-4 flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-1">
        {model.stages.flatMap((s, i) => {
          const card = <PressureStageCard key={s.key} stage={s} index={i + 1} />
          return i < model.stages.length - 1 ? [card, <PressureArrow key={`${s.key}-arrow`} />] : [card]
        })}
      </ol>

      {/* Recommended mitigation — the chain's terminal node. */}
      <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-semibold text-white">
            ✓
          </span>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Recommended mitigation</div>
        </div>
        <div className="mt-1.5 text-sm font-semibold text-emerald-900">{model.mitigation.title}</div>
        <p className="mt-1 text-xs leading-relaxed text-emerald-900/80">{model.mitigation.body}</p>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-ink-subtle">
        Derived planning model ({OPERATIONAL_PRESSURE_MODEL_NAME}) based on CTGAN plus ABM outputs. Shows operational pressure propagation, not
        causal proof. Channel edges are operational dependencies, not learned causality. Public 311 benchmark synthetic
        demand — capacity planning and decision support only, not live Brampton data, and never an enforcement decision;
        enforcement decisions remain human reviewed.
      </p>
    </div>
  )
}

/** Horizontal weighted-contribution bars for the five Operational Pressure Model channels. */
function PressureChannelBars({ channels }: { channels: PressureChannels }) {
  const rows = (Object.keys(channels) as (keyof PressureChannels)[]).map((k) => ({
    k,
    label: CHANNEL_LABELS[k],
    value: channels[k],
    contrib: OPERATIONAL_PRESSURE_WEIGHTS[k] * channels[k],
  }))
  const max = Math.max(0.0001, ...rows.map((r) => r.contrib))
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.k} className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-[10px] uppercase tracking-wider text-ink-subtle">{r.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-accent-500" style={{ width: `${Math.max(2, (r.contrib / max) * 100)}%` }} />
          </div>
          <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-ink-subtle">{r.value.toFixed(2)}</span>
        </li>
      ))}
    </ul>
  )
}

/** One stage card in the propagation chain (status-tinted). */
function PressureStageCard({ stage, index }: { stage: PressureStage; index: number }) {
  const s = SIM_CARD_STATUS[stage.status]
  return (
    <div className={`flex min-w-0 flex-1 flex-col rounded-xl border p-3 ${s.container}`}>
      <div className="flex items-center gap-1.5">
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[9px] font-semibold text-white">
          {index}
        </span>
        <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{stage.step}</span>
      </div>
      <div className="mt-1.5 truncate text-sm font-semibold text-navy-900" title={stage.label}>
        {stage.label}
      </div>
      <div className={`mt-0.5 text-xl font-bold tabular-nums ${s.value}`}>{stage.value}</div>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">{stage.detail}</p>
    </div>
  )
}

/** Connector between chain stages — points down on mobile, right on desktop. */
function PressureArrow() {
  return (
    <div className="flex shrink-0 items-center justify-center px-1 text-slate-400" aria-hidden>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4 rotate-90 lg:rotate-0"
      >
        <path d="M5 12h14" />
        <path d="M13 6l6 6-6 6" />
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Case Explorer tab
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25

/** A Postgres statement timeout (57014) — the Case Explorer's expected slow-query failure. */
function isTimeoutError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null
  const code = e?.code ?? ''
  const msg = (e?.message ?? '').toLowerCase()
  return code === '57014' || msg.includes('57014') || msg.includes('statement timeout') || msg.includes('canceling statement')
}

type ExplorerError = { message: string; timedOut: boolean }

/** Calm, specific timeout state for the Case Explorer (does not imply Insights is down). */
function CaseExplorerTimeout({ detail }: { detail: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4 text-sm">
      <div className="font-semibold text-navy-900">Case Explorer query timed out</div>
      <p className="mt-1 text-ink-muted">Try a narrower filter, or search by exact case ID.</p>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-ink-subtle">Technical detail</summary>
        <p className="mt-1 font-mono text-[11px] text-ink-subtle">Postgres 57014 statement timeout</p>
        {detail && <p className="mt-1 font-mono text-[11px] text-ink-subtle/80">{detail}</p>}
      </details>
    </div>
  )
}

function CaseExplorer({ filters, onFiltersChange }: { filters: CaseExplorerFilters; onFiltersChange: (f: CaseExplorerFilters) => void }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<NycCaseRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<ExplorerError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [options, setOptions] = useState<CaseExplorerOptions | null>(null)

  // True when no filter or search is set — the fast default view. A timeout here
  // shows a friendly "add a filter" prompt rather than a scary error.
  const hasAnyFilter = Boolean(
    filters.search ||
      filters.complaintType ||
      filters.borough ||
      filters.councilDistrict ||
      filters.agency ||
      filters.status ||
      filters.dateFrom ||
      filters.dateTo,
  )

  // Last loaded page (zero-based) for "Load more", and a request token so a slow
  // response for stale filters can never overwrite the current results.
  const pageRef = useRef(0)
  const reqRef = useRef(0)

  useEffect(() => {
    getCaseExplorerOptions()
      .then(setOptions)
      .catch((err) => console.error('Failed to load explorer options:', err))
  }, [])

  // Load one page. `append` accumulates ("Load more"); otherwise it replaces and
  // starts a fresh result set (new filters / first load).
  const fetchPage = useCallback(
    (pageIndex: number, append: boolean) => {
      const id = ++reqRef.current
      pageRef.current = pageIndex
      if (append) setLoadingMore(true)
      else setLoading(true)
      setError(null)
      getNycCaseExplorerPage(filters, pageIndex, PAGE_SIZE)
        .then((res) => {
          if (id !== reqRef.current) return
          setRows((prev) => (append ? [...prev, ...res.rows] : res.rows))
          setHasMore(res.hasMore)
          setNotice(res.notice ?? null)
        })
        .catch((err: unknown) => {
          if (id !== reqRef.current) return
          console.error('Case Explorer load failed:', err)
          setError({ message: errorMessage(err), timedOut: isTimeoutError(err) })
          if (!append) {
            setRows([])
            setHasMore(false)
            setNotice(null)
          }
        })
        .finally(() => {
          if (id !== reqRef.current) return
          setLoading(false)
          setLoadingMore(false)
        })
    },
    [filters],
  )

  // Reload from the first page whenever the filters change.
  useEffect(() => {
    fetchPage(0, false)
  }, [fetchPage])

  const set = (patch: Partial<CaseExplorerFilters>) => onFiltersChange({ ...filters, ...patch })

  // Count-free result label. We never claim an exact total over the 3.4M-row
  // table — just how many rows are loaded and whether more are available.
  const countLabel = error
    ? error.timedOut
      ? 'Query timed out'
      : 'Live data unavailable'
    : loading
      ? 'Loading…'
      : rows.length === 0
        ? 'No results'
        : hasMore
          ? `Showing ${fmtInt(rows.length)} results · More results available`
          : `Showing ${fmtInt(rows.length)} result${rows.length === 1 ? '' : 's'}`

  return (
    <div className="mt-6 space-y-4">
      <section className="card p-5">
        <div className="flex flex-wrap items-end gap-3">
          <FilterText label="Search (case ID, type, address)" value={filters.search ?? ''} onChange={(v) => set({ search: v || undefined })} />
          <FilterSelect label="Complaint type" value={filters.complaintType ?? ''} options={options?.complaintTypes ?? []} onChange={(v) => set({ complaintType: v || undefined })} />
          <FilterSelect label="Borough" value={filters.borough ?? ''} options={options?.boroughs ?? []} onChange={(v) => set({ borough: v || undefined })} />
          <FilterSelect label="Council district" value={filters.councilDistrict ?? ''} options={options?.councilDistricts ?? []} onChange={(v) => set({ councilDistrict: v || undefined })} />
          <FilterSelect label="Agency / dept" value={filters.agency ?? ''} options={options?.agencies ?? []} onChange={(v) => set({ agency: v || undefined })} />
          <FilterSelect label="Status" value={filters.status ?? ''} options={options?.statuses ?? []} onChange={(v) => set({ status: v || undefined })} />
          <FilterDate label="From" value={filters.dateFrom ?? ''} onChange={(v) => set({ dateFrom: v || undefined })} />
          <FilterDate label="To" value={filters.dateTo ?? ''} onChange={(v) => set({ dateTo: v || undefined })} />
          <button type="button" onClick={() => onFiltersChange({})} className="btn-secondary text-xs py-1.5 px-3">
            Clear
          </button>
        </div>
      </section>

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between text-xs text-ink-subtle">
          <span>{countLabel}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider">Live data</span>
        </div>

        {notice && !error && (
          <div className="mb-3 rounded-md border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs text-sky-900">{notice}</div>
        )}

        {error ? (
          error.timedOut && !hasAnyFilter ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-8 text-center text-sm text-ink-muted">
              Select a complaint type, borough, district, or date range to search historical cases.
            </div>
          ) : error.timedOut ? (
            <CaseExplorerTimeout detail={error.message} />
          ) : (
            <SectionError name="the case list" error={error.message} />
          )
        ) : loading ? (
          <div className="animate-pulse rounded-md bg-slate-100/70 py-10 text-center text-sm text-ink-subtle">Loading live data…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-ink-subtle">No cases match these filters.</div>
        ) : (
          <Table
            head={['Case ID', 'Submitted', 'Status', 'Complaint type', 'Borough', 'District', 'Closure']}
            align={['left', 'right', 'left', 'left', 'left', 'right', 'right']}
            rows={rows.map((r) => {
              const dur = closureDurationDays(r)
              return {
                key: r.case_id,
                onClick: () => navigate(`/app/nyc_case/${encodeURIComponent(r.case_id)}`),
                cells: [
                  r.case_id,
                  fmtDate(r.submitted_at),
                  r.status ?? '—',
                  r.complaint_type ?? '—',
                  r.borough ?? '—',
                  r.council_district ? String(Number(r.council_district)) : '—',
                  dur == null ? '—' : `${dur} d`,
                ],
              }
            })}
          />
        )}

        {!error && hasMore && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => fetchPage(pageRef.current + 1, true)}
              className="btn-secondary text-xs py-1.5 px-4 disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

function FilterText({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-ink-subtle">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Search…" className="mt-1 w-56 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-accent-500 focus:outline-none" />
    </label>
  )
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-ink-subtle">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-44 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-accent-500 focus:outline-none">
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  )
}

function FilterDate({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-ink-subtle">{label}</span>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-40 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-accent-500 focus:outline-none" />
    </label>
  )
}

// ---------------------------------------------------------------------------
// Open cases queue tab
// ---------------------------------------------------------------------------

// Fallback aging buckets, computed from loaded rows only when the full-population
// aggregate view (v_nyc_open_aging_buckets) is unavailable.
const AGING_BUCKETS: { label: string; test: (d: number) => boolean }[] = [
  { label: '0–2 days', test: (d) => d <= 2 },
  { label: '3–7 days', test: (d) => d >= 3 && d <= 7 },
  { label: '8–14 days', test: (d) => d >= 8 && d <= 14 },
  { label: '15+ days', test: (d) => d >= 15 },
]

// Plain-language status for an open-case aging bucket, classified by the bucket's
// lower-bound day count. These are POC interpretation thresholds for demo reading,
// NOT an official City service-level standard. Robust to 3- or 4-bucket views.
type AgingStatus = 'current' | 'watch' | 'aging' | 'backlog'

const AGING_STATUS_META: Record<AgingStatus, { label: string; pill: string; border: string }> = {
  current: { label: 'Current', pill: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200', border: 'border-l-emerald-400' },
  watch: { label: 'Watch', pill: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200', border: 'border-l-amber-400' },
  aging: { label: 'Aging', pill: 'bg-orange-50 text-orange-800 ring-1 ring-inset ring-orange-200', border: 'border-l-orange-500' },
  backlog: { label: 'Backlog', pill: 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200', border: 'border-l-rose-500' },
}

function agingStatus(label: string): AgingStatus {
  const lower = parseInt(label, 10) // leading day count: "8–14 days" → 8, "15+ days" → 15
  if (!Number.isFinite(lower)) return 'current'
  if (lower >= 15) return 'backlog'
  if (lower >= 8) return 'aging'
  if (lower >= 3) return 'watch'
  return 'current'
}

const AGING_THRESHOLD_HELP =
  'These colours show how long open benchmark cases have been waiting. Thresholds are for demo interpretation and can be replaced with City SLA rules.'

const OPEN_PAGE_SIZE = 25
const DIVERSIFIED_SIZE = 60

type QueueMode = 'priority' | 'diversified'

function OpenCasesQueue() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState<OpenQueueFilters>({})
  const [mode, setMode] = useState<QueueMode>('priority')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<OpenReviewRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState<OpenQueueOptions | null>(null)

  // Aging buckets across the FULL open population (not just the loaded page).
  const aging = useLive<OpenAgingBucket[]>(getNycOpenAgingBuckets)

  useEffect(() => {
    getOpenQueueOptions()
      .then(setOptions)
      .catch((err) => console.error('Failed to load open-queue options:', err))
  }, [])

  // Reset paging when the filters or the queue mode change.
  useEffect(() => {
    setPage(0)
  }, [filters, mode])

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    const load =
      mode === 'diversified'
        ? getNycOpenQueueDiversified(filters, DIVERSIFIED_SIZE).then((r) => ({ rows: r, hasMore: false }))
        : getNycOpenQueuePage(filters, page, OPEN_PAGE_SIZE)
    load
      .then((res) => {
        if (!live) return
        // Priority mode appends on "load more"; diversified replaces.
        setRows((prev) => (mode === 'priority' && page > 0 ? [...prev, ...res.rows] : res.rows))
        setHasMore(res.hasMore)
      })
      .catch((err: unknown) => {
        if (!live) return
        console.error('Open queue load failed:', err)
        setError(errorMessage(err))
        setRows([])
        setHasMore(false)
      })
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [filters, mode, page])

  const set = (patch: Partial<OpenQueueFilters>) => setFilters((f) => ({ ...f, ...patch }))

  // Aging cards: prefer the full-population aggregate; fall back to the loaded
  // rows (with a caveat) only if the aggregate view is not available yet.
  const agingFallback = aging.error || (aging.data && aging.data.length === 0)
  const agingCards = useMemo(() => {
    if (aging.data && aging.data.length) return aging.data.map((b) => ({ label: b.bucket, count: b.total_cases }))
    return AGING_BUCKETS.map((b) => ({
      label: b.label,
      count: rows.filter((r) => r.age_days != null && b.test(r.age_days)).length,
    }))
  }, [aging.data, rows])

  // First load (no rows yet) and erroring before anything rendered → clear notice.
  if (error && rows.length === 0) {
    return (
      <div className="mt-6 card p-6">
        <h2 className="text-sm font-semibold text-navy-900">Open cases unavailable</h2>
        <p className="mt-1 text-sm text-ink-muted">
          The review priority queue reads the open public 311 benchmark review queue. It could not be loaded right now.
        </p>
        <p className="mt-2 font-mono text-[11px] text-ink-subtle">{error}</p>
      </div>
    )
  }

  const showLoadMore = mode === 'priority' && hasMore

  return (
    <div className="mt-6 space-y-6">
      <SectionShell
        name="open-case aging"
        title="Open-case aging"
        subtitle={
          agingFallback
            ? 'How long open cases have been waiting (loaded sample — full aggregate unavailable).'
            : 'How long open cases have been waiting, across all open cases.'
        }
        loading={aging.loading && !aging.data}
        error={null}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {agingCards.map((b) => {
            const meta = AGING_STATUS_META[agingStatus(b.label)]
            return (
              <div
                key={b.label}
                title={AGING_THRESHOLD_HELP}
                className={`rounded-lg border border-l-4 border-slate-200 bg-white p-3.5 ${meta.border}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{b.label}</div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.pill}`}>{meta.label}</span>
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-navy-900">{fmtInt(b.count)}</div>
              </div>
            )
          })}
        </div>
        <p className="mt-3 text-[11px] text-ink-subtle" title={AGING_THRESHOLD_HELP}>
          Compared against POC review-age thresholds, not an official City SLA.
        </p>
      </SectionShell>

      <SectionShell
        name="the review priority queue"
        title="Review priority queue"
        subtitle="Highest review priority first. Decision support — staff review and decide."
        loading={false}
        error={error && rows.length > 0 ? error : null}
        action={
          <div role="tablist" aria-label="Queue order" className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <QueueModeTab label="Priority order" active={mode === 'priority'} onClick={() => setMode('priority')} />
            <QueueModeTab label="Diversified" active={mode === 'diversified'} onClick={() => setMode('diversified')} />
          </div>
        }
      >
        <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <FilterSelect label="Priority tier" value={filters.priorityTier ?? ''} options={options?.priorityTiers ?? []} onChange={(v) => set({ priorityTier: v || undefined })} />
          <FilterSelect label="Complaint type" value={filters.complaintType ?? ''} options={options?.complaintTypes ?? []} onChange={(v) => set({ complaintType: v || undefined })} />
          <FilterSelect label="Borough" value={filters.borough ?? ''} options={options?.boroughs ?? []} onChange={(v) => set({ borough: v || undefined })} />
          <FilterSelect label="Council district" value={filters.councilDistrict ?? ''} options={options?.councilDistricts ?? []} onChange={(v) => set({ councilDistrict: v || undefined })} />
          <FilterSelect label="Status" value={filters.status ?? ''} options={options?.statuses ?? []} onChange={(v) => set({ status: v || undefined })} />
        </div>

        <div className="mb-2 flex items-center justify-between text-[11px] text-ink-subtle">
          <span>
            {loading && rows.length === 0
              ? 'Loading…'
              : mode === 'diversified'
                ? `Showing ${fmtInt(rows.length)} cases — varied complaint types, priority-ranked`
                : `Showing ${fmtInt(rows.length)} open cases${hasMore ? '+' : ''}`}
          </span>
          {Object.keys(filters).length > 0 && (
            <button type="button" onClick={() => setFilters({})} className="font-medium text-accent-700 hover:text-accent-900">
              Clear filters
            </button>
          )}
        </div>

        {loading && rows.length === 0 ? (
          <div className="animate-pulse rounded-md bg-slate-100/70 py-10 text-center text-sm text-ink-subtle">Loading live data…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-ink-subtle">No open cases match these filters.</div>
        ) : (
          <Table
            head={['Priority', 'Tier', 'Reason', 'Age', 'Due', 'Complaint type', 'Borough / district']}
            align={['right', 'left', 'left', 'right', 'left', 'left', 'left']}
            rows={rows.map((r) => ({
              key: r.case_id,
              onClick: () => navigate(`/app/nyc_case/${encodeURIComponent(r.case_id)}`),
              cells: [
                r.priority_score == null ? '—' : r.priority_score.toFixed(0),
                r.priority_tier ?? '—',
                r.priority_reason ?? '—',
                r.age_days == null ? '—' : `${r.age_days} d`,
                fmtDate(r.due_date),
                r.complaint_type ?? '—',
                [r.borough, r.council_district ? `D${Number(r.council_district)}` : null].filter(Boolean).join(' · ') || '—',
              ],
            }))}
          />
        )}

        {showLoadMore && (
          <div className="mt-4 flex justify-center">
            <button type="button" disabled={loading} onClick={() => setPage((p) => p + 1)} className="btn-secondary text-xs py-1.5 px-4 disabled:opacity-50">
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </SectionShell>
    </div>
  )
}

function QueueModeTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
        active ? 'bg-white text-navy-900 shadow-sm ring-1 ring-slate-200' : 'text-ink-subtle hover:text-navy-900'
      }`}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Shared UI
// ---------------------------------------------------------------------------

function SectionShell({
  name,
  title,
  subtitle,
  loading,
  error,
  empty,
  action,
  children,
}: {
  name: string
  title: string
  subtitle: string
  loading: boolean
  error: string | null
  empty?: boolean
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
          <p className="mt-0.5 text-xs text-ink-subtle">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {action}
          {error ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-inset ring-amber-200">
              <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
              Live data unavailable
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-subtle">
              Live data
            </span>
          )}
        </div>
      </div>
      <div className="mt-4">
        {error ? (
          <SectionError name={name} error={error} />
        ) : loading ? (
          <div className="animate-pulse rounded-md bg-slate-100/70 py-10 text-center text-sm text-ink-subtle">Loading live data…</div>
        ) : empty ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-ink-subtle">No records available for this section.</div>
        ) : (
          children
        )}
      </div>
    </section>
  )
}

function SectionError({ name, error }: { name: string; error: string }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
      <div className="font-semibold">Live data unavailable.</div>
      <div className="mt-0.5">Unable to load {name}.</div>
      <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] text-amber-800">{error}</pre>
    </div>
  )
}

type TableRow = { key: string; cells: string[]; onClick?: () => void }
type Align = 'left' | 'right'

function Table({ head, rows, align }: { head: string[]; rows: TableRow[]; align: Align[] }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-ink-subtle">
            {head.map((h, i) => (
              <th key={h} className={`px-2 py-2 font-semibold ${align[i] === 'right' ? 'text-right' : 'text-left'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} onClick={row.onClick} className={`border-b border-slate-100 ${row.onClick ? 'cursor-pointer hover:bg-slate-50' : ''}`}>
              {row.cells.map((cell, i) => (
                <td key={i} className={`px-2 py-2 ${align[i] === 'right' ? 'text-right tabular-nums text-ink-muted' : 'text-ink'}`}>
                  {align[i] === 'left' && i === 0 ? <span className="font-medium text-navy-900">{cell}</span> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
