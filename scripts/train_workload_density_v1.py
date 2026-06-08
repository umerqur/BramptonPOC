"""Workload-density model v1 — Toronto 311 (per reports/eda/modeling_plan_v1.md).

Predicts whether an FSA is a HIGH-workload area next period:
  - feature window: Jan-Mar 2026  (features built from prior window ONLY)
  - label window:   Apr 2026      (top-tercile April complaint volume by FSA)

This script is CODE ONLY. It does NOT upload to Supabase, touch the frontend,
or commit anything. By default it runs a DRY RUN (builds features + labels,
prints the design, and fits NOTHING). Training only happens with --train:

    python scripts/train_workload_density_v1.py            # dry run, no fitting
    python scripts/train_workload_density_v1.py --train    # fit + write artifacts

Outputs (only written in --train mode) go under reports/modeling/v1/.
"""

from __future__ import annotations

import argparse
import json
import warnings
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

pd.set_option("future.no_silent_downcasting", True)

# --------------------------------------------------------------------------
# Paths / config
# --------------------------------------------------------------------------
DOWNLOADS = Path.home() / "Downloads"
FULL_CSV = DOWNLOADS / "toronto_311_2026_normalized_full.csv"

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = REPO_ROOT / "reports" / "modeling" / "v1"

# Time windows (inclusive month ranges within 2026).
FEATURE_MONTHS = (1, 2, 3)  # Jan-Mar 2026
LABEL_MONTHS = (4,)         # Apr 2026
YEAR = 2026

UNIT = "fsa_or_area"        # primary modeling unit

# Leakage / unusable fields, excluded from all features (modeling_plan_v1 §3).
LEAKAGE_FIELDS = [
    "ai_category", "ai_priority", "ai_summary", "ai_recommended_action", "priority",
    "status", "resolution_status", "workflow_stage", "closed_at", "human_decision",
    "case_id", "description", "latitude", "longitude",
]

# FSA-like buckets that are not real postal areas; kept out of the labeled
# universe but reported. ("Intersection" is a catch-all in fsa_or_area.)
NON_POSTAL_FSA = {"Unknown", "Intersection", "", "nan", "None"}

TOP_K_TYPES = 20            # complaint-type mix: top-20 + "other"
RANDOM_STATE = 42
N_SPLITS = 5
TOP_K_FRACTION = 0.20       # precision@k uses the top 20% of FSAs by score


def log(msg: str) -> None:
    print(f"[train-v1] {msg}", flush=True)


# --------------------------------------------------------------------------
# Load
# --------------------------------------------------------------------------
def load() -> pd.DataFrame:
    if not FULL_CSV.exists():
        raise SystemExit(f"Input not found: {FULL_CSV}")
    log(f"Reading {FULL_CSV.name} ...")
    df = pd.read_csv(FULL_CSV, dtype=str, keep_default_na=False, na_values=[])
    df = df.replace(r"^\s*$", np.nan, regex=True).infer_objects(copy=False)
    df["submitted_at"] = pd.to_datetime(df["submitted_at"], errors="coerce")
    # Drop leakage/unusable columns up front so they can never enter a feature.
    drop = [c for c in LEAKAGE_FIELDS if c in df.columns]
    df = df.drop(columns=drop)
    log(f"  -> {len(df):,} rows; dropped leakage cols: {drop}")
    return df


