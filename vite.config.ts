import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Netlify provides COMMIT_REF in its build environment; inject it at build
  // time so the footer build marker identifies exactly which commit a deploy
  // is serving (see src/lib/buildInfo.ts). Local builds inject an empty string
  // and fall back to the fixed marker label.
  define: {
    __COMMIT_REF__: JSON.stringify(process.env.COMMIT_REF ?? ''),
  },
})
