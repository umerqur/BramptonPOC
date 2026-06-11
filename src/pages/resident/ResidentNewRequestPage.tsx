import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { isSupabaseConfigured } from '../../lib/supabase'
import {
  REQUEST_TYPES,
  RESIDENT_DEMO_NOTICE,
  submitResidentRequest,
  type ResidentRequestInput,
} from '../../services/residentRequests'

type FormState = {
  name: string
  email: string
  phone: string
  requestType: string
  location: string
  description: string
}

const EMPTY: FormState = {
  name: '',
  email: '',
  phone: '',
  requestType: '',
  location: '',
  description: '',
}

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; caseId: string; emailSent: boolean }
  | { kind: 'error'; message: string }

export default function ResidentNewRequestPage() {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  function update<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
    if (status.kind === 'error') setStatus({ kind: 'idle' })
  }

  function validate(): string | null {
    if (!form.name.trim()) return 'Please enter your name.'
    if (!form.email.trim()) return 'Please enter your email so we can send updates.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'Please enter a valid email address.'
    if (!form.requestType) return 'Please choose a request type.'
    if (!form.location.trim()) return 'Please enter the location of the issue.'
    if (!form.description.trim()) return 'Please describe the issue.'
    return null
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const problem = validate()
    if (problem) {
      setStatus({ kind: 'error', message: problem })
      return
    }
    if (!isSupabaseConfigured) {
      setStatus({
        kind: 'error',
        message: 'The demo backend is not configured in this environment, so requests cannot be submitted right now.',
      })
      return
    }

    setStatus({ kind: 'submitting' })
    const input: ResidentRequestInput = {
      name: form.name,
      email: form.email,
      phone: form.phone || undefined,
      requestType: form.requestType,
      location: form.location,
      description: form.description,
    }
    try {
      const result = await submitResidentRequest(input)
      setStatus({ kind: 'success', caseId: result.caseId, emailSent: result.emailSent })
    } catch (err) {
      console.error('Resident request submission failed:', err)
      setStatus({
        kind: 'error',
        message: 'Something went wrong submitting your request. Please try again.',
      })
    }
  }

  if (status.kind === 'success') {
    return (
      <div className="container-page py-12">
        <div className="mx-auto max-w-xl card p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-50 text-accent-700">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h1 className="mt-4 text-2xl font-semibold text-navy-900">Request submitted</h1>
          <p className="mt-2 text-sm text-ink-muted">Save your reference number to check the status later.</p>
          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-ink-subtle">Reference number</div>
            <div className="mt-1 text-xl font-semibold tracking-wide text-navy-900">{status.caseId}</div>
          </div>
          <p className="mt-4 text-sm text-ink-muted">
            {status.emailSent
              ? 'We emailed a confirmation to the address you provided.'
              : 'Your request was recorded. (The confirmation email could not be sent in this environment.)'}
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link to={`/resident/status/${encodeURIComponent(status.caseId)}`} className="btn-primary">
              View request status
            </Link>
            <Link to="/resident" className="btn-secondary">
              Back to start
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const submitting = status.kind === 'submitting'

  return (
    <div className="container-page py-12">
      <div className="mx-auto max-w-2xl">
        <div className="section-eyebrow">New service request</div>
        <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">
          Tell us about the issue
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          Fields marked with <span className="text-rose-600">*</span> are required.
        </p>

        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {RESIDENT_DEMO_NOTICE}
        </div>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Name" required>
              <input
                type="text"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                className={inputClass}
                autoComplete="name"
              />
            </Field>
            <Field label="Email" required>
              <input
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                className={inputClass}
                autoComplete="email"
                placeholder="you@example.com"
              />
            </Field>
            <Field label="Phone" hint="optional">
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
                className={inputClass}
                autoComplete="tel"
              />
            </Field>
            <Field label="Request type" required>
              <select
                value={form.requestType}
                onChange={(e) => update('requestType', e.target.value)}
                className={inputClass}
              >
                <option value="">Select a type…</option>
                {REQUEST_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Location" required hint="address, intersection, or landmark">
            <input
              type="text"
              value={form.location}
              onChange={(e) => update('location', e.target.value)}
              className={inputClass}
              placeholder="e.g. 24 Main St, or Main St & Queen St"
            />
          </Field>

          <Field label="Description" required>
            <textarea
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              className={`${inputClass} min-h-[120px] resize-y`}
              placeholder="Describe the issue so staff can act on it."
            />
          </Field>

          {status.kind === 'error' && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {status.message}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Link to="/resident" className="text-sm text-ink-muted hover:text-navy-900">
              ← Cancel
            </Link>
            <button type="submit" className="btn-primary sm:w-auto" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const inputClass =
  'mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500'

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-navy-900">
        {label}
        {required && <span className="text-rose-600"> *</span>}
        {hint && <span className="ml-1 text-xs font-normal text-ink-subtle">({hint})</span>}
      </span>
      {children}
    </label>
  )
}
