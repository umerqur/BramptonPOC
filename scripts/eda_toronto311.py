"""Exploratory data analysis for the Toronto 311 normalized dataset.

EDA ONLY. This script does not train models, does not touch Supabase, does not
modify the frontend. It reads the local normalized Toronto 311 CSV and the real
Toronto City Wards GeoJSON, then writes profiling tables, charts, a leakage
audit, a ward-join check, and a target-proxy assessment into reports/eda/.

Run from the repo root:
    python scripts/eda_toronto311.py

Final counts are computed from the FULL CSV. The 10k sample is only a fallback
for iterating on plotting code (pass --sample).
"""

from __future__ import annotations

import argparse
import json
import math
import re
from datetime import datetime
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # headless: write PNGs, never open a window
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

# Opt in to future pandas behavior so replace()-of-blanks does not emit a
# downcasting FutureWarning.
pd.set_option("future.no_silent_downcasting", True)

# --------------------------------------------------------------------------
# Paths. Inputs live outside the repo in the user's Downloads folder; outputs
# stay under reports/eda/ as required.
# --------------------------------------------------------------------------
DOWNLOADS = Path.home() / "Downloads"
FULL_CSV = DOWNLOADS / "toronto_311_2026_normalized_full.csv"
SAMPLE_CSV = DOWNLOADS / "toronto_311_2026_normalized_sample_10000.csv"
WARDS_GEOJSON = DOWNLOADS / "City Wards Data - 4326.geojson"

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = REPO_ROOT / "reports" / "eda"
DIST_DIR = OUT_DIR / "distributions"

# Columns that describe an outcome/decision or are machine-derived from the
# complaint text. Used by the leakage audit.
DERIVED_FROM_TYPE = ["ai_category", "ai_priority", "ai_summary", "ai_recommended_action", "priority"]
OUTCOME_COLS = ["status", "resolution_status", "workflow_stage", "closed_at", "human_decision"]
ID_OR_TEXT = ["case_id", "description"]

# Demographic-style fields we explicitly check for absence (rule 9).
DEMOGRAPHIC_HINTS = [
    "age", "gender", "sex", "race", "ethnic", "income", "name", "dob",
    "birth", "marital", "religion", "nationality", "disab",
]


def log(msg: str) -> None:
    print(f"[eda] {msg}", flush=True)


def blank_to_na(df: pd.DataFrame) -> pd.DataFrame:
    """Treat empty/whitespace-only strings as missing (the CSV uses '' not NaN)."""
    return df.replace(r"^\s*$", np.nan, regex=True).infer_objects(copy=False)


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------
def load_full_as_str(path: Path) -> pd.DataFrame:
    """Read everything as string first so pandas never guesses dtypes."""
    log(f"Reading {path.name} (all columns as string)...")
    df = pd.read_csv(path, dtype=str, keep_default_na=False, na_values=[])
    log(f"  -> {len(df):,} rows x {df.shape[1]} columns")
    return df


def typed_copy(df: pd.DataFrame) -> pd.DataFrame:
    """Return a copy with timestamps/floats parsed and blanks set to NaN."""
    t = blank_to_na(df.copy())
    for col in ("submitted_at", "closed_at"):
        if col in t.columns:
            t[col] = pd.to_datetime(t[col], errors="coerce")
    for col in ("latitude", "longitude"):
        if col in t.columns:
            t[col] = pd.to_numeric(t[col], errors="coerce")
    return t


