import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { isSupabaseConfigured } from '../../lib/supabase'
import {
  getClosureReviewStatisticalCases,
  type StatisticalCaseScore,
} from '../../services/municipalServiceRequests'
import {
  askCaseAgent,
  generateAiReviewPacket,
  type AgentTrace,
  type AiReviewPacketRequest,
  type AiReviewPacketResponse,
  type AskCaseAgentResponse,
} from '../../services/aiReviewPacket'
import {
  getCaseOperationalContext,
  SCENARIO_LABELS,
  SYNTHETIC_CONTEXT_LABEL,
  TREND_CONTEXT_LABEL,
  type CaseOperationalContext,
  type ClosureScenario,
} from '../../services/operationalContext'

// Closure Review Workbench — turns the statistical attention queue into a staff
// review + closure workflow. Cases are read live from Supabase
// (v_statistical_attention_queue) ranked by Review Attention Score. Everything
// below the fetch is DETERMINISTIC and client-side: rules, recommended action,
// missing-info checklist and draft language are computed from the loaded row — no
// LLM call and no Supabase write. The human-review controls are POC-only UI; in
// production a staff approval would be logged. The Review Attention Score is a
// transparent, relative statistical queue rank (Higher / Medium / Lower), not a
// probability and not an automated decision.

const GOVERNANCE_NOTE =
  'AI automates research, analysis, and draft preparation for staff approved closure responses. It does not make enforcement decisions, close files on its own, or contact residents without staff approval.'

// Data positioning for the linked operational records (migrations 009/010).
const POSITIONING_NOTE =
  'NYC 311 public benchmark data provides the complaint and trend signals. Related patrol logs, ticket records, and closure templates are synthetic POC operational context linked to real benchmark case ids — clearly labelled, and not Brampton operational data.'

// The six-step workbench workflow, shown as a strip under the page header so
// the screen reads as one closure workflow rather than a set of panels.
const WORKBENCH_STEPS: Array<{ title: string; detail: string }> = [
  { title: 'Complaint enters review queue', detail: 'Cases load from live benchmark data.' },
  { title: 'Review Attention Score prioritizes', detail: 'Highest priority files first.' },
  { title: 'Case workspace gathers linked records', detail: 'Patrol logs, ticket records, and trends.' },
  { title: 'Rules check closure readiness', detail: 'Flags, checklist, and matched template.' },
  { title: 'AI Review Packet drafts language', detail: 'Staff summary, next step, and resident update.' },
  { title: 'Staff approve before anything happens', detail: 'No action without staff approval.' },
]

const SAFETY_KEYWORDS = ['emergency', 'hazard', 'unsafe', 'blocked', 'broken']
const SUPERVISOR_KEYWORDS = ['repeat', 'unsafe', 'hazard', 'blocked', 'emergency', 'urgent']

type Tier = 'Higher' | 'Medium' | 'Lower' | 'Unknown'
type WorkflowAction = 'Review First' | 'Needs Follow Up' | 'Closure Candidate' | 'Supervisor Review'

function tierOf(row: StatisticalCaseScore): Tier {
  const t = (row.attention_tier ?? '').toLowerCase()
  if (t.includes('high')) return 'Higher'
  if (t.includes('med')) return 'Medium'
  if (t.includes('low')) return 'Lower'
  return 'Unknown'
}

function isOpenStatus(status: string | null): boolean {
  const s = (status ?? '').toLowerCase()
  return s.includes('new') || s.includes('progress') || s.includes('open')
}

function isClosedStatus(status: string | null): boolean {
  const s = (status ?? '').toLowerCase()
  return s.includes('complete') || s.includes('closed')
}

/** The statistical attention drivers present on a row (top_driver_1..3). */
function driversOf(row: StatisticalCaseScore): string[] {
  return [row.top_driver_1, row.top_driver_2, row.top_driver_3].filter((d): d is string => Boolean(d?.trim()))
}

/** A driver flags missing closure context (the statistical queue replaces the
 *  former short-description heuristic — the queue view carries no description). */
function hasMissingContextDriver(row: StatisticalCaseScore): boolean {
  return driversOf(row).some((d) => d.toLowerCase().includes('missing'))
}

function includesAny(haystack: string, words: string[]): boolean {
  const h = haystack.toLowerCase()
  return words.some((w) => h.includes(w))
}

/** Deterministic client-side rules fired from the available fields. */
type Rule = { label: string; detail: string }

function rulesFor(row: StatisticalCaseScore): Rule[] {
  const rules: Rule[] = []
  const tier = tierOf(row)
  const drivers = driversOf(row)
  const typeAndDrivers = `${row.complaint_type ?? ''} ${drivers.join(' ')}`

  if (isOpenStatus(row.status)) {
    rules.push({ label: 'Open case review required', detail: 'Status is New or In Progress.' })
  }
  if (tier === 'Higher') {
    rules.push({ label: 'Prioritize staff review', detail: 'Review Attention tier is Higher.' })
  }
  if (drivers.length) {
    rules.push({ label: 'Review Attention drivers', detail: drivers.join(' · ') })
  }
  if (hasMissingContextDriver(row)) {
    rules.push({ label: 'Missing information check', detail: 'A statistical driver flags missing closure context.' })
  }
  if (includesAny(typeAndDrivers, SAFETY_KEYWORDS)) {
    rules.push({
      label: 'Safety wording check',
      detail: 'Complaint type or drivers mention emergency / hazard / unsafe / blocked / broken.',
    })
  }
  if ((row.assigned_department ?? '').trim()) {
    rules.push({ label: 'Use existing department from source system', detail: 'Assigned department is present.' })
  } else {
    rules.push({ label: 'Manual assignment required', detail: 'No assigned department on the source record.' })
  }
  return rules
}

/** Deterministic recommended workflow action. */
function recommendedAction(row: StatisticalCaseScore): WorkflowAction {
  const tier = tierOf(row)
  const typeAndDrivers = `${row.complaint_type ?? ''} ${driversOf(row).join(' ')}`

  if (tier === 'Higher' && includesAny(typeAndDrivers, SUPERVISOR_KEYWORDS)) return 'Supervisor Review'
  if (tier === 'Higher' && isOpenStatus(row.status)) return 'Review First'
  if (hasMissingContextDriver(row)) return 'Needs Follow Up'
  if (isClosedStatus(row.status) && tier === 'Lower') return 'Closure Candidate'
  return 'Needs Follow Up'
}

