import { useMemo, useRef, useState } from 'react'
import type { DemoCategory } from '../../data/demoWorkflowTypes'
import { guidanceForCategory } from '../../data/bylawGuidance'

// Officer Assistant — the By-law Officer's case-driven helper.
//
// This is a DETERMINISTIC, rule-based assistant (not a live AI model). It is
// grounded in the case file (complaint type, location, description) and the
// by-law "offended" for the case's category, and it tells the officer what to
// check on site, what their action options are, and how to record a truthful
// field outcome. The officer's surface is intentionally workflow-driven: this
// assistant plus the field-outcome form, nothing else.

export type AssistantCaseContext = {
  caseId: string
  category: DemoCategory
  complaintType: string
  location: string
  description: string
  assignedOfficer: string | null
}

type ChatMessage = { id: number; from: 'assistant' | 'officer'; text: string }

// The preset questions the officer can ask. Each maps to a deterministic answer
// built from the case context + by-law guidance.
type Intent = 'bylaw' | 'check' | 'actions' | 'record' | 'summary'

const PRESETS: { intent: Intent; label: string }[] = [
  { intent: 'bylaw', label: 'What by-law applies?' },
  { intent: 'check', label: 'What should I check on site?' },
  { intent: 'actions', label: 'What are my action options?' },
  { intent: 'record', label: 'How do I record the outcome?' },
  { intent: 'summary', label: 'Summarize this case' },
]

function bullets(lines: string[]): string {
  return lines.map((l) => `• ${l}`).join('\n')
}

export default function OfficerCaseAssistant({ ctx }: { ctx: AssistantCaseContext }) {
  const guidance = useMemo(() => guidanceForCategory(ctx.category), [ctx.category])

  // Deterministic responder: build the answer for a given intent from the case
  // context + the by-law guidance for its category.
  const answerFor = useMemo(() => {
    return (intent: Intent): string => {
      switch (intent) {
        case 'bylaw':
          return (
            `This case looks like a ${guidance.offence.toLowerCase()}.\n\n` +
            `Applicable by-law: ${guidance.bylawName} (${guidance.bylawReference}).\n` +
            `${guidance.summary}`
          )
        case 'check':
          return `On site, confirm the following before you record anything:\n\n${bullets(guidance.whatToCheck)}`
        case 'actions':
          return (
            `Your action options for a ${guidance.offence.toLowerCase()} (least to most severe):\n\n` +
            `${bullets(guidance.actionOptions)}\n\n` +
            `Pick the action that matches what you actually did — the closure letter is built from it.`
          )
        case 'record':
          return (
            `Record your field outcome in the form below using these fields:\n\n` +
            `${bullets([
              'Observed condition — what you actually saw on site.',
              'Violation observed — yes / no / unclear.',
              'Enforcement action — select what you did: education / warning, notice issued, parking ticket / penalty notice issued, no action, or other.',
              'For a parking ticket / penalty notice: record the notice number (if you have it) and the method of service.',
              'Action taken notes — optional supporting detail (the disposition comes from the structured action, not this text).',
              'Officer notes — any internal detail (kept internal, not sent to the resident).',
              'Follow-up required — flag if a re-inspection or zoning review is needed.',
            ])}\n\n` +
            `Keep it truthful:\n${bullets(guidance.recordingTips)}`
          )
        case 'summary':
          return (
            `Case ${ctx.caseId}\n` +
            `${bullets([
              `Complaint type: ${ctx.complaintType}`,
              `By-law offended: ${guidance.bylawName} (${guidance.bylawReference})`,
              `Location: ${ctx.location || 'not provided'}`,
              ctx.assignedOfficer ? `Assigned to: ${ctx.assignedOfficer}` : 'Assigned to: you',
            ])}\n\n` +
            `Reported issue: ${ctx.description.trim() ? ctx.description.trim() : 'No description was provided.'}`
          )
      }
    }
  }, [ctx, guidance])

  // Map free-text to an intent by keyword, defaulting to a helpful prompt.
  function intentForText(text: string): Intent | null {
    const t = text.toLowerCase()
    if (/by-?law|law|applies|offen|policy|reference/.test(t)) return 'bylaw'
    if (/check|site|look|inspect|observe|evidence/.test(t)) return 'check'
    if (/action|option|do|issue|ticket|notice|warn/.test(t)) return 'actions'
    if (/record|outcome|report|form|log|enter/.test(t)) return 'record'
    if (/summ|detail|case|context|what.*about|tell me/.test(t)) return 'summary'
    return null
  }

  const idRef = useRef(1)
  const nextId = () => idRef.current++

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 0,
      from: 'assistant',
      text:
        `I'm your case assistant for ${ctx.caseId}. This looks like a ${guidance.offence.toLowerCase()} ` +
        `under the ${guidance.bylawName} (${guidance.bylawReference}).\n\n` +
        `Ask me what to check on site, your action options, or how to record the outcome. ` +
        `I only use this case file and the by-law guidance — I can't approve closures or see other officers' cases.`,
    },
  ])
  const [input, setInput] = useState('')

  function pushExchange(question: string, intent: Intent | null) {
    setMessages((m) => [
      ...m,
      { id: nextId(), from: 'officer', text: question },
      {
        id: nextId(),
        from: 'assistant',
        text:
          intent != null
            ? answerFor(intent)
            : `I can help with this case. Try one of:\n\n${bullets(PRESETS.map((p) => p.label))}`,
      },
    ])
  }

  function askPreset(intent: Intent, label: string) {
    pushExchange(label, intent)
  }

  function submitInput() {
    const text = input.trim()
    if (!text) return
    pushExchange(text, intentForText(text))
    setInput('')
  }

  return (
    <section className="card flex flex-col p-0">
      <div className="border-b border-slate-200 px-5 py-3">
        <h3 className="text-sm font-semibold text-navy-900">Officer Assistant</h3>
        <p className="text-xs text-ink-subtle">
          Case-grounded guidance for {ctx.caseId}. Deterministic POC helper — staff decide.
        </p>
      </div>

      <div className="max-h-[22rem] flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {messages.map((m) => (
          <div key={m.id} className={m.from === 'officer' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                m.from === 'officer'
                  ? 'bg-accent-600 text-white'
                  : 'bg-slate-100 text-ink'
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-200 px-5 py-3">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.intent}
              type="button"
              onClick={() => askPreset(p.intent, p.label)}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-navy-800 transition hover:border-accent-300 hover:text-accent-700"
            >
              {p.label}
            </button>
          ))}
        </div>
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submitInput()
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this case…"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-navy-900 focus:border-accent-500 focus:outline-none"
          />
          <button type="submit" disabled={!input.trim()} className="btn-primary text-sm disabled:opacity-60">
            Send
          </button>
        </form>
      </div>
    </section>
  )
}
