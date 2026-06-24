import { test, expect, type Page } from '@playwright/test'
import { attachGuards, expectMounted } from './helpers/guards'
import { buildResidentRow, mockSupabase, OFFICER_EMAIL, seedSession } from './helpers/supabaseMock'

// Part 8: officer console regression. A signed-in By-law Officer must see only
// their assigned cases, open one, see the field-outcome controls, and save an
// outcome without the page crashing.

const CASE_ID = 'RSR-20260620-OFF1'

function assignedRow() {
  return buildResidentRow({
    case_id: CASE_ID,
    status: 'assigned',
    request_type: 'Property standards',
    assigned_officer_email: OFFICER_EMAIL,
    assigned_officer_name: 'Officer Oakley',
    assigned_at: '2026-06-19T09:00:00.000Z',
  })
}

async function signIn(page: Page) {
  await seedSession(page, OFFICER_EMAIL)
  await mockSupabase(page, {
    tables: { resident_service_requests: [assignedRow()], resident_request_attachments: [] },
    objects: { resident_service_requests: assignedRow() },
  })
}

test('officer field console loads with assigned cases', async ({ page }) => {
  await signIn(page)
  const guards = attachGuards(page)
  await page.goto('/app/field', { waitUntil: 'domcontentloaded' })
  await expectMounted(page)
  await expect(page.getByRole('heading', { name: 'Officer Field Console' })).toBeVisible()
  // The assigned case row links into the case.
  await expect(page.getByRole('link', { name: /record field outcome|view field outcome/i }).first()).toBeVisible()
  guards.assertNoErrors()
})

test('officer opens an assigned case and sees the field outcome controls', async ({ page }) => {
  await signIn(page)
  const guards = attachGuards(page)
  await page.goto('/app/field', { waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: /record field outcome|view field outcome/i }).first().click()
  await page.waitForURL('**/app/field/**')
  await expectMounted(page)
  // Case id heading + the field outcome panel both render.
  await expect(page.getByRole('heading', { name: CASE_ID })).toBeVisible()
  await expect(page.getByText('Record field outcome')).toBeVisible()
  guards.assertNoErrors()
})

test('officer can interact with the field outcome form without crashing', async ({ page }) => {
  await signIn(page)
  const guards = attachGuards(page)
  await page.goto(`/app/field/${CASE_ID}`, { waitUntil: 'domcontentloaded' })
  await expectMounted(page)
  await expect(page.getByText('Record field outcome')).toBeVisible()

  // Provide an observed condition and attempt to save. Whether validation gates
  // it or the mocked update succeeds, the page must not throw or blank out.
  await page.getByPlaceholder('Describe what you observed on site…').fill(
    'Yard cleared on arrival; no active violation observed at the time of inspection.',
  )
  await page.getByRole('button', { name: /field outcome complete|saving/i }).click()

  await expectMounted(page)
  guards.assertNoErrors()
})
