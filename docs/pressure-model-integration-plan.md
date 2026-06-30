# Operational Pressure Model — Integration Plan

Bring the **Operational Pressure Model** and the **Pressure propagation** panel into the
latest online `main` **without overwriting newer online work** (PR 100 / PR 101).

- Status: **plan only** — no source files changed, nothing merged, Supabase untouched.
- Target branch for the eventual integration work: `claude/pressure-model-integration-plan-ga04sa`.
- Method: **curated manual port**, *not* a `git merge` of the stale branch.

---

## 1. Branch topology (as scanned 2026-06-30)

| Ref | Head | Relation to `main` |
|---|---|---|
| `origin/main` | `3d234b5` Merge: quiet Priority Queue tab count badges | baseline (has PR 100 / PR 101 work) |
| `origin/claude/audit-similar-case-intelligence-xme5do` | `493a8b8` | `main` + **1 commit** (badge relabel only) |
| `origin/claude/brampton-pressure-propagation-local` | `dda005d` Add CTGAN ABM pressure propagation model | **stale**: branched from `bdea2b3` (#89, Jun 28), **37 commits behind**, **3 commits ahead** |

Because the pressure branch predates PR 100/101, a raw `git diff main..pressure` is misleading
(it shows main's newer work as "deletions"). The **real additions** of the pressure branch are
its 3 commits vs their merge-base `bdea2b3` — 15 files. That is the only thing to port.

**Why not just merge the branch:** a 3-way merge of pressure→main conflicts in 2 files
(see §4) and, more importantly, its auto-resolution would re-introduce the older
`MethodologyPage` / `InsightsDashboard` shape and could clobber PR 100/101 intake + Similar
Case work. We port the *additions* onto the current `main` files by hand.

---

## 2. What to PRESERVE from latest `main` (do not overwrite)

- `src/pages/MethodologyPage.tsx` — **keep main's structure**; only *insert* the Operational
  Pressure Model block (§6).
- Resident intake + NYC 311 alignment — `src/services/residentRequests.ts`,
  `supabase/migrations/037_add_nyc311_alignment_to_resident_requests.sql`,
  `supabase/migrations/036_resident_request_supervisor_seen.sql`, and all PR 100/101 intake UI.
- Similar Case Intelligence — keep `src/services/similarCaseIntelligence.ts` and the
  `structured-match` provenance kind; apply only the copy fixes in §5.
- Supervisor queue changes from PR 100/101.
- `src/components/app/InsightsDashboard.tsx` — keep main's version as the base; graft in the
  Simulation Lab scenario selector + Pressure propagation panel (§4).

## 3. What to BRING IN from the pressure branch

**Pure adds — no conflict (13 files, copy verbatim):**

| File | Notes |
|---|---|
| `src/services/municipalPressureModel.ts` | the Operational Pressure Model. Constants verified: `C 0.20, L 0.25, R 0.15, Q 0.25, S 0.15`, `watch 0.40`, `red 0.70`. |
| `supabase/migrations/035_ctgan_abm_per_scenario_views.sql` | **RENUMBER → `038_...`** (035/036/037 already taken on main). File only — **do not apply** (Supabase untouched). |
| `docs/ctgan_abm_validation.md` | |
| `scripts/ctgan_abm/build_calibrated_load.py` | |
| `scripts/ctgan_abm/build_local_validation_report.py` | |
| `scripts/ctgan_abm/load_ctgan_abm_calibrated.sql` | |
| `scripts/ctgan_abm/run_ctgan_abm_calibration.py` | |
| `scripts/ctgan_abm/run_ctgan_abm_sensitivity.py` | |
| `scripts/ctgan_abm/run_ctgan_abm_shocks.py` | |
| `scripts/ctgan_abm/validate_ctgan_synthetic.py` | |
| `.gitignore` | merge the 4 added ignore lines (trivial, non-conflicting). |

> Note: `scripts/ctgan_abm/run_ctgan_abm_stress_lab.py` is a *modification* of an existing
> file, not a pure add. It does not overlap main's changes, so it applies cleanly, but treat it
> as a content port rather than a copy.

**Service additions — applies cleanly (auto-merges):**

- `src/services/ctganAbmStress.ts` — append the 4 per-scenario service functions and their
  view constants/types: `getCtganScenarioOptions`, `getCtganDailyByScenario`,
  `getCtganDistrictPressureByScenario`, `getCtganComplaintTypePressureByScenario`. These are
  additive (new constants near the top, new exports at the end); a 3-way merge resolves with no
  conflict markers.

## 4. Conflict files — curated manual resolution

A real `git merge-tree origin/main pressure` reports content conflicts in **exactly two files**:

### 4a. `src/components/app/InsightsDashboard.tsx` — **conflict**
Port these self-contained components from the pressure branch into main's current file
(they reference only `municipalPressureModel` + the new `ctganAbmStress` functions):

- `SimulationLab()` — scenario dropdown / day slider container
- `SimulationPressureMap` — per-scenario 3D heat map / red-zone list
- `TopDistrictsTable`
- `PressurePropagation` — the **Pressure propagation** panel
- `PressureChannelBars`, `PressureStageCard`, `PressureArrow` — panel sub-components

Keep main's existing dashboard layout, KPIs, and any PR 100/101 wiring; add the Pressure
propagation panel as a new section rather than replacing existing sections.

**MOPM cleanup (required):** the pressure source uses lowercase identifiers `mopmRed` /
`mopmWatch` (around lines 1852–1991 on the pressure branch). They never render to users, but a
case-insensitive `grep MOPM` flags them. Rename on port → e.g. `redZoneCount` / `watchZoneCount`.
User-facing copy already reads "Pressure model watch / red zones" (good — keep).

### 4b. `src/pages/MethodologyPage.tsx` — **conflict**
Do **not** take the pressure branch's whole file. Insert only the Operational Pressure Model
block into main's structure — see §6.

### 4c. `src/services/ctganAbmStress.ts` — no conflict
Auto-merges (additive). Listed here only because it is touched on both sides.

## 5. Similar Case Intelligence — exact copy fixes

1. **Keep** the `structured-match` provenance kind (no behavior change).
2. **Badge label** in `src/components/app/ProvenanceLabels.tsx:22`:
   - `'Structured match · CTGAN + ABM'` → `'Structured operational match'`
   - *This single edit already exists on `origin/claude/audit-similar-case-intelligence-xme5do`*
     (1-commit branch). Either cherry-pick that commit or apply the one-line edit directly.
3. **Soften copy/comments** in `src/services/similarCaseIntelligence.ts` (still present on main
   at lines 12, 13, 31, 63, 431):
   - `CTGAN-style synthetic benchmark cases` → `curated structured benchmark cases`
   - `ABM scenario behavior` → `operational scenario tags`
   - Apply to every occurrence of those phrases (comments + the docstring on line 63 + the
     pool comment on line 431). Internal identifiers like `abmScenario` / the `AbmScenario`
     type are **not user-facing** and can stay, but no rendered string or comment should keep
     the "CTGAN + ABM" claim.
4. **Overclaim guard:** only describe Similar Case results as CTGAN+ABM-derived when the
   returned records actually carry operational fields (`scenario_id`, `backlog`, `stale_cases`,
   `supervisor_queue_size`, `overload_flag`, operational pressure score). The current
   `similarCaseIntelligence.ts` pool does **not** carry those fields → its user-facing framing
   stays "Structured operational match". (The fields *do* exist in the Simulation Lab
   per-scenario views, where the CTGAN+ABM framing is legitimate.)

## 6. Methodology — insert, don't overwrite

Add one Operational Pressure Model section to **main's** `MethodologyPage.tsx`. Main's sections
run: Hero → 1 Problem → 2 What the POC does → 3 AI/analytics → 4 Stress testing → 5 What it
produces → 6 Governance and limits → Optional deeper detail. Insert the new block **after
Section 6 (Governance and limits)** / before the closing summary, reusing main's card styling.

Content to include (ported from the pressure branch block, which reads the real constants from
`municipalPressureModel.ts` so the page can never drift):

- Formula: `P_i,t = αC·C_i,t + αL·L_i,t + αR·R_i,t + αQ·Q_i,t + αS·S_i,t`
- Weights / thresholds: `αC = 0.20`, `αL = 0.25`, `αR = 0.15`, `αQ = 0.25`, `αS = 0.15`,
  `watch threshold = 0.40`, `red threshold = 0.70`
- The five channel legend (C/L/R/Q/S).
- Verbatim disclaimer:
  > These are POC planning weights. They are not official City SLA thresholds. They are not
  > enforcement decision rules. They can be recalibrated when Brampton operational data is
  > available.

Import `OPERATIONAL_PRESSURE_WEIGHTS`, `OPERATIONAL_PRESSURE_WATCH_THRESHOLD`,
`OPERATIONAL_PRESSURE_RED_THRESHOLD` from `../services/municipalPressureModel` rather than
hard-coding the numbers.

## 7. Language rules (user-facing)

- **Forbidden user-facing:** `MOPM`, `Shockwave` (no `Shockwave` exists anywhere; only the
  lowercase `mopm*` identifiers in §4a need renaming).
- **Keep:** "Operational Pressure Model", "Pressure propagation", "Pressure model watch / red
  zones".

## 8. Supabase

Carry the migration **file** only (renumbered `038_ctgan_abm_per_scenario_views.sql`). Do **not**
run `apply_migration`, connect, or push schema. The per-scenario service functions will simply
return empty/handled results until the views exist in the target DB — acceptable for this POC
integration step.

---

## 9. Exact file change list (if/when implemented)

**Add (verbatim from pressure branch):**
- `src/services/municipalPressureModel.ts`
- `docs/ctgan_abm_validation.md`
- `scripts/ctgan_abm/{build_calibrated_load,build_local_validation_report,run_ctgan_abm_calibration,run_ctgan_abm_sensitivity,run_ctgan_abm_shocks,validate_ctgan_synthetic}.py`
- `scripts/ctgan_abm/load_ctgan_abm_calibrated.sql`
- `supabase/migrations/038_ctgan_abm_per_scenario_views.sql`  *(renamed from 035)*

**Modify (curated port):**
- `src/components/app/InsightsDashboard.tsx`  *(conflict — graft panel + components, rename `mopm*`)*
- `src/pages/MethodologyPage.tsx`  *(conflict — insert OPM section only)*
- `src/services/ctganAbmStress.ts`  *(clean — append 4 functions)*
- `src/services/similarCaseIntelligence.ts`  *(copy softening, §5.3)*
- `src/components/app/ProvenanceLabels.tsx`  *(badge relabel, §5.2)*
- `scripts/ctgan_abm/run_ctgan_abm_stress_lab.py`  *(clean content port)*
- `.gitignore`  *(merge 4 lines)*

**Do NOT touch (preserve main):** `residentRequests.ts`, intake UI, supervisor queue,
`AppStaffInboxPage.tsx`, migrations `036`/`037`, and the existing `035_ctgan_abm_latest_run_visual_views.sql`.

## 10. Conflict summary

| File | Conflicts on real 3-way merge? | Resolution |
|---|---|---|
| `src/components/app/InsightsDashboard.tsx` | **Yes** | manual graft of panel + components; keep main layout |
| `src/pages/MethodologyPage.tsx` | **Yes** | insert OPM section into main's structure |
| `src/services/ctganAbmStress.ts` | No (auto) | append-only |
| `supabase/migrations/035_*` (pressure) | Name collision | renumber → `038` |
| all other pressure files | No | pure adds |

## 11. Validation gate (run after implementation)

```bash
npm install
npm run build      # tsc -b && vite build
npm run lint       # eslint .
# Expect NO user-facing occurrences:
grep -rn "MOPM" src
grep -rn "Shockwave" src
grep -rn "Structured match · CTGAN + ABM" src
grep -rn "CTGAN-style synthetic benchmark cases" src
grep -rn "ABM scenario behavior" src
```

Baseline (current `main`, before integration) for reference — these strings **currently exist**
and must be gone after the work:
- `Structured match · CTGAN + ABM` → `src/components/app/ProvenanceLabels.tsx:22`
- `CTGAN-style synthetic benchmark cases` / `ABM scenario behavior` →
  `src/services/similarCaseIntelligence.ts` (lines 12, 13, 31, 63, 431)
- `MOPM` (case-insensitive) → lowercase `mopm*` identifiers introduced only by the pressure
  branch's `InsightsDashboard.tsx`; rename on port.
- `Shockwave` → none.

## 12. Guardrails honored

Do not merge branches · do not touch Supabase (file-only migration) · do not use MCP · do not
deploy · do not open a PR. Develop on `claude/pressure-model-integration-plan-ga04sa`.
