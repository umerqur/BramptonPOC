import { defineConfig } from 'vitest/config'

// Unit tests cover the pure business logic: the access allowlist, staff role /
// profile resolution, resident request validation, attachment validation,
// status mapping, and the API payload builders. They run in a jsdom
// environment because a couple of helpers touch `File` / browser globals.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/unit/**/*.test.ts'],
  },
})
