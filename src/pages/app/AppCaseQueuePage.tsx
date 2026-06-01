import { useEffect, useState } from 'react'
import CaseQueueView, { type CaseQueueFilters } from '../../components/cases/CaseQueueView'
import {
  filterMockRows,
  getFilterOptions,
  getMunicipalServiceRequests,
  mockFilterOptions,
  mockRequestRows,
  type FilterOptions,
  type RequestFilters,
  type RequestRow,
} from '../../services/municipalServiceRequests'

const INITIAL_FILTERS: CaseQueueFilters = {
  query: '',
  category: 'All',
  district: 'All',
  risk: 'All',
  sortKey: 'risk_score',
}

/** True when no filter narrows the result set (so an empty result is unexpected). */
function isDefaultFilters(f: CaseQueueFilters): boolean {
  return !f.query.trim() && f.category === 'All' && f.district === 'All' && f.risk === 'All'
}

// Authenticated live case queue. Server-side filtering against Supabase
// (municipal_service_requests_ml_enriched). If the query fails — or returns no
// rows while no filter is applied — it falls back to bundled mock data.
export default function AppCaseQueuePage() {
  const [filters, setFilters] = useState<CaseQueueFilters>(INITIAL_FILTERS)
  const [rows, setRows] = useState<RequestRow[]>([])
  const [options, setOptions] = useState<FilterOptions>({ categories: [], districts: [] })
  const [loading, setLoading] = useState(true)
  const [fallback, setFallback] = useState(false)

  // Load filter dropdown options once, falling back to mock options.
  useEffect(() => {
    let active = true
    getFilterOptions()
      .then((opts) => {
        if (!active) return
        setOptions(opts.categories.length || opts.districts.length ? opts : mockFilterOptions())
      })
      .catch((err) => {
        console.error('Failed to load filter options, using mock options:', err)
        if (active) setOptions(mockFilterOptions())
      })
    return () => {
      active = false
    }
  }, [])

  // Load (and re-load) rows whenever a filter changes. Search is debounced.
  useEffect(() => {
    let active = true
    const requestFilters: RequestFilters = {
      category: filters.category,
      district: filters.district,
      riskLevel: filters.risk,
      search: filters.query,
      sort: filters.sortKey,
    }

    function useMock() {
      setRows(filterMockRows(mockRequestRows(), requestFilters))
      setFallback(true)
    }

    async function load() {
      setLoading(true)
      setFallback(false)
      try {
        const data = await getMunicipalServiceRequests(requestFilters)
        if (!active) return
        if (data.length === 0 && isDefaultFilters(filters)) {
          // Table reachable but empty with no filter applied — fall back.
          useMock()
        } else {
          setRows(data)
        }
      } catch (err) {
        console.error('Failed to load live case queue data, falling back to mock:', err)
        if (active) useMock()
      } finally {
        if (active) setLoading(false)
      }
    }

    const timer = setTimeout(load, filters.query ? 300 : 0)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [filters])

  return (
    <CaseQueueView
      eyebrow="Live Case Queue"
      casesPath="/app/cases"
      rows={rows}
      options={options}
      loading={loading}
      filters={filters}
      onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
      statusSlot={<SourceBadge fallback={fallback} loading={loading} />}
    />
  )
}

function SourceBadge({ fallback, loading }: { fallback: boolean; loading: boolean }) {
  if (fallback) {
    return (
      <div className="flex items-center gap-2 text-xs text-amber-700">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        Sample data · Supabase unavailable
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 text-xs text-ink-subtle">
      <span className="h-2 w-2 rounded-full bg-accent-500" />
      {loading ? 'Loading…' : 'Live data · Supabase'}
    </div>
  )
}
