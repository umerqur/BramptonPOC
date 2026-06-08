"""Score the FULL Toronto 311 benchmark with the approved V2 workflow ML pipeline.

Reuses the same sklearn pipeline as scripts/train_workflow_ml_v2.py (fit on the
approved train window Jan-Mar 2026), then scores ALL eligible rows and writes one
prediction row per complaint to:

    reports/modeling/v2/workflow_ml_predictions_full.csv

Outputs:
  - needs_attention_score: P(open/unresolved) from the HistGradientBoosting
    handling-path proxy. Treated as a RELATIVE ranking, not a hard probability
    (the model is intentionally under-calibrated on benchmark data).
  - attention_tier (Higher/Medium/Lower) + attention_rank: relative ranking across
    all scored rows.
  - predicted_department + routing_confidence: RESEARCH ONLY. Toronto routing
    mostly learned complaint_type -> department, so it is not an operational
    recommendation.

This is Toronto 311 benchmark data — staff decision support only, not Brampton
operational data, not automated enforcement, not geographic prediction.

    python scripts/score_workflow_ml_v2_full.py
"""

from __future__ import annotations

import hashlib
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

pd.set_option("future.no_silent_downcasting", True)
warnings.filterwarnings("ignore")

from scipy.sparse import hstack
from sklearn.decomposition import TruncatedSVD
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder

CSV = Path.home() / "Downloads" / "toronto_311_2026_normalized_full.csv"
OUT = Path(__file__).resolve().parents[1] / "reports" / "modeling" / "v2" / "workflow_ml_predictions_full.csv"

YEAR = 2026
TFIDF_MAX = 10000
SVD_COMPS = 120
RANDOM_STATE = 42
OPEN_STATUSES = {"New", "In Progress", "Unknown"}

SOURCE_DATASET = "Toronto 311 Customer Initiated Service Requests 2026"
MODEL_VERSION = "v2"
MODEL_NAME = "workflow_ml_v2"
PREDICTION_TYPE = "needs_attention"
ADVISORY = ("Toronto 311 benchmark. Staff decision support only. Not Brampton "
            "operational data. Not automated enforcement.")

ROUTING_CATS = ["complaint_type", "ward_or_area", "source_channel", "priority"]
STALE_CATS = ["complaint_type", "assigned_department", "priority", "ward_or_area", "source_channel"]
NUM = ["__hour", "__dow", "__month"]


def log(m: str) -> None:
    print(f"[score-v2] {m}", flush=True)


def load() -> pd.DataFrame:
    if not CSV.exists():
        raise SystemExit(f"Input not found: {CSV}")
    log(f"Reading {CSV.name} ...")
    df = pd.read_csv(CSV, dtype=str, keep_default_na=False, na_values=[])
    df = df.replace(r"^\s*$", np.nan, regex=True).infer_objects(copy=False)
    df["submitted_at"] = pd.to_datetime(df["submitted_at"], errors="coerce")
    df = df[df["submitted_at"].notna()].copy()
    df["__hour"] = df["submitted_at"].dt.hour
    df["__dow"] = df["submitted_at"].dt.dayofweek
    df["__month"] = df["submitted_at"].dt.month
    df["description"] = df["description"].fillna("")
    log(f"  -> {len(df):,} rows")
    return df


