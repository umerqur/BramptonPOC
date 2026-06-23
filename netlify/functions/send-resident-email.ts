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
// Four payload types only, all to the resident:
//   * 'confirmation'  — once, when the resident submits.
//   * 'status_update' — on an explicit staff stage change.
//   * 'field_update'  — on an explicit officer field-visit milestone; carries a
//                       resident-safe message body.
//   * 'closure'       — on an explicit staff approval of the closure response;
//                       carries the staff-approved subject + message body.
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
const DEFAULT_SENDER_NAME = 'Neural Forge'

// Reply-To for resident emails. Replies from residents go to a monitored
// mailbox rather than the no-reply sender. Not a secret — a public contact
// address — so it is safe to keep as a constant.
const REPLY_TO_EMAIL = 'umer@neuralforge.ca'
const REPLY_TO_NAME = 'Neural Forge'

// Keep free-text fields bounded so the email payload stays predictable.
const MAX_NAME_LEN = 120
const MAX_FIELD_LEN = 200
// Closure messages are multi-paragraph, staff-approved bodies, so they get a
// larger bound than the short metadata fields above.
const MAX_MESSAGE_LEN = 4000

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

type EmailType = 'confirmation' | 'status_update' | 'field_update' | 'closure'

type EmailRequest = {
  type: EmailType
  to: string
  residentName: string
  caseId: string
  requestType: string | null
  location: string | null
  status: string | null
  // Staff-approved closure subject + message body. Used only by 'closure' emails.
  subject: string | null
  message: string | null
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

// Render a plain-text block (e.g. the staff-approved closure body) into the HTML
// part: escape it, then preserve the resident's line breaks as <br />.
function textToHtml(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br />')
}

function statusLabel(status: string | null): string {
  if (!status) return 'Updated'
  return STATUS_LABELS[status] ?? status
}

function sanitizeRequest(raw: unknown): EmailRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  const type = str(obj.type).trim()
  if (type !== 'confirmation' && type !== 'status_update' && type !== 'field_update' && type !== 'closure') return null

  return {
    type,
    to: clean(obj.to, MAX_FIELD_LEN).toLowerCase(),
    residentName: clean(obj.residentName, MAX_NAME_LEN),
    caseId: clean(obj.caseId, MAX_FIELD_LEN),
    requestType: cleanOrNull(obj.requestType, MAX_FIELD_LEN),
    location: cleanOrNull(obj.location, MAX_FIELD_LEN),
    status: cleanOrNull(obj.status, 40),
    subject: cleanOrNull(obj.subject, MAX_FIELD_LEN),
    message: cleanOrNull(obj.message, MAX_MESSAGE_LEN),
  }
}

// Branded, image-free text header shown at the top of every resident email.
const EMAIL_HEADER_TITLE = 'Proactive Enforcement Response'
const EMAIL_HEADER_SUBTITLE = 'Resident service request'

// Footer disclaimer on every email — this is a demo, not an official service.
const DEMO_FOOTER_TEXT = 'This is a proof of concept demo and is not an official City of Brampton service.'

function senderFromEnv(): { email: string; name: string } {
  const email = (process.env.MAILJET_SENDER_EMAIL || '').trim() || DEFAULT_SENDER_EMAIL
  const name = (process.env.MAILJET_SENDER_NAME || '').trim() || DEFAULT_SENDER_NAME
  return { email, name }
}

// Public production default used only if no environment URL is configured.
const DEFAULT_PUBLIC_SITE_URL = 'https://bramptonpoc.netlify.app'

// Resolve the public site base URL for resident-facing links. Prefer an explicit
// PUBLIC_SITE_URL, then the Netlify-provided deploy URLs (URL, DEPLOY_PRIME_URL),
// then the production default. Any trailing slash is trimmed so joined paths
// never produce a double slash.
function siteBaseUrl(): string {
  const raw =
    (process.env.PUBLIC_SITE_URL || '').trim() ||
    (process.env.URL || '').trim() ||
    (process.env.DEPLOY_PRIME_URL || '').trim() ||
    DEFAULT_PUBLIC_SITE_URL
  return raw.replace(/\/+$/, '')
}

/** Public resident status-tracking URL for a given case id. */
function statusUrlForCase(caseId: string): string {
  return `${siteBaseUrl()}/resident/status/${encodeURIComponent(caseId)}`
}

