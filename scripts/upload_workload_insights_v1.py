"""Upload v1 workload-density model outputs to public.workload_insights_v1.

Reads the local v1 artifacts and prepares one row per location, then UPSERTS
them into the BramptonPOC Supabase project. This is the only path that writes
model outputs to Supabase; it uses the SERVICE ROLE key (server-side only) and
never ships anything to the browser.

SAFETY:
  - DRY RUN by default. It prints what it WOULD upload and exits without any
    network call. Real upload happens only with --upload.
  - Refuses to upload unless SUPABASE_URL points at the correct project
    (must contain 'khvvhkjobukudrmhujvu'). This prevents writing to any other
    Supabase project by accident.
  - The service role key is read from the environment and is NEVER printed.

Environment (only needed for --upload):
  SUPABASE_URL                e.g. https://khvvhkjobukudrmhujvu.supabase.co
  SUPABASE_SERVICE_ROLE_KEY   service_role key (secret; never logged)

Usage:
  python scripts/upload_workload_insights_v1.py            # dry run, no network
  python scripts/upload_workload_insights_v1.py --upload   # upsert to Supabase
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import pandas as pd

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[1]
V1_DIR = REPO_ROOT / "reports" / "modeling" / "v1"
PREVIEW_CSV = V1_DIR / "ai_triage_results_preview.csv"
FEATURE_TABLE_CSV = V1_DIR / "feature_table.csv"

TABLE = "workload_insights_v1"
# The ONLY project this script is allowed to write to.
EXPECTED_PROJECT_REF = "khvvhkjobukudrmhujvu"
# Natural key for the upsert (matches the table's unique constraint).
CONFLICT_KEYS = ["model_version", "scoring_period", "location_unit", "location_id"]

# Provenance constants injected per row (the preview CSV does not carry these).
SOURCE_CITY = "Toronto"
SOURCE_DATASET = "Toronto 311 Customer Initiated Service Requests 2026"

# Columns of public.workload_insights_v1 that this script populates. id and
# created_at are left to their database defaults.
TARGET_COLUMNS = [
    "source_city", "source_dataset", "model", "model_version", "feature_set_version",
    "feature_window", "scoring_period", "location_unit", "location_id",
    "workload_score", "predicted_tier", "prior_complaint_count", "actual_volume",
    "high_workload_area_true", "top_factors", "advisory", "generated_at",
]


def log(msg: str) -> None:
    print(f"[upload-v1] {msg}", flush=True)


# --------------------------------------------------------------------------
# Build rows from the local artifacts
# --------------------------------------------------------------------------
def _to_bool(v) -> bool:
    """Coerce the CSV's 0/1 (or true/false text) into a real boolean."""
    s = str(v).strip().lower()
    return s in {"1", "true", "t", "yes"}


def _top_factors_to_list(v) -> list[str]:
    """The preview stores top_factors as a comma-separated string; turn it into a
    JSON-friendly list of factor names (jsonb array)."""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return []
    text = str(v).strip()
    if not text:
        return []
    return [part.strip() for part in text.split(",") if part.strip()]


def build_rows() -> list[dict]:
    if not PREVIEW_CSV.exists():
        raise SystemExit(f"Missing artifact: {PREVIEW_CSV}")
    if not FEATURE_TABLE_CSV.exists():
        raise SystemExit(f"Missing artifact: {FEATURE_TABLE_CSV}")

    preview = pd.read_csv(PREVIEW_CSV)

    # Join prior_complaint_count by location_id (feature_table is keyed by 'fsa').
    feats = pd.read_csv(FEATURE_TABLE_CSV)
    key = "fsa" if "fsa" in feats.columns else feats.columns[0]
    prior_by_loc = (
        feats.set_index(key)["prior_complaint_count"].to_dict()
        if "prior_complaint_count" in feats.columns
        else {}
    )

    rows: list[dict] = []
    for r in preview.itertuples(index=False):
        d = r._asdict()
        location_id = str(d["location_id"])
        prior = prior_by_loc.get(location_id)
        rows.append(
            {
                "source_city": SOURCE_CITY,
                "source_dataset": SOURCE_DATASET,
                "model": d["model"],
                "model_version": d["model_version"],
                "feature_set_version": d["feature_set_version"],
                "feature_window": d["feature_window"],
                "scoring_period": d["scoring_period"],
                "location_unit": d["location_unit"],
                "location_id": location_id,
                "workload_score": float(d["workload_score"]),
                "predicted_tier": d["predicted_tier"],
                "prior_complaint_count": None if prior is None else int(prior),
                "actual_volume": int(d["april_volume_actual"]),
                "high_workload_area_true": _to_bool(d["high_workload_area_true"]),
                "top_factors": _top_factors_to_list(d["top_factors"]),
                "advisory": d["advisory"],
                "generated_at": d["generated_at"],
            }
        )
    return rows


# --------------------------------------------------------------------------
# Dry run reporting
# --------------------------------------------------------------------------
def print_dry_run(rows: list[dict]) -> None:
    log("DRY RUN — no network call, nothing uploaded.")
    log(f"Target project ref (required in SUPABASE_URL for --upload): {EXPECTED_PROJECT_REF}")
    log(f"Target table: public.{TABLE}")
    log(f"Upsert conflict keys: {CONFLICT_KEYS}")
    log(f"Rows prepared: {len(rows)}")
    log(f"Columns ({len(TARGET_COLUMNS)}): {TARGET_COLUMNS}")
    if rows:
        log("Sample row:")
        print(json.dumps(rows[0], indent=2, default=str))
    log("Re-run with --upload (and SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set) to upsert.")


# --------------------------------------------------------------------------
# Upload (only with --upload)
# --------------------------------------------------------------------------
def upload(rows: list[dict]) -> None:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

    if not url or not key:
        raise SystemExit(
            "Refusing to upload: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both "
            "be set in the environment. (The service role key is never printed.)"
        )
    # Hard guard: only ever write to the correct BramptonPOC project.
    if EXPECTED_PROJECT_REF not in url:
        raise SystemExit(
            f"Refusing to upload: SUPABASE_URL does not contain '{EXPECTED_PROJECT_REF}'. "
            "This script only writes to the BramptonPOC project."
        )

    import requests  # imported lazily so the dry run needs no extra deps

    endpoint = f"{url.rstrip('/')}/rest/v1/{TABLE}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        # Upsert: merge rows that collide on the unique constraint.
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    params = {"on_conflict": ",".join(CONFLICT_KEYS)}

    log(f"Upserting {len(rows)} rows into public.{TABLE} on project {EXPECTED_PROJECT_REF} ...")
    resp = requests.post(endpoint, headers=headers, params=params, json=rows, timeout=60)
    if resp.status_code >= 300:
        # Never echo headers (they contain the key); only status + body text.
        raise SystemExit(f"Upload failed: HTTP {resp.status_code} — {resp.text}")
    log(f"Upload OK (HTTP {resp.status_code}). Upserted {len(rows)} rows.")


# --------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--upload", action="store_true",
                    help="Actually upsert to Supabase. Without this flag the script "
                         "runs a dry run (no network, nothing uploaded).")
    args = ap.parse_args()

    rows = build_rows()

    if not args.upload:
        print_dry_run(rows)
        return

    upload(rows)


if __name__ == "__main__":
    main()
