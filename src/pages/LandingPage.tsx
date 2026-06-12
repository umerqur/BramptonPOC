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
          src="/images/brampton-poc-hero.png"
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
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-white">
              Proactive Enforcement Response
            </h1>
            <p className="mt-6 max-w-xl text-lg text-white/85">
              A proof of concept showing how a resident complaint moves from intake to staff review and closure update.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                to="/resident/new-request"
                className="btn bg-white text-navy-900 hover:bg-white/90 focus:ring-offset-navy-900"
              >
                File a complaint
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
              File a parking complaint and receive status updates by email.
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
              Review submitted requests and prepare staff approved closure responses.
            </p>
            <div className="mt-6">
              <Link to="/login" className="btn-primary">
                Open staff workspace
              </Link>
            </div>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-ink-subtle">
          Demo only. Toronto 311 public benchmark data supports analytics. Resident submissions are demo data.
        </p>
      </section>
    </div>
  )
}
