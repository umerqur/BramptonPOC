// Role-based access for the staff workflow, modelled on a standard municipal
// by-law enforcement team. The app's sign-in is a flat magic-link allowlist with
// no real roles, so for the POC the active role is a demo selection (held in the
// workflow store, persisted to localStorage) that a single reviewer can switch
// between to see how each role's permissions gate the workflow.
//
//   * Intake / CSR  — logs and triages complaints, assigns them to an officer.
//   * By-law Officer — goes to the location, investigates, and records the real
//                      field outcome (no violation / notice / ticket / resolved).
//   * Supervisor    — oversees the queue, can assign and act as an officer, and
//                      is the only role that approves a closure response.

export type StaffRole = 'supervisor' | 'officer' | 'csr'

export const ROLE_OPTIONS: StaffRole[] = ['supervisor', 'officer', 'csr']

export const ROLE_LABELS: Record<StaffRole, string> = {
  supervisor: 'Supervisor',
  officer: 'By-law Officer',
  csr: 'Intake / CSR',
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
  officer: 'R. Singh (By-law Officer)',
  csr: 'J. Lee (Intake / CSR)',
}

/** The gated actions in the enforcement workflow. */
export type RoleAction = 'assignOfficer' | 'recordFieldAction' | 'approveClosure'

// Which roles may perform each gated action.
const PERMISSIONS: Record<RoleAction, StaffRole[]> = {
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
