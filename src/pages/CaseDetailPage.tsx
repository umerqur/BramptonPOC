import { useParams } from 'react-router-dom'
import { findCase } from '../data/mockCases'
import { CaseNotFound, MockCaseDetailView } from '../components/cases/CaseDetailViews'

// Public demo case detail. Resolves against bundled sample cases only — no
// Supabase. Live records are available behind login at /app/cases/:id.
export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const mock = id ? findCase(id) : undefined

  if (mock) return <MockCaseDetailView c={mock} casesPath="/cases" />
  return <CaseNotFound id={id} casesPath="/cases" />
}
