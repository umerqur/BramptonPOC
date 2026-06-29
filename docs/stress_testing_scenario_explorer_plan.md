# Stress Testing → Interactive Scenario Explorer — Implementation Plan

> **Status: PLAN ONLY.** No frontend, Python, Supabase, or migration changes are
> made by this document. Implementation is gated on the calibrated baseline and
> shock outputs being finalized (do not start coding while that work is running
> locally). This plan covers the UI redesign and the supporting data model so the
> build can start cleanly once the calibrated outputs land.

## 0. Goal (restated)

Let a supervisor adjust **capacity planning assumptions** and immediately see the
existing 3D scenario pressure map and the pressure cards re-shade. The tab exists
to **stress test workload pressure before it becomes backlog, stale cases,
supervisor bottlenecks, and delayed closure updates.**

Framing throughout: *capacity planning*, *scenario assumptions*, *public 311
benchmark*, *synthetic demand*, *decision support only*, *not live Brampton data*,
*not enforcement decisioning*. Never: *forecast*, *prediction*, *panic*,
*information propagation*, *network/social contagion*.

---

## 1. Current files involved

| File | Role |
|---|---|
| `src/components/app/InsightsDashboard.tsx` (~3092 lines) | Hosts the tab. `SimulationLab()` (~L1211) is the **Stress Testing tab body**. Also defines `StressTestSummary`, `MapInterpretationPanel`, `ScenarioCardView`, `RedZoneDistrictCard`, `CtganSection`, `CtganPendingNote`, the framework/methodology zone, and the tab shell (`InsightsDashboard`, ~L214). Tab is reached via `/app/insights?tab=simulations`. |
| `src/components/app/SimulationPressureMap.tsx` | The **3D scenario pressure map wrapper**. Loads council-district geometry, joins ABM district rows, exposes a 4-way *pressure metric* toggle (case load / backlog / stale risk / supervisor queue), and feeds the deck. |
| `src/components/app/NYCWorkload3DDeck.tsx` | The actual **deck.gl extruded-polygon 3D heat map** (shared with the operational map). Driven by a `DeckMetricAdapter`. Lazy-loaded (heavy bundle). |
| `src/components/app/stressModel.ts` | Pure, deterministic **interpretation engine**: `buildStressModel()` → baseline pressure, trajectory, 4 worst-case scenario cards, per-district red-zone analysis, recommended actions. Already contains fixed `STRESSORS` multipliers and a `composite()` pressure score. **This is where slider scaling will live.** |
| `src/services/ctganAbmStress.ts` | Supabase reads for the five latest-run CTGAN ABM views. |
| `src/services/stressTesting.ts` | Supabase reads for two synthetic patrol workload views (optional red-zone enrichment). |
| `src/components/app/mapMetrics.ts`, `workloadColor.ts`, `NYCWorkloadMapPanel.tsx` | Supporting metric config, color ramp (`calmWorkloadCss`), and `AreaUnit` geometry types. |
| `src/pages/app/AppInsightsPage.tsx`, `src/components/AppLayout.tsx` | Page route and top-nav entry for the tab. |
| `supabase/migrations/033–035_*.sql` | Define the `ctgan_abm_*` tables and the latest-run views (read-only contract). |
| `scripts/ctgan_abm/run_ctgan_abm_stress_lab.py` | The Python ABM that produces the run CSVs. **Not changed by this plan.** |

## 2. Existing 3D heat map component location

- **Renderer:** `src/components/app/NYCWorkload3DDeck.tsx` — deck.gl extruded
  council-district polygons, shaded + raised by a selected metric via
  `DeckMetricAdapter`. Heights are a capped `sqrt(volume)` band (readability, not
  physical measurement); color is the municipal calm ramp.
- **Stress-test wrapper:** `src/components/app/SimulationPressureMap.tsx` — owns
  the metric toggle, geometry load, and the ABM→geometry join. **This is the
  component to keep.** The redesign feeds it scenario-scaled district rows; the
  deck itself does not change.
- Geometry note: it uses **real NYC council-district benchmark geometry as a POC
  stand-in** for Brampton wards (wards not yet wired in). Disclaimer already
  present on the map (`POC_DISCLAIMER`). Keep it.

## 3. Current Supabase tables / views read by the tab

**Views read today** (all via `ctganAbmStress.ts` + `stressTesting.ts`):

