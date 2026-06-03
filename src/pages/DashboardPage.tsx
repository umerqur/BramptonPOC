import DashboardView from '../components/dashboard/DashboardView'
import {
  mockComplaintKpis,
  mockComplaintTypes,
  mockDepartmentWorkload,
} from '../services/municipalServiceRequests'

// Public demo dashboard. Intentionally uses bundled sample data only — it does
// not query Supabase, so it loads instantly. Live data lives behind login at
// /app/dashboard.
const kpis = mockComplaintKpis()
const departmentWorkload = mockDepartmentWorkload()
const complaintTypes = mockComplaintTypes()

export default function DashboardPage() {
  return (
    <DashboardView
      kpis={kpis}
      departmentWorkload={departmentWorkload}
      complaintTypes={complaintTypes}
      loading={false}
      eyebrow="Workflow Demo"
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
