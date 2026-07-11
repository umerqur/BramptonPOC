// Build marker for deploy diagnosis: the footer shows which bundle the live
// site is actually serving, so a stale Netlify deploy is provable at a glance.
//
// Netlify sets COMMIT_REF during its builds; vite.config.ts injects it at
// build time as __COMMIT_REF__. Dev servers inject an empty string, and test
// runners don't inject the symbol at all (vitest uses its own config), so both
// fall back to the fixed marker label.

declare const __COMMIT_REF__: string | undefined

const injectedCommit =
  typeof __COMMIT_REF__ === 'string' && __COMMIT_REF__.length > 0 ? __COMMIT_REF__.slice(0, 7) : ''

export const BUILD_VERSION = injectedCommit || 'a53397b-enforcement-actions'
