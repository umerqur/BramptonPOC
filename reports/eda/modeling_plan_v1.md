# Modeling Plan v1 — Workload Density (Toronto 311)

## Framing note (why this shape)
The EDA rules out an outcome/duration target: `closed_at`, `human_decision`,
`latitude`, `longitude` are **100% empty**, and the `ai_*`/`priority` columns are
**deterministically derived from `complaint_type`** (P = 1.00), so they carry no
independent signal. The only honest, non-leaky signal is **where complaint volume
concentrates**. So v1 is a **location-level workload-density model**, framed
predictively to avoid circularity — not a "risk" model.

---

## 1. Target definition
**`high_workload_area`** — binary label on a **location unit**, with an ordinal
3-tier variant.

- **Unit of analysis:** FSA (`fsa_or_area`, 100 units, 100% populated) as the
  **primary** unit for model stability; `ward_or_area` (25 wards + "Unknown") for
  the **map**; `address_or_location` (10,169; 4,233 with ≥3) as a **stretch** unit
  (sparse — treat cautiously).
- **Density measure:** complaint volume per location over a time window. Because
  there are no residential-population denominators, "density" = raw complaint count
  per location (optionally per active-week to deflate locations that only appear
  late in the window).
- **Label rule (recommended, predictive/temporal):** engineer features from
  **Jan–Mar 2026**, define the label from **Apr 2026** volume.
  `high_workload_area = 1` if the location's April volume is in the **top tercile**
  across locations (tier variant: low / medium / high by terciles). This makes the
  task genuine prediction ("which areas will run hot next period") and structurally
  prevents the target from being a function of its own features.
- **Static fallback (v0 only):** if the temporal split proves too sparse at a given
  unit, define the label on the **full window** top-tercile and rely entirely on the
  grouped/temporal validation below to expose leakage. Document it as descriptive,
  not predictive.
- Drop the `"Unknown"` ward bucket from labels; keep it only in raw counts.

---

## 2. Features to include
All are **intake-time or prior-window** attributes — nothing post-outcome.

- **Complaint-mix composition:** proportion of each top-K `complaint_type` (K≈15–20
  + "other") at the location; **diversity** = count of distinct complaint types;
  share of the dominant category.
- **Department routing mix:** proportions across `assigned_department` (8) and
  `department_unit` (24).
- **Temporal signature (from prior window):** share of complaints by hour bucket
  (night/day/evening), day-of-week, weekend share; month-over-month trend/slope
  across Jan→Mar.
- **Prior-window volume features:** prior-window count and active-weeks (allowed
  because they come from a *different* window than the Apr label).
- **Geographic context (low-cardinality):** `ward_or_area` one-hot (for FSA/address
  units); intersection-vs-FSA share (from `address_or_location` / intersection
  fields, ~23% have intersection detail).

---

## 3. Features to exclude (leakage / no signal)
- **Derived-from-type (leakage, P≈1.0):** `ai_category`, `ai_priority`, `ai_summary`,
  `ai_recommended_action`, `priority`.
- **Post-outcome (leakage):** `status`, `resolution_status`, `workflow_stage`,
  `closed_at`, `human_decision`.
- **Identifier / templated text:** `case_id`, `description` (restates the label
  phrases).
- **Constants (zero signal):** `source_city`, `source_dataset`, `source_channel`
  (single value each).
- **Empty (unusable):** `latitude`, `longitude` (100% null).
- **Circularity guard:** in the location framing, **never feed the same-window raw
  volume that defines the label** — only prior-window volume or compositional shares.

---

## 4. Validation strategy
- **Primary: temporal holdout** — train on Jan–Mar, test on Apr (matches the target
  framing).
- **Grouped K-fold by location** so the same FSA/ward/address never spans train and
  test (repeat-location autocorrelation is strong: max 44,612 complaints in one FSA,
  3,941 at one address).
- **Stratify** folds by label to handle tercile imbalance.
- **No random row-level split** — it would leak repeat locations and inflate scores.
- **Stated limitations:** only 4 months (one held-out period, no seasonality), small
  N at ward/FSA level — report confidence intervals and treat results as directional.

