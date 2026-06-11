import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { RESIDENT_DEMO_NOTICE } from '../../services/residentRequests'

// Resident portal landing page: explains the demo, routes to the submission
// form, and offers a quick "check the status of an existing request" lookup by
// case id.
export default function ResidentHomePage() {
  const navigate = useNavigate()
  const [caseId, setCaseId] = useState('')

  function handleLookup(e: FormEvent) {
    e.preventDefault()
    const id = caseId.trim().toUpperCase()
    if (!id) return
    navigate(`/resident/status/${encodeURIComponent(id)}`)
  }

  return (
    <div className="container-page py-12">
      <div className="max-w-3xl">
        <div className="section-eyebrow">Resident Services · Demo</div>
        <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-navy-900">
          Report a Parking Infraction
        </h1>
        <p className="mt-3 text-ink-muted">
          Submit a non-emergency parking infraction service request. Tell us the location and problem type, provide your
          contact information, and you&apos;ll get a reference number plus email updates as enforcement staff work your
          request.
        </p>

        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {RESIDENT_DEMO_NOTICE}
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/resident/new-request" className="btn-primary">
            Create request
          </Link>
        </div>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        {/* How it works */}
        <div className="card p-6">
          <h2 className="text-sm font-semibold text-navy-900">How it works</h2>
          <ol className="mt-4 space-y-3 text-sm text-ink">
            {[
              'Tell us what the issue is and where it is.',
              'We create a reference and email you a confirmation.',
              'Municipal staff review and work your request.',
              'You get an email each time the status changes.',
            ].map((step, i) => (
              <li key={step} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[11px] font-semibold text-white">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* Check existing request */}
        <div className="card p-6">
          <h2 className="text-sm font-semibold text-navy-900">Check an existing request</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Have a reference number? Enter it to see the current status.
          </p>
          <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={handleLookup}>
            <input
              type="text"
              value={caseId}
              onChange={(e) => setCaseId(e.target.value)}
              placeholder="RSR-20260611-7K4Q"
              className="flex-1 rounded-md border border-slate-300 px-3 py-2.5 text-sm uppercase tracking-wide focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
            />
            <button type="submit" className="btn-secondary whitespace-nowrap" disabled={!caseId.trim()}>
              Check status
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
