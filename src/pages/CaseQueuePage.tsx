import { useMemo, useState } from 'react'
import CaseQueueView, { type CaseQueueFilters } from '../components/cases/CaseQueueView'
import {
  filterMockComplaints,
  mockComplaintFilterOptions,
  mockComplaintRows,
} from '../services/municipalServiceRequests'

// Public demo case queue. Uses bundled sample data only — filtering happens
// entirely client-side so it is instant and never touches Supabase. The live
// queue lives behind login at /app/cases.
const allRows = mockComplaintRows()
const options = mockComplaintFilterOptions()

const INITIAL_FILTERS: CaseQueueFilters = {
  query: '',
  status: 'All',
  priority: 'All',
  department: 'All',
  category: 'All',
  ward: 'All',
  sortKey: 'submitted_at',
}

export default function CaseQueuePage() {
  const [filters, setFilters] = useState<CaseQueueFilters>(INITIAL_FILTERS)

  const rows = useMemo(
    () =>
      filterMockComplaints(allRows, {
        status: filters.status,
        priority: filters.priority,
        department: filters.department,
        category: filters.category,
        ward: filters.ward,
        search: filters.query,
        sort: filters.sortKey,
      }),
    [filters],
  )

  return (
    <CaseQueueView
      eyebrow="Case Queue"
      casesPath="/cases"
      rows={rows}
      options={options}
      loading={false}
      filters={filters}
      onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
      statusSlot={<SampleDataBadge />}
    />
  )
}

function SampleDataBadge() {
  return (
    <div className="flex items-center gap-2 text-xs text-ink-subtle">
      <span className="h-2 w-2 rounded-full bg-slate-400" />
      Sample data · interactive demo
    </div>
  )
}
