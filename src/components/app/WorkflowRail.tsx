import { Link, useLocation } from 'react-router-dom'
import { useWorkflow } from '../../lib/workflowStore'

// Compact case-lifecycle rail for the supervisor workflow surfaces. It answers
// "where am I in the active case lifecycle?" (Queue → Workbench → Closure Review),
// complementing the top nav's "where am I in the product?". It is NOT a full admin
// sidebar: it appears only on the staff workflow pages where it explains the
// lifecycle, never on Insights (an analytics workspace) or the Officer console
// (its own role-specific flow). Hidden below `lg`. Workflow guide only — staff
// review and approve each step.

type Step = {
  label: string
  helper: string
  to: string
  activeWhen: (pathname: string) => boolean
  enabled: boolean
}

export default function WorkflowRail() {
  const location = useLocation()
  const { activeCase, role } = useWorkflow()
  const pathname = location.pathname

  // Officers have a simplified, role-specific flow — no lifecycle rail.
  if (role === 'officer') return null
  // Insights is an analytics workspace, not part of the case lifecycle.
  if (pathname.startsWith('/app/insights')) return null
  // Officer field surfaces never show the supervisor rail.
  if (pathname.startsWith('/app/field')) return null

  const activeCaseId = activeCase?.id ?? null

  const steps: Step[] = [
    {
      label: 'Work Queue',
      helper: 'Review active work',
      to: '/app',
      activeWhen: (p) => p === '/app',
      enabled: true,
    },
    {
      label: 'Case Workbench',
      helper: activeCaseId ? 'Review context and routing' : 'Open a case first',
      to: activeCaseId ? `/app/workbench?case=${encodeURIComponent(activeCaseId)}` : '/app',
      activeWhen: (p) => p.startsWith('/app/workbench'),
      enabled: Boolean(activeCaseId),
    },
    {
      label: 'Closure Review',
      helper: activeCaseId ? 'Approve final response' : 'Open a case first',
      to: activeCaseId ? `/app/closure?case=${encodeURIComponent(activeCaseId)}` : '/app',
      activeWhen: (p) => p.startsWith('/app/closure'),
      enabled: Boolean(activeCaseId),
    },
  ]

  return (
    <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:block">
      <div className="sticky top-16 px-5 py-6">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Case workflow</div>
        <div className="mt-1 truncate text-sm font-semibold text-navy-900">{activeCaseId ?? 'No case selected'}</div>

        <ol className="mt-5">
          {steps.map((step, index) => {
            const active = step.activeWhen(pathname)
            const last = index === steps.length - 1
            const content = (
              <div className={`flex gap-3 rounded-md px-2.5 py-2 transition-colors ${active ? 'bg-slate-100' : step.enabled ? 'hover:bg-slate-50' : ''}`}>
                {/* Step marker + vertical connector line (square-cornered, not a pill). */}
                <div className="flex flex-col items-center self-stretch">
                  <div
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
                      active
                        ? 'bg-navy-900 text-white'
                        : step.enabled
                          ? 'bg-white text-ink-muted ring-1 ring-inset ring-slate-300'
                          : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {index + 1}
                  </div>
                  {!last && <div className={`mt-1 w-px flex-1 ${active ? 'bg-navy-300' : 'bg-slate-200'}`} />}
                </div>
                <div className="min-w-0 pb-3">
                  <div className={`text-sm font-semibold ${step.enabled ? 'text-navy-900' : 'text-slate-400'}`}>{step.label}</div>
                  <div className={`mt-0.5 text-[11px] ${step.enabled ? 'text-ink-subtle' : 'text-slate-400'}`}>{step.helper}</div>
                </div>
              </div>
            )

            return <li key={step.label}>{step.enabled ? <Link to={step.to} className="block">{content}</Link> : content}</li>
          })}
        </ol>

        <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">Workflow guide only. Staff review and approve each step.</p>
      </div>
    </aside>
  )
}
