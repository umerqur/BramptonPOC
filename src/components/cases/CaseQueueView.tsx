import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import RiskBadge from '../RiskBadge'
import { RISK_LEVELS, type FilterOptions, type RequestRow } from '../../services/municipalServiceRequests'

const DATA_NOTE =
  'Current dataset: public NYC 311 service requests normalized for POC modelling. Not Brampton operational data.'

export type SortKey = 'risk_score' | 'days_open'

export type CaseQueueFilters = {
  query: string
  category: string
  district: string
  risk: string
  sortKey: SortKey
}

type CaseQueueViewProps = {
  eyebrow: string
  /** Base path used for case links, e.g. "/cases" or "/app/cases". */
  casesPath: string
  rows: RequestRow[]
  options: FilterOptions
  loading: boolean
  filters: CaseQueueFilters
  onChange: (patch: Partial<CaseQueueFilters>) => void
  statusSlot?: React.ReactNode
}

/**
 * Presentational case queue. Filter state is owned by the container, which
 * supplies either client-filtered mock rows (public demo) or server-filtered
 * Supabase rows (authenticated app).
 */
export default function CaseQueueView({
  eyebrow,
  casesPath,
  rows,
  options,
  loading,
  filters,
  onChange,
  statusSlot,
}: CaseQueueViewProps) {
  const categoryOptions = useMemo(() => ['All', ...options.categories], [options.categories])
  const districtOptions = useMemo(() => ['All', ...options.districts], [options.districts])

  return (
    <div className="container-page py-10">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="section-eyebrow">{eyebrow}</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">All service requests</h1>
          <p className="mt-2 text-sm text-ink-muted max-w-2xl">{DATA_NOTE}</p>
          <p className="mt-1 text-sm text-ink-subtle">
            {loading ? 'Loading…' : `${rows.length.toLocaleString()} records shown`}
          </p>
        </div>
        {statusSlot}
      </div>

      <div className="mt-6 card p-4">
        <div className="grid gap-3 md:grid-cols-12 items-end">
          <div className="md:col-span-4">
            <label className="text-xs font-medium text-ink-subtle">Search</label>
            <input
              value={filters.query}
              onChange={(e) => onChange({ query: e.target.value })}
              placeholder="Search request ID, address, district, or category"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
            />
          </div>
          <div className="md:col-span-3">
            <label className="text-xs font-medium text-ink-subtle">Category</label>
            <select
              value={filters.category}
              onChange={(e) => onChange({ category: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-ink-subtle">District</label>
            <select
              value={filters.district}
              onChange={(e) => onChange({ district: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              {districtOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-ink-subtle">Risk level</label>
            <select
              value={filters.risk}
              onChange={(e) => onChange({ risk: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              {['All', ...RISK_LEVELS].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="md:col-span-1">
            <label className="text-xs font-medium text-ink-subtle">Sort by</label>
            <select
              value={filters.sortKey}
              onChange={(e) => onChange({ sortKey: e.target.value as SortKey })}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="risk_score">Risk</option>
              <option value="days_open">Days</option>
            </select>
          </div>
        </div>
      </div>

      <div className="mt-6 card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-ink-subtle">
              <tr className="text-left">
                <Th>Request ID</Th>
                <Th>Category</Th>
                <Th>District</Th>
                <Th>Address</Th>
                <Th className="text-right">Days open</Th>
                <Th className="text-right">Risk score</Th>
                <Th>Level</Th>
                <Th>Recommended action</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => (
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
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-ink-subtle text-sm">
                    No service requests match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider ${className}`}>{children}</th>
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>
}
