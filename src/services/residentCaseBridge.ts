// Bridge between the two worlds of the POC:
//   * Resident submissions live in Supabase (public.resident_service_requests).
//   * The staff workbench / closure flow runs on the synthetic in-browser
//     workflow store (DemoCase objects).
//
// When a resident files a complaint it lands in Supabase and shows up in the
// Staff Inbox. When staff click "Open case", we turn that row into a workbench
// DemoCase using the same deterministic AI workflow that powers the POC
// Walkthrough — so staff get an AI-style triage, summary, confidence, and
// recommended action even though no real model result exists yet.
//
// This is decision support only: every department / priority / confidence value
// here is a generated placeholder, and every closure still requires explicit
// staff approval.

import type { DemoCase, DemoCategory, ResidentComplaintInput, ContactPreference } from '../data/demoWorkflowTypes'
import { runWorkflow } from './demoWorkflowService'
import type { ResidentRequestRow } from './residentRequests'

/**
 * Deterministic mapping from a resident-facing issue type to the internal
 * by-law category that drives recommended department, priority, and policy
 * match in the workflow engine:
 *
 *   Parking issue        → Parking Enforcement
 *   Property standards   → Property Standards
 *   Noise complaint      → By-law Enforcement
 *   Illegal dumping      → Public Works / Waste Enforcement
 *   Yard maintenance     → Property Standards
 *   Zoning concern       → Zoning Review
 *   Other bylaw concern  → By-law Enforcement (generic)
 */
export const RESIDENT_TYPE_TO_CATEGORY: Record<string, DemoCategory> = {
  'Parking issue': 'Parking',
  'Property standards': 'Property Standards',
  'Noise complaint': 'Noise',
  'Illegal dumping': 'Illegal Dumping',
  'Yard maintenance': 'Yard Maintenance',
  'Zoning concern': 'Zoning',
  'Other bylaw concern': 'Property Standards',
}

/** Best-fit category for a resident request type (defaults to Property Standards). */
export function categoryForRequestType(requestType: string): DemoCategory {
  return RESIDENT_TYPE_TO_CATEGORY[requestType] ?? 'Property Standards'
}

function methodToPreference(method: string | null): ContactPreference {
  if (method === 'Phone') return 'Phone'
  return 'Email'
}

/**
 * Turn a resident Supabase row into a staff workbench case shape. The resident
 * case id (RSR-…) is preserved so deep links from the inbox resolve, and the
 * resident's chosen issue type forces the classification (no free-text guessing).
 *
 * This does NOT touch the synthetic seed cases used by the POC Walkthrough — it
 * only converts a real resident submission on demand.
 */
export function residentRowToCase(row: ResidentRequestRow): DemoCase {
  const input: ResidentComplaintInput = {
    description: row.description ?? '',
    location: [row.location, row.city].filter(Boolean).join(', '),
    channel: '311 Web',
    hasPhoto: false,
    contactPreference: methodToPreference(row.method_of_contact),
    submittedAt: row.created_at,
    residentName: row.resident_name,
    residentEmail: row.resident_email,
  }
  return runWorkflow(input, {
    forcedCategory: categoryForRequestType(row.request_type),
    caseId: row.case_id,
  })
}
