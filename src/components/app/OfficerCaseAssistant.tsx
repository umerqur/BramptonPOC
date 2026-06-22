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
    <section className="overflow-hidden rounded-2xl border border-teal-200 bg-white shadow-sm">
      <div className="border-b border-teal-100 bg-teal-50/60 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white">
            {/* Checklist / support icon */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-900">Field Support Assistant</h3>
            <p className="mt-0.5 text-xs text-teal-900/80">
              Helps prepare site checks, field notes, and supervisor handoff. Staff decide all enforcement actions.
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="flex flex-wrap gap-1.5">
          {PROMPT_CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              disabled={state.status === 'loading'}
              onClick={() => ask(chip.question)}
              className="rounded-full border border-teal-200 bg-teal-50/50 px-3 py-1 text-xs font-medium text-teal-800 transition hover:border-teal-400 hover:bg-teal-50 hover:text-teal-900 disabled:opacity-60"
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
            placeholder="Ask for field support on this case…"
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
              Use this assistant to prepare the site visit, evidence checklist, or supervisor handoff for this case.
              It only uses this case file and available benchmark references.
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

        {/* Calm, muted guardrail note — no scary warning styling unless an actual error occurs. */}
        <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-ink-subtle">
          Decision support only · Does not issue tickets, submit forms, close cases, or approve closures.
        </p>
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
