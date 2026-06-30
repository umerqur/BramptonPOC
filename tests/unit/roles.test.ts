import { describe, it, expect } from 'vitest'
import {
  allowedRolesForEmail,
  can,
  canUseRole,
  currentActorName,
  defaultRoleForEmail,
  getStaffProfileForEmail,
} from '../../src/lib/roles'

// Part 10: staff role / profile resolution. The single source of truth for which
// roles a signed-in email may act as and which gated actions each role can do.
describe('getStaffProfileForEmail', () => {
  it('resolves a known staff member case-insensitively', () => {
    expect(getStaffProfileForEmail('UMER.QURESHI@GMAIL.COM')?.name).toBe('Umer Qureshi')
  })

  it('returns null for an unknown email', () => {
    expect(getStaffProfileForEmail('nobody@example.com')).toBeNull()
    expect(getStaffProfileForEmail(null)).toBeNull()
    expect(getStaffProfileForEmail(undefined)).toBeNull()
  })
})

describe('allowedRolesForEmail', () => {
  it('gives the dedicated officer profile officer-only access', () => {
    expect(allowedRolesForEmail('oakley.carpentry_worker@yahoo.com')).toEqual(['officer'])
  })

  it('gives a full-access staff member all three roles', () => {
    expect(allowedRolesForEmail('umer.qureshi@gmail.com').sort()).toEqual(['csr', 'officer', 'supervisor'])
  })

  it('falls back to supervisor/csr (never officer) for unknown staff', () => {
    const roles = allowedRolesForEmail('stranger@example.com')
    expect(roles).toContain('supervisor')
    expect(roles).toContain('csr')
    expect(roles).not.toContain('officer')
  })
})

describe('defaultRoleForEmail', () => {
  it('lands the demo officer on the officer role', () => {
    expect(defaultRoleForEmail('oakley.carpentry_worker@yahoo.com')).toBe('officer')
  })

  it('lands a supervisor profile on supervisor', () => {
    expect(defaultRoleForEmail('umer.qureshi@gmail.com')).toBe('supervisor')
  })

  it('defaults unknown staff to supervisor', () => {
    expect(defaultRoleForEmail('stranger@example.com')).toBe('supervisor')
  })
})

describe('canUseRole', () => {
  it('blocks the officer-only profile from acting as supervisor', () => {
    expect(canUseRole('oakley.carpentry_worker@yahoo.com', 'supervisor')).toBe(false)
    expect(canUseRole('oakley.carpentry_worker@yahoo.com', 'officer')).toBe(true)
  })

  it('never lets unknown staff act as an officer', () => {
    expect(canUseRole('stranger@example.com', 'officer')).toBe(false)
  })
})

describe('can (action permissions)', () => {
  it('restricts recording a field outcome to officers', () => {
    expect(can('officer', 'recordFieldAction')).toBe(true)
    expect(can('supervisor', 'recordFieldAction')).toBe(false)
    expect(can('csr', 'recordFieldAction')).toBe(false)
  })

  it('restricts approving a closure to supervisors', () => {
    expect(can('supervisor', 'approveClosure')).toBe(true)
    expect(can('csr', 'approveClosure')).toBe(false)
    expect(can('officer', 'approveClosure')).toBe(false)
  })

  it('lets supervisor and csr assign officers but not officers', () => {
    expect(can('supervisor', 'assignOfficer')).toBe(true)
    expect(can('csr', 'assignOfficer')).toBe(true)
    expect(can('officer', 'assignOfficer')).toBe(false)
  })
})

describe('currentActorName', () => {
  it('uses the profile role display name', () => {
    expect(currentActorName('umer.qureshi@gmail.com', 'officer')).toBe('Officer Qureshi')
    expect(currentActorName('umer.qureshi@gmail.com', 'supervisor')).toBe('Supervisor Qureshi')
  })

  it('falls back to a generic actor name for unknown staff', () => {
    expect(currentActorName('stranger@example.com', 'supervisor')).toBe('Supervisor (staff)')
  })
})
