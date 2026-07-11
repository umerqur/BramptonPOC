import { useEffect, useRef, useState } from 'react'
import type { DemoCategory } from '../../data/demoWorkflowTypes'
import {
  askOfficerCaseAssistant,
  AssistantNotConfiguredError,
  AssistantRateLimitError,
  AssistantServiceError,
  type AssistantBriefing,
  type AssistantHandoff,
  type AssistantResponse,
  type AssistantResult,
  type BenchmarkReference,
  type LocationHistory,
} from '../../services/officerCaseAssistant'

// Officer Case Assistant — a CASE-SCOPED, server-side AI helper for the By-law
// Officer (and supervisor / CSR) viewing one assigned case.
//
// This is NOT a generic chatbot. It calls the server-side
// /.netlify/functions/officer-case-assistant function (Groq preferred,
// Anthropic then Cohere fallback), which answers ONLY from the current case
// context, the workflow timeline, same-address history, and retrieved benchmark
// references. It is decision support only: it never writes to Supabase and
// never decides an enforcement outcome. The free-text box is intentionally
// scoped to this case — broad, unrelated prompts are refused by the server
// guardrail and surfaced here as a refusal.
//
// Field workflow surfaces:
//   * An automatic Officer Field Briefing loads when the case opens — the
//     officer does not need to ask anything first.
//   * Assistant-drafted field text can be INSERTED into the field-outcome form
//     via explicit buttons; nothing is ever saved or submitted automatically.
//   * A structured Supervisor Handoff can be generated before handing the case
//     to closure review. It never approves closure and never recommends an
//     enforcement action.

export type AssistantCaseContext = {
  caseId: string
  category: DemoCategory
  complaintType: string
  location: string
  description: string
  assignedOfficer: string | null
}

// The officer's live, unsaved field outcome draft. The assistant can use this to
// help clean up notes, draft action-taken text, and check closure readiness from
// what the officer is actually typing. Mirrors the field-outcome form fields.
export type OfficerFieldDraft = {
  observedCondition: string
  violationObserved: 'yes' | 'no' | 'unclear'
  enforcementAction: string
  referenceNumber: string
  serviceMethod: string
  actionTaken: string
  officerNotes: string
  followUpRequired: boolean
}

/** The form fields assistant-drafted text can be inserted into. */
export type InsertableDraftField = 'observedCondition' | 'actionTaken' | 'officerNotes'

// Suggested, case-scoped prompts. Each maps to the precise question sent to the
// server so the surface never looks like an open-ended assistant. Framed around
// the field workflow — preparing the site visit, evidence, and handoff.
const PROMPT_CHIPS: { label: string; question: string }[] = [
  { label: 'Prepare site checklist', question: 'Prepare a concise site-visit checklist for this case.' },
  { label: 'Evidence to capture', question: 'What evidence should I capture on site for this case?' },
  {
    label: 'Missing before review',
    question: 'What information is missing before this can move to closure review?',
  },
  {
    label: 'Benchmark context',
    question: 'Show any relevant benchmark context, with case IDs if available.',
  },
]

// Extra prompts shown only when the officer has actually typed draft content, so
// the assistant can work with the real text rather than offering empty actions.
const DRAFT_PROMPT_CHIPS: { label: string; question: string }[] = [
  {
    label: 'Clean up my notes',
    question:
      'Turn the current field notes into a clean internal field outcome summary, and return the cleaned text as insertable field drafts.',
  },
  {
    label: 'Draft action taken',
    question:
      'Draft concise action taken / resolution details from the current field notes, and return the drafted text as an insertable field draft.',
  },
  {
    label: 'Ready for supervisor?',
    question: 'Check whether this field outcome is complete enough for supervisor closure review.',
  },
]

type BriefingState =
  | { status: 'loading' }
  | { status: 'ready'; response: AssistantResponse }
  | { status: 'unconfigured'; message: string }
  // A failed automatic briefing never blocks manual questions: the panel shows
  // a calm one-line note and the Ask input / quick actions stay enabled. The
  // failure DETAIL goes to the single consolidated notice below.
  | { status: 'failed' }

