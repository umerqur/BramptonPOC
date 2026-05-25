import SectionHeading from '../components/SectionHeading'

export default function MethodologyPage() {
  return (
    <div className="container-page py-12">
      <SectionHeading
        eyebrow="Methodology"
        title="POC methodology and scope"
        description="This document describes how the proof of concept was constructed, what data it uses, and the boundaries of what it is intended to demonstrate."
      />

      <div className="mt-10 grid gap-8 lg:grid-cols-3">
        <aside className="lg:col-span-1">
          <div className="card p-5 sticky top-24">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">On this page</div>
            <ul className="mt-3 space-y-2 text-sm">
              <li><a href="#scope" className="link-quiet">1. Scope</a></li>
              <li><a href="#data" className="link-quiet">2. Data sources</a></li>
              <li><a href="#features" className="link-quiet">3. Feature design</a></li>
              <li><a href="#scoring" className="link-quiet">4. Risk scoring</a></li>
              <li><a href="#ai" className="link-quiet">5. AI generated content</a></li>
              <li><a href="#hitl" className="link-quiet">6. Human in the loop</a></li>
              <li><a href="#limits" className="link-quiet">7. Known limitations</a></li>
              <li><a href="#next" className="link-quiet">8. Next phase</a></li>
            </ul>
          </div>
        </aside>

        <article className="lg:col-span-2 space-y-10 text-ink leading-relaxed">
          <Section id="scope" title="1. Scope">
            <p>
              This POC demonstrates how AI assistance can support municipal enforcement triage and case preparation. It
              is intentionally scoped to a single workflow — case triage and briefing — and does not attempt to
              automate enforcement decisions or replace existing systems of record.
            </p>
          </Section>

          <Section id="data" title="2. Data sources">
            <ul className="space-y-2 list-disc pl-5">
              <li><strong>Public 311 style service request data:</strong> open municipal service request datasets used to model intake volume and categories.</li>
              <li><strong>Open geospatial data:</strong> ward boundaries, road networks, and parcel level reference data from open data portals.</li>
              <li><strong>Synthetic enforcement records:</strong> generated case files designed to mimic the structure of real enforcement files without using any private City data.</li>
            </ul>
            <p className="mt-3 text-sm text-ink-muted">No private City data is required for this phase. City provided data can be integrated later under privacy and cybersecurity controls.</p>
          </Section>

          <Section id="features" title="3. Feature design">
            <p>Each case is represented by a small, transparent feature set:</p>
            <ul className="mt-3 space-y-2 list-disc pl-5">
              <li>Number of complaints in rolling 7, 14, 30, and 90 day windows</li>
              <li>Number of distinct reporters</li>
              <li>Geographic clustering signal (proximity to other active files)</li>
              <li>Category escalation signal (e.g. waste → property standards)</li>
              <li>Prior closed file indicator for the same address</li>
              <li>Hazard keyword signal extracted from complaint text</li>
            </ul>
          </Section>

          <Section id="scoring" title="4. Risk scoring">
            <p>
              The POC uses a rules based score with weighted contributions from the features above. The result is
              normalized to a 0–100 risk score and mapped to four labels: Low, Medium, High, Critical.
            </p>
            <p className="mt-3">
              Every score is accompanied by named drivers — the specific factors that pushed it up or down — so staff
              can interrogate the recommendation rather than accept it on faith. The design is ML ready: the same
              feature set can be used to train a supervised model when labeled outcome data becomes available.
            </p>
          </Section>

          <Section id="ai" title="5. AI generated content">
            <p>
              AI generated content in this POC is limited to summarization, pattern explanation, and briefing
              preparation. The system does not generate notices, decisions, or external communications. All AI
              generated output is clearly labeled in the interface.
            </p>
          </Section>

          <Section id="hitl" title="6. Human in the loop">
            <p>
              The system is decision support, not decision making. Every recommended action is advisory. Final
              decisions on inspections, notices, escalation, and enforcement remain with authorized municipal staff.
              All AI generated content is logged for audit.
            </p>
          </Section>

          <Section id="limits" title="7. Known limitations">
            <ul className="space-y-2 list-disc pl-5">
              <li>Mock and synthetic data may not reflect the distribution or edge cases of real City case load.</li>
              <li>Rules based scoring is intentionally simple; production deployment would benefit from ML calibration on labeled outcomes.</li>
              <li>Geospatial clustering uses simplified distance heuristics in the POC.</li>
              <li>The POC does not address multilingual intake; this would be added in a production scope.</li>
            </ul>
          </Section>

          <Section id="next" title="8. Next phase">
            <p>
              Next phase work would focus on: secure integration with City systems under appropriate privacy and
              cybersecurity controls, calibration of the scoring model against labeled outcome data, multilingual
              intake, and operational integration with existing case management workflows.
            </p>
          </Section>
        </article>
      </div>
    </div>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-xl font-semibold text-navy-900">{title}</h2>
      <div className="mt-3 text-sm sm:text-base text-ink-muted space-y-3">{children}</div>
    </section>
  )
}
