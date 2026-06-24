import { test, expect } from '@playwright/test'
import { gotoAndCheck } from './helpers/guards'

// Part 3: mobile regression. The app has had portrait-overflow and mobile-nav
// regressions before; this locks the key public routes at a phone viewport.
test.use({ viewport: { width: 390, height: 844 } })

const MOBILE_ROUTES = ['/', '/login', '/resident', '/resident/new-request']

for (const path of MOBILE_ROUTES) {
  test(`mobile layout renders at 390x844 for ${path}`, async ({ page }) => {
    const guards = await gotoAndCheck(page, path)

    // No horizontal overflow: the document should not be wider than the viewport.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(scrollWidth, 'horizontal overflow on mobile').toBeLessThanOrEqual(390 + 1)

    guards.assertNoErrors()
  })
}

test('mobile landing exposes a primary CTA that is tappable', async ({ page }) => {
  const guards = await gotoAndCheck(page, '/')
  // The landing body's primary CTA routes residents into the intake flow. (The
  // header's "File a complaint" link collapses into the mobile menu, so assert
  // the always-visible hero CTA instead.)
  const cta = page.getByRole('link', { name: 'Start request' }).first()
  await expect(cta).toBeVisible()
  const box = await cta.boundingBox()
  expect(box, 'CTA has no layout box').not.toBeNull()
  expect(box!.height, 'CTA too small to tap').toBeGreaterThan(20)
  guards.assertNoErrors()
})

test('mobile login exposes the email field and submit button', async ({ page }) => {
  const guards = await gotoAndCheck(page, '/login')
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByRole('button', { name: /send sign-in link/i })).toBeVisible()
  guards.assertNoErrors()
})

test('mobile resident home exposes the start-request CTA', async ({ page }) => {
  const guards = await gotoAndCheck(page, '/resident')
  await expect(page.getByRole('link', { name: 'Start request' }).first()).toBeVisible()
  guards.assertNoErrors()
})
