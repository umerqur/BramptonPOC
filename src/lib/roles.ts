// POC staff-profile-based access control for the by-law enforcement workflow.
//
// This is NOT a free persona switcher. Staff identity comes from the Supabase
// login email; the email is matched against a known staff profile list below.
// A profile declares which roles that person is ALLOWED to act as, their default
// role, and the display name they use in each role. The "Acting as" selector
// only ever offers a user the roles in their OWN profile — it can never grant a
// role the profile does not allow, and it can never let one person act as
// another person's identity.
//
// Concretely:
//   * A user can only select roles listed in their own staff profile.
//   * If a user has officer access, they act as their OWN officer identity only
//     (e.g. Umer → "Officer Qureshi", Balraj → "Officer Mann"). Umer can never
//     act as Officer Oakley, and Balraj can never act as Officer Qureshi.
//   * Officer Oakley can only ever be a By-law Officer.
//   * A case is recorded against the assigned officer's EMAIL, so only that
//     signed-in email may record the field outcome for it.
//
// Resident email is only contact information on a request. If a resident happens
// to use the same address as a staff account, that is still just resident
// contact information on that request — it does not grant or remove any staff
// permission. Staff permissions come ONLY from the staff profile list here.
//
// Roles:
//   * Supervisor — work queue + insights, assigns work, overrides priority,
//                  reviews the officer's field outcome, generates/edits/approves
//                  and sends the closure response.
//   * CSR / Intake — creates/reviews intake, checks missing information, assigns
//                  to an officer, requests more information. Cannot record field
//                  outcomes or approve/send closures.
//   * By-law Officer — sees only cases assigned to their own officer email and
//                  records the on-site field outcome. No supervisor queue,
//                  no insights, no closure approval.

export type StaffRole = 'supervisor' | 'officer' | 'csr'

export const ROLE_OPTIONS: StaffRole[] = ['supervisor', 'officer', 'csr']

export const ROLE_LABELS: Record<StaffRole, string> = {
  supervisor: 'Supervisor',
  officer: 'By-law Officer',
  csr: 'Intake / CSR',
}

/**
 * A known staff member. The login `email` is the real staff identity; `name` is
 * the full staff name. `allowedRoles` is the closed set of roles this person may
 * act as, `defaultRole` is where they land on sign-in, and `roleDisplayNames`
 * is the name shown / recorded when this person acts in a given role (e.g. the
 * officer display name recorded on a case they investigate).
 */
export type StaffProfile = {
  name: string
  email: string
  allowedRoles: StaffRole[]
  defaultRole: StaffRole
  roleDisplayNames: Partial<Record<StaffRole, string>>
}

/** Normalize an email for identity comparison (trim + lowercase). */
function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

/**
 * The known staff profile list — the single source of truth for staff identity
 * and role separation. Anyone not in this list gets the default-staff fallback
 * below (supervisor/CSR, never officer).
 */
export const STAFF_PROFILES: StaffProfile[] = [
  {
    name: 'Umer Qureshi',
    email: 'umer.qureshi@gmail.com',
    allowedRoles: ['supervisor', 'csr', 'officer'],
    defaultRole: 'supervisor',
    roleDisplayNames: { supervisor: 'Supervisor Qureshi', csr: 'CSR Qureshi', officer: 'Officer Qureshi' },
  },
  {
    name: 'Umer Neural Forge',
    email: 'umer@neuralforge.ca',
    allowedRoles: ['supervisor', 'csr', 'officer'],
    defaultRole: 'supervisor',
    roleDisplayNames: { supervisor: 'Supervisor Qureshi', csr: 'CSR Qureshi', officer: 'Officer Qureshi' },
  },
  {
    name: 'Balraj Mann',
    email: 'balraj_m7@hotmail.com',
    allowedRoles: ['supervisor', 'csr', 'officer'],
    defaultRole: 'supervisor',
    roleDisplayNames: { supervisor: 'Supervisor Mann', csr: 'CSR Mann', officer: 'Officer Mann' },
  },
  {
    name: 'Ousmaan Ahmed',
    email: 'ousmaan_ahmed@icloud.com',
    allowedRoles: ['supervisor', 'csr', 'officer'],
    defaultRole: 'supervisor',
    roleDisplayNames: { supervisor: 'Supervisor Ahmed', csr: 'CSR Ahmed', officer: 'Officer Ahmed' },
  },
  {
    name: 'Yuri Levin',
    email: 'yuri.levin@queensu.ca',
    allowedRoles: ['supervisor', 'csr'],
    defaultRole: 'supervisor',
    roleDisplayNames: { supervisor: 'Supervisor Levin', csr: 'CSR Levin' },
  },
  {
    // The dedicated demo By-law Officer. This profile can ONLY be an officer.
    name: 'Officer Oakley',
    email: 'oakley.carpentry_worker@yahoo.com',
    allowedRoles: ['officer'],
    defaultRole: 'officer',
    roleDisplayNames: { officer: 'Officer Oakley' },
  },
]

