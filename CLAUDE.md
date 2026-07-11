# CLAUDE.md

Guidance for Claude (and other AI agents) working in this repository.

## Deployment reporting rules (permanent)

This site deploys to Netlify from `main`. Merging code does **not** mean the
feature is live. Every task completion report MUST distinguish these four
statuses, each reported separately and explicitly:

1. **Code merged** — the change landed on `main` (include the commit SHA).
2. **Netlify deploy triggered** — a Netlify build actually started for that
   commit.
3. **Netlify deploy succeeded** — the Netlify build and deploy finished
   without errors.
4. **Live site verified** — the deployed site was loaded and the change was
   observed working in production.

Never say a feature is "live", "deployed", or "done" merely because it was
merged. If deployment status cannot be checked (no Netlify access from the
current environment), explicitly state:

> Code is merged, but Netlify deployment has not been verified.

## Netlify functions directory hygiene

Netlify packages **every** file in `netlify/functions/` as a serverless
function. Test files there break deploys (function names containing `.test`
are rejected). Rules:

- Only deployable function entry files belong in `netlify/functions/`.
- Tests for functions live in `src/tests/` (e.g.
  `src/tests/officer-case-assistant-function.test.ts`) and import the handler
  from `../../netlify/functions/<name>`.
- Never add `*.test.*`, `*.spec.*`, `__tests__/`, `fixtures/`, or `mocks/`
  under `netlify/functions/`.
- `npm run check:netlify-functions` enforces this; run it (or `npm run
  verify`) before merging anything that touches `netlify/functions/`.

## Verification before merge

Run `npm run verify` before merging to `main`. It runs, in order:

1. `npm run check:netlify-functions` — functions-directory hygiene guard
2. `npm run build` — TypeScript project build + Vite production build
3. `npm run lint` — ESLint
4. `npm test` — Vitest suite
