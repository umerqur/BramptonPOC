// Mock AI workflow engine for the Proactive Enforcement Response POC demo.
//
// This service is intentionally self-contained and synchronous: it lets the
// end-to-end demo run entirely in the browser with synthetic data, without
// waiting on Supabase. Given a raw resident complaint it deterministically
// produces classification, extracted facts, a missing-information check,
// enforcement context, a case summary, a confidence score, and a closure-
// response draft — i.e. all the manual research and drafting the AI is taking
// off staff. Staff actions (approve, edit, override, request info) are applied
// on top via the workflow store.
//
// DEMO POSITIONING: every output is decision support / closure-response
// automation only. Final review remains with authorized staff. The numbers and
// records are synthetic benchmark estimates — not Brampton operational data.

import type {
  AiTriageResult,
  AuditEvent,
  CaseSummary,
  ClosureDraft,
  DemoCase,
  DemoCategory,
  EnforcementContext,
  FieldVisitOutcome,
  OfficerFieldAction,
  Priority,
  ResidentComplaintInput,
  SampleComplaint,
  SupervisorMetrics,
  WorkflowStage,
} from '../data/demoWorkflowTypes'
import { CASE_SOURCE_LABELS } from '../data/demoWorkflowTypes'

// ---------------------------------------------------------------------------
// Small deterministic helpers
// ---------------------------------------------------------------------------

let idCounter = 1000
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

export function newCaseId(): string {
  const n = Math.floor(Math.random() * 9000) + 1000
  return `BR-${new Date().getFullYear()}-${n}`
}

function auditEvent(
  actor: AuditEvent['actor'],
  type: string,
  detail: string,
  at: string,
): AuditEvent {
  const actorLabel =
    actor === 'ai'
      ? 'AI workflow system'
      : actor === 'staff'
        ? 'By-law staff'
        : actor === 'officer'
          ? 'By-law officer'
          : actor === 'resident'
            ? 'Resident'
            : 'System'
  return { id: nextId('evt'), at, actor, actorLabel, type, detail }
}

// "Hot" repeat-complaint locations used to make the duplicate / repeat-location
// signals feel real. Matching is a simple case-insensitive substring test.
const REPEAT_LOCATIONS: Record<string, number> = {
  'flowertown': 5,
  'kennedy rd': 4,
  'queen st': 3,
  'chinguacousy': 4,
  'bovaird': 3,
}

function repeatCountFor(location: string): number {
  const loc = location.toLowerCase()
  for (const key of Object.keys(REPEAT_LOCATIONS)) {
    if (loc.includes(key)) return REPEAT_LOCATIONS[key]
  }
  return 0
}

// ---------------------------------------------------------------------------
// Step 2 — Classification
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS: { category: DemoCategory; words: string[] }[] = [
  { category: 'Illegal Dumping', words: ['dump', 'dumping', 'garbage pile', 'mattress', 'debris', 'furniture left', 'waste pile'] },
  { category: 'Noise', words: ['noise', 'loud', 'music', 'party', 'barking', 'shouting', 'construction noise'] },
  { category: 'Parking', words: ['park', 'parked', 'parking', 'vehicle', 'blocking driveway', 'blocked', 'on the lawn'] },
  { category: 'Yard Maintenance', words: ['grass', 'weeds', 'overgrown', 'lawn', 'hedge', 'yard', 'lot'] },
  { category: 'Zoning', words: ['business', 'rooming', 'illegal unit', 'second unit', 'commercial', 'zoning', 'short-term rental'] },
  { category: 'Property Standards', words: ['fence', 'broken', 'peeling', 'derelict', 'graffiti', 'porch', 'roof', 'standards', 'unsafe', 'disrepair'] },
]

function classify(
  description: string,
  forced?: DemoCategory,
): { category: DemoCategory; confidence: number } {
  // When the resident already picked an explicit issue type (staff inbox bridge),
  // trust it rather than re-deriving the category from free text.
  if (forced) return { category: forced, confidence: 0.9 }
  const text = description.toLowerCase()
  let best: { category: DemoCategory; hits: number } = { category: 'Property Standards', hits: 0 }
  for (const { category, words } of CATEGORY_KEYWORDS) {
    const hits = words.reduce((n, w) => (text.includes(w) ? n + 1 : n), 0)
    if (hits > best.hits) best = { category, hits }
  }
  // Confidence scales with keyword evidence; defaults to a modest value when
  // nothing matched (so "missing info" / low confidence flows can trigger).
  const confidence = best.hits === 0 ? 0.55 : Math.min(0.98, 0.7 + best.hits * 0.12)
  return { category: best.category, confidence }
}

