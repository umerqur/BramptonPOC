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
export type AutomationActor = 'ai' | 'staff' | 'resident' | 'system'

/** Where a case currently sits in the end-to-end flow. */
export type WorkflowStage =
  | 'intake'
  | 'classified'
  | 'context'
  | 'summary'
  | 'needs-staff-attention'
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
  input: ResidentComplaintInput
  triage: AiTriageResult
  context: EnforcementContext
  summary: CaseSummary
  draft: ClosureDraft | null
  priorityOverride: Priority | null
  decisions: StaffDecision[]
  audit: AuditEvent[]
  closureMessage: string | null
  approvedBy: string | null
  approvedAt: string | null
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
