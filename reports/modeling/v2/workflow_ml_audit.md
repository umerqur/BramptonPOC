# V2 Workflow ML — Target Audit

_Toronto 311 public benchmark data in `municipal_complaints` (190,511 rows,
Jan–Apr 2026). This is **workflow** ML built on top of the existing rules-based
workflow layer — **not** geographic prediction and **not** hotspot/targeting.
All outputs are **staff decision support only**, never automated decisions._

## Data reality (live `municipal_complaints`)
- **100% empty:** `closed_at`, `human_decision`, `latitude`, `longitude` → no
  time-to-close, no resolution duration, no real outcome history.
- **`workflow_events` = 12 rows** → no usable longitudinal/event history.
- **Outcome fields are interchangeable:** `status` ≡ `resolution_status`
  (identical counts); `workflow_stage` is a deterministic relabel of `status`.
  Status mix: Completed 147,188 · In Progress 17,105 · Cancelled 15,759 ·
  New 6,156 · Closed 2,167 · Unknown 2,136 (~13% still open).
- **Derived / leaky:** `ai_category`(6), `ai_priority`(3), `ai_summary`,
  `ai_recommended_action`, `priority`(3) are ≈deterministic functions of
  `complaint_type`. `description` is **templated** and embeds `complaint_type` +
  FSA + ward → text leakage for type/category/routing targets.
- **Clean labels:** `assigned_department`(8), `department_unit`(24),
  `complaint_type`(532), `status`(6). Departments imbalanced (Transportation 48%).

## Target-by-target verdicts
| # | Target | Supported? | Label | Kind | Verdict |
|---|--------|-----------|-------|------|---------|
| 1 | Classification (`complaint_type`/`ai_category`) | Yes, but leaky on benchmark (text restates type) | `ai_category`(6) | Supervised | Pipeline-valuable for real free text; near-trivial on benchmark |
| 2 | **Routing** (`assigned_department`) | **Yes — cleanest** | `assigned_department`(8) | Supervised multiclass | **Recommended model 1** |
| 3 | Priority (`priority`) | Circular (derived from type) | `priority`(3) | Supervised≈rules | Defer |
| 4 | **Stale risk** (open vs resolved) | Proxy only (no `closed_at`) | open status | Supervised proxy | **Recommended model 2** |
| 5 | Handling effort (low/med/high) | Not supported (needs durations) | — | — | Skip until durations exist |
| 6 | Repeat/duplicate | Yes (similarity) | candidate pairs | Similarity ML | Fast-follow, not a trained classifier |

## Recommended first two models (trained in this pass)
**Model 1 — Routing classifier.** Target `assigned_department` (8 classes).
Features: TF-IDF(`description`), `complaint_type`, `ward_or_area`,
`source_channel`, `priority`, `submitted_at` time features. Models: LogReg, RF,
HistGradientBoosting. Temporal split (train Jan–Mar / test Apr). Reports macro &
weighted F1, per-class precision/recall, confusion matrix. **Leakage check:**
trained both **with** `complaint_type` (+ original text) and **without**
`complaint_type` (+ the type phrase stripped from the description text).

**Model 2 — Stale-risk / handling-path proxy.** Binary target: open
(`status` ∈ {New, In Progress, Unknown}) vs resolved (Completed/Closed/Cancelled).
Features: `complaint_type`, `assigned_department`, `priority`, `ward_or_area`,
`source_channel`, time features, TF-IDF(`description`). Models: LogReg, RF,
HistGradientBoosting. Reports PR-AUC, ROC-AUC, precision@k, recall, F1, Brier
(calibration).

## Caveats carried into results
1. Workflow ML, **not** geographic prediction or hotspot targeting.
2. The stale-risk model is a **proxy on current handling state**, not a
   time-to-close model — `closed_at` is empty, so there is no true duration label.
3. Routing can be partly easy because `complaint_type` and the templated
   `description` leak the department — hence the explicit with/without-type
   leakage check.
4. No automated decisions. Every output is staff decision support; staff review
   and decide.

## Modeling approach
scikit-learn baselines only (LogReg / RandomForest / HistGradientBoosting, TF-IDF
text, one-hot/ordinal categoricals, simple temporal features). **No XGBoost /
LightGBM** — unnecessary at this scale and would add native-build dependencies.
No new runtime deps beyond scikit-learn.

## Supabase / migrations
None needed to train or audit. Persisting per-case predictions later (a
`workflow_ml_predictions` table, mirroring `workload_insights_v1`) is optional and
only if/when we wire results to the frontend.
