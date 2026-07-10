# Netlify deployment rules

The app is a Vite SPA hosted on Netlify (`netlify.toml`: `npm run build` →
publish `dist/`, SPA fallback to `index.html`). Treat the rules below as the
deployment contract that the CI/CD safety gate protects.

## Rules

1. **Production deploys from `main` only.**
   Netlify's *Production branch* must be `main`. A production deploy happens only
   when `main` changes (i.e. when a reviewed, green PR is merged). No other branch
   publishes to production.

2. **Deploy previews are created for pull requests.**
   Netlify builds a **Deploy Preview** for every PR targeting `main`. The preview
   URL is the place to manually verify the change before merge. The preview's
   `netlify/<site>/deploy-preview` status check is a required check on the PR
   (see [branch-protection.md](./branch-protection.md)).

3. **Merge only after CI is green AND the Netlify preview is healthy.**
   - All four GitHub Actions checks pass (`Typecheck & build`, `Lint`,
     `E2E (Playwright)`, `Env contract`).
   - The Netlify deploy preview built successfully and the previewed app renders
     (no blank screen, login + resident flows reachable).
   Only then merge to `main`, which triggers the production deploy.

## Environment configuration

Production and deploy-preview contexts need the runtime environment variables
documented in [`.env.example`](../.env.example) set in the **Netlify site
environment** (Site settings → Environment variables). The `check:env` CI job
guarantees `.env.example` lists every variable the code reads; Netlify is where
the real values live. Notes:

- `VITE_`-prefixed variables are public and embedded in the client bundle at
  build time (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_BASE_URL`).
- All non-`VITE_` variables are **server-side only** (Netlify Functions) and must
  never be exposed to the browser — e.g. `SUPABASE_SERVICE_ROLE_KEY`,
  `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `MJ_APIKEY_*`.
- `URL` / `DEPLOY_PRIME_URL` are injected by Netlify at build/run time and do not
  need to be set manually.

## Verifying a deploy

Manual smoke check on the deploy preview (and again on production after merge):

- `/` renders the marketing landing page (no blank screen).
- `/login` renders and an allowed email can request a magic link.
- `/resident/new-request` accepts a submission and shows a reference number.
- `/app` redirects to `/login` when signed out; after sign-in the Work Queue,
  Insights, and Officer Field Console load.
