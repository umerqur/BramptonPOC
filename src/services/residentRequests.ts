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
// public.resident_service_requests, kept separate from the NYC 311
// benchmark data in municipal_complaints.

export const RESIDENT_REQUESTS_TABLE = 'resident_service_requests'

/** Metadata table + private Storage bucket for resident-uploaded attachments. */
export const RESIDENT_ATTACHMENTS_TABLE = 'resident_request_attachments'
export const RESIDENT_ATTACHMENTS_BUCKET = 'resident-request-attachments'

/** Max accepted size per uploaded file (10 MB). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
/** Human-readable accepted-files hint for the resident form. */
export const ACCEPTED_ATTACHMENT_HINT = 'Images (PNG, JPG, GIF, WEBP) or PDF · up to 10 MB each'
/** `accept` attribute for the file input — images and PDFs only. */
export const ACCEPTED_ATTACHMENT_INPUT = 'image/*,application/pdf'

/** Whether a file is an accepted attachment type (image or PDF) and not oversized. */
export function isAcceptedAttachmentType(file: File): boolean {
  const type = (file.type || '').toLowerCase()
  return type === 'application/pdf' || type.startsWith('image/')
}

/** Per-file attachment metadata stored in resident_request_attachments. */
export type ResidentRequestAttachment = {
  id: string
  case_id: string
  file_name: string
  file_path: string
  content_type: string | null
  file_size_bytes: number | null
  uploaded_at: string
}

/** Server-side Netlify function that sends resident email via Mailjet. */
const RESIDENT_EMAIL_ENDPOINT = '/.netlify/functions/send-resident-email'

export const RESIDENT_DEMO_NOTICE =
  'This is a public demo of a resident service-request flow. Do not enter real personal information — submissions are stored as demo data only.'

// Canonical status values stored on resident_service_requests.status. These
// mirror the enforcement intake-to-closure lifecycle used across the app
// (Intake -> Triage -> Staff review -> Closure): a request is submitted, then
// staff move it through received (triage), assigned (to an officer), in_review
// (active review / inspection), and finally closed.
export type ResidentStatus = 'submitted' | 'received' | 'assigned' | 'in_review' | 'closed'

/** Human-readable label for each status. */
export const STATUS_LABELS: Record<ResidentStatus, string> = {
  submitted: 'Submitted',
  received: 'Received',
  assigned: 'Assigned',
  in_review: 'Under review',
  closed: 'Closed',
}

/**
 * The resident-facing tracker stages, one per canonical status, in order. The
 * public status page highlights the active one.
 */
export const RESIDENT_STAGES = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'received', label: 'Received' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'in_review', label: 'Under review' },
  { key: 'closed', label: 'Closed' },
] as const

/** Index of the active resident tracker stage (0–4) for a given status. */
export function stageIndexForStatus(status: string): number {
  switch (status) {
    case 'submitted':
      return 0
    case 'received':
      return 1
    case 'assigned':
      return 2
    case 'in_review':
      return 3
    case 'closed':
      return 4
    default:
      return 0
  }
}

/**
 * The explicit staff actions, in workflow order, mirroring the enforcement
 * lifecycle all the way to closure. Each maps to a target status, a button
 * label, and the workflow-event type recorded in the audit trail. Each action,
 * on an explicit staff click, also emails the resident.
 */
export const STAFF_ACTIONS: Array<{
  toStatus: ResidentStatus
  label: string
  eventType: string
}> = [
  { toStatus: 'received', label: 'Mark received', eventType: 'resident_request_received' },
  { toStatus: 'assigned', label: 'Assign to officer', eventType: 'resident_request_assigned' },
  { toStatus: 'in_review', label: 'Move to review', eventType: 'resident_request_in_review' },
  { toStatus: 'closed', label: 'Close case', eventType: 'resident_request_closed' },
]

/**
 * General municipal enforcement complaint types. This is a simple intake list
 * covering the common by-law concerns residents report — not a parking-only
 * ticket form. Staff-side triage maps each type to a recommended department.
 */