const DEPARTMENT_BY_CATEGORY: Record<DemoCategory, string> = {
  'Property Standards': 'Property Standards Enforcement',
  'Illegal Dumping': 'Clean City / Waste Enforcement',
  Noise: 'By-law Enforcement (Noise)',
  Parking: 'Parking Enforcement',
  'Yard Maintenance': 'Property Standards Enforcement',
  Zoning: 'Zoning & Building Compliance',
}

const PRIORITY_BY_CATEGORY: Record<DemoCategory, Priority> = {
  'Property Standards': 'P3',
  'Illegal Dumping': 'P2',
  Noise: 'P3',
  Parking: 'P4',
  'Yard Maintenance': 'P4',
  Zoning: 'P2',
}

// Categories that warrant extra caution / a mandatory human look.
const SENSITIVE_CATEGORIES: DemoCategory[] = ['Zoning', 'Property Standards']

// ---------------------------------------------------------------------------
// Step 2 — Fact extraction + missing-information check
// ---------------------------------------------------------------------------

function extractKeyFacts(input: ResidentComplaintInput, category: DemoCategory): string[] {
  const facts: string[] = []
  facts.push(`Reported issue: ${category.toLowerCase()} concern`)
  if (input.location.trim()) facts.push(`Location referenced: ${input.location.trim()}`)
  facts.push(`Submitted via ${input.channel} on ${formatDate(input.submittedAt)}`)
  if (input.hasPhoto) facts.push('Resident attached a supporting photo')
  if (/recur|again|every|repeat|ongoing|week|month|daily/i.test(input.description))
    facts.push('Resident describes an ongoing / recurring issue')
  if (/safety|danger|unsafe|hazard|child|fire/i.test(input.description))
    facts.push('Resident raised a potential safety concern')
  return facts
}

function missingInformationCheck(input: ResidentComplaintInput): string[] {
  const missing: string[] = []
  if (input.description.trim().length < 15) missing.push('Description is very brief — limited detail to act on')
  if (!input.location.trim()) missing.push('No specific location or address provided')
  if (!input.hasPhoto) missing.push('No supporting photo attached')
  if (input.contactPreference === 'No follow-up') missing.push('Resident opted out of follow-up — cannot clarify')
  return missing
}

// ---------------------------------------------------------------------------
// Step 3 — Enforcement context (the manual research the AI replaces)
// ---------------------------------------------------------------------------

const POLICY_BY_CATEGORY: Record<DemoCategory, EnforcementContext['policyMatch']> = {
  'Property Standards': { name: 'Property Standards By-law', reference: 'By-law 271-2021', summary: 'Owners must maintain property, structures, and yards in good repair and safe condition.' },
  'Illegal Dumping': { name: 'Waste & Dumping By-law', reference: 'By-law 287-2008', summary: 'Depositing waste on public or private land without authorization is prohibited.' },
  Noise: { name: 'Noise Control By-law', reference: 'By-law 93-2018', summary: 'Sets permitted noise levels and quiet hours for residential areas.' },
  Parking: { name: 'Traffic & Parking By-law', reference: 'By-law 93-93', summary: 'Restricts parking on boulevards, lawns, and obstruction of driveways.' },
  'Yard Maintenance': { name: 'Lot Maintenance By-law', reference: 'By-law 313-2005', summary: 'Grass and weeds must be kept below the maximum permitted height.' },
  Zoning: { name: 'Comprehensive Zoning By-law', reference: 'By-law 270-2004', summary: 'Regulates permitted land uses, second units, and home-based businesses.' },
}

const RESPONSE_TEMPLATE_BY_CATEGORY: Record<DemoCategory, string> = {
  'Property Standards': 'Property Standards — order to comply / re-inspection closure',
  'Illegal Dumping': 'Illegal Dumping — site cleared / investigation closure',
  Noise: 'Noise — warning issued / no further action closure',
  Parking: 'Parking — ticket issued / vehicle moved closure',
  'Yard Maintenance': 'Lot Maintenance — notice to comply closure',
  Zoning: 'Zoning — compliance review outcome closure',
}

