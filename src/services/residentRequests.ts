import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { addWorkflowEvent } from './municipalServiceRequests'

// Resident Intake Demo — service layer for the public resident simulation flow
// and the staff-side intake workbench.
//
// Two personas share this module:
//   * Residents (public, anonymous) submit a request and check its status by
//     case id. Anonymous reads go through the get_resident_request_status RPC,
//     which returns only non-sensitive columns (no email / phone).
//   * Staff (authenticated) read the full request and advance its status. Each
//     advance writes a workflow event and triggers a resident email — only ever
//     from an explicit staff button click.
//
// This is clearly a DEMO: it stores demo submissions in
// public.resident_service_requests, kept separate from the Toronto 311
// benchmark data in municipal_complaints.

export const RESIDENT_REQUESTS_TABLE = 'resident_service_requests'

/** Server-side Netlify function that sends resident email via Brevo. */
const RESIDENT_EMAIL_ENDPOINT = '/.netlify/functions/send-resident-email'

export const RESIDENT_DEMO_NOTICE =
  'This is a public demo of a resident service-request flow. Do not enter real personal information — submissions are stored as demo data only.'

// Canonical status values stored on resident_service_requests.status.
export type ResidentStatus = 'submitted' | 'received' | 'assigned' | 'in_review' | 'completed'

/** Human-readable label for each status. */
export const STATUS_LABELS: Record<ResidentStatus, string> = {
  submitted: 'Submitted',
  received: 'Received',
  assigned: 'Assigned',
  in_review: 'Under review',
  completed: 'Completed',
}

/**
 * The four resident-facing tracker stages. The five canonical statuses map onto
 * these four steps for the public status page ('assigned' and 'in_review' both
 * show as "Under review").
 */
export const RESIDENT_STAGES = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'received', label: 'Received' },
  { key: 'under_review', label: 'Under review' },
  { key: 'completed', label: 'Completed' },
] as const

/** Index of the active resident tracker stage (0–3) for a given status. */
export function stageIndexForStatus(status: string): number {
  switch (status) {
    case 'submitted':
      return 0
    case 'received':
      return 1
    case 'assigned':
    case 'in_review':
      return 2
    case 'completed':
      return 3
    default:
      return 0
  }
}

/**
 * The explicit staff actions, in workflow order. Each maps to a target status,
 * a button label, and the workflow-event type recorded in the audit trail.
 */
export const STAFF_ACTIONS: Array<{
  toStatus: ResidentStatus
  label: string
  eventType: string
}> = [
  { toStatus: 'received', label: 'Mark received', eventType: 'resident_request_received' },
  { toStatus: 'assigned', label: 'Assign', eventType: 'resident_request_assigned' },
  { toStatus: 'in_review', label: 'Move to review', eventType: 'resident_request_in_review' },
  { toStatus: 'completed', label: 'Mark completed', eventType: 'resident_request_completed' },
]

/**
 * Parking infraction "Problem Type" options, mirroring the City of Brampton 311
 * "Report a Parking Infraction" Service Request Form.
 */
export const PARKING_PROBLEM_TYPES = [
  'Idling',
  'Immobile Vehicle on City Street',
  'Multiple Offences',
  'Other Offences',
  'Oversized Motor Vehicle on City Street',
  'Oversized Motor Vehicle on Private Property',
  'Parked 15CM from Curb',
  'Parked between 2:00am-6:00am',
  'Parked Blocking Fire Hydrant',
  'Parked in a Bike Lane',
  'Parked in a Prohibited Parking Area',
  'Parked in a Prohibited Stop Area',
  'Parked in Accessible Space Access Aisle',
  'Parked in an Accessible Space',
  'Parked in Fire Route',
  'Parked in Laneway',
  'Parked Interfering with Snow Clearing',
  'Parked more than 3 Hours',
  'Parked more than Posted Time Limit',
  'Parked on the Boulevard - Grass',
  'Parked on the Sidewalk',
  'Parked Overhanging Curb',
  'Parked the Wrong Way',
  'Parked Vehicle Obstructing Traffic',
  'Parked within 9M of Intersection',
  'Parking on Grass, Walkway or Other Materials',
  'Time as Posted - No Parking',
  'Time as Posted - No Stopping',
  'Trailer Parked on City Street',
  'Unauthorized Vehicle in Private Driveway',
  'Unauthorized Vehicle Parked on Municipal Property',
  'Unlicensed Vehicle',
  'Vehicle parked in taxi stand',
] as const

