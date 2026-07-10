import { test, expect } from '@playwright/test'
import { attachGuards, expectMounted, gotoAndCheck } from './helpers/guards'

// Part 2: public page regression. Every public route must render real content
// (no blank #root, visible <main>), with no uncaught page error and no
// non-network console.error. We also lock in the legacy public redirects so old
// links keep working.

type PublicRoute = {
  path: string
  // A stable, user-facing heading/string that proves the right page rendered.
  content: string
}

const PUBLIC_ROUTES: PublicRoute[] = [
  { path: '/', content: 'AI Assisted Municipal Enforcement Intake & Closure POC' },
  { path: '/methodology', content: 'How the AI assisted enforcement POC works' },
  { path: '/privacy', content: 'How this POC handles data, decisions, and accountability' },
  { path: '/login', content: 'Sign in' },
  { path: '/resident', content: 'Resident services' },
  { path: '/resident/new-request', content: 'Create a service request' },
]

for (const route of PUBLIC_ROUTES) {
  test(`public route ${route.path} renders without regressions`, async ({ page }) => {
    const guards = await gotoAndCheck(page, route.path)
    await expect(page.getByText(route.content, { exact: false }).first()).toBeVisible()
    guards.assertNoErrors()
  })
}

test('legacy redirect /dashboard -> /login', async ({ page }) => {
  const guards = attachGuards(page)
  await page.goto('/dashboard')
  await page.waitForURL('**/login')
  await expectMounted(page)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  guards.assertNoErrors()
})

test('legacy redirect /cases -> /login', async ({ page }) => {
  const guards = attachGuards(page)
  await page.goto('/cases')
  await page.waitForURL('**/login')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  guards.assertNoErrors()
})

test('legacy redirect /cases/test -> /login', async ({ page }) => {
  const guards = attachGuards(page)
  await page.goto('/cases/test')
  await page.waitForURL('**/login')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  guards.assertNoErrors()
})

test('legacy redirect /how-it-works -> /methodology', async ({ page }) => {
  const guards = attachGuards(page)
  await page.goto('/how-it-works')
  await page.waitForURL('**/methodology')
  await expect(page.getByText('How the AI assisted enforcement POC works', { exact: false })).toBeVisible()
  guards.assertNoErrors()
})
