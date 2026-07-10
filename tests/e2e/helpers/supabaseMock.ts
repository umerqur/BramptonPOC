import type { Page, Route } from '@playwright/test'

// Mocks the Supabase backend for authenticated E2E specs. The dev server runs
// with VITE_SUPABASE_URL=https://mock.supabase.co, so:
//   * seedSession() writes a fake persisted session into localStorage under the
//     storage key supabase-js derives from that URL (sb-mock-auth-token). The
//     AuthProvider reads it via supabase.auth.getSession() and the app treats the
//     user as signed in — no real magic-link round trip.
//   * mockSupabase() intercepts every request to the mock host and answers REST
//     reads/writes, auth, and storage with canned JSON so pages render their real
//     content (or graceful empty states) without touching a network.

export const MOCK_SUPABASE_URL = 'https://mock.supabase.co'
export const SESSION_STORAGE_KEY = 'sb-mock-auth-token'

/** Allowlisted supervisor identity (see src/lib/roles.ts). */
export const SUPERVISOR_EMAIL = 'umer.qureshi@gmail.com'
/** Dedicated demo By-law Officer identity (officer-only profile). */
export const OFFICER_EMAIL = 'oakley.carpentry_worker@yahoo.com'

type SessionUser = {
  id: string
  email: string
}

function buildSession(email: string) {
  return {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    // Far-future expiry so supabase-js never tries to refresh over the network.
    expires_at: 9999999999,
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    } satisfies Record<string, unknown> & SessionUser,
  }
}

/** Seed a fake signed-in session before the app loads. Call before page.goto(). */
export async function seedSession(page: Page, email: string): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value)
    },
    { key: SESSION_STORAGE_KEY, value: JSON.stringify(buildSession(email)) },
  )
}

/** Build a resident_service_requests row with sensible demo defaults. */
export function buildResidentRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const now = '2026-06-20T12:00:00.000Z'
  return {
    id: 'row-' + Math.abs(hashString(String(overrides.case_id ?? 'x'))),
    case_id: 'RSR-20260620-AB12',
    address_type: 'Street Address',
    location: '24 Main St N',
    city: 'Brampton',
    province: 'Ontario',
    request_type: 'Property standards',
    description: 'Overgrown yard with debris affecting the neighbouring property.',
    first_name: 'Jordan',
    last_name: 'Resident',
    resident_name: 'Jordan Resident',
    unit_number: null,
    postal_code: 'L6V 1A1',
    country: 'Canada',
    resident_phone: '905-555-0100',
    resident_email: 'jordan.resident@example.com',
    resolution_followup: true,
    method_of_contact: 'Email',
    status: 'submitted',
    is_demo: true,
    created_at: now,
    updated_at: now,
    assigned_officer_email: null,
    assigned_officer_name: null,
    assigned_at: null,
    field_visit_completed: false,
    field_observed_condition: null,
    field_violation_observed: null,
    field_enforcement_action: null,
    field_service_method: null,
    field_reference_number: null,
    field_action_taken: null,
    field_officer_notes: null,
    field_follow_up_required: false,
    field_outcome_recorded_at: null,
    ...overrides,
  }
}

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i)
  return h
}

export type MockOptions = {
  /** GET responses keyed by table/view name. Returned for list (array) reads. */
  tables?: Record<string, unknown[]>
  /** Single-object responses keyed by table/view name (single()/maybeSingle()). */
  objects?: Record<string, unknown>
  /** RPC responses keyed by function name. */
  rpc?: Record<string, unknown>
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  })
}

/**
 * Intercept all traffic to the mock Supabase host. Un-mocked reads resolve to an
 * empty list / empty object so no page throws or logs a non-network error.
 */
export async function mockSupabase(page: Page, opts: MockOptions = {}): Promise<void> {
  await page.route(`${MOCK_SUPABASE_URL}/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    const method = req.method()
    const accept = req.headers()['accept'] ?? ''
    const wantsObject = accept.includes('pgrst.object')

    // CORS preflight.
    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': '*',
          'Access-Control-Allow-Headers': '*',
        },
      })
    }

    // Auth endpoints — return a session/user shaped body so any auth call is happy.
    if (path.startsWith('/auth/v1')) {
      if (path.includes('/user')) {
        return json(route, buildSession(SUPERVISOR_EMAIL).user)
      }
      if (path.includes('/logout')) {
        return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } })
      }
      // token / otp / verify
      return json(route, buildSession(SUPERVISOR_EMAIL))
    }

    // Storage — signed URLs / uploads. Empty-ish success.
    if (path.startsWith('/storage/v1')) {
      if (path.includes('/sign/')) return json(route, { signedURL: '/mock-signed-url' })
      return json(route, {})
    }

    // RPC.
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.split('/').pop() ?? ''
      return json(route, opts.rpc?.[fn] ?? [])
    }

    // REST tables / views.
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '').split('?')[0]
      if (wantsObject) {
        // An explicit entry in `objects` wins (including a literal null, which
        // makes maybeSingle() resolve to "not found"). Otherwise fall back to the
        // first list row, then to an empty object so aggregate .single() reads on
        // views resolve to zeros instead of erroring.
        let obj: unknown = {}
        if (opts.objects && table in opts.objects) obj = opts.objects[table]
        else if (opts.tables?.[table]?.length) obj = opts.tables[table]![0]
        return json(route, obj, method === 'POST' ? 201 : 200)
      }
      const list = opts.tables?.[table] ?? []
      return json(route, list, method === 'POST' ? 201 : 200)
    }

    return json(route, [])
  })
}

/** Convenience: seed a supervisor session + mock the backend in one call. */
export async function signInAsSupervisor(page: Page, opts: MockOptions = {}): Promise<void> {
  await seedSession(page, SUPERVISOR_EMAIL)
  await mockSupabase(page, opts)
}

/** Convenience: seed the demo officer session + mock the backend in one call. */
export async function signInAsOfficer(page: Page, opts: MockOptions = {}): Promise<void> {
  await seedSession(page, OFFICER_EMAIL)
  await mockSupabase(page, opts)
}
