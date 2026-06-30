import { describe, it, expect } from 'vitest'
import { ALLOWED_EMAILS, RESTRICTED_MESSAGE, isAllowedEmail } from '../../src/lib/auth'

// Part 10: the access allowlist gates who can request a magic link. It must be
// case-insensitive, whitespace-tolerant, and closed to unknown addresses.
describe('isAllowedEmail', () => {
  it('accepts an allowed user', () => {
    expect(isAllowedEmail('umer.qureshi@gmail.com')).toBe(true)
  })

  it('accepts allowed users case-insensitively', () => {
    expect(isAllowedEmail('UMER.QURESHI@GMAIL.COM')).toBe(true)
    expect(isAllowedEmail('Umer.Qureshi@Gmail.com')).toBe(true)
  })

  it('trims surrounding whitespace before matching', () => {
    expect(isAllowedEmail('  umer.qureshi@gmail.com  ')).toBe(true)
  })

  it('accepts every address on the allowlist', () => {
    for (const email of ALLOWED_EMAILS) {
      expect(isAllowedEmail(email.toUpperCase())).toBe(true)
    }
  })

  it('rejects unknown emails', () => {
    expect(isAllowedEmail('stranger@example.com')).toBe(false)
    expect(isAllowedEmail('')).toBe(false)
    expect(isAllowedEmail('not-an-email')).toBe(false)
  })

  it('does not treat a substring/lookalike as allowed', () => {
    expect(isAllowedEmail('umer.qureshi@gmail.com.evil.com')).toBe(false)
    expect(isAllowedEmail('xumer.qureshi@gmail.com')).toBe(false)
  })
})

describe('RESTRICTED_MESSAGE', () => {
  it('is the message shown to restricted users', () => {
    expect(RESTRICTED_MESSAGE).toBe('Access is restricted to authorized project users.')
  })
})
