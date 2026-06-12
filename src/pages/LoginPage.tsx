import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import Logo from '../components/Logo'
import { supabase } from '../lib/supabase'
import { getAuthRedirectUrl } from '../lib/appUrl'
import { isAllowedEmail, RESTRICTED_MESSAGE, useAuth } from '../lib/auth'

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'restricted' }
  | { kind: 'error'; message: string }

export default function LoginPage() {
  const { session, ready } = useAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  // Already authenticated — go straight to the staff home.
  if (ready && session) return <Navigate to="/app" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const value = email.trim().toLowerCase()
    if (!value) return

    // Enforce the allowlist client-side before sending anything. There is no
    // public signup; only authorized project users receive a magic link.
    if (!isAllowedEmail(value)) {
      setStatus({ kind: 'restricted' })
      return
    }

    if (!supabase) {
      setStatus({ kind: 'error', message: 'Sign-in is not available in this environment.' })
      return
    }

    setStatus({ kind: 'sending' })
    const { error } = await supabase.auth.signInWithOtp({
      email: value,
      options: {
        emailRedirectTo: getAuthRedirectUrl(),
        shouldCreateUser: true,
      },
    })
    if (error) {
      setStatus({ kind: 'error', message: 'Could not send the magic link. Please try again.' })
      return
    }
    setStatus({ kind: 'sent' })
  }

  return (
    <div className="min-h-[calc(100vh-8rem)] grid lg:grid-cols-2">
      <div className="hidden lg:flex relative bg-navy-900 text-white items-center justify-center px-8 py-12">
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 30% 30%, white 1px, transparent 1px), radial-gradient(circle at 70% 70%, white 1px, transparent 1px)',
            backgroundSize: '34px 34px, 50px 50px',
          }}
        />
        <div className="relative w-full max-w-md">
          <Logo className="h-9 w-9" />
          <h2 className="mt-6 text-2xl font-semibold text-white">Proactive Enforcement Intelligence</h2>
          <p className="mt-3 text-navy-100">
            Sign in to the Closure Review Workbench — AI assisted research, analysis, and draft closure responses for staff approval, on live data.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-navy-100">
            {['Passwordless magic-link sign in', 'Access limited to authorized project users', 'Live data stays behind login'].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <svg className="mt-0.5 text-accent-400 shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <p className="mt-10 text-xs text-white/70">
            Not a reviewer yet? The public site explains the POC, how it works, and our data and governance approach —
            the Closure Review Workbench and case data stay behind login.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center px-6 py-12 sm:px-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2 mb-6">
            <Logo className="h-7 w-7" />
            <span className="text-sm font-semibold text-navy-900">Proactive Enforcement Intelligence</span>
          </div>
          <h1 className="text-2xl font-semibold text-navy-900">Sign in</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Authorized project users only. We&apos;ll email you a secure magic link — no password required.
          </p>

          {status.kind === 'sent' ? (
            <div className="mt-8 rounded-md bg-accent-50 border border-accent-200 px-4 py-3 text-sm text-accent-800">
              <div className="font-medium">Check your email</div>
              <p className="mt-1">
                We sent a magic link to <span className="font-medium">{email.trim().toLowerCase()}</span>. Open it on this
                device to sign in. You&apos;ll land on the staff workspace home.
              </p>
            </div>
          ) : (
            <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="email" className="text-sm font-medium text-navy-900">Email</label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (status.kind === 'restricted' || status.kind === 'error') setStatus({ kind: 'idle' })
                  }}
                  placeholder="you@example.com"
                  className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                />
              </div>

              {status.kind === 'restricted' && (
                <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                  {RESTRICTED_MESSAGE}
                </div>
              )}
              {status.kind === 'error' && (
                <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {status.message}
                </div>
              )}

              <button type="submit" className="btn-primary w-full" disabled={status.kind === 'sending'}>
                {status.kind === 'sending' ? 'Sending magic link…' : 'Send magic link'}
              </button>

              <p className="text-xs text-ink-subtle">
                Access is restricted to authorized project users. There is no public signup.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
