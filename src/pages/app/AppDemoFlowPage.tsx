import { Link, useNavigate } from 'react-router-dom'
import { useWorkflow } from '../../lib/workflowStore'
import {
  AutomationBadge,
  CaseChipLine,
  GuardrailFooter,
  WorkflowStepper,
} from '../../components/workflow/WorkflowUI'

// POC Walkthrough — the guided synthetic end-to-end story (no longer the staff
// landing page; staff now land on the Staff Inbox). It shows the full product
// flow as a swimlane that mirrors the use-case concept diagram (Resident → AI
// workflow system → By-law staff), implemented as app UI rather than a static
// image. A reviewer should understand in ~2 minutes how the app reduces staff
// workload: the AI does intake, classification, context, summary, draft, and
// audit; staff only review exceptions and approve.

type LaneCard = {
  n?: string
  title: string
  bullets: string[]
}

const AI_CARDS: LaneCard[] = [
  { n: '1', title: 'Intake captured', bullets: ['Parse intake fields', 'Create case object', 'Check missing info'] },
  { n: '2', title: 'AI classifies complaint', bullets: ['Identify issue type', 'Extract location & facts', 'Recommend department'] },
  { n: '3', title: 'Gather enforcement context', bullets: ['Complaint history', 'Patrol & ticket records', 'Policy / template match'] },
  { n: '4', title: 'Build case summary', bullets: ['Summarize key facts', 'Detect repeats / hotspots', 'Draft closure context'] },
]

const AI_CARDS_RIGHT: LaneCard[] = [
  { n: '6', title: 'Generate closure response', bullets: ['Resident-friendly message', 'Policy-aligned language', 'Transparent update'] },
  { n: '8', title: 'Audit trail & insights', bullets: ['Log every decision', 'Track trends', 'Support prioritization'] },
]

const STAFF_CARDS: LaneCard[] = [
  { title: 'Needs staff attention', bullets: ['Clarify details', 'Override routing / priority', 'Request more information'] },
  { n: '5', title: 'Staff review draft', bullets: ['Review AI summary', 'Edit if needed', 'Approve response'] },
  { n: '7', title: 'Final approval', bullets: ['Human in the loop'] },
]

const WORKLOAD_REDUCED = [
  'Less manual research',
  'Fewer follow-up calls',
  'Faster draft responses',
  'More consistent closure language',
]

