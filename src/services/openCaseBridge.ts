// Bridge an NYC open benchmark case into the staff workbench lifecycle.
//
// Resident intake and NYC open benchmark cases are ONE operational workflow.
// When staff open an NYC open benchmark case from the Work Queue, we turn that
// public 311 source record into the same DemoCase shape resident intake uses, so
// it enters the identical lifecycle: assignment, action log, closure draft,
// supervisor approval, and close-case.
//
// IMPORTANT: closing an NYC open benchmark case here records a POC workflow
// closure decision in our app layer only. It never writes back to NYC data, and
// the verbatim source record (carried on `source.nyc`) is preserved unchanged.

import type { CaseSource, DemoCase, DemoCategory, ResidentComplaintInput } from '../data/demoWorkflowTypes'
import { CASE_SOURCE_LABELS } from '../data/demoWorkflowTypes'
import { runWorkflow } from './demoWorkflowService'
import { openRowToNormalized } from './serviceRequest'
import type { OpenReviewRow } from './caseExplorer'

/**
 * Best-fit internal by-law category for an NYC 311 complaint type, so the
 * workbench can match a policy/template and recommend a department. Defaults to
 * Property Standards when nothing matches.
 */
function categoryForNycComplaint(complaintType: string | null): DemoCategory {
  const t = (complaintType ?? '').toLowerCase()
  if (/noise/.test(t)) return 'Noise'
  if (/park|vehicle|blocked driveway|abandoned/.test(t)) return 'Parking'
  if (/dump|illegal dispos|sanitation|dirty|debris|litter/.test(t)) return 'Illegal Dumping'
  if (/lot|weed|grass|overgrow|yard/.test(t)) return 'Yard Maintenance'
  if (/zoning|illegal convers|sro|use|occupancy/.test(t)) return 'Zoning'
  return 'Property Standards'
}

/** Cross streets / intersection text from the verbatim source record, or null. */
function crossStreets(row: OpenReviewRow): string | null {
  const s = row.source
  const parts = [s.cross_street_1, s.cross_street_2, s.intersection_street_1, s.intersection_street_2]
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0)
  return parts.length > 0 ? parts.join(' & ') : null
}

/** Build the verbatim NYC source record carried on the case for display. */
function buildNycSource(row: OpenReviewRow): NonNullable<CaseSource['nyc']> {
  const s = row.source
  return {
    caseId: row.case_id,
    status: row.status,
    complaintType: row.complaint_type,
    descriptor: row.descriptor,
    agency: row.agency,
    borough: row.borough,
    councilDistrict: row.council_district,
    location: row.address_or_location,
    submittedAt: row.submitted_at,
    dueDate: row.due_date,
    ageDays: row.age_days,
    sourceChannel: row.source_channel,
    priorityScore: row.priority_score,
    priorityTier: row.priority_tier,
    priorityReason: row.priority_reason,
    uniqueKey: s.unique_key,
    locationType: s.location_type,
    incidentZip: s.incident_zip,
    incidentAddress: s.incident_address,
    city: s.city,
    addressType: s.address_type,
    crossStreets: crossStreets(row),
    resolutionDescription: s.resolution_description,
    resolutionActionUpdatedDate: s.resolution_action_updated_date,
    latitude: s.latitude,
    longitude: s.longitude,
  }
}

/**
 * Turn an NYC open benchmark queue row into a staff workbench case. The NYC case
 * id is preserved so deep links resolve, and the resident's chosen issue type is
 * replaced by the NYC complaint type (no free-text guessing). There is no
 * resident contact on a benchmark case, so the closure flow never emails anyone.
 */
export function openRowToCase(row: OpenReviewRow): DemoCase {
  const input: ResidentComplaintInput = {
    description: [row.complaint_type, row.descriptor].filter(Boolean).join(' — ') || 'NYC 311 service request',
    location: [row.address_or_location, row.borough].filter(Boolean).join(', '),
    channel: '311 Web',
    hasPhoto: false,
    // Benchmark cases carry no resident contact — closure stays in our app layer.
    contactPreference: 'No follow-up',
    submittedAt: row.submitted_at ?? new Date().toISOString(),
    residentName: '',
    residentEmail: '',
  }

  const demoCase = runWorkflow(input, {
    forcedCategory: categoryForNycComplaint(row.complaint_type),
    caseId: row.case_id,
  })

  demoCase.source = {
    kind: 'nyc_open',
    label: CASE_SOURCE_LABELS.nyc_open,
    nyc: buildNycSource(row),
  }
  demoCase.normalized = openRowToNormalized(row)

  return demoCase
}
