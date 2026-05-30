import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import RiskBadge from '../components/RiskBadge'
import { isSupabaseConfigured } from '../lib/supabase'
import {
  RISK_LEVELS,
  filterMockRows,
  getFilterOptions,
  getMunicipalServiceRequests,
  mockFilterOptions,
  mockRequestRows,
  type FilterOptions,
  type RequestFilters,
  type RequestRow,
} from '../services/municipalServiceRequests'

const DATA_NOTE =
  'Current dataset: public NYC 311 service requests normalized for POC modelling. Not Brampton operational data.'

type SortKey = 'risk_score' | 'days_open'
type Source = 'supabase' | 'mock'

export default function CaseQueuePage() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [district, setDistrict] = useState('All')
  const [risk, setRisk] = useState('All')
  const [sortKey, setSortKey] = useState<SortKey>('risk_score')

  const [rows, setRows] = useState<RequestRow[]>([])
  const [options, setOptions] = useState<FilterOptions>({ categories: [], districts: [] })
  const [source, setSource] = useState<Source>('mock')
  const [loading, setLoading] = useState(true)

  // Load filter dropdown options once.
  useEffect(() => {
    let active = true
    async function loadOptions() {
      if (!isSupabaseConfigured) {
        if (active) setOptions(mockFilterOptions())
        return
      }
      try {
        const opts = await getFilterOptions()
        if (active) setOptions(opts)
      } catch (err) {
        console.error('Falling back to mock filter options:', err)
        if (active) setOptions(mockFilterOptions())
      }
    }
    loadOptions()
    return () => {
      active = false
    }
  }, [])

  // Load (and re-load) rows whenever a filter changes. Search is debounced.
  useEffect(() => {
    let active = true
    const filters: RequestFilters = { category, district, riskLevel: risk, search: query, sort: sortKey }

    async function load() {
      setLoading(true)
      if (!isSupabaseConfigured) {
        if (active) {
          setRows(filterMockRows(mockRequestRows(), filters))
          setSource('mock')
          setLoading(false)
        }
        return
      }
      try {
        const data = await getMunicipalServiceRequests(filters)
        if (active) {
          setRows(data)
          setSource('supabase')
        }
      } catch (err) {
        console.error('Falling back to mock case queue data:', err)
        if (active) {
          setRows(filterMockRows(mockRequestRows(), filters))
          setSource('mock')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    const timer = setTimeout(load, query ? 300 : 0)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [query, category, district, risk, sortKey])

  const categoryOptions = useMemo(() => ['All', ...options.categories], [options.categories])
  const districtOptions = useMemo(() => ['All', ...options.districts], [options.districts])

  return (
    <div className="container-page py-10">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="section-eyebrow">Case Queue</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">All service requests</h1>
          <p className="mt-2 text-sm text-ink-muted max-w-2xl">{DATA_NOTE}</p>
          <p className="mt-1 text-sm text-ink-subtle">
            {loading ? 'Loading…' : `${rows.length.toLocaleString()} records shown`}
          </p>
        </div>
        <DataSourceBadge source={source} loading={loading} />
      </div>

      <div className="mt-6 card p-4">
        <div className="grid gap-3 md:grid-cols-12 items-end">
          <div className="md:col-span-4">
            <label className="text-xs font-medium text-ink-subtle">Search</label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search request ID, address, district, or category"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
            />
          </div>
          <div className="md:col-span-3">
            <label className="text-xs font-medium text-ink-subtle">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-ink-subtle">District</label>
            <select
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              {districtOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-ink-subtle">Risk level</label>
            <select
              value={risk}
              onChange={(e) => setRisk(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              {['All', ...RISK_LEVELS].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="md:col-span-1">
            <label className="text-xs font-medium text-ink-subtle">Sort by</label>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
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
                    <Link to={`/cases/${encodeURIComponent(c.id)}`} className="font-medium text-navy-900 hover:underline">
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

function DataSourceBadge({ source, loading }: { source: Source; loading: boolean }) {
  const isLive = source === 'supabase'
  return (
    <div className="flex items-center gap-2 text-xs text-ink-subtle">
      <span className={`h-2 w-2 rounded-full ${isLive ? 'bg-accent-500' : 'bg-slate-400'}`} />
      {loading ? 'Loading…' : isLive ? 'Live data: Supabase' : 'Sample data (Supabase not configured)'}
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider ${className}`}>{children}</th>
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>
}
