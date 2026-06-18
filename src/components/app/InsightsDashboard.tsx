import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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

// Insights — operational workload intelligence over the New York City 311 public
// service request dataset. Three tabs: Overview (map, KPIs, charts), Case
// Explorer (paginated, filtered case search + detail), and Open cases (review
// priority queue, when the open dataset is loaded). Every aggregate reads a small
// materialized view; the Case Explorer reads paginated, filtered rows — never the
// full table. No fake placeholder values: a failed live read shows a clear error.

type Tab = 'overview' | 'explorer' | 'open'

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
  return (
    <div className="mt-6 space-y-6">
      <OperationalSnapshot />
      <NYCWorkloadMapPanel
        onSelectArea={(mode, value) =>
          onExplore(mode === 'district' ? { councilDistrict: value } : { borough: value })
        }
      />
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
 * Executive snapshot, directly below the source banner and above the map. Two
 * clearly separated bands:
 *
 *   1. Active open-case review queue — the LIVE open NYC 311 queue
 *      (v_nyc_open_tier_volume / v_nyc_open_review_queue). Visually prominent so
 *      the UI never implies there are zero active cases. If the open dataset is
 *      not loaded, this band says "Open queue not loaded" rather than showing a
 *      misleading zero.
 *   2. Historical workload intelligence — the closed-heavy NYC 311 history
 *      (v_insights_kpis). This is completed workload, not the active queue, so
 *      its "open in historical extract" figure is intentionally not surfaced here.
 */
function OperationalSnapshot() {
  const hist = useLive<InsightsKpis>(getInsightsKpis)
  const open = useLive<OpenQueueSummary>(getNycOpenQueueSummary)

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-navy-900">Operational snapshot</h2>
          <p className="mt-0.5 text-xs text-ink-subtle">Active review queue and historical workload at a glance.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-subtle">
          Live data
        </span>
      </div>

      <div className="mt-4 space-y-5">
        <ActiveOpenQueueBand state={open} />
        <HistoricalWorkloadBand state={hist} />
      </div>
    </section>
  )
}

/** Small band header: a label, a one-line description, and a subtle divider. */
function BandHeading({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-slate-100 pb-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-navy-900">{label}</h3>
      <span className="text-[11px] text-ink-subtle">{hint}</span>
    </div>
  )
}

/** A compact metric tile for the historical band. */
function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold tabular-nums text-navy-900" title={value}>
        {value}
      </div>
    </div>
  )
}

/**
 * Active open-case review queue band. The headline "Active open queue" card is
 * intentionally prominent (accent panel, large number). On a load failure or an
 * unavailable open dataset it shows a clear "Open queue not loaded" notice — no
 * fabricated zero.
 */
function ActiveOpenQueueBand({ state }: { state: LiveState<OpenQueueSummary> }) {
  const { data, loading, error } = state
  return (
    <div>
      <BandHeading label="Active open-case review queue" hint="Live open NYC 311 cases awaiting review." />
      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
          <div className="font-semibold">Open queue not loaded.</div>
          <div className="mt-0.5 text-xs">
            The active open NYC 311 review queue is not available yet. Load the open dataset to see live active cases.
          </div>
        </div>
      ) : loading ? (
        <div className="animate-pulse rounded-lg bg-slate-100/70 py-8 text-center text-sm text-ink-subtle">Loading live data…</div>
      ) : data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Prominent headline card. */}
          <div className="relative overflow-hidden rounded-xl border border-accent-200 bg-gradient-to-br from-accent-50 to-white p-4 shadow-sm sm:col-span-2 lg:col-span-1">
            <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-accent-500" />
            <div className="text-[10px] font-semibold uppercase tracking-wider text-accent-700">Active open queue</div>
            <div className="mt-1 text-3xl font-bold tabular-nums text-navy-900">{fmtInt(data.total)}</div>
            <div className="mt-0.5 text-[11px] text-ink-subtle">Open cases awaiting review · decision support</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">Open high-priority cases</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-navy-900">
              {data.highPriority == null ? '—' : fmtInt(data.highPriority)}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-subtle">
              {data.highPriority == null ? 'Review-priority tiers not loaded' : 'High review-priority tier'}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Historical workload intelligence band — the closed-heavy NYC 311 history. This
 * is completed workload data, NOT the active queue, so it never shows an
 * "open / active" figure that would imply a live backlog of zero.
 */