function buildContext(input: ResidentComplaintInput, category: DemoCategory): EnforcementContext {
  const repeatLocationCount = repeatCountFor(input.location)
  const repeatLocationSignal: EnforcementContext['repeatLocationSignal'] =
    repeatLocationCount >= 4 ? 'High' : repeatLocationCount >= 2 ? 'Emerging' : 'None'

  const history =
    repeatLocationCount > 0
      ? Array.from({ length: Math.min(repeatLocationCount, 3) }).map((_, i) => ({
          caseId: `BR-2025-${4100 + i}`,
          date: formatDate(daysAgo(30 + i * 22)),
          summary: `${category} complaint at or near this location`,
          status: i === 0 ? 'Closed — resolved' : 'Closed — no action required',
        }))
      : []

  return {
    complaintHistory: history,
    patrolLogs:
      repeatLocationCount > 0
        ? [`Patrol unit logged a drive-by of this area ${repeatLocationCount} times in the last 60 days.`, 'Last officer note: area flagged for periodic monitoring.']
        : ['No recent patrol activity logged for this location.'],
    ticketRecords:
      repeatLocationCount >= 3
        ? ['1 prior ticket issued within 500m in the last 12 months.', 'No outstanding fines on record for this address.']
        : ['No tickets on record for this address.'],
    trendSummary:
      repeatLocationSignal === 'High'
        ? `${category} complaints in this area are up vs. the trailing 90-day average — possible emerging hotspot.`
        : repeatLocationSignal === 'Emerging'
          ? `${category} complaints in this area are slightly above the trailing 90-day average.`
          : `${category} complaint volume for this area is within the normal range.`,
    policyMatch: POLICY_BY_CATEGORY[category],
    similarNearbyCases:
      repeatLocationCount > 0
        ? [
            { caseId: `BR-2025-${4200}`, distance: '120 m', category, outcome: 'Closed — notice to comply met' },
            { caseId: `BR-2025-${4221}`, distance: '340 m', category, outcome: 'Closed — no violation found' },
          ]
        : [{ caseId: `BR-2025-${4250}`, distance: '1.2 km', category, outcome: 'Closed — resolved on first visit' }],
    repeatLocationCount,
    repeatLocationSignal,
  }
}

// ---------------------------------------------------------------------------
// Step 4 + 6 — Triage assembly + confidence gate
// ---------------------------------------------------------------------------

function duplicateRisk(context: EnforcementContext): AiTriageResult['duplicateRisk'] {
  if (context.repeatLocationCount >= 4) return 'Likely'
  if (context.repeatLocationCount >= 2) return 'Possible'
  if (context.repeatLocationCount === 1) return 'Low'
  return 'None'
}

function buildTriage(
  input: ResidentComplaintInput,
  context: EnforcementContext,
  forced?: DemoCategory,
): AiTriageResult {
  const { category, confidence: categoryConfidence } = classify(input.description, forced)
  const missingInformation = missingInformationCheck(input)
  const dupRisk = duplicateRisk(context)
  const sensitiveCategory = SENSITIVE_CATEGORIES.includes(category)

  // --- Confidence rules (mirrors the diagram's "Enough confidence?" gate) ---
  let confidence = 0.94
  const reasoning: string[] = []
  reasoning.push(`Classified as ${category} from complaint wording (model confidence ${(categoryConfidence * 100).toFixed(0)}%).`)

  if (!input.location.trim()) {
    confidence -= 0.25
    reasoning.push('Missing location lowers confidence — staff confirmation needed.')
  }
  if (input.description.trim().length < 15) {
    confidence -= 0.2
    reasoning.push('Description is too brief to confidently summarize.')
  }
  if (dupRisk === 'Possible' || dupRisk === 'Likely') {
    confidence -= 0.15
    reasoning.push(`Possible duplicate of prior cases at this location (${dupRisk.toLowerCase()} risk).`)
  }
  if (sensitiveCategory) {
    confidence -= 0.08
    reasoning.push(`${category} is a sensitive category — a human review is required before any closure.`)
  }
  if (context.repeatLocationSignal === 'High') {
    confidence -= 0.1
    reasoning.push('High repeat-location count suggests this needs supervisor visibility.')
  }
  if (categoryConfidence < 0.6) {
    confidence -= 0.12
    reasoning.push('Low classification confidence — complaint wording is ambiguous.')
  }
  confidence = Math.max(0.2, Math.min(0.97, confidence))

  const confidenceLevel: AiTriageResult['confidenceLevel'] =
    confidence >= 0.75 ? 'High' : confidence >= 0.55 ? 'Medium' : 'Low'

  const recommendedStage: WorkflowStage = confidenceLevel === 'High' ? 'staff-review' : 'needs-staff-attention'
  if (confidenceLevel === 'High') reasoning.push('Confidence is sufficient — closure response draft prepared for staff review.')
  else reasoning.push('Confidence below threshold — routed to staff attention before a draft is prepared.')

  return {
    category,
    categoryConfidence,
    extractedLocation: input.location.trim() || null,
    keyFacts: extractKeyFacts(input, category),
    missingInformation,
    duplicateRisk: dupRisk,
    recommendedDepartment: DEPARTMENT_BY_CATEGORY[category],
    recommendedPriority: PRIORITY_BY_CATEGORY[category],
    recommendedStage,
    confidence,
    confidenceLevel,
    sensitiveCategory,
    reasoning,
  }
}

