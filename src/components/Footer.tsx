import { Link } from 'react-router-dom'
import Logo from './Logo'

export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white mt-8">
      <div className="container-page py-5 text-xs text-ink-subtle flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <Logo className="h-5 w-5" />
          <span>© {new Date().getFullYear()} Proactive Enforcement Intelligence POC.</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Link to="/methodology" className="link-quiet">Methodology</Link>
          <Link to="/privacy" className="link-quiet">Privacy &amp; Security</Link>
          <Link to="/login" className="link-quiet">Staff sign in</Link>
        </div>
      </div>
    </footer>
  )
}