| View | Returns | Scope |
|---|---|---|
| `v_ctgan_abm_latest_run_summary` | one row: generated/processed/closed/final_backlog, scenario_name, metadata | **latest run only** |
| `v_ctgan_abm_scenario_summary` | scenario_id, name, run count | all scenarios |
| `v_ctgan_abm_latest_daily_metrics` | 30-day series: day, total_cases, processed, backlog, stale_cases, supervisor_queue_size | latest run, **system-wide (not per-district)** |
| `v_ctgan_abm_latest_district_pressure` | per-district: total_cases, backlog, stale_cases, overload_flag, estimated_hours, share_of_cases | latest run, **run-level totals (no day dimension)** |
| `v_ctgan_abm_latest_complaint_type_pressure` | per-type: total_cases, estimated_hours, share_of_cases | latest run, run-level totals |
| `v_synthetic_patrol_workload_by_district` / `_by_officer_unit` | synthetic field workload aggregates | optional enrichment |

**Underlying tables** (migration 034, text PKs): `ctgan_abm_scenarios`,
`ctgan_abm_scenario_runs`, `ctgan_abm_daily_metrics`, `ctgan_abm_district_metrics`,
`ctgan_abm_complaint_type_metrics`.

**Three findings that shape the whole design:**

1. **There is no scenario picker today.** Every view selects the single newest
   run (`v_ctgan_abm_latest_run`, ordered by `run_date DESC, run_id DESC`). The
   shock-preset dropdown has nothing to switch *to* yet.
2. **The named shock presets do not exist in the data.** The Python generator
   writes generic runs named `"ABM Scenario N"` (`run_..._stress_lab.py:578`).
   There is no "Rainstorm road condition surge", "Construction corridor", etc.
3. **District/complaint metrics carry no `day` dimension.** They are run-level
   totals. Only the *system-wide* daily series is per-day. So a per-district
   "Simulation day" slider has no per-day-per-district data to read today.

## 4. Proposed controls (top section)

A control bar + a fixed disclaimer line above the map. Controls:

| # | Control | Type | Range | Default |
|---|---|---|---|---|
| 1 | **Shock preset** | dropdown | Current baseline · Rainstorm road condition surge · Construction corridor · Event parking and noise · Staff capacity drop · Supervisor review bottleneck | Current baseline |
| 2 | **Demand surge** | slider | 0%–100% increase | 0% |
| 3 | **Officer capacity** | slider | 50%–150% | 100% |
| 4 | **Supervisor review capacity** | slider | 50%–150% | 100% |
| 5 | **Simulation day** | slider | Day 1–Day 30 | Day 30 |

Selecting a **preset sets the three sliders to that shock's assumption defaults**
(they remain user-adjustable afterward — preset = a starting point, not a lock).
"Current baseline" = all sliders at neutral (0% / 100% / 100%).

**Disclaimer (always visible in the control section):**
> Capacity-planning scenario assumptions over a public 311 benchmark with
> synthetic demand. Decision support only — not live Brampton data and not
> enforcement decisioning.

## 5. How each control maps to data

The map and cards re-derive from `buildStressModel()`. We extend it to take a
`ScenarioAssumptions` input and apply transparent, deterministic scaling to the
baseline district/daily rows **before** the existing pressure math runs.

| Control | Maps to | Mechanism |
|---|---|---|
| **Shock preset** | which baseline rows + which slider defaults | If preset has a finalized precomputed run in Supabase → load that run's rows. Otherwise → start from the calibrated baseline run and apply the preset's assumption multipliers client-side (see §6). |
| **Demand surge %** | per-district `total_cases`, `backlog` | `load' = load × (1 + surge)`. Higher arrivals raise load and (via the clearance gap) backlog. |
| **Officer capacity %** | per-district `backlog`, `stale_cases` | Inverse scaling of clearance: `clearanceFactor = capacity/100`; `backlog' = backlog / clearanceFactor` (capacity < 100 → backlog/stale grow; > 100 → shrink), with sensible floors. |
| **Supervisor review capacity %** | `supervisor_queue_size` (global) and the supervisor component of district pressure | `supQueue' = supQueue / (supCapacity/100)`. Still allocated to districts by case share (as today), labelled as an allocation, not a measurement. |
| **Simulation day (1–30)** | which point of the daily series to read; district snapshot scaled to that day | Read `dailyRows[day-1]` for the system headline. For per-district: scale the run-level district snapshot by that day's system backlog/stale **ratio vs. the run total** (transparent approximation) until per-day-per-district data exists (see §6/§8). |