// ---------------------------------------------------------------------------
// Step 4 — Case summary
// ---------------------------------------------------------------------------

function buildSummary(
  caseId: string,
  input: ResidentComplaintInput,
  triage: AiTriageResult,
  context: EnforcementContext,
): CaseSummary {
  const loc = triage.extractedLocation ?? 'an unspecified location'
  const plainLanguage =
    `A resident reported a ${triage.category.toLowerCase()} issue at ${loc}, submitted via ${input.channel}. ` +
    `${context.repeatLocationSignal !== 'None' ? `This location has ${context.repeatLocationCount} related complaints on record. ` : 'No prior complaints are on record for this location. '}` +
    `The matched policy is ${context.policyMatch.name} (${context.policyMatch.reference}). ` +
    `${triage.confidenceLevel === 'High' ? 'The case is straightforward enough for a prepared closure response, pending staff approval.' : 'The case needs staff attention before a closure response is prepared.'}`

  const structuredFacts: CaseSummary['structuredFacts'] = [
    { label: 'Case ID', value: caseId },
    { label: 'Category', value: triage.category },
    { label: 'Location', value: triage.extractedLocation ?? 'Not provided' },
    { label: 'Channel', value: input.channel },
    { label: 'Recommended department', value: triage.recommendedDepartment },
    { label: 'Recommended priority', value: triage.recommendedPriority },
    { label: 'Duplicate risk', value: triage.duplicateRisk },
    { label: 'Repeat-location signal', value: context.repeatLocationSignal },
    { label: 'Policy match', value: `${context.policyMatch.name} (${context.policyMatch.reference})` },
    { label: 'Confidence', value: `${(triage.confidence * 100).toFixed(0)}% (${triage.confidenceLevel})` },
  ]

  const recommendedNextStep =
    triage.confidenceLevel === 'High'
      ? 'Approve the prepared closure response, or edit before approving.'
      : triage.missingInformation.length > 0
        ? 'Request the missing information from the resident, then re-run the summary.'
        : 'Confirm classification and routing, then send to staff review to prepare a draft.'

  const attentionDrivers: string[] = []
  if (triage.sensitiveCategory) attentionDrivers.push('Sensitive category — mandatory human review')
  if (triage.duplicateRisk === 'Possible' || triage.duplicateRisk === 'Likely')
    attentionDrivers.push(`${triage.duplicateRisk} duplicate of existing case(s)`)
  if (context.repeatLocationSignal === 'High') attentionDrivers.push('High repeat-location count — possible hotspot')
  if (triage.missingInformation.length > 0) attentionDrivers.push('Missing intake information')
  if (attentionDrivers.length === 0) attentionDrivers.push('No attention drivers — routine closure candidate')

  return {
    plainLanguage,
    structuredFacts,
    recommendedNextStep,
    staffActionOptions: ['Approve routing', 'Request more information', 'Override priority', 'Send to staff review'],
    attentionDrivers,
    missingContext: triage.missingInformation,
  }
}

// ---------------------------------------------------------------------------
// Step 6 — Closure-response draft generation
// ---------------------------------------------------------------------------

/** Short, resident-facing label for each field outcome. */
export const FIELD_OUTCOME_LABELS: Record<FieldVisitOutcome, string> = {
  no_violation: 'No violation observed',
  notice_issued: 'Notice to comply issued',
  ticket_issued: 'Ticket issued',
  resolved: 'Resolved on site',
}

function fieldVisitDateLabel(action: OfficerFieldAction): string {
  return formatDate(action.visitedAt)
}

/**
 * The closure paragraph that describes what actually happened. When an officer
 * field action is on file it states the real outcome the officer recorded; with
 * no field action it stays strictly to the review that was performed and never
 * claims an officer attended.
 */
