import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { isSupabaseConfigured } from '../../lib/supabase'
import {
  RESIDENT_STAGES,
  STATUS_LABELS,
  getResidentRequestStatus,
  stageIndexForStatus,
  type ResidentRequestStatus,
} from '../../services/residentRequests'

type State =
  | { kind: 'loading' }
  | { kind: 'notfound' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; request: ResidentRequestStatus }

export default function ResidentStatusPage() {
  const { caseId = '' } = useParams()
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let active = true
    setState({ kind: 'loading' })

    if (!isSupabaseConfigured) {
      setState({
        kind: 'error',
        message: 'The demo backend is not configured in this environment, so request status is unavailable.',
      })
      return
    }

    getResidentRequestStatus(caseId)
      .then((request) => {
        if (!active) return
        setState(request ? { kind: 'ready', request } : { kind: 'notfound' })
      })
      .catch((err: unknown) => {
        console.error('Resident status lookup failed:', err)
        if (active) setState({ kind: 'error', message: 'Could not load this request. Please try again.' })
      })

    return () => {
      active = false
    }
  }, [caseId])

  return (
    <div className="container-page py-12">
      <div className="mx-auto max-w-2xl">
        <Link to="/resident" className="text-sm text-ink-muted hover:text-navy-900">
          ← Resident Services
        </Link>

        <div className="mt-3 flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Request status</h1>
          <span className="text-sm font-medium tracking-wide text-ink-muted">{caseId}</span>
        </div>

        {state.kind === 'loading' && (
          <div className="mt-8 card p-8 text-center text-sm text-ink-subtle">Loading request status…</div>
        )}

        {state.kind === 'notfound' && (
          <div className="mt-8 card p-8 text-center">
            <h2 className="text-lg font-semibold text-navy-900">We couldn&apos;t find that request</h2>
            <p className="mt-2 text-sm text-ink-muted">
              Double-check the reference number. It looks like <span className="font-medium">RSR-20260611-7K4Q</span>.
            </p>
            <Link to="/resident" className="mt-6 inline-block btn-secondary">
              Back to start
            </Link>
          </div>
        )}

        {state.kind === 'error' && (
          <div className="mt-8 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {state.message}
          </div>
        )}

        {state.kind === 'ready' && <StatusBody request={state.request} />}
      </div>
    </div>
  )
}

function StatusBody({ request }: { request: ResidentRequestStatus }) {
  const activeIndex = stageIndexForStatus(request.status)

  return (
    <div className="mt-8 space-y-8">
      {/* Current status banner */}
      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-subtle">Current status</div>
            <div className="mt-1 text-xl font-semibold text-navy-900">{STATUS_LABELS[request.status]}</div>
          </div>
          <span className="badge bg-slate-100 text-slate-600">Demo</span>
        </div>

        {/* 5 stage tracker: Submitted → Received → Assigned → Under review → Closed */}
        <ol className="mt-6 flex items-center">
          {RESIDENT_STAGES.map((stage, i) => {
            const done = i < activeIndex
            const current = i === activeIndex
            const isLast = i === RESIDENT_STAGES.length - 1
            return (
              <li key={stage.key} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center text-center">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                      done
                        ? 'bg-accent-600 text-white'
                        : current
                          ? 'bg-navy-900 text-white ring-4 ring-navy-100'
                          : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {done ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span
                    className={`mt-2 w-20 text-[11px] leading-tight ${
                      current ? 'font-semibold text-navy-900' : 'text-ink-subtle'
                    }`}
                  >
                    {stage.label}
                  </span>
                </div>
                {!isLast && (
                  <div className={`mx-1 h-0.5 flex-1 ${i < activeIndex ? 'bg-accent-600' : 'bg-slate-200'}`} />
                )}
              </li>
            )
          })}
        </ol>
      </div>

      {/* Request details */}
      <div className="card p-6">
        <h2 className="text-sm font-semibold text-navy-900">Request details</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 text-sm">
          <Detail label="Reference" value={request.case_id} />
          <Detail label="Submitted by" value={request.resident_name} />
          <Detail label="Problem type" value={request.request_type} />
          <Detail label="Location" value={request.location} />
          <Detail label="City" value={request.city || '—'} />
          <Detail label="Submitted" value={formatDateTime(request.created_at)} />
          <Detail label="Last updated" value={formatDateTime(request.updated_at)} />
        </dl>
      </div>

      <p className="text-xs text-ink-subtle">
        You&apos;ll receive an email at the address on file whenever the status changes. This is a proof-of-concept demo.
      </p>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 break-words text-ink">{value}</dd>
    </div>
  )
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}
