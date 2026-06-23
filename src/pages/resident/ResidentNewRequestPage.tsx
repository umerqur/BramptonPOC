import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { isSupabaseConfigured } from '../../lib/supabase'
import {
  ADDRESS_TYPES,
  METHOD_OF_CONTACT_OPTIONS,
  ENFORCEMENT_COMPLAINT_TYPES,
  RESIDENT_DEMO_NOTICE,
  ACCEPTED_ATTACHMENT_HINT,
  ACCEPTED_ATTACHMENT_INPUT,
  MAX_ATTACHMENT_BYTES,
  isAcceptedAttachmentType,
  submitResidentRequest,
  type ResidentRequestInput,
} from '../../services/residentRequests'

// Resident service-request intake — a single, fast, one-page form.
//
// It is intentionally simple: one page, no map, no multi-step wizard. The issue
// types map to the categories the staff workflow understands (which are in turn
// mapped from the NYC 311 open benchmark complaint types), so a submission flows
// straight into the same triage → assignment → field outcome → closure pipeline.
// Demo reconstruction only — do not enter real personal information.

type FormState = {
  // Issue
  requestType: string
  happeningNow: string
  description: string
  files: File[]

  // Location of concern
  addressType: string
  location: string
  concernUnitNumber: string
  city: string
  province: string
  concernPostalCode: string

  // Contact
  firstName: string
  lastName: string
  phone: string
  email: string
  methodOfContact: string
  resolutionFollowup: boolean
}

const INITIAL: FormState = {
  requestType: '',
  happeningNow: '',
  description: '',
  files: [],
  addressType: '',
  location: '',
  concernUnitNumber: '',
  city: 'Brampton',
  province: 'Ontario',
  concernPostalCode: '',
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  methodOfContact: '',
  resolutionFollowup: true,
}

// Short helper text per issue type so residents can self-select the right
// category quickly (each maps to a by-law category the staff workflow handles).
const ISSUE_HINTS: Record<string, string> = {
  'Parking issue': 'Illegal/abandoned vehicle, blocked driveway, fire route',
  'Property standards': 'Unsafe, unsanitary, or poorly maintained property',
  'Noise complaint': 'Loud or persistent noise, amplified sound, machinery',
  'Illegal dumping': 'Dumped waste, debris, or litter on public/private land',
  'Yard maintenance': 'Long grass, weeds, overgrowth, standing water',
  'Zoning concern': 'Illegal unit/conversion or non-conforming use',
  'Other bylaw concern': 'Anything else for by-law enforcement to review',
}

// Deterministic, rules-based demo scenarios for the "Create a realistic demo
// complaint" autofill button. No AI, no external service — just a small set of
// plausible, self-contained cases. Note: email is intentionally NOT included so
// the resident's own (or blank) email is preserved, and files are never set.
const DEMO_COMPLAINTS: Array<Partial<FormState>> = [
  {
    requestType: 'Property standards',
    happeningNow: 'No',
    description:
      'There is a property on the street with overflowing garbage, damaged fencing, and debris that has been left outside for several weeks. The condition appears to be attracting pests and affecting nearby homes.',
    addressType: 'Street Address',
    location: '24 Main St N',
    concernUnitNumber: '',
    city: 'Brampton',
    province: 'Ontario',
    concernPostalCode: 'L6V 1N6',
    firstName: 'Demo',
    lastName: 'Resident',
    phone: '',
    methodOfContact: 'Email',
    resolutionFollowup: true,
  },
  {
    requestType: 'Illegal dumping',
    happeningNow: 'Not sure',
    description:
      'Several bags of garbage and loose construction debris have been dumped near the rear lane. The material has been there for multiple days and may need by-law review.',
    addressType: 'Intersection',
    location: 'Queen St E & Kennedy Rd N',
    concernUnitNumber: '',
    city: 'Brampton',
    province: 'Ontario',
    concernPostalCode: '',
    firstName: 'Demo',
    lastName: 'Resident',
    phone: '',
    methodOfContact: 'Email',
    resolutionFollowup: true,
  },
  {
    requestType: 'Noise complaint',
    happeningNow: 'Yes',
    description:
      'There has been repeated loud noise from the same property late at night. The noise has occurred on multiple evenings and is disrupting nearby residents.',
    addressType: 'Street Address',
    location: '100 Queen St W',
    concernUnitNumber: '',
    city: 'Brampton',
    province: 'Ontario',
    concernPostalCode: 'L6X 1A4',
    firstName: 'Demo',
    lastName: 'Resident',
    phone: '',
    methodOfContact: 'Email',
    resolutionFollowup: true,
  },
]

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; caseId: string; emailSent: boolean; attachmentsUploaded: number; attachmentError: boolean }
  | { kind: 'error'; message: string }

