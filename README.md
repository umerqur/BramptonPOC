# AI-Assisted Municipal Enforcement Intelligence

Decision support for municipal enforcement teams — AI-assisted triage, explainable risk scoring, and staff-ready case preparation.

This repository contains the proof of concept (POC) website: a Vite + React + TypeScript application styled with Tailwind CSS and routed with React Router. It is designed to be demo-ready for a City of Brampton conversation and deploys cleanly on Netlify.

> **Positioning.** This system is **decision support for authorized municipal staff**. It does not make enforcement decisions, issue notices, or act autonomously. It surfaces explainable risk scores, risk drivers, recommended actions, stale-case flags, and a priority queue so that staff can triage faster — a human reviews and decides on every case. The prototype is modelled on **real public NYC 311 service request data, normalized into a Brampton compatible municipal enforcement schema**, with synthetic records used only for non-public internal workflow fields (patrol logs, ticket history, officer notes, closure outcomes). No private City data is required for the initial POC, and the schema is ready for Brampton enforcement data later.

---

## Data layer

**The app uses Supabase live data when configured, and falls back to bundled sample (mock) data when it is not.**

- **Live data:** when the Supabase environment variables are set, the dashboard, case queue, and case detail views read from the Supabase table **`municipal_service_requests`** (real public NYC 311 records normalized into the enforcement schema). See `src/services/municipalServiceRequests.ts` and `src/lib/supabase.ts`.
- **Sample fallback:** when the variables are missing — or a live query fails — the app falls back to the bundled sample dataset in `src/data/mockCases.ts`, so the POC always renders without a backend.
- **Always visible:** every data-driven screen shows a badge indicating whether it is displaying **Live data: Supabase** or **Sample data (Supabase not configured)**, and carries the disclaimer that this is public NYC 311 data, not Brampton operational data.

To connect a live data layer, copy `.env.example` to `.env.local` (which is gitignored and never committed) and fill in:

```bash
VITE_SUPABASE_URL=https://YOUR-PROJECT-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

The Supabase schema lives in `supabase/migrations/001_create_municipal_service_requests.sql`.

---

## What it demonstrates

- A landing page outlining the problem, the solution, and the **assistive** role of AI.
- A demo **dashboard** (KPI cards, categories breakdown, hotspot map placeholder, priority queue) connected to Supabase with a sample fallback.
- A filterable **case queue** ranked by explainable risk score, connected to Supabase with a sample fallback.
- A **case detail** page showing the request, risk explanation with named risk drivers, a recommended action presented for staff review, and an audit-trail placeholder.
- A **methodology** page explaining scope, data sources, feature design, risk scoring, AI use, human review, limitations, and the next phase.
- A **privacy and security** page describing the governance and human-oversight principles applied to the POC.
- A **login** mock-up illustrating the access pattern for City staff (no real authentication).

---

## Positioning principles

- **Decision support, not automated enforcement.** The system never issues notices or penalties on its own.
- **Human review by design.** Every recommended action is advisory; authorized municipal staff make every final decision.
- **Explainable risk scoring.** Each 0–100 score is published with the named risk drivers that produced it — no black box.
- **Staff-ready summaries.** Outputs are framed as briefing material for officers to review, not as decisions.
- **Auditability and governance.** Risk scores, AI-generated content, and staff actions are designed to be logged and reviewable.
- **Agentic workflows are a later phase only.** Automated or agentic workflows are intentionally **out of scope** for this POC. They would be considered only after the data model, dashboards, risk scoring, governance, and the human-review process are proven in a Brampton context.

---

## Stack

- **Vite** — dev server and build tool
- **React 18 + TypeScript**
- **Tailwind CSS** — design system
- **React Router** — page routing
- **Supabase** — live data layer (`municipal_service_requests`), with a bundled sample dataset (`src/data/`) as fallback
- **Data pipeline** — a local NYC 311 cleaning pipeline (`scripts/`) and a Supabase migration (`supabase/migrations/`)

---

## Getting started

Prerequisites: Node.js 20 or newer, npm 10 or newer.

```bash
npm install
npm run dev
```

The dev server starts on http://localhost:5173. Without Supabase environment variables, the app runs on the bundled sample dataset.

### Build

```bash
npm run build
```

Produces a static bundle in `dist/`.

### Preview the production build locally

```bash
npm run preview
```

---

## Project structure

```
src/
  components/       Shared UI primitives (Header, Footer, StatCard, RiskBadge, …)
  data/             Sample (fallback) dataset and TypeScript types
  lib/              Supabase client (live data when configured)
  services/         Data-access layer for municipal_service_requests + mock fallback
  pages/            One file per route
  App.tsx           Route definitions
  main.tsx          App entrypoint
  index.css         Tailwind layers + design tokens
