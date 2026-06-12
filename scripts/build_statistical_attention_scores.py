"""Build the Review Attention Score (Statistical Queue Insights).

This is the classical, explainable statistical scoring builder that replaces the
old "V2 workflow ML" framing. It does NOT train a model and does NOT predict an
enforcement outcome. It produces a transparent, RELATIVE queue rank
(Higher / Medium / Lower) that helps staff decide which complaint files to
review first, with the statistical reasons attached to every case.

Target (y-hat)
--------------
"Does this complaint need staff review before closure?" — expressed as a Review
Attention Score, not a probability.
  * Historical closed cases: days-to-close vs complaint-type and area norms.
  * Open cases: current age vs similar historical cases, plus current workload
    pressure.

Transparent features (all explainable, no black box)
----------------------------------------------------
  1. case_age_days
  2. age_percentile_within_complaint_type
  3. open_status_flag
  4. repeat_location_count
  5. area_trend_z_score
  6. complaint_type_backlog_percentile
  7. missing_context_count
  8. department_workload_share

Outputs (written with the service_role key, out of band — never from the browser)
  * public.statistical_case_scores
        case_id, source_record_id, attention_score, attention_tier,
        attention_rank, aging_z_score, repeat_location_count,
        area_trend_z_score, type_backlog_percentile, missing_context_count,
        top_driver_1..3, score_version, advisory
  * public.statistical_feature_correlations
        feature_name, target_name, correlation_coefficient, direction,
        interpretation, sample_size, score_version
  * public.statistical_area_trends (optional, area/type volume trends)
  * public.statistical_model_runs (provenance for the run)

SAFETY (mirrors the other upload scripts)
  * DRY RUN by default. Real upload only behind an explicit --upload flag.
  * The service_role key is read from the environment and is NEVER printed.

Usage
  python scripts/build_statistical_attention_scores.py            # dry run / plan
  python scripts/build_statistical_attention_scores.py --upload   # compute + upsert

STATUS: scaffold. The data-loading and upsert wiring still need to be filled in
(see the TODOs below); the statistical computation is documented and stubbed so
the methodology is reviewable before any write happens.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass

SCORE_VERSION = "attention-2026.06"
SOURCE_CITY = "Toronto"
SOURCE_DATASET = "toronto_311_benchmark"
TARGET_DEFINITION = (
    "Review attention need before closure: open-case age vs similar historical "
    "cases and current workload pressure; closed-case days-to-close vs "
    "complaint-type and area norms."
)
METHODOLOGY = (
    "Classical statistical scoring (no ML model): z-scores, percentiles, "
    "repeat-location counts, area-trend z-scores, and correlation checks over "
    "transparent features. Output is a relative queue tier, not a probability."
)

ADVISORY = (
    "Review Attention Score: a transparent statistical queue rank over Toronto "
    "311 benchmark data. Decision support only — not an automated decision, not "
    "an enforcement outcome, not Brampton operational data. Staff review every case."
)

FEATURES = [
    "case_age_days",
    "age_percentile_within_complaint_type",
    "open_status_flag",
    "repeat_location_count",
    "area_trend_z_score",
    "complaint_type_backlog_percentile",
    "missing_context_count",
    "department_workload_share",
]


@dataclass
class BuildPlan:
    score_version: str
    source_city: str
    source_dataset: str
    features: list[str]


def log(m: str) -> None:
    print(f"[attention-scores] {m}", flush=True)


def load_complaints():
    """Load the Toronto 311 normalized complaint data.

    TODO: read from the bundled benchmark export (data/processed/...) or pull the
    municipal_complaints rows. Return a DataFrame with at least: case_id,
    complaint_type, status, workflow_stage, assigned_department, ward_or_area,
    address_or_location, opened_at/submitted_at, closed_at, days_open.
    """
    raise NotImplementedError("Wire up the benchmark complaint loader before --upload.")


def compute_eda_summary(df) -> dict:
    """Compute EDA summaries: counts by status/type/area, days-open distribution,
    missing-field rates. Used both for context and to derive feature norms."""
    raise NotImplementedError


def compute_case_scores(df):
    """Compute the transparent features and the Review Attention Score.

    Steps (all explainable):
      1. case_age_days from opened/closed (or now() for open cases).
      2. age_percentile_within_complaint_type via per-type empirical percentiles.
      3. open_status_flag from status / workflow_stage.
      4. repeat_location_count: same/near address or intersection occurrences.
      5. area_trend_z_score: current vs prior period volume per ward/area.
      6. complaint_type_backlog_percentile: open+aging share per complaint type.
      7. missing_context_count: missing description/location/department/closure.
      8. department_workload_share: open share per assigned department.
    Combine the standardized features into attention_score, then bucket into
    Higher / Medium / Lower tiers and assign attention_rank. Attach the three
    strongest drivers per case as top_driver_1..3.
    """
    raise NotImplementedError


def compute_feature_correlations(df):
    """Correlate each feature with the aging / closure-burden target and label
    direction + a plain-language interpretation. Writes to
    statistical_feature_correlations."""
    raise NotImplementedError


def compute_area_trends(df):
    """Per-area, per-complaint-type current vs prior period volume, change %, and
    z-score. Writes to statistical_area_trends."""
    raise NotImplementedError


def print_plan(plan: BuildPlan) -> None:
    log("DRY RUN — no data loaded, nothing computed or uploaded.")
    log(f"Score version:      {plan.score_version}")
    log(f"Source:             {plan.source_city} / {plan.source_dataset}")
    log(f"Target definition:  {TARGET_DEFINITION}")
    log(f"Methodology:        {METHODOLOGY}")
    log(f"Features ({len(plan.features)}): {plan.features}")
    log("Will write: statistical_model_runs, statistical_case_scores, "
        "statistical_feature_correlations, statistical_area_trends.")
    log("Re-run with --upload (and SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set) "
        "once the loaders/upserts above are implemented.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--upload",
        action="store_true",
        help="Compute scores and upsert to Supabase. Without this flag, prints the plan only.",
    )
    args = ap.parse_args()

    plan = BuildPlan(
        score_version=SCORE_VERSION,
        source_city=SOURCE_CITY,
        source_dataset=SOURCE_DATASET,
        features=FEATURES,
    )

    if not args.upload:
        print_plan(plan)
        return

    # TODO: implement the upload path (mirror upload_workflow_ml_predictions_v2.py):
    #   - guard SUPABASE_URL project ref, read SUPABASE_SERVICE_ROLE_KEY (never print)
    #   - df = load_complaints(); eda = compute_eda_summary(df)
    #   - scores = compute_case_scores(df); corrs = compute_feature_correlations(df)
    #   - trends = compute_area_trends(df)
    #   - upsert statistical_model_runs / _case_scores / _feature_correlations / _area_trends
    raise SystemExit(
        "Upload path not implemented yet. Fill in the loaders/computation/upsert "
        "(see TODOs) before running with --upload."
    )


if __name__ == "__main__":
    main()
