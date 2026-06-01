import { Link } from 'react-router-dom'
import StatCard from '../StatCard'
import RiskBadge from '../RiskBadge'
import SectionHeading from '../SectionHeading'
import AdvisoryNotice from '../AdvisoryNotice'
import type { DashboardStats, Hotspot } from '../../services/municipalServiceRequests'

const DATA_NOTE =
  'Current dataset: public NYC 311 service requests normalized for POC modelling. Not Brampton operational data.'

type DashboardViewProps = {
  stats: DashboardStats | null
  loading: boolean
  eyebrow: string
  /** Base path used for case links, e.g. "/cases" (public) or "/app/cases" (live). */
  casesPath: string
  /** Small badge rendered on the right of the header (data source indicator). */
  statusSlot?: React.ReactNode
}

/**
 * Presentational dashboard. Source-agnostic: the public demo feeds it mock
 * data and the authenticated app feeds it live Supabase data.
 */
export default function DashboardView({ stats, loading, eyebrow, casesPath, statusSlot }: DashboardViewProps) {
  const maxCategoryCount = Math.max(...(stats?.categoriesByCount.map((c) => c.count) ?? [1]), 1)

  return (
    <div className="container-page py-10">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="section-eyebrow">{eyebrow}</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">Operational overview</h1>
          <p className="mt-2 text-sm text-ink-muted max-w-2xl">
            {DATA_NOTE} Internal workflow fields shown elsewhere are synthetic and figures do not reflect any real City
            case load.
          </p>
        </div>
        {statusSlot}
      </div>

      <div className="mt-6">
        <AdvisoryNotice />
      </div>

      {/* KPI cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Total cases" value={formatCount(stats?.total, loading)} hint="service requests in dataset" />
        <StatCard label="Unresolved cases" value={formatCount(stats?.open, loading)} hint="not yet closed" />
        <StatCard
          label="High / critical risk"
          value={formatCount(stats?.highRisk, loading)}
          hint="risk level High or Critical"
        />
        <StatCard
          label="High ML pattern signal"
          value={formatCount(stats?.highSignal, loading)}
          hint="advisory pattern detection"
        />
        <StatCard
          label="Moderate ML pattern signal"
          value={formatCount(stats?.moderateSignal, loading)}
          hint="advisory pattern detection"
        />
        <StatCard
          label="Hotspot clusters"
          value={formatCount(stats?.hotspotClusters, loading)}
          hint="distinct ML hotspot clusters"
        />
      </div>

      {/* Row 1: categories + hotspot map */}
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="card p-6 lg:col-span-1">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-navy-900">Categories by count</h3>
            <span className="text-xs text-ink-subtle">Service requests</span>
          </div>
          <ul className="mt-4 space-y-3">
            {(stats?.categoriesByCount ?? []).map((row) => (
              <li key={row.category}>
                <div className="flex justify-between text-sm">
                  <span className="text-ink">{row.category}</span>
                  <span className="font-medium text-navy-900 tabular-nums">{row.count.toLocaleString()}</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-navy-700" style={{ width: `${(row.count / maxCategoryCount) * 100}%` }} />
                </div>
              </li>
            ))}
            {!loading && (stats?.categoriesByCount.length ?? 0) === 0 && (
              <li className="text-sm text-ink-subtle">No category data available.</li>
            )}
          </ul>
        </div>

        <div className="card p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-navy-900">ML hotspot clusters</h3>
            <span className="text-xs text-ink-subtle">
              {loading ? 'Loading…' : `${(stats?.hotspots.length ?? 0).toLocaleString()} clusters plotted`}
            </span>
          </div>
          <div className="mt-4 relative h-64 sm:h-80 rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
            <HotspotMap hotspots={stats?.hotspots ?? []} loading={loading} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-subtle">
            <LegendDot color="bg-red-500" label="High hotspot score" />
            <LegendDot color="bg-orange-500" label="Medium score" />
            <LegendDot color="bg-amber-400" label="Lower score" />
            <span>Marker size ∝ cluster size</span>
          </div>
          <div className="mt-3">
            <AdvisoryNotice variant="inline" />
          </div>
        </div>
      </div>

      {/* Priority queue */}
      <div className="mt-10">
        <div className="flex items-end justify-between gap-4">
          <SectionHeading eyebrow="Priority Queue" title="Top high risk service requests" />
          <Link to={casesPath} className="text-sm font-medium text-navy-700 hover:text-navy-900">
            View full queue →
          </Link>
        </div>

        <div className="mt-5 card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-ink-subtle">
                <tr className="text-left">
                  <Th>Request ID</Th>
                  <Th>Category</Th>
                  <Th>District</Th>
                  <Th>Address</Th>
                  <Th className="text-right">Days open</Th>
                  <Th className="text-right">Risk</Th>
                  <Th>Level</Th>
                  <Th>Recommended action</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(stats?.topHighRisk ?? []).map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <Td>
                      <Link to={`${casesPath}/${encodeURIComponent(c.id)}`} className="font-medium text-navy-900 hover:underline">
                        {c.id}
                      </Link>
                    </Td>
                    <Td>{c.category}</Td>
                    <Td>{c.district}</Td>
                    <Td className="text-ink-muted">{c.address}</Td>
                    <Td className="text-right tabular-nums">{c.daysOpen}</Td>
                    <Td className="text-right tabular-nums font-medium">{c.riskScore}</Td>
                    <Td><RiskBadge risk={c.risk} /></Td>
                    <Td className="text-ink-muted">{c.recommendedAction}</Td>
                  </tr>
                ))}
                {loading && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-ink-subtle text-sm">
                      Loading service requests…
                    </td>
                  </tr>
                )}
                {!loading && (stats?.topHighRisk.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-ink-subtle text-sm">
                      No service requests available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatCount(value: number | undefined, loading: boolean): string {
  if (loading || value === undefined) return '—'
  return value.toLocaleString()
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider ${className}`}>{children}</th>
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  )
}

/** Color for a hotspot marker based on its (normalized) ML hotspot score. */
function scoreColor(score: number, maxScore: number): string {
  const ratio = maxScore > 0 ? score / maxScore : 0
  if (ratio >= 0.66) return '#dc2626' // red — high
  if (ratio >= 0.33) return '#ea580c' // orange — medium
  return '#d97706' // amber — lower
}

/**
 * Data-driven hotspot scatter. Projects each cluster's latitude/longitude into
 * the SVG viewBox using the bounding box of the supplied points, sizes markers
 * by ML hotspot cluster size, and colors them by ML hotspot score. No external
 * mapping dependency is used.
 */
function HotspotMap({ hotspots, loading }: { hotspots: Hotspot[]; loading: boolean }) {
  const W = 600
  const H = 300
  const PAD = 24

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-subtle">Loading hotspots…</div>
  }
  if (hotspots.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-subtle">
        No hotspot clusters available.
      </div>
    )
  }

  const lats = hotspots.map((h) => h.lat)
  const lngs = hotspots.map((h) => h.lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const spanLat = maxLat - minLat || 1
  const spanLng = maxLng - minLng || 1
  const maxScore = Math.max(...hotspots.map((h) => h.score), 0)
  const maxSize = Math.max(...hotspots.map((h) => h.size), 1)

  // Longitude → x, latitude → y (north at top, so invert lat).
  const projX = (lng: number) => PAD + ((lng - minLng) / spanLng) * (W - 2 * PAD)
  const projY = (lat: number) => PAD + (1 - (lat - minLat) / spanLat) * (H - 2 * PAD)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <defs>
        <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#e2e8f0" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" />
      {hotspots.map((h) => {
        const x = projX(h.lng)
        const y = projY(h.lat)
        const color = scoreColor(h.score, maxScore)
        const r = 4 + (h.size / maxSize) * 14
        return (
          <g key={h.clusterId}>
            <circle cx={x} cy={y} r={r} fill={color} fillOpacity={0.18} />
            <circle cx={x} cy={y} r={3} fill={color}>
              <title>{`Cluster ${h.clusterId} · ${h.hotspotLabel}\nSize ${h.size} · score ${h.score}\n${h.patternLabel}`}</title>
            </circle>
          </g>
        )
      })}
      <text x="14" y="20" fontSize="10" fill="#64748b">
        ML hotspot clusters · lat/lng projection
      </text>
    </svg>
  )
}
