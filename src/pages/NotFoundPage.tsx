import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="container-page py-24 text-center">
      <div className="text-xs font-semibold uppercase tracking-wider text-accent-700">404</div>
      <h1 className="mt-2 text-3xl font-semibold text-navy-900">Page not found</h1>
      <p className="mt-2 text-ink-muted">The page you’re looking for doesn’t exist.</p>
      <Link to="/" className="mt-6 inline-block btn-primary">Back to overview</Link>
    </div>
  )
}
