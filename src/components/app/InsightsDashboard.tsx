import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getInsightsSourceMeta,
  formatPlainDate,
  getInsightsKpis,
  getInsightsComplaintTypeVolume,
  getInsightsClosureBottlenecks,
  getInsightsAreaBottlenecks,
  getInsightsDepartmentWorkload,
  getInsightsMonthlyTrend,
  getInsightsChannelMix,
  isChannelMixMeaningful,
  type InsightsKpis,
  type ComplaintTypeVolume,
  type ClosureBottleneck,
  type AreaBottleneck,
  type InsightsDepartmentWorkload,
  type MonthlyTrendPoint,
  type ChannelMixRow,
  type InsightsSourceMeta,
} from '../../services/insightsDashboard'
import {
  getInsightsDrilldownCases,
  type ComplaintRow,
  type InsightsDrilldownFilter,
} from '../../services/municipalServiceRequests'

// Operational workload intelligence dashboard for the supervisor/coordinator
// Insights surface. Every section reads a small, precomputed aggregate from a
// materialized view over the full New York City 311 public service request
// dataset (never the raw rows in the browser). There is NO hardcoded fallback:
// if a live aggregate cannot be loaded, that section shows a clear "Live Supabase
// data unavailable" error with the underlying message — it never invents numbers.
//
// Language stays operational: workload concentration, closure pressure,
// staffing/routing review, supervisor decision support. Nothing here is a risk
// prediction or an automated enforcement decision — a human reviews and decides.

// ---------------------------------------------------------------------------
// Drilldown — clicking a map area, complaint type, or bottleneck row opens the
// individual case records behind that aggregate, each linking to its case file.
// ---------------------------------------------------------------------------

export type Drilldown = { title: string; filter: InsightsDrilldownFilter }

// ---------------------------------------------------------------------------
// Live-data hook — read the aggregate; on failure expose a dev-friendly error.
// No sample/placeholder substitution.
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
// Formatting helpers
// ---------------------------------------------------------------------------

