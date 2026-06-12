# Proactive Enforcement Intelligence — Brampton compatible POC

A **Closure Review Workbench** for Enforcement and By-law complaint responses — AI automates research, analysis, and draft preparation for staff approved closure responses.

This repository contains the proof of concept (POC) website: a Vite + React + TypeScript application styled with Tailwind CSS and routed with React Router. It is designed to be demo-ready for a City of Brampton conversation and deploys cleanly on Netlify.

> **Positioning.** This is a **Brampton compatible Proactive Enforcement Intelligence POC using Toronto 311 public benchmark data**. It is **not Brampton operational data**. Real public Toronto 311 service request data is normalized into a Brampton compatible municipal enforcement schema and used to demonstrate the core buyer workflow: supporting the **closure of Enforcement and By-law complaint responses** by gathering enforcement context, complaint trends, and patrol or ticket style records, and drafting personalized resident friendly closure messages. **AI automates research, analysis, and draft preparation for staff approved closure responses** — it does not make enforcement decisions, close cases on its own, or contact residents without staff approval. No private City data is required for the POC, and the schema is ready for Brampton enforcement data later.

## The Closure Review Workbench workflow

The core of the app is the authenticated Closure Review Workbench (`/app/closure-review`), which communicates a single end-to-end workflow:

1. **Complaint enters the review queue** — cases load from the live Toronto 311 benchmark workflow data.
2. **Review Attention Score helps staff prioritize** — a transparent statistical queue rank surfaces the files staff should review first.
3. **Case workspace gathers linked records** — complaint details plus related patrol logs, ticket records, and complaint trend context for the selected case. Patrol and ticket records are clearly labelled **synthetic POC operational context** linked to real benchmark case ids; trends are generated from the benchmark complaints.
4. **Rules check closure readiness** — deterministic flags plus a closure readiness checklist and a matched resident friendly closure template (by complaint type + scenario).
5. **AI Review Packet drafts language** — the agent workflow reads the selected complaint, retrieves its related patrol logs, ticket records, and complaint trend context, selects the matching closure template, and drafts the staff summary, next step, resident update, and closure language — generated server-side on explicit staff request and returned for staff approval only.
6. **Staff must approve** — no closure and no resident communication happens without staff approval.

---

## Resident intake demo workflow

This POC includes a resident facing parking infraction intake simulation so the Proactive Enforcement Response workflow can be demonstrated from complaint creation through staff approved closure.

Demo script:

1. Resident opens `/resident` and creates a parking infraction request.
2. The app creates an `RSR...` reference and sends a confirmation email to the resident through Mailjet.
3. Staff open `/app/resident-intake` and review the submitted request.
4. Staff explicitly advance the request through Received, Assigned, Under review, and Closed.
5. Each staff action writes a workflow event and sends a resident status update.
6. The resident can check `/resident/status/:caseId` at any time.
7. The Closure Review Workbench remains the internal AI assisted staff review layer for enforcement context, complaint trends, and staff approved closure language.

This is not the 311 Self Serve Customer Service Agent use case. It is a Proactive Enforcement Response POC with a resident intake simulation.

**Email deliverability:** During the demo, Mailjet emails may appear in junk or spam depending on sender domain authentication. The resident confirmation screen and confirmation email remind users to check junk or spam. For production, configure sender domain authentication in DNS.

---

## Demo entry points

Resident:
Use `/resident/new-request` to file a demo parking complaint.
Use `/resident` to check request status.

Staff:
Use `/login` to sign in.
After sign in, staff land on `/app`.
Start with Resident Intake, then use Closure Review.

---

## Data layer

**The app uses Supabase live data when configured, and falls back to bundled sample (mock) data when it is not.**

The current service layer (`src/services/municipalServiceRequests.ts`) reads from these Supabase tables and views:

