// Pure, framework-free validation helpers for the public resident service
// request intake form. These rules were extracted out of
// pages/resident/ResidentNewRequestPage.tsx so they can be unit-tested in
// isolation (no React, no DOM) and so the form and any future caller share a
// single source of truth for what a valid resident submission looks like.
import {
  ACCEPTED_ATTACHMENT_HINT,
  MAX_ATTACHMENT_BYTES,
  isAcceptedAttachmentType,
} from '../services/residentRequests'

/** Minimum length (after trim) for the free-text issue description. */
export const MIN_DESCRIPTION_LENGTH = 10

/**
 * The email shape the intake form accepts. Intentionally permissive (something
 * @ something . something) — it is a contact field, not an identity assertion.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** True when `email` looks like a usable contact address. */
export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim())
}

/** The subset of the intake form the validator inspects. */
export type ResidentRequestFormValues = {
  requestType: string
  happeningNow: string
  description: string
  addressType: string
  location: string
  city: string
  province: string
  firstName: string
  lastName: string
  email: string
  methodOfContact: string
}

/**
 * Validate a resident request before submission. Returns the first
 * human-readable problem (so the form can show it), or null when the request is
 * good to submit. The order of checks matches the on-screen field order.
 */
export function validateResidentRequestForm(form: ResidentRequestFormValues): string | null {
  if (!form.requestType) return 'Please choose a service request type.'
  if (!form.happeningNow) return 'Please tell us whether this is happening now.'
  if (!form.description.trim()) return 'Please describe the issue so staff can review the request.'
  if (form.description.trim().length < MIN_DESCRIPTION_LENGTH)
    return 'Please provide a little more detail about the issue.'
  if (!form.addressType) return 'Please choose a type of address.'
  if (!form.location.trim()) return 'Please provide the address or nearest intersection.'
  if (!form.city.trim()) return 'Please provide a city.'
  if (!form.province.trim()) return 'Please provide a province.'
  if (!form.firstName.trim()) return 'Please enter your first name.'
  if (!form.lastName.trim()) return 'Please enter your last name.'
  if (!form.email.trim()) return 'Please enter a contact email address.'
  if (!isValidEmail(form.email)) return 'Please enter a valid email address.'
  if (!form.methodOfContact) return 'Please choose a method of contact.'
  return null
}

/** Result of sorting a list of chosen files into accepted vs rejected. */
export type PartitionedAttachments = {
  accepted: File[]
  /** One human-readable reason string per rejected file. */
  rejected: string[]
}

/**
 * Split selected files into the ones the form will keep and the ones it rejects
 * (wrong type or oversized). Mirrors the defensive checks the upload path runs
 * server-side, so the resident is told immediately why a file was dropped.
 */
export function partitionAttachments(files: File[]): PartitionedAttachments {
  const accepted: File[] = []
  const rejected: string[] = []
  for (const file of files) {
    if (!isAcceptedAttachmentType(file)) rejected.push(`${file.name} not supported`)
    else if (file.size > MAX_ATTACHMENT_BYTES) rejected.push(`${file.name} over 10 MB`)
    else accepted.push(file)
  }
  return { accepted, rejected }
}

/** Build the "these files were not added" notice, or null when nothing was rejected. */
export function attachmentRejectionMessage(rejected: string[]): string | null {
  if (rejected.length === 0) return null
  return `These files were not added: ${rejected.join('; ')}. Accepted: ${ACCEPTED_ATTACHMENT_HINT}.`
}