---

## 5. Baseline models (must be beaten)
- **Prevalence / majority-class** baseline.
- **Persistence baseline** — "high last window → high next window." This is the key
  bar: if a tree model can't beat persistence, the model adds nothing.
- **Logistic regression** on compositional proportions — interpretable linear
  reference; also tests the EDA's non-linearity hypothesis.

---

## 6. Tree-based models
- **HistGradientBoosting / LightGBM / XGBoost** (primary — handles interactions and
  mixed feature types) and **RandomForest** (secondary).
- **Imbalance:** class weights or `scale_pos_weight`; calibrate probabilities
  (isotonic/Platt).
- **High-cardinality handling:** aggregate `complaint_type` to top-K + "other", or
  target/ordinal-encode within CV folds (fit encoders on train fold only).
- Light hyperparameter search (depth, leaves, learning rate, min-samples) under the
  grouped/temporal CV.

---

## 7. Metrics
- **Primary (operational ranking):** **PR-AUC** and **precision@k / recall@k**
  (k = number of areas staff can realistically cover) — the use case is "which areas
  to deploy to," so top-k ranking quality matters most.
- **Secondary:** ROC-AUC, F1 (high tier), balanced accuracy, **calibration**
  (reliability curve / Brier) since a score will be shown to staff.
- **Ordinal variant:** macro-F1 + quadratic-weighted kappa.
- **Always reported alongside the persistence baseline** — lift over persistence is
  the headline number.

---

## 8. Explainability approach
- **Global:** gain-based importance + **permutation importance** (guards against
  high-cardinality bias); **SHAP summary** for direction/magnitude.
- **Local:** per-area **SHAP** ("flagged high because category mix is X, evenings
  concentrated, rising trend").
- **Partial dependence** for the top 3–5 drivers to confirm non-linear/monotone
  shapes.
- Keep a logistic-regression coefficient table as the plain-language companion for
  municipal accountability.
- Every surfaced output carries the existing **advisory disclaimer** (decision
  support, not enforcement).

---

## 9. What would eventually upload to `ai_triage_results`
> Note: `ai_triage_results` is referenced in code (`AI_TRIAGE_TABLE`) but **has no
> migration and is unused** — a migration would be needed later (not now; not part of
> this step).

Proposed payload — **one row per location per scoring run** (audit trail,
append-only, mirroring how `case_ai_reviews` is structured):
- `location_unit` (`ward` / `fsa` / `address`) + `location_id`
- `scoring_period` (e.g. predicted month) and `feature_window`
- `predicted_tier` (low/med/high), `workload_score` (calibrated probability), `rank`
- `top_factors` (JSON — top SHAP drivers)
- `model`, `model_version`, `feature_set_version`, `generated_at`
- `advisory` flag/text = decision-support disclaimer

**Never** writes a final enforcement decision; staff review remains required. No real
complaint PII is involved (none exists in the data).

## 10. What the frontend Intelligence tab could show later
- **Ranked high-workload areas** list (top-k) with score, tier, and trend arrow.
- **Real-data ward map** shaded by predicted/actual workload — **replacing the
  current synthetic `brampton_ward_workload_scenarios` overlay** on the Toronto wards
  (EDA confirmed 100% `ward_or_area` ↔ GeoJSON join). Brampton wards stay a separate
  real-boundary layer; Toronto data is never plotted onto Brampton.
- **Per-area "why flagged"** panel from SHAP drivers.
- Filters by complaint category / period; an **estimated-hours-saved** framing
  consistent with the existing scenario card.
- Prominent advisory banner (decision support only).

---

## Honest caveats carried forward
4 months only (one holdout period, no seasonality); no real outcomes, durations, or
coordinates; the templated `ai_*`/`description` fields mean the model must be kept to
genuine intake signal or it will relearn the synthetic generator. v1 is best
positioned as **workload-density decision support / ranking**, explicitly **not** a
risk or enforcement prediction.
