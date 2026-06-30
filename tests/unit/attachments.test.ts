import { describe, it, expect } from 'vitest'
import {
  MAX_ATTACHMENT_BYTES,
  isAcceptedAttachmentType,
  isSendableEmail,
} from '../../src/services/residentRequests'

// Part 10: attachment validation + sendable-email helpers.
describe('isAcceptedAttachmentType', () => {
  const fileOfType = (type: string): File => new File([new Uint8Array(1)], 'f', { type })

  it('accepts images', () => {
    expect(isAcceptedAttachmentType(fileOfType('image/png'))).toBe(true)
    expect(isAcceptedAttachmentType(fileOfType('image/jpeg'))).toBe(true)
    expect(isAcceptedAttachmentType(fileOfType('image/gif'))).toBe(true)
    expect(isAcceptedAttachmentType(fileOfType('image/webp'))).toBe(true)
  })

  it('accepts PDFs', () => {
    expect(isAcceptedAttachmentType(fileOfType('application/pdf'))).toBe(true)
  })

  it('rejects other types', () => {
    expect(isAcceptedAttachmentType(fileOfType('application/x-msdownload'))).toBe(false)
    expect(isAcceptedAttachmentType(fileOfType('video/mp4'))).toBe(false)
    expect(isAcceptedAttachmentType(fileOfType('text/plain'))).toBe(false)
    expect(isAcceptedAttachmentType(fileOfType(''))).toBe(false)
  })
})

describe('MAX_ATTACHMENT_BYTES', () => {
  it('is 10 MB', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024)
  })
})

describe('isSendableEmail', () => {
  it('accepts a real-looking address', () => {
    expect(isSendableEmail('person@gmail.com')).toBe(true)
  })

  it('rejects reserved demo domains', () => {
    expect(isSendableEmail('demo@example.com')).toBe(false)
    expect(isSendableEmail('demo@example.org')).toBe(false)
    expect(isSendableEmail('demo@example.net')).toBe(false)
  })

  it('rejects malformed addresses', () => {
    expect(isSendableEmail('nope')).toBe(false)
    expect(isSendableEmail('')).toBe(false)
  })
})
