import { Link } from 'react-router-dom'
import SectionHeading from '../components/SectionHeading'

const steps = [
  {
    n: '01',
    title: 'Resident complaint enters intake',
    body: 'A resident submits a parking infraction request through the demo service request form and receives a reference number.',
  },
  {
    n: '02',
    title: 'Staff receives the request',
    body: 'Enforcement and By Law staff see the request in the Resident Intake workbench and explicitly mark it received.',
  },
  {
    n: '03',
    title: 'Officer assignment and review',
    body: 'Staff assign the request and move it into review or investigation. The resident can check status at any time.',
  },
  {
    n: '04',
    title: 'Enforcement context is gathered',
    body: 'The Closure Review Workbench brings together complaint details, patrol logs, ticket records, and complaint trends.',
  },
  {
    n: '05',
    title: 'AI drafts closure language',
    body: 'On staff request, AI prepares a staff summary, recommended next step, resident friendly update, and closure language when appropriate.',
  },
  {
    n: '06',
    title: 'Staff approve before anything happens',
    body: 'Staff make the decision. No automated enforcement, no automatic penalties, and no resident communication without explicit staff action.',
  },
]

export default function HowItWorksPage() {
  return (
    <div className="container-page py-12">
      <SectionHeading
        eyebrow="How It Works"
        title="From complaint intake to staff approved closure"
        description="The Closure Review Workbench in six steps. AI automates research, analysis, and draft preparation — staff approve every closure and every resident communication."
      />

      <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {steps.map((s) => (
          <div key={s.n} className="card p-6 card-hover">
            <div className="text-xs font-semibold text-accent-700">{s.n}</div>
            <h3 className="mt-1.5 text-base font-semibold text-navy-900">{s.title}</h3>
            <p className="mt-2 text-sm text-ink-muted">{s.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-12 card p-6 lg:p-8">
        <h3 className="text-base font-semibold text-navy-900">Architecture sketch</h3>
        <p className="mt-1 text-sm text-ink-muted">A simplified view of the POC pipeline.</p>
        <div className="mt-6 overflow-x-auto">
          <PipelineDiagram />
        </div>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <h3 className="text-base font-semibold text-navy-900">What this system does not do</h3>
          <ul className="mt-3 space-y-2 text-sm text-ink">
            {[
              'Close cases or contact residents without staff approval',
              'Issue notices or penalties automatically',
              'Replace officer judgment or supervisor review',
              'Use private City data in this POC phase',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <svg className="mt-1 text-red-500 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card p-6">
          <h3 className="text-base font-semibold text-navy-900">What it does do</h3>
          <ul className="mt-3 space-y-2 text-sm text-ink">
            {[
              'Gathers enforcement context, complaint trends, and patrol or ticket style records',
              'Prioritizes the review queue with an explainable Needs Attention score',
              'Drafts staff summaries and resident friendly closure messages for approval',
              'Reduces the research and writing time behind each closure response',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <svg className="mt-1 text-accent-600 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-12 flex flex-col sm:flex-row gap-3">
        <Link to="/login" className="btn-primary">Sign in to the Closure Review Workbench</Link>
        <Link to="/methodology" className="btn-secondary">Read the methodology</Link>
      </div>
    </div>
  )
}

function PipelineDiagram() {
  const nodes = [
    { x: 30, label: 'Toronto 311 benchmark' },
    { x: 175, label: 'Synthetic records' },
    { x: 320, label: 'Geospatial data' },
  ]
  return (
    <svg viewBox="0 0 980 240" className="w-full min-w-[760px]">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#94a4c5" />
        </marker>
      </defs>

      {nodes.map((n) => (
        <g key={n.label}>
          <rect x={n.x} y="20" width="130" height="50" rx="8" fill="#fff" stroke="#cbd5e1" />
          <text x={n.x + 65} y="49" textAnchor="middle" fontSize="11" fill="#0f1a30">{n.label}</text>
          <line x1={n.x + 65} y1="70" x2={n.x + 65} y2="100" stroke="#94a4c5" markerEnd="url(#arrow)" />
        </g>
      ))}

      <rect x="30" y="100" width="420" height="50" rx="8" fill="#0f1a30" />
      <text x="240" y="129" textAnchor="middle" fontSize="12" fill="#fff" fontWeight="600">Normalize · Queue · Score</text>

      <line x1="450" y1="125" x2="510" y2="125" stroke="#94a4c5" markerEnd="url(#arrow)" />

      <rect x="510" y="100" width="200" height="50" rx="8" fill="#205c4b" />
      <text x="610" y="129" textAnchor="middle" fontSize="12" fill="#fff" fontWeight="600">AI Review Packet</text>

      <line x1="710" y1="125" x2="770" y2="125" stroke="#94a4c5" markerEnd="url(#arrow)" />

      <rect x="770" y="100" width="180" height="50" rx="8" fill="#fff" stroke="#cbd5e1" />
      <text x="860" y="129" textAnchor="middle" fontSize="12" fill="#0f1a30">Staff approval</text>

      <line x1="240" y1="150" x2="240" y2="180" stroke="#94a4c5" markerEnd="url(#arrow)" />
      <rect x="120" y="180" width="240" height="40" rx="8" fill="#fff" stroke="#cbd5e1" />
      <text x="240" y="205" textAnchor="middle" fontSize="11" fill="#0f1a30">Audit trail · explainability</text>
    </svg>
  )
}
