import { useEffect, useState } from 'react'
import CaseQueueView, { type CaseQueueFilters } from '../../components/cases/CaseQueueView'
import {
  getFilterOptions,
  getMunicipalServiceRequests,
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

// Authenticated live case queue. Server-side filtering against Supabase.
export default function AppCaseQueuePage() {
  const [filters, setFilters] = useState<CaseQueueFilters>(INITIAL_FILTERS)
  const [rows, setRows] = useState<RequestRow[]>([])
  const [options, setOptions] = useState<FilterOptions>({ categories: [], districts: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load filter dropdown options once.
  useEffect(() => {
    let active = true
    getFilterOptions()
      .then((opts) => active && setOptions(opts))
      .catch((err) => console.error('Failed to load filter options:', err))
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

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await getMunicipalServiceRequests(requestFilters)
        if (active) setRows(data)
      } catch (err) {
        console.error('Failed to load live case queue data:', err)
        if (active) {
          setRows([])
          setError('Unable to load live data right now. Please try again shortly.')
        }
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
      statusSlot={<LiveBadge error={error} loading={loading} />}
    />
  )
}

function LiveBadge({ error, loading }: { error: string | null; loading: boolean }) {
  if (error) {
    return (
      <div className="flex items-center gap-2 text-xs text-amber-700">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        {error}
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
