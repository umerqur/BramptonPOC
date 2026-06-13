import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWorkflow } from '../../lib/workflowStore'
import { SAMPLE_COMPLAINTS } from '../../services/demoWorkflowService'
import { AutomationBadge, DemoDataNote, GuardrailFooter } from '../../components/workflow/WorkflowUI'
import type {
  ContactPreference,
  ResidentComplaintInput,
  ServiceChannel,
} from '../../data/demoWorkflowTypes'

// Intake Agent — a mocked resident complaint intake form. Staff (or a reviewer)
// can fill it in or load a realistic municipal by-law sample, then submit. On
// submit, a synthetic case object is created and the AI workflow runs end-to-end
// in the browser; the user is taken to the AI Triage result.

const CHANNELS: ServiceChannel[] = ['311 Web', '311 Phone', 'Mobile App', 'Email', 'Walk-in']
const CONTACT_PREFS: ContactPreference[] = ['Email', 'Phone', 'Text message', 'No follow-up']

function emptyForm(): ResidentComplaintInput {
  return {
    description: '',
    location: '',
    channel: '311 Web',
    hasPhoto: false,
    contactPreference: 'Email',
    submittedAt: new Date().toISOString(),
    residentName: '',
    residentEmail: '',
  }
}

export default function AppIntakeAgentPage() {
  const { submitComplaint } = useWorkflow()
  const navigate = useNavigate()
  const [form, setForm] = useState<ResidentComplaintInput>(emptyForm)

  function set<K extends keyof ResidentComplaintInput>(key: K, value: ResidentComplaintInput[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function loadSample(index: number) {
    const sample = SAMPLE_COMPLAINTS[index]
    setForm({ ...sample.input, submittedAt: new Date().toISOString() })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const id = submitComplaint({ ...form, submittedAt: new Date().toISOString() })
    navigate(`/app/triage?case=${encodeURIComponent(id)}`)
  }

  const canSubmit = form.description.trim().length > 0

  return (
    <div className="container-page py-10">
      <div className="max-w-3xl">
        <div className="section-eyebrow">Step 1 · Complaint intake</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">Intake Agent</h1>
        <p className="mt-2 text-ink-muted">
          A resident files a complaint through 311. Load a realistic sample below or enter your own — on submit, the AI
          workflow system captures the intake and runs classification, context gathering, summarization, and confidence
          scoring automatically.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <AutomationBadge kind="ai" />
        <span className="text-xs text-ink-subtle">Intake processing is automated once a complaint is submitted.</span>
      </div>

      <div className="mt-6">
        <DemoDataNote />
      </div>

      {/* Sample complaints */}
      <div className="mt-6 card p-5">
        <h2 className="text-sm font-semibold text-navy-900">Load a sample complaint</h2>
        <p className="mt-1 text-xs text-ink-subtle">Realistic municipal by-law examples — synthetic data only.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {SAMPLE_COMPLAINTS.map((s, i) => (
            <button key={s.label} type="button" onClick={() => loadSample(i)} className="btn-secondary text-sm py-1.5 px-3">
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Intake form */}
      <form onSubmit={handleSubmit} className="mt-6 card p-6">
        <div className="grid gap-5">
          <Field label="Resident issue description" required>
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={4}
              placeholder="Describe the issue the resident reported…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Location or address">
              <input
                value={form.location}
                onChange={(e) => set('location', e.target.value)}
                placeholder="e.g. 42 Flowertown Ave, Brampton"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
              />
            </Field>
            <Field label="Service channel">
              <select
                value={form.channel}
                onChange={(e) => set('channel', e.target.value as ServiceChannel)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
              >
                {CHANNELS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Resident name (optional)">
              <input
                value={form.residentName}
                onChange={(e) => set('residentName', e.target.value)}
                placeholder="e.g. Priya Sharma"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
              />
            </Field>
            <Field label="Contact preference">
              <select
                value={form.contactPreference}
                onChange={(e) => set('contactPreference', e.target.value as ContactPreference)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
              >
                {CONTACT_PREFS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Photo attachment (placeholder)">
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-ink-muted">
                <input type="checkbox" checked={form.hasPhoto} onChange={(e) => set('hasPhoto', e.target.checked)} className="h-4 w-4" />
                <span>{form.hasPhoto ? 'Photo attached (demo placeholder)' : 'Attach an optional photo'}</span>
              </label>
            </Field>
            <Field label="Submitted date">
              <input
                value={new Date(form.submittedAt).toLocaleString()}
                readOnly
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-ink-subtle"
              />
            </Field>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
          <button type="submit" disabled={!canSubmit} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
            Submit complaint → run AI workflow
          </button>
          <button type="button" onClick={() => setForm(emptyForm())} className="btn-secondary text-sm">
            Clear
          </button>
          {!canSubmit && <span className="text-xs text-ink-subtle">A description is required to run the workflow.</span>}
        </div>
      </form>

      <GuardrailFooter />
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
        {required && <span className="ml-1 text-rose-500">*</span>}
      </span>
      {children}
    </label>
  )
}
