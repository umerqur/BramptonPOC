import { test, expect, type Page } from '@playwright/test'
import { attachGuards, expectMounted } from './helpers/guards'
import { mockSupabase, seedSession, SUPERVISOR_EMAIL } from './helpers/supabaseMock'

// Part 9: Insights regression. The dashboard mixes deck.gl/map components with
// KPI cards, charts, and tables. Tests assert on the durable DOM (headings,
// tabs, controls, container) rather than canvas pixels, so they stay robust.

const NYC_CASE_ID = 'NYC-INSIGHTS-1'

const nycRecord = {
  case_id: NYC_CASE_ID,
  source_dataset_id: '987654',
  complaint_type: 'Illegal Parking',
  status: 'Closed',
  borough: 'BROOKLYN',
  agency: 'NYPD',
  agency_name: 'New York City Police Department',
  submitted_at: '2026-01-02T10:00:00.000Z',
  closed_at: '2026-01-05T14:00:00.000Z',
  address_or_location: '123 Test Ave, Brooklyn, NY',
  council_district: '33',
  resolution_description: 'The Police Department responded and took action.',
}

async function signIn(page: Page) {
  await seedSession(page, SUPERVISOR_EMAIL)
  await mockSupabase(page, {
    // Provide both the object (single()/maybeSingle()) and list shapes so the
    // unified NYC detail lookup resolves the record regardless of how the query
    // is issued.
    objects: { municipal_complaints: nycRecord },
    tables: { municipal_complaints: [nycRecord] },
  })
}

test('insights dashboard loads with workload metrics', async ({ page }) => {
  await signIn(page)
  const guards = attachGuards(page)
  await page.goto('/app/insights', { waitUntil: 'domcontentloaded' })
  await expectMounted(page)
  await expect(page.getByRole('heading', { name: 'Workload Intelligence' })).toBeVisible()
  // The Overview tab renders the operational snapshot (workload KPIs container).
  await expect(page.getByRole('tab', { name: /overview/i }).first()).toBeVisible()
  await expect(page.getByText('Operational snapshot').first()).toBeVisible()
  guards.assertNoErrors()
})

test('switching to the Case Explorer tab does not crash', async ({ page }) => {
  await signIn(page)
  const guards = attachGuards(page)
  await page.goto('/app/insights', { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: /case explorer/i }).first().click()
  await expectMounted(page)
  // Still rendering the dashboard chrome after the tab switch.
  await expect(page.getByRole('heading', { name: 'Workload Intelligence' })).toBeVisible()
  guards.assertNoErrors()
})

test('opening an NYC case renders the case detail page', async ({ page }) => {
  await signIn(page)
  const guards = attachGuards(page)
  await page.goto(`/app/nyc_case/${NYC_CASE_ID}`, { waitUntil: 'domcontentloaded' })
  await expectMounted(page)
  // The detail page renders the case id (heading + breadcrumb); make sure it is
  // the loaded record, not the "Case not found" state.
  await expect(page.getByText('Case not found')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: NYC_CASE_ID })).toBeVisible()
  guards.assertNoErrors()
})
