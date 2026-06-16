// Role-based access for the staff workflow, modelled on a standard municipal
// by-law enforcement team. Roles are now derived from the authenticated user's
// email (roleForEmail below) — not only the manual "Acting as" selector. The
// selector remains for supervisor/dev demo testing; a real By-law Officer account
// is locked to the officer role and cannot switch up to supervisor.
//
//   * Supervisor / Coordinator — oversees the queue, assigns work to officers,
//                      can investigate, and is the only role that approves a
//                      closure response. (CSR is treated as a coordinator here.)
//   * By-law Officer — goes to the location, investigates, and records the real
//                      field outcome. Sees only their assigned cases.

export type StaffRole = 'supervisor' | 'officer' | 'csr'

export const ROLE_OPTIONS: StaffRole[] = ['supervisor', 'officer', 'csr']

export const ROLE_LABELS: Record<StaffRole, string> = {
  supervisor: 'Supervisor',
  officer: 'By-law Officer',
  csr: 'Intake / CSR',
}

/**
 * The single demo By-law Officer. Cases assigned to this officer appear in the
 * Officer Field Console for whoever is signed in with this email.
 */
export const DEMO_OFFICER = {
  name: 'Oakley Carpentry Worker',
  email: 'oakley.carpentry_worker@yahoo.com',
  role: 'officer' as StaffRole,
}

/**
 * Demo supervisor / coordinator accounts. Anyone allowed in who is not the demo
 * officer is treated as a supervisor/coordinator with the full staff workflow.
 */
export const SUPERVISOR_EMAILS = [
  'umer.qureshi@gmail.com',
  'umer@neuralforge.ca',
  'balraj_m7@hotmail.com',
  'ousmaan_ahmed@icloud.com',
] as const

/**
 * Central email → role mapping. The demo officer email maps to the officer role;
 * every other authenticated user is a supervisor/coordinator. This is the single
 * source of truth for role separation by signed-in identity.
 */
export function roleForEmail(email: string | null | undefined): StaffRole {
  const value = (email ?? '').trim().toLowerCase()
  if (value && value === DEMO_OFFICER.email) return 'officer'
  return 'supervisor'
}

/** Whether a signed-in user may switch the demo "Acting as" role (officers cannot). */
export function canSwitchRoleForEmail(email: string | null | undefined): boolean {
  return roleForEmail(email) !== 'officer'
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
  // Supervisor/coordinator case management: approve routing, request more info,
  // override priority, prepare the closure draft. Officers cannot do these.
  manageCase: ['supervisor', 'csr'],
  assignOfficer: ['supervisor', 'csr'],
  recordFieldAction: ['officer', 'supervisor'],
  approveClosure: ['supervisor'],
}

export function can(role: StaffRole, action: RoleAction): boolean {
  return PERMISSIONS[action].includes(role)
}

/** Human-readable list of the roles allowed to perform an action. */
export function rolesAllowed(action: RoleAction): string {
  return PERMISSIONS[action].map((r) => ROLE_LABELS[r]).join(' or ')
}
