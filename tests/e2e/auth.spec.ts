import { test, expect } from '@playwright/test'
import { attachGuards, expectMounted } from './helpers/guards'
import { MOCK_SUPABASE_URL } from './helpers/supabaseMock'

// Part 4: auth regression. The /app area must never be reachable without a
// session, and the login page must degrade gracefully.
//
// NOTE: the E2E dev server runs with dummy Supabase env so isSupabaseConfigured
// is true (the authenticated specs need a client to inject a session into).
// We therefore exercise the login "graceful error" path by making the sign-in
// request fail, which is the same user-visible outcome as an unconfigured
// backend: a calm error message instead of a crash.

const RESTRICTED_MESSAGE = 'Access is restricted to authorized project users.'
const ALLOWED_EMAIL = 'umer.qureshi@gmail.com'
const DISALLOWED_EMAIL = 'random.person@example.com'

const PROTECTED_ROUTES = ['/app', '/app/insights', '/app/workbench', '/app/closure', '/app/field']

for (const path of PROTECTED_ROUTES) {
  test(`unauthenticated visit to ${path} redirects to /login`, async ({ page }) => {
    const guards = attachGuards(page)
    await page.goto(path)
    await page.waitForURL('**/login')
    await expectMounted(page)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    guards.assertNoErrors()
  })
}

test('login renders and shows a graceful error when sign-in fails', async ({ page }) => {
  // Force the magic-link request to fail.
  await page.route(`${MOCK_SUPABASE_URL}/auth/v1/**`, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'mock_failure' }) }),
  )
  const guards = attachGuards(page)
  await page.goto('/login')
  await expectMounted(page)

  await page.getByLabel('Email').fill(ALLOWED_EMAIL)
  await page.getByRole('button', { name: /send sign-in link/i }).click()

  await expect(
    page.getByText(/could not send the sign-in link|sign-in is not available/i),
  ).toBeVisible()
  guards.assertNoErrors()
})

test('allowed email passes the client allowlist (no restricted message)', async ({ page }) => {
  // Accept the magic-link request so the UI advances to the "check your email" state.
  await page.route(`${MOCK_SUPABASE_URL}/auth/v1/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
  )
  const guards = attachGuards(page)
  await page.goto('/login')

  await page.getByLabel('Email').fill(ALLOWED_EMAIL)
  await page.getByRole('button', { name: /send sign-in link/i }).click()

  await expect(page.getByText('Check your email')).toBeVisible()
  await expect(page.getByText(RESTRICTED_MESSAGE)).toHaveCount(0)
  guards.assertNoErrors()
})

test('disallowed email shows the restricted message and does not attempt sign in', async ({ page }) => {
  let signInAttempted = false
  await page.route(`${MOCK_SUPABASE_URL}/auth/v1/**`, (route) => {
    signInAttempted = true
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  })
  const guards = attachGuards(page)
  await page.goto('/login')

  await page.getByLabel('Email').fill(DISALLOWED_EMAIL)
  await page.getByRole('button', { name: /send sign-in link/i }).click()

  await expect(page.getByText(RESTRICTED_MESSAGE)).toBeVisible()
  // Give any (incorrect) network call a moment to fire, then assert none did.
  await page.waitForTimeout(300)
  expect(signInAttempted, 'sign-in must not be attempted for a disallowed email').toBe(false)
  guards.assertNoErrors()
})