export default function ResidentNewRequestPage() {
  const [form, setForm] = useState<FormState>(INITIAL)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [formError, setFormError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    if (formError) setFormError(null)
    if (status.kind === 'error') setStatus({ kind: 'idle' })
  }

  // Rules-based demo autofill — fills a deterministic, plausible complaint while
  // preserving the resident's own email (never auto-filled) and never attaching
  // files. No AI or external service is involved.
  function fillDemoComplaint() {
    const scenario = DEMO_COMPLAINTS[Math.floor(Math.random() * DEMO_COMPLAINTS.length)]
    setForm((current) => ({
      ...current,
      ...scenario,
      email: current.email,
      files: [],
    }))
    setFormError(null)
    setFileError(null)
    if (status.kind === 'error') setStatus({ kind: 'idle' })
  }

  // Validate and store selected attachments (images / PDFs, ≤ 10 MB each).
  function handleSelectFiles(fileList: FileList | null) {
    const incoming = Array.from(fileList ?? [])
    const accepted: File[] = []
    const rejected: string[] = []
    for (const f of incoming) {
      if (!isAcceptedAttachmentType(f)) rejected.push(`${f.name} — unsupported type`)
      else if (f.size > MAX_ATTACHMENT_BYTES) rejected.push(`${f.name} — over 10 MB`)
      else accepted.push(f)
    }
    setForm((prev) => ({ ...prev, files: accepted }))
    setFileError(
      rejected.length > 0
        ? `These files were not added: ${rejected.join('; ')}. Accepted: ${ACCEPTED_ATTACHMENT_HINT}.`
        : null,
    )
    if (status.kind === 'error') setStatus({ kind: 'idle' })
  }

  function removeFile(index: number) {
    setForm((prev) => ({ ...prev, files: prev.files.filter((_, i) => i !== index) }))
  }

  // Single-pass validation for the whole one-page form.
  function validate(): string | null {
    if (!form.requestType) return 'Please choose an issue type.'
    if (!form.happeningNow) return 'Please tell us whether this is happening now.'
    if (!form.description.trim()) return 'Please describe the issue so staff can review the request.'
    if (form.description.trim().length < 10) return 'Please provide a little more detail about the issue.'
    if (!form.addressType) return 'Please choose a type of address.'
    if (!form.location.trim()) return 'Please provide the address or nearest intersection.'
    if (!form.city.trim()) return 'Please provide a city.'
    if (!form.province.trim()) return 'Please provide a province.'
    if (!form.firstName.trim()) return 'Please enter your first name.'
    if (!form.lastName.trim()) return 'Please enter your last name.'
    if (!form.email.trim()) return 'Please enter a contact email address.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'Please enter a valid email address.'
    if (!form.methodOfContact) return 'Please choose a method of contact.'
    return null
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const problem = validate()
    if (problem) {
      setFormError(problem)
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
      addressType: form.addressType,
      location: form.location,
      concernUnitNumber: form.concernUnitNumber || undefined,
      city: form.city,
      province: form.province,
      concernPostalCode: form.concernPostalCode || undefined,
      requestType: form.requestType,
      description: form.description.trim(),
      happeningNow: form.happeningNow || undefined,
      files: form.files,
      firstName: form.firstName,
      lastName: form.lastName,
      contactPostalCode: '',
      country: 'Canada',
      phone: form.phone,
      email: form.email,
      resolutionFollowup: form.resolutionFollowup,
      methodOfContact: form.methodOfContact,
    }
    try {
      const result = await submitResidentRequest(input)
      setStatus({
        kind: 'success',
        caseId: result.caseId,
        emailSent: result.emailSent,
        attachmentsUploaded: result.attachmentsUploaded,
        attachmentError: result.attachmentError,
      })
    } catch (err) {
      console.error('Resident request submission failed:', err)
      setStatus({
        kind: 'error',
        message:
          'We could not submit the request. Please try again, or open the form in a signed out browser window.',
      })
    }
  }

  // ---- Success screen -----------------------------------------------------
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
          <p className="mt-2 text-sm text-ink-muted">
            Your service request has been submitted. Save your reference number to track it.
          </p>
          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-ink-subtle">Reference number</div>
            <div className="mt-1 text-xl font-semibold tracking-wide text-navy-900">{status.caseId}</div>
          </div>
          {status.emailSent ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900">
              <div className="font-semibold">Email sent</div>
              <p className="mt-0.5">
                We sent a confirmation email. If you do not see it, please check your junk or spam folder.
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-ink-muted">
              Your request was recorded. (The confirmation email could not be sent in this environment.)
            </p>
          )}
          {status.attachmentError ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900">
              <div className="font-semibold">Some files were not uploaded</div>
              <p className="mt-0.5">
                Your request was saved
                {status.attachmentsUploaded > 0
                  ? ` with ${status.attachmentsUploaded} file${status.attachmentsUploaded === 1 ? '' : 's'}, but at least one attachment could not be uploaded.`
                  : ', but your attachments could not be uploaded.'}{' '}
                You can mention the photo when staff contact you.
              </p>
            </div>
          ) : status.attachmentsUploaded > 0 ? (
            <p className="mt-4 text-sm text-ink-muted">
              {status.attachmentsUploaded} file{status.attachmentsUploaded === 1 ? '' : 's'} uploaded and attached to your
              request for staff review.
            </p>
          ) : null}
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

  // ---- One-page form ------------------------------------------------------
  return (
    <div className="container-page py-12">
      <div className="mx-auto max-w-2xl">
        <header>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">File a complaint</h1>
          <p className="mt-2 text-sm sm:text-base text-ink-muted">
            One short form — tell us what happened, where it is, and how to reach you. It takes about a minute.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 font-medium text-ink-muted">
              Demo form
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 font-medium text-ink-muted">
              Do not enter real personal information
            </span>
          </div>
        </header>

        <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-navy-900">Need a quick demo case?</div>
              <p className="mt-0.5 text-xs text-ink-subtle">
                Rules based autofill creates a realistic complaint. Enter your own email before submitting.
              </p>
            </div>
            <button
              type="button"
              onClick={fillDemoComplaint}
              className="inline-flex items-center justify-center rounded-md bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-black focus:outline-none focus:ring-2 focus:ring-navy-900 focus:ring-offset-2"
            >
              Create a realistic demo complaint
            </button>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Not for emergencies. If you need urgent help, contact your local police or dial 911.
        </div>

        <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
          {/* Issue */}
          <Section title="What's the issue?" subtitle="Choose the closest type and describe what's happening.">
            <Field label="Issue type" required>
              <select value={form.requestType} onChange={(e) => update('requestType', e.target.value)} className={inputClass}>
                <option value="">Select an issue type…</option>
                {ENFORCEMENT_COMPLAINT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              {form.requestType && ISSUE_HINTS[form.requestType] && (
                <p className="mt-1 text-xs text-ink-subtle">{ISSUE_HINTS[form.requestType]}</p>
              )}
            </Field>

            <Field label="Is this happening now?" required>
              <select value={form.happeningNow} onChange={(e) => update('happeningNow', e.target.value)} className={inputClass}>
                <option value="">Select…</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
                <option value="Not sure">Not sure</option>
              </select>
            </Field>

            <Field label="Describe the issue" required>
              <textarea
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                className={`${inputClass} min-h-[110px] resize-y`}
                placeholder="Describe what is happening so staff can review and respond."
              />
            </Field>

            <div>
              <span className="text-sm font-medium text-navy-900">Photos or documents</span>
              <p className="mt-0.5 text-xs text-ink-subtle">Optional. {ACCEPTED_ATTACHMENT_HINT}</p>
              {form.files.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {form.files.map((file, i) => (
                    <li
                      key={`${file.name}-${i}`}
                      className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-ink"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{file.name}</span>
                        <span className="flex-none text-[11px] text-ink-subtle">
                          {(file.size / (1024 * 1024)).toFixed(1)} MB
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="flex-none text-xs font-medium text-ink-subtle hover:text-rose-600"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {fileError && (
                <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {fileError}
                </p>
              )}
              <div className="mt-3">
                <input
                  id="resident-attachment-files"
                  type="file"
                  multiple
                  accept={ACCEPTED_ATTACHMENT_INPUT}
                  className="sr-only"
                  onChange={(e) => handleSelectFiles(e.target.files)}
                />
                <label htmlFor="resident-attachment-files" className="btn-secondary inline-flex cursor-pointer">
                  {form.files.length > 0 ? 'Choose different files' : 'Upload files'}
                </label>
              </div>
            </div>
          </Section>

          {/* Location */}
          <Section title="Where is it?" subtitle="Give the address or nearest intersection.">
            <Field label="Type of address" required>
              <select value={form.addressType} onChange={(e) => update('addressType', e.target.value)} className={inputClass}>
                <option value="">Select…</option>
                {ADDRESS_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={form.addressType === 'Intersection' ? 'Nearest intersection' : 'Street address'} required>
              <input
                type="text"
                value={form.location}
                onChange={(e) => update('location', e.target.value)}
                className={inputClass}
                placeholder={form.addressType === 'Intersection' ? 'e.g. Main St & Queen St' : 'e.g. 24 Main St N'}
              />
            </Field>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Unit / Apt" hint="optional">
                <input type="text" value={form.concernUnitNumber} onChange={(e) => update('concernUnitNumber', e.target.value)} className={inputClass} />
              </Field>
              <Field label="City" required>
                <input type="text" value={form.city} onChange={(e) => update('city', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Province" required>
                <input type="text" value={form.province} onChange={(e) => update('province', e.target.value)} className={inputClass} />
              </Field>
            </div>
            <Field label="Postal code" hint="optional">
              <input type="text" value={form.concernPostalCode} onChange={(e) => update('concernPostalCode', e.target.value)} className={inputClass} placeholder="A1A 1A1" />
            </Field>
          </Section>

          {/* Contact */}
          <Section title="How can we reach you?" subtitle="We'll only use this to send updates on your request.">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="First name" required>
                <input type="text" value={form.firstName} onChange={(e) => update('firstName', e.target.value)} className={inputClass} autoComplete="given-name" />
              </Field>
              <Field label="Last name" required>
                <input type="text" value={form.lastName} onChange={(e) => update('lastName', e.target.value)} className={inputClass} autoComplete="family-name" />
              </Field>
              <Field label="Email" required>
                <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} className={inputClass} autoComplete="email" placeholder="you@example.com" />
              </Field>
              <Field label="Phone" hint="optional">
                <input type="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} className={inputClass} autoComplete="tel" placeholder="Optional phone number" />
              </Field>
              <Field label="Method of contact" required>
                <select value={form.methodOfContact} onChange={(e) => update('methodOfContact', e.target.value)} className={inputClass}>
                  <option value="">Select…</option>
                  {METHOD_OF_CONTACT_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <label className="mt-1 flex items-center gap-2 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={form.resolutionFollowup}
                onChange={(e) => update('resolutionFollowup', e.target.checked)}
                className="h-4 w-4"
              />
              Send me a follow-up when my request is resolved
            </label>
            <p className="text-[11px] text-ink-subtle">{RESIDENT_DEMO_NOTICE}</p>
          </Section>

          {formError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{formError}</div>
          )}
          {status.kind === 'error' && (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50/70 px-4 py-3 text-sm text-red-700">
              <span>{status.message}</span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <Link to="/resident" className="text-sm text-ink-muted hover:text-navy-900">
              ← Cancel
            </Link>
            <button type="submit" className="btn-primary" disabled={status.kind === 'submitting'}>
              {status.kind === 'submitting' ? 'Submitting…' : 'Submit request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---- Shared section + field helpers ---------------------------------------

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="card p-6">
      <h2 className="text-lg font-semibold text-navy-900">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
      <div className="mt-5 space-y-5">{children}</div>
    </section>
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
  children: ReactNode
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
