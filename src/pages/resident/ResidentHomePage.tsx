import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { RESIDENT_DEMO_NOTICE } from '../../services/residentRequests'

// Resident portal start page: two clear actions — file a new complaint, or
// check the status of an existing request by case id. No resident login.
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
    <div className="container-page py-12 lg:py-16">
      <div className="max-w-2xl">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-navy-900">Resident services</h1>
        <p className="mt-3 text-ink-muted">
          File a parking complaint and we&apos;ll email you a reference number and status updates as enforcement staff
          work your request.
        </p>
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {/* File a new complaint */}
        <div className="card card-hover flex flex-col p-7">
          <h2 className="text-lg font-semibold text-navy-900">File a new complaint</h2>
          <p className="mt-2 flex-1 text-sm text-ink-muted">
            Report a parking issue in about two minutes. You&apos;ll get a reference number and email updates.
          </p>
          <div className="mt-6">
            <Link to="/resident/new-request" className="btn-primary">
              Start request
            </Link>
          </div>
        </div>

        {/* Check request status */}
        <div className="card flex flex-col p-7">
          <h2 className="text-lg font-semibold text-navy-900">Check request status</h2>
          <p className="mt-2 text-sm text-ink-muted">Have a reference number? Enter it to see the current status.</p>
          <form className="mt-5 flex flex-col gap-3 sm:flex-row" onSubmit={handleLookup}>
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

      <p className="mt-8 text-xs text-ink-subtle">{RESIDENT_DEMO_NOTICE}</p>
    </div>
  )
}
