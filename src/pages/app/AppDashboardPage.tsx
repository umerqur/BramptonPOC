import { useEffect, useState } from 'react'
import DashboardView from '../../components/dashboard/DashboardView'
import { getDashboardStats, type DashboardStats } from '../../services/municipalServiceRequests'

// Authenticated live dashboard. Reads directly from Supabase — this route is
// only reachable after a successful magic-link login, and RLS restricts the
// table to authenticated users.
export default function AppDashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getDashboardStats()
      .then((data) => active && setStats(data))
      .catch((err) => {
        console.error('Failed to load live dashboard data:', err)
        if (active) setError('Unable to load live data right now. Please try again shortly.')
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
