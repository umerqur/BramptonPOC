// Server-side Netlify function that sends resident-facing transactional email
// for the Resident Intake Demo flow, through Mailjet (https://www.mailjet.com).
//
// Only the RESIDENT is ever emailed. Staff receive no email — they drive the
// workflow, and each staff stage change triggers an email to the resident.
//
// SECURITY
// --------
// The Mailjet credentials are read from the Netlify environment variables
// MJ_APIKEY_PUBLIC (API key) and MJ_APIKEY_PRIVATE (secret key), used ONLY
// inside this server-side function via HTTP Basic Auth. They are never sent to
// the browser, never exposed through a VITE_* variable, and never logged. Do
// NOT create VITE_MJ_* variables — the keys must stay server side.
//
// SENDER
// ------
// The "from" address must be a sender (or domain) that is validated in the
// Mailjet account. It is read from MAILJET_SENDER_EMAIL (and optional
// MAILJET_SENDER_NAME).
//
// SCOPE & GOVERNANCE
// ------------------
// Two payload types only, both to the resident:
//   * 'confirmation'  — once, when the resident submits.
//   * 'status_update' — on an explicit staff stage change.
// This function only sends the single email described by the request body. It
// does not read or write any database and is never invoked automatically.

// Mailjet Send API v3.1. Node 20 provides a global fetch and Buffer, so no
// Mailjet SDK dependency is required. The client calls the reserved
// /.netlify/functions/send-resident-email endpoint, which the SPA catch-all
// redirect never shadows.
const MAILJET_API_URL = 'https://api.mailjet.com/v3.1/send'

// Fallback sender used only if MAILJET_SENDER_EMAIL is not set. This must still
// be a validated sender in the Mailjet account for delivery to succeed.
const DEFAULT_SENDER_EMAIL = 'no-reply@bramptonpoc.netlify.app'
const DEFAULT_SENDER_NAME = 'Brampton 311 Resident Services (Demo)'

// Keep free-text fields bounded so the email payload stays predictable.
const MAX_NAME_LEN = 120
const MAX_FIELD_LEN = 200

// Human-readable label for each canonical status. Kept in sync with the
// frontend resident-request status model.
const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  received: 'Received',
  assigned: 'Assigned',
  in_review: 'Under review',
  closed: 'Closed',
}

// What the resident should expect next, by status — used in the status email.
const STATUS_NEXT: Record<string, string> = {
  received: 'Your request has been received by municipal staff and is in the queue for review.',
  assigned: 'Your request has been assigned to an officer who will investigate.',
  in_review: 'An officer is actively reviewing your request.',
  closed: 'Your request has been closed. Thank you for helping keep the city in good shape.',
}

type EmailType = 'confirmation' | 'status_update'

type EmailRequest = {
  type: EmailType
  to: string
  residentName: string
  caseId: string
  requestType: string | null
  location: string | null
  status: string | null
}

// Neutral, provider-agnostic email content produced by the builders below.
type EmailContent = {
  subject: string
  html: string
  text: string
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function str(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

function clean(value: unknown, max: number): string {
  return str(value).trim().slice(0, max)
}

function cleanOrNull(value: unknown, max: number): string | null {
  const s = clean(value, max)
  return s ? s : null
}

// Minimal, defensive email shape check. Mailjet does the real validation; this
// just rejects obvious non-addresses before we spend an API call.
function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

// HTML-escape any caller-supplied text before it goes into the HTML part.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function statusLabel(status: string | null): string {
  if (!status) return 'Updated'
  return STATUS_LABELS[status] ?? status
}

function sanitizeRequest(raw: unknown): EmailRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  const type = str(obj.type).trim()
  if (type !== 'confirmation' && type !== 'status_update') return null

  return {
    type,
    to: clean(obj.to, MAX_FIELD_LEN).toLowerCase(),
    residentName: clean(obj.residentName, MAX_NAME_LEN),
    caseId: clean(obj.caseId, MAX_FIELD_LEN),
    requestType: cleanOrNull(obj.requestType, MAX_FIELD_LEN),
    location: cleanOrNull(obj.location, MAX_FIELD_LEN),
    status: cleanOrNull(obj.status, 40),
  }
}

const DEMO_FOOTER_TEXT = 'This is an automated message from a proof-of-concept demo. Please do not reply.'

function senderFromEnv(): { email: string; name: string } {
  const email = (process.env.MAILJET_SENDER_EMAIL || '').trim() || DEFAULT_SENDER_EMAIL
  const name = (process.env.MAILJET_SENDER_NAME || '').trim() || DEFAULT_SENDER_NAME
  return { email, name }
}

