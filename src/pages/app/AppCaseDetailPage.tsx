import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  getComplaintByCaseIdOrSourceRecordId,
  type MunicipalComplaintRow,
} from '../../services/municipalServiceRequests'
import { CaseNotFound, ComplaintDetailView } from '../../components/cases/CaseDetailViews'

// Authenticated live complaint detail. Looks the complaint up in Supabase
// (municipal_complaints) by its case_id, with a defensive numeric-id fallback so
// links opened from Closure Review (which key by source_record_id = case_id)
// resolve reliably. Live data only — authenticated /app routes never fall back to
// bundled sample cases. A failed query surfaces an explicit Supabase error with
// retry; a null result renders CaseNotFound.
export default function AppCaseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [row, setRow] = useState<MunicipalComplaintRow | null | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Bumped by the Retry button to re-run the lookup.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    if (!id) {
      setRow(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    getComplaintByCaseIdOrSourceRecordId(id)
      .then((data) => {
        if (!active) return
        setRow(data)
        setError(null)
      })
      .catch((err: unknown) => {
        console.error('Failed to load complaint from Supabase:', err)
        if (active) {
          setRow(null)
          setError(errorMessage(err))
        }
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [id, reloadKey])

  const handleRetry = useCallback(() => setReloadKey((k) => k + 1), [])

  if (loading) {
    return <div className="container-page py-16 text-center text-ink-subtle">Loading complaint…</div>
  }
  if (error) {
    return <CaseLoadError id={id} message={error} onRetry={handleRetry} />
  }
  if (row) return <ComplaintDetailView row={row} casesPath="/app/cases" />
  return <CaseNotFound id={id} casesPath="/app/cases" />
}

/** Explicit Supabase error state with a retry button. No mock fallback. */
function CaseLoadError({ id, message, onRetry }: { id?: string; message: string; onRetry: () => void }) {
  return (
    <div className="container-page py-16">
      <div className="mx-auto max-w-xl card p-6">
        <div className="flex items-start gap-3">
          <span aria-hidden className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-navy-900">Could not load this case from Supabase.</h1>
            <p className="mt-1 text-sm text-ink-muted">
              The authenticated case detail uses live Supabase data only and does not fall back to sample cases.
              {id ? ` Requested case ${id}.` : ''} Check the connection and try again.
            </p>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-rose-800">
              {message}
            </pre>
            <button type="button" onClick={onRetry} className="btn-primary mt-3">
              Retry
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function errorMessage(err: unknown): string {
  if (err == null) return 'Unknown error'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>
    const parts = [e.message, e.details, e.hint, e.code].filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    )
    if (parts.length > 0) return parts.join(' — ')
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err)
}