type AskState =
  | { status: 'idle' }
  | { status: 'loading'; kind: 'question' | 'handoff' }
  | { status: 'ready'; kind: 'question' | 'handoff'; response: AssistantResponse }

// The ONE consolidated error/notice surface for the whole panel — a failure is
// never shown twice (e.g. once inside the briefing warning and again below the
// input). Cooldowns are a small temporary message that clears itself; the
// hourly limit and service problems are real (single) error boxes.
type AssistantNotice =
  | { kind: 'cooldown'; retryAfterSeconds: number }
  | { kind: 'hourly_limit'; message: string }
  | { kind: 'service_unavailable' }
  | { kind: 'error'; message: string }

function noticeFromError(err: unknown): AssistantNotice {
  if (err instanceof AssistantRateLimitError) {
    return err.code === 'ASSISTANT_COOLDOWN'
      ? { kind: 'cooldown', retryAfterSeconds: err.retryAfterSeconds }
      : { kind: 'hourly_limit', message: err.message }
  }
  // Upstream provider failures are temporary service problems — never presented
  // as a usage limit.
  if (err instanceof AssistantServiceError) return { kind: 'service_unavailable' }
  return { kind: 'error', message: err instanceof Error ? err.message : String(err) }
}

export default function OfficerCaseAssistant({
  ctx,
  fieldDraft,
  onInsertDraft,
}: {
  ctx: AssistantCaseContext
  fieldDraft?: OfficerFieldDraft
  /** When provided, assistant-drafted text can be inserted into the form via
   *  explicit, reviewable buttons. Never saves or submits anything. */
  onInsertDraft?: (field: InsertableDraftField, text: string) => void
}) {
  const [briefing, setBriefing] = useState<BriefingState>({ status: 'loading' })
  const [askState, setAskState] = useState<AskState>({ status: 'idle' })
  const [notice, setNotice] = useState<AssistantNotice | null>(null)
  const [input, setInput] = useState('')
  const [lastQuestion, setLastQuestion] = useState<string | null>(null)
  // Guard against duplicate automatic briefings (React StrictMode re-runs
  // effects in development; the case can also re-render without changing).
  const briefedCaseRef = useRef<string | null>(null)

  const caseContext = {
    issue_type: ctx.complaintType,
    description: ctx.description,
    location: ctx.location,
    assigned_officer_name: ctx.assignedOfficer,
  }

  // Only offer the draft-aware prompts once there is real text to work with.
  const hasDraftText = !!(
    fieldDraft &&
    (fieldDraft.observedCondition.trim() ||
      fieldDraft.actionTaken.trim() ||
      fieldDraft.officerNotes.trim())
  )
  const chips = hasDraftText ? [...PROMPT_CHIPS, ...DRAFT_PROMPT_CHIPS] : PROMPT_CHIPS

  // Automatic Officer Field Briefing when the case opens — the officer does not
  // need to ask a question first. Reset the ask surface for the new case too.
  useEffect(() => {
    if (briefedCaseRef.current === ctx.caseId) return
    briefedCaseRef.current = ctx.caseId
    setAskState({ status: 'idle' })
    setNotice(null)
    setLastQuestion(null)
    setInput('')
    setBriefing({ status: 'loading' })
    let active = true
    askOfficerCaseAssistant(ctx.caseId, { mode: 'briefing', caseContext, fieldDraft })
      .then((response) => active && setBriefing({ status: 'ready', response }))
      .catch((err: unknown) => {
        if (!active) return
        if (err instanceof AssistantNotConfiguredError) {
          setBriefing({ status: 'unconfigured', message: err.message })
        } else {
          // A temporary failure (cooldown, provider error) must not block the
          // manual Ask flow — mark the briefing failed and surface the detail
          // ONCE through the consolidated notice.
          setBriefing({ status: 'failed' })
          setNotice(noticeFromError(err))
        }
      })
    return () => {
      active = false
    }
    // The briefing fires once per case open; the live draft is intentionally not
    // a dependency (it is included as context if present at open time).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.caseId])

  // A cooldown is temporary by definition: clear the notice (re-enabling the
  // Ask input and quick actions) once retryAfterSeconds has elapsed.
  useEffect(() => {
    if (notice?.kind !== 'cooldown') return
    const timer = setTimeout(() => setNotice(null), notice.retryAfterSeconds * 1000)
    return () => clearTimeout(timer)
  }, [notice])

  // Requests pause while loading or during a short cooldown; the cooldown
  // notice clears itself and re-enables everything after retryAfterSeconds.
  const paused = askState.status === 'loading' || notice?.kind === 'cooldown'

  async function ask(question: string, kind: 'question' | 'handoff' = 'question') {
    if (paused) return
    const q = question.trim()
    if (kind === 'question' && !q) return
    setLastQuestion(kind === 'handoff' ? null : q)
    setNotice(null)
    setAskState({ status: 'loading', kind })
    try {
      const response = await askOfficerCaseAssistant(ctx.caseId, {
        mode: kind === 'handoff' ? 'handoff' : 'question',
        question: kind === 'handoff' ? undefined : q,
        caseContext,
        fieldDraft,
      })
      setAskState({ status: 'ready', kind, response })
    } catch (err) {
      setAskState({ status: 'idle' })
      if (err instanceof AssistantNotConfiguredError) {
        setBriefing({ status: 'unconfigured', message: err.message })
      } else {
        setNotice(noticeFromError(err))
      }
    }
  }

  if (briefing.status === 'unconfigured') {
    return (
      <section className={ASSISTANT_CONTAINER_CLASS}>
        <AssistantHeader />
        <div className="px-5 py-4">
          <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-navy-800">
            Officer Case Assistant is not configured in this environment.
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className={ASSISTANT_CONTAINER_CLASS}>
      <AssistantHeader />

      <div className="px-5 py-4">
        {/* ---- Automatic Officer Field Briefing ---- */}
        {briefing.status === 'loading' && (
          <p className="text-sm text-ink-subtle">The AI is preparing the field briefing for this case…</p>
        )}
        {briefing.status === 'failed' && (
          // Calm, non-error note only — the failure detail is shown ONCE via the
          // consolidated notice below, and asking questions stays available.
          <p className="text-xs text-ink-subtle">
            The automatic field briefing is unavailable right now. You can still ask case-scoped questions below.
          </p>
        )}
        {briefing.status === 'ready' && <BriefingView response={briefing.response} />}

        {/* ---- Case-scoped questions ---- */}
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <button
                key={chip.label}
                type="button"
                disabled={paused}
                onClick={() => ask(chip.question)}
                className="rounded-full border border-teal-200 bg-teal-50/50 px-3 py-1 text-xs font-medium text-teal-800 transition hover:border-teal-400 hover:bg-teal-50 hover:text-teal-900 disabled:opacity-60"
              >
                {chip.label}
              </button>
            ))}
            <button
              type="button"
              disabled={paused}
              onClick={() => ask('', 'handoff')}
              className="rounded-full border border-navy-200 bg-navy-50/60 px-3 py-1 text-xs font-medium text-navy-800 transition hover:border-navy-400 hover:bg-navy-50 disabled:opacity-60"
            >
              Supervisor handoff
            </button>
          </div>

          <form
            className="mt-3"
            onSubmit={(e) => {
              e.preventDefault()
              ask(input)
              setInput('')
            }}
          >
            {/* The one interactive affordance on the panel — framed in teal so it
                clearly invites a question, with a focus ring for keyboard users. */}
            <div className="flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50/40 p-1.5 pl-3 transition focus-within:border-teal-400 focus-within:ring-2 focus-within:ring-teal-100">
              <SparklesIcon className="h-4 w-4 shrink-0 text-teal-600" />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask the AI about this case, risk factors, history, or next steps…"
                className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-navy-900 placeholder:text-ink-subtle focus:outline-none"
              />
              <button
                type="submit"
                disabled={!input.trim() || paused}
                className="btn-primary shrink-0 px-3.5 py-1.5 text-sm disabled:opacity-60"
              >
                Ask AI
              </button>
            </div>
          </form>

          <div className="mt-4">
            {/* THE single consolidated notice — a failure is shown exactly once. */}
            {notice && notice.kind === 'cooldown' && (
              <p role="status" className="text-xs text-ink-subtle">
                Please wait a moment before sending another request… available again in about{' '}
                {notice.retryAfterSeconds}s.
              </p>
            )}
            {notice && notice.kind !== 'cooldown' && (
              <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
                {notice.kind === 'hourly_limit'
                  ? notice.message
                  : notice.kind === 'service_unavailable'
                    ? 'The assistant service is temporarily unavailable. Please try again.'
                    : notice.message}
              </div>
            )}
            {askState.status === 'loading' && (
              <p className="text-sm text-ink-subtle">
                {askState.kind === 'handoff' ? 'Preparing the supervisor handoff…' : 'Reviewing the case file…'}
              </p>
            )}
            {askState.status === 'ready' && askState.kind === 'handoff' && askState.response.result.handoff && (
              <HandoffView handoff={askState.response.result.handoff} />
            )}
            {askState.status === 'ready' &&
              (askState.kind === 'question' || !askState.response.result.handoff) && (
                <AssistantAnswer
                  question={lastQuestion}
                  result={askState.response.result}
                  pocOnly={askState.response.poc_only}
                  benchmarks={askState.response.benchmarks}
                  onInsertDraft={onInsertDraft}
                />
              )}
          </div>
        </div>

        {/* Calm, muted guardrail note — no scary warning styling unless an actual error occurs. */}
        <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-ink-subtle">
          AI decision support only · The officer makes all enforcement decisions · Does not issue tickets, submit
          forms, or close cases.
        </p>
      </div>
    </section>
  )
}

