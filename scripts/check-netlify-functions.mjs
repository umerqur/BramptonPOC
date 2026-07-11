#!/usr/bin/env node
// Guard: netlify/functions must contain only deployable function entry files.
// Netlify packages every file in that directory as a serverless function, and
// derived function names containing ".test"/".spec" are rejected at deploy
// time. Fails (exit 1) on test/spec files and on test-scaffolding directories.
//
// Usage: node scripts/check-netlify-functions.mjs [dir]
//   dir defaults to netlify/functions; tests pass a temp directory.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const FORBIDDEN_FILE = /\.(test|spec)\.tsx?$/
const FORBIDDEN_DIRS = new Set(['__tests__', 'fixtures', 'mocks'])

const target = process.argv[2] ?? 'netlify/functions'
const offenders = []

function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (FORBIDDEN_DIRS.has(entry.name)) offenders.push(path)
      scan(path)
    } else if (FORBIDDEN_FILE.test(entry.name)) {
      offenders.push(path)
    }
  }
}

try {
  scan(target)
} catch (err) {
  console.error(`check-netlify-functions: cannot scan ${target}: ${err.message}`)
  process.exit(1)
}

if (offenders.length > 0) {
  console.error(`check-netlify-functions: non-deployable entries found in ${target}:`)
  for (const path of offenders) console.error(`  ${path}`)
  console.error('Move tests and fixtures out of the Netlify functions directory (e.g. to src/tests/).')
  process.exit(1)
}

console.log(`check-netlify-functions: OK — ${target} contains only deployable files`)
