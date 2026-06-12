import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { isSupabaseConfigured } from '../../lib/supabase'
import {
  ADDRESS_TYPES,
  METHOD_OF_CONTACT_OPTIONS,
  PARKING_PROBLEM_TYPES,
  RESIDENT_DEMO_NOTICE,
  submitResidentRequest,
  type ResidentRequestInput,
} from '../../services/residentRequests'

// This flow mirrors the City of Brampton 311 "Report a Parking Infraction"
// Service Request Form: a consent gate, then a four-step wizard
// (Location → Details → Contact → Review). It is a demo reconstruction — do not
// enter real personal information.

type FormState = {
  // Location of concern
  addressType: string
  location: string
  concernUnitNumber: string
  city: string
  province: string
  concernPostalCode: string

  // Details
  requestType: string
  description: string
  vehicleThereNow: string
  uploadedFileNames: string[]

  // Contact
  firstName: string
  lastName: string
  contactUnitNumber: string
  contactStreetAddress: string
  contactCity: string
  contactProvince: string
  contactPostalCode: string
  country: string
  phone: string
  email: string
  resolutionFollowup: boolean
  methodOfContact: string
}

const INITIAL: FormState = {
  addressType: '',
  location: '',
  concernUnitNumber: '',
  city: 'Brampton',
  province: 'Ontario',
  concernPostalCode: '',
  requestType: '',
  description: '',
  vehicleThereNow: '',
  uploadedFileNames: [],
  firstName: '',
  lastName: '',
  contactUnitNumber: '',
  contactStreetAddress: '',
  contactCity: 'Brampton',
  contactProvince: 'Ontario',
  contactPostalCode: '',
  country: 'Canada',
  phone: '',
  email: '',
  resolutionFollowup: true,
  methodOfContact: '',
}

const STEPS = ['Location', 'Details', 'Contact', 'Review'] as const

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; caseId: string; emailSent: boolean }
  | { kind: 'error'; message: string }

