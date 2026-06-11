// Server-side Netlify function that sends resident-facing transactional email
// for the Resident Intake Demo flow, through Brevo (https://www.brevo.com).
//
// SECURITY
// --------
// The Brevo API key is read from the Netlify environment variable BREVO_API_KEY
// and is used ONLY inside this server-side function. It is never sent to the
// browser, never exposed through a VITE_* variable, and never logged. Do NOT
// create VITE_BREVO_API_KEY — the key must stay server side.
//
// SENDER
// ------
// The "from" address must be a sender that is configured and verified in the
// Brevo account. It is read from BREVO_SENDER_EMAIL (and optional
// BREVO_SENDER_NAME) so the verified sender can change without a code change.
//
// SCOPE & GOVERNANCE
// ------------------
// Two payload types only:
//   * 'confirmation'  — sent once when a resident submits a request.
//   * 'status_update' — sent when authorized staff explicitly advance a request
//                       in the workbench (one email per explicit staff action).
// This function only sends the single email described by the request body. It
// does not read or write any database, does not loop over recipients, and is
// never invoked automatically — the frontend calls it on an explicit resident
// submission or an explicit staff status-change click.

// Netlify Functions v2 web-standard handler. Node 20 provides a global fetch,
// so no Brevo SDK dependency is required. The client calls the reserved
// /.netlify/functions/send-resident-email endpoint, which the SPA catch-all
// redirect never shadows.

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

// Fallback sender used only if BREVO_SENDER_EMAIL is not set. This must still be
// a verified sender in the Brevo account for delivery to succeed.
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
  completed: 'Completed',
}

// What the resident should expect next, by status — used in the status email.
const STATUS_NEXT: Record<string, string> = {
  received: 'Your request has been received by municipal staff and is in the queue for review.',
  assigned: 'Your request has been assigned to a staff member who will look into it.',
  in_review: 'A staff member is actively reviewing your request.',
  completed: 'Your request has been marked completed. Thank you for helping keep the city in good shape.',
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

type BrevoPayload = {
  sender: { name: string; email: string }
  to: Array<{ email: string; name?: string }>
  subject: string
  htmlContent: string
  textContent: string
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

// Minimal, defensive email shape check. Brevo does the real validation; this
// just rejects obvious non-addresses before we spend an API call.
function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

// HTML-escape any resident-supplied text before it goes into htmlContent.
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

const DEMO_FOOTER_TEXT =
  'This is an automated message from a proof-of-concept demo. Please do not reply.'

function senderFromEnv(): { name: string; email: string } {
  const email = (process.env.BREVO_SENDER_EMAIL || '').trim() || DEFAULT_SENDER_EMAIL
  const name = (process.env.BREVO_SENDER_NAME || '').trim() || DEFAULT_SENDER_NAME
  return { name, email }
}

// Helper payload builder for the resident confirmation email.
function buildConfirmationPayload(input: EmailRequest): BrevoPayload {
  const name = input.residentName || 'there'
  const safeName = escapeHtml(name)
  const caseId = escapeHtml(input.caseId)
  const requestType = input.requestType ? escapeHtml(input.requestType) : null
  const location = input.location ? escapeHtml(input.location) : null

  const subject = `We received your service request — ${input.caseId}`

  const detailRows = [
    `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Reference</td><td style="font-weight:600">${caseId}</td></tr>`,
    requestType
      ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Request type</td><td>${requestType}</td></tr>`
      : '',
    location
      ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Location</td><td>${location}</td></tr>`
      : '',
  ].join('')

  const htmlContent = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:560px">
      <p>Hi ${safeName},</p>
      <p>Thanks for reaching out. We have received your service request and created a reference for it.</p>
      <table style="font-size:14px;margin:12px 0">${detailRows}</table>
      <p>Municipal staff will review your request. We will email you as the status changes — submitted, received, under review, and completed.</p>
      <p style="color:#64748b;font-size:12px;margin-top:24px">${DEMO_FOOTER_TEXT}</p>
    </div>`

  const textContent = [
    `Hi ${name},`,
    '',
    'Thanks for reaching out. We have received your service request and created a reference for it.',
    '',
    `Reference: ${input.caseId}`,
    input.requestType ? `Request type: ${input.requestType}` : '',
    input.location ? `Location: ${input.location}` : '',
    '',
    'Municipal staff will review your request. We will email you as the status changes — submitted, received, under review, and completed.',
    '',
    DEMO_FOOTER_TEXT,
  ]
    .filter((line) => line !== '')
    .join('\n')

  return { sender: senderFromEnv(), to: [{ email: input.to, name }], subject, htmlContent, textContent }
}

// Helper payload builder for the status-update email.
function buildStatusUpdatePayload(input: EmailRequest): BrevoPayload {
  const name = input.residentName || 'there'
  const safeName = escapeHtml(name)
  const caseId = escapeHtml(input.caseId)
  const label = statusLabel(input.status)
  const safeLabel = escapeHtml(label)
  const next = (input.status && STATUS_NEXT[input.status]) || 'Your request status has been updated.'
  const safeNext = escapeHtml(next)

  const subject = `Update on your service request ${input.caseId} — ${label}`

  const htmlContent = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:560px">
      <p>Hi ${safeName},</p>
      <p>There is an update on your service request <strong>${caseId}</strong>.</p>
      <p style="font-size:16px">New status: <strong>${safeLabel}</strong></p>
      <p>${safeNext}</p>
      <p style="color:#64748b;font-size:12px;margin-top:24px">${DEMO_FOOTER_TEXT}</p>
    </div>`

  const textContent = [
    `Hi ${name},`,
    '',
    `There is an update on your service request ${input.caseId}.`,
    '',
    `New status: ${label}`,
    next,
    '',
    DEMO_FOOTER_TEXT,
  ].join('\n')

  return { sender: senderFromEnv(), to: [{ email: input.to, name }], subject, htmlContent, textContent }
}

function buildPayload(input: EmailRequest): BrevoPayload {
  return input.type === 'confirmation' ? buildConfirmationPayload(input) : buildStatusUpdatePayload(input)
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed. Use POST.' }, 405)
  }

  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) {
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
    return json({ error: 'A valid email request (type confirmation or status_update) is required.' }, 400)
  }
  if (!input.to || !isLikelyEmail(input.to)) {
    return json({ error: 'A valid recipient email address is required.' }, 400)
  }
  if (!input.caseId) {
    return json({ error: 'A case id is required.' }, 400)
  }
  if (input.type === 'status_update' && !input.status) {
    return json({ error: 'A status is required for a status update email.' }, 400)
  }

  const payload = buildPayload(input)

  let brevoRes: Response
  try {
    brevoRes = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    console.error('Resident email request failed to reach Brevo:', errorText(err))
    return json({ error: 'Could not reach the email service. Try again.' }, 502)
  }

  if (!brevoRes.ok) {
    let detail = ''
    try {
      detail = (await brevoRes.text()).slice(0, 1000)
    } catch (err) {
      detail = `<unreadable response body: ${errorText(err)}>`
    }
    console.error('Brevo API returned a non-OK status:', brevoRes.status, detail)
    return json({ error: 'Email service error. Please check the server logs.' }, 502)
  }

  let messageId: string | null = null
  try {
    const data = (await brevoRes.json()) as { messageId?: string }
    messageId = data.messageId ?? null
  } catch {
    // Brevo normally returns { messageId }, but a missing/garbled body is not
    // fatal — the send already succeeded (2xx). Report ok without an id.
  }

  return json({ ok: true, type: input.type, messageId })
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