public/
  _redirects        Netlify SPA redirect rule
  favicon.svg
netlify.toml        Build settings for Netlify
tailwind.config.js  Design tokens (navy + accent palette)
supabase/
  migrations/       municipal_service_requests schema
```

### Pages

| Route             | Page                |
| ----------------- | ------------------- |
| `/`               | Landing             |
| `/how-it-works`   | How It Works        |
| `/dashboard`      | Demo Dashboard      |
| `/cases`          | Case Queue          |
| `/cases/:id`      | Case Detail         |
| `/methodology`    | POC Methodology     |
| `/privacy`        | Privacy & Security  |
| `/login`          | Login mock-up       |

---

## Deployment (Netlify)

The repository includes a `netlify.toml` and a `public/_redirects` file so the app deploys cleanly as an SPA:

- **Build command:** `npm run build`
- **Publish directory:** `dist`
- **Node version:** 20 (set in `netlify.toml`)
- SPA fallback: every unknown path serves `index.html` so client-side routing works.

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Netlify site's environment variables to enable live data; otherwise the deployed site runs on the sample dataset.

### Live data on Netlify shows "Sample data" — troubleshooting

`VITE_*` variables are **baked into the bundle at build time**, not read at runtime. If the deployed site still shows the sample dataset:

1. **Set both variables** in **Site configuration → Environment variables**, scoped to the **Production** context (and any branch/deploy-preview contexts you use).
2. **Trigger a fresh deploy** after setting them — values added after the last build do not apply until the next build. Use **Deploys → Trigger deploy → Clear cache and deploy site**.
3. **Read the data-source badge** on the dashboard / case queue to tell the two failure modes apart:
   - **"Sample data (Supabase not configured)"** — the variables were missing at build time (revisit steps 1–2).
   - **"Sample data (Supabase query failed)"** — the variables were present, but the live query failed at runtime. Check that the `municipal_service_requests` table exists, is populated, and that a row-level-security read policy grants the `anon` role `SELECT`.

---

## POC methodology summary

Full version lives on the in-app `/methodology` page. Short form:

1. **Ingest.** Real public NYC 311 service request data, open geospatial / reference data where available, and synthetic placeholders only for non-public internal records (patrol logs, ticket history, officer notes, closure workflow).
2. **Normalize.** Standardize addresses, categories, and timestamps so complaints across channels can be compared.
3. **Detect patterns.** Identify repeat complaints, geographic clusters, and category escalation across rolling time windows.
4. **Score risk.** A transparent, rules-based score with named drivers, normalized to 0–100 and mapped to Low / Medium / High / Critical. The same feature design is ML-ready when labeled outcomes become available.
5. **Summarize.** Generate plain-language case summaries, risk explanations, and staff-ready briefing notes.
6. **Recommend.** Suggest a next operational action (Monitor, Merge, Schedule inspection, Escalate for supervisor review, Send notice, Prepare officer visit) **for staff review**.

### Out of scope for this POC

- Private City data integration (deferred to a later phase, under privacy and cybersecurity controls).
- Automated notices, penalties, or external communications.
- Automated or agentic enforcement workflows (a deliberate later phase, only after the data model, dashboards, governance, and human review are proven).
- Production-grade authentication and role-based access (the login page is a mock-up).

### Important positioning

- This is not replacing officers — it is **decision support**.
- It is modelled on **real public NYC 311 service request data**, normalized into a Brampton compatible enforcement schema, with synthetic data only for non-public internal fields. **It is not Brampton operational data.**
- The schema is ready for Brampton enforcement data; City-provided data can replace or supplement the NYC data later under privacy and cybersecurity controls.
