import { Link } from 'react-router-dom'
import SectionHeading from '../components/SectionHeading'

const steps = [
  {
    n: '01',
    title: 'Ingest',
    body: 'Pulls public 311 style service request data, open geospatial data, and synthetic enforcement records into a unified case model.',
  },
  {
    n: '02',
    title: 'Normalize',
    body: 'Standardizes addresses, categories, and timestamps so complaints across channels can be compared and clustered.',
  },
  {
    n: '03',
    title: 'Detect patterns',
    body: 'Identifies repeat complaints, geographic clusters, and category escalation signals across rolling time windows.',
  },
  {
    n: '04',
    title: 'Score risk',
    body: 'Combines transparent rules with ML ready features to produce a 0–100 score and a Low / Medium / High / Critical label.',
  },
  {
    n: '05',
    title: 'Summarize',
    body: 'Generates plain language case summaries, risk explanations, and officer ready briefing notes.',
  },
  {
    n: '06',
    title: 'Recommend',
    body: 'Suggests a next operational action (monitor, notice, schedule inspection, escalate) for staff review and decision.',
  },
]

export default function HowItWorksPage() {
  return (
    <div className="container-page py-12">
      <SectionHeading
        eyebrow="How It Works"
        title="From raw complaints to officer ready briefings"
        description="A six step pipeline. Every step is transparent, every output is reviewable, and staff make every final decision."
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
              'Issue notices or penalties automatically',
              'Replace officer judgment or supervisor review',
              'Use private City data in this POC phase',
              'Make irreversible decisions without a human in the loop',
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
              'Surfaces repeat complaint patterns staff might otherwise miss',
              'Produces explainable risk scores with named drivers',
              'Prepares officer briefings with citations to source complaints',
              'Reduces preparation time for inspections and field visits',
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
        <Link to="/dashboard" className="btn-primary">See the demo dashboard</Link>
        <Link to="/methodology" className="btn-secondary">Read the methodology</Link>
      </div>
    </div>
  )
}

function PipelineDiagram() {
  const nodes = [
    { x: 30, label: 'Public 311 data' },
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
      <text x="240" y="129" textAnchor="middle" fontSize="12" fill="#fff" fontWeight="600">Normalize · Cluster · Score</text>

      <line x1="450" y1="125" x2="510" y2="125" stroke="#94a4c5" markerEnd="url(#arrow)" />

      <rect x="510" y="100" width="200" height="50" rx="8" fill="#205c4b" />
      <text x="610" y="129" textAnchor="middle" fontSize="12" fill="#fff" fontWeight="600">AI summaries</text>

      <line x1="710" y1="125" x2="770" y2="125" stroke="#94a4c5" markerEnd="url(#arrow)" />

      <rect x="770" y="100" width="180" height="50" rx="8" fill="#fff" stroke="#cbd5e1" />
      <text x="860" y="129" textAnchor="middle" fontSize="12" fill="#0f1a30">Staff review &amp; action</text>

      <line x1="240" y1="150" x2="240" y2="180" stroke="#94a4c5" markerEnd="url(#arrow)" />
      <rect x="120" y="180" width="240" height="40" rx="8" fill="#fff" stroke="#cbd5e1" />
      <text x="240" y="205" textAnchor="middle" fontSize="11" fill="#0f1a30">Audit trail · explainability</text>
    </svg>
  )
}
