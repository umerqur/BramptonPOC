import { useEffect, useState } from 'react'
import type { DemoCategory } from '../../data/demoWorkflowTypes'
import {
  askOfficerCaseAssistant,
  AssistantNotConfiguredError,
  type AssistantResult,
  type BenchmarkReference,
} from '../../services/officerCaseAssistant'

// Officer Case Assistant — a CASE-SCOPED, server-side AI helper for the By-law
// Officer (and supervisor / CSR) viewing one assigned case.
//
// This is NOT a generic chatbot. It calls the server-side
// /.netlify/functions/officer-case-assistant function (Cohere Command), which
// answers ONLY from the current case context, the workflow timeline, and any
// retrieved benchmark references. It is decision support only: it never writes
// to Supabase and never decides an enforcement outcome. The free-text box is
// intentionally scoped to this case — broad, unrelated prompts are refused by
// the server guardrail and surfaced here as a refusal.

export type AssistantCaseContext = {
  caseId: string
  category: DemoCategory
  complaintType: string
  location: string
  description: string
  assignedOfficer: string | null
}

// Suggested, case-scoped prompts. Each maps to the precise question sent to the
// server so the surface never looks like an open-ended assistant.
const PROMPT_CHIPS: { label: string; question: string }[] = [
  { label: 'Summarize this case', question: 'Summarize this case.' },
  { label: 'What should I verify on site?', question: 'What should I verify on site?' },
  { label: 'What information is missing?', question: 'What information is missing?' },
  { label: 'Explain similar benchmark cases', question: 'Explain the similar benchmark cases.' },
  {
    label: 'Draft internal field-note summary',
    question: 'Turn my field notes into a clean internal summary.',
  },
]

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'ready'
      result: AssistantResult
      pocOnly: boolean
      benchmarks: BenchmarkReference[]
    }
  | { status: 'unconfigured'; message: string }
  | { status: 'error'; message: string }

export default function OfficerCaseAssistant({ ctx }: { ctx: AssistantCaseContext }) {
  const [state, setState] = useState<LoadState>({ status: 'idle' })
  const [input, setInput] = useState('')
  const [lastQuestion, setLastQuestion] = useState<string | null>(null)

  // Reset when the focused case changes so a stale answer never carries across.
  useEffect(() => {
    setState({ status: 'idle' })
    setLastQuestion(null)
    setInput('')
  }, [ctx.caseId])

  async function ask(question: string) {
    const q = question.trim()
    if (!q || state.status === 'loading') return
    setLastQuestion(q)
    setState({ status: 'loading' })
    try {
      const res = await askOfficerCaseAssistant(ctx.caseId, q, {
        issue_type: ctx.complaintType,
        description: ctx.description,
        location: ctx.location,
        assigned_officer_name: ctx.assignedOfficer,
      })
      setState({
        status: 'ready',
        result: res.result,
        pocOnly: res.poc_only,
        benchmarks: res.benchmarks ?? [],
      })
    } catch (err) {
      if (err instanceof AssistantNotConfiguredError) {
        setState({ status: 'unconfigured', message: err.message })
      } else {
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  return (
    <section className="card flex flex-col p-0">
      <div className="border-b border-slate-200 px-5 py-3">
        <h3 className="text-sm font-semibold text-navy-900">Officer Case Assistant</h3>
        <p className="text-xs text-ink-subtle">Case-scoped AI support. Does not decide enforcement action.</p>
      </div>

      {/* Decision-support banner — always visible so the surface is never read as
          an action tool. */}
      <div className="mx-5 mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
        Decision support only. Staff remain responsible for enforcement decisions. This assistant cannot issue
        tickets, close cases, or approve closures.
      </div>

      <div className="px-5 py-4">
        <div className="flex flex-wrap gap-1.5">
          {PROMPT_CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              disabled={state.status === 'loading'}
              onClick={() => ask(chip.question)}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-navy-800 transition hover:border-accent-300 hover:text-accent-700 disabled:opacity-60"
            >
              {chip.label}
            </button>
          ))}
        </div>

        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            ask(input)
            setInput('')
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this case…"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-navy-900 focus:border-accent-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim() || state.status === 'loading'}
            className="btn-primary text-sm disabled:opacity-60"
          >
            Ask
          </button>
        </form>

        {/* Result / state surface */}
        <div className="mt-4">
          {state.status === 'idle' && (
            <p className="text-xs text-ink-subtle">
              Pick a suggested prompt or ask a question about case {ctx.caseId}. Answers use only this case file,
              its workflow history, and similar benchmark references.
            </p>
          )}

          {state.status === 'loading' && (
            <p className="text-sm text-ink-subtle">Reviewing the case file…</p>
          )}

          {state.status === 'unconfigured' && (
            <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-navy-800">
              Officer Case Assistant is not configured in this environment.
            </div>
          )}

          {state.status === 'error' && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
              {state.message}
            </div>
          )}

          {state.status === 'ready' && (
            <AssistantAnswer
              question={lastQuestion}
              result={state.result}
              pocOnly={state.pocOnly}
              benchmarks={state.benchmarks}
            />
          )}
        </div>
      </div>
    </section>
  )
}

function AssistantAnswer({
  question,
  result,
  pocOnly,
  benchmarks,
}: {
  question: string | null
  result: AssistantResult
  pocOnly: boolean
  benchmarks: BenchmarkReference[]
}) {
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
// rather than looking invented. When nothing was retrieved we say so plainly.
function BenchmarkNotes({
  notes,
  benchmarks,
}: {
  notes: { case_id: string; note: string }[]
  benchmarks: BenchmarkReference[]
}) {
  const byId = new Map(benchmarks.map((b) => [b.case_id, b]))

  if (notes.length === 0) {
    return (
      <div>
        <div className="stat-label">Benchmark notes</div>
        <p className="mt-1 text-xs italic text-ink-subtle">No benchmark references were available.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="stat-label">Benchmark notes</div>
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
