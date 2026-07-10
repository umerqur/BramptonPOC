/**
 * Env contract check (Part 11 of the CI/CD safety gate).
 *
 * Scans the source tree for every environment variable the app actually reads
 * (`import.meta.env.X` on the frontend, `process.env.X` in the Netlify functions
 * and scripts) and fails if any of them is NOT documented in `.env.example`.
 *
 * This is a deployment-safety gate: a variable that the code depends on but that
 * nobody wrote down is exactly how a feature silently breaks in production after
 * a fresh deploy. Keeping `.env.example` in lockstep with the code makes the
 * required configuration discoverable and reviewable.
 *
 * Run with: npm run check:env  (tsx scripts/check-env-contract.ts)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIRS = ['src', 'netlify', 'scripts']
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'])
const ENV_EXAMPLE = join(ROOT, '.env.example')
// This checker references env access patterns in its own comments/regex; don't
// scan itself or it would flag those illustrative tokens.
const SELF = 'check-env-contract.ts'

// Variables provided by the runtime/platform rather than by our configuration.
// These are intentionally NOT required in .env.example.
const PLATFORM_PROVIDED = new Set<string>([
  // Vite built-ins (import.meta.env.*)
  'MODE',
  'BASE_URL',
  'PROD',
  'DEV',
  'SSR',
  // Node / generic CI
  'NODE_ENV',
  'CI',
  // Netlify build/runtime-injected values
  'URL',
  'DEPLOY_URL',
  'DEPLOY_PRIME_URL',
  'CONTEXT',
  'NETLIFY',
  'NODE_VERSION',
])

const ENV_REF = /\b(?:import\.meta\.env|process\.env)\.([A-Z][A-Z0-9_]*)/g

function walk(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full))
    else if (SCAN_EXTENSIONS.has(extname(full)) && entry !== SELF) out.push(full)
  }
  return out
}

function collectReferencedVars(): Map<string, string[]> {
  const refs = new Map<string, string[]>()
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const text = readFileSync(file, 'utf8')
      let m: RegExpExecArray | null
      ENV_REF.lastIndex = 0
      while ((m = ENV_REF.exec(text)) !== null) {
        const name = m[1]
        const rel = file.replace(`${ROOT}/`, '')
        const list = refs.get(name) ?? []
        if (!list.includes(rel)) list.push(rel)
        refs.set(name, list)
      }
    }
  }
  return refs
}

function documentedVars(): Set<string> {
  const documented = new Set<string>()
  let text: string
  try {
    text = readFileSync(ENV_EXAMPLE, 'utf8')
  } catch {
    console.error(`❌ Missing ${ENV_EXAMPLE}. Create it to document required environment variables.`)
    process.exit(1)
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    documented.add(line.slice(0, eq).trim())
  }
  return documented
}

function main() {
  const referenced = collectReferencedVars()
  const documented = documentedVars()

  const required = [...referenced.keys()]
    .filter((name) => !PLATFORM_PROVIDED.has(name))
    .sort()

  const missing = required.filter((name) => !documented.has(name))

  console.log(`Env contract: ${required.length} required variable(s) referenced in code.`)

  // Informational only — documented but unused vars are fine (future/optional).
  const unusedDocumented = [...documented].filter(
    (name) => !referenced.has(name) && !PLATFORM_PROVIDED.has(name),
  )
  if (unusedDocumented.length > 0) {
    console.log(`ℹ️  Documented but not referenced in code (ok): ${unusedDocumented.join(', ')}`)
  }

  if (missing.length > 0) {
    console.error('\n❌ Env contract violation: these variables are used in code but missing from .env.example:\n')
    for (const name of missing) {
      console.error(`   ${name}`)
      for (const file of referenced.get(name) ?? []) console.error(`       used in ${file}`)
    }
    console.error('\nAdd them to .env.example (document what they are and whether they are server-side only).')
    process.exit(1)
  }

  console.log('✅ All required environment variables are documented in .env.example.')
}

main()