All four model outputs the brief lists update from this: **district pressure
colors, red-zone count, backlog estimate, stale-case estimate, supervisor-queue
estimate, recommended prevention action** — these are already produced by
`stressModel.ts`; they simply recompute when the scaled inputs change.

`stressModel.ts` already does ~80% of this: it has `STRESSORS`, `composite()`,
red-zone detection, and recommended actions. The work is to (a) replace the four
*fixed* worst-case scenarios with *live* slider-driven assumptions, and (b) thread
the scaled rows into `SimulationPressureMap`.

## 6. Precomputed scenarios vs. client-side scaling — recommendation

**Recommendation: a hybrid.**

- **Precomputed anchors from Supabase** for the **6 named presets** — each a
  finalized, calibrated run (`scenario_id` per preset). These come from the
  calibrated baseline + shock outputs work that must finish first. This keeps the
  *shape* of each shock honest (the ABM actually modeled a rainstorm surge, a
  supervisor bottleneck, etc.) rather than inventing it in the browser.
- **Client-side scaling** for the **three continuous sliders and the day
  selector**, layered on top of the selected anchor.

**Why not fully precompute?** The three continuous sliders are 101×101×101 ≈ 1M
combinations × 30 days × ~20 districts per preset. Precomputing that cartesian
product is infeasible and, worse, would imply false precision. The sliders are
*planning assumption knobs*, so transparent linear scaling is the honest model and
keeps the UI instant (no per-drag network round-trip). **Do not run CTGAN in the
browser** — none of this requires it; we scale already-simulated aggregates.

**Why not fully client-side?** Then the 6 presets would be pure multipliers with
no real differentiated simulation behind them — acceptable as a stopgap, but the
calibrated shock outputs make each preset genuinely distinct, which is the product
value. Until those outputs land, the dropdown can run in **client-side-multiplier
mode** (presets = named slider defaults) with a small "calibrated outputs pending"
note, then upgrade to precomputed anchors with no UI change.

**Net:** precomputed anchors (preset selection) + client-side scaling (sliders/day).
Frontend stays responsive; data stays honest.

## 7. Recommended Supabase indexes (propose only — do not apply)

Current tables are small (one calibrated baseline + ~6 shock runs × 30 days × ~20
districts), so these are low-urgency, but cheap and correct for the new access
patterns (filter by run, then by day/district/type):

```sql
-- pick the latest run per preset/scenario quickly (new "by scenario" view)
CREATE INDEX IF NOT EXISTS idx_ctgan_abm_runs_scenario_date
  ON public.ctgan_abm_scenario_runs (scenario_id, run_date DESC);

-- daily series scan per run + day slider
CREATE INDEX IF NOT EXISTS idx_ctgan_abm_daily_run_day
  ON public.ctgan_abm_daily_metrics (run_id, day);

-- per-district pressure per run
CREATE INDEX IF NOT EXISTS idx_ctgan_abm_district_run_area
  ON public.ctgan_abm_district_metrics (run_id, district_or_area);

-- per-complaint-type pressure per run
CREATE INDEX IF NOT EXISTS idx_ctgan_abm_complaint_run_type
  ON public.ctgan_abm_complaint_type_metrics (run_id, complaint_type);

-- ONLY if per-day-per-district data is later added (see §8):
-- CREATE INDEX IF NOT EXISTS idx_ctgan_abm_district_run_day_area
--   ON public.ctgan_abm_district_metrics (run_id, day, district_or_area);
```

## 8. Are schema changes needed?

| Scope | Schema change? |
|---|---|
| **Interactive sliders over the single calibrated baseline + client-side scaling** | **No.** Ships against today's views. This is the minimum viable redesign. |
| **Named preset dropdown reading distinct precomputed runs** | **Yes (views + seed):** (1) seed the 6 presets in `ctgan_abm_scenarios` with stable names matching the dropdown; (2) add a `v_ctgan_abm_run_by_scenario` (or parameterized read) returning a chosen scenario's latest run instead of only the global latest. View-only migration — **deferred, not applied here.** |
| **True per-day-per-district "Simulation day" slider** | **Yes (table + Python):** add a `day` column to `ctgan_abm_district_metrics` (and/or complaint metrics) or a new per-day-per-district table, plus Python to emit it. **Out of scope** per the "do not change Python / migrations yet" constraint. Until then the day slider uses the §5 ratio approximation. |

