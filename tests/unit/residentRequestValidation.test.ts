import { describe, it, expect } from 'vitest'
import {
  MIN_DESCRIPTION_LENGTH,
  attachmentRejectionMessage,
  isValidEmail,
  partitionAttachments,
  validateResidentRequestForm,
  type ResidentRequestFormValues,
} from '../../src/lib/residentRequestValidation'

// Part 10: resident request validation helpers — extracted from the intake form
// so the rules can be tested without a browser.

function validForm(overrides: Partial<ResidentRequestFormValues> = {}): ResidentRequestFormValues {
  return {
    requestType: 'Report Pothole',
    happeningNow: 'Yes',
    description: 'There is a large pothole in the middle of the road near the intersection.',
    addressType: 'Street Address',
    location: '24 Main St N',
    city: 'Brampton',
    province: 'Ontario',
    firstName: 'Jordan',
    lastName: 'Resident',
    email: 'jordan.resident@example.com',
    methodOfContact: 'Email',
    ...overrides,
  }
}

describe('isValidEmail', () => {
  it('accepts well-formed addresses', () => {
    expect(isValidEmail('a@b.co')).toBe(true)
    expect(isValidEmail('  Jordan.Resident@example.com  ')).toBe(true)
  })

  it('rejects malformed addresses', () => {
    expect(isValidEmail('not-an-email')).toBe(false)
    expect(isValidEmail('missing@domain')).toBe(false)
    expect(isValidEmail('@nouser.com')).toBe(false)
    expect(isValidEmail('spaces in@email.com')).toBe(false)
    expect(isValidEmail('')).toBe(false)
  })
})

describe('validateResidentRequestForm', () => {
  it('passes a fully valid form', () => {
    expect(validateResidentRequestForm(validForm())).toBeNull()
  })

  it('blocks a missing request type first', () => {
    expect(validateResidentRequestForm(validForm({ requestType: '' }))).toBe(
      'Please choose a service request type.',
    )
  })

  it.each([
    ['happeningNow', { happeningNow: '' }, 'Please tell us whether this is happening now.'],
    ['description', { description: '   ' }, 'Please describe the issue so staff can review the request.'],
    ['addressType', { addressType: '' }, 'Please choose a type of address.'],
    ['location', { location: '' }, 'Please provide the address or nearest intersection.'],
    ['city', { city: '' }, 'Please provide a city.'],
    ['province', { province: '' }, 'Please provide a province.'],
    ['firstName', { firstName: '' }, 'Please enter your first name.'],
    ['lastName', { lastName: '' }, 'Please enter your last name.'],
    ['email empty', { email: '' }, 'Please enter a contact email address.'],
    ['methodOfContact', { methodOfContact: '' }, 'Please choose a method of contact.'],
  ] as Array<[string, Partial<ResidentRequestFormValues>, string]>)(
    'blocks an invalid %s',
    (_label, overrides, message) => {
      expect(validateResidentRequestForm(validForm(overrides))).toBe(message)
    },
  )

  it('rejects a too-short description', () => {
    expect(validateResidentRequestForm(validForm({ description: 'too short' }))).toBe(
      'Please provide a little more detail about the issue.',
    )
    // Exactly the minimum length is accepted.
    const exactlyMin = 'x'.repeat(MIN_DESCRIPTION_LENGTH)
    expect(validateResidentRequestForm(validForm({ description: exactlyMin }))).toBeNull()
  })

  it('rejects an invalid email', () => {
    expect(validateResidentRequestForm(validForm({ email: 'nope' }))).toBe(
      'Please enter a valid email address.',
    )
  })
})

describe('partitionAttachments / attachmentRejectionMessage', () => {
  const file = (name: string, type: string, size: number): File => {
    const f = new File([new Uint8Array(1)], name, { type })
    Object.defineProperty(f, 'size', { value: size })
    return f
  }

  it('accepts images and PDFs under the size cap', () => {
    const png = file('a.png', 'image/png', 1024)
    const pdf = file('b.pdf', 'application/pdf', 1024)
    const { accepted, rejected } = partitionAttachments([png, pdf])
    expect(accepted).toHaveLength(2)
    expect(rejected).toHaveLength(0)
    expect(attachmentRejectionMessage(rejected)).toBeNull()
  })

  it('rejects unsupported types', () => {
    const exe = file('malware.exe', 'application/x-msdownload', 1024)
    const { accepted, rejected } = partitionAttachments([exe])
    expect(accepted).toHaveLength(0)
    expect(rejected).toEqual(['malware.exe not supported'])
    expect(attachmentRejectionMessage(rejected)).toContain('malware.exe not supported')
  })

  it('rejects oversized files', () => {
    const huge = file('huge.jpg', 'image/jpeg', 11 * 1024 * 1024)
    const { accepted, rejected } = partitionAttachments([huge])
    expect(accepted).toHaveLength(0)
    expect(rejected).toEqual(['huge.jpg over 10 MB'])
  })

  it('returns null when nothing was rejected', () => {
    expect(attachmentRejectionMessage([])).toBeNull()
  })
})