// The assistant panel keeps the app's card language (rounded-xl, shadow-card)
// but wears a teal border so it reads as the one interactive AI surface on the
// page rather than another read-only dashboard card.
const ASSISTANT_CONTAINER_CLASS =
  'overflow-hidden rounded-xl border border-teal-200 bg-white shadow-card'

// Sparkles icon (Lucide-style, inlined — lucide-react is not a dependency).
function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3l1.9 5.2a2 2 0 0 0 1.9 1.3l5.2 1.5-5.2 1.5a2 2 0 0 0-1.9 1.3L12 19l-1.9-5.2a2 2 0 0 0-1.9-1.3L3 11l5.2-1.5a2 2 0 0 0 1.9-1.3z" />
      <path d="M19 3v4" />
      <path d="M21 5h-4" />
      <path d="M5 17v2" />
      <path d="M6 18H4" />
    </svg>
  )
}

// Dark navy header (the app's primary brand colour) so the AI panel is
// unmistakable next to the white dashboard cards, with "AI" front and centre.
function AssistantHeader() {
  return (
    <div className="border-b border-navy-800 bg-navy-900 px-5 py-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-400/20 text-teal-300">
          <SparklesIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-white">Enforcement AI Assistant</h3>
            <span className="rounded-full bg-teal-400/20 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-teal-300">
              AI
            </span>
          </div>
          <p className="mt-0.5 text-xs text-navy-200">AI-powered decision support · Officer review required</p>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Officer Field Briefing
// ---------------------------------------------------------------------------

function BriefingView({ response }: { response: AssistantResponse }) {
  const briefing: AssistantBriefing | null = response.result.briefing
  if (!briefing) return null
  return (
    <div className="space-y-3">
      <div>
        <div className="stat-label">Officer field briefing</div>
        <div className="mt-1.5 rounded-lg bg-slate-100 px-3.5 py-2.5">
          <p className="text-sm leading-relaxed text-ink">{briefing.attending}</p>
        </div>
      </div>

      <AnswerList title="What to verify" items={briefing.verify} />
      <AnswerList title="Evidence to capture" items={briefing.evidence} />
      <AnswerList title="Known information gaps" items={briefing.information_gaps} />

      <LocationHistoryPanel history={response.location_history} />

      <BenchmarkNotes notes={response.result.benchmark_notes} benchmarks={response.benchmarks} title="Similar cases" />

      <div>
        <div className="stat-label">Expected next workflow step</div>
        <p className="mt-1 text-sm text-ink">{briefing.expected_next_step}</p>
      </div>

      {response.poc_only && (
        <p className="text-[11px] text-ink-subtle">
          POC mode: server-side identity verification is not configured in this environment.
        </p>
      )}
      <p className="text-[11px] font-medium text-amber-700">{response.result.limitations}</p>
    </div>
  )
}

// Deterministic same-address history: everything shown here comes straight from
// the case database via the server (no model in the loop, no resident details).
function LocationHistoryPanel({ history }: { history: LocationHistory | null }) {
  return (
    <div>
      <div className="stat-label">Repeat complaint / address history</div>
      {history === null || history.repeat_complaint_count === 0 ? (
        <p className="mt-1 text-xs italic text-ink-subtle">
          No prior service requests found at this location in the case database.
        </p>
      ) : (
        <div className="mt-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-navy-800">
            <span>
              <span className="font-semibold">{history.repeat_complaint_count}</span> prior request
              {history.repeat_complaint_count === 1 ? '' : 's'} at this address
            </span>
            <span>
              <span className="font-semibold">{history.open_case_count}</span> still open
            </span>
            <span>
              <span className="font-semibold">{history.previous_field_visit_count}</span> previous field visit
              {history.previous_field_visit_count === 1 ? '' : 's'}
            </span>
          </div>
          <ul className="mt-2 space-y-1.5">
            {history.cases.map((c) => (
              <li key={c.case_id} className="text-[11px] leading-relaxed text-ink">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-navy-800">{c.case_id}</span>{' '}
                {c.request_type ?? 'Request'} · {c.status ?? 'status unknown'}
                {c.field_enforcement_action ? <> · outcome: {c.field_enforcement_action}</> : null}
                {c.field_follow_up_required ? ' · follow-up was required' : ''}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-ink-subtle">
            From the case database (location match). Operational history only — no resident details.
          </p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Supervisor Handoff
// ---------------------------------------------------------------------------

function HandoffView({ handoff }: { handoff: AssistantHandoff }) {
  return (
    <div className="space-y-3">
      <div className="stat-label">Supervisor handoff (draft — review before sharing)</div>
      <dl className="space-y-2">
        <HandoffRow label="Observed condition summary" value={handoff.observed_condition_summary} />
        <HandoffRow label="Evidence captured" value={handoff.evidence_captured} />
        <HandoffRow label="Officer action recorded" value={handoff.officer_action_recorded} />
        <HandoffRow label="Follow-up requirement" value={handoff.follow_up_requirement} />
      </dl>
      <AnswerList title="Outstanding information" items={handoff.outstanding_information} />
      <div>
        <div className="stat-label">Draft internal supervisor summary</div>
        <div className="mt-1 rounded-lg bg-slate-100 px-3.5 py-2.5">
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{handoff.supervisor_summary_draft}</p>
        </div>
      </div>
      <p className="text-[11px] font-medium text-amber-700">
        Draft only. The supervisor reviews the field outcome and decides the closure — the assistant does not
        approve closures or recommend enforcement actions.
      </p>
    </div>
  )
}

function HandoffRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Question answers (with reviewable insert-into-form buttons)
// ---------------------------------------------------------------------------

const INSERT_TARGETS: { key: InsertableDraftField; draftKey: 'observed_condition' | 'action_taken' | 'officer_notes'; label: string }[] = [
  { key: 'observedCondition', draftKey: 'observed_condition', label: 'Insert into Observed Condition' },
  { key: 'actionTaken', draftKey: 'action_taken', label: 'Insert into Action Taken' },
  { key: 'officerNotes', draftKey: 'officer_notes', label: 'Insert into Officer Notes' },
]

function AssistantAnswer({
  question,
  result,
  pocOnly,
  benchmarks,
  onInsertDraft,
}: {
  question: string | null
  result: AssistantResult
  pocOnly: boolean
  benchmarks: BenchmarkReference[]
  onInsertDraft?: (field: InsertableDraftField, text: string) => void
}) {
  const [inserted, setInserted] = useState<InsertableDraftField | null>(null)
  const drafts = result.field_drafts

  return (
    <div className="space-y-3">
      {question && (
        <div className="text-xs font-medium text-ink-subtle">
          You asked: <span className="text-navy-800">{question}</span>
        </div>
      )}

      <div className="rounded-lg bg-slate-100 px-3.5 py-2.5">
        <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{result.answer}</p>
      </div>

      {/* Reviewable insert actions: fills the form field only — the officer
          still reviews the text and submits the form themselves. */}
      {drafts && onInsertDraft && (
        <div>
          <div className="stat-label">Suggested field text</div>
          <div className="mt-1.5 space-y-2">
            {INSERT_TARGETS.map(({ key, draftKey, label }) => {
              const text = drafts[draftKey]
              if (!text) return null
              return (
                <div key={key} className="rounded-md border border-teal-200 bg-teal-50/40 px-2.5 py-2">
                  <p className="whitespace-pre-line text-sm text-ink">{text}</p>
                  <button
                    type="button"
                    onClick={() => {
                      onInsertDraft(key, text)
                      setInserted(key)
                    }}
                    className="mt-1.5 rounded-md border border-teal-300 bg-white px-2.5 py-1 text-xs font-semibold text-teal-800 transition hover:border-teal-500 hover:text-teal-900"
                  >
                    {inserted === key ? 'Inserted ✓ (review before submitting)' : label}
                  </button>
                </div>
              )
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-ink-subtle">
            Inserting only fills the form field. Review and edit the text — nothing is saved or submitted
            automatically.
          </p>
        </div>
      )}

      <AnswerList title="Officer checklist" items={result.officer_checklist} />
      <AnswerList title="Missing information" items={result.missing_information} />

      <BenchmarkNotes notes={result.benchmark_notes} benchmarks={benchmarks} />

      {result.used_context.length > 0 && (
        <p className="text-[11px] text-ink-subtle">Context used: {result.used_context.join(', ')}.</p>
      )}

      <p className="text-[11px] font-medium text-amber-700">{result.limitations}</p>

      {pocOnly && (
        <p className="text-[11px] text-ink-subtle">
          POC mode: server-side identity verification is not configured in this environment.
        </p>
      )}
    </div>
  )
}

// Benchmark notes are shown with the supporting benchmark case_id and its
// relevance (rerank) / similarity scores, so a claim like "a comparable case
// resulted in a Notice of Violation" is traceable to an actual surfaced case
// rather than looking invented. The server has already dropped any note whose
// case_id was not genuinely retrieved. When nothing was retrieved we say so.
function BenchmarkNotes({
  notes,
  benchmarks,
  title = 'Benchmark notes',
}: {
  notes: { case_id: string; note: string }[]
  benchmarks: BenchmarkReference[]
  title?: string
}) {
  const byId = new Map(benchmarks.map((b) => [b.case_id, b]))

  if (notes.length === 0) {
    return (
      <div>
        <div className="stat-label">{title}</div>
        <p className="mt-1 text-xs italic text-ink-subtle">No benchmark references were available.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="stat-label">{title}</div>
      <ul className="mt-1 space-y-2">
        {notes.map((n, i) => {
          const ref = byId.get(n.case_id)
          return (
            <li key={i} className="rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm text-ink">
              <p>{n.note}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-navy-800">
                  {ref?.complaint_type ? `${ref.complaint_type} · ` : ''}case {n.case_id}
                </span>
                {ref?.rerank_score != null && (
                  <span className="text-ink-subtle">relevance {ref.rerank_score.toFixed(2)}</span>
                )}
                {ref?.similarity_score != null && (
                  <span className="text-ink-subtle">· similarity {ref.similarity_score.toFixed(2)}</span>
                )}
                {ref?.closure_days != null && (
                  <span className="text-ink-subtle">· closed in {ref.closure_days}d</span>
                )}
              </div>
              {ref?.resolution_description && (
                <p className="mt-1 text-[11px] text-ink-subtle">Recorded resolution: {ref.resolution_description}</p>
              )}
            </li>
          )
        })}
      </ul>
      <p className="mt-1.5 text-[11px] text-ink-subtle">
        AI-supported references retrieved from similar closed benchmark cases. For staff reference only.
      </p>
    </div>
  )
}

function AnswerList({ title, items, emptyHint }: { title: string; items: string[]; emptyHint?: string }) {
  if (items.length === 0) {
    if (!emptyHint) return null
    return (
      <div>
        <div className="stat-label">{title}</div>
        <p className="mt-1 text-xs italic text-ink-subtle">{emptyHint}</p>
      </div>
    )
  }
  return (
    <div>
      <div className="stat-label">{title}</div>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  )
}
