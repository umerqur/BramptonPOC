// Type model for the end-to-end AI-assisted closure-response demo workflow.
//
// This is the heart of the redesigned Proactive Enforcement Response POC. The
// flow mirrors the use-case concept diagram: a resident complaint is captured,
// the AI workflow system classifies it, extracts facts, checks for missing
// information, gathers enforcement context, builds a case summary, checks
// confidence, and prepares a closure-response draft. By-law staff only review
// exceptions, edit the draft, and approve the final response — every approval is
// an explicit human action.
//
// All data backed by these types is SYNTHETIC / benchmark demo data. Nothing
// here represents Brampton operational complaint data, and nothing is ever sent
// to a real resident.

/** Channel the resident used to file the complaint. */
export type ServiceChannel = '311 Web' | '311 Phone' | 'Mobile App' | 'Email' | 'Walk-in'

/** How the resident prefers to be contacted about their case. */
export type ContactPreference = 'Email' | 'Phone' | 'Text message' | 'No follow-up'

/** Municipal by-law complaint categories covered by the demo. */
export type DemoCategory =
  | 'Property Standards'
  | 'Illegal Dumping'
  | 'Noise'
  | 'Parking'
  | 'Yard Maintenance'
  | 'Zoning'

export type Priority = 'P1' | 'P2' | 'P3' | 'P4'

/** Who performed a workflow action — used to make automation vs. human review obvious. */
export type AutomationActor = 'ai' | 'staff' | 'resident' | 'system' | 'officer'

/** Where a case currently sits in the end-to-end flow. */
export type WorkflowStage =
  | 'intake'
  | 'classified'
  | 'context'
  | 'summary'
  | 'needs-staff-attention'
  | 'assigned'
  | 'field-visit'
  | 'staff-review'
  | 'approved'
  | 'closed'

/** Raw resident-submitted intake — the only "human-authored" input in the flow. */
export type ResidentComplaintInput = {
  description: string
  location: string
  channel: ServiceChannel
  hasPhoto: boolean
  contactPreference: ContactPreference
  submittedAt: string // ISO timestamp
  residentName: string
  residentEmail: string
}

/** What the AI system produced automatically from the raw intake. */
export type AiTriageResult = {
  category: DemoCategory
  categoryConfidence: number // 0..1
  extractedLocation: string | null
  keyFacts: string[]
  missingInformation: string[]
  duplicateRisk: 'None' | 'Low' | 'Possible' | 'Likely'
  recommendedDepartment: string
  recommendedPriority: Priority
  recommendedStage: WorkflowStage
  confidence: number // 0..1 overall workflow confidence
  confidenceLevel: 'High' | 'Medium' | 'Low'
  sensitiveCategory: boolean
  reasoning: string[]
}

/** Context the AI gathered so staff don't have to research manually. */
export type EnforcementContext = {
  complaintHistory: { caseId: string; date: string; summary: string; status: string }[]
  patrolLogs: string[]
  ticketRecords: string[]
  trendSummary: string
  policyMatch: { name: string; reference: string; summary: string }
  similarNearbyCases: { caseId: string; distance: string; category: DemoCategory; outcome: string }[]
  repeatLocationCount: number
  repeatLocationSignal: 'None' | 'Emerging' | 'High'
}

/** The assembled, staff-readable case the AI built from intake + context. */
export type CaseSummary = {
  plainLanguage: string
  structuredFacts: { label: string; value: string }[]
  recommendedNextStep: string
  staffActionOptions: string[]
  attentionDrivers: string[]
  missingContext: string[]
}

/**
 * The outcome of an officer's field investigation — the real-world action that
 * actually happened on the case. The closure response may only assert officer
 * activity when one of these has been recorded. Mirrors a standard municipal
 * by-law enforcement disposition.
 */
export type FieldVisitOutcome = 'no_violation' | 'notice_issued' | 'ticket_issued' | 'resolved' | 'warning_education'

/**
 * The structured enforcement action an officer selects on the field-outcome
 * form. This is what the officer actually DID — the closure disposition is
 * derived from it (a "yes" violation alone never implies a ticket). "Action
 * taken" free text is only optional supporting detail.
 */
export type EnforcementAction =
  | 'warning_education' // Education / warning provided
  | 'notice_issued' // Notice issued
  | 'ticket_issued' // Parking ticket / penalty notice issued
  | 'no_action' // No action taken
  | 'other' // Other

/**
 * How a parking ticket / penalty notice was served. Only recorded when the
 * enforcement action is ticket_issued. This records what the officer did — it
 * is not a payment or ticket-issuance system.
 */
export type ServiceMethod =
  | 'placed_on_vehicle' // Placed on vehicle
  | 'handed_to_driver' // Handed to driver / owner
  | 'sent_by_mail' // Sent by mail
  | 'other' // Other

/**
 * A recorded officer field visit. Created only when a By-law Officer (role)
 * attends the location and records what they found. Drives the truthful closure
 * language — without this, the closure response must not claim an officer
 * attended.
 *
 * The closure draft is grounded in the officer's RECORDED action, not an
 * assumed disposition: a "yes" violation does not mean a ticket was issued, so
 * the raw recorded fields below are carried through and used verbatim where the
 * letter describes what the officer actually did.
 */
