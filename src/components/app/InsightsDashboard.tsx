import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import NYCWorkloadMapPanel from './NYCWorkloadMapPanel'
import {
  getInsightsKpis,
  getInsightsComplaintTypeVolume,
  getInsightsClosureBottlenecks,
  getInsightsAreaBottlenecks,
  getInsightsDepartmentWorkload,
  getInsightsMonthlyTrend,
  getInsightsChannelMix,
  getInsightsStatusMix,
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
  type StatusMixRow,
} from '../../services/insightsDashboard'
import {
  getNycCaseExplorerPage,
  getNycCaseDetail,
  getCaseExplorerOptions,
  getNycOpenReviewQueue,
  closureDurationDays,
  type CaseExplorerFilters,
  type NycCaseRow,
  type CaseExplorerOptions,
  type OpenReviewRow,
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
  const status = error ? 'Live Supabase data unavailable' : loading ? 'Connecting…' : 'Connected to Supabase'

  return (
    <section className="mt-6 rounded-xl border border-sky-200 bg-sky-50/60 p-4">
      <div className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
        <SourceLine label="Data source" value="New York City 311 public service requests" />
        <SourceLine label="Records loaded" value={records} />
        <SourceLine label="Date range" value={range} />
        <SourceLine label="Status" value={status} emphasis={error ? 'error' : 'ok'} />
      </div>
      {error && <p className="mt-3 font-mono text-[11px] text-amber-800">Supabase error: {error}</p>}
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
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        <TabButton label="Overview" active={tab === 'overview'} onClick={() => setTab('overview')} />
        <TabButton label="Case Explorer" active={tab === 'explorer'} onClick={() => setTab('explorer')} />
        <TabButton label="Open cases" active={tab === 'open'} onClick={() => setTab('open')} />
      </div>

      {tab === 'overview' && <Overview onExplore={explore} />}
      {tab === 'explorer' && <CaseExplorer filters={filters} onFiltersChange={setFilters} />}
      {tab === 'open' && <OpenCasesQueue />}
    </div>
  )
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
        active ? 'border-accent-600 text-navy-900' : 'border-transparent text-ink-subtle hover:text-navy-900'
      }`}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function Overview({ onExplore }: { onExplore: (f: CaseExplorerFilters) => void }) {
  return (
    <div className="mt-6 space-y-6">
      <NYCWorkloadMapPanel
        onSelectArea={(mode, value) =>
          onExplore(mode === 'district' ? { councilDistrict: value } : { borough: value })
        }
      />
      <KpiCards />
      <div className="grid gap-6 lg:grid-cols-3">
        <ComplaintShareDonut onExplore={onExplore} />
        <StatusMixDonut onExplore={onExplore} />
        <ChannelMixDonut />
      </div>
      <TrendSection onExplore={onExplore} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ComplaintTypePressure onExplore={onExplore} />
        <ClosureScatter onExplore={onExplore} />
      </div>
      <ClosureBottlenecks onExplore={onExplore} />
      <AreaBottlenecks onExplore={onExplore} />
      <DepartmentWorkload onExplore={onExplore} />
    </div>
  )
}

// --- KPI cards -------------------------------------------------------------

function KpiCards() {
  const { data, loading, error } = useLive<InsightsKpis>(getInsightsKpis)
  return (
    <SectionShell name="the operational snapshot" title="Operational snapshot" subtitle="Workload and closure pressure." loading={loading} error={error}>
      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[
            { label: 'Total requests', value: fmtInt(data.total_requests) },
            { label: 'Open / active', value: fmtInt(data.open_requests) },
            { label: 'Closed', value: fmtInt(data.closed_requests) },
            { label: 'Avg closure', value: fmtDays(data.avg_closure_days) },
            { label: 'Median closure', value: fmtDays(data.median_closure_days) },
            { label: 'P90 closure', value: fmtDays(data.p90_closure_days) },
            { label: 'Busiest district', value: data.busiest_council_district ? `District ${data.busiest_council_district}` : '—' },
            { label: 'Top complaint type', value: data.top_complaint_type ?? '—' },
          ].map((c) => (
            <div key={c.label} className="rounded-lg border border-slate-200 bg-white p-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{c.label}</div>
              <div className="mt-1 truncate text-xl font-semibold tabular-nums text-navy-900" title={c.value}>
                {c.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  )
}

// --- Donuts ----------------------------------------------------------------

type Slice = { label: string; value: number; color: string; onClick?: () => void }

function Donut({ slices, size = 132 }: { slices: Slice[]; size?: number }) {
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
                <title>{`${s.label}: ${fmtInt(s.value)} (${((s.value / total) * 100).toFixed(0)}%)`}</title>
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
                {total > 0 ? `${((s.value / total) * 100).toFixed(0)}%` : '—'}
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

function ComplaintShareDonut({ onExplore }: { onExplore: (f: CaseExplorerFilters) => void }) {
  const { data, loading, error } = useLive<ComplaintTypeVolume[]>(() => getInsightsComplaintTypeVolume(50))
  const slices = useMemo(
    () =>
      (data ?? []).length
        ? topNplusOther(
            data!,
            (r) => r.complaint_type,
            (r) => r.total_cases,
          ).map((s) =>
            s.label === 'Other' ? s : { ...s, onClick: () => onExplore({ complaintType: s.label }) },
          )
        : [],
    [data, onExplore],
  )
  return (
    <SectionShell name="complaint type share" title="Complaint type share" subtitle="Top 5 + Other." loading={loading} error={error} empty={data?.length === 0}>
      {data && <Donut slices={slices} />}
    </SectionShell>
  )
}

function StatusMixDonut({ onExplore }: { onExplore: (f: CaseExplorerFilters) => void }) {
  const { data, loading, error } = useLive<StatusMixRow[]>(getInsightsStatusMix)
  const slices = useMemo(
    () =>
      (data ?? []).length
        ? topNplusOther(
            data!,
            (r) => r.status,
            (r) => r.total_cases,
          ).map((s) => (s.label === 'Other' ? s : { ...s, onClick: () => onExplore({ status: s.label }) }))
        : [],
    [data, onExplore],
  )
  return (
    <SectionShell name="the status mix" title="Status mix" subtitle="Where cases sit." loading={loading} error={error} empty={data?.length === 0}>
      {data && <Donut slices={slices} />}
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

// --- Complaint type pressure ----------------------------------------------

function ComplaintTypePressure({ onExplore }: { onExplore: (f: CaseExplorerFilters) => void }) {
  const { data, loading, error } = useLive<ComplaintTypeVolume[]>(() => getInsightsComplaintTypeVolume(10))
  const max = Math.max(1, ...(data ?? []).map((d) => d.total_cases))
  return (
    <SectionShell name="complaint type pressure" title="Complaint type pressure" subtitle="Volume by type. Select a type to explore its cases." loading={loading} error={error} empty={data?.length === 0}>
      {data && (
        <ul className="space-y-2">
          {data.map((row) => (
            <li key={row.complaint_type}>
              <button type="button" onClick={() => onExplore({ complaintType: row.complaint_type })} className="group w-full rounded-md px-1.5 py-1 text-left transition hover:bg-slate-50">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-ink group-hover:text-navy-900">{row.complaint_type}</span>
                  <span className="shrink-0 tabular-nums text-ink-muted">{fmtInt(row.total_cases)}</span>
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

function TrendSection({ onExplore }: { onExplore: (f: CaseExplorerFilters) => void }) {
  const { data, loading, error } = useLive<MonthlyTrendPoint[]>(() => getInsightsMonthlyTrend(24))
  return (
    <SectionShell name="the service request trend" title="Service request trend" subtitle="Monthly volume (bars) and average closure days (line). Select a month to explore it." loading={loading} error={error} empty={data?.length === 0}>
      {data && data.length > 0 && <TrendChart points={data} onExplore={onExplore} />}
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
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<NycCaseRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState<CaseExplorerOptions | null>(null)
  const [openCase, setOpenCase] = useState<string | null>(null)

  // Reset to the first page whenever the filters change.
  useEffect(() => {
    setPage(0)
  }, [filters])

  useEffect(() => {
    getCaseExplorerOptions()
      .then(setOptions)
      .catch((err) => console.error('Failed to load explorer options:', err))
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getNycCaseExplorerPage(filters, page, PAGE_SIZE)
      .then((res) => {
        if (!active) return
        setRows(res.rows)
        setTotal(res.total)
      })
      .catch((err: unknown) => {
        console.error('Case Explorer load failed:', err)
        if (active) {
          setError(errorMessage(err))
          setRows([])
          setTotal(0)
        }
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [filters, page])

  const set = (patch: Partial<CaseExplorerFilters>) => onFiltersChange({ ...filters, ...patch })
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1
  const to = Math.min(total, (page + 1) * PAGE_SIZE)

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
          <span>{error ? 'Live data unavailable' : loading ? 'Loading…' : `${fmtInt(from)}–${fmtInt(to)} of ${fmtInt(total)}`}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider">Live Supabase data</span>
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
                onClick: () => setOpenCase(r.case_id),
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

        {!error && total > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between">
            <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-50">
              ← Prev
            </button>
            <span className="text-xs text-ink-subtle">Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
            <button type="button" disabled={to >= total} onClick={() => setPage((p) => p + 1)} className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-50">
              Next →
            </button>
          </div>
        )}
      </section>

      <CaseDetailDrawer caseId={openCase} onClose={() => setOpenCase(null)} />
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
// Case detail drawer (shared by Explorer + Open queue)
// ---------------------------------------------------------------------------

function CaseDetailDrawer({ caseId, onClose }: { caseId: string | null; onClose: () => void }) {
  const [row, setRow] = useState<NycCaseRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!caseId) return
    let active = true
    setLoading(true)
    setError(null)
    setRow(null)
    getNycCaseDetail(caseId)
      .then((d) => active && setRow(d))
      .catch((err: unknown) => active && setError(errorMessage(err)))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [caseId])

  useEffect(() => {
    if (!caseId) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [caseId, onClose])

  if (!caseId) return null
  const dur = row ? closureDurationDays(row) : null
  const agency = row ? row.agency_name || row.agency || row.assigned_department || '—' : '—'

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-navy-900/40" role="dialog" aria-modal="true" aria-label={`Case ${caseId}`} onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col overflow-hidden bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">Case detail</div>
            <h3 className="truncate text-sm font-semibold text-navy-900">{caseId}</h3>
          </div>
          <button type="button" onClick={onClose} className="btn-secondary text-xs py-1.5 px-3">Close</button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="py-10 text-center text-sm text-ink-subtle">Loading case…</div>
          ) : error ? (
            <div className="rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-900">Live data unavailable. {error}</div>
          ) : !row ? (
            <div className="py-10 text-center text-sm text-ink-subtle">Case not found.</div>
          ) : (
            <dl className="space-y-2.5">
              <DetailRow label="Submitted" value={fmtDate(row.submitted_at)} />
              <DetailRow label="Closed" value={fmtDate(row.closed_at)} />
              <DetailRow label="Closure duration" value={dur == null ? '—' : `${dur} days`} />
              <DetailRow label="Status" value={row.status ?? '—'} />
              <DetailRow label="Complaint type" value={row.complaint_type ?? '—'} />
              <DetailRow label="Request detail" value={[row.request_detail, row.request_detail_2].filter(Boolean).join(' · ') || '—'} />
              <DetailRow label="Agency" value={agency} />
              <DetailRow label="Borough" value={row.borough ?? '—'} />
              <DetailRow label="Council district" value={row.council_district ? String(Number(row.council_district)) : '—'} />
              <DetailRow label="Location" value={row.address_or_location || row.ward_or_area || '—'} />
              <DetailRow label="Resolution" value={row.resolution_description ?? '—'} />
              <DetailRow label="Dataset id" value={row.source_dataset_id ?? '—'} />
              <div className="pt-2">
                <Link to={`/app/cases/${encodeURIComponent(row.case_id)}`} className="text-xs font-medium text-accent-700 hover:text-accent-900">
                  Open full case file →
                </Link>
              </div>
            </dl>
          )}
        </div>
        <div className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-ink-subtle">Source: New York City 311 public service requests.</div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Open cases queue tab
// ---------------------------------------------------------------------------

const AGING_BUCKETS: { label: string; test: (d: number) => boolean }[] = [
  { label: '0–2 days', test: (d) => d <= 2 },
  { label: '3–7 days', test: (d) => d >= 3 && d <= 7 },
  { label: '8–14 days', test: (d) => d >= 8 && d <= 14 },
  { label: '15+ days', test: (d) => d >= 15 },
]

function OpenCasesQueue() {
  const { data, loading, error } = useLive<OpenReviewRow[]>(() => getNycOpenReviewQueue(100))
  const [openCase, setOpenCase] = useState<string | null>(null)

  const buckets = useMemo(() => {
    const rows = data ?? []
    return AGING_BUCKETS.map((b) => ({
      label: b.label,
      count: rows.filter((r) => r.age_days != null && b.test(r.age_days)).length,
    }))
  }, [data])

  if (loading) {
    return <div className="mt-6 card p-8 text-center text-sm text-ink-subtle">Loading open cases…</div>
  }

  // The open dataset is loaded separately; until then (or on any read error) show
  // a clear notice rather than fabricating a queue.
  if (error || !data) {
    return (
      <div className="mt-6 card p-6">
        <h2 className="text-sm font-semibold text-navy-900">Open NYC cases not loaded yet</h2>
        <p className="mt-1 text-sm text-ink-muted">
          The review priority queue reads <code className="text-xs">v_nyc_open_review_queue</code>. Load the open NYC
          311 dataset to enable review priority, aging buckets, and due-date pressure here.
        </p>
        {error && <p className="mt-2 font-mono text-[11px] text-ink-subtle">{error}</p>}
      </div>
    )
  }

  if (data.length === 0) {
    return <div className="mt-6 card p-8 text-center text-sm text-ink-subtle">No open cases in the review queue right now.</div>
  }

  return (
    <div className="mt-6 space-y-6">
      <SectionShell name="open-case aging" title="Open-case aging" subtitle="How long open cases have been waiting." loading={false} error={null}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {buckets.map((b) => (
            <div key={b.label} className="rounded-lg border border-slate-200 bg-white p-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{b.label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-navy-900">{fmtInt(b.count)}</div>
            </div>
          ))}
        </div>
      </SectionShell>

      <SectionShell name="the review priority queue" title="Review priority queue" subtitle="Highest review priority first. Decision support — staff review and decide." loading={false} error={null}>
        <Table
          head={['Priority', 'Tier', 'Reason', 'Age', 'Due', 'Complaint type', 'Borough / district']}
          align={['right', 'left', 'left', 'right', 'left', 'left', 'left']}
          rows={data.map((r) => ({
            key: r.case_id,
            onClick: () => setOpenCase(r.case_id),
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
      </SectionShell>

      <CaseDetailDrawer caseId={openCase} onClose={() => setOpenCase(null)} />
    </div>
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
              Live Supabase data
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
      <div className="font-semibold">Live Supabase data unavailable.</div>
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