| Object | Role |
| --- | --- |
| `municipal_complaints` | **Primary complaints table.** Toronto 311 public benchmark records normalized into the Brampton compatible enforcement schema. Drives the dashboard, case queue, and case detail. |
| `workflow_events` | Staff workflow events (triage, stage changes) over the benchmark data; surfaced via the `v_recent_workflow_events` view. |
| `ai_triage_results` | Rule-based POC triage outputs (advisory only). |
| `case_ai_reviews` | Persisted AI-assisted staff review records. |
| `workload_insights_v1` | v1 workload-density model outputs — one scored location per model run, with full provenance (source city, dataset, model version, feature window). |
| `statistical_attention_queue_upload` | **Direct-upload Review Attention Score queue** — the scored SR2026 CSV (`statistical_attention_queue_upload.csv`) loaded one row per case, self-contained with all the context the Statistical Queue Insights page renders. Generated case ids (`SR2026-NNNNNN`) — does not join to `municipal_complaints`. |
| `statistical_case_scores` | **Review Attention Score** — one row per scored complaint: a transparent statistical queue rank (Higher/Medium/Lower) with its drivers (aging z-score, repeat-location count, area trend, type backlog percentile, missing-context count). Retained from the join-based scoring path. |
| `statistical_feature_correlations` | Feature/target correlation coefficients from EDA, backing the explainability summary on `/app/statistical-insights`. |
| `statistical_area_trends` | Per-area, per-complaint-type volume trends (current vs prior period, change %, z-score). |
| `statistical_model_runs` | Provenance for each scoring run — source city/dataset, target definition, methodology. |
| `v_statistical_attention_queue` | The read source for Statistical Queue Insights. Now a **direct select from `statistical_attention_queue_upload`** (no join to `municipal_complaints`, since the SR2026 generated ids do not match it). |
| `workflow_ml_predictions` | **Legacy** workflow attention outputs ("Needs Attention" score, tier, rank). Retained for rollback; the Closure Review queue still reads it, while Statistical Queue Insights now reads the statistical tables above. |
| `patrol_logs` | **Synthetic POC operational context.** Demo patrol log records linked to real benchmark complaint `case_id`s, shown in the Closure Review case workspace. Clearly labelled — not Brampton operational data. |
| `ticket_records` | **Synthetic POC operational context.** Demo ticket / enforcement outcome records linked to real benchmark complaint `case_id`s. Clearly labelled — not Brampton operational data. |
| `complaint_trends` | Complaint trend aggregates **generated from the Toronto 311 benchmark complaints**: per area + complaint type, current vs prior period volume, change percent, repeat locations, and a trend label. |
| `closure_templates` | **Synthetic POC** resident friendly closure response templates matched by complaint type + scenario, with policy notes and required on-file context. Drafting aid only — staff approval required. |
| `toronto_ward_boundaries` | The 25 real City of Toronto ward polygons (City of Toronto Open Data "City Wards"), used as the geographic base layer. |
| `v_toronto_ward_workload` | Real Toronto 311 benchmark complaint volume aggregated per Toronto ward from `municipal_complaints`. |
| `v_workflow_stage_counts` | Live counts by workflow stage for the Operations Workflow Console. |
| `brampton_ward_boundaries` / `brampton_ward_workload_scenarios` | Real Brampton ward boundaries with a clearly labelled **synthetic** workload overlay — Toronto benchmark records are never plotted onto Brampton wards. |

- **Sample fallback:** when the Supabase variables are missing — or a live query fails — the app falls back to the bundled sample dataset in `src/data/`, so the POC always renders without a backend.
- **Always visible:** every data-driven screen shows a badge indicating whether it is displaying **Live data: Supabase** or **Sample data**, and carries the disclaimer that this is Toronto 311 public benchmark data, not Brampton operational data.
- **Legacy:** `supabase/migrations/001_create_municipal_service_requests.sql` creates the original `municipal_service_requests` table from an earlier iteration. It is **legacy** — the app's service layer no longer reads it; `municipal_complaints` is the active complaints table.

To connect a live data layer, copy `.env.example` to `.env.local` (which is gitignored and never committed) and fill in:

