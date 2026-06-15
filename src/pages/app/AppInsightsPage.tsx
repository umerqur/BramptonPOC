import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import DashboardView from '../../components/dashboard/DashboardView'
import TorontoWardContextPanel from '../../components/app/TorontoWardContextPanel'
import { GuardrailFooter } from '../../components/workflow/WorkflowUI'
import { useWorkflow } from '../../lib/workflowStore'
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

// Operational insights — the merged Insights tab. It combines two views that used
// to live on separate routes:
//   1. The live complaint workload dashboard (formerly /app/dashboard) — Toronto
//      311 benchmark KPIs, workload by department, top complaint types, with a
//      live-data Supabase indicator. The data-loading logic is reused verbatim
//      from the former AppDashboardPage.
//   2. The supervisor workflow-impact metrics (formerly the Supervisor Insights
//      page) — "Where workload is reduced", AI throughput, estimated workload
//      avoided, and the automation-vs-human-review split.
// The real Toronto ward workload heat map (TorontoWardContextPanel) sits second
// from the top, directly under the page header. Both /app/dashboard and
// /app/supervisor now redirect here.

type Metric = { label: string; value: string; sub: string; tone?: 'default' | 'accent' }

export default function AppInsightsPage() {
  // --- Live dashboard data (reused from the former AppDashboardPage) ---
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
          applyMock()
        } else {
          setKpis(kpiData)
          setDepartmentWorkload(workload)
          setComplaintTypes(types)
        }
      })
      .catch((err) => {
        console.error('Failed to load live dashboard data, falling back to mock:', err)
        if (active) applyMock()
      })
      .finally(() => active && setLoading(false))

    function applyMock() {
      setKpis(mockComplaintKpis())
      setDepartmentWorkload(mockDepartmentWorkload())
      setComplaintTypes(mockComplaintTypes())
      setFallback(true)
    }

    return () => {
      active = false
    }
  }, [])

  // --- Supervisor workflow-impact metrics (synthetic workflow store) ---
  const { metrics, cases } = useWorkflow()

  const primary: Metric[] = [
    { label: 'New complaints processed', value: String(metrics.newComplaintsProcessed), sub: 'intake captured by AI' },
    { label: 'AI classified', value: String(metrics.aiClassified), sub: 'auto type + routing' },
    { label: 'AI summaries generated', value: String(metrics.aiSummariesGenerated), sub: 'plain-language case summaries' },
    { label: 'Closure drafts prepared', value: String(metrics.closureDraftsPrepared), sub: 'ready for staff review', tone: 'accent' },
  ]

  const savings: Metric[] = [
    { label: 'Staff review exceptions', value: String(metrics.staffReviewExceptions), sub: 'cases needing a human look' },
    { label: 'Manual research avoided', value: `~${metrics.manualResearchHoursAvoided} hrs`, sub: 'context gathered automatically', tone: 'accent' },
    { label: 'Follow-up calls reduced', value: `~${metrics.followUpCallsReduced}`, sub: 'from clearer closure responses', tone: 'accent' },
    { label: 'Avg draft time saved', value: `~${metrics.avgDraftMinutesSaved} min`, sub: 'per closure response', tone: 'accent' },
  ]

  return (
    <>
      {/* Page header + Toronto ward workload heat map (second from the top) */}
      <div className="container-page pt-10">
        <div className="max-w-3xl">
          <div className="section-eyebrow">INSIGHTS</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">Operational insights</h1>
          <p className="mt-2 text-ink-muted">
            This page combines live complaint workload patterns from the Toronto 311 benchmark dataset with
            supervisor-level workflow impact metrics — one view of both where the work is and how much of it the AI
            workflow is taking off staff. Decision support only; staff review every case.
          </p>
        </div>

        {/* Heat map — real Toronto ward workload intensity (compact embed) */}
        <TorontoWardContextPanel showValidationLayers={false} />
      </div>

      {/* Section 1 — live complaint workload dashboard (brings its own container) */}
      <DashboardView
        kpis={kpis}
        departmentWorkload={departmentWorkload}
        complaintTypes={complaintTypes}
        loading={loading}
        eyebrow="Live complaint workload"
        casesPath="/app/cases"
        statusSlot={<SourceBadge fallback={fallback} loading={loading} />}
      />

      {/* Section 2 — supervisor workflow impact */}
      <div className="container-page pb-10">
        <div className="max-w-3xl">
          <div className="section-eyebrow">Supervisor view</div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">
            Where workload is reduced
          </h2>
          <p className="mt-2 text-ink-muted">
            How the AI workflow system is reducing manual effort across intake, classification, research, summarization,
            and draft writing — while staff keep final approval.
          </p>
        </div>

        <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
          Demo estimates from synthetic case volume — illustrative, not operational figures.
        </div>

        {/* Primary throughput metrics */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {primary.map((m) => (
            <MetricCard key={m.label} {...m} />
          ))}
        </div>

        {/* Workload savings */}
        <h3 className="mt-10 text-sm font-semibold uppercase tracking-wide text-ink-subtle">Estimated workload avoided</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {savings.map((m) => (
            <MetricCard key={m.label} {...m} />
          ))}
        </div>

        {/* Automation vs human split */}
        <div className="mt-10 card p-6">
          <h3 className="text-sm font-semibold text-navy-900">Automation vs. human review</h3>
          <p className="mt-1 text-xs text-ink-subtle">Of {cases.length} synthetic cases currently in play.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-accent-700">AI role</div>
              <ul className="mt-2 space-y-1.5 text-sm text-ink-muted">
                <li>• Intake processing &amp; classification</li>
                <li>• Context gathering &amp; summarization</li>
                <li>• Closure-draft generation</li>
                <li>• Audit logging &amp; trend support</li>
              </ul>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-navy-700">Staff role</div>
              <ul className="mt-2 space-y-1.5 text-sm text-ink-muted">
                <li>• Review exceptions</li>
                <li>• Edit drafts where needed</li>
                <li>• Override routing / priority</li>
                <li>• Approve every final response</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Supporting operational views (the former standalone consoles) */}
        <h3 className="mt-10 text-sm font-semibold uppercase tracking-wide text-ink-subtle">Supporting operational views</h3>
        <p className="mt-1 text-sm text-ink-muted">
          The prior queue, workflow counts, full ward context, and statistical attention score — kept as supporting
          analytics rather than the main product.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SupportLink to="/app/legacy-insights" title="Statistical attention queue" desc="Review Attention Score ranking and area context." />
          <SupportLink to="/app/workflow" title="Workflow & lifecycle" desc="Workflow counts and case lifecycle stages." />
          <SupportLink to="/app/wards" title="Full ward context" desc="Full Toronto ward workload map with data-layer validation." />
          <SupportLink to="/app/cases" title="Case queue" desc="Benchmark case list and detail views." />
          <SupportLink to="/app/resident-intake" title="Resident intake (Supabase)" desc="Live resident-request intake demo." />
        </div>

        <GuardrailFooter />
      </div>
    </>
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

function MetricCard({ label, value, sub, tone = 'default' }: Metric) {
  return (
    <div className={`card p-5 ${tone === 'accent' ? 'border-accent-200 bg-accent-50/40' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums ${tone === 'accent' ? 'text-accent-700' : 'text-navy-900'}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-ink-subtle">{sub}</div>
    </div>
  )
}

function SupportLink({ to, title, desc }: { to: string; title: string; desc: string }) {
  return (
    <Link to={to} className="card card-hover flex flex-col p-5">
      <span className="text-sm font-semibold text-navy-900">{title}</span>
      <span className="mt-1 flex-1 text-sm text-ink-muted">{desc}</span>
      <span className="mt-3 text-sm font-semibold text-accent-600">Open →</span>
    </Link>
  )
}
