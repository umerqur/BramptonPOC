import { Link } from 'react-router-dom'

// Short, two-path landing page for the Proactive Enforcement Response POC.
// One hero + two large persona cards (Resident / City staff). Kept deliberately
// minimal so the demo opens on a clear choice rather than a long marketing read.
export default function LandingPage() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-navy-950 text-white">
        <div className="container-page py-16 lg:py-24 text-center">
          <h1 className="mx-auto max-w-3xl text-4xl sm:text-5xl font-semibold tracking-tight text-white">
            Proactive Enforcement Response
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-white/85">
            A proof of concept showing how a parking complaint moves from resident intake to staff review and resident
            closure update.
          </p>
        </div>
      </section>

      {/* Two-path cards */}
      <section className="container-page py-14 lg:py-20">
        <div className="grid gap-6 md:grid-cols-2">
          {/* Resident */}
          <div className="card flex flex-col p-7">
            <h2 className="text-xl font-semibold text-navy-900">Resident</h2>
            <p className="mt-2 flex-1 text-ink-muted">
              File a parking infraction request or check the status of an existing request.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <Link to="/resident/new-request" className="btn-primary">
                File a complaint
              </Link>
              <Link to="/resident" className="text-sm font-medium text-accent-700 hover:text-accent-800">
                Check request status →
              </Link>
            </div>
          </div>

          {/* City staff */}
          <div className="card flex flex-col p-7">
            <h2 className="text-xl font-semibold text-navy-900">City staff</h2>
            <p className="mt-2 flex-1 text-ink-muted">
              Sign in to review submitted requests, update status, and prepare staff approved closure responses.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <Link to="/login" className="btn-primary">
                Staff sign in
              </Link>
              <Link to="/methodology" className="text-sm font-medium text-accent-700 hover:text-accent-800">
                View methodology →
              </Link>
            </div>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-ink-subtle">
          Demo only. Toronto 311 public benchmark data supports the analytics layer. Resident submissions are demo data
          and are not Brampton operational records.
        </p>
      </section>
    </div>
  )
}
