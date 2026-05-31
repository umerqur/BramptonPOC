import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  getRequestBySourceId,
  type MunicipalServiceRequestRow,
} from '../../services/municipalServiceRequests'
import { CaseNotFound, RequestDetailView } from '../../components/cases/CaseDetailViews'

// Authenticated live case detail. Looks the request up in Supabase by its
// source_id.
export default function AppCaseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [row, setRow] = useState<MunicipalServiceRequestRow | null | undefined>(undefined)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    if (!id) {
      setRow(null)
      setLoading(false)
      return
    }
    setLoading(true)
    getRequestBySourceId(id)
      .then((data) => active && setRow(data))
      .catch((err) => {
        console.error('Failed to load service request from Supabase:', err)
        if (active) setRow(null)
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
  return <CaseNotFound id={id} casesPath="/app/cases" />
}
