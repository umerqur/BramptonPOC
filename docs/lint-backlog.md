# Lint status

`npm run lint` (`eslint .`) passes with **0 errors**. Lint is a **blocking** CI
check (the `Lint` job in `.github/workflows/ci.yml`) and was not made
non-blocking.

## Remaining warnings (non-blocking)

There are 10 pre-existing `react-refresh/only-export-components` **warnings**
(configured as `warn`, not `error`, in `eslint.config.js`). They flag files that
export a non-component alongside components, which only affects Vite Fast Refresh
during local development — not correctness, the production build, or runtime.

Grouped by rule and file:

### `react-refresh/only-export-components` (10)

| File | Lines |
| --- | --- |
| `src/components/app/DecisionLogicPanel.tsx` | 32 |
| `src/components/cases/CaseQueuePanel.tsx` | 49, 74, 423 |
| `src/components/workflow/WorkflowUI.tsx` | 21, 36 |
| `src/lib/auth.tsx` | 25, 80, 86 |
| `src/lib/workflowStore.tsx` | 529 |

These are intentionally left as warnings: resolving them means splitting helper
exports out of component files (a mechanical refactor with churn) for a
dev-only ergonomics gain. They do not block CI. Fixing them is a good follow-up
but out of scope for the CI/CD hardening change.