export type OfficerFieldAction = {
  officerName: string
  visitedAt: string // ISO timestamp
  outcome: FieldVisitOutcome
  observations: string
  /** Ticket / penalty notice number, when a ticket was issued. */
  referenceNumber: string | null
  followUpRequired: boolean
  recordedAt: string // ISO timestamp
  // Verbatim fields the officer recorded on the field form, so the closure draft
  // reflects the real action taken rather than collapsing to a single template.
  violationObserved: 'yes' | 'no' | 'unclear' | null
  /** Structured enforcement action the officer selected — drives the outcome. */
  enforcementAction: EnforcementAction | null
  /** How the ticket / penalty notice was served (ticket_issued only). */
  serviceMethod: ServiceMethod | null
  /** Optional supporting "action taken" notes — never the sole disposition. */
  actionTaken: string | null
  observedCondition: string | null
  officerNotes: string | null
}

/** The AI-drafted closure response staff review, edit, and approve. */
export type ClosureDraft = {
  subject: string
  body: string
  policyChecklist: { item: string; ok: boolean }[]
  toneChecklist: { item: string; ok: boolean }[]
  internalNotes: string[]
  generatedBy: string
  generatedAt: string
}

/** A discrete decision a human staff member made on the case. */
export type StaffDecision = {
  action: string
  by: string
  at: string
  note?: string
}

/** A single immutable entry in the case audit trail. */
export type AuditEvent = {
  id: string
  at: string
  actor: AutomationActor
  actorLabel: string
  type: string
  detail: string
}

/** Aggregate object carrying a case through every stage of the demo workflow. */
export type DemoCase = {
  id: string
  createdAt: string
  stage: WorkflowStage
  /** Where this case came from (resident intake vs. NYC open benchmark). */
  source: CaseSource
  /** The case projected onto the shared normalized service-request schema. */
  normalized: NormalizedServiceRequest
  input: ResidentComplaintInput
  triage: AiTriageResult
  context: EnforcementContext
  summary: CaseSummary
  draft: ClosureDraft | null
  priorityOverride: Priority | null
  /** Display name of the officer assigned to investigate (set by a supervisor/CSR), or null. */
  assignedOfficer: string | null
  /**
   * Login email of the assigned officer — the real identity the Officer Field
   * Console filters on. A case only appears for the officer whose signed-in
   * email matches this. Null when unassigned.
   */
  assignedOfficerEmail: string | null
  /** Recorded officer field investigation outcome, or null if none yet. */
  fieldAction: OfficerFieldAction | null
  decisions: StaffDecision[]
  audit: AuditEvent[]
  closureMessage: string | null
  approvedBy: string | null
  approvedAt: string | null
}

// ---------------------------------------------------------------------------
// Case source + normalized service-request schema
// ---------------------------------------------------------------------------
//
// The Work Queue runs ONE operational lifecycle over two live sources. Every
// case carries a `source` so the workbench can label it honestly, and a
// `normalized` projection so resident intake and NYC open benchmark cases share
// the same internal service-request shape regardless of where they came from.

/** Where an operational case originated. */
export type CaseSourceKind = 'resident' | 'nyc_open' | 'historical'

/** Plain, operator-facing source labels (also used as the source badge text). */
export const CASE_SOURCE_LABELS: Record<CaseSourceKind, string> = {
  resident: 'Resident intake',
  nyc_open: 'NYC open benchmark',
  historical: 'Historical NYC source',
}

/**
 * Verbatim public NYC 311 source-record fields for an open benchmark case, plus
 * the queue's review-priority signal. Review priority is INTERNAL decision
 * support, not a field of the NYC source record.
 */
export type NycBenchmarkSource = {
  caseId: string
  status: string | null
  complaintType: string | null
  descriptor: string | null
  agency: string | null
  borough: string | null
  councilDistrict: string | null
  location: string | null
  submittedAt: string | null
  dueDate: string | null
  ageDays: number | null
  sourceChannel: string | null
  // Internal decision support (NOT a NYC source field).
  priorityScore: number | null
  priorityTier: string | null
  priorityReason: string | null
  // Verbatim source record.
  uniqueKey: string | null
  locationType: string | null
  incidentZip: string | null
  incidentAddress: string | null
  city: string | null
  addressType: string | null
  crossStreets: string | null
  resolutionDescription: string | null
  resolutionActionUpdatedDate: string | null
  latitude: number | null
  longitude: number | null
}

/** The source a case came from, with the verbatim record for NYC benchmark cases. */
export type CaseSource = {
  kind: CaseSourceKind
  label: string
  /** Present only for NYC open benchmark cases. */
  nyc?: NycBenchmarkSource
}

/** Whether a normalized service request is still open or has been closed. */
export type ClosureStatus = 'open' | 'closed'

/**
 * The single normalized service-request schema every operational case maps to,
 * regardless of source. Resident intake is mapped into this shape internally
 * (the resident form stays resident-friendly); NYC open benchmark and historical
 * NYC records map into the same fields.
 */
export type NormalizedServiceRequest = {
  case_id: string
  source: 'resident_intake' | 'nyc_open_benchmark' | 'historical_nyc'
  submitted_at: string | null
  status: string | null
  complaint_type: string | null
  request_detail: string | null
  location_type: string | null
  address_or_location: string | null
  ward_or_area: string | null
  assigned_department: string | null
  priority_score: number | null
  priority_reason: string | null
  resolution_description: string | null
  closure_status: ClosureStatus
}

/** A ready-to-load realistic sample complaint for the intake demo. */
export type SampleComplaint = {
  label: string
  category: DemoCategory
  input: ResidentComplaintInput
}

/** Supervisor-facing "where workload is reduced" metrics. */
export type SupervisorMetrics = {
  newComplaintsProcessed: number
  aiClassified: number
  aiSummariesGenerated: number
  closureDraftsPrepared: number
  staffReviewExceptions: number
  manualResearchHoursAvoided: number
  followUpCallsReduced: number
  avgDraftMinutesSaved: number
}