const fmtInt = (n: number) => n.toLocaleString()
const fmtDays = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)} d`)

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
      {error && (
        <p className="mt-3 font-mono text-[11px] text-amber-800">Supabase error: {error}</p>
      )}
    </section>
  )
}

function SourceLine({
  label,
  value,
  emphasis,
}: {
  label: string
  value: string
  emphasis?: 'ok' | 'error'
}) {
  const valueClass =
    emphasis === 'error' ? 'text-amber-800' : emphasis === 'ok' ? 'text-emerald-700' : 'text-navy-900'
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-900/70">{label}:</span>
      <span className={`text-sm ${valueClass}`}>{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export default function InsightsDashboard({ onDrilldown }: { onDrilldown: (d: Drilldown) => void }) {
  return (
    <div className="mt-6 space-y-6">
      <KpiCards />
      <div className="grid gap-6 lg:grid-cols-2">
        <ComplaintTypePressure onDrilldown={onDrilldown} />
        <ChannelMixSection />
      </div>
      <TrendSection />
      <ClosureBottlenecks onDrilldown={onDrilldown} />
      <AreaBottlenecks onDrilldown={onDrilldown} />
      <DepartmentWorkload onDrilldown={onDrilldown} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 1. KPI cards
// ---------------------------------------------------------------------------

function KpiCards() {
  const { data, loading, error } = useLive<InsightsKpis>(getInsightsKpis)

  return (
    <SectionShell
      name="the operational snapshot"
      title="Operational snapshot"
      subtitle="Workload and closure pressure across the New York City 311 public dataset."
      loading={loading}
      error={error}
    >
      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[
            { label: 'Total requests', value: fmtInt(data.total_requests) },
            { label: 'Open / active', value: fmtInt(data.open_requests), hint: 'Not yet closed' },
            { label: 'Closed', value: fmtInt(data.closed_requests) },
            { label: 'Avg closure', value: fmtDays(data.avg_closure_days), hint: 'Mean days to close' },
            { label: 'Median closure', value: fmtDays(data.median_closure_days) },
            { label: 'P90 closure', value: fmtDays(data.p90_closure_days), hint: '90th percentile' },
            {
              label: 'Busiest district',
              value: data.busiest_council_district ? `District ${data.busiest_council_district}` : '—',
              hint: 'Highest workload',
            },
            { label: 'Top complaint type', value: data.top_complaint_type ?? '—', hint: 'By volume' },
          ].map((c) => (
            <div key={c.label} className="rounded-lg border border-slate-200 bg-white p-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{c.label}</div>
              <div className="mt-1 truncate text-xl font-semibold tabular-nums text-navy-900" title={c.value}>
                {c.value}
              </div>
              {c.hint && <div className="mt-0.5 text-[10px] text-ink-subtle">{c.hint}</div>}
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  )
}

// ---------------------------------------------------------------------------
// 2. Complaint type pressure
// ---------------------------------------------------------------------------

function ComplaintTypePressure({ onDrilldown }: { onDrilldown: (d: Drilldown) => void }) {
  const { data, loading, error } = useLive<ComplaintTypeVolume[]>(() => getInsightsComplaintTypeVolume(10))
  const max = Math.max(1, ...(data ?? []).map((d) => d.total_cases))

  return (
    <SectionShell
      name="complaint type pressure"
      title="Complaint type pressure"
      subtitle="Where request volume concentrates. Select a type to see its cases."
      loading={loading}
      error={error}
      empty={data?.length === 0}
    >
      {data && (
        <ul className="space-y-2">
          {data.map((row) => (
            <li key={row.complaint_type}>
              <button
                type="button"
                onClick={() =>
                  onDrilldown({ title: `${row.complaint_type} — cases`, filter: { complaintType: row.complaint_type } })
                }
                className="group w-full rounded-md px-1.5 py-1 text-left transition hover:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-ink group-hover:text-navy-900">{row.complaint_type}</span>
                  <span className="shrink-0 tabular-nums text-ink-muted">{fmtInt(row.total_cases)}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-accent-500 transition-[width]"
                    style={{ width: `${Math.max(2, (row.total_cases / max) * 100)}%` }}
                  />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionShell>
  )
}

// ---------------------------------------------------------------------------
// 3. Closure bottlenecks (by complaint type)
// ---------------------------------------------------------------------------

function ClosureBottlenecks({ onDrilldown }: { onDrilldown: (d: Drilldown) => void }) {
  const { data, loading, error } = useLive<ClosureBottleneck[]>(() => getInsightsClosureBottlenecks(12))

  return (
    <SectionShell
      name="closure bottlenecks"
      title="Closure bottlenecks by complaint type"
      subtitle="Where closure is slowest — input for closure-pressure and routing review."
      loading={loading}
      error={error}
      empty={data?.length === 0}
    >
      {data && (
        <Table
          head={['Complaint type', 'Total', 'Closed', 'Avg', 'Median', 'P90']}
          align={['left', 'right', 'right', 'right', 'right', 'right']}
          rows={data.map((row) => ({
            key: row.complaint_type,
            onClick: () =>
              onDrilldown({ title: `${row.complaint_type} — cases`, filter: { complaintType: row.complaint_type } }),
            cells: [
              row.complaint_type,
              fmtInt(row.total_cases),
              fmtInt(row.closed_cases),
              fmtDays(row.avg_closure_days),
              fmtDays(row.median_closure_days),
              fmtDays(row.p90_closure_days),
            ],
          }))}
        />
      )}
    </SectionShell>
  )
}

// ---------------------------------------------------------------------------
// 4. Area bottlenecks (by council district)
// ---------------------------------------------------------------------------

function AreaBottlenecks({ onDrilldown }: { onDrilldown: (d: Drilldown) => void }) {
  const { data, loading, error } = useLive<AreaBottleneck[]>(() => getInsightsAreaBottlenecks(12))

  return (
    <SectionShell
      name="area bottlenecks"
      title="Area bottlenecks by council district"
      subtitle="Workload and closure pressure by the ward-like operational unit."
      loading={loading}
      error={error}
      empty={data?.length === 0}
    >
      {data && (
        <Table
          head={['Council district', 'Total', 'Avg', 'P90', 'Top complaint type']}
          align={['left', 'right', 'right', 'right', 'left']}
          rows={data.map((row) => ({
            key: row.council_district,
            onClick: () =>
              onDrilldown({
                title: `District ${row.council_district} — cases`,
                filter: { councilDistrict: row.council_district },
              }),
            cells: [
              `District ${row.council_district}`,
              fmtInt(row.total_cases),
              fmtDays(row.avg_closure_days),
              fmtDays(row.p90_closure_days),
              row.top_complaint_type ?? '—',
            ],
          }))}
        />
      )}
    </SectionShell>
  )
}

// ---------------------------------------------------------------------------
// 5. Department workload
// ---------------------------------------------------------------------------

function DepartmentWorkload({ onDrilldown }: { onDrilldown: (d: Drilldown) => void }) {
  const { data, loading, error } = useLive<InsightsDepartmentWorkload[]>(() => getInsightsDepartmentWorkload(12))

  return (
    <SectionShell
      name="department workload"
      title="Department workload"
      subtitle="Caseload by responsible agency / assigned department — input for staffing review."
      loading={loading}
      error={error}
      empty={data?.length === 0}
    >
      {data && (
        <Table
          head={['Department / agency', 'Total', 'Open', 'Closed', 'Avg closure']}
          align={['left', 'right', 'right', 'right', 'right']}
          rows={data.map((row) => ({
            key: row.department,
            onClick: () =>
              onDrilldown({ title: `${row.department} — cases`, filter: { department: row.department } }),
            cells: [
              row.department,
              fmtInt(row.total_cases),
              fmtInt(row.open_cases),
              fmtInt(row.closed_cases),
              fmtDays(row.avg_closure_days),
            ],
          }))}
        />
      )}
    </SectionShell>
  )
}

// ---------------------------------------------------------------------------
// 6. Trend (monthly volume + monthly average closure days)
// ---------------------------------------------------------------------------

function TrendSection() {
  const { data, loading, error } = useLive<MonthlyTrendPoint[]>(() => getInsightsMonthlyTrend(24))

  return (
    <SectionShell
      name="the service request trend"
      title="Service request trend"
      subtitle="Monthly request volume (bars) and monthly average closure days (line)."
      loading={loading}
      error={error}
      empty={data?.length === 0}
    >
      {data && data.length > 0 && <TrendChart points={data} />}
    </SectionShell>
  )
}

function TrendChart({ points }: { points: MonthlyTrendPoint[] }) {
  const W = 760
  const H = 220
  const padL = 8
  const padR = 8
  const padT = 12
  const padB = 26
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const maxVol = Math.max(1, ...points.map((p) => p.request_volume))
  const closureVals = points.map((p) => p.avg_closure_days).filter((v): v is number => v != null)
  const maxClose = Math.max(1, ...closureVals)

  const barGap = 4
  const barW = innerW / points.length - barGap

  const lineX = (i: number) => padL + i * (innerW / points.length) + (innerW / points.length) / 2
  const lineY = (v: number) => padT + innerH - (v / maxClose) * innerH

  const linePts = points
    .map((p, i) => (p.avg_closure_days == null ? null : `${lineX(i).toFixed(1)},${lineY(p.avg_closure_days).toFixed(1)}`))
    .filter((s): s is string => s != null)
    .join(' ')

  // Show a sparse set of month labels so the axis stays readable.
  const labelEvery = Math.ceil(points.length / 8)

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Monthly request volume and average closure days">
        {points.map((p, i) => {
          const h = (p.request_volume / maxVol) * innerH
          const x = padL + i * (innerW / points.length) + barGap / 2
          const y = padT + innerH - h
          return (
            <rect key={p.month} x={x} y={y} width={Math.max(1, barW)} height={Math.max(0, h)} rx={1.5} className="fill-sky-200">
              <title>
                {p.month}
                {'\n'}Requests: {fmtInt(p.request_volume)}
                {'\n'}Avg closure: {fmtDays(p.avg_closure_days)}
              </title>
            </rect>
          )
        })}
        {linePts && <polyline points={linePts} fill="none" stroke="#0f766e" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {points.map((p, i) =>
          p.avg_closure_days == null ? null : (
            <circle key={`pt-${p.month}`} cx={lineX(i)} cy={lineY(p.avg_closure_days)} r={2.4} className="fill-teal-700" />
          ),
        )}
        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={`lbl-${p.month}`} x={lineX(i)} y={H - 8} textAnchor="middle" className="fill-ink-subtle" style={{ fontSize: 9 }}>
              {p.month}
            </text>
          ) : null,
        )}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-ink-subtle">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-3 rounded-sm bg-sky-200" /> Monthly request volume
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-teal-700" /> Avg closure days
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 7. Channel mix — only shown when the live data has meaningful channel values.
// ---------------------------------------------------------------------------

const CHANNEL_COLORS: Record<string, string> = {
  Online: 'bg-accent-500',
  Phone: 'bg-sky-500',
  Mobile: 'bg-violet-500',
  Unknown: 'bg-slate-400',
}

function ChannelMixSection() {
  const { data, loading, error } = useLive<ChannelMixRow[]>(getInsightsChannelMix)
  const meaningful = data ? isChannelMixMeaningful(data) : false
  const total = Math.max(1, (data ?? []).reduce((n, r) => n + r.total_cases, 0))

  return (
    <SectionShell
      name="the channel mix"
      title="Channel mix"
      subtitle="How residents are submitting requests."
      loading={loading}
      error={error}
    >
      {data && !meaningful && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-ink-subtle">
          Channel data unavailable for this dataset.
        </div>
      )}
      {data && meaningful && (
        <>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
            {data.map((r) => (
              <div
                key={r.channel}
                className={`${CHANNEL_COLORS[r.channel] ?? 'bg-slate-400'} h-full`}
                style={{ width: `${(r.total_cases / total) * 100}%` }}
                title={`${r.channel}: ${fmtInt(r.total_cases)}`}
              />
            ))}
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-3">
            {data.map((r) => (
              <li key={r.channel} className="flex items-center gap-2">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${CHANNEL_COLORS[r.channel] ?? 'bg-slate-400'}`} />
                <div className="min-w-0">
                  <div className="text-sm text-navy-900">{r.channel}</div>
                  <div className="text-xs tabular-nums text-ink-subtle">
                    {fmtInt(r.total_cases)} · {((r.total_cases / total) * 100).toFixed(0)}%
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </SectionShell>
  )
}

