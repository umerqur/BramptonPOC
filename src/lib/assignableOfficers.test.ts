import { describe, expect, it } from 'vitest'
import {
  STAFF_PROFILES,
  getAssignableOfficers,
  getStaffProfileForEmail,
  isSelectableOfficer,
  officerDisplayName,
  officerProfiles,
} from './roles'
import { recommendOfficer } from './officerRecommendation'
import { makeResidentRow } from '../test/fixtures'

// The retired demo officer identities that must never be offered for a new
// assignment — in the manual selection list OR by the recommendation engine.
const INACTIVE_OFFICER_NAMES = [
  'Officer Levin',
  'Officer Stephen',
  'Officer Dean',
  'Officer Ceren',
  'Officer Shaz',
]

describe('assignable officer pool', () => {
  const selectableNames = officerProfiles().map(officerDisplayName)

  it.each(INACTIVE_OFFICER_NAMES)('%s is not selectable', (name) => {
    expect(selectableNames).not.toContain(name)
    expect(isSelectableOfficer(name, false)).toBe(false)
    // Defensive backstop: even if stale demo data claimed the identity was
    // active, the retired name alone blocks selection.
    expect(isSelectableOfficer(name, true)).toBe(false)
    expect(isSelectableOfficer(`  ${name.toUpperCase()}  `, true)).toBe(false)
  })

  it('active officers still appear in the selectable pool', () => {
    expect(selectableNames).toEqual(
      expect.arrayContaining(['Officer Qureshi', 'Officer Mann', 'Officer Ahmed', 'Officer Oakley']),
    )
    for (const name of selectableNames) {
      expect(isSelectableOfficer(name, true)).toBe(true)
    }
  })

  it('getAssignableOfficers returns only active profiles with officer access', () => {
    const assignable = getAssignableOfficers(STAFF_PROFILES)
    expect(assignable.length).toBeGreaterThan(0)
    for (const profile of assignable) {
      expect(profile.active).toBe(true)
      expect(profile.allowedRoles).toContain('officer')
    }
  })
})

describe('officer recommendation engine', () => {
  // Vary the locator so the deterministic ward routing exercises different
  // wards — an inactive officer must never surface for ANY case.
  const rows = [
    makeResidentRow(),
    makeResidentRow({ case_id: 'RSR-2', postal_code: 'L6P 3R2', location: '55 Queen St' }),
    makeResidentRow({ case_id: 'RSR-3', postal_code: 'L7A 0B1', location: '9 Vodden St E' }),
    makeResidentRow({ case_id: 'RSR-4', postal_code: null, location: '200 Bovaird Dr W' }),
  ]

  it('cannot recommend or rank an inactive officer, even from an unfiltered pool', () => {
    for (const row of rows) {
      // Deliberately pass the RAW, unfiltered staff list — the engine must
      // apply the shared active-officer filter itself.
      const recommendation = recommendOfficer(row, STAFF_PROFILES)
      expect(recommendation.recommended).not.toBeNull()
      const surfacedNames = [
        recommendation.recommendedScore!.name,
        ...recommendation.ranked.map((score) => score.name),
      ]
      for (const name of INACTIVE_OFFICER_NAMES) {
        expect(surfacedNames).not.toContain(name)
      }
    }
  })

  it('recommendation candidates and the manual selection list are the same active pool', () => {
    const manualNames = officerProfiles().map(officerDisplayName).sort()
    const recommendedNames = recommendOfficer(makeResidentRow(), officerProfiles())
      .ranked.map((score) => score.name)
      .sort()
    expect(recommendedNames).toEqual(manualNames)
  })
})

describe('historical records with inactive officers', () => {
  it('an inactive officer profile still resolves for rendering old assignments, but is never assignable', () => {
    // Old cases store the assignment against the officer's email + name;
    // identity resolution must keep working so historical records render.
    const levin = getStaffProfileForEmail('yuri.levin@queensu.ca')
    expect(levin).not.toBeNull()
    expect(officerDisplayName(levin!)).toBe('Officer Levin')
    expect(levin!.active).toBe(false)
    // ...but no selection pool ever offers that identity for a new assignment.
    expect(officerProfiles().some((profile) => profile.email === levin!.email)).toBe(false)
    expect(getAssignableOfficers([levin!])).toEqual([])
  })
})
