import { useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured } from '../../lib/supabase'
import {
  getClosureReviewCases,
  type WorkflowMlPrediction,
} from '../../services/municipalServiceRequests'
import {
  generateAiReviewPacket,
  type AgentTrace,
  type AiReviewPacketRequest,
  type AiReviewPacketResponse,
} from '../../services/aiReviewPacket'

// Closure Review Workflow — turns the V2 "Needs Attention" model output into a
// staff review + closure workflow. Cases are read live from Supabase
// (public.workflow_ml_predictions, needs_attention slice). Everything below the
// fetch is DETERMINISTIC and client-side: rules, recommended action, missing-info
// checklist and draft language are computed from the loaded row — no LLM call and
// no Supabase write. The human-review controls are POC-only UI; in production a
// staff approval would be logged. Routing fields (predicted_department) are
// intentionally not part of the workflow surface.

const GOVERNANCE_NOTE =
  'This workflow does not make enforcement decisions, close files automatically, or contact residents without staff approval. It prepares a review packet for municipal staff.'

const SAFETY_KEYWORDS = ['emergency', 'hazard', 'unsafe', 'blocked', 'broken']
const SUPERVISOR_KEYWORDS = ['repeat', 'unsafe', 'hazard', 'blocked', 'emergency', 'urgent']
const SHORT_DESCRIPTION_LEN = 25

type Tier = 'Higher' | 'Medium' | 'Lower' | 'Unknown'
type WorkflowAction = 'Review First' | 'Needs Follow Up' | 'Closure Candidate' | 'Supervisor Review'

