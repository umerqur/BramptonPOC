import { Link } from 'react-router-dom'
import SectionHeading from '../components/SectionHeading'

const aiCapabilities = [
  { title: 'Summarizes complaint history', body: 'Generates a clear, time-ordered summary of complaints associated with an address or case.' },
  { title: 'Detects repeat complaint patterns', body: 'Identifies addresses, areas, and categories with recurring or escalating activity.' },
  { title: 'Ranks cases by priority', body: 'Combines rules and signals to produce a transparent risk score and recommended priority.' },
  { title: 'Explains risk drivers', body: 'Every score includes the specific factors that contributed to it — no black box.' },
  { title: 'Recommends next operational action', body: 'Suggests a next step (monitor, notice, inspect, escalate) for staff review.' },
  { title: 'Prepares officer briefing notes', body: 'Produces a short, officer ready briefing combining history, signals, and recommended actions.' },
]

export default function LandingPage() {
  return (
    <div>
      {/* Hero — CTA first, blended image background */}
      <section className="relative overflow-hidden bg-navy-900 text-white">
        {/* Image as a right-side background layer on desktop, blended into the
            navy via a left-to-right gradient. Hidden on mobile (shown below). */}
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[55%] lg:block">
          <img
            src="/images/brampton-poc-hero.png"
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover"
          />
          {/* Left-to-right navy gradient so headline text stays readable. */}
          <div className="absolute inset-0 bg-gradient-to-r from-navy-900 via-navy-900/80 to-navy-900/10" />
        </div>

        <div className="container-page relative py-20 lg:py-28">
          <div className="max-w-xl">
            <h1 className="text-4xl sm:text-5xl lg:text-[3.25rem] lg:leading-[1.05] font-semibold tracking-tight">
              Help enforcement teams see what needs attention first.
            </h1>
            <p className="mt-5 text-lg text-navy-100">
              AI assisted triage for repeat complaints, stale files, and high risk service requests.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Link to="/dashboard" className="btn-accent">
                View Demo Dashboard
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
              </Link>
              <Link to="/methodology" className="btn-secondary bg-white/5 text-white border-white/20 hover:bg-white/10 hover:border-white/40">
                See Methodology
              </Link>
            </div>

            <p className="mt-5 text-sm text-navy-200">
              Built with public 311 style data for the POC. No private City data required.
            </p>
            <p className="mt-2 text-sm text-navy-300">
              Decision support only. Human review required.
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
        <SectionHeading eyebrow="01 — Problem" title="High complaint volume, limited time to triage" />
        <p className="mt-4 max-w-3xl text-ink-muted">
          Municipal enforcement teams receive large volumes of complaints across property standards, parking, noise,
          waste, zoning, licensing, and other bylaw categories. Reviewing repeat complaints, identifying hotspots, and
          preparing case packages can be manual and time consuming.
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
            title="An assistive layer over existing intake and enforcement workflows"
          />
          <p className="mt-4 max-w-3xl text-ink-muted">
            The system combines real public 311 service request data normalized into an enforcement schema,
            synthetic records for missing internal workflow fields, rules based risk scoring, machine learning ready
            features, and AI generated case summaries to support faster triage and better operational visibility.
          </p>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              { title: 'Real public 311 data layer', body: 'NYC 311 service request data is normalized into a Brampton compatible enforcement schema, with synthetic records used only for missing internal workflow fields.' },
              { title: 'Transparent scoring', body: 'A rules based risk score with explainable drivers and ML ready feature design.' },
              { title: 'Officer ready outputs', body: 'Case summaries, recommended actions, and briefing notes designed for staff review.' },
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
        <SectionHeading eyebrow="03 — What the AI does" title="Six assistive capabilities, all designed for staff review" />
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
                It supports City staff by preparing information, explaining patterns, and helping prioritize review.
                Final decisions remain with authorized municipal staff.
              </p>
              <ul className="grid gap-2 sm:grid-cols-2 pt-2">
                {[
                  'No automated notices',
                  'No automated penalties',
                  'All recommendations are advisory',
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
