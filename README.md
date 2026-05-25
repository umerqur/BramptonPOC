# Proactive Enforcement Intelligence

AI assisted triage, case prioritization, and operational intelligence for municipal enforcement teams.

This repository contains the public-facing proof of concept (POC) website — a Vite + React + TypeScript application styled with Tailwind CSS and routed with React Router. The site is designed to be demo-ready for City procurement conversations and is deployed on Netlify.

> **Positioning.** This system is decision support for authorized municipal staff. It does not make enforcement decisions, issue notices, or act autonomously. The initial POC uses only public 311 style data, open geospatial data, and synthetic enforcement records — no private City data is required.

---

## What it demonstrates

- A polished landing page outlining the problem, solution, and the assistive role of AI.
- A demo dashboard with KPI cards, a "cases by category" breakdown, a hotspot map placeholder, a priority queue, and AI generated case summaries.
- A filterable case queue table.
- A case detail page showing summary, complaint history, risk explanation, recommended action, similar cases, officer briefing, and an audit trail placeholder.
- A methodology page explaining scope, data sources, feature design, risk scoring, AI use, human-in-the-loop, limitations, and the next phase.
- A privacy and security page describing the governance principles applied to the POC.
- A login page mock-up illustrating the access pattern for City staff (no real authentication).

---

## Stack

- **Vite** — dev server and build tool
- **React 18 + TypeScript**
- **Tailwind CSS** — design system
- **React Router** — page routing
- **No backend** in this phase — all data is mocked locally in `src/data/`.

Supabase and any real data integration are intentionally out of scope for the initial POC.

---

## Getting started

Prerequisites: Node.js 20 or newer, npm 10 or newer.

```bash
npm install
npm run dev
```

The dev server starts on http://localhost:5173.

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
  data/             Mock data and TypeScript types
  pages/            One file per route
  App.tsx           Route definitions
  main.tsx          App entrypoint
  index.css         Tailwind layers + design tokens
public/
  _redirects        Netlify SPA redirect rule
  favicon.svg
netlify.toml        Build settings for Netlify
tailwind.config.js  Design tokens (navy + accent palette)
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

To deploy:

1. Connect this repository to a new Netlify site.
2. Netlify will pick up the build settings from `netlify.toml` automatically — no manual configuration needed.
3. The first deploy produces a `*.netlify.app` URL suitable for sharing in procurement conversations.

---

## Design direction

- Public sector credible but still modern.
- Palette: dark navy, white, light grey, and one controlled green accent. No neon.
- Cards with soft borders and subtle shadows; the dashboard reads like an enterprise SaaS product.
- Mobile responsive throughout.

---

## POC methodology summary

Full version lives on the in-app `/methodology` page. Short form:

1. **Ingest.** Public 311 style service request data, open geospatial data, and synthetic enforcement records.
2. **Normalize.** Standardize addresses, categories, and timestamps so complaints across channels can be compared.
3. **Detect patterns.** Identify repeat complaints, geographic clusters, and category escalation across rolling time windows.
4. **Score risk.** A transparent rules based score with named drivers, normalized to 0–100 and mapped to Low / Medium / High / Critical. The same feature design is ML ready when labeled outcomes become available.
5. **Summarize.** Generate plain-language case summaries, risk explanations, and officer ready briefing notes.
6. **Recommend.** Suggest a next operational action (Monitor, Merge with existing case, Schedule inspection, Escalate for supervisor review, Send notice, Prepare officer visit) for staff review.

### Out of scope for this POC

- Private City data integration (deferred to the next phase, under privacy and cybersecurity controls).
- Automated notices, penalties, or external communications.
- Production-grade authentication and role based access (the login page is a mock-up).

### Important positioning

- This is not replacing officers.
- This is decision support.
- This uses public and synthetic data for the initial POC.
- City provided data can be integrated later under privacy and cybersecurity controls.
