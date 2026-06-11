import { Link } from 'react-router-dom'
import Logo from './Logo'

export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white mt-16">
      <div className="container-page py-10 grid gap-8 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-2.5">
            <Logo className="h-6 w-6" />
            <span className="text-sm font-semibold text-navy-900">Proactive Enforcement Intelligence</span>
          </div>
          <p className="mt-3 text-sm text-ink-muted max-w-sm">
            A Closure Review Workbench proof of concept for Enforcement and By-law complaint responses. AI automates
            research, analysis, and draft preparation for staff approved closure responses. Built using Toronto 311
            public benchmark data and synthetic records.
          </p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">Product</h4>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link to="/how-it-works" className="link-quiet">How It Works</Link></li>
            <li><Link to="/login" className="link-quiet">Authorized staff login</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">Governance</h4>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link to="/methodology" className="link-quiet">Methodology</Link></li>
            <li><Link to="/privacy" className="link-quiet">Privacy &amp; Security</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-200">
        <div className="container-page py-4 text-xs text-ink-subtle flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Proactive Enforcement Intelligence — Proof of Concept.</span>
          <span>Decision support for authorized municipal staff. Not an autonomous enforcement system.</span>
        </div>
      </div>
    </footer>
  )
}