// ---------------------------------------------------------------------------
// Shared UI: section shell (pills + loading/error/empty states) + table
// ---------------------------------------------------------------------------

function SectionShell({
  name,
  title,
  subtitle,
  loading,
  error,
  empty,
  children,
}: {
  name: string
  title: string
  subtitle: string
  loading: boolean
  error: string | null
  empty?: boolean
  children: React.ReactNode
}) {
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
          <p className="mt-0.5 text-xs text-ink-subtle">{subtitle}</p>
        </div>
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

      <div className="mt-4">
        {error ? (
          <SectionError name={name} error={error} />
        ) : loading ? (
          <div className="animate-pulse rounded-md bg-slate-100/70 py-10 text-center text-sm text-ink-subtle">
            Loading live data…
          </div>
        ) : empty ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-ink-subtle">
            No records available for this section.
          </div>
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
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-ink-subtle">
            {head.map((h, i) => (
              <th key={h} className={`px-2 py-2 font-semibold ${align[i] === 'right' ? 'text-right' : 'text-left'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              onClick={row.onClick}
              className={`border-b border-slate-100 ${row.onClick ? 'cursor-pointer hover:bg-slate-50' : ''}`}
            >
              {row.cells.map((cell, i) => (
                <td
                  key={i}
                  className={`px-2 py-2 ${align[i] === 'right' ? 'text-right tabular-nums text-ink-muted' : 'text-ink'}`}
                >
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

// ---------------------------------------------------------------------------
// Drilldown modal — individual case records behind a clicked aggregate.
// ---------------------------------------------------------------------------

export function DrilldownModal({ drilldown, onClose }: { drilldown: Drilldown | null; onClose: () => void }) {
  const [rows, setRows] = useState<ComplaintRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!drilldown) return
    let active = true
    setLoading(true)
    setError(null)
    setRows([])
    getInsightsDrilldownCases(drilldown.filter, 50)
      .then((data) => active && setRows(data))
      .catch((err: unknown) => {
        console.error('Drilldown load failed:', err)
        if (active) setError('Live Supabase data unavailable. Unable to load the case records for this selection.')
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [drilldown])

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!drilldown) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drilldown, onClose])

  if (!drilldown) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy-900/40 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={drilldown.title}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">Case drilldown</div>
            <h3 className="truncate text-sm font-semibold text-navy-900">{drilldown.title}</h3>
          </div>
          <button type="button" onClick={onClose} className="btn-secondary text-xs py-1.5 px-3">
            Close
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="py-10 text-center text-sm text-ink-subtle">Loading case records…</div>
          ) : error ? (
            <div className="rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-900">{error}</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-ink-subtle">No individual records found for this selection.</div>
          ) : (
            <>
              <div className="mb-3 text-xs text-ink-subtle">
                Showing {rows.length} record{rows.length === 1 ? '' : 's'} (most recent first).
              </div>
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li key={r.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-navy-900">{r.id}</span>
                      <Link to={`/app/cases/${encodeURIComponent(r.id)}`} className="text-xs font-medium text-accent-700 hover:text-accent-900">
                        Open case file →
                      </Link>
                    </div>
                    <div className="mt-1 text-sm text-ink">{r.complaintType}</div>
                    <div className="mt-0.5 text-xs text-ink-subtle">
                      {[r.status, r.assignedDepartment, r.wardOrArea].filter(Boolean).join(' · ')}
                    </div>
                    {r.address && <div className="mt-0.5 text-xs text-ink-subtle">{r.address}</div>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-ink-subtle">
          New York City 311 public service requests — historical workload data for supervisor decision support.
        </div>
      </div>
    </div>
  )
}
