import SectionHeading from '../components/SectionHeading'

const sections = [
  {
    title: 'Data foundation',
    body: 'Toronto 311 public benchmark data is normalized into a Brampton-compatible enforcement workflow schema. It is not Brampton operational data.',
  },
  {
    title: 'Resident intake simulation',
    body: 'The resident form creates demo general enforcement complaint records (parking, property standards, noise, dumping, and other by-law concerns) so the workflow can be shown end-to-end, from intake to staff review to resident status update.',
  },
  {
    title: 'Statistical Queue Insights',
    body: 'The Review Attention Score is classical statistical scoring, not machine learning. It uses transparent factors such as case age, repeat location signals, area trends, complaint type backlog, missing context, and department workload concentration.',
  },
  {
    title: 'Agentic AI review support',
    body: 'After staff select a case, AI can gather context, summarize the file, and draft resident-friendly update or closure language. Staff approve all actions.',
  },
  {
    title: 'Human oversight',
    body: 'The system does not enforce, issue penalties, close cases, or contact residents on its own.',
  },
]

export default function MethodologyPage() {
  return (
    <div className="container-page py-12">
      <SectionHeading
        eyebrow="Methodology"
        title="Methodology"
        description="How the proof of concept turns complaint data into staff review support."
      />

      <div className="mt-10 max-w-2xl space-y-4">
        {sections.map((s) => (
          <section key={s.title} className="card p-6">
            <h2 className="text-lg font-semibold text-navy-900">{s.title}</h2>
            <p className="mt-2 text-ink-muted">{s.body}</p>
          </section>
        ))}
      </div>
    </div>
  )
}
