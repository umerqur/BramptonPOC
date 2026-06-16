import { useState } from 'react'
import {
  generateCaseAiReview,
  saveCaseAiReview,
  type CaseAiReviewInput,
  type CaseAiReviewResult,
} from '../../services/municipalServiceRequests'

/**
 * "AI assisted staff review" — a controlled Claude assistant layer that works on
 * ONE selected case at a time.
 *
 * It only calls Claude when a staff user clicks "Generate AI review". It never
 * runs on page load, never runs for the queue list, and never batch processes
 * records. The Anthropic API key stays server-side in the Netlify function; this
 * component only posts the selected case fields and renders the structured
 * result. This is decision support only — it does not replace the existing rule
 * based POC triage and does not make any final enforcement decision.
 *
 * `compact` tightens spacing so the full result fits inside the narrow staff
 * command panel (the queue preview), where it must stay visible without the user
 * scrolling to the bottom of a long page.
 */
export default function CaseAiReview({
  input,
  compact = false,
}: {
  input: CaseAiReviewInput
  compact?: boolean
}) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CaseAiReviewResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    try {
      const res = await generateCaseAiReview(input)
      setResult(res.result)
      // Best-effort persistence — staff still see the result even if the save
      // backend is unavailable. Persistence is an internal concern: success or
      // failure is logged for developers only and never surfaced in the UI.
      try {
        await saveCaseAiReview(res)
      } catch (saveErr) {
        console.error('Could not persist AI review:', saveErr)
      }
    } catch (err) {
      console.error('AI review generation failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`card ring-1 ring-inset ring-accent-100 ${compact ? 'p-4' : 'p-6'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-navy-900">AI assisted staff review</h3>
          <p className="mt-0.5 text-[11px] text-ink-subtle">Generated from selected case only.</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Staff review required
        </span>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-ink-subtle">
        Optional. Runs only when you click Generate, and only for this case. It prepares a staff briefing — it does not
        assign, close, or send anything. Staff review and decide every case.
      </p>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={loading}
        className="btn-primary mt-4 w-full disabled:opacity-50"
      >
        {loading ? 'Generating AI review…' : result ? 'Regenerate AI review' : 'Generate AI review'}
      </button>

      {error && (
        <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <span className="font-semibold">Could not generate the AI review.</span> {error}
        </div>
      )}

      {result && (
        <div className={compact ? 'mt-4 space-y-3' : 'mt-5 space-y-4'}>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-accent-50 px-2 py-0.5 text-[11px] font-medium text-accent-800 ring-1 ring-inset ring-accent-200">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
              Generated
            </span>
            <span className="text-[11px] text-ink-subtle">Review and decide — this does not replace human judgement.</span>
          </div>
          <ReviewField label="Staff summary" value={result.staff_summary} />
          <ReviewField label="Recommended next action" value={result.recommended_next_action} />
          <ReviewField label="Missing information" value={result.missing_information} />
          <ReviewField label="Priority rationale" value={result.priority_rationale} />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-subtle">Resident response draft</div>
            <pre
              className={`mt-1 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-sans text-sm leading-relaxed text-ink ${
                compact ? 'max-h-56 overflow-y-auto' : ''
              }`}
            >
              {result.resident_response_draft || '—'}
            </pre>
            <p className="mt-1 text-[11px] text-ink-subtle">Staff must review and edit before sending to a resident.</p>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <span className="font-semibold">Human review note: </span>
            {result.human_review_note ||
              'This is AI assistance for staff. It is not a final decision and does not replace rule based triage or human judgement.'}
          </div>
          <p className="text-[11px] text-ink-subtle">AI assisted draft. Staff review required before use.</p>
        </div>
      )}
    </div>
  )
}

function ReviewField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-subtle">{label}</div>
      <p className="mt-1 text-sm leading-relaxed text-ink">{value || '—'}</p>
    </div>
  )
}