// Email-safe "Track request status" CTA button: dark navy background, white
// text, rounded corners, all via inline styles so it renders without any
// external CSS. `url` is HTML-escaped for the href.
function statusButton(url: string): string {
  const safeUrl = escapeHtml(url)
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 0;">
      <tr>
        <td style="border-radius:8px;background-color:#0f172a;">
          <a href="${safeUrl}" target="_blank" style="display:inline-block;padding:12px 22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:8px;">Track request status</a>
        </td>
      </tr>
    </table>`
}

// Render a labelled detail table (reference / request type / location / status)
// using email-safe inline styles. Values must already be HTML-escaped.
function detailTable(rows: Array<[string, string]>): string {
  const body = rows
    .map(
      ([label, value]) =>
        `<tr>
          <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:13px;width:150px;vertical-align:top;">${label}</td>
          <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#0f172a;font-size:14px;font-weight:600;">${value}</td>
        </tr>`,
    )
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;border-top:1px solid #f1f5f9;">${body}</table>`
}

// Wrap email body content in the shared branded card shell. No external images
// and no tracking pixels — the header is plain styled text.
function htmlShell(innerHtml: string): string {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f1f5f9;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
            <tr>
              <td style="background-color:#0f172a;padding:22px 28px;">
                <div style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.2px;">${EMAIL_HEADER_TITLE}</div>
                <div style="color:#94a3b8;font-size:13px;margin-top:3px;">${EMAIL_HEADER_SUBTITLE}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;color:#0f172a;font-size:14px;line-height:1.6;">${innerHtml}</td>
            </tr>
            <tr>
              <td style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 28px;color:#64748b;font-size:12px;line-height:1.5;">${DEMO_FOOTER_TEXT}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

// Helper content builder for the resident confirmation email.
function buildConfirmationContent(input: EmailRequest): EmailContent {
  const name = input.residentName || 'there'
  const safeName = escapeHtml(name)
  const caseId = escapeHtml(input.caseId)
  const requestType = input.requestType ? escapeHtml(input.requestType) : '—'
  const location = input.location ? escapeHtml(input.location) : '—'
  const statusUrl = statusUrlForCase(input.caseId)

  const subject = `Your Brampton service request has been received (${input.caseId})`

  const inner = `
    <p style="margin:0 0 14px;">Hi ${safeName},</p>
    <p style="margin:0;font-size:16px;font-weight:600;">Your service request has been received.</p>
    ${detailTable([
      ['Reference number', caseId],
      ['Request type', requestType],
      ['Location', location],
    ])}
    <p style="margin:0;"><strong>Next step</strong><br />City staff would review the request and move it through the intake workflow.</p>
    <p style="margin:18px 0 0;">You can track this request anytime using the link below.</p>
    ${statusButton(statusUrl)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;">
      <tr>
        <td style="background-color:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;color:#92400e;font-size:13px;line-height:1.5;">
          If you do not see future emails, check your junk or spam folder.
        </td>
      </tr>
    </table>`

  const html = htmlShell(inner)

  const text = [
    `Hi ${name},`,
    '',
    'Your service request has been received.',
    '',
    `Reference number: ${input.caseId}`,
    `Request type: ${input.requestType || '—'}`,
    `Location: ${input.location || '—'}`,
    '',
    'Next step: City staff would review the request and move it through the intake workflow.',
    '',
    'You can track this request anytime using the link below.',
    `Track request status: ${statusUrl}`,
    '',
    'If you do not see future emails, check your junk or spam folder.',
    '',
    DEMO_FOOTER_TEXT,
  ].join('\n')

  return { subject, html, text }
}

// Helper content builder for the status-update email.
function buildStatusUpdateContent(input: EmailRequest): EmailContent {
  const name = input.residentName || 'there'
  const safeName = escapeHtml(name)
  const caseId = escapeHtml(input.caseId)
  const label = statusLabel(input.status)
  const safeLabel = escapeHtml(label)
  const requestType = input.requestType ? escapeHtml(input.requestType) : '—'
  const location = input.location ? escapeHtml(input.location) : '—'
  // Keep the per-status next-step guidance, presented in a cleaner layout.
  const next = (input.status && STATUS_NEXT[input.status]) || 'Your request status has been updated.'
  const safeNext = escapeHtml(next)
  const statusUrl = statusUrlForCase(input.caseId)

  const subject = `City of Brampton: Service request status update (${input.caseId})`

  const inner = `
    <p style="margin:0 0 14px;">Hi ${safeName},</p>
    <p style="margin:0;font-size:16px;font-weight:600;">Your request status has changed.</p>
    ${detailTable([
      ['Reference number', caseId],
      ['New status', safeLabel],
      ['Request type', requestType],
      ['Location', location],
    ])}
    <p style="margin:0;"><strong>Next step</strong><br />${safeNext}</p>
    ${statusButton(statusUrl)}`

  const html = htmlShell(inner)

  const text = [
    `Hi ${name},`,
    '',
    'Your request status has changed.',
    '',
    `Reference number: ${input.caseId}`,
    `New status: ${label}`,
    `Request type: ${input.requestType || '—'}`,
    `Location: ${input.location || '—'}`,
    '',
    `Next step: ${next}`,
    '',
    `Track request status: ${statusUrl}`,
    '',
    DEMO_FOOTER_TEXT,
  ].join('\n')

  return { subject, html, text }
}

// Helper content builder for the staff-approved closure email. Unlike the
// status update (which uses a fixed per-status template), this sends the actual
// closure response staff reviewed and approved, with the staff-approved subject.
function buildClosureContent(input: EmailRequest): EmailContent {
  const name = input.residentName || 'there'
  const safeName = escapeHtml(name)
  const caseId = escapeHtml(input.caseId)
  const requestType = input.requestType ? escapeHtml(input.requestType) : '—'
  const location = input.location ? escapeHtml(input.location) : '—'
  const message = input.message ?? ''
  const statusUrl = statusUrlForCase(input.caseId)

  // Use the staff-approved subject when present; otherwise a safe default.
  const subject = input.subject?.trim() || `City of Brampton: Service request closure update (${input.caseId})`

  const inner = `
    <p style="margin:0 0 14px;">Hi ${safeName},</p>
    <p style="margin:0 0 14px;font-size:16px;font-weight:600;">Your request has been reviewed and closed.</p>
    <div style="margin:0;color:#0f172a;font-size:14px;line-height:1.6;">${textToHtml(message)}</div>
    ${detailTable([
      ['Reference number', caseId],
      ['Status', 'Closed'],
      ['Request type', requestType],
      ['Location', location],
    ])}
    <p style="margin:0;">You can review the status of this request anytime using the link below.</p>
    ${statusButton(statusUrl)}`

  const html = htmlShell(inner)

  const text = [
    `Hi ${name},`,
    '',
    'Your request has been reviewed and closed.',
    '',
    message,
    '',
    `Reference number: ${input.caseId}`,
    'Status: Closed',
    `Request type: ${input.requestType || '—'}`,
    `Location: ${input.location || '—'}`,
    '',
    `Track request status: ${statusUrl}`,
    '',
    DEMO_FOOTER_TEXT,
  ].join('\n')

  return { subject, html, text }
}

// Helper content builder for an officer field-visit milestone update. Carries a
// resident-safe message (no internal observations, ticket numbers, or fines) so
// the resident learns an officer attended without exposing case-file detail.
function buildFieldUpdateContent(input: EmailRequest): EmailContent {
  const name = input.residentName || 'there'
  const safeName = escapeHtml(name)
  const caseId = escapeHtml(input.caseId)
  const requestType = input.requestType ? escapeHtml(input.requestType) : '—'
  const location = input.location ? escapeHtml(input.location) : '—'
  const message = input.message ?? ''
  const statusUrl = statusUrlForCase(input.caseId)

  const subject = input.subject?.trim() || `City of Brampton: Service request update (${input.caseId})`

  const inner = `
    <p style="margin:0 0 14px;">Hi ${safeName},</p>
    <p style="margin:0 0 14px;font-size:16px;font-weight:600;">There's an update on your request.</p>
    <div style="margin:0;color:#0f172a;font-size:14px;line-height:1.6;">${textToHtml(message)}</div>
    ${detailTable([
      ['Reference number', caseId],
      ['Request type', requestType],
      ['Location', location],
    ])}
    ${statusButton(statusUrl)}`

  const html = htmlShell(inner)

  const text = [
    `Hi ${name},`,
    '',
    "There's an update on your request.",
    '',
    message,
    '',
    `Reference number: ${input.caseId}`,
    `Request type: ${input.requestType || '—'}`,
    `Location: ${input.location || '—'}`,
    '',
    `Track request status: ${statusUrl}`,
    '',
    DEMO_FOOTER_TEXT,
  ].join('\n')

  return { subject, html, text }
}

function buildContent(input: EmailRequest): EmailContent {
  if (input.type === 'confirmation') return buildConfirmationContent(input)
  if (input.type === 'closure') return buildClosureContent(input)
  if (input.type === 'field_update') return buildFieldUpdateContent(input)
  return buildStatusUpdateContent(input)
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
  if (input.type === 'closure' && !input.message) {
    return json({ error: 'A closure message is required for a closure email.' }, 400)
  }
  if (input.type === 'field_update' && !input.message) {
    return json({ error: 'A message is required for a field update email.' }, 400)
  }

  const content = buildContent(input)
  const sender = senderFromEnv()
  const mailjetBody = {
    Messages: [
      {
        From: { Email: sender.email, Name: sender.name },
        ReplyTo: { Email: REPLY_TO_EMAIL, Name: REPLY_TO_NAME },
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

  // Safe success log: email type, Mailjet message id, and case id only. No
  // recipient address, sender credentials, API keys, or auth headers are logged.
  console.log('Resident email sent via Mailjet:', input.type, 'caseId:', input.caseId, 'messageId:', messageId ?? 'unknown')

  return json({ ok: true, type: input.type, messageId })
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