type Check = { label: string; ok: boolean }

function checklistFor(row: StatisticalCaseScore): Check[] {
  return [
    { label: 'Location context present', ok: Boolean((row.ward_or_area ?? '').trim()) },
    { label: 'Address or location present', ok: Boolean((row.address_or_location ?? '').trim()) },
    { label: 'Assigned department present', ok: Boolean((row.assigned_department ?? '').trim()) },
    { label: 'Status present', ok: Boolean((row.status ?? '').trim()) },
    { label: 'Complaint type present', ok: Boolean((row.complaint_type ?? '').trim()) },
  ]
}

function draftStaffSummary(row: StatisticalCaseScore): string {
  const type = row.complaint_type || 'an unspecified complaint type'
  const dept = row.assigned_department || 'no assigned department'
  const status = row.status || 'an unknown status'
  const tier = tierOf(row)
  const drivers = driversOf(row)
  const driverSentence = drivers.length
    ? ` Key Review Attention drivers: ${drivers.join('; ')}.`
    : ''
  return (
    `This complaint relates to ${type} and is currently assigned to ${dept}. ` +
    `The file is marked ${status} and appears in the ${tier} Review Attention tier based on statistical queue signals.` +
    driverSentence +
    ` Staff should review the case details, confirm whether any information is missing, and determine whether the ` +
    `file is ready for follow up or closure.`
  )
}

function draftResidentLanguage(row: StatisticalCaseScore): string {
  if (isClosedStatus(row.status)) {
    const status = row.status || 'reviewed'
    return (
      `Thank you for contacting the City. This file has been reviewed and marked as ${status}. ` +
      `Based on the available case information, the issue has been processed by the assigned service area. ` +
      `If the issue continues or new information is available, please submit an updated request.`
    )
  }
  return (
    `Thank you for contacting the City. Your request has been received and is currently under review by the ` +
    `assigned service area. Staff will review the available information and determine the appropriate next step.`
  )
}

