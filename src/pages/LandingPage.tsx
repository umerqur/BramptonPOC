import { Link } from 'react-router-dom'

// Short, two-path landing page for the Proactive Enforcement Response POC.
// A premium image hero with a light, left-weighted navy overlay (the image
// stays visible and the page feels bright and modern, while the left-aligned
// text keeps enough contrast to read), followed by two large persona cards
// (Resident / City staff). Kept deliberately minimal so the demo opens on a
// clear choice rather than a long marketing read.
export default function LandingPage() {
  return (
    <div>
      {/* Hero — existing repo asset behind a navy gradient overlay */}
      <section className="relative isolate overflow-hidden bg-navy-950 text-white">
        <img
          src="/brampton-poc-hero.png"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 -z-10 h-full w-full object-cover"
        />
        <div
          className="absolute inset-0 -z-10 bg-gradient-to-r from-navy-950/80 via-navy-900/45 to-navy-800/15"
          aria-hidden="true"
        />
        <div className="container-page py-24 lg:py-32">
          <div className="max-w-2xl">
            {/* The official Brampton use-case name stays visible as an eyebrow,
                while the hero title reads as a plain-language description. */}
            <p className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-white/70">
              Proactive Enforcement Response
            </p>
            <h1 className="mt-3 text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-white">
              AI Assisted Municipal Enforcement Intake &amp; Closure POC
            </h1>
            <p className="mt-6 max-w-xl text-lg text-white/85">
              A Brampton POC showing how AI assisted intake and staff review can turn resident complaints into structured
              cases, faster triage, and clearer closure responses.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                to="/resident/new-request"
                className="btn bg-white text-navy-900 hover:bg-white/90 focus:ring-offset-navy-900"
              >
                Create demo request
              </Link>
              <Link
                to="/login"
                className="btn border border-white/30 bg-white/5 text-white hover:bg-white/10 focus:ring-offset-navy-900"
              >
                Staff sign in
              </Link>
            </div>
            <Link
              to="/methodology"
              className="mt-6 inline-flex items-center text-sm font-medium text-white/70 hover:text-white"
            >
              View methodology →
            </Link>
          </div>
        </div>
      </section>

      {/* Two-path cards */}
      <section className="container-page py-14 lg:py-20">
        <div className="grid gap-6 md:grid-cols-2">
          {/* Resident */}
          <div className="card card-hover flex flex-col p-7">
            <h2 className="text-xl font-semibold text-navy-900">Resident</h2>
            <p className="mt-2 flex-1 text-ink-muted">
              File a municipal by-law or enforcement complaint and receive status updates by email.
            </p>
            <div className="mt-6">
              <Link to="/resident/new-request" className="btn-primary">
                Start request
              </Link>
            </div>
          </div>

          {/* City staff */}
          <div className="card card-hover flex flex-col p-7">
            <h2 className="text-xl font-semibold text-navy-900">City staff</h2>
            <p className="mt-2 flex-1 text-ink-muted">
              Review submitted requests, use decision support, assign officers, and approve closure responses.
            </p>
            <div className="mt-6">
              <Link to="/login" className="btn-primary">
                Open staff workspace
              </Link>
            </div>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-ink-subtle">
          Demo only. NYC 311 public benchmark data supports analytics. Resident submissions are demo data.
        </p>
      </section>
    </div>
  )
}
