import { useEffect, useState } from 'react'
import DashboardView from '../../components/dashboard/DashboardView'
import {
  getComplaintKpis,
  getComplaintTypes,
  getDepartmentWorkload,
  mockComplaintKpis,
  mockComplaintTypes,
  mockDepartmentWorkload,
  type ComplaintKpis,
  type ComplaintTypeCount,
  type DepartmentWorkload,
} from '../../services/municipalServiceRequests'

// Authenticated live dashboard. Reads complaint KPIs and aggregate views
// directly from Supabase — this route is only reachable after a successful
// login. If the queries fail, the page falls back to bundled mock data so the
// dashboard always renders.
export default function AppDashboardPage() {
  const [kpis, setKpis] = useState<ComplaintKpis | null>(null)
  const [departmentWorkload, setDepartmentWorkload] = useState<DepartmentWorkload[]>([])
  const [complaintTypes, setComplaintTypes] = useState<ComplaintTypeCount[]>([])
  const [loading, setLoading] = useState(true)
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setFallback(false)

    Promise.all([getComplaintKpis(), getDepartmentWorkload(), getComplaintTypes()])
      .then(([kpiData, workload, types]) => {
        if (!active) return
        if (!kpiData || kpiData.total_cases === 0) {
          useMock()
        } else {
          setKpis(kpiData)
          setDepartmentWorkload(workload)
          setComplaintTypes(types)
        }
      })
      .catch((err) => {
        console.error('Failed to load live dashboard data, falling back to mock:', err)
        if (active) useMock()
      })
      .finally(() => active && setLoading(false))

    function useMock() {
      setKpis(mockComplaintKpis())
      setDepartmentWorkload(mockDepartmentWorkload())
      setComplaintTypes(mockComplaintTypes())
      setFallback(true)
    }

    return () => {
      active = false
    }
  }, [])

  return (
    <DashboardView
      kpis={kpis}
      departmentWorkload={departmentWorkload}
      complaintTypes={complaintTypes}
      loading={loading}
      eyebrow="Live Dashboard"
      casesPath="/app/cases"
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
