import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, {
  assistantRateLimitDisabled,
  checkAssistantRate,
} from '../../netlify/functions/officer-case-assistant'

// Rate-limit behavior of the Officer Case Assistant function:
//   * OFFICER_ASSISTANT_DISABLE_RATE_LIMIT=true disables the throttle (live demo).
//   * A cooldown block and an hourly-limit block are DISTINCT 429 responses,
//     each with its own message/code and a Retry-After header.
//   * An upstream provider failure (e.g. Groq returning 429) is a 502 provider
//     error — never converted into the local rate-limit response.
//
// The handler tests run the POC fallback path (no server-side Supabase), keyed
// by a per-test client IP so the module-level in-memory throttle store never
// bleeds between tests.

const ENV_KEYS = [
  'OFFICER_ASSISTANT_DISABLE_RATE_LIMIT',
  'OFFICER_ASSISTANT_COOLDOWN_SECONDS',
  'OFFICER_ASSISTANT_HOURLY_LIMIT',
  'GROQ_API_KEY',
  'ANTHROPIC_API_KEY',
  'COHERE_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'URL',
  'DEPLOY_PRIME_URL',
  'QDRANT_URL',
]
const savedEnv = new Map<string, string | undefined>()

// A minimal, valid Groq chat-completion body carrying the assistant's JSON.
function groqOkResponse(): Response {
  const assistantJson = {
    answer: 'Grounded answer.',
    used_context: ['case details'],
    officer_checklist: [],
    missing_information: [],
    benchmark_notes: [],
    field_drafts: null,
    briefing: null,
    handoff: null,
    limitations: 'Decision support only. Staff remain responsible for enforcement decisions.',
  }
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(assistantJson) } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

function makeRequest(ip: string): Request {
  return new Request('http://localhost/.netlify/functions/officer-case-assistant', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({
      caseId: 'RSR-20260709-7BX8',
      mode: 'question',
      question: 'What should I verify on site?',
      caseContext: { issue_type: 'Parking issue', description: 'Blocked driveway', location: '123 Main St' },
    }),
  })
}

// Unique keys/IPs per test so the module-level throttle store never collides.
let seq = 0
function uniqueKey(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key])
    delete process.env[key]
  }
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('checkAssistantRate', () => {
  it('allows everything when the rate limit is disabled for a live demo', () => {
    process.env.OFFICER_ASSISTANT_DISABLE_RATE_LIMIT = 'true'
    expect(assistantRateLimitDisabled()).toBe(true)

    const key = uniqueKey('demo-user')
    const t0 = 1_000_000
    // Ten back-to-back calls, all inside what would normally be the cooldown.
    for (let i = 0; i < 10; i += 1) {
      expect(checkAssistantRate(key, t0 + i * 10)).toEqual({ allowed: true })
    }
  })

  it('blocks with a cooldown reason and the remaining wait, without recording the call', () => {
    const key = uniqueKey('cool-user')
    const t0 = 1_000_000
    expect(checkAssistantRate(key, t0)).toEqual({ allowed: true })

    // 1s into the default 3s cooldown → wait ~2 more seconds.
    expect(checkAssistantRate(key, t0 + 1_000)).toEqual({
      allowed: false,
      reason: 'cooldown',
      retryAfterSeconds: 2,
    })
    // The blocked call was not recorded: after the cooldown it is allowed again.
    expect(checkAssistantRate(key, t0 + 3_500)).toEqual({ allowed: true })
  })

  it('blocks with an hourly-limit reason once the rolling budget is spent', () => {
    process.env.OFFICER_ASSISTANT_HOURLY_LIMIT = '2'
    const key = uniqueKey('hourly-user')
    const t0 = 1_000_000
    expect(checkAssistantRate(key, t0)).toEqual({ allowed: true })
    expect(checkAssistantRate(key, t0 + 10_000)).toEqual({ allowed: true })

    // Past the cooldown but over the hourly budget: retry when the oldest call
    // ages out of the rolling window (3600s - 20s = 3580s).
    expect(checkAssistantRate(key, t0 + 20_000)).toEqual({
      allowed: false,
      reason: 'hourly_limit',
      retryAfterSeconds: 3_580,
    })
  })
})

describe('handler rate-limit responses', () => {
  it('returns the distinct cooldown 429 with a Retry-After header', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key'
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => groqOkResponse()))

    const ip = `10.0.0.${(seq += 1)}`
    const first = await handler(makeRequest(ip))
    expect(first.status).toBe(200)

    // Immediately again → in cooldown.
    const second = await handler(makeRequest(ip))
    expect(second.status).toBe(429)
    expect(second.headers.get('retry-after')).toMatch(/^\d+$/)
    const body = (await second.json()) as { error: string; code: string; retryAfterSeconds: number }
    expect(body.code).toBe('ASSISTANT_COOLDOWN')
    expect(body.error).toBe('Please wait a moment before sending another request.')
    expect(body.retryAfterSeconds).toBeGreaterThan(0)
    expect(String(body.retryAfterSeconds)).toBe(second.headers.get('retry-after'))
  })

  it('returns the distinct hourly-limit 429 with a Retry-After header', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key'
    process.env.OFFICER_ASSISTANT_COOLDOWN_SECONDS = '1'
    process.env.OFFICER_ASSISTANT_HOURLY_LIMIT = '1'
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => groqOkResponse()))

    // Spend the budget with a call recorded 5s ago (past the 1s cooldown), on
    // the exact key the handler derives from the client IP.
    const ip = `10.0.1.${(seq += 1)}`
    expect(checkAssistantRate(ip, Date.now() - 5_000)).toEqual({ allowed: true })

    const res = await handler(makeRequest(ip))
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/)
    const body = (await res.json()) as { error: string; code: string; retryAfterSeconds: number }
    expect(body.code).toBe('ASSISTANT_HOURLY_LIMIT')
    expect(body.error).toBe('Assistant request limit reached.')
    // Never the cooldown wording — the two conditions stay distinct.
    expect(body.error).not.toMatch(/wait a moment/i)
    expect(body.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('lets rapid back-to-back requests through when the rate limit is disabled', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key'
    process.env.OFFICER_ASSISTANT_DISABLE_RATE_LIMIT = 'true'
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => groqOkResponse()))

    const ip = `10.0.2.${(seq += 1)}`
    for (let i = 0; i < 3; i += 1) {
      const res = await handler(makeRequest(ip))
      expect(res.status).toBe(200)
    }
  })

  it('reports an upstream provider 429 as a provider error, never as the local rate limit', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key'
    process.env.OFFICER_ASSISTANT_DISABLE_RATE_LIMIT = 'true'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => new Response('rate limited upstream', { status: 429 })),
    )

    const res = await handler(makeRequest(`10.0.3.${(seq += 1)}`))
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string; code: string }
    expect(body.code).toBe('ASSISTANT_PROVIDER_ERROR')
    expect(body.error).toBe('Assistant service error. Please try again.')
    expect(body.error).not.toMatch(/limit|wait a moment/i)

    // The failure log carries the provider kind and status only — never the
    // API key, the prompt, or the provider response body.
    const logged = vi
      .mocked(console.error)
      .mock.calls.map((args) => args.join(' '))
      .join('\n')
    expect(logged).toContain('provider=groq')
    expect(logged).toContain('429')
    expect(logged).not.toContain('test-groq-key')
    expect(logged).not.toContain('rate limited upstream')
    expect(logged).not.toContain('Blocked driveway')
  })
})