# --------------------------------------------------------------------------
# A. Structure & quality (Q1-Q4)
# --------------------------------------------------------------------------
def column_profile(df_str: pd.DataFrame, typed: pd.DataFrame) -> pd.DataFrame:
    n = len(df_str)
    rows = []
    for col in df_str.columns:
        raw = df_str[col]
        empty = raw.str.strip().eq("").sum() if raw.dtype == object else 0
        null_like = typed[col].isna().sum()
        nunique = typed[col].nunique(dropna=True)
        # a small set of example non-empty values
        examples = (
            raw[raw.str.strip() != ""].dropna().unique()[:3].tolist()
            if raw.dtype == object
            else raw.dropna().unique()[:3].tolist()
        )
        if col in ("submitted_at", "closed_at"):
            inferred = "datetime"
        elif col in ("latitude", "longitude"):
            inferred = "float"
        elif nunique <= max(50, int(0.001 * n)):
            inferred = "categorical"
        else:
            inferred = "text/high-cardinality"
        rows.append(
            {
                "column": col,
                "inferred_type": inferred,
                "missing_count": int(null_like),
                "missing_pct": round(100 * null_like / n, 2),
                "empty_string_count": int(empty),
                "n_distinct": int(nunique),
                "example_values": " | ".join(str(e)[:40] for e in examples),
            }
        )
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------
# B. Leakage audit (Q6) + target proxy (Q7)
# --------------------------------------------------------------------------
def determinism_ratio(df: pd.DataFrame, key: str, target: str) -> float:
    """Fraction of rows whose `target` equals the most common target value for
    their `key`. 1.0 means `target` is a deterministic function of `key`
    (i.e. it carries no new information beyond the key -> leakage)."""
    sub = df[[key, target]].dropna()
    if sub.empty:
        return float("nan")
    mode_per_key = sub.groupby(key)[target].transform(lambda s: s.mode().iloc[0])
    return float((sub[target] == mode_per_key).mean())


