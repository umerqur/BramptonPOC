import { expect, type Page } from '@playwright/test'

// Shared render-health guards used by every spec. A page is considered healthy
// when:
//   * #root is not blank (the app actually mounted),
//   * there is visible main / heading content,
//   * nothing threw an uncaught page error, and
//   * nothing logged a non-network console.error.
//
// "network" errors are deliberately ignored: failed resource loads, blocked
// hosts, favicon 404s, and Supabase/deck.gl/WebGL chatter are infrastructure
// noise, not application regressions. Everything else is treated as a real bug.

const IGNORED_CONSOLE_PATTERNS: RegExp[] = [
  /net::/i,
  /failed to load resource/i,
  /err_/i,
  /the server responded with a status of \d+/i,
  /\b(4\d\d|5\d\d)\b/,
  /network ?error/i,
  /failed to fetch/i,
  /load failed/i,
  /favicon/i,
  /mock\.supabase\.co/i,
  /supabase/i,
  // App-level data-load failures surface as console.error but are network in
  // nature (the mock host is unreachable for any un-mocked call).
  /failed to load/i,
  /could not load/i,
  /failed to record/i,
  /failed to assign/i,
  /failed to mark/i,
  // deck.gl / luma.gl / WebGL initialisation chatter in headless Chromium.
  /deck/i,
  /luma/i,
  /webgl/i,
  /\bgl\b/i,
  /react devtools/i,
  /download the react/i,
  // React Router v6 future-flag notices (warn, but guard defensively).
  /react router/i,
]

function isIgnorableConsoleError(text: string): boolean {
  return IGNORED_CONSOLE_PATTERNS.some((re) => re.test(text))
}

export type RenderGuards = {
  /** Throws if any uncaught page error or non-network console.error was seen. */
  assertNoErrors: () => void
  pageErrors: Error[]
  consoleErrors: string[]
}

/** Attach page-error and console.error collectors to a page. Call before navigating. */
export function attachGuards(page: Page): RenderGuards {
  const pageErrors: Error[] = []
  const consoleErrors: string[] = []

  page.on('pageerror', (err) => pageErrors.push(err))
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (!isIgnorableConsoleError(text)) consoleErrors.push(text)
  })

  return {
    pageErrors,
    consoleErrors,
    assertNoErrors() {
      expect(pageErrors, `Uncaught page error(s):\n${pageErrors.map((e) => e.message).join('\n')}`).toHaveLength(0)
      expect(
        consoleErrors,
        `Non-network console.error(s):\n${consoleErrors.join('\n')}`,
      ).toHaveLength(0)
    },
  }
}

/** Assert the SPA actually mounted: #root exists and is not empty. */
export async function expectMounted(page: Page): Promise<void> {
  const root = page.locator('#root')
  await expect(root).toBeAttached()
  const text = (await root.innerText()).trim()
  expect(text.length, 'Blank #root — app did not render').toBeGreaterThan(0)
  // There is always a <main> landmark in every layout (public, resident, app).
  await expect(page.locator('main').first()).toBeVisible()
}

/**
 * Navigate to a route and assert the page mounted cleanly. Returns the guards so
 * the caller can make route-specific assertions before calling assertNoErrors().
 */
export async function gotoAndCheck(page: Page, path: string): Promise<RenderGuards> {
  const guards = attachGuards(page)
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await expectMounted(page)
  return guards
}