```bash
VITE_SUPABASE_URL=https://YOUR-PROJECT-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

The Supabase schema lives in `supabase/migrations/` (001–010, applied in order). Read access to operational tables is restricted to the `authenticated` role. Migration `010_seed_operational_context.sql` regenerates the linked operational records (complaint trends from the benchmark data; synthetic patrol logs, ticket records, and closure templates linked to the Closure Review queue case ids) and is safe to re-run.

---

## What it demonstrates

- A public marketing site (landing, how-it-works, methodology, privacy) explaining the POC and the **assistive** role of AI — no public operational data demo.
- An authenticated app (`/app`, Supabase magic-link login) centred on:
  - **Closure Review Workbench** (the staff landing page) — the six-step workflow above: attention-ranked complaint review queue, case file workspace with context and trend signals, deterministic rule flags, **AI Review Packet** (staff summary, next step, resident update, closure language), an "Ask this case" assistant, and human review controls. Every draft requires staff approval.
  - **Case queue and case detail** — filterable queue with server-side filtering against `municipal_complaints`, plus per-case detail with explainable triage signals.
  - **Operations Workflow Console** — workflow-stage counts and recent staff workflow events, demonstrating triage and case progression.
  - **Workload insights (v1)** — scored locations from the v1 workload-density model.
  - **Statistical Queue Insights** — the **Review Attention Score** over the benchmark: a transparent, classical statistical queue rank (Higher/Medium/Lower) built from EDA, z-scores, percentiles, repeat counts, and correlation checks. Not an ML model, not a probability — decision support only. See **SR2026 Review Attention Score** below for how the scored queue is generated.
  - **Toronto ward workload context** — real Toronto ward polygons with real Toronto 311 ward-level complaint volume.
  - **Dashboard** — KPI cards and category breakdowns over the live benchmark data.
- AI Review Packets are produced by Netlify functions (`netlify/functions/`) that hold the Anthropic API key server-side; the browser never sees the key, drafts are advisory only, and nothing is sent to a resident.

### SR2026 Review Attention Score

The SR2026 statistical score was generated from **190,511 Toronto 311 benchmark rows**. The **Review Attention Score** prioritizes cases likely to need more staff review effort, using transparent statistical features — case aging percentiles, repeat-location counts, area-trend z-scores, complaint-type backlog percentiles, and missing-context checks. Each ranked case publishes its top drivers so the rank is fully explainable.

**This is not ML and not an enforcement decision.** The score is a relative tier (Higher / Medium / Lower), not a probability or prediction, and staff review every case.

The scored queue is delivered as a single CSV (`statistical_attention_queue_upload.csv`) loaded into `public.statistical_attention_queue_upload`; the `v_statistical_attention_queue` view reads directly from that table and drives `/app/statistical-insights`. The source SR2026 file has no real case id, so generated ids (`SR2026-000001`, `SR2026-000002`, …) are used — these are self-contained and do **not** join to `municipal_complaints`. The companion `statistical_feature_correlations_upload.csv` populates `statistical_feature_correlations`, which backs the correlation summary card on the same page.

---

## Positioning principles

- **AI automates research, analysis, and draft preparation — staff approve closure responses.** The AI never closes a case by itself, never issues notices or penalties, and never contacts residents on its own.
- **Human review by design.** Every score, rule flag, and AI-drafted review packet is advisory; authorized municipal staff make every final decision.
- **Explainable scoring.** Scores are published with the drivers and provenance that produced them — no black box. Model outputs carry source city, dataset, model version, and scoring period on every row.
- **Staff-ready summaries.** Outputs are framed as briefing material for officers to review, not as decisions.
- **Auditability and governance.** Scores, AI-generated content, and staff workflow events are logged and reviewable.
- **Benchmark data is clearly separated from Brampton context.** Toronto 311 benchmark records are never plotted onto Brampton wards; the Brampton ward workload overlay is explicitly labelled synthetic.

---

## Stack

- **Vite** — dev server and build tool
- **React 18 + TypeScript**
- **Tailwind CSS** — design system
- **React Router** — page routing
- **Supabase** — live data layer (`municipal_complaints` and related tables/views above), with a bundled sample dataset (`src/data/`) as fallback
- **Netlify functions** — server-side AI review packet generation (Anthropic API key never exposed to the browser)
- **Data and statistical pipeline** — local Python scripts (`scripts/`): Toronto 311 EDA, v1 workload-density model training, the Review Attention Score statistical scoring builder (`build_statistical_attention_scores.py`), and Supabase upload utilities. (The legacy V2 workflow ML scripts are retained for rollback.)

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
  services/         Data-access layer for municipal_complaints + related tables/views,
                    and the AI review packet client
  pages/            Public site pages, one file per route
  pages/app/        Authenticated app pages (dashboard, workflow, wards, insights,
                    statistical insights, closure review, case queue/detail)
  App.tsx           Route definitions
  main.tsx          App entrypoint
  index.css         Tailwind layers + design tokens
netlify/
  functions/        Server-side AI review packet + case agent functions
public/
  _redirects        Netlify SPA redirect rule
  favicon.svg
scripts/            Toronto 311 EDA, v1/V2 model training, scoring, and upload scripts
supabase/
  migrations/       Schema migrations 001–012 (001 is the legacy
                    municipal_service_requests table; 002+ cover RLS,
                    municipal_complaints workflow, ward context, workload
                    insights, the legacy workflow ML predictions, resident
                    service requests, and the statistical attention scoring
                    tables + queue view)
netlify.toml        Build settings for Netlify
tailwind.config.js  Design tokens (navy + accent palette)
```

### Pages