function HistoricalWorkloadBand({ state }: { state: LiveState<InsightsKpis> }) {
  const { data, loading, error } = state
  return (
    <div>
      <BandHeading label="Historical workload intelligence" hint="Closed-heavy NYC 311 history — completed workload." />
      {error ? (
        <SectionError name="the historical workload snapshot" error={error} />
      ) : loading ? (
        <div className="animate-pulse rounded-lg bg-slate-100/70 py-8 text-center text-sm text-ink-subtle">Loading live data…</div>
      ) : data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Historical records loaded" value={fmtInt(data.total_requests)} />
          <StatTile label="Closed historical records" value={fmtInt(data.closed_requests)} />
          <StatTile label="Avg historical closure" value={fmtDays(data.avg_closure_days)} />
          <StatTile label="P90 historical closure" value={fmtDays(data.p90_closure_days)} />
          <StatTile label="Busiest district" value={data.busiest_council_district ? `District ${data.busiest_council_district}` : '—'} />
          <StatTile label="Top historical complaint type" value={data.top_complaint_type ?? '—'} />
        </div>
      ) : null}
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
    <SectionShell name="the volume vs closure view" title="High volume + slow closure" subtitle="Each point is a complaint type. Top-right = busy and slow." loading={loading} error={error} empty={points.length === 0}>
      {data && points.length > 0 && <Scatter points={points} onExplore={onExplore} />}
    </SectionShell>
  )
}

function Scatter({ points, onExplore }: { points: ClosureBottleneck[]; onExplore: (f: CaseExplorerFilters) => void }) {
  const W = 520
  const H = 240
  const pad = 34
  const maxX = Math.max(1, ...points.map((p) => p.total_cases))
  const maxY = Math.max(1, ...points.map((p) => p.avg_closure_days ?? 0))
  const x = (v: number) => pad + (v / maxX) * (W - pad * 1.5)
  const y = (v: number) => H - pad - (v / maxY) * (H - pad * 1.5)
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Total cases vs average closure days by complaint type">
        <line x1={pad} y1={H - pad} x2={W - 6} y2={H - pad} stroke="#cbd5e1" />
        <line x1={pad} y1={6} x2={pad} y2={H - pad} stroke="#cbd5e1" />
        <text x={(W + pad) / 2} y={H - 6} textAnchor="middle" className="fill-ink-subtle" style={{ fontSize: 9 }}>Total cases →</text>
        <text x={10} y={H / 2} textAnchor="middle" transform={`rotate(-90 10 ${H / 2})`} className="fill-ink-subtle" style={{ fontSize: 9 }}>Avg closure days →</text>
        {points.map((p) => (
          <circle key={p.complaint_type} cx={x(p.total_cases)} cy={y(p.avg_closure_days ?? 0)} r={4.5} fill="#2563eb" fillOpacity={0.65} className="cursor-pointer" onClick={() => onExplore({ complaintType: p.complaint_type })}>
            <title>{`${p.complaint_type}\nCases: ${fmtInt(p.total_cases)}\nAvg closure: ${fmtDays(p.avg_closure_days)}`}</title>
          </circle>
        ))}
      </svg>
      <p className="mt-1 text-[11px] text-ink-subtle">Select a point to explore that complaint type’s cases.</p>
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
  const rows = useMemo(() => {
    const all = data ?? []
    const filtered = highVolumeOnly ? all.filter((r) => r.total_cases >= HIGH_VOLUME_MIN) : all
    return filtered.slice(0, 12)
  }, [data, highVolumeOnly])
  return (
    <SectionShell name="closure bottlenecks" title="Closure bottlenecks by complaint type" subtitle="Where closure is slowest." loading={loading} error={error} empty={data?.length === 0}
      action={
        <label className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
          <input type="checkbox" checked={highVolumeOnly} onChange={(e) => setHighVolumeOnly(e.target.checked)} />
          High volume only (≥ {fmtInt(HIGH_VOLUME_MIN)})
        </label>
      }
    >
      {data && (
        <Table
          head={['Complaint type', 'Total', 'Closed', 'Avg', 'Median', 'P90']}
          align={['left', 'right', 'right', 'right', 'right', 'right']}
          rows={rows.map((row) => ({
            key: row.complaint_type,
            onClick: () => onExplore({ complaintType: row.complaint_type }),
            cells: [row.complaint_type, fmtInt(row.total_cases), fmtInt(row.closed_cases), fmtDays(row.avg_closure_days), fmtDays(row.median_closure_days), fmtDays(row.p90_closure_days)],
          }))}
        />
      )}
    </SectionShell>
  )
}

// --- Area bottlenecks ------------------------------------------------------

function AreaBottlenecks({ onExplore }: { onExplore: (f: CaseExplorerFilters) => void }) {
  const { data, loading, error } = useLive<AreaBottleneck[]>(() => getInsightsAreaBottlenecks(12))
  return (
    <SectionShell name="area bottlenecks" title="Area bottlenecks by council district" subtitle="Workload and closure pressure by the ward-like unit." loading={loading} error={error} empty={data?.length === 0}>
      {data && (
        <Table
          head={['Council district', 'Total', 'Avg', 'P90', 'Top complaint type']}
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
