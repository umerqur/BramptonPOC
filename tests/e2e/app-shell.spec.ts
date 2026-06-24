import { test, expect, type Page } from '@playwright/test'
import { attachGuards, expectMounted } from './helpers/guards'
import {
  buildResidentRow,
  mockSupabase,
  OFFICER_EMAIL,
  seedSession,
  SUPERVISOR_EMAIL,
  type MockOptions,
} from './helpers/supabaseMock'

// Part 5: authenticated app shell regression. With a mocked session every /app
// route must render the AppLayout chrome (brand + navigation) and its page body
// without a blank screen, a page error, or a non-network console.error.

const CASE_ID = 'RSR-20260620-AB12'

function mockOptions(): MockOptions {
  return {
    tables: {
      resident_service_requests: [
        buildResidentRow({ case_id: CASE_ID, status: 'submitted' }),
        buildResidentRow({
          case_id: 'RSR-20260620-CD34',
          status: 'assigned',
          assigned_officer_email: OFFICER_EMAIL,
          assigned_officer_name: 'Officer Oakley',
        }),
      ],
      resident_request_attachments: [],
    },
    objects: {
      // Found resident case so the officer case page can render details.
      resident_service_requests: buildResidentRow({
        case_id: CASE_ID,
        status: 'assigned',
        assigned_officer_email: OFFICER_EMAIL,
        assigned_officer_name: 'Officer Oakley',
      }),
      // Force NYC / municipal detail lookups to a graceful "not found" state
      // instead of inventing a partial record that could crash rendering.
      municipal_complaints: null,
      v_nyc_open_review_queue: null,
    },
  }
}

async function signIn(page: Page, email = SUPERVISOR_EMAIL) {
  await seedSession(page, email)
  await mockSupabase(page, mockOptions())
}

async function assertShell(page: Page) {
  await expectMounted(page)
  // AppLayout brand is always present in the authenticated header.
  await expect(page.getByText('Proactive Enforcement Response').first()).toBeVisible()
  // Navigation renders (supervisor Priority tab).
  await expect(page.getByRole('link', { name: /priority/i }).first()).toBeVisible()
}

const ROUTES = [
  '/app',
  '/app/workbench',
  '/app/closure',
  '/app/insights',
  '/app/field',
  `/app/field/${CASE_ID}`,
  '/app/cases/NYC-TEST-1',
  '/app/nyc_case/NYC-TEST-1',
]

for (const path of ROUTES) {
  test(`app shell renders for ${path}`, async ({ page }) => {
    await signIn(page)
    const guards = attachGuards(page)
    await page.goto(path)
    await assertShell(page)
    guards.assertNoErrors()
  })
}

test('officer session renders the field console shell', async ({ page }) => {
  await signIn(page, OFFICER_EMAIL)
  const guards = attachGuards(page)
  await page.goto('/app/field')
  await expectMounted(page)
  await expect(page.getByText('Proactive Enforcement Response').first()).toBeVisible()
  // Officer nav shows the Field Console entry.
  await expect(page.getByRole('link', { name: /field console/i }).first()).toBeVisible()
  guards.assertNoErrors()
})
