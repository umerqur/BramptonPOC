/**
 * Phased roadmap for the Workflow console. Sets expectations about where the POC
 * is today (Phase 1) and what comes later, while being explicit that the later
 * phases are not built yet — there is no agentic behaviour and no local model
 * training in this POC. Presentational only; reuses existing design tokens.
 */

type Phase = {
  n: number
  title: string
  body: string
  current?: boolean
}

const PHASES: Phase[] = [
  {
    n: 1,
    title: 'Rules based decision support',
    body: 'Where the POC is today. Rule based triage plus optional, on-demand AI assisted review for a single case. A human reviews and decides every case — nothing is automated and nothing acts on its own.',
    current: true,
  },
  {
    n: 2,
    title: 'Brampton data integration',
    body: 'Replace the public NYC 311 benchmark stand-in with Brampton operational complaint, ticket, patrol, and closure data, integrated under City privacy and cybersecurity controls.',
  },
  {
    n: 3,
    title: 'Labelled outcome learning',
    body: 'Learn from staff-labelled closure outcomes to calibrate scoring to real Brampton patterns. Still fully staff reviewed — no model acts on its own.',
  },
  {
    n: 4,
    title: 'Agentic monitoring with human approval',
    body: 'Continuous monitoring proposes actions for staff, but every proposed action still requires explicit human approval before anything happens.',
  },
]

export default function WorkflowRoadmap() {
  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PHASES.map((p) => (
          <div
            key={p.n}
            className={`card p-5 ${p.current ? 'ring-1 ring-inset ring-accent-200' : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-accent-700">Phase {p.n}</span>
              {p.current ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-accent-50 px-2 py-0.5 text-[11px] font-medium text-accent-800 ring-1 ring-inset ring-accent-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
                  Current phase
                </span>
              ) : (
                <span className="badge bg-slate-100 text-slate-600">Planned</span>
              )}
            </div>
            <h3 className="mt-2 text-sm font-semibold text-navy-900">{p.title}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{p.body}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-ink-subtle">
        Phases 2–4 describe the intended direction only — they are not built yet. This POC has no agentic behaviour and
        no local model training; AI assistance is on demand and every decision stays with authorized municipal staff.
      </p>
    </div>
  )
}
