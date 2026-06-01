import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  getRequestBySourceId,
  type MunicipalServiceRequestRow,
} from '../../services/municipalServiceRequests'
import { findCase } from '../../data/mockCases'
import { CaseNotFound, MockCaseDetailView, RequestDetailView } from '../../components/cases/CaseDetailViews'

// Authenticated live case detail. Looks the request up in Supabase
// (municipal_service_requests_ml_enriched) by its source_id. If the query
// fails, it falls back to a bundled mock case with the same id (if any).
export default function AppCaseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [row, setRow] = useState<MunicipalServiceRequestRow | null | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let active = true
    if (!id) {
      setRow(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setErrored(false)
    getRequestBySourceId(id)
      .then((data) => active && setRow(data))
      .catch((err) => {
        console.error('Failed to load service request from Supabase, falling back to mock:', err)
        if (active) {
          setRow(null)
          setErrored(true)
        }
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [id])

  if (loading) {
    return <div className="container-page py-16 text-center text-ink-subtle">Loading service request…</div>
  }
  if (row) return <RequestDetailView row={row} casesPath="/app/cases" />

  // Fallback: when Supabase is unavailable, render a bundled mock case if one
  // matches the requested id.
  if (errored) {
    const mock = id ? findCase(id) : undefined
    if (mock) return <MockCaseDetailView c={mock} casesPath="/app/cases" />
  }
  return <CaseNotFound id={id} casesPath="/app/cases" />
}