| Route                 | Page                                  |
| --------------------- | ------------------------------------- |
| `/`                   | Landing                               |
| `/how-it-works`       | How It Works                          |
| `/methodology`        | POC Methodology                       |
| `/privacy`            | Privacy & Security                    |
| `/login`              | Login (Supabase magic-link)           |
| `/app/dashboard`      | Dashboard (authenticated)             |
| `/app/cases`          | Case Queue (authenticated)            |
| `/app/cases/:id`      | Case Detail (authenticated)           |
| `/app/workflow`       | Operations Workflow Console           |
| `/app/wards`          | Toronto Ward Workload Context         |
| `/app/insights`       | Workload Insights (v1 model)          |
| `/app/statistical-insights` | Statistical Queue Insights (Review Attention Score) |
| `/app/v2-ml`          | → redirects to `/app/statistical-insights` |
| `/app/closure-review` | Closure Review + AI review packet     |

Old public demo routes (`/dashboard`, `/cases`) redirect to `/login`; the live versions are under `/app`.

---

## Deployment (Netlify)

The repository includes a `netlify.toml` and a `public/_redirects` file so the app deploys cleanly as an SPA:

- **Build command:** `npm run build`
- **Publish directory:** `dist`
- **Node version:** 20 (set in `netlify.toml`)
- SPA fallback: every unknown path serves `index.html` so client-side routing works (`/.netlify/functions/*` is never shadowed).

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Netlify site's environment variables to enable live data, `VITE_APP_BASE_URL` so magic-link redirects return to the deployed site, and `ANTHROPIC_API_KEY` (server-side only, never `VITE_`-prefixed) for the AI review packet functions.

### Live data on Netlify shows "Sample data" — troubleshooting

`VITE_*` variables are **baked into the bundle at build time**, not read at runtime. If the deployed site still shows the sample dataset:

1. **Set both variables** in **Site configuration → Environment variables**, scoped to the **Production** context (and any branch/deploy-preview contexts you use).
2. **Trigger a fresh deploy** after setting them — values added after the last build do not apply until the next build. Use **Deploys → Trigger deploy → Clear cache and deploy site**.
3. **Read the data-source badge** on the dashboard / case queue to tell the two failure modes apart:
   - **"Sample data (Supabase not configured)"** — the variables were missing at build time (revisit steps 1–2).
   - **"Sample data (Supabase query failed)"** — the variables were present, but the live query failed at runtime. Check that the `municipal_complaints` table exists, is populated, and that the row-level-security policies grant the `authenticated` role `SELECT` (and that the user is signed in).

---

## POC methodology summary

Full version lives on the in-app `/methodology` page. Short form:

1. **Ingest.** Real public Toronto 311 service request data and real open geospatial reference data (Toronto and Brampton ward boundaries), with synthetic placeholders only for non-public internal records and the clearly labelled Brampton workload overlay.
2. **Normalize.** Standardize addresses, categories, and timestamps into the Brampton compatible enforcement schema (`municipal_complaints`) so complaints across channels can be compared.
3. **Detect patterns.** Identify repeat complaints, geographic clusters, and ward-level workload concentration across rolling time windows.
4. **Score.** Transparent rule-based triage plus the **Review Attention Score** (`statistical_case_scores`) — a classical statistical queue rank built from EDA, aging z-scores, percentiles, repeat-location counts, area-trend signals, and correlation checks (no black-box model). The v1 workload-density layer (`workload_insights_v1`) remains for location density. Every output carries provenance and an advisory disclaimer, and the score is decision support only.
5. **Summarize.** Generate AI Review Packets — staff summary, recommended next step, resident friendly update, and closure language when appropriate (server-side, on explicit staff request).
6. **Recommend.** Suggest a next operational action (Monitor, Merge, Schedule inspection, Escalate for supervisor review, Send notice, Prepare officer visit) **for staff review**.

### Out of scope for this POC

- Private City data integration (deferred to a later phase, under privacy and cybersecurity controls).
- Automated notices, penalties, or external communications — AI drafts are never sent to residents.
- Fully autonomous enforcement workflows (a deliberate later phase, only after the data model, dashboards, governance, and human review are proven).
- Production-grade authentication and role-based access beyond the Supabase magic-link login used for the demo.

### Important positioning

- This is not replacing officers — it is **decision support**.
- It is a **Brampton compatible POC built on real public Toronto 311 service request benchmark data**, normalized into a Brampton compatible enforcement schema, with synthetic data only for non-public internal fields and the labelled Brampton workload overlay. **It is not Brampton operational data.**
- The schema is ready for Brampton enforcement data; City-provided data can replace or supplement the Toronto 311 benchmark data later under privacy and cybersecurity controls.