function closureOutcomeParagraph(
  triage: AiTriageResult,
  context: EnforcementContext,
  fieldAction: OfficerFieldAction | null,
): string {
  const policy = `the City's ${context.policyMatch.name} (${context.policyMatch.reference})`
  const where = triage.extractedLocation ? ` at ${triage.extractedLocation}` : ''

  if (!fieldAction) {
    // No officer attended — describe only the review that genuinely happened.
    return (
      `We reviewed the information you provided along with ${policy}. ` +
      `Based on that review, your request has now been closed. ` +
      `If you would like an officer to inspect the location, or if the issue continues, please reply or contact 311 with your case number.`
    )
  }

  const date = fieldVisitDateLabel(fieldAction)
  const ref = fieldAction.referenceNumber ? ` (${fieldAction.referenceNumber})` : ''
  switch (fieldAction.outcome) {
    case 'no_violation':
      return (
        `A by-law enforcement officer attended the location${where} on ${date} to investigate. ` +
        `At the time of inspection, no violation of ${policy} was observed. ` +
        `Based on that inspection, this file has been closed. If the issue recurs, please submit a new request so we can schedule a follow-up.`
      )
    case 'notice_issued':
      return (
        `A by-law enforcement officer attended the location${where} on ${date} and observed a violation of ${policy}. ` +
        `A notice to comply${ref} was issued to the responsible party, and the location will be re-inspected after the compliance period. ` +
        `Your service request has been closed now that enforcement action has been taken.`
      )
    case 'ticket_issued':
      return (
        `A by-law enforcement officer attended the location${where} on ${date}, observed a violation of ${policy}, ` +
        `and issued a ticket${ref} to the responsible party. This file has now been closed.`
      )
    case 'resolved':
      return (
        `A by-law enforcement officer attended the location${where} on ${date}. ` +
        `The issue had been resolved, so no further enforcement action under ${policy} was required and this file has been closed. ` +
        `Thank you for reporting it.`
      )
  }
}

export function buildClosureDraft(
  input: ResidentComplaintInput,
  triage: AiTriageResult,
  context: EnforcementContext,
  generatedAt: string,
  fieldAction: OfficerFieldAction | null = null,
): ClosureDraft {
  const greeting = input.residentName ? `Dear ${input.residentName},` : 'Dear resident,'
  const body =
    `${greeting}\n\n` +
    `Thank you for your recent service request regarding a ${triage.category.toLowerCase()} concern` +
    `${triage.extractedLocation ? ` at ${triage.extractedLocation}` : ''}. We appreciate you taking the time to bring this to our attention.\n\n` +
    `${closureOutcomeParagraph(triage, context, fieldAction)}\n\n` +
    `Thank you for helping keep our community safe and well-maintained.\n\n` +
    `Sincerely,\nCity of Brampton — ${triage.recommendedDepartment}`

  // The "action taken" claim is only truthful once an officer field action is on
  // file; otherwise the letter is explicitly a review-only closure.
  const internalNotes = [
    `Matched response template: ${RESPONSE_TEMPLATE_BY_CATEGORY[triage.category]}.`,
    `Draft assembled from intake + ${context.complaintHistory.length} historical record(s) + policy match.`,
    fieldAction
      ? `Field outcome on file: ${FIELD_OUTCOME_LABELS[fieldAction.outcome]} by ${fieldAction.officerName} on ${fieldVisitDateLabel(fieldAction)}${fieldAction.referenceNumber ? ` (ref ${fieldAction.referenceNumber})` : ''}.`
      : 'No officer field action on file — closure language is review-only and claims no site visit.',
    'Staff must review and approve before any resident communication is sent.',
  ]

  return {
    subject: `Update on your service request — ${triage.category}`,
    body,
    policyChecklist: [
      { item: `Cites applicable by-law (${context.policyMatch.reference})`, ok: true },
      {
        item: fieldAction ? 'States the enforcement action taken' : 'States the review performed (no field action claimed)',
        ok: true,
      },
      { item: 'Only claims a site visit when an officer recorded one', ok: true },
      { item: 'Confirms the case status (closed)', ok: true },
      { item: 'Provides a path to re-open if the issue recurs', ok: true },
    ],
    toneChecklist: [
      { item: 'Acknowledges and thanks the resident', ok: true },
      { item: 'Plain, non-technical language', ok: true },
      { item: 'No internal jargon or case-system codes', ok: true },
      { item: 'Personalized to the resident and issue', ok: Boolean(input.residentName) },
    ],
    internalNotes,
    generatedBy: 'Rules based closure template engine',
    generatedAt,
  }
}

// ---------------------------------------------------------------------------
// Orchestration — run the full AI workflow on a fresh intake
// ---------------------------------------------------------------------------

