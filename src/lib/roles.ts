// POC staff-profile-based access control for the by-law enforcement workflow.
//
// This is NOT a free persona switcher. Staff identity comes from the Supabase
// login email; the email is matched against a known staff profile list below.
// A profile declares which roles that person is ALLOWED to act as and their
// default role. The "Acting as" selector only ever offers a user the roles in
// their own profile — it can never grant a role the profile does not allow.
//
// In particular: only a profile whose allowed roles include 'officer' may act
// as a By-law Officer. Supervisor/CSR demo accounts (Umer, Yuri, Balraj, …)
// CANNOT switch into the officer role, so they can never act as Officer Oakley.
//
// Roles:
//   * Supervisor / Coordinator — oversees the queue, assigns work to officers,
//                      can investigate, and is the only role that approves a
//                      closure response.
//   * CSR / Intake — logs and triages complaints and can assign to an officer,
//                      but does not approve closures.
//   * By-law Officer — goes to the location, investigates, and records the real
//                      field outcome. Sees only cases assigned to their email.
//
// Resident email is only contact information on a request. If a resident
// happens to use the same address as a staff account, it is still just resident
// contact information on that request — it does not grant or remove any staff
// permission. Staff permissions come ONLY from the staff profile list here.

export type StaffRole = 'supervisor' | 'officer' | 'csr'

export const ROLE_OPTIONS: StaffRole[] = ['supervisor', 'officer', 'csr']

export const ROLE_LABELS: Record<StaffRole, string> = {
  supervisor: 'Supervisor',
  officer: 'By-law Officer',
  csr: 'Intake / CSR',
}

/**
 * A known staff member. The login `email` is the real staff identity; `name` is
 * the display name. `allowedRoles` is the closed set of roles this person may
 * act as, and `defaultRole` is what they land on when they sign in.
 *
 * `officerDisplayName` is set only for officer profiles and is the name shown
 * in the UI / recorded on a case when this person acts as a By-law Officer.
 */
export type StaffProfile = {
  name: string
  email: string
  allowedRoles: StaffRole[]
  defaultRole: StaffRole
  officerDisplayName?: string
}

/** Normalize an email for identity comparison (trim + lowercase). */
function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

/**
 * The known staff profile list — the single source of truth for staff identity
 * and role separation. Anyone not in this list gets no officer access (see the
 * default-staff fallback in the helpers below).
 */
export const STAFF_PROFILES: StaffProfile[] = [
  {
    name: 'Umer Qureshi',
    email: 'umer.qureshi@gmail.com',
    allowedRoles: ['supervisor', 'csr'],
    defaultRole: 'supervisor',
  },
  {
    name: 'Umer Neural Forge',
    email: 'umer@neuralforge.ca',
    allowedRoles: ['supervisor', 'csr'],
    defaultRole: 'supervisor',
  },
  {
    name: 'Balraj',
    email: 'balraj_m7@hotmail.com',
    allowedRoles: ['supervisor', 'csr'],
    defaultRole: 'supervisor',
  },
  {
    name: 'Ousmaan',
    email: 'ousmaan_ahmed@icloud.com',
    allowedRoles: ['supervisor', 'csr'],
    defaultRole: 'supervisor',
  },
  {
    name: 'Yuri Levin',
    email: 'yuri.levin@queensu.ca',
    allowedRoles: ['supervisor', 'csr'],
    defaultRole: 'supervisor',
  },
  {
    // The single demo By-law Officer. Only this profile may act as an officer,
    // and it can act as nothing else.
    name: 'Officer Oakley',
    email: 'oakley.carpentry_worker@yahoo.com',
    allowedRoles: ['officer'],
    defaultRole: 'officer',
    officerDisplayName: 'Officer Oakley',
  },
]

// Fallback for an authenticated email that is allowed into the app but is not a
// named staff profile: treat them as a supervisor/CSR for the demo, but NEVER
// grant officer access. Officer access requires an explicit officer profile.
const DEFAULT_STAFF_ALLOWED_ROLES: StaffRole[] = ['supervisor', 'csr']
const DEFAULT_STAFF_ROLE: StaffRole = 'supervisor'

/**
 * The single demo By-law Officer profile. Cases assigned to this officer email
 * appear in the Officer Field Console for whoever is signed in with this email.
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

/** Every staff profile that may act as a By-law Officer (the assignable officers). */
export function officerProfiles(): StaffProfile[] {
  return STAFF_PROFILES.filter((p) => p.allowedRoles.includes('officer'))
}

/** Short descriptor used in the role switcher. */
export const ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  supervisor: 'Assigns work, can investigate, approves closures',
  officer: 'Investigates on site and records the field outcome',
  csr: 'Logs and triages complaints, assigns to an officer',
}

/** A staff display name per role, used when a role records an action. */
export const ROLE_ACTOR_NAME: Record<StaffRole, string> = {
  supervisor: 'M. Okafor (Supervisor)',
  officer: `${DEMO_OFFICER.name} (By-law Officer)`,
  csr: 'J. Lee (Intake / CSR)',
}

/** The gated actions in the enforcement workflow. */
export type RoleAction = 'manageCase' | 'assignOfficer' | 'recordFieldAction' | 'approveClosure'

// Which roles may perform each gated action.
const PERMISSIONS: Record<RoleAction, StaffRole[]> = {
  // Supervisor/CSR case management: approve routing, request more info, override
  // priority, prepare the closure draft. Officers cannot do these.
  manageCase: ['supervisor', 'csr'],
  assignOfficer: ['supervisor', 'csr'],
  // Recording a field outcome is the By-law Officer's job only. A supervisor
  // assigns and approves closure — they never record field outcomes as the
  // officer. The officer records from the Officer Field Console.
  recordFieldAction: ['officer'],
  // Approving a closure response is supervisor-only. CSR can intake and assign
  // but does not approve closures.
  approveClosure: ['supervisor'],
}

export function can(role: StaffRole, action: RoleAction): boolean {
  return PERMISSIONS[action].includes(role)
}

/** Human-readable list of the roles allowed to perform an action. */
export function rolesAllowed(action: RoleAction): string {
  return PERMISSIONS[action].map((r) => ROLE_LABELS[r]).join(' or ')
}