def row_hash(case_id, fallback_idx) -> str:
    key = str(case_id) if isinstance(case_id, str) and case_id else f"row-{fallback_idx}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    df = load()
    train = df[df["__month"].isin([1, 2, 3])].copy()

    # ---- Needs Attention (handling-path proxy): HistGBDT on dense SVD+ordinal ----
    log("Fitting Needs Attention model (HistGradientBoosting) on Jan-Mar ...")
    y_stale = train["status"].isin(OPEN_STATUSES).astype(int).to_numpy()

    tfidf_s = TfidfVectorizer(max_features=TFIDF_MAX, min_df=5, ngram_range=(1, 2))
    Xtr_txt = tfidf_s.fit_transform(train["description"])
    svd = TruncatedSVD(n_components=SVD_COMPS, random_state=RANDOM_STATE)
    Xtr_txt = svd.fit_transform(Xtr_txt)
    enc = OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)
    Xtr_cat = enc.fit_transform(train[STALE_CATS].astype(str))
    Xtr = np.hstack([Xtr_txt, Xtr_cat, train[NUM].to_numpy(float)])
    hgb = HistGradientBoostingClassifier(max_depth=6, learning_rate=0.08, max_iter=300,
                                         random_state=RANDOM_STATE)
    hgb.fit(Xtr, y_stale)

    log("Scoring all eligible rows for Needs Attention ...")
    Xall_txt = svd.transform(tfidf_s.transform(df["description"]))
    Xall_cat = enc.transform(df[STALE_CATS].astype(str))
    Xall = np.hstack([Xall_txt, Xall_cat, df[NUM].to_numpy(float)])
    df["needs_attention_score"] = hgb.predict_proba(Xall)[:, 1]

    # ---- Routing (research only): LogReg on sparse TF-IDF + one-hot ----
    log("Fitting routing model (LogisticRegression, research only) on Jan-Mar ...")
    rtrain = train[train["assigned_department"].notna()].copy()
    tfidf_r = TfidfVectorizer(max_features=TFIDF_MAX, min_df=5, ngram_range=(1, 2))
    ohe = OneHotEncoder(handle_unknown="ignore")
    Xr = hstack([tfidf_r.fit_transform(rtrain["description"]),
                 ohe.fit_transform(rtrain[ROUTING_CATS].astype(str)),
                 rtrain[NUM].to_numpy(float)]).tocsr()
    lr = LogisticRegression(max_iter=300, n_jobs=-1)
    lr.fit(Xr, rtrain["assigned_department"].to_numpy())

    log("Scoring all eligible rows for routing ...")
    Xall_r = hstack([tfidf_r.transform(df["description"]),
                     ohe.transform(df[ROUTING_CATS].astype(str)),
                     df[NUM].to_numpy(float)]).tocsr()
    proba_r = lr.predict_proba(Xall_r)
    df["predicted_department"] = [lr.classes_[i] for i in proba_r.argmax(1)]
    df["routing_confidence"] = proba_r.max(1)

    # ---- Relative attention tier + rank across all scored rows ----
    log("Computing relative attention tiers/ranks ...")
    df["attention_rank"] = df["needs_attention_score"].rank(ascending=False, method="first").astype(int)
    q1, q2 = df["needs_attention_score"].quantile([1 / 3, 2 / 3])
    df["attention_tier"] = np.where(df["needs_attention_score"] >= q2, "Higher",
                            np.where(df["needs_attention_score"] >= q1, "Medium", "Lower"))

    # ---- Assemble output ----
    out = pd.DataFrame({
        "source_city": "Toronto",
        "source_dataset": SOURCE_DATASET,
        "model_version": MODEL_VERSION,
        "model_name": MODEL_NAME,
        "prediction_type": PREDICTION_TYPE,
        "source_record_id": df["case_id"],
        "source_row_hash": [row_hash(c, i) for i, c in enumerate(df["case_id"])],
        "complaint_type": df["complaint_type"],
        "description": df["description"],
        "ward_or_area": df["ward_or_area"],
        "status": df["status"],
        "assigned_department": df["assigned_department"],
        "predicted_department": df["predicted_department"],
        "routing_confidence": df["routing_confidence"].round(4),
        "needs_attention_score": df["needs_attention_score"].round(6),
        "attention_tier": df["attention_tier"],
        "attention_rank": df["attention_rank"],
        "advisory": ADVISORY,
    })
    # guard: hashes must be unique for idempotent upsert
    dupes = out["source_row_hash"].duplicated().sum()
    if dupes:
        log(f"  WARNING: {dupes} duplicate source_row_hash values")
    out.to_csv(OUT, index=False)
    log(f"Wrote {len(out):,} scored rows -> {OUT}")
    log("Tier counts: " + out["attention_tier"].value_counts().to_dict().__str__())
    log("Done. Nothing uploaded. Routing columns are research-only.")


if __name__ == "__main__":
    main()