/**
 * Runs intake → classify → context → summary → confidence and (when confidence
 * is high) prepares a closure draft. Returns a fully-populated DemoCase with the
 * initial AI audit trail. Staff actions are layered on afterward by the store.
 */
export function runWorkflow(
  input: ResidentComplaintInput,
  opts?: { forcedCategory?: DemoCategory; caseId?: string },
): DemoCase {
  const id = opts?.caseId ?? newCaseId()
  const t0 = input.submittedAt
  const context = buildContext(input, classify(input.description, opts?.forcedCategory).category)
  const triage = buildTriage(input, context, opts?.forcedCategory)
  const summary = buildSummary(id, input, triage, context)
  const draftReady = triage.confidenceLevel === 'High'
  const now = new Date().toISOString()
  const draft = draftReady ? buildClosureDraft(input, triage, context, now) : null

  const audit: AuditEvent[] = [
    auditEvent('resident', 'Complaint submitted', `Resident filed a ${triage.category} complaint via ${input.channel}.`, t0),
    auditEvent('ai', 'Intake captured', 'Intake fields parsed and a synthetic case object was created.', addSeconds(t0, 1)),
    auditEvent('ai', 'AI classification', `Classified as ${triage.category} (${(triage.categoryConfidence * 100).toFixed(0)}% model confidence); routed to ${triage.recommendedDepartment}.`, addSeconds(t0, 2)),
    auditEvent('ai', 'Facts extracted', `${triage.keyFacts.length} key facts extracted; ${triage.missingInformation.length} missing-information flag(s).`, addSeconds(t0, 3)),
    auditEvent('ai', 'Context gathered', `Pulled ${context.complaintHistory.length} history record(s), patrol/ticket notes, trend summary, and policy match.`, addSeconds(t0, 4)),
    auditEvent('ai', 'Case summary built', 'Plain-language summary and structured facts assembled for staff.', addSeconds(t0, 5)),
    auditEvent('ai', 'Review readiness checked', `File readiness ${(triage.confidence * 100).toFixed(0)}% (${triage.confidenceLevel}).`, addSeconds(t0, 6)),
  ]
  if (draftReady) {
    audit.push(auditEvent('ai', 'Closure draft prepared', 'High confidence — a closure-response draft was prepared for staff review.', addSeconds(t0, 7)))
  } else {
    audit.push(auditEvent('ai', 'Routed to staff attention', 'Confidence below threshold — routed to a staff member to clarify before drafting.', addSeconds(t0, 7)))
  }

  return {
    id,
    createdAt: now,
    stage: triage.recommendedStage,
    // Synthetic / resident-intake origin by default. The NYC open-benchmark
    // bridge overrides `source` and `normalized` for benchmark cases.
    source: { kind: 'resident', label: CASE_SOURCE_LABELS.resident },
    normalized: {
      case_id: id,
      source: 'resident_intake',
      submitted_at: input.submittedAt,
      status: triage.recommendedStage,
      complaint_type: triage.category,
      request_detail: input.description.trim() || null,
      location_type: null,
      address_or_location: input.location.trim() || null,
      ward_or_area: null,
      assigned_department: triage.recommendedDepartment,
      priority_score: null,
      priority_reason: null,
      resolution_description: null,
      closure_status: triage.recommendedStage === 'closed' ? 'closed' : 'open',
    },
    input,
    triage,
    context,
    summary,
    draft,
    priorityOverride: null,
    assignedOfficer: null,
    fieldAction: null,
    decisions: [],
    audit,
    closureMessage: null,
    approvedBy: null,
    approvedAt: null,
  }
}

// ---------------------------------------------------------------------------
// Sample complaints for the intake demo
// ---------------------------------------------------------------------------

function baseInput(partial: Partial<ResidentComplaintInput>): ResidentComplaintInput {
  return {
    description: '',
    location: '',
    channel: '311 Web',
    hasPhoto: false,
    contactPreference: 'Email',
    submittedAt: new Date().toISOString(),
    residentName: 'Jordan Reyes',
    residentEmail: 'resident@example.com',
    ...partial,
  }
}

