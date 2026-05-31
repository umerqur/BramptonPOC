import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import Logo from './Logo'

export default function Header() {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="container-page flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <Logo className="h-7 w-7" />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-navy-900">Proactive Enforcement Intelligence</div>
            <div className="text-[11px] text-ink-subtle">Municipal AI Proof of Concept</div>
          </div>
        </Link>

        <nav className="hidden lg:flex items-center gap-2">
          <NavLink
            to="/methodology"
            className={({ isActive }) =>
              `px-3 py-2 rounded-md text-sm font-medium transition ${
                isActive
                  ? 'text-navy-900 bg-slate-100'
                  : 'text-ink-muted hover:text-navy-900 hover:bg-slate-50'
              }`
            }
          >
            Methodology
          </NavLink>
          <Link to="/dashboard" className="btn-primary text-sm py-2 px-4">
            Demo Dashboard
          </Link>
        </nav>

        <button
          className="lg:hidden inline-flex items-center justify-center p-2 rounded-md text-ink-muted hover:text-navy-900 hover:bg-slate-100"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {open ? <path d="M18 6 6 18M6 6l12 12" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
          </svg>
        </button>
      </div>

      {open && (
        <div className="lg:hidden border-t border-slate-200 bg-white">
          <div className="container-page py-3 flex flex-col gap-1">
            <NavLink
              to="/methodology"
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `px-3 py-2 rounded-md text-sm font-medium ${
                  isActive ? 'text-navy-900 bg-slate-100' : 'text-ink-muted'
                }`
              }
            >
              Methodology
            </NavLink>
            <Link to="/dashboard" onClick={() => setOpen(false)} className="btn-primary mt-2">
              View Demo Dashboard
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}
