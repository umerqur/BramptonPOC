import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWorkflow } from '../../lib/workflowStore'
import NYCWorkloadMapPanel from './NYCWorkloadMapPanel'
import {
  getInsightsKpis,
  getInsightsComplaintTypeVolume,
  getInsightsClosureBottlenecks,
  getInsightsAreaBottlenecks,
  getInsightsDepartmentWorkload,
  getInsightsMonthlyTrend,
  getInsightsChannelMix,
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
import { getNYCWorkloadByBorough, type NYCBoroughWorkload } from '../../services/municipalServiceRequests'

// Insights — operational workload intelligence over the New York City 311 public
// service request dataset. Three tabs: Overview (map, KPIs, charts), Case
// Explorer (paginated, filtered case search + detail), and Open cases (review
// priority queue, when the open dataset is loaded). Every aggregate reads a small
// materialized view; the Case Explorer reads paginated, filtered rows — never the
// full table. No fake placeholder values: a failed live read shows a clear error.

type Tab = 'overview' | 'explorer' | 'open' | 'simulations'

/** A geographic area selected on the workload map, for the bottleneck drilldown. */
type SelectedArea = { mode: 'district' | 'borough'; value: string }

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
        <SourceLine label="Data source" value="New York City 311 public service requests" />
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

export default function InsightsDashboard() {
  const [tab, setTab] = useState<Tab>('overview')
  const [filters, setFilters] = useState<CaseExplorerFilters>({})

  // Drill into the Case Explorer from any chart segment.
  const explore = (f: CaseExplorerFilters) => {
    setFilters(f)
    setTab('explorer')
  }

  return (
    <div className="mt-6">
      <div role="tablist" aria-label="Insights sections" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
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
    title: 'Stress Testing',
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
      className={`group relative flex min-w-[168px] flex-1 items-start gap-2.5 overflow-hidden rounded-xl border px-3.5 py-2.5 text-left transition ${
        active
          ? 'border-slate-200 bg-white shadow-sm ring-1 ring-slate-100'
          : 'border-transparent bg-slate-50/70 hover:bg-slate-100'
      }`}
    >
      {/* Accent top border marks the active mode. */}
      {active && <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-accent-500" />}
      <span className={`mt-0.5 shrink-0 ${active ? 'text-accent-600' : 'text-ink-subtle group-hover:text-navy-900'}`}>
        {tab.icon}
      </span>
      <span className="min-w-0">
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
  // A map click updates the Bottleneck Drilldown panel below the map (it does NOT
  // jump straight to the Case Explorer) so staff see the diagnosis first; the
  // panel's own button opens the matching cases.
  const [selectedArea, setSelectedArea] = useState<SelectedArea | null>(null)
  return (
    <div className="mt-6 space-y-6">
      <OperationalSnapshot />
      <NYCWorkloadMapPanel onSelectArea={(mode, value) => setSelectedArea({ mode, value })} />
      <BottleneckDrilldownPanel selectedArea={selectedArea} onExplore={onExplore} />
      <ComplaintTypeRanked onExplore={onExplore} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ChannelMixDonut />
        <OpenStatusMixDonut />
      </div>
      <TrendSection onExplore={onExplore} />
      <ClosureScatter onExplore={onExplore} />
      <ClosureBottlenecks onExplore={onExplore} />
      <AreaBottlenecks onExplore={onExplore} />
      <DepartmentWorkload onExplore={onExplore} />
    </div>
  )
}

// --- Operational snapshot --------------------------------------------------

/**
 * Operational snapshot — six KPI cards, each with a current value, a benchmark
 * or target, a plain-language direction/status badge, and a helper line. Below
 * the cards sits a small benchmark-context strip with the historical NYC 311
 * reference figures in plain operational language (no statistical jargon).
 *
 * Live open-queue figures come from v_nyc_open_review_queue; the workflow
 * throughput figures (readiness, drafts, time saved, approved closures) come
 * from the in-app workflow store; the historical benchmark comes from
 * v_insights_kpis.
 */
function OperationalSnapshot() {
  const hist = useLive<InsightsKpis>(getInsightsKpis)
  const open = useLive<OpenQueueSummary>(getNycOpenQueueSummary)
  const { metrics, cases } = useWorkflow()

  const high = open.data?.highPriority ?? null

  // Share of AI-summarized files that reached high review readiness (enough
  // context to prepare a closure draft). AI assists readiness; staff still decide.
  const readinessPct =
    metrics.aiSummariesGenerated > 0
      ? Math.round((metrics.closureDraftsPrepared / metrics.aiSummariesGenerated) * 100)
      : null
  // Assigned to an officer but no field outcome recorded yet — work stuck waiting
  // on a field inspection.
  const fieldPending = cases.filter((c) => c.assignedOfficer && !c.fieldAction && c.stage !== 'closed').length
  // Closure drafts in staff-review (plus approved-awaiting-close) — work stuck
  // waiting on a supervisor approval decision.
  const approvalsPending = cases.filter((c) => c.stage === 'staff-review' || c.stage === 'approved').length

  // Open-queue value cells degrade to "—" with a clear note when not loaded.
  const openValue = open.loading ? '…' : open.error ? '—' : fmtInt(open.data?.total ?? 0)
  const highValue = open.loading ? '…' : open.error || high == null ? '—' : fmtInt(high)

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-navy-900">Operational snapshot</h2>
          <p className="mt-0.5 text-xs text-ink-subtle">
            Where work is stuck across the enforcement response workflow — each KPI shows a value, a benchmark, and
            whether it is on track.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-subtle">
          Live data
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          title="Open cases waiting"
          value={openValue}
          direction="lower"
          status="neutral"
          benchmark={open.error ? 'Open queue not loaded' : 'Monitor vs. last refresh or operational target'}
          helper="Current backlog of open cases that may need review"
        />
        <KpiCard
          title="High priority cases"
          value={highValue}
          direction="lower"
          status={high == null || open.error ? 'neutral' : high >= 20 ? 'attention' : high >= 15 ? 'watch' : 'good'}
          benchmark="Target below 20"
          helper="Urgent cases surfaced first for review"
          note="Lower is better after staff action"
        />
        <KpiCard
          title="AI ready for staff review"
          value={readinessPct == null ? '—' : `${readinessPct}%`}
          direction="higher"
          status={readinessPct == null ? 'neutral' : readinessPct >= 80 ? 'good' : readinessPct >= 60 ? 'watch' : 'attention'}
          benchmark="Target 80% or higher"
          helper="Files with enough context to prepare a closure draft"
        />
        <KpiCard
          title="Field investigation pending"
          value={fmtInt(fieldPending)}
          direction="lower"
          status={fieldPending === 0 ? 'good' : 'neutral'}
          benchmark="Target 0 pending overnight"
          helper="Assigned cases waiting on officer outcome"
        />
        <KpiCard
          title="Closure approvals pending"
          value={fmtInt(approvalsPending)}
          direction="lower"
          status={approvalsPending === 0 ? 'good' : 'neutral'}
          benchmark="Target 0 pending overnight"
          helper="Drafts waiting for supervisor approval"
        />
        <KpiCard
          title="Estimated staff time saved"
          value={`${fmtInt(metrics.manualResearchHoursAvoided)} hrs`}
          direction="higher"
          status="good"
          benchmark="Compared with manual research and drafting baseline"
          helper="Research and drafting effort avoided"
        />
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-ink-subtle">
        AI assists readiness, summaries, and drafting. Staff assign, inspect, approve, and close.
      </p>

      <BenchmarkContextStrip state={hist} />
    </section>
  )
}

type KpiDirection = 'higher' | 'lower'
// 'neutral' simply shows the orientation; 'good' is on-track; 'watch'/'attention'
// flag a benchmark breach.
type KpiStatus = 'neutral' | 'good' | 'watch' | 'attention'

const KPI_BADGE: Record<KpiStatus, { className: string }> = {
  neutral: { className: 'bg-slate-100 text-slate-600' },
  good: { className: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200' },
  watch: { className: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200' },
  attention: { className: 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200' },
}

/** Direction/status label: orientation by default, or Watch / Needs attention on a breach. */
function kpiBadgeLabel(direction: KpiDirection, status: KpiStatus): string {
  if (status === 'watch') return 'Watch'
  if (status === 'attention') return 'Needs attention'
  return direction === 'higher' ? 'Higher is better' : 'Lower is better'
}

/**
 * One KPI card: current value, benchmark/target, a plain-language direction or
 * status badge, and a helper line. No statistical jargon.
 */
function KpiCard({
  title,
  value,
  benchmark,
  helper,
  direction,
  status,
  note,
}: {
  title: string
  value: string
  benchmark: string
  helper: string
  direction: KpiDirection
  status: KpiStatus
  note?: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{title}</div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${KPI_BADGE[status].className}`}
        >
          {kpiBadgeLabel(direction, status)}
        </span>
      </div>
      <div className="mt-1.5 text-3xl font-bold tabular-nums text-navy-900">{value}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-muted">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`h-3 w-3 shrink-0 ${direction === 'higher' ? 'text-emerald-600' : 'text-sky-600'}`}
        >
          {direction === 'higher' ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M5 12l7 7 7-7" />}
        </svg>
        <span>Benchmark: {benchmark}</span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">{helper}</p>
      {note && <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-ink-subtle">{note}</p>}
    </div>
  )
}

/**
 * Benchmark context strip — the historical NYC 311 reference figures in plain
 * operational language. Uses "Typical historical closure" instead of an average
 * label, and "Slow case threshold" instead of "P90".
 */
function BenchmarkContextStrip({ state }: { state: LiveState<InsightsKpis> }) {
  const { data, loading, error } = state
  return (
    <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">Benchmark context</div>
      {error ? (
        <p className="mt-1 text-xs text-ink-subtle">Historical benchmark unavailable right now.</p>
      ) : loading ? (
        <p className="mt-1 text-xs text-ink-subtle">Loading historical benchmark…</p>
      ) : data ? (
        <>
          <p className="mt-1 text-xs text-ink-muted">
            {fmtInt(data.closed_requests)} closed public NYC 311 records used to compare workload patterns and closure
            language.
          </p>
          <dl className="mt-2 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
            <BenchmarkItem
              label="Typical historical closure"
              value={data.avg_closure_days == null ? '—' : `${data.avg_closure_days.toFixed(1)} days`}
            />
            <BenchmarkItem
              label="Slow case threshold"
              value={
                data.p90_closure_days == null
                  ? '—'
                  : `most similar cases closed within ${Math.round(data.p90_closure_days)} days`
              }
            />
            <BenchmarkItem
              label="Top workload pressure"
              value={
                [data.top_complaint_type, data.busiest_council_district ? `District ${data.busiest_council_district}` : null]
                  .filter(Boolean)
                  .join(', ') || '—'
              }
            />
          </dl>
        </>
      ) : null}
    </div>
  )
}

function BenchmarkItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-navy-900">{value}</dd>
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

// --- Area bottlenecks ------------------------------------------------------

function AreaBottlenecks({ onExplore }: { onExplore: (f: CaseExplorerFilters) => void }) {
  const { data, loading, error } = useLive<AreaBottleneck[]>(() => getInsightsAreaBottlenecks(12))
  return (
    <SectionShell name="district workload pressure" title="District workload pressure" subtitle="Districts with the highest case volume and closure pressure." loading={loading} error={error} empty={data?.length === 0}>
      {data && (
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

// --- Department workload ---------------------------------------------------

function DepartmentWorkload({ onExplore }: { onExplore: (f: CaseExplorerFilters) => void }) {
  const { data, loading, error } = useLive<InsightsDepartmentWorkload[]>(() => getInsightsDepartmentWorkload(12))
  return (
    <SectionShell name="department workload" title="Department workload" subtitle="Caseload by agency / assigned department." loading={loading} error={error} empty={data?.length === 0}>
      {data && (
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
// Bottleneck drilldown (Overview) — diagnose a map-selected area
// ---------------------------------------------------------------------------

/** Normalize a council-district value to a plain number string ("05" → "5"). */
const districtKey = (v: string | null): string => {
  if (v == null) return ''
  const n = Number(v)
  return Number.isFinite(n) ? String(n) : String(v).trim()
}

/**
 * Operational read for a council district — plain-language diagnosis derived from
 * the area's volume, long-tail closure time, and top complaint type, RELATIVE to
 * the other areas in the current benchmark view. This is decision support, not a
 * recommendation engine: it says "Operational read", never "AI recommends".
 */
function districtOperationalRead(row: AreaBottleneck, areas: AreaBottleneck[]): string[] {
  const reads: string[] = []
  const maxTotal = Math.max(0, ...areas.map((a) => a.total_cases))
  if (maxTotal > 0 && row.total_cases >= 0.66 * maxTotal) {
    reads.push(
      'This area has a heavier complaint load than most areas in the current benchmark view. Supervisor action could include earlier review sequencing or temporary reassignment.',
    )
  }
  const p90s = areas
    .map((a) => a.p90_closure_days)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b)
  const medianP90 = p90s.length ? p90s[Math.floor(p90s.length / 2)] : null
  if (row.p90_closure_days != null && medianP90 != null && row.p90_closure_days >= medianP90 * 1.25) {
    reads.push('Long tail closure time is elevated. This points to complex or stale files rather than only volume.')
  }
  if (row.top_complaint_type) {
    reads.push(
      `Most pressure is concentrated in ${row.top_complaint_type}, so routing and template review can focus there first.`,
    )
  }
  if (reads.length === 0) {
    reads.push('Workload here is close to the benchmark average for this view. No single pressure signal stands out.')
  }
  return reads
}

function BottleneckDrilldownPanel({
  selectedArea,
  onExplore,
}: {
  selectedArea: SelectedArea | null
  onExplore: (f: CaseExplorerFilters) => void
}) {
  // Small materialized aggregates — never a full-table scan. Pull enough council
  // districts to cover any selected one (NYC has 51).
  const areas = useLive<AreaBottleneck[]>(() => getInsightsAreaBottlenecks(60))
  const boroughVolumes = useLive<NYCBoroughWorkload[]>(getNYCWorkloadByBorough)

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-navy-900">Bottleneck drilldown</h2>
          <p className="mt-0.5 text-xs text-ink-subtle">What is driving workload in the selected area.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-subtle">
          Live data
        </span>
      </div>

      <div className="mt-4">
        {!selectedArea ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50/70 px-4 py-6 text-center text-sm text-ink-subtle">
            Select a council district or borough on the map above to see what is driving its workload.
          </div>
        ) : selectedArea.mode === 'district' ? (
          <DistrictBottleneck area={areas} value={selectedArea.value} onExplore={onExplore} />
        ) : (
          <BoroughBottleneck volumes={boroughVolumes} value={selectedArea.value} onExplore={onExplore} />
        )}
      </div>
    </section>
  )
}

function DistrictBottleneck({
  area,
  value,
  onExplore,
}: {
  area: LiveState<AreaBottleneck[]>
  value: string
  onExplore: (f: CaseExplorerFilters) => void
}) {
  const { data, loading, error } = area
  if (loading) return <div className="animate-pulse rounded-md bg-slate-100/70 py-8 text-center text-sm text-ink-subtle">Loading live data…</div>
  if (error) return <SectionError name="the area bottleneck aggregate" error={error} />

  const rows = data ?? []
  const row = rows.find((r) => districtKey(r.council_district) === districtKey(value))
  const openCases = () => onExplore({ councilDistrict: districtKey(value) })

  if (!row) {
    return (
      <div className="space-y-3">
        <AreaHeading label={`District ${districtKey(value)}`} sub="Selected council district" />
        <p className="text-sm text-ink-muted">
          No bottleneck aggregate is available for this district in the current benchmark view. You can still open its
          cases directly.
        </p>
        <OpenCasesButton onClick={openCases} />
      </div>
    )
  }

  const reads = districtOperationalRead(row, rows)
  return (
    <div className="space-y-4">
      <AreaHeading label={`District ${districtKey(row.council_district)}`} sub="Selected council district" />
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Total cases" value={fmtInt(row.total_cases)} />
        <Metric label="Avg closure" value={fmtDays(row.avg_closure_days)} />
        <Metric label="Slow case (P90)" value={fmtDays(row.p90_closure_days)} />
        <Metric label="Top complaint type" value={row.top_complaint_type ?? '—'} />
      </dl>
      <OperationalRead reads={reads} />
      <OpenCasesButton onClick={openCases} />
    </div>
  )
}

function BoroughBottleneck({
  volumes,
  value,
  onExplore,
}: {
  volumes: LiveState<NYCBoroughWorkload[]>
  value: string
  onExplore: (f: CaseExplorerFilters) => void
}) {
  const { data, loading, error } = volumes
  const openCases = () => onExplore({ borough: value })

  const match = (data ?? []).find((b) => b.borough.trim().toLowerCase() === value.trim().toLowerCase())

  return (
    <div className="space-y-4">
      <AreaHeading label={value} sub="Selected borough" />
      {loading ? (
        <div className="animate-pulse rounded-md bg-slate-100/70 py-6 text-center text-sm text-ink-subtle">Loading live data…</div>
      ) : error ? (
        <p className="text-sm text-ink-muted">Borough workload volume is unavailable right now.</p>
      ) : match ? (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Complaint volume" value={fmtInt(match.complaint_volume)} />
        </dl>
      ) : (
        <p className="text-sm text-ink-muted">No borough-level workload volume is available for {value}.</p>
      )}
      <div className="rounded-md border border-slate-200 bg-slate-50/70 px-4 py-3 text-xs leading-relaxed text-ink-muted">
        <span className="font-semibold text-ink">Operational read:</span> Borough is the broad executive view. Council
        district carries deeper bottleneck metrics right now (average and long-tail closure time, top complaint type), so
        drill into a council district for a sharper diagnosis. Use the button below to review this borough's cases.
      </div>
      <OpenCasesButton onClick={openCases} />
    </div>
  )
}

function AreaHeading({ label, sub }: { label: string; sub: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{sub}</div>
      <div className="text-2xl font-semibold text-navy-900">{label}</div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className="mt-1 truncate text-base font-semibold tabular-nums text-navy-900">{value}</div>
    </div>
  )
}

function OperationalRead({ reads }: { reads: string[] }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/70 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">Operational read</div>
      <ul className="mt-1.5 space-y-1.5 text-sm text-ink-muted">
        {reads.map((r) => (
          <li key={r} className="flex gap-2">
            <span aria-hidden className="mt-0.5 text-accent-500">•</span>
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function OpenCasesButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="btn-primary text-sm py-2 px-4">
      Open matching cases in Case Explorer →
    </button>
  )
}

// ---------------------------------------------------------------------------
// Simulations tab — capacity and backlog stress test
// ---------------------------------------------------------------------------

type Scenario = 'current' | 'reduced' | 'surge'

const SCENARIO_LABEL: Record<Scenario, string> = {
  current: 'Current capacity',
  reduced: 'Reduced capacity',
  surge: 'Surge week',
}

const SCENARIO_NOTE: Record<Scenario, string> = {
  current: 'Baseline staffing assumption.',
  reduced: 'Shows impact if fewer staff are available.',
  surge: 'Shows effect of increased incoming workload. Uses a simple 1.25× multiplier on open cases.',
}

const SURGE_MULTIPLIER = 1.25

/** True when a tier string is the High review-priority tier. */
const isHighTier = (tier: string | null) => (tier ?? '').trim().toLowerCase() === 'high'

/**
 * SimulationLab — an operations-style capacity stress test over the live open
 * review queue summary plus user-controlled planning assumptions. This is
 * scenario math, not a forecast: it helps staff reason about capacity, backlog,
 * and review sequencing. It never predicts enforcement outcomes.
 */
function SimulationLab() {
  const summary = useLive<OpenQueueSummary>(getNycOpenQueueSummary)
  const aging = useLive<OpenAgingBucket[]>(getNycOpenAgingBuckets)
  // A bounded, diversified sample — used as an honest fallback for the open/high
  // counts if the summary aggregate is unavailable, and for the main pressure type.
  const sample = useLive<OpenReviewRow[]>(() => getNycOpenQueueDiversified({}, 60))

  const [staff, setStaff] = useState(3)
  const [perStaff, setPerStaff] = useState(25)
  const [highFocus, setHighFocus] = useState(100)
  const [scenario, setScenario] = useState<Scenario>('current')

  const sampleRows = sample.data ?? []
  const summaryOk = !!summary.data
  // Prefer the precomputed summary; fall back to the loaded sample (labeled).
  const baseOpen = summary.data?.total ?? (sample.data ? sampleRows.length : null)
  const baseHigh =
    summary.data?.highPriority ?? (sample.data ? sampleRows.filter((r) => isHighTier(r.priority_tier)).length : null)
  const sampled = !summaryOk && sample.data != null

  const topPressure = useMemo(() => {
    const rows = sample.data ?? []
    if (!rows.length) return null
    const counts = new Map<string, number>()
    for (const r of rows) {
      const k = r.complaint_type ?? 'Uncategorized'
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    let top: string | null = null
    let max = 0
    for (const [k, v] of counts) if (v > max) { max = v; top = k }
    return top
  }, [sample.data])

  const topAging = useMemo(() => {
    const b = aging.data ?? []
    if (!b.length) return null
    return [...b].sort((x, y) => y.total_cases - x.total_cases)[0]
  }, [aging.data])

  // Scenario adjustments — deterministic planning assumptions, not predictions.
  const effectiveStaff = scenario === 'reduced' ? Math.max(1, Math.ceil(staff * 0.66)) : staff
  const openCases = baseOpen == null ? null : scenario === 'surge' ? Math.ceil(baseOpen * SURGE_MULTIPLIER) : baseOpen
  const high = baseHigh

  const dailyCapacity = Math.max(0, effectiveStaff) * Math.max(0, perStaff)
  const highCapacity = dailyCapacity * (Math.max(0, Math.min(100, highFocus)) / 100)
  const daysHigh = high != null && highCapacity > 0 ? Math.ceil(high / highCapacity) : null
  const daysAll = openCases != null && dailyCapacity > 0 ? Math.ceil(openCases / dailyCapacity) : null
  const capacityGap = openCases == null ? null : openCases - dailyCapacity

  // Deterministic status colors for the result cards (green manageable, amber
  // pressure, red critical). Thresholds are explicit and auditable.
  const daysAllStatus: SimStatus =
    daysAll == null ? 'neutral' : daysAll <= 14 ? 'good' : daysAll <= 60 ? 'watch' : 'critical'
  const capacityGapStatus: SimStatus =
    capacityGap == null || openCases == null
      ? 'neutral'
      : capacityGap <= 0
        ? 'good'
        : capacityGap >= openCases * 0.25
          ? 'critical'
          : 'watch'

  const dataUnavailable = baseOpen == null && !summary.loading && !sample.loading
  const loading = summary.loading && sample.loading

  return (
    <div className="mt-6 space-y-6">
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-navy-900">Capacity Stress Testing</h2>
            <p className="mt-0.5 text-xs text-ink-subtle">Backlog clearance under staffing assumptions — deterministic math, not a forecast.</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-subtle">
            Deterministic scenario
          </span>
        </div>

        {/* Inputs */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberInput label="Staff available" value={staff} min={1} max={50} onChange={setStaff} />
          <NumberInput label="Cases reviewed / staff / day" value={perStaff} min={1} max={200} onChange={setPerStaff} />
          <NumberInput label="High priority focus (%)" value={highFocus} min={0} max={100} onChange={setHighFocus} />
          <div>
            <span className="text-[11px] font-medium text-ink-subtle">Scenario</span>
            <div className="mt-1 inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(['current', 'reduced', 'surge'] as Scenario[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScenario(s)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                    scenario === s ? 'bg-white text-navy-900 shadow-sm ring-1 ring-slate-200' : 'text-ink-subtle hover:text-navy-900'
                  }`}
                >
                  {SCENARIO_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs text-ink-muted">
          <span className="font-semibold text-ink">{SCENARIO_LABEL[scenario]}:</span> {SCENARIO_NOTE[scenario]}
          {scenario === 'reduced' && (
            <span className="text-ink-subtle"> Effective staff this scenario: {effectiveStaff}.</span>
          )}
        </div>

        {dataUnavailable ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
            <div className="font-semibold">Open queue data unavailable.</div>
            <div className="mt-0.5">
              The open review queue summary could not be loaded, so the scenario math has no live open-case counts to work
              from. Capacity inputs above still apply once the open dataset is available.
            </div>
          </div>
        ) : loading ? (
          <div className="mt-4 animate-pulse rounded-md bg-slate-100/70 py-10 text-center text-sm text-ink-subtle">Loading live data…</div>
        ) : (
          <>
            {sampled && (
              <p className="mt-4 text-[11px] text-amber-800">
                Open-case counts are sampled from the open review queue (the full-population summary is unavailable), so
                these figures are a limited sample, not the full queue total.
              </p>
            )}
            <p className="mt-4 text-[11px] leading-relaxed text-ink-muted">
              This uses live open case counts and simple capacity math: staff available × cases per staff per day. It does
              not predict enforcement outcomes.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <SimCard label="Daily review capacity" value={fmtInt(dailyCapacity)} helper={`${effectiveStaff} staff × ${perStaff} cases/day`} />
              <SimCard label="High priority cases" value={high == null ? '—' : fmtInt(high)} helper={high == null ? 'Tier breakdown unavailable' : `${highFocus}% of capacity directed here first`} />
              <SimCard label="Days to clear high priority" value={daysHigh == null ? '—' : fmtInt(daysHigh)} helper="At current high-priority focus" />
              <SimCard
                label="Days to clear open queue"
                value={daysAll == null ? '—' : fmtInt(daysAll)}
                helper={openCases == null ? '—' : `${fmtInt(openCases)} open cases this scenario`}
                status={daysAllStatus}
              />
              <SimCard
                label="Capacity gap (day 1)"
                value={capacityGap == null ? '—' : `${capacityGap > 0 ? '+' : ''}${fmtInt(capacityGap)}`}
                helper={capacityGap == null ? '—' : capacityGap > 0 ? 'Open cases beyond one day of capacity' : 'Capacity covers the open queue in a day'}
                status={capacityGapStatus}
              />
              <SimCard
                label="Largest open case category"
                value={topPressure ?? '—'}
                helper={topPressure ? 'Most common type in the open sample' : 'Sample unavailable'}
              />
            </div>

            {topAging && (
              <p className="mt-3 text-[11px] text-ink-subtle">
                Main aging bucket: <span className="font-medium text-ink-muted">{topAging.bucket}</span> ({fmtInt(topAging.total_cases)} open cases).
              </p>
            )}
          </>
        )}

        <p className="mt-4 text-[11px] leading-relaxed text-ink-subtle">
          This is deterministic stress testing, not Monte Carlo simulation, not agent based modelling, and not a forecast.
          It is intended to help supervisors test staffing and backlog assumptions.
        </p>
      </section>
    </div>
  )
}

function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-ink-subtle">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (!Number.isFinite(n)) return
          onChange(Math.max(min, Math.min(max, Math.round(n))))
        }}
        className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm tabular-nums focus:border-accent-500 focus:outline-none"
      />
    </label>
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
// Case Explorer tab
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25

function CaseExplorer({ filters, onFiltersChange }: { filters: CaseExplorerFilters; onFiltersChange: (f: CaseExplorerFilters) => void }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<NycCaseRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState<CaseExplorerOptions | null>(null)

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
        })
        .catch((err: unknown) => {
          if (id !== reqRef.current) return
          console.error('Case Explorer load failed:', err)
          setError(errorMessage(err))
          if (!append) {
            setRows([])
            setHasMore(false)
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
    ? 'Live data unavailable'
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

        {error ? (
          <SectionError name="the case list" error={error} />
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
          The review priority queue reads the open NYC 311 review queue. It could not be loaded right now.
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
          {agingCards.map((b) => (
            <div key={b.label} className="rounded-lg border border-slate-200 bg-white p-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{b.label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-navy-900">{fmtInt(b.count)}</div>
            </div>
          ))}
        </div>
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
