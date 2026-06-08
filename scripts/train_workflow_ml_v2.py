"""V2 workflow ML — Toronto 311 benchmark (per reports/modeling/v2/workflow_ml_audit.md).

Trains two staff-decision-support models on municipal_complaints benchmark data:

  Model 1 — Routing classifier: target = assigned_department (8 classes).
            Trained with AND without complaint_type (+ type phrase stripped from
            the description text) as an honest leakage check.
  Model 2 — Stale-risk / handling-path proxy: binary open vs resolved.

This is WORKFLOW ML — not geographic prediction, not hotspot targeting. The
stale-risk model is a proxy on current handling state (closed_at is empty), not a
time-to-close model. Outputs are staff decision support only.

scikit-learn only (LogisticRegression, RandomForest, HistGradientBoosting, TF-IDF).
No XGBoost / LightGBM.

Data source: the local normalized Toronto 311 CSV (same rows as
public.municipal_complaints). Temporal split: train Jan-Mar 2026, test Apr 2026.

Writes to reports/modeling/v2/: metrics.json, feature_importance_*.json/csv,
scored_sample.csv.

    python scripts/train_workflow_ml_v2.py
"""

from __future__ import annotations

import json
import re
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

pd.set_option("future.no_silent_downcasting", True)
warnings.filterwarnings("ignore")

from scipy.sparse import hstack
from sklearn.decomposition import TruncatedSVD
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (average_precision_score, brier_score_loss,
                             classification_report, confusion_matrix, f1_score,
                             precision_recall_fscore_support, roc_auc_score)
from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder

DOWNLOADS = Path.home() / "Downloads"
CSV = DOWNLOADS / "toronto_311_2026_normalized_full.csv"
REPO_ROOT = Path(__file__).resolve().parents[1]
OUT = REPO_ROOT / "reports" / "modeling" / "v2"

YEAR = 2026
TFIDF_MAX = 10000
SVD_COMPS = 120
RANDOM_STATE = 42
OPEN_STATUSES = {"New", "In Progress", "Unknown"}  # resolved = Completed/Closed/Cancelled


def log(m: str) -> None:
    print(f"[v2] {m}", flush=True)


# --------------------------------------------------------------------------
def load() -> pd.DataFrame:
    if not CSV.exists():
        raise SystemExit(f"Input not found: {CSV}")
    log(f"Reading {CSV.name} ...")
    df = pd.read_csv(CSV, dtype=str, keep_default_na=False, na_values=[])
    df = df.replace(r"^\s*$", np.nan, regex=True).infer_objects(copy=False)
    df["submitted_at"] = pd.to_datetime(df["submitted_at"], errors="coerce")
    df = df[df["submitted_at"].notna()].copy()
    df["__month"] = df["submitted_at"].dt.month
    df["__hour"] = df["submitted_at"].dt.hour
    df["__dow"] = df["submitted_at"].dt.dayofweek
    df["description"] = df["description"].fillna("")
    log(f"  -> {len(df):,} rows")
    return df


def strip_type(df: pd.DataFrame) -> pd.Series:
    """Remove the literal complaint_type phrase from the templated description."""
    def _strip(row):
        d, t = row["description"], row["complaint_type"]
        if isinstance(t, str) and t:
            return re.sub(re.escape(t), " ", d, flags=re.IGNORECASE)
        return d
    return df.apply(_strip, axis=1)


def temporal_split(df: pd.DataFrame):
    train = df[df["__month"].isin([1, 2, 3])]
    test = df[df["__month"] == 4]
    return train, test


# --------------------------------------------------------------------------
# Feature builders
# --------------------------------------------------------------------------
def build_sparse(train, test, text_col, cat_cols, num_cols):
    """Sparse TF-IDF + one-hot for LogisticRegression."""
    tfidf = TfidfVectorizer(max_features=TFIDF_MAX, min_df=5, ngram_range=(1, 2))
    Xtr_txt = tfidf.fit_transform(train[text_col])
    Xte_txt = tfidf.transform(test[text_col])

    ohe = OneHotEncoder(handle_unknown="ignore")
    Xtr_cat = ohe.fit_transform(train[cat_cols].astype(str))
    Xte_cat = ohe.transform(test[cat_cols].astype(str))

    Xtr_num = train[num_cols].to_numpy(dtype=float)
    Xte_num = test[num_cols].to_numpy(dtype=float)

    Xtr = hstack([Xtr_txt, Xtr_cat, Xtr_num]).tocsr()
    Xte = hstack([Xte_txt, Xte_cat, Xte_num]).tocsr()
    names = list(tfidf.get_feature_names_out()) + list(ohe.get_feature_names_out(cat_cols)) + num_cols
    return Xtr, Xte, names


