import { Link } from 'react-router-dom'
import SectionHeading from '../components/SectionHeading'

const aiCapabilities = [
  { title: 'Gathers enforcement context', body: 'Pulls together complaint details, area, status, department, and related history into one case workspace.' },
  { title: 'Surfaces complaint trends', body: 'Identifies repeat complaints and trend signals across addresses, areas, and categories, including patrol and ticket style records where available.' },
  { title: 'Prioritizes the review queue', body: 'A Needs Attention score helps staff decide which complaint files to review first.' },
  { title: 'Flags issues with transparent rules', body: 'Deterministic rules flag missing information, safety wording, supervisor review, and closure candidates — no black box.' },
  { title: 'Drafts closure responses', body: 'The AI Review Packet drafts a staff summary, recommended next step, resident friendly update, and closure language when appropriate.' },
  { title: 'Routes everything through staff approval', body: 'Every draft is advisory. Staff must approve before any closure or resident communication.' },
]

export default function LandingPage() {
  return (
    <div>
      {/* Hero — CTA first, blended image background */}
      <section className="relative overflow-hidden bg-navy-950 text-white">
        {/* Image as a right-side background layer on desktop, blended into the
            navy via a left-to-right gradient. Hidden on mobile (shown below). */}
        <div className="pointer-events-none absolute inset-y-0 right-0 z-0 hidden w-[62%] lg:block">
          <img
            src="/images/brampton-poc-hero.png"
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover opacity-85 brightness-110 contrast-105"
          />
          {/* Strong navy gradient on the left so the headline stays readable,
              fading to mostly clear on the right to reveal the image. */}
          <div className="absolute inset-0 bg-gradient-to-r from-navy-950 via-navy-950/70 to-navy-950/15" />
          <div className="absolute inset-0 bg-gradient-to-t from-navy-950/45 via-transparent to-navy-950/20" />
        </div>

        {/* Left-anchored overlay to keep headline text readable, fading out
            on the right so the image remains visible. */}
        <div className="absolute inset-0 z-10 bg-gradient-to-r from-navy-950 via-navy-950/88 to-navy-950/20" />

        <div className="container-page relative z-20 py-20 lg:py-28">
          <div className="relative z-20 max-w-xl">
            <h1 className="text-4xl sm:text-5xl lg:text-[3.25rem] lg:leading-[1.05] font-semibold tracking-tight text-white drop-shadow-sm">
              Help enforcement teams close complaint responses faster.
            </h1>
            <p className="mt-5 text-lg text-white/90">
              A Closure Review Workbench for Enforcement and By-law complaint responses. AI automates research,
              analysis, and draft preparation for staff approved closure responses.
            </p>
            <p className="mt-3 text-base text-white/80">
              Resident intake is included only to simulate how a parking complaint enters the enforcement workflow
              before staff prepare a closure response.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Link to="/login" className="btn-accent">
                Sign in to the Closure Review Workbench
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
              </Link>
              <Link to="/how-it-works" className="btn-secondary bg-white/5 text-white border-white/20 hover:bg-white/10 hover:border-white/40">
                How It Works
              </Link>
            </div>

            <p className="mt-5 text-sm text-white/75">
              Built with Toronto 311 public benchmark data for the POC. Not Brampton operational data. No private City data required.
            </p>
            <p className="mt-2 text-sm text-white/65">
              Decision support only. Staff approve every closure and resident communication.
            </p>

            {/* Mobile image: a wide blended visual below the CTA, not a card. */}
            <img
              src="/images/brampton-poc-hero.png"
              alt="Municipal enforcement operations"
              className="mt-10 h-56 w-full rounded-2xl object-cover lg:hidden"
            />
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="container-page py-16 lg:py-20">
        <SectionHeading eyebrow="01 — Problem" title="High complaint volume, limited time to research and close files" />
        <p className="mt-4 max-w-3xl text-ink-muted">
          Enforcement and By-law teams receive large volumes of complaints across property standards, parking, noise,
          waste, zoning, licensing, and other bylaw categories. Closing each complaint response well means gathering
          enforcement context, checking complaint trends and patrol or ticket style records, and writing a clear update
          back to the resident — manual, time consuming work that competes with field time. Slow or unclear updates also
          drive avoidable resident follow up calls that add to the workload.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { stat: '8+', label: 'Bylaw categories' },
            { stat: 'Multiple', label: 'Intake channels (311, mobile, web, phone)' },
            { stat: 'Manual', label: 'Repeat-pattern detection across files' },
            { stat: 'Time-bound', label: 'Officer capacity to prepare case packages' },
          ].map((item) => (
            <div key={item.label} className="card p-5">
              <div className="text-2xl font-semibold text-navy-900">{item.stat}</div>
              <div className="mt-1 text-sm text-ink-muted">{item.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Solution */}
      <section className="bg-white border-y border-slate-200">
        <div className="container-page py-16 lg:py-20">
          <SectionHeading
            eyebrow="02 — Solution"
            title="A Closure Review Workbench over existing intake and enforcement workflows"
          />
          <p className="mt-4 max-w-3xl text-ink-muted">
            Complaints enter a review queue where a Needs Attention score helps staff prioritize. A case workspace
            gathers complaint context, area, status, department, and trend signals; deterministic rules flag missing
            information, safety wording, supervisor review, or closure candidates; and an AI Review Packet drafts the
            staff summary, next step, resident update, and closure language when appropriate. Staff must approve before
            any closure or resident communication. The resident form creates a demo service request that enters this
            queue; the staff workbench handles triage, review, context gathering, and closure language.
          </p>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              { title: 'Toronto 311 public benchmark data layer', body: 'Toronto 311 public benchmark data is normalized into a Brampton compatible complaint workflow schema, with synthetic records used only for missing internal workflow fields. Brampton ward boundaries provide real local context where available.' },
              { title: 'Transparent prioritization', body: 'A Needs Attention score plus deterministic rules with explainable drivers — staff always see why a file was flagged.' },
              { title: 'Staff approved closure responses', body: 'Draft staff summaries, next steps, and resident friendly closure messages prepared for staff review and approval.' },
            ].map((c) => (
              <div key={c.title} className="card p-6">
                <div className="h-9 w-9 rounded-md bg-navy-900/5 flex items-center justify-center text-navy-900">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 12 2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>
                </div>
                <h3 className="mt-4 text-base font-semibold text-navy-900">{c.title}</h3>
                <p className="mt-1.5 text-sm text-ink-muted">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What the AI does */}
      <section className="container-page py-16 lg:py-20">
        <SectionHeading eyebrow="03 — What the AI does" title="Six assistive capabilities, all designed for staff approval" />
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {aiCapabilities.map((c, i) => (
            <div key={c.title} className="card p-5 card-hover">
              <div className="text-xs font-semibold text-accent-700">0{i + 1}</div>
              <h3 className="mt-2 text-base font-semibold text-navy-900">{c.title}</h3>
              <p className="mt-1.5 text-sm text-ink-muted">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Human in the loop */}
      <section className="bg-navy-900 text-white">
        <div className="container-page py-16 lg:py-20">
          <div className="grid lg:grid-cols-5 gap-10 items-start">
            <div className="lg:col-span-2">
              <div className="section-eyebrow text-accent-300">04 — Human in the loop</div>
              <h2 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-white">
                The system does not make enforcement decisions
              </h2>
            </div>
            <div className="lg:col-span-3 space-y-4 text-navy-100">
              <p>
                AI automates research, analysis, and draft preparation for staff approved closure responses. It does
                not close cases or contact residents on its own — final decisions remain with authorized municipal
                staff.
              </p>
              <ul className="grid gap-2 sm:grid-cols-2 pt-2">
                {[
                  'No automated notices or penalties',
                  'No closure without staff approval',
                  'No resident communication without staff approval',
                  'Full audit trail of AI-generated content',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <svg className="mt-0.5 text-accent-400 shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="pt-4 flex flex-col sm:flex-row gap-3">
                <Link to="/privacy" className="btn-secondary bg-white/5 text-white border-white/20 hover:bg-white/10 hover:border-white/40">
                  Privacy &amp; Security
                </Link>
                <Link to="/how-it-works" className="btn-accent">How It Works</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
