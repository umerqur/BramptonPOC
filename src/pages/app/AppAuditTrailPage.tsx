import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useWorkflow } from '../../lib/workflowStore'
import { useDemoCase } from '../../lib/useDemoCase'
import { formatDateTime } from '../../services/demoWorkflowService'
import {
  ActorBadge,
  CaseChipLine,
  CaseSwitcher,
  GuardrailFooter,
  NoCaseState,
  StageBadge,
} from '../../components/workflow/WorkflowUI'
import type { DemoCase } from '../../data/demoWorkflowTypes'

// Audit Trail & Insights — every AI action, staff decision, status change, draft
// generation, approval, and closure is logged per case. Below the case timeline,
// trend insights aggregate across all demo cases: repeat-issue clusters, high-
// volume categories, aging cases, department workload pressure, and closure-
// response consistency.

export default function AppAuditTrailPage() {
  const { cases, activeCase, setActiveCase } = useWorkflow()
  const c = useDemoCase()
  const insights = useTrendInsights(cases)

  return (
    <div className="container-page py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <div className="section-eyebrow">Step 5 · Audit & insights</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">Audit Trail &amp; Insights</h1>
          <p className="mt-2 text-ink-muted">
            A complete, transparent record of AI actions and staff decisions — plus the trend insights the audit log
            makes possible.
          </p>
        </div>
        <CaseSwitcher cases={cases} activeId={c?.id ?? activeCase?.id ?? null} onPick={setActiveCase} />
      </div>

      {/* Case timeline */}
      {!c ? (
        <div className="mt-8">
          <NoCaseState />
        </div>
      ) : (
        <div className="mt-6 card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CaseChipLine c={c} />
            <span className="text-xs text-ink-subtle">{c.audit.length} events</span>
          </div>

          <ol className="mt-5 space-y-4">
            {c.audit.map((e, i) => (
              <li key={e.id} className="relative flex gap-3 pl-1">
                <div className="flex flex-col items-center">
                  <span
                    className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                      e.actor === 'ai'
                        ? 'bg-accent-500'
                        : e.actor === 'staff'
                          ? 'bg-navy-700'
                          : e.actor === 'resident'
                            ? 'bg-sky-500'
                            : 'bg-slate-400'
                    }`}
                  />
                  {i < c.audit.length - 1 && <span className="mt-1 w-px flex-1 bg-slate-200" />}
                </div>
                <div className="-mt-0.5 pb-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-navy-900">{e.type}</span>
                    <ActorBadge actor={e.actor} label={e.actorLabel} />
                    <span className="text-xs text-ink-subtle">{formatDateTime(e.at)}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-ink-muted">{e.detail}</p>
                </div>
              </li>
            ))}
          </ol>

          {c.decisions.length > 0 && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <div className="stat-label">Staff decisions</div>
              <ul className="mt-2 space-y-1.5">
                {c.decisions.map((d, i) => (
                  <li key={i} className="text-sm text-ink-muted">
                    <span className="font-medium text-navy-900">{d.action}</span> — {d.by} · {formatDateTime(d.at)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Trend insights */}
      <h2 className="mt-10 text-lg font-semibold text-navy-900">Trend insights</h2>
      <p className="text-sm text-ink-muted">Aggregated across all synthetic demo cases.</p>

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <InsightCard title="High-volume categories">
          <BarList rows={insights.categoryVolume} />
        </InsightCard>

        <InsightCard title="Repeat-issue clusters">
          {insights.repeatClusters.length === 0 ? (
            <p className="text-sm text-ink-subtle">No repeat-location clusters in the current demo set.</p>
          ) : (
            <ul className="space-y-2">
              {insights.repeatClusters.map((r) => (
                <li key={r.location} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span className="text-navy-900">{r.location}</span>
                  <span className="badge bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200">{r.count} related</span>
                </li>
              ))}
            </ul>
          )}
        </InsightCard>

        <InsightCard title="Department workload pressure">
          <BarList rows={insights.departmentLoad} />
        </InsightCard>

        <InsightCard title="Aging cases">
          {insights.agingCases.length === 0 ? (
            <p className="text-sm text-ink-subtle">No open cases aging beyond 1 day.</p>
          ) : (
            <ul className="space-y-2">
              {insights.agingCases.map((a) => (
                <li key={a.id} className="flex items-center justify-between text-sm">
                  <Link to={`/app/audit?case=${a.id}`} className="font-medium text-navy-900 hover:text-accent-700">
                    {a.id}
                  </Link>
                  <div className="flex items-center gap-2">
                    <StageBadge stage={a.stage} />
                    <span className="text-xs text-ink-subtle">{a.ageHours}h open</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </InsightCard>
      </div>

      <div className="mt-6">
        <InsightCard title="Closure-response consistency">
          <div className="flex items-center gap-4">
            <div className="text-3xl font-semibold text-accent-700">{insights.closureConsistency}%</div>
            <p className="flex-1 text-sm text-ink-muted">
              Share of approved closures that used a policy-aligned template and passed the resident-friendly tone
              checklist — a proxy for consistent closure language across staff.
            </p>
          </div>
        </InsightCard>
      </div>

      <GuardrailFooter />
    </div>
  )
}

type TrendInsights = {
  categoryVolume: { label: string; value: number }[]
  departmentLoad: { label: string; value: number }[]
  repeatClusters: { location: string; count: number }[]
  agingCases: { id: string; stage: DemoCase['stage']; ageHours: number }[]
  closureConsistency: number
}

function useTrendInsights(cases: DemoCase[]): TrendInsights {
  return useMemo(() => {
    const byCategory = new Map<string, number>()
    const byDept = new Map<string, number>()
    const clusters = new Map<string, number>()
    for (const c of cases) {
      byCategory.set(c.triage.category, (byCategory.get(c.triage.category) ?? 0) + 1)
      byDept.set(c.triage.recommendedDepartment, (byDept.get(c.triage.recommendedDepartment) ?? 0) + 1)
      if (c.context.repeatLocationCount >= 2 && c.triage.extractedLocation) {
        clusters.set(c.triage.extractedLocation, c.context.repeatLocationCount)
      }
    }

    const openStages: DemoCase['stage'][] = ['needs-staff-attention', 'staff-review', 'summary', 'context', 'classified', 'intake']
    const agingCases = cases
      .filter((c) => openStages.includes(c.stage))
      .map((c) => ({
        id: c.id,
        stage: c.stage,
        ageHours: Math.max(1, Math.round((Date.now() - new Date(c.input.submittedAt).getTime()) / 3600000)),
      }))
      .filter((a) => a.ageHours >= 2)
      .sort((a, b) => b.ageHours - a.ageHours)
      .slice(0, 6)

    const closed = cases.filter((c) => c.stage === 'closed')
    const consistent = closed.filter(
      (c) => c.draft && c.draft.policyChecklist.every((p) => p.ok) && c.draft.toneChecklist.filter((t) => t.ok).length >= 3,
    ).length
    const closureConsistency = closed.length === 0 ? 100 : Math.round((consistent / closed.length) * 100)

    const sortRows = (m: Map<string, number>) =>
      [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)

    return {
      categoryVolume: sortRows(byCategory),
      departmentLoad: sortRows(byDept),
      repeatClusters: [...clusters.entries()].map(([location, count]) => ({ location, count })).sort((a, b) => b.count - a.count),
      agingCases,
      closureConsistency,
    }
  }, [cases])
}

function InsightCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function BarList({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink">{r.label}</span>
            <span className="tabular-nums text-ink-subtle">{r.value}</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-accent-400" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
