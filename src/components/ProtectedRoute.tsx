import { Navigate, useLocation } from 'react-router-dom'
import AppLayout from './AppLayout'
import { useAuth } from '../lib/auth'

// Gate for the authenticated `/app` area. Renders the app shell once a session
// exists, redirects to /login otherwise. Live Supabase data is only ever
// reachable from inside this gate.
export default function ProtectedRoute() {
  const { session, ready } = useAuth()
  const location = useLocation()

  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-ink-subtle">Loading…</div>
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <AppLayout />
}
