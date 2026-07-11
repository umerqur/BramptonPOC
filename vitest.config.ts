import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Test runner config, separate from vite.config.ts so the production build
// pipeline is untouched. Tests live next to the code as src/**/*.test.ts(x)
// and are excluded from tsconfig.app.json (the app build never compiles them).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
  },
})
