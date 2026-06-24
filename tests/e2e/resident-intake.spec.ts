import { test, expect, type Page } from '@playwright/test'
import { attachGuards, expectMounted, gotoAndCheck } from './helpers/guards'
import { mockSupabase } from './helpers/supabaseMock'

// Part 7: resident intake regression. Covers the full public submission flow
// (with a mocked backend) plus the client-side validation and attachment rules.

const FILE_INPUT = '#resident-attachment-files'

async function mockBackend(page: Page) {
  // Supabase insert + the resident email Netlify function.
  await mockSupabase(page)
  await page.route('**/.netlify/functions/send-resident-email', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
  )
}

/** Fill the contact fields the demo autofill leaves blank. */
async function fillContact(page: Page, email = 'jordan.resident@example.com') {
  await page.getByLabel('First name').fill('Jordan')
  await page.getByLabel('Last name').fill('Resident')
  // Target the email input by placeholder: getByLabel('Email') is ambiguous
  // because the "Method of contact" <select> has an <option>Email</option>.
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByLabel('Method of contact').selectOption('Email')
}

test('resident can navigate from /resident to the new request form', async ({ page }) => {
  const guards = await gotoAndCheck(page, '/resident')
  await page.getByRole('link', { name: 'Start request' }).first().click()
  await page.waitForURL('**/resident/new-request')
  await expect(page.getByRole('heading', { name: 'Create a service request' })).toBeVisible()
  guards.assertNoErrors()
})

test('resident can submit a request and see a confirmation with a reference number', async ({ page }) => {
  await mockBackend(page)
  const guards = attachGuards(page)
  await page.goto('/resident/new-request')
  await expectMounted(page)

  // Autofill request type, "happening now", description, and location.
  await page.getByRole('button', { name: 'Generate demo request' }).click()
  await fillContact(page)

  await page.getByRole('button', { name: 'Submit request' }).click()

  await expect(page.getByText('Request submitted')).toBeVisible()
  await expect(page.getByText('Reference number')).toBeVisible()
  // A generated demo case id like RSR-20260620-7K4Q is displayed.
  await expect(page.getByText(/RSR-\d{8}-[A-Z2-9]{4}/)).toBeVisible()
  guards.assertNoErrors()
})

test('missing required fields blocks submit', async ({ page }) => {
  await mockBackend(page)
  const guards = attachGuards(page)
  await page.goto('/resident/new-request')

  // Submit an empty form — the first required-field error must appear.
  await page.getByRole('button', { name: 'Submit request' }).click()
  await expect(page.getByText('Please choose a service request type.')).toBeVisible()
  // Still on the form, not on the success screen.
  await expect(page.getByText('Request submitted')).toHaveCount(0)
  guards.assertNoErrors()
})

test('invalid email blocks submit', async ({ page }) => {
  await mockBackend(page)
  const guards = attachGuards(page)
  await page.goto('/resident/new-request')

  await page.getByRole('button', { name: 'Generate demo request' }).click()
  await fillContact(page, 'not-an-email')
  await page.getByRole('button', { name: 'Submit request' }).click()

  await expect(page.getByText('Please enter a valid email address.')).toBeVisible()
  await expect(page.getByText('Request submitted')).toHaveCount(0)
  guards.assertNoErrors()
})

test('unsupported attachment type is rejected', async ({ page }) => {
  const guards = await gotoAndCheck(page, '/resident/new-request')
  await page.setInputFiles(FILE_INPUT, {
    name: 'malware.exe',
    mimeType: 'application/x-msdownload',
    buffer: Buffer.from('not an image'),
  })
  await expect(page.getByText(/malware\.exe not supported/)).toBeVisible()
  guards.assertNoErrors()
})

test('oversized attachment is rejected', async ({ page }) => {
  const guards = await gotoAndCheck(page, '/resident/new-request')
  await page.setInputFiles(FILE_INPUT, {
    name: 'huge.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.alloc(11 * 1024 * 1024, 1), // 11 MB, over the 10 MB cap
  })
  await expect(page.getByText(/huge\.jpg over 10 MB/)).toBeVisible()
  guards.assertNoErrors()
})

test('accepted attachment type is allowed', async ({ page }) => {
  const guards = await gotoAndCheck(page, '/resident/new-request')
  await page.setInputFiles(FILE_INPUT, {
    name: 'evidence.png',
    mimeType: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  })
  // The file is accepted: it shows in the chosen-files list and no error appears.
  await expect(page.getByText('evidence.png')).toBeVisible()
  await expect(page.getByText(/not supported|over 10 MB/)).toHaveCount(0)
  guards.assertNoErrors()
})