export const SAMPLE_COMPLAINTS: SampleComplaint[] = [
  {
    label: 'Property standards complaint',
    category: 'Property Standards',
    input: baseInput({
      description: 'The fence and front porch at the house next door are broken and falling apart, with peeling paint and exposed boards. It looks unsafe for kids walking by.',
      location: '42 Hartford Trail, Brampton',
      channel: '311 Web',
      hasPhoto: true,
      residentName: 'Priya Sharma',
      residentEmail: 'priya.s@example.com',
    }),
  },
  {
    label: 'Illegal dumping',
    category: 'Illegal Dumping',
    input: baseInput({
      description: 'Someone dumped a pile of old furniture, a mattress and construction debris in the alley behind the plaza again. This keeps happening every couple of weeks.',
      location: 'Rear alley, 120 Kennedy Rd S, Brampton',
      channel: 'Mobile App',
      hasPhoto: true,
      residentName: 'Marcus Bell',
      residentEmail: 'm.bell@example.com',
    }),
  },
  {
    label: 'Noise complaint',
    category: 'Noise',
    input: baseInput({
      description: 'Loud music and a party going past midnight on weekends from the unit across the street. It is ongoing and happens almost every weekend.',
      location: '88 Queen St E, Brampton',
      channel: '311 Phone',
      hasPhoto: false,
      contactPreference: 'Phone',
      residentName: 'Anita Roy',
      residentEmail: 'anita.roy@example.com',
    }),
  },
  {
    label: 'Parking issue',
    category: 'Parking',
    input: baseInput({
      description: 'A vehicle is parked on the front lawn and partly blocking the sidewalk on my street.',
      location: '15 Mountainberry Rd, Brampton',
      channel: 'Mobile App',
      hasPhoto: true,
      residentName: 'Dev Patel',
      residentEmail: 'dev.patel@example.com',
    }),
  },
  {
    label: 'Yard maintenance',
    category: 'Yard Maintenance',
    input: baseInput({
      description: 'Grass and weeds are very overgrown.',
      location: '',
      channel: 'Email',
      hasPhoto: false,
      contactPreference: 'No follow-up',
      residentName: 'Sam Lee',
      residentEmail: 'sam.lee@example.com',
    }),
  },
  {
    label: 'Zoning concern',
    category: 'Zoning',
    input: baseInput({
      description: 'I think the house on the corner is being run as an illegal rooming house / second unit with a business operating out of it. There are lots of cars and people coming and going.',
      location: '230 Bovaird Dr W, Brampton',
      channel: '311 Web',
      hasPhoto: false,
      residentName: 'Grace Okoro',
      residentEmail: 'grace.o@example.com',
    }),
  },
]

// ---------------------------------------------------------------------------
// Seed cases — so Audit Trail and Supervisor Insights have content on first load
// ---------------------------------------------------------------------------

// Tailored seed inputs use non-"hot" addresses so confidence lands where we
// want (vs. the sample complaints, which deliberately hit repeat locations).
const SEED_CLOSED_INPUT: ResidentComplaintInput = baseInput({
  description: 'Loud music and a party going late into the night from the unit across the street last weekend.',
  location: '55 Sandalwood Pkwy E, Brampton',
  channel: '311 Phone',
  hasPhoto: false,
  contactPreference: 'Phone',
  residentName: 'Anita Roy',
  residentEmail: 'anita.roy@example.com',
})

const SEED_REVIEW_INPUT: ResidentComplaintInput = baseInput({
  description: 'The fence and front porch next door are broken with peeling paint and exposed boards — looks unsafe.',
  location: '78 Father Tobin Rd, Brampton',
  channel: '311 Web',
  hasPhoto: true,
  residentName: 'Priya Sharma',
  residentEmail: 'priya.s@example.com',
})

