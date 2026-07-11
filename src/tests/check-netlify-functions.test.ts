import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// The guard script keeps netlify/functions deployable: Netlify packages every
// file in that directory as a serverless function, so test/spec files and
// test-scaffolding directories must fail the check (exit 1) with the
// offending paths printed. Each test builds a throwaway directory and runs
// the script against it via its optional [dir] argument.

const SCRIPT = join(process.cwd(), 'scripts', 'check-netlify-functions.mjs')

const tempDirs: string[] = []

function makeFunctionsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'netlify-functions-guard-'))
  tempDirs.push(dir)
  return dir
}

function runGuard(dir: string) {
  return spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' })
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('check-netlify-functions guard', () => {
  it('passes a directory containing only deployable function files', () => {
    const dir = makeFunctionsDir()
    writeFileSync(join(dir, 'officer-case-assistant.ts'), 'export default async () => new Response("ok")\n')
    writeFileSync(join(dir, 'similar-cases.ts'), 'export default async () => new Response("ok")\n')

    const result = runGuard(dir)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('OK')
  })

  it('fails on a .test.ts file and prints its path', () => {
    const dir = makeFunctionsDir()
    writeFileSync(join(dir, 'officer-case-assistant.ts'), 'export default async () => new Response("ok")\n')
    writeFileSync(join(dir, 'officer-case-assistant.test.ts'), 'it("x", () => {})\n')

    const result = runGuard(dir)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(join(dir, 'officer-case-assistant.test.ts'))
  })

  it('fails on a .spec.ts file and prints its path', () => {
    const dir = makeFunctionsDir()
    writeFileSync(join(dir, 'similar-cases.spec.ts'), 'it("x", () => {})\n')

    const result = runGuard(dir)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(join(dir, 'similar-cases.spec.ts'))
  })

  it('fails on a nested __tests__ directory and prints its path', () => {
    const dir = makeFunctionsDir()
    const nested = join(dir, 'helpers', '__tests__')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'helper.ts'), 'export const x = 1\n')

    const result = runGuard(dir)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(nested)
  })
})
