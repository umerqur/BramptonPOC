// Sanitizes legacy resident-complaint descriptions for staff display.
//
// Older `resident_service_requests` rows stored supplemental intake fields under
// a "Demo form details:" / "Demo-only fields:" heading, and some folded resident
// CONTACT details (street address, city, province) into the issue text. Current
// submissions use an "Additional intake details:" heading with operational
// fields only.
//
// This normalizes legacy rows at DISPLAY time so staff never see the legacy
// wording and resident contact details never appear inside the reported issue
// text. It never mutates stored data — only what is rendered.

// Matches the supplemental-details heading whether it uses the legacy wording or
// the current "Additional intake details:" wording. Anchored to a line so it
// never matches mid-sentence.
const SUPPLEMENTAL_HEADING =
  /(^|\n)[ \t]*(Demo form details|Demo-only fields|Additional intake details)[ \t]*:[ \t]*(\n|$)/i

// Operational issue/location lines that legitimately belong with the issue text.
// Anything else under the heading (e.g. "Contact street address: …") is dropped.
const OPERATIONAL_LINE =
  /^(Is this happening now|Location unit or apartment number|Location postal code)[ \t]*:/i

/**
 * Return a staff-safe version of a resident request description: any legacy
 * supplemental heading is normalized to "Additional intake details:", only
 * operational issue/location lines are kept beneath it, and resident contact
 * details are removed from the issue text. Descriptions without a supplemental
 * block are returned trimmed and otherwise unchanged.
 */
export function sanitizeResidentDescription(text: string | null | undefined): string {
  if (!text) return ''

  const match = text.match(SUPPLEMENTAL_HEADING)
  if (!match) return text.trim()

  const headingStart = match.index ?? 0
  const base = text.slice(0, headingStart).trim()
  const after = text.slice(headingStart + match[0].length)

  // Keep only operational supplemental lines; drop resident contact details that
  // legacy rows mixed into the issue text.
  const operational = after
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => OPERATIONAL_LINE.test(line))

  const parts = [base]
  if (operational.length > 0) {
    parts.push(`Additional intake details:\n${operational.join('\n')}`)
  }
  return parts.filter(Boolean).join('\n\n')
}