/** Builds the demo's starting set of cases at varied stages of the lifecycle. */
export function buildSeedCases(): DemoCase[] {
  const cases: DemoCase[] = []

  // 1) A fully closed case (approved by staff) — gives the audit trail a full
  //    lifecycle: assigned to an officer, a real field visit recorded, then a
  //    closure response approved that reflects what the officer actually did.
  const closed = runWorkflowAt(SEED_CLOSED_INPUT, daysAgo(2))
  if (closed.draft) {
    const officerName = 'R. Singh (By-law Officer)'
    const assignedAt = addSeconds(closed.createdAt, 200)
    const visitedAt = addSeconds(closed.createdAt, 480)
    const fieldAction: OfficerFieldAction = {
      officerName,
      visitedAt,
      outcome: 'resolved',
      observations: 'Attended the address; no active noise at the time of visit and the responsible party had already addressed it.',
      referenceNumber: null,
      followUpRequired: false,
      recordedAt: visitedAt,
    }
    const approvedAt = addSeconds(closed.createdAt, 600)
    // Rebuild the closure draft from the recorded outcome so the closure message
    // states what the officer actually found.
    const draft = buildClosureDraft(closed.input, closed.triage, closed.context, approvedAt, fieldAction)
    closed.assignedOfficer = officerName
    closed.fieldAction = fieldAction
    closed.draft = draft
    closed.stage = 'closed'
    closed.closureMessage = draft.body
    closed.approvedBy = 'M. Okafor (Supervisor)'
    closed.approvedAt = approvedAt
    closed.decisions.push({ action: 'Assigned to officer', by: closed.approvedBy, at: assignedAt })
    closed.decisions.push({ action: 'Recorded field visit outcome', by: officerName, at: visitedAt })
    closed.decisions.push({ action: 'Approved closure response', by: closed.approvedBy, at: approvedAt })
    closed.audit.push(auditEvent('staff', 'Assigned to officer', `Supervisor assigned the case to ${officerName} for a field investigation.`, assignedAt))
    closed.audit.push(auditEvent('officer', 'Field visit recorded', `${officerName} attended the location and recorded the outcome: ${FIELD_OUTCOME_LABELS[fieldAction.outcome]}.`, visitedAt))
    closed.audit.push(auditEvent('staff', 'Closure approved', `Final response approved by ${closed.approvedBy}.`, approvedAt))
    closed.audit.push(auditEvent('system', 'Resident emailed', 'The approved closure response was emailed to the resident.', addSeconds(approvedAt, 1)))
    closed.audit.push(auditEvent('system', 'Case closed', 'Case status changed to Closed and logged in the audit trail.', addSeconds(approvedAt, 2)))
  }
  cases.push(closed)

  // 2) A high-confidence case waiting in staff review with a prepared draft.
  cases.push(runWorkflowAt(SEED_REVIEW_INPUT, daysAgo(1)))

  // 3) A low-confidence case routed to "needs staff attention" (missing info).
  cases.push(runWorkflowAt(SAMPLE_COMPLAINTS[4].input, hoursAgo(6)))

  // 4) A sensitive zoning case at a repeat location — routed for human review.
  cases.push(runWorkflowAt(SAMPLE_COMPLAINTS[5].input, hoursAgo(3)))

  return cases
}

function runWorkflowAt(input: ResidentComplaintInput, submittedAt: string): DemoCase {
  return runWorkflow({ ...input, submittedAt })
}

// ---------------------------------------------------------------------------
// Supervisor metrics — "where workload is reduced"
// ---------------------------------------------------------------------------

// Baseline demo estimates so the panel reads sensibly even with few live cases.
const BASELINE = {
  newComplaintsProcessed: 128,
  aiClassified: 128,
  aiSummariesGenerated: 128,
  closureDraftsPrepared: 96,
  staffReviewExceptions: 32,
}

export function computeSupervisorMetrics(cases: DemoCase[]): SupervisorMetrics {
  const live = cases.length
  const draftsLive = cases.filter((c) => c.draft != null).length
  const exceptionsLive = cases.filter((c) => c.stage === 'needs-staff-attention').length

  const newComplaintsProcessed = BASELINE.newComplaintsProcessed + live
  const aiClassified = BASELINE.aiClassified + live
  const aiSummariesGenerated = BASELINE.aiSummariesGenerated + live
  const closureDraftsPrepared = BASELINE.closureDraftsPrepared + draftsLive
  const staffReviewExceptions = BASELINE.staffReviewExceptions + exceptionsLive

  return {
    newComplaintsProcessed,
    aiClassified,
    aiSummariesGenerated,
    closureDraftsPrepared,
    staffReviewExceptions,
    // ~12 min of manual research avoided per AI-gathered context pack.
    manualResearchHoursAvoided: Math.round((aiSummariesGenerated * 12) / 60),
    // ~0.6 follow-up calls avoided per clear closure response.
    followUpCallsReduced: Math.round(closureDraftsPrepared * 0.6),
    // Minutes saved per drafted response vs. writing from scratch.
    avgDraftMinutesSaved: 9,
  }
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function addSeconds(iso: string, secs: number): string {
  return new Date(new Date(iso).getTime() + secs * 1000).toISOString()
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString()
}

function hoursAgo(n: number): string {
  return new Date(Date.now() - n * 3600000).toISOString()
}

export { auditEvent }

/** Guardrail text shown on every demo page. */
export const DEMO_GUARDRAIL =
  'Decision support and closure-response automation only. Final review remains with authorized staff.'

/** Demo-data positioning note. */
export const DEMO_DATA_NOTE =
  'Synthetic and benchmark demo data only. No Brampton operational complaint data is loaded, and no resident is contacted.'