function tierOf(row: WorkflowMlPrediction): Tier {
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

function descMissingOrShort(row: WorkflowMlPrediction): boolean {
  const d = (row.description ?? '').trim()
  return d.length < SHORT_DESCRIPTION_LEN
}

function includesAny(haystack: string, words: string[]): boolean {
  const h = haystack.toLowerCase()
  return words.some((w) => h.includes(w))
}

/** Deterministic client-side rules fired from the available fields. */
type Rule = { label: string; detail: string }

function rulesFor(row: WorkflowMlPrediction): Rule[] {
  const rules: Rule[] = []
  const tier = tierOf(row)
  const typeAndDesc = `${row.complaint_type ?? ''} ${row.description ?? ''}`

  if (isOpenStatus(row.status)) {
    rules.push({ label: 'Open case review required', detail: 'Status is New or In Progress.' })
  }
  if (tier === 'Higher') {
    rules.push({ label: 'Prioritize staff review', detail: 'Attention tier is Higher.' })
  }
  if (descMissingOrShort(row)) {
    rules.push({ label: 'Missing information check', detail: 'Description is missing or very short.' })
  }
  if (includesAny(typeAndDesc, SAFETY_KEYWORDS)) {
    rules.push({
      label: 'Safety wording check',
      detail: 'Complaint text mentions emergency / hazard / unsafe / blocked / broken.',
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
function recommendedAction(row: WorkflowMlPrediction): WorkflowAction {
  const tier = tierOf(row)
  const typeAndDesc = `${row.complaint_type ?? ''} ${row.description ?? ''}`

  if (tier === 'Higher' && includesAny(typeAndDesc, SUPERVISOR_KEYWORDS)) return 'Supervisor Review'
  if (tier === 'Higher' && isOpenStatus(row.status)) return 'Review First'
  if (descMissingOrShort(row)) return 'Needs Follow Up'
  if (isClosedStatus(row.status) && tier === 'Lower') return 'Closure Candidate'
  return 'Needs Follow Up'
}

type Check = { label: string; ok: boolean }

function checklistFor(row: WorkflowMlPrediction): Check[] {
  return [
    { label: 'Location context present', ok: Boolean((row.ward_or_area ?? '').trim()) },
    { label: 'Description present', ok: Boolean((row.description ?? '').trim()) },
    { label: 'Assigned department present', ok: Boolean((row.assigned_department ?? '').trim()) },
    { label: 'Status present', ok: Boolean((row.status ?? '').trim()) },
    { label: 'Complaint type present', ok: Boolean((row.complaint_type ?? '').trim()) },
  ]
}

function draftStaffSummary(row: WorkflowMlPrediction): string {
  const type = row.complaint_type || 'an unspecified complaint type'
  const dept = row.assigned_department || 'no assigned department'
  const status = row.status || 'an unknown status'
  const tier = tierOf(row)
  return (
    `This complaint relates to ${type} and is currently assigned to ${dept}. ` +
    `The file is marked ${status} and appears in the ${tier} attention tier based on queue attention signals. ` +
    `Staff should review the case details, confirm whether any information is missing, and determine whether the ` +
    `file is ready for follow up or closure.`
  )
}

function draftResidentLanguage(row: WorkflowMlPrediction): string {
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
  const [rows, setRows] = useState<WorkflowMlPrediction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [controlNote, setControlNote] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!isSupabaseConfigured) {
      setError('Supabase is not configured in this environment.')
      setLoading(false)
      return
    }
    getClosureReviewCases(60)
      .then((data) => {
        if (!active) return
        setRows(data)
        if (data.length) setSelectedId(rowKey(data[0], 0))
      })
      .catch((err: unknown) => active && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

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
    setControlNote(`${label} — POC mode: no action was submitted to Supabase.`)
  }

  // Selecting a case resets the per-case control note. The AI generated packet
  // state lives inside ReviewPacket, which is remounted via its `key={selectedId}`,
  // so the AI draft is cleared automatically on selection.
  function handleSelect(key: string) {
    setSelectedId(key)
    setControlNote(null)
  }

  return (
    <div className="container-page py-10">
      {/* 1. Header */}
      <div className="section-eyebrow">Closure Review</div>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-navy-900">
            Closure Review Workflow
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-ink-muted">
            Use rules, Needs Attention signals, and staff review packets to accelerate complaint resolution without
            automated enforcement.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone="emerald">Live Supabase</Pill>
          <Pill tone="navy">Human approval required</Pill>
        </div>
      </div>

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
          <div className="font-semibold text-navy-900">Cases unavailable from Supabase.</div>
          <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-xs text-ink-subtle">{error}</pre>
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-6 card px-5 py-6 text-sm text-ink-subtle">No workflow ML predictions found.</div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          {/* Left — case queue */}
          <section className="card overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-navy-900">Case queue</h2>
              <p className="text-xs text-ink-subtle">
                Ordered by Needs Attention score (highest first). {rows.length} cases loaded.
              </p>
            </div>
            <ul className="max-h-[640px] divide-y divide-slate-100 overflow-y-auto">
              {rows.map((r, i) => {
                const key = rowKey(r, i)
                const isSelected = key === selectedId
                return (
                  <li key={key}>
                    <button
                      onClick={() => handleSelect(key)}
                      aria-current={isSelected ? 'true' : undefined}
                      className={`relative block w-full border-l-4 px-4 py-3 text-left transition ${
                        isSelected
                          ? 'border-accent-500 bg-accent-50/60 ring-1 ring-inset ring-accent-200'
                          : 'border-transparent hover:bg-slate-50'
                      }`}
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
                          score {r.needs_attention_score == null ? '—' : r.needs_attention_score.toFixed(3)}
                        </span>
                      </div>
                      {r.description?.trim() && (
                        <p className="mt-1 line-clamp-1 text-xs text-ink-muted">{r.description}</p>
                      )}
                      <div
                        className={`mt-1.5 inline-flex items-center gap-1 text-xs font-semibold ${
                          isSelected ? 'text-accent-700' : 'text-accent-600'
                        }`}
                      >
                        View review packet
                        <span aria-hidden>→</span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>

          {/* Right — staff ready review packet */}
          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold text-navy-900">Staff Ready Review Packet</h2>
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
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-ink-subtle">Prepared for staff review — nothing is submitted automatically.</p>
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

      {/* 4. Governance note */}
      <div role="note" className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <span className="font-semibold">Governance:</span> {GOVERNANCE_NOTE}
      </div>
    </div>
  )
}

/** Build the AI review packet request from the case row + deterministic context. */
function buildPacketRequest(
  row: WorkflowMlPrediction,
  rules: Rule[],
  action: WorkflowAction,
  checks: Check[],
): AiReviewPacketRequest {
  return {
    caseSnapshot: {
      source_record_id: row.source_record_id,
      complaint_type: row.complaint_type,
      description: row.description,
      ward_or_area: row.ward_or_area,
      status: row.status,
      assigned_department: row.assigned_department,
    },
    mlSignal: {
      needs_attention_score: row.needs_attention_score,
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
  }
}

type AiState = 'idle' | 'loading' | 'success' | 'error'

function ReviewPacket({
  row,
  controlNote,
  onControl,
}: {
  row: WorkflowMlPrediction
  controlNote: string | null
  onControl: (label: string) => void
}) {
  const tier = tierOf(row)
  const rules = rulesFor(row)
  const checks = checklistFor(row)
  const action = recommendedAction(row)

  // AI Assisted Review Packet state. This component is remounted per selected
  // case (via key), so the AI draft never leaks across cases.
  const [aiState, setAiState] = useState<AiState>('idle')
  const [aiPacket, setAiPacket] = useState<AiReviewPacketResponse | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  async function handleGenerate() {
    setAiState('loading')
    setAiError(null)
    try {
      const packet = await generateAiReviewPacket(buildPacketRequest(row, rules, action, checks))
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
      {/* AI generation control — prominent but governed. Near the top of the panel. */}
      <div className="bg-slate-50/60 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn-accent text-sm"
            onClick={handleGenerate}
            disabled={aiState === 'loading'}
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
          AI prepares a draft only. Staff approval is required before any action.
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

      {/* A. Case Snapshot */}
      <PacketSection letter="A" title="Case Snapshot">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Complaint type" value={row.complaint_type} />
          <Field label="Assigned department" value={row.assigned_department} />
          <Field label="Status" value={row.status} />
          <Field label="Ward or area" value={row.ward_or_area} />
          <div className="sm:col-span-2">
            <Field label="Description" value={row.description} />
          </div>
        </dl>
      </PacketSection>

      {/* B. Needs Attention Signal */}
      <PacketSection letter="B" title="Needs Attention Signal">
        <div className="grid grid-cols-3 gap-3">
          <MiniStat label="Tier" value={tier} />
          <MiniStat
            label="Score"
            value={row.needs_attention_score == null ? '—' : row.needs_attention_score.toFixed(3)}
          />
          <MiniStat label="Rank" value={row.attention_rank == null ? '—' : `#${row.attention_rank}`} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          <span className="font-medium text-navy-900">Higher</span> = review first ·{' '}
          <span className="font-medium text-navy-900">Medium</span> = normal queue review ·{' '}
          <span className="font-medium text-navy-900">Lower</span> = lower queue pressure.
        </p>
      </PacketSection>

      {/* C. Rules Fired */}
      <PacketSection letter="C" title="Rules Fired">
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

      {/* D. Recommended Workflow Action */}
      <PacketSection letter="D" title="Recommended Workflow Action">
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

      {/* E. Missing Information Checklist — relabeled as baseline when an AI packet exists. */}
      <PacketSection letter="E" title={hasAiPacket ? 'Baseline checklist' : 'Missing Information Checklist'}>
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

      {/* F. Draft Staff Summary — relabeled as baseline when an AI packet exists. */}
      <PacketSection letter="F" title={hasAiPacket ? 'Baseline staff summary' : 'Draft Staff Summary'}>
        <DraftBlock text={draftStaffSummary(row)} />
      </PacketSection>

      {/* G. Draft Resident Update or Closure Language — relabeled as baseline when an AI packet exists. */}
      <PacketSection letter="G" title={hasAiPacket ? 'Baseline resident update' : 'Draft Resident Update or Closure Language'}>
        <DraftBlock text={draftResidentLanguage(row)} />
      </PacketSection>

      {/* H. Human Review Controls */}
      <PacketSection letter="H" title="Human Review Controls">
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

function rowKey(row: WorkflowMlPrediction, index: number): string {
  return row.source_record_id ?? `row-${index}`
}

function PacketSection({
  letter,
  title,
  children,
}: {
  letter: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="px-5 py-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-navy-900">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 text-[11px] font-semibold text-ink-muted">
          {letter}
        </span>
        {title}
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
      <dd className={`mt-0.5 text-sm ${text ? 'text-navy-900' : 'text-ink-subtle italic'}`}>
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
