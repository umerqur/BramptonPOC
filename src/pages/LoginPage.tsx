import { useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from '../components/Logo'

export default function LoginPage() {
  const [submitted, setSubmitted] = useState(false)

  return (
    <div className="min-h-[calc(100vh-8rem)] grid lg:grid-cols-2">
      <div className="hidden lg:flex relative bg-navy-900 text-white p-12">
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 30% 30%, white 1px, transparent 1px), radial-gradient(circle at 70% 70%, white 1px, transparent 1px)',
            backgroundSize: '34px 34px, 50px 50px',
          }}
        />
        <div className="relative max-w-md self-center">
          <Logo className="h-9 w-9" />
          <h2 className="mt-6 text-2xl font-semibold">Proactive Enforcement Intelligence</h2>
          <p className="mt-3 text-navy-100">
            Sign in to review AI assisted triage recommendations, case briefings, and operational dashboards.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-navy-100">
            {['Role based access', 'Single sign on ready', 'Full audit trail on all actions'].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <svg className="mt-0.5 text-accent-400 shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <p className="mt-10 text-xs text-navy-300">
            Login screen shown for demonstration purposes only. No credentials are submitted or stored.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2 mb-6">
            <Logo className="h-7 w-7" />
            <span className="text-sm font-semibold text-navy-900">Proactive Enforcement Intelligence</span>
          </div>
          <h1 className="text-2xl font-semibold text-navy-900">Sign in</h1>
          <p className="mt-1 text-sm text-ink-muted">Authorized municipal staff only.</p>

          <form
            className="mt-8 space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              setSubmitted(true)
            }}
          >
            <div>
              <label className="text-sm font-medium text-navy-900">Email</label>
              <input
                type="email"
                placeholder="firstname.lastname@city.example"
                className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-navy-900">Password</label>
              <input
                type="password"
                placeholder="••••••••"
                className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
              />
            </div>
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 text-ink">
                <input type="checkbox" className="rounded border-slate-300 text-navy-900 focus:ring-accent-500" />
                Remember me
              </label>
              <a href="#" className="link-quiet">Forgot password?</a>
            </div>

            <button type="submit" className="btn-primary w-full">Sign in</button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-slate-50 px-2 text-ink-subtle">or</span>
              </div>
            </div>

            <button type="button" className="btn-secondary w-full">Continue with City SSO</button>

            {submitted && (
              <div className="mt-4 rounded-md bg-accent-50 border border-accent-200 px-3 py-2 text-xs text-accent-800">
                Mock login — no credentials were submitted. Continue exploring the demo.
                <div className="mt-1">
                  <Link to="/dashboard" className="font-medium underline">Go to demo dashboard</Link>
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  )
}
