# Workload-Density Model v1 — Results

_Toronto 311 (2026). Decision-support / workload-ranking only — not a risk or
enforcement prediction. Nothing uploaded to Supabase; nothing committed._

## 1. Target trained
**`high_workload_area`** at the **FSA** level: a binary label = 1 if an FSA's
**April 2026** complaint volume is in the **top tercile** across FSAs.

- Feature window: **Jan–Mar 2026** (features built from the prior window only).
- Label window: **Apr 2026**.
- Universe: **99 FSAs** (real postal areas present in the feature window).
- Class balance: **33 positives (33.3%)** / 66 negatives.

## 2. Why `days_open` was rejected
The originally natural target — resolution duration — is impossible here:
`closed_at` is **100% empty**, `human_decision` is **100% empty**, and
`latitude`/`longitude` are **100% empty**. No duration or outcome can be computed,
so a volume-density target was used instead.

## 3. Features used (prior window only)
- `prior_complaint_count`, `complaint_diversity` (distinct types), `dominant_type_share`
- Complaint-type mix: top-20 types + `other` (per-FSA proportions)
- `assigned_department` mix and `department_unit` mix (proportions)
- Time features: hour-bucket shares (night/morning/afternoon/evening), `weekend_share`
- `ward_or_area` context: dominant ward per FSA (one-hot)
- `source_channel` was **excluded automatically** because it is constant (no signal).

Total: **86 features** across 99 FSAs.

## 4. Features excluded for leakage / unusability
Dropped up front so they could never enter a feature:
`ai_category`, `ai_priority`, `ai_summary`, `ai_recommended_action`, `priority`
(all deterministically derived from `complaint_type`, P≈1.0); `status`,
`resolution_status`, `workflow_stage`, `closed_at`, `human_decision` (post-outcome);
`case_id`, `description` (identifier / templated text); `latitude`, `longitude`
(100% empty).

## 5. Metrics (stratified out-of-fold CV)

| Model | PR-AUC | ROC-AUC | Precision@k | Recall@k | Brier |
|---|---|---|---|---|---|
| **Persistence baseline** (prior volume → next) | **0.960** | **0.970** | **1.00** | 0.61 | — |
| Random forest | 0.955 | 0.971 | 1.00 | 0.61 | 0.085 |
| HistGBDT | 0.925 | 0.945 | 0.95 | 0.58 | 0.061 |
| Logistic regression | 0.806 | 0.867 | 0.85 | 0.52 | 0.145 |
| Prevalence baseline | positive rate = 0.333 | | | | |

`k` = top 20% of FSAs by score. Best calibration: HistGBDT (Brier 0.061,
balanced accuracy 0.92). Strongest ranker: random forest.

## 6. Key finding — v1 does NOT beat the persistence baseline
The tree models **match but do not exceed** the persistence baseline (RF PR-AUC
0.955 vs persistence 0.960). Per the modeling plan's own bar — *"if a tree model
can't beat persistence, the model adds nothing"* — v1's honest conclusion is that
**high-workload FSAs are predicted almost entirely by "areas busy in Jan–Mar stay
busy in Apr."**

Permutation importance confirms it: only `complaint_diversity` (0.144) and
`prior_complaint_count` (0.046) carry weight; every compositional feature (type
mix, department mix, hour buckets, ward) is ~0.0. And `complaint_diversity` is
itself a volume correlate. The 86 features effectively collapse to one signal:
**prior volume.**

## 7. What this means operationally
v1 is a **volume-persistence ranker**, not a model that found hidden structure.
It reliably tells you *which areas will remain busy*, which is what month-to-month
workload persistence already implies. It does not yet identify *why* an area is
busy beyond "it already was," and the complaint-mix / timing features did not add
predictive lift at this scale.

## 8. Why this is still useful for workload planning
- The persistence signal is **strong and stable** (PR-AUC ~0.96, precision@k = 1.00),
  so a volume-ranked list of high-workload FSAs is dependable for staffing/triage.
- It replaces the current **synthetic** ward workload scenario with **real**
  Toronto 311 volumes (the EDA confirmed a 100% `ward_or_area` ↔ City Wards GeoJSON
  join), giving an honest, data-backed workload view.
- Calibrated scores + tiers give a defensible, explainable basis for prioritization
  with the advisory disclaimer attached.

## 9. Limitations
- Only **4 months** of data → a single held-out period, no seasonality.
- **99 FSAs** is a small sample for ML; compositional features can't show lift.
- No complaint coordinates, durations, or real outcomes — FSA is the finest reliable
  geography available.
- The target is defined from volume, so any model risks re-learning volume; v1
  visibly does exactly that.
- `ai_*` / `description` are templated, so they offer no genuine intake signal.

## 10. Recommended v2 direction
**A. Emergence / change model.** Predict areas **rising relative to their own
baseline** (e.g. April volume vs each FSA's Jan–Mar trend, or a residual-from-
persistence target). This explicitly factors out the persistence the current model
just reproduces, surfacing *newly* hot areas — the operationally valuable signal.

**B. Longer data horizon.** Re-run with more months as they become available to
enable seasonality, multiple holdout periods, and stabler estimates.

**C. Finer geography only if justified.** Move below FSA (to address/point level)
**only** if real complaint coordinates or reliable address geocoding exist — never
from ward-polygon coordinates (those are boundaries, not complaint locations).

**D. Frontend Intelligence tab (later, not now).** Can already show: the
persistence-ranked high-workload list, workload tiers on the real Toronto ward
choropleth, feature-importance ("driven mostly by prior volume / diversity"), and
prominent advisory language (decision support only, staff review required).
