# Branch protection — `main`

`main` is the production branch: Netlify builds and deploys production **from
`main` only** (see [netlify-deployment.md](./netlify-deployment.md)). Nothing
should reach `main` except through a reviewed pull request whose CI is green.

Configure the following ruleset / branch-protection settings for `main` in
**GitHub → Settings → Rules / Branches**.

## Required settings

- **Require a pull request before merging**
  - No direct pushes to `main`.
  - Require at least 1 approving review (recommended).
  - Dismiss stale approvals when new commits are pushed (recommended).
- **Require status checks to pass before merging**
  - **Require branches to be up to date before merging** (so checks run against
    the post-merge state).
  - Required checks (these are the job names from
    [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)):
    - `Typecheck & build`
    - `Lint`
    - `E2E (Playwright)`
    - `Env contract`
  - **Netlify Deploy Preview** — require the Netlify deploy-preview check to pass
    before merge (the `netlify/<site>/deploy-preview` check that Netlify reports
    on the PR).
- **Block force pushes** to `main`.
- **Restrict deletions** — `main` cannot be deleted.
- **No direct pushes to `main`** — all changes land via PR.

## Required checks — what each one guards

| Check | Guards against |
| --- | --- |
| Typecheck & build | type errors, a build that doesn't compile, failing unit tests (`vitest`), a broken production bundle |
| Lint | ESLint errors (style/correctness regressions) |
| E2E (Playwright) | blank screens, uncaught runtime errors, auth-gate regressions, resident-intake regressions, staff/officer/insights workflow regressions, broken legacy redirects |
| Env contract | an environment variable used in code but undocumented in `.env.example` (a silent production misconfiguration) |
| Netlify Deploy Preview | a change that builds locally but fails to deploy, or whose preview is unhealthy |

## Personal repo caveat

If this stays a **personal** GitHub repository, GitHub may warn that rulesets
are **not fully enforced** unless the repo is moved into a **GitHub Team
organization**. Configure the ruleset anyway — it still surfaces the required
checks on the PR — but treat **GitHub Actions CI as the operational gate**: do
not merge a PR whose CI is not green, even if GitHub's UI would technically
allow it. Moving the repo to an organization is the way to make the rules
hard-enforced.

## Operating rule

> Merge a PR into `main` only after **all GitHub Actions checks are green** and
> the **Netlify deploy preview is healthy**. Never merge directly to `main`.