**For the first shippable cut: no schema changes.** Everything else is a deferred,
clearly-scoped migration the brief explicitly says not to apply yet.

## 9. Exact implementation steps (once calibrated outputs are finalized)

**Phase A — Model (pure, testable, no UI):**
1. Add `ScenarioAssumptions` type to `stressModel.ts`:
   `{ preset, demandSurgePct, officerCapacityPct, supervisorCapacityPct, day }`.
2. Add `SHOCK_PRESETS` map: each preset → its slider defaults (and, later, its
   `scenario_id`). "Current baseline" = neutral.
3. Add a pure `applyAssumptions(districtRows, dailyRows, assumptions)` that scales
   load/backlog/stale/supervisor + selects the day snapshot per §5, returning
   scaled rows. Keep it deterministic and side-effect free.
4. Extend `buildStressModel()` to accept scaled rows and produce the live
   single-scenario reading (red-zone count, backlog/stale/supervisor estimates,
   recommended prevention action). Replace the 4 *fixed* worst-case cards with the
   live assumption-driven reading; keep the named presets available as quick-set
   buttons.

**Phase B — Controls UI:**
5. New `ScenarioControls.tsx` (preset dropdown + 4 sliders + disclaimer),
   controlled, with the required wording. Selecting a preset sets slider state.
6. Lift scenario state into `SimulationLab` (`useState`); pass assumptions to the
   model and the map.

**Phase C — Wire map + cards:**
7. Pass scaled district rows + scaled `peakSupervisorQueue` into
   `SimulationPressureMap` (its props barely change — it already takes
   `districtRows` + `peakSupervisorQueue`). Deck re-shades automatically.
8. Replace/feed the 4 compact cards (**Backlog risk, Stale case risk, Supervisor
   review pressure, Recommended prevention action**) from the live model output.
9. Keep **Top red zone districts** and **Top complaint type pressure** sections;
   feed them scaled rows.
10. Debounce slider→recompute only if profiling shows jank (the math is cheap and
    client-side; likely no debounce needed). No network call on drag.

**Phase D — Data upgrade (separate, gated on calibrated outputs + approval):**
11. Seed the 6 named scenarios; add the by-scenario view migration (§8). Switch
    preset selection from client-multiplier mode to precomputed-anchor mode behind
    the same UI.
12. (Optional, later) per-day-per-district data + index (§7/§8) for a fully
    data-backed day slider.

**Phase E — Verify:** unit-test `applyAssumptions`/`buildStressModel` at slider
extremes (0% surge, 50% & 150% capacity, day 1 & 30); confirm baseline (neutral)
reproduces today's reading; lint/build; manual pass on the tab.

## 10. Risks / misleading interpretations to avoid

- **Not a forecast/prediction.** Label outputs as *scenario assumptions* and
  *capacity-planning estimates*. Never use forecast, prediction, panic,
  information/network/social/social-contagion propagation language.
- **Client-side scaling is an assumption, not a re-simulation.** State plainly the
  sliders apply transparent scaling to a precomputed benchmark run; they do not
  re-run the ABM. Avoid implying slider precision = modeled certainty.
- **Geometry is a POC stand-in.** NYC council-district geometry, not Brampton
  wards. Keep the existing map disclaimer.
- **Supervisor queue is global, allocated by case share.** Keep the existing
  "planning approximation" caption; don't present per-district supervisor load as
  measured.
- **Day slider is approximate until per-day-per-district data exists.** If shipping
  the §5 ratio approximation, caption it as such.
- **Presets must be honest about their backing.** While running in
  client-multiplier mode (before calibrated outputs land), don't imply each preset
  is a distinct full simulation — show a small "calibrated outputs pending" note.
- **No live Brampton / enforcement framing.** Reiterate *decision support only,
  not live Brampton data, not enforcement decisioning* in the control disclaimer.
- **Don't run CTGAN in the browser.** All scaling is over precomputed aggregates.
- **Empty/pending data state.** Preserve the existing calm "pending manual
  approval / pending load" state when no run is present — sliders should degrade to
  a disabled state, not throw.

---

### One-line recommendation

Ship the interactive explorer against the **existing single calibrated baseline
with client-side assumption scaling first (no schema change)**, then upgrade the
**preset dropdown to precomputed shock anchors** via a small view-only migration
once the calibrated baseline + shock outputs are finalized — keeping the existing
`NYCWorkload3DDeck` / `SimulationPressureMap` untouched as the renderer.
