import SectionHeading from '../components/SectionHeading'

const principles = [
  {
    title: 'Public benchmark data and synthetic internal fields only in POC',
    body: 'The proof of concept is modelled on public benchmark municipal service request data, normalized into a Brampton compatible complaint workflow schema, with synthetic records used only for non public internal workflow fields. Brampton ward boundaries provide real local context where available. This is not Brampton operational complaint data. No private City data is required for this phase.',
  },
  {
    title: 'Decision support, not autonomous enforcement',
    body: 'The system never issues notices, penalties, or external communications on its own. Every recommendation is reviewed by authorized municipal staff.',
  },
  {
    title: 'Explainability by default',
    body: 'Every risk score is published with the named factors that produced it. AI generated content is clearly labeled in the interface and stored alongside its source inputs.',
  },
  {
    title: 'Auditability',
    body: 'A full audit trail is maintained for case actions, AI generated outputs, and staff overrides. Audit access would be role gated in a production deployment.',
  },
  {
    title: 'Minimum necessary data',
    body: 'Production integrations would follow a minimum necessary principle: only the fields required to produce a recommendation should be ingested, and retention should be aligned to operational need.',
  },
  {
    title: 'Cybersecurity controls',
    body: 'Any future City data integration would be implemented under the City’s privacy, cybersecurity, and procurement controls — including data classification, encryption in transit and at rest, role based access, and logging.',
  },
]

export default function PrivacyPage() {
  return (
    <div className="container-page py-12">
      <SectionHeading
        eyebrow="Privacy & Security"
        title="How this POC handles data, decisions, and accountability"
        description="The proof of concept is designed with public sector privacy and accountability expectations in mind. This page summarizes the principles applied."
      />

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {principles.map((p) => (
          <div key={p.title} className="card p-6">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 h-8 w-8 rounded-md bg-navy-900 text-white flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-navy-900">{p.title}</h3>
                <p className="mt-1.5 text-sm text-ink-muted">{p.body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 card p-6 lg:p-8">
        <h3 className="text-base font-semibold text-navy-900">Data flow summary</h3>
        <ol className="mt-4 space-y-3 text-sm text-ink-muted">
          <Step n="01" title="Ingestion">Only public and synthetic records are ingested in the POC.</Step>
          <Step n="02" title="Processing">Records are normalized, clustered, and scored using transparent features.</Step>
          <Step n="03" title="AI generation">Summaries and briefings are generated for staff review and labeled as AI generated.</Step>
          <Step n="04" title="Staff review">Authorized municipal staff review all recommendations and make final decisions.</Step>
          <Step n="05" title="Audit">All AI outputs and staff actions are logged for audit and oversight.</Step>
        </ol>
      </div>

      <div className="mt-8 rounded-xl border border-navy-200 bg-navy-50 p-5 text-sm text-navy-800">
        <strong>Important positioning.</strong> This system is not replacing officers. It is decision support. It uses
        public and synthetic data for the initial POC. City provided data can be integrated later under privacy and
        cybersecurity controls.
      </div>
    </div>
  )
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="text-xs font-semibold text-accent-700 tabular-nums w-6 shrink-0">{n}</span>
      <div>
        <div className="text-sm font-medium text-navy-900">{title}</div>
        <div className="text-sm">{children}</div>
      </div>
    </li>
  )
}
