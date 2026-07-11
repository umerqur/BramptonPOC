# Officer Case Assistant — configuration

The Officer Case Assistant is a case-scoped, server-side decision-support
helper (`netlify/functions/officer-case-assistant.ts`). It is **not** a generic
chatbot: it answers only about the one case it is scoped to, and it never makes
an enforcement decision, issues or recommends a ticket / fine / warning /
closure, closes a case, submits a form, modifies Supabase records, or invents
bylaws, policies, evidence, case history, or benchmark cases.

## Provider order (generation layer only)

1. **Groq** (preferred) — set `GROQ_API_KEY`. Model comes from
   `GROQ_OFFICER_ASSISTANT_MODEL`, defaulting to `openai/gpt-oss-20b`.
2. **Anthropic** (fallback) — `ANTHROPIC_API_KEY` +
   `ANTHROPIC_OFFICER_ASSISTANT_MODEL`.
3. **Cohere** (fallback) — `COHERE_API_KEY` + `COHERE_COMMAND_MODEL`.

Benchmark retrieval is separate and always Cohere + Qdrant (embeddings +
rerank via `similar-cases`); the generation provider never changes it. All keys
stay server-side in the Netlify environment — never create `VITE_` copies.

## Testing a stronger Groq model (configuration only)

Never hardcode a model change. To trial a stronger model, set the environment
variable in Netlify (Site settings → Environment variables) and redeploy:

```
GROQ_OFFICER_ASSISTANT_MODEL=openai/gpt-oss-120b      # larger GPT-OSS
GROQ_OFFICER_ASSISTANT_MODEL=llama-3.3-70b-versatile  # Llama 3.3 70B
GROQ_OFFICER_ASSISTANT_MODEL=openai/gpt-oss-20b       # the safe default
```

Test procedure:

1. Confirm the model id is available on your Groq account (Groq console →
   Models). An unavailable id returns a non-200 and the UI shows the calm
   "Assistant service error" state — nothing breaks, but the assistant is
   degraded until reverted.
2. Set the variable, redeploy, open an assigned case, and check: the automatic
   field briefing renders all sections; "Clean up my notes" returns insertable
   drafts; the supervisor handoff fills every field; benchmark notes cite only
   retrieved case ids; refusal still triggers on off-topic questions.
3. Roll back by removing the variable (falls back to `openai/gpt-oss-20b`).

The response payload includes `provider` and `model`, so you can verify which
model answered from the browser network tab.

## Rate limits

Server-side, per verified user (or client IP in POC mode):

```
OFFICER_ASSISTANT_COOLDOWN_SECONDS=3       # seconds between calls (default 3, max 300)
OFFICER_ASSISTANT_HOURLY_LIMIT=30          # calls per rolling hour (default 30, max 1000)
OFFICER_ASSISTANT_DISABLE_RATE_LIMIT=true  # live-demo mode: disables the throttle entirely
```

Defaults reflect the field workflow: opening a case costs one automatic
briefing, plus a few follow-up questions and a supervisor handoff. The old
hardcoded 9 s / 10-per-hour budget was too tight for that; invalid or missing
values fall back to the defaults.

The two blocked conditions return distinct HTTP 429 responses, each with a
`Retry-After` header and a JSON body carrying `code` (`ASSISTANT_COOLDOWN` or
`ASSISTANT_HOURLY_LIMIT`) plus `retryAfterSeconds`. Upstream provider failures
(429/5xx/timeout/malformed response) are returned as 502 with
`code: ASSISTANT_PROVIDER_ERROR` — never as a local rate limit — and are logged
with the provider kind, status, and a case-safe request id only (never keys,
prompts, resident details, or provider response bodies).

For the live Brampton POC demo, set `OFFICER_ASSISTANT_DISABLE_RATE_LIMIT=true`
in the Netlify **production environment variables** (Site settings →
Environment variables). It is read server-side only — do not create a `VITE_`
copy. Remove the variable to restore the configurable limits.

## Data the assistant sees

Case row (operational fields only — no resident contact details), recent
workflow events, the officer's live unsaved field draft, same-address history
(operational columns only; see migration 041), and reranked benchmark
references. Form readiness is computed deterministically in TypeScript
(`src/lib/fieldOutcomeReadiness.ts`) — the model may explain missing items but
never decides readiness, and the server rejects benchmark citations for cases
that retrieval did not return.