def build_dense(train, test, text_col, cat_cols, num_cols):
    """Dense SVD(text) + ordinal cats + numeric for RF / HistGBDT."""
    tfidf = TfidfVectorizer(max_features=TFIDF_MAX, min_df=5, ngram_range=(1, 2))
    Xtr_txt = tfidf.fit_transform(train[text_col])
    Xte_txt = tfidf.transform(test[text_col])
    svd = TruncatedSVD(n_components=SVD_COMPS, random_state=RANDOM_STATE)
    Xtr_txt = svd.fit_transform(Xtr_txt)
    Xte_txt = svd.transform(Xte_txt)

    enc = OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)
    Xtr_cat = enc.fit_transform(train[cat_cols].astype(str))
    Xte_cat = enc.transform(test[cat_cols].astype(str))

    Xtr = np.hstack([Xtr_txt, Xtr_cat, train[num_cols].to_numpy(dtype=float)])
    Xte = np.hstack([Xte_txt, Xte_cat, test[num_cols].to_numpy(dtype=float)])
    names = [f"svd_{i}" for i in range(SVD_COMPS)] + cat_cols + num_cols
    return Xtr, Xte, names


# --------------------------------------------------------------------------
# Model 1 — Routing
# --------------------------------------------------------------------------
def routing_variant(train, test, text_col, cat_cols, num_cols, ytr, yte, label):
    log(f"  routing variant: {label}")
    res = {}

    # LogReg on sparse
    Xtr_s, Xte_s, names_s = build_sparse(train, test, text_col, cat_cols, num_cols)
    lr = LogisticRegression(max_iter=300, n_jobs=-1, C=1.0)
    lr.fit(Xtr_s, ytr)
    res["logreg"] = scores_multiclass(yte, lr.predict(Xte_s))

    # RF + HGB on dense
    Xtr_d, Xte_d, names_d = build_dense(train, test, text_col, cat_cols, num_cols)
    rf = RandomForestClassifier(n_estimators=150, n_jobs=-1, random_state=RANDOM_STATE,
                                class_weight="balanced_subsample", min_samples_leaf=2)
    rf.fit(Xtr_d, ytr)
    res["random_forest"] = scores_multiclass(yte, rf.predict(Xte_d))

    hgb = HistGradientBoostingClassifier(max_depth=8, learning_rate=0.1, max_iter=300,
                                         random_state=RANDOM_STATE)
    hgb.fit(Xtr_d, ytr)
    yhat_hgb = hgb.predict(Xte_d)
    res["hist_gbdt"] = scores_multiclass(yte, yhat_hgb)

    # pick best by macro F1 for per-class + confusion matrix
    best = max(res, key=lambda k: res[k]["macro_f1"])
    labels_sorted = sorted(pd.unique(ytr))
    if best == "logreg":
        yhat_best = lr.predict(Xte_s)
    elif best == "random_forest":
        yhat_best = rf.predict(Xte_d)
    else:
        yhat_best = yhat_hgb
    per_class = classification_report(yte, yhat_best, output_dict=True, zero_division=0)
    cm = confusion_matrix(yte, yhat_best, labels=labels_sorted).tolist()

    return {
        "models": res,
        "best_model": best,
        "labels": labels_sorted,
        "per_class": per_class,
        "confusion_matrix": cm,
    }, (lr, names_s, rf, names_d)


def scores_multiclass(y_true, y_pred) -> dict:
    return {
        "macro_f1": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y_true, y_pred, average="weighted", zero_division=0)),
        "accuracy": float((np.array(y_true) == np.array(y_pred)).mean()),
    }


# --------------------------------------------------------------------------
# Model 2 — Stale risk
# --------------------------------------------------------------------------
def precision_recall_at_k(y_true, scores, frac=0.10):
    n = len(scores)
    k = max(1, int(round(frac * n)))
    order = np.argsort(-scores)[:k]
    tp = np.array(y_true)[order].sum()
    return float(tp / k), float(tp / max(1, np.array(y_true).sum())), k


