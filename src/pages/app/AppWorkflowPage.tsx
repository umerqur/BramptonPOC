import { Link } from 'react-router-dom'
import { DATA_POSITIONING } from '../../services/municipalServiceRequests'

type Stage = {
  step: number
  title: string
  description: string
  fields: string
}

// The complaint lifecycle, with each stage pointed at the actual data it maps
// to in municipal_complaints, workflow_events, and the KPI views.
const STAGES: Stage[] = [
  {
    step: 1,
    title: 'Complaint intake',
    description: 'A resident complaint is received through a public channel and recorded as a case.',
    fields: 'complaint_type, description, address_or_location, submitted_at',
  },
  {
    step: 2,
    title: 'Data validation',
    description: 'Source, geography, and area fields are checked so the case can be routed and located.',
    fields: 'source_city, source_dataset, ward_or_area, fsa_or_area',
  },
  {
    step: 3,
    title: 'AI-assisted triage',
    description: 'Rule based POC triage suggests a category, priority, summary, and recommended action.',
    fields: 'ai_category, ai_priority, ai_summary, ai_recommended_action',
  },
  {
    step: 4,
    title: 'Human review',
    description: 'Authorized staff review the triage and record a decision. Staff reviewed decision support.',
    fields: 'human_decision, workflow_events',
  },
  {
    step: 5,
    title: 'Case assignment',
    description: 'The complaint is assigned to the responsible department and unit.',
    fields: 'assigned_department, department_unit',
  },
  {
    step: 6,
    title: 'Investigation and action logging',
    description: 'Inspections, warnings, tickets, referrals, and other actions are logged as workflow events.',
    fields: 'workflow_events',
  },
  {
    step: 7,
    title: 'Resident response drafting',
    description: 'A resident-facing response is drafted from the case fields for staff to review and send.',
    fields: 'complaint_type, status, assigned_department, ai_summary, ai_recommended_action',
  },
  {
    step: 8,
    title: 'Closure and KPI reporting',
    description: 'The case is closed and rolls up into program KPIs and aggregate workload views.',
    fields: 'status, resolution_status, v_municipal_complaint_kpis',
  },
]

// Authenticated workflow overview. Explains the end-to-end complaint lifecycle
// and ties each stage to real data fields.
export default function AppWorkflowPage() {
  return (
    <div className="container-page py-10">
      <div className="section-eyebrow">Workflow</div>
      <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">
        Complaint workflow and closure lifecycle
      </h1>
      <p className="mt-2 text-sm text-ink-muted max-w-3xl">{DATA_POSITIONING}</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {STAGES.map((stage) => (
          <div key={stage.step} className="card p-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-white tabular-nums">
                {stage.step}
              </span>
              <h3 className="text-sm font-semibold text-navy-900">{stage.title}</h3>
            </div>
            <p className="mt-3 text-sm text-ink leading-relaxed">{stage.description}</p>
            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-wider text-ink-subtle">Maps to</div>
              <code className="mt-1 block text-xs text-navy-800 bg-slate-50 rounded px-2 py-1 break-words">
                {stage.fields}
              </code>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap gap-4">
        <Link to="/app/cases" className="text-sm font-medium text-navy-700 hover:text-navy-900">
          Open the case queue →
        </Link>
        <Link to="/app/dashboard" className="text-sm font-medium text-navy-700 hover:text-navy-900">
          View KPI dashboard →
        </Link>
      </div>
    </div>
  )
}