// Fallback for an authenticated email that is allowed into the app but is not a
// named staff profile: treat them as a supervisor/CSR for the demo, but NEVER
// grant officer access. Officer access requires an explicit officer profile.
const DEFAULT_STAFF_ALLOWED_ROLES: StaffRole[] = ['supervisor', 'csr']
const DEFAULT_STAFF_ROLE: StaffRole = 'supervisor'

/**
 * The dedicated demo By-law Officer profile (Officer Oakley). Cases assigned to
 * this officer email appear in the Officer Field Console for whoever is signed
 * in with this email.
 */
export const DEMO_OFFICER: StaffProfile =
  STAFF_PROFILES.find((p) => p.email === 'oakley.carpentry_worker@yahoo.com')!

/** The staff profile for a signed-in email, or null if not a known staff member. */
export function getStaffProfileForEmail(email: string | null | undefined): StaffProfile | null {
  const value = normalizeEmail(email)
  if (!value) return null
  return STAFF_PROFILES.find((p) => p.email === value) ?? null
}

/** The roles a signed-in email is allowed to act as. */
export function allowedRolesForEmail(email: string | null | undefined): StaffRole[] {
  const profile = getStaffProfileForEmail(email)
  return profile ? [...profile.allowedRoles] : [...DEFAULT_STAFF_ALLOWED_ROLES]
}

/** The role a signed-in email lands on by default. */
export function defaultRoleForEmail(email: string | null | undefined): StaffRole {
  const profile = getStaffProfileForEmail(email)
  return profile ? profile.defaultRole : DEFAULT_STAFF_ROLE
}

/** Whether a signed-in email is allowed to act as the given role. */
export function canUseRole(email: string | null | undefined, role: StaffRole): boolean {
  return allowedRolesForEmail(email).includes(role)
}

/**
 * The display name the signed-in user uses when acting in a given role — their
 * own role identity (e.g. "Officer Qureshi"), never another person's. Falls back
 * to a name + role label, then to the generic role actor name for unknown staff.
 */
export function currentActorName(email: string | null | undefined, role: StaffRole): string {
  const profile = getStaffProfileForEmail(email)
  if (profile) return profile.roleDisplayNames[role] ?? `${profile.name} (${ROLE_LABELS[role]})`
  return ROLE_ACTOR_NAME[role]
}

/** The officer display name for a staff profile (its own officer identity). */
export function officerDisplayName(profile: StaffProfile): string {
  return profile.roleDisplayNames.officer ?? profile.name
}

/**
 * The assignable By-law Officers — every staff profile that may act as an
 * officer, deduplicated by officer display name. Two Umer logins share the one
 * "Officer Qureshi" identity, so the assignable list stays: Officer Qureshi,
 * Officer Mann, Officer Ahmed, Officer Oakley. The first matching login is the
 * canonical assignable identity for that officer name.
 */
export function officerProfiles(): StaffProfile[] {
  const seen = new Set<string>()
  const result: StaffProfile[] = []
  for (const profile of STAFF_PROFILES) {
    if (!profile.allowedRoles.includes('officer')) continue
    const label = officerDisplayName(profile)
    if (seen.has(label)) continue
    seen.add(label)
    result.push(profile)
  }
  return result
}

/** Short descriptor used in the role switcher. */
export const ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  supervisor: 'Assigns work, can investigate, approves closures',
  officer: 'Investigates on site and records the field outcome',
  csr: 'Logs and triages complaints, assigns to an officer',
}

/** Generic fallback staff name per role, used only for unknown (non-profile) staff. */
export const ROLE_ACTOR_NAME: Record<StaffRole, string> = {
  supervisor: 'Supervisor (staff)',
  officer: `${DEMO_OFFICER.roleDisplayNames.officer} (By-law Officer)`,
  csr: 'Intake / CSR (staff)',
}

/** The gated actions in the enforcement workflow. */
export type RoleAction = 'manageCase' | 'assignOfficer' | 'recordFieldAction' | 'approveClosure'

// Which roles may perform each gated action.
const PERMISSIONS: Record<RoleAction, StaffRole[]> = {
  // Supervisor/CSR case management: review intake, check missing information,
  // request more info, prepare the closure draft. Officers cannot do these.
  manageCase: ['supervisor', 'csr'],
  // Both supervisor and CSR can assign a case to an officer.
  assignOfficer: ['supervisor', 'csr'],
  // Recording a field outcome is the By-law Officer's job only, and only for a
  // case assigned to their own email. A supervisor never records a field outcome
  // as the officer; CSR cannot record one at all.
  recordFieldAction: ['officer'],
  // Approving (and sending) the final closure response is supervisor-only. CSR
  // can intake and assign but does not approve or send closures.
  approveClosure: ['supervisor'],
}

export function can(role: StaffRole, action: RoleAction): boolean {
  return PERMISSIONS[action].includes(role)
}

/** Human-readable list of the roles allowed to perform an action. */
export function rolesAllowed(action: RoleAction): string {
  return PERMISSIONS[action].map((r) => ROLE_LABELS[r]).join(' or ')
}