def stale_models(train, test, text_col, cat_cols, num_cols, ytr, yte) -> dict:
    res = {}
    Xtr_s, Xte_s, _ = build_sparse(train, test, text_col, cat_cols, num_cols)
    Xtr_d, Xte_d, names_d = build_dense(train, test, text_col, cat_cols, num_cols)

    models = {
        "logreg": (LogisticRegression(max_iter=300, n_jobs=-1, class_weight="balanced"), "sparse"),
        "random_forest": (RandomForestClassifier(n_estimators=200, n_jobs=-1, random_state=RANDOM_STATE,
                                                  class_weight="balanced_subsample", min_samples_leaf=2), "dense"),
        "hist_gbdt": (HistGradientBoostingClassifier(max_depth=6, learning_rate=0.08, max_iter=300,
                                                     random_state=RANDOM_STATE), "dense"),
    }
    importances = {}
    for name, (model, kind) in models.items():
        Xtr, Xte = (Xtr_s, Xte_s) if kind == "sparse" else (Xtr_d, Xte_d)
        model.fit(Xtr, ytr)
        proba = model.predict_proba(Xte)[:, 1]
        pred = (proba >= 0.5).astype(int)
        p_at_k, r_at_k, k = precision_recall_at_k(yte, proba, 0.10)
        pr, rc, f1, _ = precision_recall_fscore_support(yte, pred, average="binary", zero_division=0)
        res[name] = {
            "pr_auc": float(average_precision_score(yte, proba)),
            "roc_auc": float(roc_auc_score(yte, proba)),
            "precision_at_k_top10pct": p_at_k,
            "recall_at_k_top10pct": r_at_k,
            "k": k,
            "precision": float(pr), "recall": float(rc), "f1": float(f1),
            "brier": float(brier_score_loss(yte, np.clip(proba, 0, 1))),
        }
        if name == "hist_gbdt":
            importances = {names_d[i]: float(v) for i, v in
                           enumerate(getattr(model, "feature_importances_", []))}
        log(f"  stale {name}: PR-AUC={res[name]['pr_auc']:.3f} ROC-AUC={res[name]['roc_auc']:.3f}")
    # store the best model's probabilities for the scored sample
    best = max(res, key=lambda k: res[k]["pr_auc"])
    bm, kind = models[best]
    Xte = Xte_s if kind == "sparse" else Xte_d
    best_proba = bm.predict_proba(Xte)[:, 1]
    return {"models": res, "best_model": best}, best_proba, importances


