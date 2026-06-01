import { useEffect, useState } from 'react'
import DashboardView from '../../components/dashboard/DashboardView'
import {
  getDashboardStats,
  mockDashboardStats,
  type DashboardStats,
} from '../../services/municipalServiceRequests'

// Authenticated live dashboard. Reads directly from Supabase
// (municipal_service_requests_ml_enriched) — this route is only reachable after
// a successful magic-link login, and RLS restricts the table to authenticated
// users. If the query fails or returns no rows, the page falls back to bundled
// mock data so the dashboard always renders.
export default function AppDashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setFallback(false)
    getDashboardStats()
      .then((data) => {
        if (!active) return
        if (data.total === 0) {
          // Live table reachable but empty — use mock data as a fallback.
          setStats(mockDashboardStats())
          setFallback(true)
        } else {
          setStats(data)
        }
      })
      .catch((err) => {
        console.error('Failed to load live dashboard data, falling back to mock:', err)
        if (active) {
          setStats(mockDashboardStats())
          setFallback(true)
        }
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  return (
    <DashboardView
      stats={stats}
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