export default function AppClosureReviewPage() {
  const [rows, setRows] = useState<StatisticalCaseScore[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [controlNote, setControlNote] = useState<string | null>(null)
  // Optional deep-link from Insights: /app/closure-review?case=<source_record_id>
  // preselects that case in the queue when it is present in the loaded set.
  const [searchParams] = useSearchParams()
  const requestedCase = searchParams.get('case')
  // The right "Case File Workspace" panel. Used to scroll the opened case file
  // into view when staff pick a different queue row (mobile / small screens).
  const workspaceRef = useRef<HTMLElement>(null)

  useEffect(() => {
    let active = true
    if (!isSupabaseConfigured) {
      setError('Live data is not available in this environment.')
      setLoading(false)
      return
    }
    getClosureReviewStatisticalCases(60)
      .then((data) => {
        if (!active) return
        setRows(data)
        if (data.length) {
          // Preselect the deep-linked case if it is in the loaded set; otherwise
          // fall back to the top-ranked case.
          const matchIndex = requestedCase
            ? data.findIndex((r) => r.source_record_id === requestedCase || r.case_id === requestedCase)
            : -1
          const initial = matchIndex >= 0 ? matchIndex : 0
          setSelectedId(rowKey(data[initial], initial))
        }
      })
      .catch((err: unknown) => active && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [requestedCase])

  const summary = useMemo(() => {
    let higher = 0
    let medium = 0
    let lower = 0
    let closureReady = 0
    let followUp = 0
    for (const r of rows) {
      const tier = tierOf(r)
      if (tier === 'Higher') higher += 1
      else if (tier === 'Medium') medium += 1
      else if (tier === 'Lower') lower += 1
      const action = recommendedAction(r)
      if (action === 'Closure Candidate') closureReady += 1
      if (action === 'Needs Follow Up') followUp += 1
    }
    return { total: rows.length, higher, medium, lower, closureReady, followUp }
  }, [rows])

  const selected = useMemo(
    () => rows.find((r, i) => rowKey(r, i) === selectedId) ?? null,
    [rows, selectedId],
  )

  function handleControl(label: string) {
    setControlNote(`${label} — POC mode: no action was submitted.`)
  }

  // Selecting a case opens it as the active case file. The control note resets,
  // and the AI packet + "Ask this case" state live inside ReviewPacket, which is
  // remounted via its `key={selectedId}`, so they clear automatically. We also
  // scroll the workspace into view so the opened case file is obvious.
  function handleSelect(key: string) {
    setSelectedId(key)
    setControlNote(null)
    workspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="container-page py-10">
      {/* 1. Header */}
      <div className="section-eyebrow">Closure Review</div>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">
            Closure Review Workbench
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-ink-muted">
            Use enforcement context and AI drafted language to prepare staff approved closure responses.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone="emerald">Live data</Pill>
          <Pill tone="navy">Staff approval required</Pill>
        </div>
      </div>

      {/* 1b. Workbench workflow strip — the six steps from queue to approval. */}
      <ol className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {WORKBENCH_STEPS.map((s, i) => (
          <li key={s.title} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-navy-900">
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent-100 text-[10px] font-semibold text-accent-700">
                {i + 1}
              </span>
              {s.title}
            </div>
            <p className="mt-1 text-[11px] leading-snug text-ink-subtle">{s.detail}</p>
          </li>
        ))}
      </ol>

      {/* 2. Top summary cards — kept to four so the first impression reads as a
          focused queue, not a metrics dump. */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Cases loaded" value={summary.total} />
        <SummaryCard label="Higher attention" value={summary.higher} tone="amber" />
        <SummaryCard label="Needs follow up" value={summary.followUp} />
        <SummaryCard label="AI packet mode" value="On demand" tone="emerald" />
      </div>

      {/* 3. Main split layout */}
      {loading ? (
        <div className="mt-6 card flex min-h-[200px] items-center justify-center text-sm text-ink-subtle">
          Loading cases…
        </div>
      ) : error ? (
        <div className="mt-6 card px-5 py-6 text-sm text-ink-muted">
          <div className="font-semibold text-navy-900">Cases unavailable.</div>
          <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-xs text-ink-subtle">{error}</pre>
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-6 card px-5 py-6 text-sm text-ink-subtle">No statistical attention scores found.</div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          {/* Left — case queue */}
          <section className="card overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-navy-900">Complaint review queue</h2>
              <p className="text-xs text-ink-subtle">
                Ordered by Review Attention Score (highest first) so staff review the right files first. {rows.length}{' '}
                cases loaded.
              </p>
            </div>
            <ul className="max-h-[640px] divide-y divide-slate-100 overflow-y-auto">
              {rows.map((r, i) => {
                const key = rowKey(r, i)
                const isSelected = key === selectedId
                return (
                  <li key={key}>
                    {/* Selection and full-case-file navigation are intentionally
                        two separate controls (no nested interactives): the body
                        button selects the case into the right workspace, while
                        the "Open full case file" link below routes to the
                        existing /app/cases/:id detail page. */}
                    <div
                      aria-current={isSelected ? 'true' : undefined}
                      className={`relative border-l-4 transition ${
                        isSelected
                          ? 'border-accent-500 bg-accent-50/60 ring-1 ring-inset ring-accent-200'
                          : 'border-transparent hover:bg-slate-50'
                      }`}
                    >
                      <button
                        onClick={() => handleSelect(key)}
                        className="block w-full px-4 pb-2 pt-3 text-left"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-navy-900">
                            {r.complaint_type || 'Uncategorized'}
                          </span>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {isSelected && (
                              <span className="inline-flex rounded-full bg-accent-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-700">
                                Selected
                              </span>
                            )}
                            <AttentionChip tier={r.attention_tier} />
                          </div>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-subtle">
                          <span>{r.assigned_department || 'Unassigned'}</span>
                          <span aria-hidden>·</span>
                          <span>{r.status || 'Unknown status'}</span>
                          <span aria-hidden>·</span>
                          <span>{r.ward_or_area || 'Area not recorded'}</span>
                          <span aria-hidden>·</span>
                          <span className="tabular-nums">
                            score {r.attention_score == null ? '—' : r.attention_score.toFixed(3)}
                          </span>
                        </div>
                        {driversOf(r).length > 0 && (
                          <p className="mt-1 line-clamp-1 text-xs text-ink-muted">{driversOf(r).join(' · ')}</p>
                        )}
                      </button>
                      <div className="px-4 pb-3">
                        {r.source_record_id ? (
                          <Link
                            to={`/app/cases/${encodeURIComponent(r.source_record_id)}`}
                            onClick={(e) => e.stopPropagation()}
                            className={`inline-flex items-center gap-1 text-xs font-semibold hover:underline ${
                              isSelected ? 'text-accent-700' : 'text-accent-600'
                            }`}
                          >
                            Open full case file
                            <span aria-hidden>→</span>
                          </Link>
                        ) : (
                          <span className="text-xs text-ink-subtle">Case file link unavailable</span>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>

          {/* Right — case file workspace */}
          <section ref={workspaceRef} className="card overflow-hidden scroll-mt-20">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold text-navy-900">Case File Workspace</h2>
                {selected ? (
                  <div className="mt-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
                      Selected case
                    </div>
                    <div className="mt-0.5 text-sm font-semibold text-navy-900">
                      {selected.complaint_type || 'Uncategorized'}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-subtle">
                      <span>{selected.assigned_department || 'Unassigned'}</span>
                      <span aria-hidden>·</span>
                      <span>{selected.status || 'Unknown status'}</span>
                      <span aria-hidden>·</span>
                      <span>Rank {selected.attention_rank == null ? '—' : `#${selected.attention_rank}`}</span>
                      <span aria-hidden>·</span>
                      <span>
                        Review Attention{' '}
                        {selected.attention_score == null
                          ? '—'
                          : selected.attention_score.toFixed(3)}
                      </span>
                      <span aria-hidden>·</span>
                      <span>{selected.ward_or_area || 'Source area not recorded'}</span>
                    </div>
                    {selected.source_record_id && (
                      <div className="mt-2">
                        <Link
                          to={`/app/cases/${encodeURIComponent(selected.source_record_id)}`}
                          className="inline-flex items-center gap-1 rounded-md border border-accent-200 bg-white px-2.5 py-1 text-xs font-semibold text-accent-700 transition hover:border-accent-300 hover:bg-accent-50"
                        >
                          Open full case file
                          <span aria-hidden>→</span>
                        </Link>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-ink-subtle">Open a case from the queue to start a case file.</p>
                )}
              </div>
              {selected && <ActionChip action={recommendedAction(selected)} />}
            </div>

            {selected ? (
              <ReviewPacket
                key={selectedId ?? 'none'}
                row={selected}
                controlNote={controlNote}
                onControl={handleControl}
              />
            ) : (
              <div className="px-5 py-6 text-sm text-ink-subtle">Select a case to view its review packet.</div>
            )}
          </section>
        </div>
      )}

      {/* 4. Governance + data positioning notes */}
      <div role="note" className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <span className="font-semibold">Governance:</span> {GOVERNANCE_NOTE}
      </div>
      <div role="note" className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-ink-muted">
        <span className="font-semibold text-navy-900">Data positioning:</span> {POSITIONING_NOTE}
      </div>
    </div>
  )
}

/**
 * Build the AI review packet request from the case row, the deterministic
 * context, and the linked operational records (patrol logs, ticket records,
 * trend, closure template, readiness) retrieved by the workspace. The records
 * ground the server-side draft; `ctx` may be null while loading or on error.
 */
function buildPacketRequest(
  row: StatisticalCaseScore,
  rules: Rule[],
  action: WorkflowAction,
  checks: Check[],
  ctx: CaseOperationalContext | null,
): AiReviewPacketRequest {
  return {
    caseSnapshot: {
      source_record_id: row.source_record_id,
      complaint_type: row.complaint_type,
      // The statistical attention queue view carries no free-text description;
      // the address/location is the closest available context. Handled safely
      // so the backend never receives an undefined field.
      description: row.address_or_location,
      ward_or_area: row.ward_or_area,
      status: row.status,
      assigned_department: row.assigned_department,
    },
    // The backend AI Review Packet function still expects the `mlSignal` key for
    // type compatibility; we feed it the statistical attention values. No ML
    // wording is surfaced in the UI.
    mlSignal: {
      needs_attention_score: row.attention_score,
      attention_tier: row.attention_tier,
      attention_rank: row.attention_rank,
    },
    deterministic: {
      rulesFired: rules.map((r) => `${r.label}: ${r.detail}`),
      recommendedAction: action,
      missingInformationChecklist: checks.map((c) => ({
        label: c.label,
        status: c.ok ? 'OK' : 'Needs review',
      })),
    },
    operationalContext: ctx
      ? {
          patrolLogs: ctx.patrolLogs.map((l) => ({
            patrol_date: l.patrol_date,
            officer_unit: l.officer_unit,
            patrol_type: l.patrol_type,
            observed_issue: l.observed_issue,
            observation_result: l.observation_result,
          })),
          ticketRecords: ctx.ticketRecords.map((t) => ({
            ticket_number: t.ticket_number,
            ticket_date: t.ticket_date,
            enforcement_type: t.enforcement_type,
            violation_category: t.violation_category,
            outcome: t.outcome,
            fine_amount: t.fine_amount,
            status: t.status,
          })),
          complaintTrend: ctx.trend
            ? {
                area: ctx.trend.area,
                complaint_type: ctx.trend.complaint_type,
                period_start: ctx.trend.period_start,
                period_end: ctx.trend.period_end,
                complaint_count: ctx.trend.complaint_count,
                prior_period_count: ctx.trend.prior_period_count,
                change_percent: ctx.trend.change_percent,
                repeat_location_count: ctx.trend.repeat_location_count,
                trend_label: ctx.trend.trend_label,
              }
            : null,
          closureScenario: ctx.scenario,
          closureTemplate: ctx.template
            ? {
                complaint_type: ctx.template.complaint_type,
                scenario: ctx.template.scenario,
                template_text: ctx.template.template_text,
                required_context: ctx.template.required_context,
                policy_note: ctx.template.policy_note,
              }
            : null,
          closureReadiness: ctx.readiness.map((r) => ({
            label: r.label,
            status: r.ok ? 'Ready' : 'Not ready',
          })),
        }
      : undefined,
  }
}

type AiState = 'idle' | 'loading' | 'success' | 'error'

function ReviewPacket({
  row,
  controlNote,
  onControl,
}: {
  row: StatisticalCaseScore
  controlNote: string | null
  onControl: (label: string) => void
}) {
  const tier = tierOf(row)
  const rules = rulesFor(row)
  const checks = checklistFor(row)
  const action = recommendedAction(row)

  // Linked operational records for this case: patrol logs + ticket records
  // (synthetic POC, by case_id), benchmark-derived complaint trend, derived
  // closure scenario, matched closure template, and the closure readiness
  // checklist. Loaded once per selected case (this component remounts via key).
  const [ctx, setCtx] = useState<CaseOperationalContext | null>(null)
  const [ctxState, setCtxState] = useState<'loading' | 'success' | 'error'>('loading')
  const [ctxError, setCtxError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getCaseOperationalContext({
      caseId: row.source_record_id,
      area: row.ward_or_area,
      complaintType: row.complaint_type,
      status: row.status,
      // The statistical attention queue view carries no free-text description;
      // pass null so scenario / readiness derivation handles it safely.
      description: null,
    })
      .then((data) => {
        if (!active) return
        setCtx(data)
        setCtxState('success')
      })
      .catch((err: unknown) => {
        if (!active) return
        setCtxError(err instanceof Error ? err.message : String(err))
        setCtxState('error')
      })
    return () => {
      active = false
    }
    // The component is remounted per case via key, so this runs once per case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // AI Assisted Review Packet state. This component is remounted per selected
  // case (via key), so the AI draft never leaks across cases.
  const [aiState, setAiState] = useState<AiState>('idle')
  const [aiPacket, setAiPacket] = useState<AiReviewPacketResponse | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  async function handleGenerate() {
    setAiState('loading')
    setAiError(null)
    try {
      const packet = await generateAiReviewPacket(buildPacketRequest(row, rules, action, checks, ctx))
      setAiPacket(packet)
      setAiState('success')
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err))
      setAiState('error')
    }
  }

  const generateLabel =
    aiState === 'loading'
      ? 'Generating packet…'
      : aiState === 'success'
        ? 'Regenerate AI Review Packet'
        : 'Generate AI Review Packet'

  // Once an AI packet is generated, the deterministic sections E/F/G stay
  // visible but are relabeled as the fallback baseline so they don't read as a
  // duplicate of the AI draft.
  const hasAiPacket = aiState === 'success' && aiPacket != null

  return (
    <div className="divide-y divide-slate-100">
      {/* Case file opened banner — makes it obvious that clicking the queue tile
          changed the active workspace to this case. */}
      <div className="flex items-center gap-2 bg-accent-50/60 px-5 py-2.5 text-xs font-semibold text-accent-700">
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-accent-500" />
        Case file opened
        <span className="font-normal text-ink-subtle">· {row.complaint_type || 'Uncategorized'}</span>
      </div>

      {/* AI generation control — prominent but governed. Near the top of the panel. */}
      <div className="bg-slate-50/60 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn-accent text-sm"
            onClick={handleGenerate}
            disabled={aiState === 'loading' || ctxState === 'loading'}
            aria-busy={aiState === 'loading'}
          >
            {aiState === 'loading' && (
              <span aria-hidden className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            )}
            {generateLabel}
          </button>
          <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-ink-muted">
            Draft only · Staff approval required
          </span>
        </div>
        <p className="mt-2 text-[11px] text-ink-subtle">
          {ctxState === 'loading'
            ? 'Gathering linked patrol logs, ticket records, and trend context…'
            : 'AI prepares a draft only, grounded in the linked records below. Staff approval is required before any action.'}
        </p>
        {aiState === 'error' && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            <span className="font-semibold">AI review packet unavailable.</span> {aiError} The deterministic packet
            below remains available for staff review.
          </div>
        )}
      </div>

      {/* Ask this case — lightweight agentic chat scoped to the selected case.
          Sits just below the AI packet button. State is local and resets with the
          ReviewPacket remount (key={selectedId}). */}
      <AskThisCase row={row} rules={rules} action={action} checks={checks} ctx={ctx} />

      {/* A. Case Snapshot */}
      <PacketSection letter="A" title="Case Snapshot">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Complaint type" value={row.complaint_type} />
          <Field label="Assigned department" value={row.assigned_department} />
          <Field label="Status" value={row.status} />
          <Field label="Borough or area" value={row.ward_or_area} />
          <div className="sm:col-span-2">
            <Field label="Address or location" value={row.address_or_location} />
          </div>
        </dl>
      </PacketSection>

      {/* B. Review Attention Signal */}
      <PacketSection letter="B" title="Review Attention Signal">
        <div className="grid grid-cols-3 gap-3">
          <MiniStat label="Tier" value={tier} />
          <MiniStat
            label="Score"
            value={row.attention_score == null ? '—' : row.attention_score.toFixed(3)}
          />
          <MiniStat label="Rank" value={row.attention_rank == null ? '—' : `#${row.attention_rank}`} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          <span className="font-medium text-navy-900">Higher</span> = review first ·{' '}
          <span className="font-medium text-navy-900">Medium</span> = normal queue review ·{' '}
          <span className="font-medium text-navy-900">Lower</span> = lower queue pressure.
        </p>
      </PacketSection>

      {/* C–G. Linked operational records: patrol logs, ticket records, trend
          context, closure readiness, matched closure template. Loaded per case
          from Supabase (read only). Patrol/ticket/template records are clearly
          labelled synthetic POC operational context linked to the real
          benchmark case id; the trend is benchmark derived. */}
      {ctxState === 'loading' ? (
        <div className="px-5 py-4 text-sm text-ink-subtle">Loading linked operational records…</div>
      ) : ctxState === 'error' ? (
        <div className="px-5 py-4">
          <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <span className="font-semibold">Linked operational records unavailable.</span> {ctxError} The
            deterministic packet below remains available for staff review.
          </div>
        </div>
      ) : ctx ? (
        <>
          <PacketSection letter="C" title="Related Patrol Logs" badge="Synthetic POC records">
            {ctx.patrolLogs.length ? (
              <ul className="space-y-2">
                {ctx.patrolLogs.map((log) => (
                  <li key={log.id} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-subtle">
                      <span className="font-semibold text-navy-900">{log.patrol_type || 'Patrol'}</span>
                      <span aria-hidden>·</span>
                      <span>{log.patrol_date || 'Date not recorded'}</span>
                      <span aria-hidden>·</span>
                      <span>{log.officer_unit || 'Unit not recorded'}</span>
                    </div>
                    <p className="mt-1 text-sm text-navy-900">
                      {log.observed_issue || 'No observed issue recorded.'}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      Result: <span className="font-medium text-navy-900">{log.observation_result || 'Not recorded'}</span>
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-subtle italic">No linked patrol logs on file for this case.</p>
            )}
            <p className="mt-2 text-[10px] text-ink-subtle">{SYNTHETIC_CONTEXT_LABEL}</p>
          </PacketSection>

          <PacketSection letter="D" title="Related Ticket Records" badge="Synthetic POC records">
            {ctx.ticketRecords.length ? (
              <ul className="space-y-2">
                {ctx.ticketRecords.map((t) => (
                  <li key={t.id} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-subtle">
                      <span className="font-semibold text-navy-900">{t.ticket_number || 'Ticket'}</span>
                      <span aria-hidden>·</span>
                      <span>{t.ticket_date || 'Date not recorded'}</span>
                      <span aria-hidden>·</span>
                      <span>{t.status || 'Status not recorded'}</span>
                    </div>
                    <p className="mt-1 text-sm text-navy-900">
                      {t.enforcement_type || 'Enforcement'} — {t.violation_category || 'category not recorded'}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      Outcome: <span className="font-medium text-navy-900">{t.outcome || 'Not recorded'}</span>
                      {t.fine_amount != null && t.fine_amount > 0 && (
                        <span> · Fine ${t.fine_amount.toFixed(0)} (staff view only — never shared with residents)</span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-subtle italic">No linked ticket records on file for this case.</p>
            )}
            <p className="mt-2 text-[10px] text-ink-subtle">{SYNTHETIC_CONTEXT_LABEL}</p>
          </PacketSection>

          <PacketSection letter="E" title="Complaint Trend Context" badge="Benchmark derived">
            {ctx.trend ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <MiniStat label="This period" value={String(ctx.trend.complaint_count)} />
                  <MiniStat label="Prior period" value={String(ctx.trend.prior_period_count)} />
                  <MiniStat
                    label="Change"
                    value={ctx.trend.change_percent == null ? 'New' : `${ctx.trend.change_percent > 0 ? '+' : ''}${ctx.trend.change_percent}%`}
                  />
                  <MiniStat label="Repeat locations" value={String(ctx.trend.repeat_location_count)} />
                </div>
                <p className="mt-3 text-xs leading-relaxed text-ink-muted">
                  <span className="font-medium text-navy-900">{ctx.trend.trend_label || 'Trend'}</span>
                  {' — '}
                  {ctx.trend.complaint_type || 'this complaint type'} in {ctx.trend.area || 'the recorded area'}
                  {ctx.trend.period_start && ctx.trend.period_end && (
                    <span>
                      {' '}({ctx.trend.period_start} to {ctx.trend.period_end} vs the prior period)
                    </span>
                  )}
                  . Area context only — implies no outcome for this case.
                </p>
              </>
            ) : (
              <p className="text-sm text-ink-subtle italic">
                No benchmark trend row matched this area and complaint type.
              </p>
            )}
            <p className="mt-2 text-[10px] text-ink-subtle">{TREND_CONTEXT_LABEL}</p>
          </PacketSection>

          <PacketSection letter="F" title="Closure Readiness Checklist">
            <p className="mb-2 text-xs text-ink-subtle">
              {ctx.readiness.filter((r) => r.ok).length} of {ctx.readiness.length} checks ready · advisory only —
              staff decide every closure.
            </p>
            <ul className="space-y-1.5">
              {ctx.readiness.map((item) => (
                <li key={item.label} className="flex items-start justify-between gap-2 text-sm">
                  <span>
                    <span className="text-navy-900">{item.label}</span>
                    <span className="block text-xs text-ink-subtle">{item.detail}</span>
                  </span>
                  {item.ok ? (
                    <span className="inline-flex shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                      Ready
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                      Not ready
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </PacketSection>

          <PacketSection letter="G" title="Matched Closure Template" badge="Synthetic POC template">
            {ctx.template ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex rounded-full bg-accent-100 px-2.5 py-1 font-semibold text-accent-700">
                    {SCENARIO_LABELS[ctx.scenario as ClosureScenario] ?? ctx.scenario}
                  </span>
                  <span className="text-ink-subtle">
                    Matched for {ctx.template.complaint_type === 'Any' ? 'any complaint type' : ctx.template.complaint_type}
                  </span>
                </div>
                <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm leading-relaxed text-navy-900">
                  {ctx.template.template_text}
                </p>
                {ctx.template.policy_note && (
                  <p className="mt-2 text-xs text-amber-900">
                    <span className="font-semibold">Policy note:</span> {ctx.template.policy_note}
                  </p>
                )}
                {ctx.template.required_context.length > 0 && (
                  <p className="mt-1.5 text-[11px] text-ink-subtle">
                    Required on file: {ctx.template.required_context.join(', ').replace(/_/g, ' ')}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-ink-subtle italic">
                No active closure template matched the derived scenario (
                {SCENARIO_LABELS[ctx.scenario as ClosureScenario] ?? ctx.scenario}).
              </p>
            )}
          </PacketSection>
        </>
      ) : null}

      {/* H. Rules Fired */}
      <PacketSection letter="H" title="Rules Fired">
        <ul className="space-y-2">
          {rules.map((r) => (
            <li key={r.label} className="flex gap-2 text-sm">
              <span aria-hidden className="mt-0.5 text-accent-600">•</span>
              <span>
                <span className="font-medium text-navy-900">{r.label}</span>
                <span className="text-ink-subtle"> — {r.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </PacketSection>

      {/* I. Recommended Workflow Action */}
      <PacketSection letter="I" title="Recommended Workflow Action">
        <div className="flex items-center gap-3">
          <ActionChip action={action} />
          <span className="text-xs text-ink-subtle">Deterministic suggestion — staff confirm or override.</span>
        </div>
      </PacketSection>

      {/* AI Assisted Review Packet — only after generation. Sits above the
          deterministic drafts, which remain the governance baseline. */}
      {aiState === 'success' && aiPacket && <AiPacketSection packet={aiPacket} />}

      {/* Agent workflow trace — compact, collapsed proof of the agentic steps
          (goal, plan, tools used, similar cases found). Shown only after an AI
          packet exists, kept subtle so it does not clutter the demo. */}
      {aiState === 'success' && aiPacket?.agentTrace && (
        <AgentTraceSection trace={aiPacket.agentTrace} />
      )}

      {/* J. Missing Information Checklist — relabeled as baseline when an AI packet exists. */}
      <PacketSection letter="J" title={hasAiPacket ? 'Baseline checklist' : 'Missing Information Checklist'}>
        <ul className="space-y-1.5">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-navy-900">{c.label}</span>
              {c.ok ? (
                <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                  OK
                </span>
              ) : (
                <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                  Needs review
                </span>
              )}
            </li>
          ))}
        </ul>
      </PacketSection>

      {/* K. Draft Staff Summary — relabeled as baseline when an AI packet exists. */}
      <PacketSection letter="K" title={hasAiPacket ? 'Baseline staff summary' : 'Draft Staff Summary'}>
        <DraftBlock text={draftStaffSummary(row)} />
      </PacketSection>

      {/* L. Draft Resident Update or Closure Language — relabeled as baseline when an AI packet exists. */}
      <PacketSection letter="L" title={hasAiPacket ? 'Baseline resident update' : 'Draft Resident Update or Closure Language'}>
        <DraftBlock text={draftResidentLanguage(row)} />
      </PacketSection>

      {/* M. Human Review Controls */}
      <PacketSection letter="M" title="Human Review Controls">
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary text-sm" onClick={() => onControl('Approve Draft')}>
            Approve Draft
          </button>
          <button className="btn-secondary text-sm" onClick={() => onControl('Edit Draft')}>
            Edit Draft
          </button>
          <button className="btn-secondary text-sm" onClick={() => onControl('Request Follow Up')}>
            Request Follow Up
          </button>
          <button className="btn-secondary text-sm" onClick={() => onControl('Escalate to Supervisor')}>
            Escalate to Supervisor
          </button>
        </div>
        {controlNote && (
          <div
            role="status"
            className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-ink-muted"
          >
            {controlNote}
          </div>
        )}
        <p className="mt-2 text-[11px] text-ink-subtle">
          POC mode: no action is submitted. Staff approval would be logged in a production workflow.
        </p>
      </PacketSection>
    </div>
  )
}

// Starter prompts that map a friendly chip label to the question text sent to
// the assistant. Kept short so the panel does not read like a full chatbot.
const ASK_STARTERS: Array<{ chip: string; question: string }> = [
  { chip: 'What is missing?', question: 'What information is missing for this case?' },
  { chip: 'Why follow up?', question: 'Why is this case recommended for follow up?' },
  { chip: 'Draft shorter update', question: 'Draft a shorter resident update for this case.' },
  { chip: 'What should staff verify first?', question: 'What should staff verify first on this case?' },
]

type AskState = 'idle' | 'loading' | 'success' | 'error'

/**
 * "Ask this case" — a compact agentic assistant scoped to the selected case.
 * Staff type or pick a question; the backend answers using only the selected
 * case context, deterministic rules, and the Review Attention Score. Draft
 * guidance only — nothing is submitted, written, or acted on. State resets
 * with the ReviewPacket remount (key={selectedId}).
 */
function AskThisCase({
  row,
  rules,
  action,
  checks,
  ctx,
}: {
  row: StatisticalCaseScore
  rules: Rule[]
  action: WorkflowAction
  checks: Check[]
  ctx: CaseOperationalContext | null
}) {
  const [question, setQuestion] = useState('')
  const [state, setState] = useState<AskState>('idle')
  const [response, setResponse] = useState<AskCaseAgentResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function ask(q: string) {
    const trimmed = q.trim()
    if (!trimmed || state === 'loading') return
    setQuestion(trimmed)
    setState('loading')
    setError(null)
    try {
      const res = await askCaseAgent({ ...buildPacketRequest(row, rules, action, checks, ctx), question: trimmed })
      setResponse(res)
      setState('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState('error')
    }
  }

  return (
    <section className="px-5 py-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-navy-900">
        <span className="inline-flex h-5 items-center justify-center rounded-md bg-accent-100 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent-700">
          Ask
        </span>
        Ask this case
      </h3>
      <p className="mt-1 text-[11px] text-ink-subtle">
        Ask about the selected case. Answers use the case context, rules, and Review Attention Score only.
      </p>

      {/* Starter chips */}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {ASK_STARTERS.map((s) => (
          <button
            key={s.chip}
            type="button"
            onClick={() => ask(s.question)}
            disabled={state === 'loading'}
            className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-ink-muted transition hover:border-accent-300 hover:text-navy-900 disabled:opacity-50"
          >
            {s.chip}
          </button>
        ))}
      </div>

      {/* Input + Ask */}
      <form
        className="mt-2.5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          ask(question)
        }}
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about this selected case..."
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-900 placeholder:text-ink-subtle focus:border-accent-400 focus:outline-none focus:ring-2 focus:ring-accent-100"
        />
        <button
          type="submit"
          className="btn-accent text-sm"
          disabled={state === 'loading' || !question.trim()}
          aria-busy={state === 'loading'}
        >
          {state === 'loading' && (
            <span aria-hidden className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          )}
          Ask
        </button>
      </form>

      {state === 'error' && (
        <div role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="font-semibold">Assistant unavailable.</span> {error}
        </div>
      )}

      {state === 'success' && response && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Assistant answer</div>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-navy-900">{response.answer}</p>

          {/* Compact, collapsed agent trace — proof of the agentic steps. */}
          <details className="group mt-2.5 rounded-lg border border-slate-200 bg-slate-50/60">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] font-semibold text-ink-muted">
              <span className="flex items-center gap-1.5">
                <span className="inline-flex h-4 items-center justify-center rounded bg-slate-200 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-ink-muted">
                  Agent
                </span>
                Agent trace · {response.agentTrace.toolsUsed.length} context source
                {response.agentTrace.toolsUsed.length === 1 ? '' : 's'}
              </span>
              <span aria-hidden className="text-ink-subtle transition group-open:rotate-180">▾</span>
            </summary>
            <div className="space-y-2 border-t border-slate-200 px-2.5 py-2 text-[11px]">
              <div>
                <div className="font-semibold uppercase tracking-wider text-ink-subtle text-[10px]">Goal</div>
                <p className="mt-0.5 text-navy-900">{response.agentTrace.goal}</p>
              </div>
              <div>
                <div className="font-semibold uppercase tracking-wider text-ink-subtle text-[10px]">Plan</div>
                <ol className="mt-0.5 list-decimal space-y-0.5 pl-4 text-navy-900">
                  {response.agentTrace.plan.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
              <div>
                <div className="font-semibold uppercase tracking-wider text-ink-subtle text-[10px]">Context used</div>
                <ul className="mt-0.5 space-y-0.5 text-navy-900">
                  {response.agentTrace.toolsUsed.map((t, i) => (
                    <li key={i} className="font-mono text-[10px]">{t}</li>
                  ))}
                </ul>
              </div>
            </div>
          </details>

          <p className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            <span className="font-semibold">Draft only · Staff approval required · No action submitted.</span>{' '}
            Assistant response is draft guidance only. Staff must review before taking action.
          </p>
        </div>
      )}
    </section>
  )
}

/**
 * AI Assisted Review Packet — the generated draft, shown only after a staff
 * click. Premium card styling consistent with the deterministic packet. Every
 * sub-block is a draft for staff review; nothing here is an action.
 */
function AiPacketSection({ packet }: { packet: AiReviewPacketResponse }) {
  return (
    <section className="bg-accent-50/40 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-navy-900">
          <span className="inline-flex h-5 items-center justify-center rounded-md bg-accent-100 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent-700">
            AI
          </span>
          AI Assisted Review Packet
        </h3>
        <span className="inline-flex rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-ink-muted ring-1 ring-inset ring-slate-200">
          Draft only · No action submitted
        </span>
      </div>

      <div className="mt-3 space-y-3">
        <AiBlock title="Staff summary" text={packet.staffSummary} />
        <AiBlock title="Recommended next step" text={packet.recommendedNextStep} />
        <AiListBlock title="Missing information notes" items={packet.missingInformationNotes} emptyText="No missing information noted." />
        <AiBlock title="Resident update draft" text={packet.residentUpdateDraft} />
        {packet.closureLanguage && <AiBlock title="Closure language" text={packet.closureLanguage} />}
        <AiListBlock
          title="Review Flags"
          items={packet.supervisorFlags}
          emptyText="No review flags raised."
          tone="amber"
        />
        <AiBlock title="Plain English reason" text={packet.plainEnglishReason} />
      </div>

      <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
        <span className="font-semibold">Staff approval required:</span>{' '}
        {packet.advisory || 'AI prepares a draft only. Staff review and approval are required before any action.'}
      </p>
    </section>
  )
}

/**
 * Agent workflow trace — a subtle, collapsed section that proves the agentic
 * behavior behind the AI packet: the goal it pursued, the short plan it
 * followed, the read-only tool(s) it used, and how many similar cases it
 * retrieved for context. Read-only and informational; nothing here is an action.
 */
function AgentTraceSection({ trace }: { trace: AgentTrace }) {
  return (
    <section className="px-5 py-3">
      <details className="group rounded-lg border border-slate-200 bg-slate-50/60">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-ink-muted">
          <span className="flex items-center gap-2">
            <span className="inline-flex h-4 items-center justify-center rounded bg-slate-200 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-ink-muted">
              Agent
            </span>
            Agent workflow trace
            <span className="font-normal text-ink-subtle">
              · {trace.toolsUsed.length} tool{trace.toolsUsed.length === 1 ? '' : 's'} · {trace.similarCasesFound}{' '}
              similar case{trace.similarCasesFound === 1 ? '' : 's'}
            </span>
          </span>
          <span aria-hidden className="text-ink-subtle transition group-open:rotate-180">▾</span>
        </summary>

        <div className="space-y-3 border-t border-slate-200 px-3 py-3 text-xs">
          <div>
            <div className="font-semibold uppercase tracking-wider text-ink-subtle text-[10px]">Goal</div>
            <p className="mt-0.5 text-navy-900">{trace.goal}</p>
          </div>

          <div>
            <div className="font-semibold uppercase tracking-wider text-ink-subtle text-[10px]">Plan</div>
            <ol className="mt-0.5 list-decimal space-y-0.5 pl-4 text-navy-900">
              {trace.plan.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="font-semibold uppercase tracking-wider text-ink-subtle text-[10px]">Tools used</div>
              {trace.toolsUsed.length ? (
                <ul className="mt-0.5 space-y-0.5 text-navy-900">
                  {trace.toolsUsed.map((t, i) => (
                    <li key={i} className="font-mono text-[11px]">{t}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-0.5 text-ink-subtle italic">None used.</p>
              )}
            </div>
            <div>
              <div className="font-semibold uppercase tracking-wider text-ink-subtle text-[10px]">
                Similar cases found
              </div>
              <p className="mt-0.5 tabular-nums text-navy-900">{trace.similarCasesFound}</p>
            </div>
          </div>

          {trace.notes.length > 0 && (
            <div>
              <div className="font-semibold uppercase tracking-wider text-ink-subtle text-[10px]">Notes</div>
              <ul className="mt-0.5 space-y-0.5 text-ink-muted">
                {trace.notes.map((n, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span aria-hidden className="text-ink-subtle">·</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[10px] text-ink-subtle">
            Context only. Similar cases are public benchmark data and imply no outcome for this case. Read only — no
            data was written and no action was taken.
          </p>
        </div>
      </details>
    </section>
  )
}

function AiBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{title}</div>
      <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-navy-900">
        {text?.trim() || <span className="text-ink-subtle italic">Not provided.</span>}
      </p>
    </div>
  )
}

function AiListBlock({
  title,
  items,
  emptyText,
  tone = 'default',
}: {
  title: string
  items: string[]
  emptyText: string
  tone?: 'default' | 'amber'
}) {
  const bullet = tone === 'amber' ? 'text-amber-600' : 'text-accent-600'
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{title}</div>
      {items.length ? (
        <ul className="mt-1 space-y-1">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2 text-sm text-navy-900">
              <span aria-hidden className={`mt-0.5 ${bullet}`}>•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-ink-subtle italic">{emptyText}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small presentational helpers (match the existing app design system)
// ---------------------------------------------------------------------------

function rowKey(row: StatisticalCaseScore, index: number): string {
  return row.source_record_id ?? `row-${index}`
}

function PacketSection({
  letter,
  title,
  badge,
  children,
}: {
  letter: string
  title: string
  badge?: string
  children: React.ReactNode
}) {
  return (
    <section className="px-5 py-4">
      <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-navy-900">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 text-[11px] font-semibold text-ink-muted">
          {letter}
        </span>
        {title}
        {badge && (
          <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
            {badge}
          </span>
        )}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Field({ label, value }: { label: string; value: string | null }) {
  const text = (value ?? '').trim()
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm ${text ? 'text-navy-900' : 'text-ink-subtle italic'}`}>
        {text || 'Not recorded'}
      </dd>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-center">
      <div className="text-lg font-semibold text-navy-900 tabular-nums">{value}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</div>
    </div>
  )
}

function DraftBlock({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm leading-relaxed text-navy-900">
      {text}
    </p>
  )
}

function SummaryCard({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number | string
  tone?: 'default' | 'amber' | 'emerald'
}) {
  const valueColor =
    tone === 'amber' ? 'text-amber-800' : tone === 'emerald' ? 'text-emerald-800' : 'text-navy-900'
  const isNumeric = typeof value === 'number'
  return (
    <div className="card p-4">
      <div className="stat-label">{label}</div>
      <div className={`mt-1 font-semibold ${isNumeric ? 'text-2xl tabular-nums' : 'text-xl'} ${valueColor}`}>
        {value}
      </div>
    </div>
  )
}

function Pill({ children, tone }: { children: React.ReactNode; tone: 'emerald' | 'navy' }) {
  const styles =
    tone === 'emerald'
      ? 'bg-emerald-50 text-emerald-800'
      : 'bg-slate-100 text-navy-900'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${styles}`}>
      {tone === 'emerald' && <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />}
      {children}
    </span>
  )
}

function AttentionChip({ tier }: { tier: string | null }) {
  const t = tier ?? '—'
  const styles: Record<string, string> = {
    Higher: 'bg-amber-100 text-amber-800',
    Medium: 'bg-slate-100 text-slate-700',
    Lower: 'bg-slate-50 text-ink-subtle',
  }
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles[t] ?? 'bg-slate-50 text-ink-subtle'}`}>
      {t}
    </span>
  )
}

function ActionChip({ action }: { action: WorkflowAction }) {
  const styles: Record<WorkflowAction, string> = {
    'Review First': 'bg-amber-100 text-amber-800',
    'Supervisor Review': 'bg-orange-50 text-orange-800 ring-1 ring-inset ring-orange-200',
    'Closure Candidate': 'bg-emerald-50 text-emerald-800',
    'Needs Follow Up': 'bg-slate-100 text-slate-700',
  }
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${styles[action]}`}>
      {action}
    </span>
  )
}