# --------------------------------------------------------------------------
def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    df = load()

    NUM = ["__hour", "__dow", "__month"]
    metrics = {"data": {}, "model_1_routing": {}, "model_2_stale": {}, "caveats": [
        "Workflow ML, not geographic prediction or hotspot targeting.",
        "Stale-risk is a proxy on current handling state; closed_at is empty so there is no time-to-close label.",
        "Routing can leak via complaint_type and templated description; see with/without-type variants.",
        "No automated decisions; staff decision support only.",
    ]}

    # ---------- Model 1: Routing ----------
    log("=== Model 1: routing (assigned_department) ===")
    r = df[df["assigned_department"].notna()].copy()
    # drop ultra-rare departments that can't span the split
    vc = r["assigned_department"].value_counts()
    keep = vc[vc >= 50].index
    r = r[r["assigned_department"].isin(keep)].copy()
    r["__desc_stripped"] = strip_type(r)
    rtr, rte = temporal_split(r)
    ytr, yte = rtr["assigned_department"].to_numpy(), rte["assigned_department"].to_numpy()
    metrics["data"]["routing_train"] = int(len(rtr))
    metrics["data"]["routing_test"] = int(len(rte))
    metrics["data"]["routing_classes"] = sorted(map(str, keep))

    # with complaint_type (+ original text)
    with_type, with_models = routing_variant(
        rtr, rte, "description",
        ["complaint_type", "ward_or_area", "source_channel", "priority"], NUM, ytr, yte, "with_type")
    # without complaint_type (+ type phrase stripped from the description text)
    no_type, _ = routing_variant(
        rtr, rte, "__desc_stripped",
        ["ward_or_area", "source_channel", "priority"], NUM, ytr, yte, "no_type")

    metrics["model_1_routing"] = {
        "with_complaint_type": with_type,
        "without_complaint_type_text_stripped": no_type,
        "leakage_note": "macro_f1 drop from with->without isolates how much routing relied on the "
                        "complaint_type label / templated text vs genuine signal.",
    }

    # routing feature importance: LogReg top coefficients per class (with_type)
    lr, names_s, rf, names_d = with_models
    top_coef = {}
    classes = list(lr.classes_)
    coefs = lr.coef_
    for ci, cls in enumerate(classes):
        idx = np.argsort(coefs[ci])[-15:][::-1]
        top_coef[str(cls)] = [{"feature": names_s[j], "coef": float(coefs[ci][j])} for j in idx]
    (OUT / "feature_importance_routing_logreg.json").write_text(
        json.dumps(top_coef, indent=2), encoding="utf-8")

    # ---------- Model 2: Stale risk ----------
    log("=== Model 2: stale-risk (open vs resolved) ===")
    s = df[df["status"].notna()].copy()
    s["__open"] = s["status"].isin(OPEN_STATUSES).astype(int)
    str_, ste = temporal_split(s)
    sytr, syte = str_["__open"].to_numpy(), ste["__open"].to_numpy()
    metrics["data"]["stale_train"] = int(len(str_))
    metrics["data"]["stale_test"] = int(len(ste))
    metrics["data"]["stale_positive_rate_train"] = float(sytr.mean())
    metrics["data"]["stale_positive_rate_test"] = float(syte.mean())

    stale_res, stale_proba, stale_imp = stale_models(
        str_, ste, "description",
        ["complaint_type", "assigned_department", "priority", "ward_or_area", "source_channel"],
        NUM, sytr, syte)
    metrics["model_2_stale"] = stale_res
    if stale_imp:
        imp_sorted = sorted(stale_imp.items(), key=lambda kv: kv[1], reverse=True)[:20]
        (OUT / "feature_importance_stale_histgbdt.json").write_text(
            json.dumps([{"feature": k, "importance": v} for k, v in imp_sorted], indent=2), encoding="utf-8")

    # ---------- Scored sample for UI planning ----------
    log("Writing scored sample ...")
    # routing predictions (best with_type model) on a sample of Apr test
    sample = rte.sample(min(300, len(rte)), random_state=RANDOM_STATE).copy()
    # Refit a routing LogReg (with complaint_type) on the full train window so we can
    # score the sample rows with matching vectorizers for the UI-planning CSV.
    lr_full = LogisticRegression(max_iter=300, n_jobs=-1)
    tfidf = TfidfVectorizer(max_features=TFIDF_MAX, min_df=5, ngram_range=(1, 2))
    ohe = OneHotEncoder(handle_unknown="ignore")
    cat_cols = ["complaint_type", "ward_or_area", "source_channel", "priority"]
    Xtr = hstack([tfidf.fit_transform(rtr["description"]),
                  ohe.fit_transform(rtr[cat_cols].astype(str)),
                  rtr[NUM].to_numpy(float)]).tocsr()
    lr_full.fit(Xtr, ytr)
    Xs = hstack([tfidf.transform(sample["description"]),
                 ohe.transform(sample[cat_cols].astype(str)),
                 sample[NUM].to_numpy(float)]).tocsr()
    proba = lr_full.predict_proba(Xs)
    pred_idx = proba.argmax(1)
    sample["predicted_department"] = [lr_full.classes_[i] for i in pred_idx]
    sample["routing_confidence"] = proba.max(1).round(4)

    # stale score for same case_ids (map from test proba)
    stale_score_map = dict(zip(ste["case_id"], np.round(stale_proba, 4)))
    open_true_map = dict(zip(ste["case_id"], ste["status"].isin(OPEN_STATUSES).astype(int)))
    sample["stale_risk_score"] = sample["case_id"].map(stale_score_map)
    sample["is_open_true"] = sample["case_id"].map(open_true_map)

    cols = ["case_id", "submitted_at", "complaint_type", "ward_or_area", "source_channel",
            "assigned_department", "predicted_department", "routing_confidence",
            "status", "is_open_true", "stale_risk_score"]
    sample[cols].assign(advisory="Staff decision support only. Not an automated decision.") \
        .to_csv(OUT / "scored_sample.csv", index=False)

    (OUT / "metrics.json").write_text(json.dumps(metrics, indent=2, default=str), encoding="utf-8")
    log(f"Wrote metrics + artifacts to {OUT}")
    log("Done. Nothing uploaded to Supabase; nothing wired to frontend.")


if __name__ == "__main__":
    main()