// Helper content builder for the resident confirmation email.
function buildConfirmationContent(input: EmailRequest): EmailContent {
  const name = input.residentName || 'there'
  const safeName = escapeHtml(name)
  const caseId = escapeHtml(input.caseId)
  const requestType = input.requestType ? escapeHtml(input.requestType) : null
  const location = input.location ? escapeHtml(input.location) : null

  const subject = `We received your service request — ${input.caseId}`

  const detailRows = [
    `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Reference</td><td style="font-weight:600">${caseId}</td></tr>`,
    requestType
      ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Problem type</td><td>${requestType}</td></tr>`
      : '',
    location
      ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Location</td><td>${location}</td></tr>`
      : '',
  ].join('')

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:560px">
      <p>Hi ${safeName},</p>
      <p>Thanks for reaching out. We have received your service request and created a reference for it.</p>
      <table style="font-size:14px;margin:12px 0">${detailRows}</table>
      <p>Municipal staff will review your request. We will email you as the status changes — submitted, received, assigned, under review, and closed.</p>
      <p style="color:#64748b;font-size:12px;margin-top:24px">${DEMO_FOOTER_TEXT}</p>
    </div>`

  const text = [
    `Hi ${name},`,
    '',
    'Thanks for reaching out. We have received your service request and created a reference for it.',
    '',
    `Reference: ${input.caseId}`,
    input.requestType ? `Problem type: ${input.requestType}` : '',
    input.location ? `Location: ${input.location}` : '',
    '',
    'Municipal staff will review your request. We will email you as the status changes — submitted, received, assigned, under review, and closed.',
    '',
    DEMO_FOOTER_TEXT,
  ]
    .filter((line) => line !== '')
    .join('\n')

  return { subject, html, text }
}

// Helper content builder for the status-update email.
function buildStatusUpdateContent(input: EmailRequest): EmailContent {
  const name = input.residentName || 'there'
  const safeName = escapeHtml(name)
  const caseId = escapeHtml(input.caseId)
  const label = statusLabel(input.status)
  const safeLabel = escapeHtml(label)
  const next = (input.status && STATUS_NEXT[input.status]) || 'Your request status has been updated.'
  const safeNext = escapeHtml(next)

  const subject = `Update on your service request ${input.caseId} — ${label}`

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:560px">
      <p>Hi ${safeName},</p>
      <p>There is an update on your service request <strong>${caseId}</strong>.</p>
      <p style="font-size:16px">New status: <strong>${safeLabel}</strong></p>
      <p>${safeNext}</p>
      <p style="color:#64748b;font-size:12px;margin-top:24px">${DEMO_FOOTER_TEXT}</p>
    </div>`

  const text = [
    `Hi ${name},`,
    '',
    `There is an update on your service request ${input.caseId}.`,
    '',
    `New status: ${label}`,
    next,
    '',
    DEMO_FOOTER_TEXT,
  ].join('\n')

  return { subject, html, text }
}

function buildContent(input: EmailRequest): EmailContent {
  return input.type === 'confirmation' ? buildConfirmationContent(input) : buildStatusUpdateContent(input)
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed. Use POST.' }, 405)
  }

  const apiKey = process.env.MJ_APIKEY_PUBLIC
  const secretKey = process.env.MJ_APIKEY_PRIVATE
  if (!apiKey || !secretKey) {
    return json({ error: 'Resident email is not configured in this environment.' }, 503)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400)
  }

  const input = sanitizeRequest(body)
  if (!input) {
    return json({ error: 'A valid email request type is required.' }, 400)
  }
  if (!input.caseId) {
    return json({ error: 'A case id is required.' }, 400)
  }
  if (!input.to || !isLikelyEmail(input.to)) {
    return json({ error: 'A valid recipient email address is required.' }, 400)
  }
  if (input.type === 'status_update' && !input.status) {
    return json({ error: 'A status is required for a status update email.' }, 400)
  }

  const content = buildContent(input)
  const sender = senderFromEnv()
  const mailjetBody = {
    Messages: [
      {
        From: { Email: sender.email, Name: sender.name },
        To: [{ Email: input.to, Name: input.residentName || input.to }],
        Subject: content.subject,
        TextPart: content.text,
        HTMLPart: content.html,
        // Trace any resident email back to its request by case id in Mailjet.
        CustomID: input.caseId,
      },
    ],
  }

  // HTTP Basic Auth: API key as username, secret key as password.
  const auth = Buffer.from(`${apiKey}:${secretKey}`).toString('base64')

  let mailjetRes: Response
  try {
    mailjetRes = await fetch(MAILJET_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(mailjetBody),
    })
  } catch (err) {
    console.error('Resident email request failed to reach Mailjet:', errorText(err))
    return json({ error: 'Could not reach the email service. Try again.' }, 502)
  }

  if (!mailjetRes.ok) {
    let detail = ''
    try {
      detail = (await mailjetRes.text()).slice(0, 1000)
    } catch (err) {
      detail = `<unreadable response body: ${errorText(err)}>`
    }
    console.error('Mailjet API returned a non-OK status:', mailjetRes.status, detail)
    return json({ error: 'Email service error. Please check the server logs.' }, 502)
  }

  // Mailjet returns { Messages: [{ Status, Errors?, To: [{ MessageID, ... }] }] }.
  // MessageID is numeric; Status is per-message ("success" or "error").
  let messageId: string | null = null
  let messageStatus: string | null = null
  type MjMessage = {
    Status?: string
    Errors?: Array<{ ErrorCode?: string; ErrorMessage?: string; ErrorRelatedTo?: string[] }>
    To?: Array<{ MessageID?: string | number }>
  }
  let first: MjMessage | undefined
  try {
    const data = (await mailjetRes.json()) as { Messages?: MjMessage[] }
    first = data.Messages?.[0]
    messageStatus = first?.Status ?? null
    const id = first?.To?.[0]?.MessageID
    messageId = id != null ? String(id) : null
  } catch {
    // A 2xx with an unreadable body still means the send was accepted.
  }

  // Mailjet returns 200 even when an individual message errors; treat a
  // non-"success" per-message status as a failure so the caller knows, and log
  // Mailjet's structured error (e.g. send-0008 "sender not authorized").
  if (messageStatus && messageStatus.toLowerCase() !== 'success') {
    console.error('Mailjet per-message status was not success:', messageStatus, JSON.stringify(first?.Errors ?? []))
    return json({ error: 'Email was not accepted by the email service.' }, 502)
  }

  return json({ ok: true, type: input.type, messageId })
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
