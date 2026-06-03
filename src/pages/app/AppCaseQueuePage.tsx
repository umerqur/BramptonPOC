import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import CaseQueueView, { type CaseQueueFilters, type SortKey } from '../../components/cases/CaseQueueView'
import {
  filterMockComplaints,
  getComplaintFilterOptions,
  getMunicipalComplaints,
  mockComplaintFilterOptions,
  mockComplaintRows,
  type ComplaintFilterOptions,
  type ComplaintFilters,
  type ComplaintRow,
} from '../../services/municipalServiceRequests'

const VALID_SORT: SortKey[] = ['submitted_at', 'priority', 'status']

/** Build the initial filter state from URL query params (deep links from the console). */
function filtersFromParams(params: URLSearchParams): CaseQueueFilters {
  const get = (key: string, fallback: string) => params.get(key) ?? fallback
  const sortParam = params.get('sort')
  return {
    query: get('q', ''),
    status: get('status', 'All'),
    priority: get('priority', 'All'),
    department: get('department', 'All'),
    category: get('category', 'All'),
    ward: get('ward', 'All'),
    workflowStage: get('stage', 'All'),
    sortKey: VALID_SORT.includes(sortParam as SortKey) ? (sortParam as SortKey) : 'submitted_at',
  }
}

/** Serialize non-default filters back into URL query params, so links are shareable. */
function paramsFromFilters(f: CaseQueueFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (f.query.trim()) params.set('q', f.query.trim())
  if (f.status !== 'All') params.set('status', f.status)
  if (f.priority !== 'All') params.set('priority', f.priority)
  if (f.department !== 'All') params.set('department', f.department)
  if (f.category !== 'All') params.set('category', f.category)
  if (f.ward !== 'All') params.set('ward', f.ward)
  if (f.workflowStage !== 'All') params.set('stage', f.workflowStage)
  if (f.sortKey !== 'submitted_at') params.set('sort', f.sortKey)
  return params
}

const EMPTY_OPTIONS: ComplaintFilterOptions = {
  statuses: [],
  priorities: [],
  departments: [],
  categories: [],
  wards: [],
}

/** True when no filter narrows the result set (so an empty result is unexpected). */
function isDefaultFilters(f: CaseQueueFilters): boolean {
  return (
    !f.query.trim() &&
    f.status === 'All' &&
    f.priority === 'All' &&
    f.department === 'All' &&
    f.category === 'All' &&
    f.ward === 'All' &&
    f.workflowStage === 'All'
  )
}

function hasAnyOption(o: ComplaintFilterOptions): boolean {
  return Boolean(o.statuses.length || o.priorities.length || o.departments.length || o.categories.length || o.wards.length)
}

// Authenticated live case queue. Server-side filtering against Supabase
// (municipal_complaints). If the query fails — or returns no rows while no
// filter is applied — it falls back to bundled mock data.
export default function AppCaseQueuePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  // Seed filter state from the URL once so console deep links (e.g.
  // ?stage=Needs%20review) pre-apply their filter.
  const [filters, setFilters] = useState<CaseQueueFilters>(() => filtersFromParams(searchParams))
  const [rows, setRows] = useState<ComplaintRow[]>([])
  const [options, setOptions] = useState<ComplaintFilterOptions>(EMPTY_OPTIONS)
  const [loading, setLoading] = useState(true)
  const [fallback, setFallback] = useState(false)

  // Load filter dropdown options once, falling back to mock options.
  useEffect(() => {
    let active = true
    getComplaintFilterOptions()
      .then((opts) => {
        if (!active) return
        setOptions(hasAnyOption(opts) ? opts : mockComplaintFilterOptions())
      })
      .catch((err) => {
        console.error('Failed to load filter options, using mock options:', err)
        if (active) setOptions(mockComplaintFilterOptions())
      })
    return () => {
      active = false
    }
  }, [])

  // Load (and re-load) rows whenever a filter changes. Search is debounced.
  useEffect(() => {
    let active = true
    const requestFilters: ComplaintFilters = {
      status: filters.status,
      priority: filters.priority,
      department: filters.department,
      category: filters.category,
      ward: filters.ward,
      workflowStage: filters.workflowStage,
      search: filters.query,
      sort: filters.sortKey,
    }

    function useMock() {
      setRows(filterMockComplaints(mockComplaintRows(), requestFilters))
      setFallback(true)
    }

    async function load() {
      setLoading(true)
      setFallback(false)
      try {
        const data = await getMunicipalComplaints(requestFilters)
        if (!active) return
        if (data.length === 0 && isDefaultFilters(filters)) {
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

  // Keep the URL in sync with the active filters so the view is shareable and
  // back/forward navigation works. Replace (not push) to avoid history spam.
  useEffect(() => {
    const next = paramsFromFilters(filters)
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      activeStage={filters.workflowStage !== 'All' ? filters.workflowStage : undefined}
      onClearStage={() => setFilters((f) => ({ ...f, workflowStage: 'All' }))}
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
