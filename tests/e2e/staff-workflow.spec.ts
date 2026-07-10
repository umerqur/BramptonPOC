import { test, expect, type Page } from '@playwright/test'
import { attachGuards, expectMounted } from './helpers/guards'
import { buildResidentRow, mockSupabase, seedSession, SUPERVISOR_EMAIL } from './helpers/supabaseMock'

// Part 6: staff workflow regression. Exercises the core supervisor journey —
// Work Queue -> Case Workbench -> Closure Review -> Insights — and locks the
// legacy /app route redirects.

async function signIn(page: Page) {
  await seedSession(page, SUPERVISOR_EMAIL)
  await mockSupabase(page, {
    tables: {
      resident_service_requests: [
        buildResidentRow({ case_id: 'RSR-20260620-NEW1', status: 'submitted' }),
        buildResidentRow({ case_id: 'RSR-20260620-NEW2', status: 'submitted', request_type: 'Noise complaint' }),
      ],
      resident_request_attachments: [],
    },
    objects: {
      resident_service_requests: buildResidentRow({ case_id: 'RSR-20260620-NEW1', status: 'submitted' }),
      municipal_complaints: null,
      v_nyc_open_review_queue: null,
    },
  })
}

test('staff land on the Work Queue and see service request rows', async ({ page }) => {
  await signIn(page)
  const guards = attachGuards(page)
  await page.goto('/app', { waitUntil: 'domcontentloaded' })
  await expectMounted(page)
  await expect(page.getByRole('heading', { name: 'Priority Queue' })).toBeVisible()
  // At least one resident service-request card with an "Open case" action.
  await expect(page.getByRole('button', { name: /open case/i }).first()).toBeVisible()
  guards.assertNoErrors()
})

test('staff open a case into the Case Workbench', async ({ page }) => {
  await signIn(page)
  const guards = attachGuards(page)
  await page.goto('/app', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /open case/i }).first().click()
  await page.waitForURL('**/app/workbench**')
  await expectMounted(page)
  // The workflow store always has an active case, so the workbench renders detail.
  await expect(page.getByRole('heading', { name: 'Case Workbench' })).toBeVisible()
  guards.assertNoErrors()
})

test('staff can open Closure Review and see the draft/review state', async ({ page }) => {
  await signIn(page)
  const guards = attachGuards(page)
  await page.goto('/app/closure', { waitUntil: 'domcontentloaded' })
  await expectMounted(page)
  await expect(page.getByRole('heading', { name: /closure review/i })).toBeVisible()
  guards.assertNoErrors()
})

test('staff can open Insights and the dashboard renders', async ({ page }) => {
  await signIn(page)
  const guards = attachGuards(page)
  await page.goto('/app/insights', { waitUntil: 'domcontentloaded' })
  await expectMounted(page)
  await expect(page.getByRole('heading', { name: 'Workload Intelligence' })).toBeVisible()
  guards.assertNoErrors()
})

// Legacy /app route redirects — old links must keep landing somewhere valid.
const APP_REDIRECTS: Array<{ from: string; to: string }> = [
  { from: '/app/home', to: '/app' },
  { from: '/app/dashboard', to: '/app/insights' },
  { from: '/app/supervisor', to: '/app/insights' },
  { from: '/app/legacy-insights', to: '/app/insights' },
  { from: '/app/wards', to: '/app/insights' },
  { from: '/app/closure-review', to: '/app/closure' },
]

for (const { from, to } of APP_REDIRECTS) {
  test(`legacy redirect ${from} -> ${to}`, async ({ page }) => {
    await signIn(page)
    const guards = attachGuards(page)
    await page.goto(from, { waitUntil: 'domcontentloaded' })
    await page.waitForURL((url) => url.pathname === to)
    await expectMounted(page)
    guards.assertNoErrors()
  })
}