export const ENFORCEMENT_COMPLAINT_TYPES = [
  'Parking issue',
  'Property standards',
  'Noise complaint',
  'Illegal dumping',
  'Yard maintenance',
  'Zoning concern',
  'Other bylaw concern',
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
 * Fields a resident enters in the multi-step submission form, modelled on a
 * general Brampton 311 by-law / enforcement complaint Service Request Form.
 */
export type ResidentRequestInput = {
  // Location of concern
  addressType: string
  location: string
  concernUnitNumber?: string
  city: string
  province: string
  concernPostalCode?: string

  // Details
  requestType: string
  description: string
  happeningNow?: string
  /** Real files the resident attaches (photos / PDFs). Uploaded to Storage. */
  files?: File[]

  // Contact
  firstName: string
  lastName: string
  contactUnitNumber?: string
  contactStreetAddress?: string
  contactCity?: string
  contactProvince?: string
  contactPostalCode: string
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
 * Send a resident email through the server-side Mailjet function. Best-effort by
 * design: callers never block the user on email delivery. Returns true on a 2xx
 * from the function, false otherwise (including when email is not configured in
 * the environment, e.g. local dev without Mailjet keys).
 */
// Synthetic seed/sample cases use reserved @example.* demo addresses; we never
// try to email those. A real resident email (entered in the intake form, or
// carried over from a real resident submission) is sent for real. Shared by the
// workbench (officer milestones) and the closure page.
const RESERVED_EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net']

export function isSendableEmail(email: string): boolean {
  const value = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return false
  const domain = value.split('@')[1] ?? ''
  return !RESERVED_EMAIL_DOMAINS.includes(domain)
}

export async function sendResidentEmail(payload: {
  type: 'confirmation' | 'status_update' | 'field_update' | 'closure'
  to: string
  residentName: string
  caseId: string
  requestType?: string | null
  location?: string | null
  status?: ResidentStatus | null
  /** Subject + message body — used by 'field_update' and 'closure' emails. */
  subject?: string | null
  message?: string | null
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
  /** Number of resident attachments successfully stored. */
  attachmentsUploaded: number
  /** True if one or more selected attachments failed to upload. */
  attachmentError: boolean
}

/** Sanitize a filename to a safe storage object name (keeps a useful suffix). */
function safeFileName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '')
  return cleaned.slice(-100) || 'file'
}

/**
 * Upload the resident's files to the private Storage bucket under
 * resident-requests/{caseId}/… and record each one in resident_request_attachments.
 * Best-effort per file: a single failed file does not abort the others. Returns
 * how many succeeded and how many failed so the caller can warn the resident.
 */
async function uploadResidentAttachments(
  client: NonNullable<typeof supabase>,
  caseId: string,
  files: File[],
): Promise<{ uploaded: number; failed: number }> {
  let uploaded = 0
  let failed = 0

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    // Defensive validation (the form validates too): images / PDFs, ≤ 10 MB.
    if (!isAcceptedAttachmentType(file) || file.size > MAX_ATTACHMENT_BYTES) {
      failed++
      continue
    }

    const path = `resident-requests/${caseId}/${Date.now()}-${i}-${safeFileName(file.name)}`
    const { error: uploadError } = await client.storage
      .from(RESIDENT_ATTACHMENTS_BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false })
    if (uploadError) {
      console.error('Resident attachment upload failed:', uploadError)
      failed++
      continue
    }

    const { error: metaError } = await client.from(RESIDENT_ATTACHMENTS_TABLE).insert({
      case_id: caseId,
      file_name: file.name,
      file_path: path,
      content_type: file.type || null,
      file_size_bytes: file.size,
    })
    if (metaError) {
      console.error('Resident attachment metadata insert failed:', metaError)
      failed++
      continue
    }
    uploaded++
  }

  return { uploaded, failed }
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

  // Demo-only fields the public form collects but the existing schema has no
  // dedicated columns for are appended into the description, so we avoid a DB
  // migration while still preserving the resident's input for staff review.
  const baseDescription = input.description.trim()
  const demoDetailLines = [
    input.happeningNow ? `Is this happening now: ${input.happeningNow}` : null,
    input.concernUnitNumber ? `Location unit or apartment number: ${input.concernUnitNumber.trim()}` : null,
    input.concernPostalCode ? `Location postal code: ${input.concernPostalCode.trim()}` : null,
    input.contactStreetAddress ? `Contact street address: ${input.contactStreetAddress.trim()}` : null,
    input.contactCity ? `Contact city: ${input.contactCity.trim()}` : null,
    input.contactProvince ? `Contact province: ${input.contactProvince.trim()}` : null,
  ].filter((line): line is string => Boolean(line))

  const combinedDescription = [
    baseDescription,
    demoDetailLines.length > 0 ? `Demo form details:\n${demoDetailLines.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const row = {
    address_type: input.addressType.trim() || null,
    location: input.location.trim(),
    city: input.city.trim() || null,
    province: input.province.trim() || null,
    request_type: input.requestType.trim(),
    description: combinedDescription || null,
    first_name: firstName,
    last_name: lastName,
    resident_name: `${firstName} ${lastName}`.trim(),
    unit_number: input.contactUnitNumber?.trim() ? input.contactUnitNumber.trim() : null,
    postal_code: input.contactPostalCode.trim() || null,
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

  // Upload any attached files to private Storage and record their metadata,
  // linked to this case id. The request row is already saved, so an upload
  // failure here never loses the request — it surfaces as a warning instead.
  let attachmentsUploaded = 0
  let attachmentError = false
  if (input.files && input.files.length > 0) {
    try {
      const result = await uploadResidentAttachments(client, caseId, input.files)
      attachmentsUploaded = result.uploaded
      attachmentError = result.failed > 0
    } catch (err) {
      console.error('Resident attachment upload failed:', err)
      attachmentError = true
    }
  }

  // Only the resident is ever emailed — first this confirmation, then a message
  // on each staff-driven status change. Staff do not receive email.
  const emailSent = await sendResidentEmail({
    type: 'confirmation',
    to: row.resident_email,
    residentName: row.resident_name,
    caseId,
    requestType: row.request_type,
    location: row.location,
  })

  return { caseId, emailSent, attachmentsUploaded, attachmentError }
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

/**
 * Mark the linked resident request closed when a closure response is approved in
 * the Closure Review Workbench. Updates resident_service_requests.status to
 * 'closed' and writes a workflow event for the audit trail.
 *
 * IMPORTANT: this deliberately does NOT call sendResidentEmail. The rich
 * `closure` email is already sent from AppClosureDraftsPage, so emailing here
 * would deliver a duplicate generic "closed" status email to the resident.
 */
export async function markResidentRequestClosedFromClosureReview(
  caseId: string,
): Promise<ResidentRequestRow> {
  const client = requireClient()

  // a. read the existing row
  const { data: existing, error: readError } = await client
    .from(RESIDENT_REQUESTS_TABLE)
    .select(RESIDENT_REQUEST_COLUMNS)
    .eq('case_id', caseId)
    .single()
  if (readError) throw readError

  // b. capture the prior status
  const priorStatus = (existing as ResidentRequestRow).status

  // c. update status to closed
  const { data: updated, error: updateError } = await client
    .from(RESIDENT_REQUESTS_TABLE)
    .update({ status: 'closed' })
    .eq('case_id', caseId)
    .select(RESIDENT_REQUEST_COLUMNS)
    .single()
  if (updateError) throw updateError

  // d. write a workflow event (no email)
  await addWorkflowEvent({
    case_id: caseId,
    event_type: 'resident_request_closed',
    event_label: 'Closure Review: Case closed',
    from_status: STATUS_LABELS[priorStatus],
    to_status: STATUS_LABELS.closed,
    actor_type: 'staff',
    notes: 'Final closure response approved through Closure Review Workbench',
  })

  // e. return the updated row
  return updated as ResidentRequestRow
}

const ATTACHMENT_COLUMNS = 'id, case_id, file_name, file_path, content_type, file_size_bytes, uploaded_at'

/** Staff (authenticated) — read attachment metadata for a single case, oldest first. */
export async function getResidentRequestAttachments(caseId: string): Promise<ResidentRequestAttachment[]> {
  const client = requireClient()
  const { data, error } = await client
    .from(RESIDENT_ATTACHMENTS_TABLE)
    .select(ATTACHMENT_COLUMNS)
    .eq('case_id', caseId)
    .order('uploaded_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ResidentRequestAttachment[]
}

/**
 * Staff (authenticated) — read attachment metadata for many cases in one query.
 * Used by the Work Queue to show an attachment count per card without N requests.
 */
export async function getResidentRequestAttachmentsForCases(
  caseIds: string[],
): Promise<ResidentRequestAttachment[]> {
  if (caseIds.length === 0) return []
  const client = requireClient()
  const { data, error } = await client
    .from(RESIDENT_ATTACHMENTS_TABLE)
    .select(ATTACHMENT_COLUMNS)
    .in('case_id', caseIds)
    .order('uploaded_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ResidentRequestAttachment[]
}

/**
 * Staff (authenticated) — mint a short-lived signed URL to view one private
 * attachment object. The bucket is never public; this URL expires quickly.
 */
export async function createAttachmentSignedUrl(filePath: string, expiresInSeconds = 120): Promise<string> {
  const client = requireClient()
  const { data, error } = await client.storage
    .from(RESIDENT_ATTACHMENTS_BUCKET)
    .createSignedUrl(filePath, expiresInSeconds)
  if (error) throw error
  if (!data?.signedUrl) throw new Error('Could not create a view link for this file.')
  return data.signedUrl
}

/** True when an attachment's content type is an image (for inline preview hints). */
export function isImageAttachment(att: ResidentRequestAttachment): boolean {
  return (att.content_type ?? '').toLowerCase().startsWith('image/')
}
