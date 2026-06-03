import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import CaseQueueConsole from '../../components/cases/CaseQueueConsole'
import type { CaseQueueFilters, SortKey } from '../../components/cases/CaseQueueView'
import {
  getComplaintFilterOptions,
  getMunicipalComplaints,
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

// Authenticated live case queue — the staff work queue for individual
// complaints. Server-side filtering against Supabase (municipal_complaints).
// Live data only: no mock fallback. A failed query surfaces an explicit error
// state with retry instead of silently swapping in sample cases.
export default function AppCaseQueuePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  // Seed filter state from the URL once so console deep links (e.g.
  // ?stage=Needs%20review) pre-apply their filter.
  const [filters, setFilters] = useState<CaseQueueFilters>(() => filtersFromParams(searchParams))
  const [rows, setRows] = useState<ComplaintRow[]>([])
  const [options, setOptions] = useState<ComplaintFilterOptions>(EMPTY_OPTIONS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Bumped by the Retry button to re-run the loaders.
  const [reloadKey, setReloadKey] = useState(0)

  // Load filter dropdown options (live only). A failure here is non-fatal — the
  // selects simply stay empty — so it does not trigger the page error state.
  useEffect(() => {
    let active = true
    getComplaintFilterOptions()
      .then((opts) => active && setOptions(opts))
      .catch((err) => {
        console.error('Failed to load filter options:', err)
        if (active) setOptions(EMPTY_OPTIONS)
      })
    return () => {
      active = false
    }
  }, [reloadKey])

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

    async function load() {
      setLoading(true)
      try {
        const data = await getMunicipalComplaints(requestFilters)
        if (!active) return
        setRows(data)
        setError(null)
      } catch (err) {
        console.error('Failed to load live case queue data:', err)
        if (active) {
          setRows([])
          setError(errorMessage(err))
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
  }, [filters, reloadKey])

  // Keep the URL in sync with the active filters so the view is shareable and
  // back/forward navigation works. Replace (not push) to avoid history spam.
  useEffect(() => {
    const next = paramsFromFilters(filters)
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const handleRetry = useCallback(() => setReloadKey((k) => k + 1), [])

  return (
    <CaseQueueConsole
      eyebrow="Live Case Queue"
      casesPath="/app/cases"
      rows={rows}
      options={options}
      loading={loading}
      error={error}
      onRetry={handleRetry}
      filters={filters}
      onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
      statusSlot={<SourceBadge loading={loading} error={error} />}
      activeStage={filters.workflowStage !== 'All' ? filters.workflowStage : undefined}
      onClearStage={() => setFilters((f) => ({ ...f, workflowStage: 'All' }))}
    />
  )
}

function SourceBadge({ loading, error }: { loading: boolean; error: string | null }) {
  if (error) {
    return (
      <div className="flex items-center gap-2 text-xs text-red-700">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        Supabase unavailable
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
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err)
}