export default function ResidentNewRequestPage() {
  const [agreed, setAgreed] = useState(false)
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<FormState>(INITIAL)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [stepError, setStepError] = useState<string | null>(null)

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    if (stepError) setStepError(null)
    if (status.kind === 'error') setStatus({ kind: 'idle' })
  }

  function validateStep(index: number): string | null {
    if (index === 0) {
      if (!form.addressType) return 'Please choose a type of address.'
      if (!form.location.trim()) return 'Please provide the address or nearest intersection.'
      if (!form.city.trim()) return 'Please provide a city.'
      if (!form.province.trim()) return 'Please provide a province.'
    }
    if (index === 1) {
      if (!form.requestType) return 'Please choose a problem type.'
      if (!form.vehicleThereNow) return 'Please tell us whether the vehicle is there now.'
    }
    if (index === 2) {
      if (!form.firstName.trim()) return 'Please enter your first name.'
      if (!form.lastName.trim()) return 'Please enter your last name.'
      if (!form.contactStreetAddress.trim()) return 'Please enter your street address.'
      if (!form.contactPostalCode.trim()) return 'Please enter your postal code.'
      if (!form.phone.trim()) return 'Please enter a contact phone number.'
      if (!form.email.trim()) return 'Please enter a contact email address.'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'Please enter a valid email address.'
      if (!form.methodOfContact) return 'Please choose a method of contact.'
    }
    return null
  }

  function goNext() {
    const problem = validateStep(step)
    if (problem) {
      setStepError(problem)
      return
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  function goBack() {
    setStepError(null)
    setStep((s) => Math.max(s - 1, 0))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    // Re-validate every input-bearing step before final submit.
    for (let i = 0; i <= 2; i++) {
      const problem = validateStep(i)
      if (problem) {
        setStep(i)
        setStepError(problem)
        return
      }
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
      description: form.description || undefined,
      vehicleThereNow: form.vehicleThereNow || undefined,
      uploadedFileNames: form.uploadedFileNames,
      firstName: form.firstName,
      lastName: form.lastName,
      contactUnitNumber: form.contactUnitNumber || undefined,
      contactStreetAddress: form.contactStreetAddress || undefined,
      contactCity: form.contactCity || undefined,
      contactProvince: form.contactProvince || undefined,
      contactPostalCode: form.contactPostalCode,
      country: form.country,
      phone: form.phone,
      email: form.email,
      resolutionFollowup: form.resolutionFollowup,
      methodOfContact: form.methodOfContact,
    }
    try {
      const result = await submitResidentRequest(input)
      setStatus({ kind: 'success', caseId: result.caseId, emailSent: result.emailSent })
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
            Your parking infraction request has been submitted. Save your reference number to track it.
          </p>
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

  // ---- Consent gate -------------------------------------------------------
  if (!agreed) {
    return (
      <div className="container-page py-12">
        <div className="mx-auto max-w-2xl">
          <div className="section-eyebrow">Service Request Form</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">
            Report a Parking Infraction
          </h1>

          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {RESIDENT_DEMO_NOTICE}
          </div>

          <div className="mt-6 card p-6 text-sm text-ink leading-relaxed space-y-4">
            <p className="font-semibold text-navy-900">
              Please read these terms carefully. They contain important information about the investigative process and
              timelines.
            </p>
            <p>
              The accuracy and completeness of the information provided will assist in the investigative process. Please
              enter your information completely and accurately, as you may be contacted for additional information.
            </p>
            <p>
              Once a concern has been registered, an officer will be assigned to investigate. Each investigation is
              unique in some way and there are varying levels of complexity and time requirements. The investigating
              officer will review the information and determine what action, if any, should be taken.
            </p>
            <p>
              This online portal should not be used to report incidents presenting an immediate threat to life or
              property. If you require emergency assistance, contact Peel Regional Police or dial 911.
            </p>
            <h2 className="text-base font-semibold text-navy-900 pt-2">Collection of Personal Information</h2>
            <p>
              Personal information is collected under the authority of the Municipal Act, 2001, S.O. 2001, c. 25. The
              information will be used or disclosed only to communicate with you in regard to inquiries and processing
              service requests, or for a purpose consistent with the Municipal Freedom of Information and Protection of
              Privacy Act.
            </p>
            <p className="text-xs text-ink-subtle">
              Demo notice: this is a proof-of-concept reconstruction of the City of Brampton 311 form and is not
              operated by the City of Brampton.
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Link to="/resident" className="text-sm text-ink-muted hover:text-navy-900">
              ← Cancel
            </Link>
            <button type="button" className="btn-primary" onClick={() => setAgreed(true)}>
              I Agree, Continue
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ---- Wizard -------------------------------------------------------------
  const isLast = step === STEPS.length - 1

  return (
    <div className="container-page py-12">
      <div className="mx-auto max-w-4xl">
        {/* Clean, modern page header — a simple resident service form, not an
            internal admin dashboard. */}
        <header>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">
            Report a Parking Infraction
          </h1>
          <p className="mt-2 text-sm sm:text-base text-ink-muted">
            Submit a service request and receive updates by email.
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

        <Stepper step={step} />

        <form className="mt-8" onSubmit={handleSubmit}>
          {step === 0 && <LocationStep form={form} update={update} />}
          {step === 1 && <DetailsStep form={form} update={update} />}
          {step === 2 && <ContactStep form={form} update={update} />}
          {step === 3 && <ReviewStep form={form} onEdit={setStep} />}

          {stepError && (
            <div className="mt-5 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {stepError}
            </div>
          )}
          {status.kind === 'error' && (
            <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50/70 px-4 py-3 text-sm text-red-700">
              <svg
                className="mt-0.5 h-4 w-4 flex-none text-red-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{status.message}</span>
            </div>
          )}

          <div className="mt-8 flex items-center justify-between">
            {step === 0 ? (
              <Link to="/resident" className="text-sm text-ink-muted hover:text-navy-900">
                ← Cancel
              </Link>
            ) : (
              <button type="button" onClick={goBack} className="btn-secondary">
                Back
              </button>
            )}

            {isLast ? (
              <button type="submit" className="btn-primary" disabled={status.kind === 'submitting'}>
                {status.kind === 'submitting' ? 'Submitting…' : 'Submit request'}
              </button>
            ) : (
              <button type="button" onClick={goNext} className="btn-primary">
                Next
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}

// ---- Stepper --------------------------------------------------------------
function Stepper({ step }: { step: number }) {
  return (
    <ol className="mt-6 flex items-center">
      {STEPS.map((label, i) => {
        const done = i < step
        const current = i === step
        const isLast = i === STEPS.length - 1
        return (
          <li key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center text-center">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition ${
                  done
                    ? 'bg-accent-600 text-white'
                    : current
                      ? 'bg-accent-600 text-white ring-4 ring-accent-100'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {done ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span className={`mt-1.5 text-[11px] ${current ? 'font-semibold text-navy-900' : 'text-ink-subtle'}`}>
                {label}
              </span>
            </div>
            {!isLast && <div className={`mx-1 h-0.5 flex-1 ${i < step ? 'bg-accent-600' : 'bg-slate-200'}`} />}
          </li>
        )
      })}
    </ol>
  )
}

type StepProps = {
  form: FormState
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void
}

// ---- Step 1: Location -----------------------------------------------------
function LocationStep({ form, update }: StepProps) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-navy-900">Location of Concern</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Please provide the address or nearest intersection of the request you are submitting.
      </p>
      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        {/* Left — address fields */}
        <div className="space-y-5">
          <Field label="Type of Address" required>
            <select
              value={form.addressType}
              onChange={(e) => update('addressType', e.target.value)}
              className={inputClass}
            >
              <option value="">Select…</option>
              {ADDRESS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={form.addressType === 'Intersection' ? 'Nearest Intersection' : 'Street Address'}
            required
            hint="address or nearest intersection"
          >
            <input
              type="text"
              value={form.location}
              onChange={(e) => update('location', e.target.value)}
              className={inputClass}
              placeholder={form.addressType === 'Intersection' ? 'e.g. Main St & Queen St' : 'e.g. 24 Main St N'}
            />
          </Field>
          <Field label="Unit or Apartment Number" hint="optional">
            <input
              type="text"
              value={form.concernUnitNumber}
              onChange={(e) => update('concernUnitNumber', e.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="City" required>
              <input
                type="text"
                value={form.city}
                onChange={(e) => update('city', e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Province" required>
              <input
                type="text"
                value={form.province}
                onChange={(e) => update('province', e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Postal Code" hint="optional">
            <input
              type="text"
              value={form.concernPostalCode}
              onChange={(e) => update('concernPostalCode', e.target.value)}
              className={inputClass}
              placeholder="A1A 1A1"
            />
          </Field>
        </div>

        {/* Right — geolocation message + map preview */}
        <MapPreview location={form.location} />
      </div>
    </section>
  )
}

function MapPreview({ location }: { location: string }) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Geolocation access is not enabled in this demo. Staff can still use the address provided by the resident.
      </div>
      <div className="relative h-72 overflow-hidden rounded-md border border-slate-300 bg-[#f3efc9]">
        <div className="absolute inset-0 opacity-70">
          <div className="absolute left-[-15%] top-1/2 h-5 w-[130%] -rotate-45 bg-white shadow-sm" />
          <div className="absolute left-[15%] top-[20%] h-5 w-[90%] rotate-45 bg-white shadow-sm" />
          <div className="absolute left-[55%] top-0 h-[120%] w-5 rotate-12 bg-white shadow-sm" />
          <div className="absolute left-[8%] top-[70%] h-5 w-[70%] -rotate-45 bg-white shadow-sm" />
        </div>
        <div className="absolute left-4 top-4 flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-slate-500">
          ⊕
        </div>
        <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-orange-900 bg-orange-500 shadow" />
        <div className="absolute left-[42%] top-[38%] max-w-[70%] rounded border border-slate-300 bg-white px-4 py-3 text-sm font-semibold shadow">
          {location.trim() ? location.trim().toUpperCase() : 'LOCATION PREVIEW'}
        </div>
      </div>
    </div>
  )
}

// ---- Step 2: Details ------------------------------------------------------
function DetailsStep({ form, update }: StepProps) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-navy-900">Details</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Please answer the following questions so the city can manage your request.
      </p>
      <div className="mt-6 space-y-5">
        <Field label="Problem Type" required hint="search for parking infraction types here">
          <select value={form.requestType} onChange={(e) => update('requestType', e.target.value)} className={inputClass}>
            <option value="">Select…</option>
            {PARKING_PROBLEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Is the vehicle there now?" required>
          <select
            value={form.vehicleThereNow}
            onChange={(e) => update('vehicleThereNow', e.target.value)}
            className={inputClass}
          >
            <option value="">Select…</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </select>
        </Field>

        <Field label="Additional Information">
          <textarea
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            className={`${inputClass} min-h-[120px] resize-y`}
            placeholder="Describe the issue so staff can act on it."
          />
        </Field>

        <div className="rounded-md border border-amber-200 bg-amber-50">
          <div className="border-b border-amber-100 px-4 py-3 text-lg font-semibold text-navy-900">Uploaded Files List</div>
          <div className="px-4 py-4 text-sm text-amber-900">
            {form.uploadedFileNames.length > 0 ? (
              <ul className="list-disc pl-5">
                {form.uploadedFileNames.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            ) : (
              'There are no notes to display.'
            )}
          </div>
        </div>

        <div>
          <input
            id="resident-demo-files"
            type="file"
            multiple
            className="sr-only"
            onChange={(e) =>
              update(
                'uploadedFileNames',
                Array.from(e.target.files ?? []).map((file) => file.name),
              )
            }
          />
          <label htmlFor="resident-demo-files" className="btn-secondary inline-flex cursor-pointer">
            Upload File
          </label>
          <p className="mt-1.5 text-xs text-ink-subtle">
            Demo only — file names are recorded for staff context; files are not uploaded or stored.
          </p>
        </div>
      </div>
    </section>
  )
}

// ---- Step 3: Contact ------------------------------------------------------
function ContactStep({ form, update }: StepProps) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-navy-900">Contact</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Please provide your contact information so you can receive updates on your service request. Valid contact
        information is required — anonymous service requests will not be accepted.
      </p>
      <div className="mt-6 space-y-5">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="First Name" required>
            <input
              type="text"
              value={form.firstName}
              onChange={(e) => update('firstName', e.target.value)}
              className={inputClass}
              autoComplete="given-name"
            />
          </Field>
          <Field label="Last Name" required>
            <input
              type="text"
              value={form.lastName}
              onChange={(e) => update('lastName', e.target.value)}
              className={inputClass}
              autoComplete="family-name"
            />
          </Field>
          <Field label="Unit Number" hint="optional">
            <input
              type="text"
              value={form.contactUnitNumber}
              onChange={(e) => update('contactUnitNumber', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Street Address" required>
            <input
              type="text"
              value={form.contactStreetAddress}
              onChange={(e) => update('contactStreetAddress', e.target.value)}
              className={inputClass}
              autoComplete="address-line1"
              placeholder="e.g. 24 Main St N"
            />
          </Field>
          <Field label="City">
            <input
              type="text"
              value={form.contactCity}
              onChange={(e) => update('contactCity', e.target.value)}
              className={inputClass}
              autoComplete="address-level2"
            />
          </Field>
          <Field label="Province">
            <input
              type="text"
              value={form.contactProvince}
              onChange={(e) => update('contactProvince', e.target.value)}
              className={inputClass}
              autoComplete="address-level1"
            />
          </Field>
          <Field label="Postal Code" required>
            <input
              type="text"
              value={form.contactPostalCode}
              onChange={(e) => update('contactPostalCode', e.target.value)}
              className={inputClass}
              autoComplete="postal-code"
              placeholder="A1A 1A1"
            />
          </Field>
          <Field label="Country">
            <input
              type="text"
              value={form.country}
              onChange={(e) => update('country', e.target.value)}
              className={inputClass}
              autoComplete="country-name"
            />
          </Field>
          <Field label="Contact Phone Number" required>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => update('phone', e.target.value)}
              className={inputClass}
              autoComplete="tel"
              placeholder="Provide a telephone number"
            />
          </Field>
          <Field label="Contact Email Address" required>
            <input
              type="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              className={inputClass}
              autoComplete="email"
              placeholder="you@example.com"
            />
          </Field>
        </div>

        <div>
          <span className="text-sm font-medium text-navy-900">Resolution Followup Requested</span>
          <p className="mt-0.5 text-xs text-ink-subtle">Resolution follow up has a built in delay for security reasons.</p>
          <div className="mt-2 flex gap-4">
            {[
              { label: 'No', value: false },
              { label: 'Yes', value: true },
            ].map((opt) => (
              <label key={opt.label} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="resolutionFollowup"
                  checked={form.resolutionFollowup === opt.value}
                  onChange={() => update('resolutionFollowup', opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        <Field label="Method Of Contact" required>
          <select
            value={form.methodOfContact}
            onChange={(e) => update('methodOfContact', e.target.value)}
            className={inputClass}
          >
            <option value="">Select…</option>
            {METHOD_OF_CONTACT_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </section>
  )
}

// ---- Step 4: Review -------------------------------------------------------
function ReviewStep({ form, onEdit }: { form: FormState; onEdit: (step: number) => void }) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-navy-900">Review</h2>
      <p className="mt-1 text-sm text-ink-muted">Please review your request before submitting.</p>

      <div className="mt-6 space-y-4">
        <ReviewGroup title="Location" onEdit={() => onEdit(0)}>
          <ReviewItem label="Type of Address" value={form.addressType} />
          <ReviewItem label={form.addressType === 'Intersection' ? 'Nearest Intersection' : 'Street Address'} value={form.location} />
          <ReviewItem label="Unit or Apartment Number" value={form.concernUnitNumber || '—'} />
          <ReviewItem label="City" value={form.city} />
          <ReviewItem label="Province" value={form.province} />
          <ReviewItem label="Postal Code" value={form.concernPostalCode || '—'} />
        </ReviewGroup>

        <ReviewGroup title="Details" onEdit={() => onEdit(1)}>
          <ReviewItem label="Problem Type" value={form.requestType} />
          <ReviewItem label="Is the vehicle there now?" value={form.vehicleThereNow || '—'} />
          <ReviewItem label="Additional Information" value={form.description || '—'} />
          <ReviewItem
            label="Uploaded Files"
            value={form.uploadedFileNames.length > 0 ? form.uploadedFileNames.join(', ') : '—'}
          />
        </ReviewGroup>

        <ReviewGroup title="Contact" onEdit={() => onEdit(2)}>
          <ReviewItem label="Name" value={`${form.firstName} ${form.lastName}`.trim()} />
          <ReviewItem label="Unit Number" value={form.contactUnitNumber || '—'} />
          <ReviewItem label="Street Address" value={form.contactStreetAddress || '—'} />
          <ReviewItem label="City" value={form.contactCity || '—'} />
          <ReviewItem label="Province" value={form.contactProvince || '—'} />
          <ReviewItem label="Postal Code" value={form.contactPostalCode} />
          <ReviewItem label="Country" value={form.country} />
          <ReviewItem label="Phone" value={form.phone} />
          <ReviewItem label="Email" value={form.email} />
          <ReviewItem label="Resolution Followup" value={form.resolutionFollowup ? 'Yes' : 'No'} />
          <ReviewItem label="Method Of Contact" value={form.methodOfContact} />
        </ReviewGroup>
      </div>
    </section>
  )
}

function ReviewGroup({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
        <button type="button" onClick={onEdit} className="text-xs font-medium text-navy-700 hover:text-navy-900">
          Edit
        </button>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">{children}</dl>
    </div>
  )
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 break-words text-ink">{value || '—'}</dd>
    </div>
  )
}

// ---- Shared field helpers -------------------------------------------------
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