export default function AppDemoFlowPage() {
  const { activeCase, cases, resetDemo } = useWorkflow()
  const navigate = useNavigate()

  return (
    <div className="container-page py-10">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <div className="section-eyebrow">City of Brampton use-case concept</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">
            Proactive Enforcement Response — AI-assisted complaint closure
          </h1>
          <p className="mt-3 text-ink-muted">
            A resident complaint comes in, and the AI workflow system captures intake, classifies it, gathers
            enforcement context, builds a case summary, checks confidence, and prepares a closure-response draft. By-law
            staff only review exceptions, edit if needed, and approve the final response — the system logs every
            decision and updates insights.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <AutomationBadge kind="ai" />
            <AutomationBadge kind="review" />
            <AutomationBadge kind="approval" />
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <Link to="/app/intake" className="btn-primary">
            Run the demo →
          </Link>
          <button onClick={resetDemo} className="btn-secondary text-sm">
            Reset demo data
          </button>
        </div>
      </div>

      {/* Active case progress (if any) */}
      {activeCase && (
        <div className="mt-8 card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CaseChipLine c={activeCase} />
            <button onClick={() => navigate('/app/triage')} className="text-sm font-semibold text-accent-600 hover:text-accent-700">
              Open active case →
            </button>
          </div>
          <div className="mt-4">
            <WorkflowStepper stage={activeCase.stage} />
          </div>
        </div>
      )}

      {/* Swimlane */}
      <div className="mt-8 space-y-4">
        <Lane
          tone="resident"
          label="Resident"
          to="/app/intake"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <FlowCard title="Submit complaint" bullets={['Web / phone / email / service request', 'Location, issue details, optional photo']} />
            <FlowCard title="Resident receives closure update" bullets={['Clear, personalized, transparent response', 'Staff-approved before any send']} tone="resident" />
          </div>
        </Lane>

        <Lane tone="ai" label="AI Workflow System" to="/app/triage">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {AI_CARDS.map((c) => (
              <FlowCard key={c.title} {...c} tone="ai" />
            ))}
          </div>
          <div className="my-3 flex items-center justify-center gap-3 text-xs font-medium text-ink-muted">
            <span className="rounded-full border border-accent-300 bg-accent-50 px-3 py-1 text-accent-800">Enough confidence?</span>
            <span className="text-accent-700">Yes → staff review draft</span>
            <span className="text-amber-700">No → needs staff attention</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {AI_CARDS_RIGHT.map((c) => (
              <FlowCard key={c.title} {...c} tone="ai" />
            ))}
          </div>
        </Lane>

        <Lane tone="staff" label="By-Law Staff" to="/app/closure">
          <div className="grid gap-3 sm:grid-cols-3">
            {STAFF_CARDS.map((c) => (
              <FlowCard key={c.title} {...c} tone="staff" />
            ))}
          </div>
        </Lane>
      </div>

      {/* Where workload is reduced + stats */}
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="card p-6 lg:col-span-2">
          <h2 className="text-sm font-semibold text-navy-900">Where workload is reduced</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {WORKLOAD_REDUCED.map((w) => (
              <div key={w} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-navy-900">
                <span className="inline-block h-2 w-2 rounded-full bg-accent-500" />
                {w}
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-ink-subtle">
            This is not automated enforcement, crime prediction, or officer replacement. It is AI-assisted closure-response
            automation and decision support, with final review by authorized staff.
          </p>
        </div>
        <div className="card p-6">
          <h2 className="text-sm font-semibold text-navy-900">Demo cases in play</h2>
          <div className="mt-4 stat-value">{cases.length}</div>
          <p className="stat-label">synthetic cases across the workflow</p>
          <div className="mt-5">
            <Link to="/app/insights" className="text-sm font-semibold text-accent-600 hover:text-accent-700">
              See supervisor impact →
            </Link>
          </div>
        </div>
      </div>

      <GuardrailFooter />
    </div>
  )
}

function Lane({
  tone,
  label,
  to,
  children,
}: {
  tone: 'resident' | 'ai' | 'staff'
  label: string
  to: string
  children: React.ReactNode
}) {
  const accent =
    tone === 'ai'
      ? 'border-l-accent-500 bg-accent-50/40'
      : tone === 'staff'
        ? 'border-l-navy-700 bg-navy-50/40'
        : 'border-l-sky-500 bg-sky-50/40'
  const chip =
    tone === 'ai' ? 'bg-accent-600 text-white' : tone === 'staff' ? 'bg-navy-800 text-white' : 'bg-sky-600 text-white'
  return (
    <section className={`rounded-xl border border-slate-200 border-l-4 ${accent} p-4`}>
      <div className="mb-3 flex items-center justify-between">
        <span className={`badge ${chip}`}>{label}</span>
        <Link to={to} className="text-xs font-semibold text-accent-700 hover:text-accent-800">
          Open →
        </Link>
      </div>
      {children}
    </section>
  )
}

function FlowCard({
  n,
  title,
  bullets,
  tone = 'ai',
}: LaneCard & { tone?: 'resident' | 'ai' | 'staff' }) {
  const numCls =
    tone === 'ai' ? 'bg-accent-600' : tone === 'staff' ? 'bg-navy-800' : 'bg-sky-600'
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-card">
      <div className="flex items-center gap-2">
        {n && (
          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${numCls} text-[11px] font-semibold text-white`}>
            {n}
          </span>
        )}
        <span className="text-sm font-semibold text-navy-900">{title}</span>
      </div>
      <ul className="mt-2 space-y-1">
        {bullets.map((b) => (
          <li key={b} className="flex gap-1.5 text-xs text-ink-muted">
            <span className="text-ink-subtle">•</span>
            {b}
          </li>
        ))}
      </ul>
    </div>
  )
}