def leakage_audit(typed: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for col in DERIVED_FROM_TYPE:
        if col not in typed.columns:
            continue
        ratio = determinism_ratio(typed, "complaint_type", col)
        verdict = "LEAKAGE" if (not math.isnan(ratio) and ratio >= 0.98) else "REVIEW"
        rows.append(
            {
                "column": col,
                "leakage_type": "derived from complaint_type",
                "evidence_metric": "P(value = mode | complaint_type)",
                "evidence_value": None if math.isnan(ratio) else round(ratio, 4),
                "verdict": verdict,
                "reason": "Machine-generated from complaint_type; near-deterministic mapping."
                if verdict == "LEAKAGE"
                else "Mostly determined by complaint_type; treat as derived.",
            }
        )
    for col in OUTCOME_COLS:
        if col not in typed.columns:
            continue
        rows.append(
            {
                "column": col,
                "leakage_type": "post-outcome / resolution state",
                "evidence_metric": "domain reasoning",
                "evidence_value": None,
                "verdict": "LEAKAGE",
                "reason": "Known only after the case progresses/closes; leaks resolution outcome.",
            }
        )
    for col in ID_OR_TEXT:
        if col not in typed.columns:
            continue
        rows.append(
            {
                "column": col,
                "leakage_type": "identifier / templated free text",
                "evidence_metric": "domain reasoning",
                "evidence_value": None,
                "verdict": "EXCLUDE",
                "reason": "Row id or templated text that restates the label phrases.",
            }
        )
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------
# C. Target feasibility: days_open / resolution duration (Q8)
# --------------------------------------------------------------------------
def duration_assessment(typed: pd.DataFrame) -> dict:
    n = len(typed)
    closed_cov = typed["closed_at"].notna().sum() if "closed_at" in typed else 0
    out = {
        "rows": int(n),
        "closed_at_present": int(closed_cov),
        "closed_at_present_pct": round(100 * closed_cov / n, 2),
    }
    if closed_cov > 0 and "submitted_at" in typed:
        delta = (typed["closed_at"] - typed["submitted_at"]).dt.total_seconds() / 86400.0
        delta = delta.dropna()
        out.update(
            {
                "days_open_computable": int(delta.notna().sum()),
                "days_open_negative": int((delta < 0).sum()),
                "days_open_zero": int((delta == 0).sum()),
                "days_open_median": round(float(delta[delta >= 0].median()), 3) if (delta >= 0).any() else None,
                "days_open_p90": round(float(delta[delta >= 0].quantile(0.9)), 3) if (delta >= 0).any() else None,
            }
        )
    else:
        out["days_open_computable"] = 0
    return out


# --------------------------------------------------------------------------
# D. Distributions (Q9-Q13) + charts
# --------------------------------------------------------------------------
def save_barh(series: pd.Series, title: str, fname: str, top: int = 20) -> None:
    counts = series.value_counts(dropna=False).head(top)[::-1]
    plt.figure(figsize=(9, max(3, 0.4 * len(counts) + 1)))
    labels = [str(i)[:45] for i in counts.index]
    plt.barh(labels, counts.values, color="#1e3a5f")
    plt.title(title)
    plt.xlabel("cases")
    plt.tight_layout()
    plt.savefig(DIST_DIR / fname, dpi=110)
    plt.close()


def save_bar(x, y, title: str, xlabel: str, fname: str) -> None:
    plt.figure(figsize=(9, 4))
    plt.bar([str(i) for i in x], y, color="#2563eb")
    plt.title(title)
    plt.xlabel(xlabel)
    plt.ylabel("cases")
    plt.tight_layout()
    plt.savefig(DIST_DIR / fname, dpi=110)
    plt.close()


def time_patterns(typed: pd.DataFrame) -> dict:
    s = typed["submitted_at"].dropna()
    info = {
        "submitted_at_present_pct": round(100 * typed["submitted_at"].notna().mean(), 2),
        "date_min": str(s.min()) if not s.empty else None,
        "date_max": str(s.max()) if not s.empty else None,
    }
    if s.empty:
        return info
    by_hour = s.dt.hour.value_counts().sort_index()
    save_bar(by_hour.index, by_hour.values, "Cases by hour of day", "hour", "time_by_hour.png")
    dow = s.dt.dayofweek.value_counts().sort_index()
    names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    save_bar([names[i] for i in dow.index], dow.values, "Cases by day of week", "day", "time_by_dayofweek.png")
    by_month = s.dt.to_period("M").value_counts().sort_index()
    save_bar([str(p) for p in by_month.index], by_month.values, "Cases by month", "month", "time_by_month.png")
    info["distinct_months"] = int(by_month.size)
    return info


# --------------------------------------------------------------------------
# E. Repeat-location patterns (Q14)
# --------------------------------------------------------------------------
def repeat_patterns(typed: pd.DataFrame) -> dict:
    out = {}
    frames = {}
    for col in ("ward_or_area", "fsa_or_area", "address_or_location"):
        if col not in typed.columns:
            continue
        vc = typed[col].dropna().value_counts()
        frames[col] = vc
        out[f"{col}__distinct"] = int(vc.size)
        out[f"{col}__max_repeat"] = int(vc.max()) if not vc.empty else 0
        out[f"{col}__locations_ge_3"] = int((vc >= 3).sum())

    if "address_or_location" in frames:
        top_addr = frames["address_or_location"].head(20)
        save_barh(
            typed["address_or_location"].dropna(),
            "Top repeat locations (address_or_location)",
            "repeat_locations.png",
            top=20,
        )
        out["top_repeat_addresses"] = {str(k): int(v) for k, v in top_addr.items()}
    # complaints-per-location distribution (how many locations have N complaints)
    if "address_or_location" in frames:
        per_loc = frames["address_or_location"]
        dist = per_loc.value_counts().sort_index()
        plt.figure(figsize=(9, 4))
        plt.bar(dist.index.astype(int)[:40], dist.values[:40], color="#7c3aed")
        plt.title("Distribution of complaints per address")
        plt.xlabel("complaints at a single address")
        plt.ylabel("number of addresses")
        plt.tight_layout()
        plt.savefig(DIST_DIR / "complaints_per_address_hist.png", dpi=110)
        plt.close()
    return out


# --------------------------------------------------------------------------
# Demographics check (Q15)
# --------------------------------------------------------------------------
def demographic_check(columns) -> dict:
    # Token-based match so "age" does NOT spuriously hit "workflow_st-age".
    found = []
    for c in columns:
        tokens = re.split(r"[^a-z]+", c.lower())
        if any(tok == h or tok.startswith(h) for tok in tokens for h in DEMOGRAPHIC_HINTS):
            found.append(c)
    return {
        "demographic_fields_found": found,
        "has_demographics": bool(found),
        "statement": (
            "No age, gender, race, income, or other demographic/personal fields exist "
            "in this dataset. The columns are operational and geographic only. No "
            "demographic attributes will be inferred or invented."
            if not found
            else f"Potential demographic-like fields detected: {found} (verify)."
        ),
    }


# --------------------------------------------------------------------------
# G. Toronto City Wards GeoJSON + ward join + real workload hotspot (Q12, Q8 ask)
# --------------------------------------------------------------------------
def load_wards(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        gj = json.load(f)
    return gj


def _ward_number(value: str):
    """Extract the trailing ward number from a label like 'Beaches-East York (19)'
    or a code like '07'. Returns an int (zero-padding normalized) or None."""
    if value is None:
        return None
    m = re.search(r"\((\d+)\)\s*$", str(value))
    if not m:
        m = re.fullmatch(r"\s*0*(\d+)\s*", str(value))
    return int(m.group(1)) if m else None


def ward_join_and_hotspot(typed: pd.DataFrame, gj: dict) -> dict:
    feats = gj.get("features", [])
    props = [f.get("properties", {}) for f in feats]
    area_desc = {str(p.get("AREA_DESC")).strip() for p in props}
    area_name = {str(p.get("AREA_NAME")).strip() for p in props}
    # Map ward number -> canonical AREA_DESC, using AREA_SHORT_CODE (e.g. '07').
    num_to_desc = {}
    for p in props:
        num = _ward_number(p.get("AREA_SHORT_CODE")) or _ward_number(p.get("AREA_DESC"))
        if num is not None:
            num_to_desc[num] = str(p.get("AREA_DESC")).strip()

    info = {
        "geojson_feature_count": len(feats),
        "geojson_property_keys": sorted(props[0].keys()) if props else [],
        "geometry_type": feats[0]["geometry"]["type"] if feats else None,
        "crs": gj.get("crs", {}).get("properties", {}).get("name"),
    }

    if "ward_or_area" not in typed.columns:
        return info

    wv = typed["ward_or_area"].dropna().astype(str).str.strip()
    total = len(wv)
    match_desc = wv.isin(area_desc).sum()
    match_name = wv.isin(area_name).sum()
    # Number-normalized match (handles '(07)' vs '(7)' zero-padding).
    wv_num = wv.map(_ward_number)
    match_num = wv_num.isin(set(num_to_desc.keys())).sum()
    info["ward_or_area_nonnull"] = int(total)
    info["match_rate_vs_AREA_DESC_raw"] = round(100 * match_desc / total, 2) if total else 0
    info["match_rate_vs_AREA_NAME_raw"] = round(100 * match_name / total, 2) if total else 0
    info["match_rate_normalized_by_ward_number"] = round(100 * match_num / total, 2) if total else 0
    info["distinct_ward_values"] = int(wv.nunique())
    info["distinct_geojson_wards"] = len(num_to_desc)

    # Real workload-by-ward hotspot: aggregate actual complaint volume per ward.
    counts = wv.value_counts()
    hotspot = (
        counts.rename_axis("ward_or_area")
        .reset_index(name="complaint_volume")
        .sort_values("complaint_volume", ascending=False)
    )
    hotspot["ward_number"] = hotspot["ward_or_area"].map(_ward_number)
    hotspot["geojson_AREA_DESC"] = hotspot["ward_number"].map(num_to_desc)
    hotspot["matches_geojson"] = hotspot["geojson_AREA_DESC"].notna()
    hotspot.to_csv(OUT_DIR / "ward_workload_real.csv", index=False)

    # Chart the real per-ward volume (this is REAL Toronto data, not synthetic).
    top = hotspot.head(25)
    plt.figure(figsize=(10, 7))
    plt.barh(top["ward_or_area"][::-1], top["complaint_volume"][::-1], color="#dc2626")
    plt.title("Real Toronto 311 complaint volume by ward (joins to City Wards GeoJSON)")
    plt.xlabel("complaints")
    plt.tight_layout()
    plt.savefig(DIST_DIR / "ward_workload_real.png", dpi=110)
    plt.close()

    matched_nums = set(num_to_desc.keys())
    info["unmatched_ward_values"] = sorted(
        {v for v in set(wv) if _ward_number(v) not in matched_nums}
    )[:15]
    return info


# --------------------------------------------------------------------------
# Report writer
# --------------------------------------------------------------------------
def write_report(ctx: dict) -> None:
    p = OUT_DIR / "eda_report.md"
    lines = []
    a = lines.append
    a("# Toronto 311 EDA Report\n")
    a(f"_Generated {datetime.now():%Y-%m-%d %H:%M} — EDA only. No model trained, no Supabase upload, no frontend change._\n")
    a(f"- Source file: `{ctx['source_name']}`")
    a(f"- Rows: **{ctx['n_rows']:,}**  |  Columns: **{ctx['n_cols']}**")
    a(f"- Duplicate case_id: {ctx['dup_case_id']:,}  |  Fully duplicate rows: {ctx['dup_rows']:,}\n")

    a("## Q1-Q4 Structure, types, missingness")
    a("See `column_profile.csv`. Highlights:\n")
    a(ctx["profile_md"])
    a("")

    a("## Q5 Useful-for-ML features")
    a(", ".join(f"`{c}`" for c in ctx["ml_features"]) + "\n")

    a("## Q6 Leakage audit")
    a("See `leakage_audit.csv`. Derived/outcome columns must be excluded from any predictive target:\n")
    a(ctx["leakage_md"])
    a("")

    a("## Q7 Target proxy for workload risk")
    a(ctx["proxy_text"])
    a("")

    a("## Q8 days_open / resolution duration feasibility")
    for k, v in ctx["duration"].items():
        a(f"- {k}: {v}")
    a("")

    a("## Q9-Q13 Distributions")
    a(f"- Complaint categories (distinct complaint_type): {ctx['n_types']} — chart `distributions/category_complaint_type.png`")
    a(f"- Status distribution — chart `distributions/status.png`")
    a(f"- Department distribution — chart `distributions/department.png`")
    a(f"- Location coverage: valid lat/long {ctx['geo_cov']}%, ward_or_area present {ctx['ward_cov']}%, fsa present {ctx['fsa_cov']}%")
    a(f"- Time span: {ctx['time']['date_min']} -> {ctx['time']['date_max']} "
      f"({ctx['time'].get('distinct_months','?')} months) — charts time_by_hour/dayofweek/month.png\n")

    a("## Q14 Repeat-location patterns")
    for k, v in ctx["repeat"].items():
        if k == "top_repeat_addresses":
            continue
        a(f"- {k}: {v}")
    a("- See `distributions/repeat_locations.png` and `complaints_per_address_hist.png`\n")

    a("## Q15 Demographics")
    a(ctx["demo"]["statement"] + "\n")

    a("## Q16 Linear vs non-linear -> model family")
    a(ctx["linearity_text"] + "\n")

    a("## Q17 Assumption checks that apply")
    for c in ctx["assumption_checks"]:
        a(f"- {c}")
    a("")

    a("## Toronto City Wards GeoJSON")
    g = ctx["ward"]
    a(f"- Features: {g['geojson_feature_count']} | geometry: {g['geometry_type']} | CRS: {g['crs']}")
    a(f"- Property keys: {', '.join(g['geojson_property_keys'])}")
    a(f"- `ward_or_area` distinct values: {g.get('distinct_ward_values','?')} | GeoJSON wards: {g.get('distinct_geojson_wards','?')}")
    a(f"- Match rate (normalized by ward number): **{g.get('match_rate_normalized_by_ward_number','n/a')}%** "
      f"(raw AREA_DESC string match was {g.get('match_rate_vs_AREA_DESC_raw','n/a')}% before fixing '(07)' vs '(7)' zero-padding)")
    a(f"- Unmatched ward values after normalization: {g.get('unmatched_ward_values', [])}")
    a("- **Replacement verdict:** these are REAL Toronto ward polygons; the 311 volumes aggregate into them by name, "
      "so they can drive a real-data Toronto ward workload map (`ward_workload_real.csv` / `.png`), replacing any "
      "synthetic Toronto-ward shading. This is Toronto geography and must NOT be plotted onto Brampton wards.\n")

    p.write_text("\n".join(lines), encoding="utf-8")
    log(f"Wrote {p}")


# --------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", action="store_true", help="Use the 10k sample (plotting iteration only)")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    DIST_DIR.mkdir(parents=True, exist_ok=True)

    src = SAMPLE_CSV if args.sample else FULL_CSV
    if not src.exists():
        raise SystemExit(f"Input not found: {src}")

    df_str = load_full_as_str(src)
    typed = typed_copy(df_str)
    n = len(df_str)

    # A. profile
    profile = column_profile(df_str, typed)
    profile.to_csv(OUT_DIR / "column_profile.csv", index=False)
    profile_md = profile[["column", "inferred_type", "missing_pct", "n_distinct"]].to_markdown(index=False)

    # B. leakage + proxy
    audit = leakage_audit(typed)
    audit.to_csv(OUT_DIR / "leakage_audit.csv", index=False)
    leakage_md = audit[["column", "leakage_type", "evidence_value", "verdict"]].to_markdown(index=False)

    # C. duration
    duration = duration_assessment(typed)

    # D. distributions
    if "complaint_type" in typed:
        save_barh(typed["complaint_type"], "Complaint type distribution (top 20)", "category_complaint_type.png")
    if "ai_category" in typed:
        save_barh(typed["ai_category"], "AI category distribution", "category_ai.png")
    if "status" in typed:
        save_barh(typed["status"], "Status distribution", "status.png")
    if "resolution_status" in typed:
        save_barh(typed["resolution_status"], "Resolution status distribution", "resolution_status.png")
    if "assigned_department" in typed:
        save_barh(typed["assigned_department"], "Assigned department distribution", "department.png")
    if "department_unit" in typed:
        save_barh(typed["department_unit"], "Department unit distribution (top 20)", "department_unit.png")
    time = time_patterns(typed)

    # location coverage
    geo_cov = round(100 * (typed[["latitude", "longitude"]].notna().all(axis=1)).mean(), 2) if "latitude" in typed else 0
    ward_cov = round(100 * typed["ward_or_area"].notna().mean(), 2) if "ward_or_area" in typed else 0
    fsa_cov = round(100 * typed["fsa_or_area"].notna().mean(), 2) if "fsa_or_area" in typed else 0

    # E. repeats
    repeat = repeat_patterns(typed)

    # F. demographics
    demo = demographic_check(list(df_str.columns))

    # G. wards
    gj = load_wards(WARDS_GEOJSON)
    ward = ward_join_and_hotspot(typed, gj)

    # proxy recommendation text (Q7), grounded in measured coverage
    closed_pct = duration.get("closed_at_present_pct", 0)
    proxy_text = (
        "There is **no ready-made workload-risk label**. Assessed proxies:\n\n"
        f"1. **Repeat/volume density (RECOMMENDED)** — complaints aggregated per ward "
        f"({repeat.get('ward_or_area__distinct','?')} wards) and per address "
        f"({repeat.get('address_or_location__distinct','?')} addresses, "
        f"{repeat.get('address_or_location__locations_ge_3','?')} with >=3). Not leaky, fully populated, "
        "maps directly to 'where is enforcement workload concentrated'. This is the recommended target basis.\n"
        f"2. **Resolution duration (days_open)** — `closed_at` present in only **{closed_pct}%** of rows, so "
        "this is " + ("usable but partial." if closed_pct >= 40 else "NOT reliably computable and is rejected as a primary target.") + "\n"
        "3. **Category severity** — depends on `complaint_type` but is circular with the derived `ai_priority`; "
        "use only as a feature, not a target."
    )

    linearity_text = (
        "Predictors are dominated by **high-cardinality categoricals** (complaint_type, department, ward, FSA) "
        "and **spatial coordinates**, where category->rate relationships are non-monotonic and location effects "
        "cluster spatially. Linear/additive assumptions fit poorly; interactions matter. This **justifies "
        "tree-based / gradient-boosting models**, with a linear model kept only as an interpretable baseline. "
        "(Quantify before modeling via mutual information and category-rate plots vs the chosen volume proxy.)"
    )

    assumption_checks = [
        "Leakage audit (deterministic complaint_type -> ai_* / priority mapping) — primary check.",
        "Target-proxy validity and value distribution / class balance.",
        "Categorical cardinality and rare-level/encoding strategy.",
        "Multicollinearity / redundancy (only for the linear baseline).",
        "Missingness mechanism (is closed_at / geo missingness informative?).",
        "Temporal coverage & drift (single-year span?) -> time-aware validation split.",
        "Spatial autocorrelation (repeat-location clustering) -> grouped validation by location/ward.",
        "NOT applicable for trees: residual normality, homoscedasticity, linearity-of-logits.",
    ]

    ctx = dict(
        source_name=src.name,
        n_rows=n,
        n_cols=df_str.shape[1],
        dup_case_id=int(df_str["case_id"].duplicated().sum()) if "case_id" in df_str else 0,
        dup_rows=int(df_str.duplicated().sum()),
        profile_md=profile_md,
        ml_features=[c for c in ["complaint_type", "assigned_department", "department_unit", "source_channel",
                                 "fsa_or_area", "ward_or_area", "latitude", "longitude", "submitted_at(hour/dow/month)"]
                     if c.split("(")[0] in typed.columns],
        leakage_md=leakage_md,
        proxy_text=proxy_text,
        duration=duration,
        n_types=int(typed["complaint_type"].nunique()) if "complaint_type" in typed else 0,
        geo_cov=geo_cov,
        ward_cov=ward_cov,
        fsa_cov=fsa_cov,
        time=time,
        repeat=repeat,
        demo=demo,
        linearity_text=linearity_text,
        assumption_checks=assumption_checks,
        ward=ward,
    )

    # Persist machine-readable summaries too.
    (OUT_DIR / "summary.json").write_text(
        json.dumps(
            {
                "source": src.name,
                "rows": n,
                "columns": df_str.shape[1],
                "duration": duration,
                "demographics": demo,
                "ward_join": ward,
                "location_coverage_pct": {"latlong": geo_cov, "ward": ward_cov, "fsa": fsa_cov},
                "time": time,
                "repeat": {k: v for k, v in repeat.items() if k != "top_repeat_addresses"},
            },
            indent=2,
            default=str,
        ),
        encoding="utf-8",
    )

    (OUT_DIR / "target_proxy_assessment.md").write_text(
        "# Target proxy assessment (workload risk)\n\n" + proxy_text + "\n", encoding="utf-8"
    )

    write_report(ctx)
    log("EDA complete.")


if __name__ == "__main__":
    main()