/** Address type options for the Location step. */
export const ADDRESS_TYPES = ['Street Address', 'Intersection'] as const

/** Preferred method-of-contact options for the Contact step. */
export const METHOD_OF_CONTACT_OPTIONS = ['Email', 'Phone'] as const

/** Full row of public.resident_service_requests (staff / authenticated view). */
export type ResidentRequestRow = {
  id: string
  case_id: string
  address_type: string | null
  location: string
  city: string | null
  province: string | null
  request_type: string
  description: string | null
  first_name: string
  last_name: string
  resident_name: string
  unit_number: string | null
  postal_code: string | null
  country: string | null
  resident_phone: string | null
  resident_email: string
  resolution_followup: boolean
  method_of_contact: string | null
  status: ResidentStatus
  is_demo: boolean
  created_at: string
  updated_at: string
}

/** Non-sensitive status view returned by get_resident_request_status (public). */
export type ResidentRequestStatus = {
  case_id: string
  resident_name: string
  request_type: string
  location: string
  city: string | null
  status: ResidentStatus
  created_at: string
  updated_at: string
}

/**
 * Fields a resident enters in the multi-step submission form, mirroring the
 * Brampton 311 "Report a Parking Infraction" Service Request Form.
 */
export type ResidentRequestInput = {
  // Location
  addressType: string
  location: string
  city: string
  province: string
  // Details
  requestType: string
  description?: string
  // Contact
  firstName: string
  lastName: string
  unitNumber?: string
  postalCode: string
  country: string
  phone: string
  email: string
  resolutionFollowup: boolean
  methodOfContact: string
}

function requireClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured')
  }
  return supabase
}

// Unambiguous alphabet (no 0/O/1/I) so a case id read off a screen is easy to
// re-type. Used to build the demo reference, e.g. RSR-20260611-7K4Q.
const CASE_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomSuffix(length = 4): string {
  let out = ''
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : undefined
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(length)
    cryptoObj.getRandomValues(bytes)
    for (let i = 0; i < length; i++) out += CASE_ID_ALPHABET[bytes[i] % CASE_ID_ALPHABET.length]
  } else {
    for (let i = 0; i < length; i++) {
      out += CASE_ID_ALPHABET[Math.floor(Math.random() * CASE_ID_ALPHABET.length)]
    }
  }
  return out
}

/** Generate a demo case id, e.g. RSR-20260611-7K4Q. */
export function generateCaseId(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `RSR-${y}${m}${d}-${randomSuffix(4)}`
}

/**
 * Send a resident email through the server-side Brevo function. Best-effort by
 * design: callers never block the user on email delivery. Returns true on a 2xx
 * from the function, false otherwise (including when email is not configured in
 * the environment, e.g. local dev without BREVO_API_KEY).
 */
