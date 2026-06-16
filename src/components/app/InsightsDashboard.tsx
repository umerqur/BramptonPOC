import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getInsightsKpis,
  getInsightsComplaintTypeVolume,
  getInsightsClosureBottlenecks,
  getInsightsAreaBottlenecks,
  getInsightsDepartmentWorkload,
  getInsightsMonthlyTrend,
  getInsightsChannelMix,
  sampleInsightsKpis,
  sampleComplaintTypeVolume,
  sampleClosureBottlenecks,
  sampleAreaBottlenecks,
  sampleDepartmentWorkload,
  sampleMonthlyTrend,
  sampleChannelMix,
  type InsightsKpis,
  type ComplaintTypeVolume,
  type ClosureBottleneck,
  type AreaBottleneck,
  type InsightsDepartmentWorkload,
  type MonthlyTrendPoint,
  type ChannelMixRow,
} from '../../services/insightsDashboard'
import {
  getInsightsDrilldownCases,
  type ComplaintRow,
  type InsightsDrilldownFilter,
} from '../../services/municipalServiceRequests'

// Operational workload intelligence dashboard for the supervisor/coordinator
// Insights surface. Every section reads a small, server-side aggregate view over
// the full NYC 311 benchmark dataset (never the raw rows in the browser). The
// language stays operational: workload concentration, closure pressure,
// staffing/routing review, supervisor decision support. Nothing here is a risk
// prediction or an automated enforcement decision — a human reviews and decides.

// ---------------------------------------------------------------------------
// Drilldown — clicking a map area, complaint type, or bottleneck row opens the
// individual case records behind that aggregate, each linking to its case file.
// ---------------------------------------------------------------------------

export type Drilldown = { title: string; filter: InsightsDrilldownFilter }

// ---------------------------------------------------------------------------
// Shared loading hook — read the live view, fall back to the benchmark sample
// (with a visible flag) when the aggregate is unavailable, like the workload map.
// ---------------------------------------------------------------------------

type SectionState<T> = { data: T; loading: boolean; fallback: boolean }

function useSection<T>(load: () => Promise<T>, sample: () => T, isEmpty: (d: T) => boolean): SectionState<T> {
  const [state, setState] = useState<SectionState<T>>(() => ({ data: sample(), loading: true, fallback: false }))
  useEffect(() => {
    let active = true
    load()
      .then((d) => {
        if (!active) return
        if (isEmpty(d)) setState({ data: sample(), loading: false, fallback: true })
        else setState({ data: d, loading: false, fallback: false })
      })
      .catch((err: unknown) => {
        console.error('Insights section load failed, using benchmark sample:', err)
        if (active) setState({ data: sample(), loading: false, fallback: true })
      })
    return () => {
      active = false
    }
    // load/sample/isEmpty are stable module-level functions.
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
  const { data, loading, fallback } = useSection<InsightsKpis>(
    getInsightsKpis,
    sampleInsightsKpis,
    (d) => d.total_requests === 0,
  )

  const cards: Array<{ label: string; value: string; hint?: string }> = [
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
  ]

  return (
    <SectionShell
      title="Operational snapshot"
      subtitle="Workload and closure pressure across the NYC 311 benchmark."
      fallback={fallback}
      loading={loading}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-slate-200 bg-white p-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{c.label}</div>
            <div className="mt-1 truncate text-xl font-semibold tabular-nums text-navy-900" title={c.value}>
              {c.value}
            </div>
            {c.hint && <div className="mt-0.5 text-[10px] text-ink-subtle">{c.hint}</div>}
          </div>
        ))}
      </div>
    </SectionShell>
  )
}

// ---------------------------------------------------------------------------
// 2. Complaint type pressure
// ---------------------------------------------------------------------------

function ComplaintTypePressure({ onDrilldown }: { onDrilldown: (d: Drilldown) => void }) {
  const { data, loading, fallback } = useSection<ComplaintTypeVolume[]>(
    () => getInsightsComplaintTypeVolume(10),
    () => sampleComplaintTypeVolume(),
    (d) => d.length === 0,
  )
  const max = Math.max(1, ...data.map((d) => d.total_cases))

  return (
    <SectionShell
      title="Complaint type pressure"
      subtitle="Where request volume concentrates. Select a type to see its cases."
      fallback={fallback}
      loading={loading}
    >
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
    </SectionShell>
  )
}

// ---------------------------------------------------------------------------
// 3. Closure bottlenecks (by complaint type)
// ---------------------------------------------------------------------------

function ClosureBottlenecks({ onDrilldown }: { onDrilldown: (d: Drilldown) => void }) {
  const { data, loading, fallback } = useSection<ClosureBottleneck[]>(
    () => getInsightsClosureBottlenecks(12),
    () => sampleClosureBottlenecks(),
    (d) => d.length === 0,
  )

  return (
    <SectionShell
      title="Closure bottlenecks by complaint type"
      subtitle="Where closure is slowest — input for closure-pressure and routing review."
      fallback={fallback}
      loading={loading}
    >
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
    </SectionShell>
  )
}

