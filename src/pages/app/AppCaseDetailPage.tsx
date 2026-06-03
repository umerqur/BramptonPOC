import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  getComplaintByCaseId,
  type MunicipalComplaintRow,
} from '../../services/municipalServiceRequests'
import { findCase } from '../../data/mockCases'
import { CaseNotFound, ComplaintDetailView, MockCaseDetailView } from '../../components/cases/CaseDetailViews'

// Authenticated live complaint detail. Looks the complaint up in Supabase
// (municipal_complaints) by its case_id. If the query fails, it falls back to a
// bundled mock case with the same id (if any).
export default function AppCaseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [row, setRow] = useState<MunicipalComplaintRow | null | undefined>(undefined)
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
    getComplaintByCaseId(id)
      .then((data) => active && setRow(data))
      .catch((err) => {
        console.error('Failed to load complaint from Supabase, falling back to mock:', err)
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
    return <div className="container-page py-16 text-center text-ink-subtle">Loading complaint…</div>
  }
  if (row) return <ComplaintDetailView row={row} casesPath="/app/cases" />

  // Fallback: when Supabase is unavailable, render a bundled mock case if one
  // matches the requested id.
  if (errored) {
    const mock = id ? findCase(id) : undefined
    if (mock) return <MockCaseDetailView c={mock} casesPath="/app/cases" />
  }
  return <CaseNotFound id={id} casesPath="/app/cases" />
}