export async function sendResidentEmail(payload: {
  type: 'confirmation' | 'status_update'
  to: string
  residentName: string
  caseId: string
  requestType?: string | null
  location?: string | null
  status?: ResidentStatus | null
}): Promise<boolean> {
  try {
    const res = await fetch(RESIDENT_EMAIL_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return res.ok
  } catch (err) {
    console.error('Resident email send failed:', err)
    return false
  }
}

export type SubmitResult = {
  caseId: string
  /** Whether the confirmation email was accepted by the email service. */
  emailSent: boolean
}

/**
 * Submit a resident service request (public / anonymous). Inserts a demo row
 * with a generated case id, then sends the confirmation email. The insert is
 * the source of truth; if the unique case id happens to collide it is retried
 * once with a fresh id. Email is best-effort and never fails the submission.
 */
export async function submitResidentRequest(input: ResidentRequestInput): Promise<SubmitResult> {
  const client = requireClient()

  const firstName = input.firstName.trim()
  const lastName = input.lastName.trim()
  const row = {
    address_type: input.addressType.trim() || null,
    location: input.location.trim(),
    city: input.city.trim() || null,
    province: input.province.trim() || null,
    request_type: input.requestType.trim(),
    description: input.description?.trim() ? input.description.trim() : null,
    first_name: firstName,
    last_name: lastName,
    resident_name: `${firstName} ${lastName}`.trim(),
    unit_number: input.unitNumber?.trim() ? input.unitNumber.trim() : null,
    postal_code: input.postalCode.trim() || null,
    country: input.country.trim() || null,
    resident_phone: input.phone.trim() ? input.phone.trim() : null,
    resident_email: input.email.trim().toLowerCase(),
    resolution_followup: input.resolutionFollowup,
    method_of_contact: input.methodOfContact.trim() || null,
    status: 'submitted' as const,
    is_demo: true,
  }

  let caseId = generateCaseId()
  // Anon has no SELECT policy, so we deliberately do NOT chain .select() here —
  // we already know the case id we generated.
  let { error } = await client.from(RESIDENT_REQUESTS_TABLE).insert({ ...row, case_id: caseId })

  // Retry once on a unique-violation (Postgres 23505) with a fresh case id.
  if (error && (error as { code?: string }).code === '23505') {
    caseId = generateCaseId()
    ;({ error } = await client.from(RESIDENT_REQUESTS_TABLE).insert({ ...row, case_id: caseId }))
  }

  if (error) throw error

  const emailSent = await sendResidentEmail({
    type: 'confirmation',
    to: row.resident_email,
    residentName: row.resident_name,
    caseId,
    requestType: row.request_type,
    location: row.location,
  })

  return { caseId, emailSent }
}

/**
 * Public status lookup by case id via the SECURITY DEFINER RPC. Returns the
 * non-sensitive status view, or null if no request matches that case id.
 */
export async function getResidentRequestStatus(caseId: string): Promise<ResidentRequestStatus | null> {
  const client = requireClient()
  const { data, error } = await client.rpc('get_resident_request_status', { p_case_id: caseId })
  if (error) throw error
  const rows = (data ?? []) as ResidentRequestStatus[]
  return rows[0] ?? null
}

const RESIDENT_REQUEST_COLUMNS =
  'id, case_id, address_type, location, city, province, request_type, description, first_name, last_name, resident_name, unit_number, postal_code, country, resident_phone, resident_email, resolution_followup, method_of_contact, status, is_demo, created_at, updated_at'

/** Staff (authenticated) — read resident demo requests, newest first. */
export async function getResidentRequests(limit = 100): Promise<ResidentRequestRow[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(RESIDENT_REQUESTS_TABLE)
    .select(RESIDENT_REQUEST_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as ResidentRequestRow[]
}

export type StaffStatusUpdateResult = {
  row: ResidentRequestRow
  emailSent: boolean
}

/**
 * Apply an explicit staff status update to a resident request. This is the ONLY
 * path that advances a request, and it is only ever called from an explicit
 * staff button click. It:
 *   1. updates resident_service_requests.status,
 *   2. writes a workflow event to the shared audit trail, and
 *   3. sends the resident a status-update email (best-effort).
 *
 * No email is ever sent unless this function runs, i.e. unless staff clicked a
 * status action.
 */
export async function applyStaffStatusUpdate(
  request: ResidentRequestRow,
  action: { toStatus: ResidentStatus; eventType: string; label: string },
): Promise<StaffStatusUpdateResult> {
  const client = requireClient()
  const fromStatus = request.status

  const { data, error } = await client
    .from(RESIDENT_REQUESTS_TABLE)
    .update({ status: action.toStatus })
    .eq('case_id', request.case_id)
    .select(RESIDENT_REQUEST_COLUMNS)
    .single()
  if (error) throw error
  const updated = data as ResidentRequestRow

  // Record the staff action on the shared workflow audit trail.
  await addWorkflowEvent({
    case_id: request.case_id,
    event_type: action.eventType,
    event_label: `Resident intake: ${action.label}`,
    from_status: STATUS_LABELS[fromStatus],
    to_status: STATUS_LABELS[action.toStatus],
    actor_type: 'staff',
    notes: 'Resident Intake Demo status update',
  })

  // Notify the resident — only because staff explicitly clicked this action.
  const emailSent = await sendResidentEmail({
    type: 'status_update',
    to: updated.resident_email,
    residentName: updated.resident_name,
    caseId: updated.case_id,
    requestType: updated.request_type,
    location: updated.location,
    status: action.toStatus,
  })

  return { row: updated, emailSent }
}