def split_windows(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    valid = df[df["submitted_at"].notna()].copy()
    valid["__year"] = valid["submitted_at"].dt.year
    valid["__month"] = valid["submitted_at"].dt.month
    feat = valid[(valid["__year"] == YEAR) & (valid["__month"].isin(FEATURE_MONTHS))].copy()
    label = valid[(valid["__year"] == YEAR) & (valid["__month"].isin(LABEL_MONTHS))].copy()
    log(f"Feature window (Jan-Mar): {len(feat):,} rows | Label window (Apr): {len(label):,} rows")
    return feat, label


# --------------------------------------------------------------------------
# Feature engineering — prior window ONLY, aggregated per FSA
# --------------------------------------------------------------------------
def _mix(frame: pd.DataFrame, group: str, col: str, prefix: str, allowed=None) -> pd.DataFrame:
    """Per-group proportion of each category value in `col`."""
    sub = frame[[group, col]].dropna()
    if allowed is not None:
        sub = sub.copy()
        sub[col] = np.where(sub[col].isin(allowed), sub[col], "other")
    ct = pd.crosstab(sub[group], sub[col])
    prop = ct.div(ct.sum(axis=1).replace(0, np.nan), axis=0).fillna(0.0)
    prop.columns = [f"{prefix}__{str(c)}" for c in prop.columns]
    return prop


def build_features(feat: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    g = UNIT
    feat = feat[feat[g].notna()].copy()

    # Top-K complaint types by global prior-window frequency (rest -> "other").
    top_types = feat["complaint_type"].value_counts().head(TOP_K_TYPES).index.tolist()

    parts: list[pd.DataFrame] = []

    # prior complaint count
    counts = feat.groupby(g).size().rename("prior_complaint_count").to_frame()
    parts.append(counts)

    # complaint diversity + dominant-type share
    type_ct = pd.crosstab(feat[g], feat["complaint_type"])
    diversity = (type_ct > 0).sum(axis=1).rename("complaint_diversity")
    dominant_share = type_ct.div(type_ct.sum(axis=1), axis=0).max(axis=1).rename("dominant_type_share")
    parts.append(diversity.to_frame())
    parts.append(dominant_share.to_frame())

    # complaint type mix (top-20 + other)
    parts.append(_mix(feat, g, "complaint_type", "type", allowed=top_types))
    # assigned department mix
    parts.append(_mix(feat, g, "assigned_department", "dept"))
    # department unit mix
    parts.append(_mix(feat, g, "department_unit", "unit"))

    # source channel mix — only if it carries signal (not constant)
    channel_used = False
    if "source_channel" in feat.columns and feat["source_channel"].nunique(dropna=True) > 1:
        parts.append(_mix(feat, g, "source_channel", "channel"))
        channel_used = True

    # time features: hour-bucket shares + weekend share
    h = feat["submitted_at"].dt.hour
    bucket = pd.cut(h, bins=[-1, 5, 11, 17, 23], labels=["night", "morning", "afternoon", "evening"])
    tb = feat.assign(__bucket=bucket)
    hour_mix = pd.crosstab(tb[g], tb["__bucket"])
    hour_share = hour_mix.div(hour_mix.sum(axis=1).replace(0, np.nan), axis=0).fillna(0.0)
    hour_share.columns = [f"hour__{c}" for c in hour_share.columns]
    parts.append(hour_share)

    weekend = (feat["submitted_at"].dt.dayofweek >= 5).groupby(feat[g]).mean().rename("weekend_share")
    parts.append(weekend.to_frame())

    # ward_or_area context: dominant ward per FSA (categorical, one-hot later)
    if "ward_or_area" in feat.columns:
        dom_ward = (
            feat.dropna(subset=["ward_or_area"]).groupby(g)["ward_or_area"]
            .agg(lambda s: s.mode().iloc[0]).rename("dominant_ward")
        )
        parts.append(dom_ward.to_frame())

    features = pd.concat(parts, axis=1)
    features.index.name = "fsa"

    meta = {
        "top_types": top_types,
        "source_channel_used": channel_used,
        "n_fsa_feature_window": int(features.shape[0]),
    }
    return features, meta


# --------------------------------------------------------------------------
# Labels — top-tercile April volume by FSA
# --------------------------------------------------------------------------
def build_labels(label: pd.DataFrame, universe: pd.Index) -> tuple[pd.Series, pd.Series]:
    apr = label[label[UNIT].notna()].groupby(UNIT).size().rename("april_volume")
    apr = apr.reindex(universe).fillna(0).astype(int)
    # Top tercile by rank (robust to ties / zeros). Highest third -> 1.
    ranks = apr.rank(method="average", pct=True)
    high = (ranks > 2.0 / 3.0).astype(int).rename("high_workload_area")
    return high, apr


def prior_tercile_label(prior_count: pd.Series) -> pd.Series:
    """Persistence baseline label: top-tercile prior-window volume."""
    ranks = prior_count.rank(method="average", pct=True)
    return (ranks > 2.0 / 3.0).astype(int)


# --------------------------------------------------------------------------
# Assemble modeling frame
# --------------------------------------------------------------------------
def assemble(features: pd.DataFrame, label_df: pd.DataFrame):
    # Restrict labeled universe to real postal FSAs present in the feature window.
    universe = features.index[~features.index.astype(str).isin(NON_POSTAL_FSA)]
    feats = features.loc[universe].copy()

    y, apr_vol = build_labels(label_df, universe)

    # One-hot dominant ward (drop the raw categorical).
    if "dominant_ward" in feats.columns:
        ward_oh = pd.get_dummies(feats["dominant_ward"], prefix="ward").astype(float)
        feats = feats.drop(columns=["dominant_ward"]).join(ward_oh)

    feats = feats.fillna(0.0)
    y = y.loc[feats.index]
    apr_vol = apr_vol.loc[feats.index]
    return feats, y, apr_vol


# --------------------------------------------------------------------------
# Evaluation
# --------------------------------------------------------------------------
def precision_recall_at_k(y_true: np.ndarray, scores: np.ndarray, frac: float) -> tuple[float, float]:
    n = len(scores)
    k = max(1, int(round(frac * n)))
    order = np.argsort(-scores)
    topk = order[:k]
    tp = y_true[topk].sum()
    precision = tp / k
    recall = tp / max(1, y_true.sum())
    return float(precision), float(recall)


def evaluate(X: pd.DataFrame, y: pd.Series, prior_count: pd.Series) -> dict:
    """Out-of-fold evaluation of baselines + tree models via stratified CV."""
    from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import (average_precision_score, balanced_accuracy_score,
                                  brier_score_loss, f1_score, roc_auc_score)
    from sklearn.model_selection import StratifiedKFold
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    skf = StratifiedKFold(n_splits=N_SPLITS, shuffle=True, random_state=RANDOM_STATE)
    Xv, yv = X.values, y.values

    models = {
        "logreg": make_pipeline(
            StandardScaler(), LogisticRegression(max_iter=2000, class_weight="balanced")
        ),
        "random_forest": RandomForestClassifier(
            n_estimators=400, class_weight="balanced", random_state=RANDOM_STATE, n_jobs=-1
        ),
        "hist_gbdt": HistGradientBoostingClassifier(
            max_depth=4, learning_rate=0.06, max_iter=400, random_state=RANDOM_STATE
        ),
    }

    results: dict = {}

    # Persistence baseline: prior-window top tercile predicts April top tercile.
    persist_score = prior_count.rank(pct=True).values
    p_at_k, r_at_k = precision_recall_at_k(yv, persist_score, TOP_K_FRACTION)
    results["baseline_persistence"] = {
        "pr_auc": float(average_precision_score(yv, persist_score)),
        "roc_auc": float(roc_auc_score(yv, persist_score)),
        "precision_at_k": p_at_k,
        "recall_at_k": r_at_k,
        "note": "prior-window volume rank; the bar every model must beat",
    }
    # Prevalence baseline.
    results["baseline_prevalence"] = {"positive_rate": float(yv.mean())}

    for name, model in models.items():
        oof = np.zeros(len(yv))
        for tr, te in skf.split(Xv, yv):
            m = model
            m.fit(Xv[tr], yv[tr])
            if hasattr(m, "predict_proba"):
                oof[te] = m.predict_proba(Xv[te])[:, 1]
            else:
                oof[te] = m.decision_function(Xv[te])
        p_at_k, r_at_k = precision_recall_at_k(yv, oof, TOP_K_FRACTION)
        preds = (oof >= 0.5).astype(int)
        results[name] = {
            "pr_auc": float(average_precision_score(yv, oof)),
            "roc_auc": float(roc_auc_score(yv, oof)),
            "precision_at_k": p_at_k,
            "recall_at_k": r_at_k,
            "f1_high": float(f1_score(yv, preds, zero_division=0)),
            "balanced_accuracy": float(balanced_accuracy_score(yv, preds)),
            "brier": float(brier_score_loss(yv, np.clip(oof, 0, 1))),
        }
        log(f"  {name}: PR-AUC={results[name]['pr_auc']:.3f} "
            f"ROC-AUC={results[name]['roc_auc']:.3f} P@k={results[name]['precision_at_k']:.3f}")

    return results


# --------------------------------------------------------------------------
# Explainability + artifacts (final model on all data)
# --------------------------------------------------------------------------
def fit_final_and_explain(X: pd.DataFrame, y: pd.Series, apr_vol: pd.Series, meta: dict) -> None:
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.inspection import permutation_importance

    final = HistGradientBoostingClassifier(
        max_depth=4, learning_rate=0.06, max_iter=400, random_state=RANDOM_STATE
    )
    final.fit(X.values, y.values)

    # Permutation importance (guards against high-cardinality bias).
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        perm = permutation_importance(
            final, X.values, y.values, n_repeats=20, random_state=RANDOM_STATE, scoring="average_precision"
        )
    imp = (
        pd.DataFrame({"feature": X.columns, "perm_importance": perm.importances_mean,
                      "perm_std": perm.importances_std})
        .sort_values("perm_importance", ascending=False)
    )
    imp.to_csv(OUT_DIR / "feature_importance.csv", index=False)

    # SHAP if available (optional).
    try:
        import shap  # type: ignore

        explainer = shap.Explainer(final, X)
        sv = explainer(X)
        np.save(OUT_DIR / "shap_values.npy", sv.values)
        log("  SHAP values written.")
    except Exception as e:  # noqa: BLE001
        log(f"  SHAP skipped ({type(e).__name__}); permutation importance used instead.")

    # Scored output in the ai_triage_results-shaped payload (LOCAL PREVIEW ONLY —
    # NOT uploaded to Supabase).
    scores = final.predict_proba(X.values)[:, 1]
    tier = pd.cut(pd.Series(scores, index=X.index).rank(pct=True),
                  bins=[-0.01, 1 / 3, 2 / 3, 1.01], labels=["low", "medium", "high"])
    top_feats = imp["feature"].head(5).tolist()
    preview = pd.DataFrame({
        "location_unit": "fsa",
        "location_id": X.index,
        "feature_window": "2026-01..2026-03",
        "scoring_period": "2026-04",
        "april_volume_actual": apr_vol.values,
        "workload_score": np.round(scores, 4),
        "predicted_tier": tier.values,
        "high_workload_area_true": y.values,
        "top_factors": [", ".join(top_feats)] * len(X),
        "model": "HistGradientBoostingClassifier",
        "model_version": "workload_density_v1",
        "feature_set_version": "v1",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "advisory": "Decision support only. Not a final enforcement decision. Staff review required.",
    }).sort_values("workload_score", ascending=False)
    preview.to_csv(OUT_DIR / "ai_triage_results_preview.csv", index=False)
    log(f"  Wrote local scored preview ({len(preview)} FSAs) — NOT uploaded.")

    # Persist the fitted model if joblib is available.
    try:
        import joblib  # type: ignore

        joblib.dump(final, OUT_DIR / "model.joblib")
        log("  Model serialized to model.joblib")
    except Exception as e:  # noqa: BLE001
        log(f"  Model not serialized ({type(e).__name__}).")


# --------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", action="store_true",
                    help="Fit models and write artifacts. Without this flag the script "
                         "only builds features/labels and prints the design (no fitting).")
    args = ap.parse_args()

    df = load()
    feat_w, label_w = split_windows(df)
    features, meta = build_features(feat_w)
    X, y, apr_vol = assemble(features, label_w)

    log("")
    log("=== DESIGN SUMMARY ===")
    log(f"Modeling unit: FSA | labeled FSAs: {len(X)} | features: {X.shape[1]}")
    log(f"Label = top-tercile April volume. Positives: {int(y.sum())} "
        f"({y.mean():.1%}) | Negatives: {int((1 - y).sum())}")
    log(f"source_channel used as feature: {meta['source_channel_used']}")
    log(f"Excluded leakage fields: {LEAKAGE_FIELDS}")
    log(f"Feature columns: {list(X.columns)}")

    if not args.train:
        log("")
        log("DRY RUN — no model was fit and nothing was written.")
        log("Re-run with --train (after approval) to fit models and write artifacts to "
            f"{OUT_DIR.relative_to(REPO_ROOT)}")
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    X.assign(high_workload_area=y, april_volume=apr_vol).to_csv(OUT_DIR / "feature_table.csv")

    log("")
    log("=== CROSS-VALIDATED EVALUATION ===")
    results = evaluate(X, y, X["prior_complaint_count"])

    fit_final_and_explain(X, y, apr_vol, meta)

    (OUT_DIR / "metrics.json").write_text(
        json.dumps({"meta": meta, "n_fsa": int(len(X)), "n_features": int(X.shape[1]),
                    "positive_rate": float(y.mean()), "results": results},
                   indent=2, default=str),
        encoding="utf-8",
    )
    log(f"Wrote metrics + artifacts to {OUT_DIR}")
    log("Done. Nothing uploaded to Supabase; nothing committed.")


if __name__ == "__main__":
    main()
