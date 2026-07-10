import { defineConfig, devices } from '@playwright/test'

// E2E deployment safety gate. These tests boot the real Vite app and assert that
// every public route, the auth gate, the resident intake flow, and the
// authenticated staff/officer/insights shells render without a blank screen,
// an uncaught page error, or a non-network console.error.
//
// The dev server is started with DUMMY Supabase credentials so the app treats
// itself as "configured" (isSupabaseConfigured === true). The authenticated
// specs then seed a fake session into localStorage and route-mock the Supabase
// REST/auth endpoints — see tests/e2e/helpers. No real backend is ever touched.
const PORT = 5173
const HOST = '127.0.0.1'
const BASE_URL = `http://${HOST}:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // deck.gl / WebGL needs a GL backend in headless Chromium.
    launchOptions: { args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run dev -- --host ${HOST} --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Dummy, non-secret values: the app only checks that both are present to
      // flip isSupabaseConfigured on. All Supabase traffic is route-mocked.
      VITE_SUPABASE_URL: 'https://mock.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'mock-anon-key-for-e2e-only',
      VITE_APP_BASE_URL: BASE_URL,
    },
  },
})
