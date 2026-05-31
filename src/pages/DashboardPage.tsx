import DashboardView from '../components/dashboard/DashboardView'
import { mockDashboardStats } from '../services/municipalServiceRequests'

// Public demo dashboard. Intentionally uses bundled sample data only — it does
// not query Supabase, so it loads instantly and always looks good. Live data
// lives behind login at /app/dashboard.
const stats = mockDashboardStats()

export default function DashboardPage() {
  return (
    <DashboardView
      stats={stats}
      loading={false}
      eyebrow="Demo Dashboard"
      casesPath="/cases"
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