// ---------------------------------------------------------------------------
// 4. Area bottlenecks (by council district)
// ---------------------------------------------------------------------------

function AreaBottlenecks({ onDrilldown }: { onDrilldown: (d: Drilldown) => void }) {
  const { data, loading, fallback } = useSection<AreaBottleneck[]>(
    () => getInsightsAreaBottlenecks(12),
    () => sampleAreaBottlenecks().slice(0, 12),
    (d) => d.length === 0,
  )

  return (
    <SectionShell
      title="Area bottlenecks by council district"
      subtitle="Workload and closure pressure by the ward-like operational unit."
      fallback={fallback}
      loading={loading}
    >
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
    </SectionShell>
  )
}

// ---------------------------------------------------------------------------
// 5. Department workload
// ---------------------------------------------------------------------------

function DepartmentWorkload({ onDrilldown }: { onDrilldown: (d: Drilldown) => void }) {
  const { data, loading, fallback } = useSection<InsightsDepartmentWorkload[]>(
    () => getInsightsDepartmentWorkload(12),
    () => sampleDepartmentWorkload(),
    (d) => d.length === 0,
  )

  return (
    <SectionShell
      title="Department workload"
      subtitle="Caseload by responsible agency / assigned department — input for staffing review."
      fallback={fallback}
      loading={loading}
    >
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
    </SectionShell>
  )
}

// ---------------------------------------------------------------------------
// 6. Trend (monthly volume + monthly average closure days)
// ---------------------------------------------------------------------------

function TrendSection() {
  const { data, loading, fallback } = useSection<MonthlyTrendPoint[]>(
    () => getInsightsMonthlyTrend(24),
    () => sampleMonthlyTrend(24),
    (d) => d.length === 0,
  )

  return (
    <SectionShell
      title="Service request trend"
      subtitle="Monthly request volume (bars) and monthly average closure days (line)."
      fallback={fallback}
      loading={loading}
    >
      <TrendChart points={data} />
    </SectionShell>
  )
}

function TrendChart({ points }: { points: MonthlyTrendPoint[] }) {
  if (points.length === 0) return <div className="text-sm text-ink-subtle">No trend data.</div>

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
        {/* Volume bars */}
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
        {/* Average closure-days line */}
        {linePts && <polyline points={linePts} fill="none" stroke="#0f766e" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {points.map((p, i) =>
          p.avg_closure_days == null ? null : (
            <circle key={`pt-${p.month}`} cx={lineX(i)} cy={lineY(p.avg_closure_days)} r={2.4} className="fill-teal-700" />
          ),
        )}
        {/* Month labels */}
        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <text
              key={`lbl-${p.month}`}
              x={lineX(i)}
              y={H - 8}
              textAnchor="middle"
              className="fill-ink-subtle"
              style={{ fontSize: 9 }}
            >
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
// 7. Channel mix
// ---------------------------------------------------------------------------

const CHANNEL_COLORS: Record<string, string> = {
  Online: 'bg-accent-500',
  Phone: 'bg-sky-500',
  Mobile: 'bg-violet-500',
  Unknown: 'bg-slate-400',
}

function ChannelMixSection() {
  const { data, loading, fallback } = useSection<ChannelMixRow[]>(
    () => getInsightsChannelMix(),
    () => sampleChannelMix(),
    (d) => d.length === 0,
  )
  const total = Math.max(1, data.reduce((n, r) => n + r.total_cases, 0))

  return (
    <SectionShell
      title="Channel mix"
      subtitle="How residents are submitting requests."
      fallback={fallback}
      loading={loading}
    >
      {/* Stacked proportion bar */}
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
    </SectionShell>
  )
}

// ---------------------------------------------------------------------------
// Shared UI: section shell + table
// ---------------------------------------------------------------------------

function SectionShell({
  title,
  subtitle,
  fallback,
  loading,
  children,
}: {
  title: string
  subtitle: string
  fallback: boolean
  loading: boolean
  children: React.ReactNode
}) {
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
          <p className="mt-0.5 text-xs text-ink-subtle">{subtitle}</p>
        </div>
        {fallback && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-inset ring-amber-200">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            Benchmark sample
          </span>
        )}
      </div>
      <div className={`mt-4 ${loading ? 'animate-pulse opacity-60' : ''}`}>{children}</div>
    </section>
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
        if (active) setError('Could not load the case records for this selection from Supabase.')
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
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800">{error}</div>
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
          NYC 311 benchmark records — decision support only, not Brampton operational data and not a risk prediction.
        </div>
      </div>
    </div>
  )
}
