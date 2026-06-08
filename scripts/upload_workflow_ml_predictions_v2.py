"""Upload full V2 workflow ML predictions to public.workflow_ml_predictions.

Reads reports/modeling/v2/workflow_ml_predictions_full.csv and UPSERTS every row
into the BramptonPOC Supabase project, in batches, using the SERVICE ROLE key
(server-side only; never shipped to the browser, never printed).

SAFETY:
  - DRY RUN by default (no network). Real upload only with --upload.
  - Refuses to upload unless SUPABASE_URL contains 'khvvhkjobukudrmhujvu'.
  - The service role key is read from the environment and is NEVER printed.

Environment (only for --upload):
  SUPABASE_URL                e.g. https://khvvhkjobukudrmhujvu.supabase.co
  SUPABASE_SERVICE_ROLE_KEY   service_role key (secret)

Usage:
  python scripts/upload_workflow_ml_predictions_v2.py            # dry run
  python scripts/upload_workflow_ml_predictions_v2.py --upload   # upsert in batches
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
CSV = REPO_ROOT / "reports" / "modeling" / "v2" / "workflow_ml_predictions_full.csv"

TABLE = "workflow_ml_predictions"
EXPECTED_PROJECT_REF = "khvvhkjobukudrmhujvu"
CONFLICT_KEYS = ["model_version", "prediction_type", "source_row_hash"]
BATCH_SIZE = 1000

COLUMNS = [
    "source_city", "source_dataset", "model_version", "model_name", "prediction_type",
    "source_record_id", "source_row_hash", "complaint_type", "description", "ward_or_area",
    "status", "assigned_department", "predicted_department", "routing_confidence",
    "needs_attention_score", "attention_tier", "attention_rank", "advisory",
]


def log(m: str) -> None:
    print(f"[upload-v2-pred] {m}", flush=True)


def load_rows() -> list[dict]:
    if not CSV.exists():
        raise SystemExit(f"Missing scored file: {CSV}. Run score_workflow_ml_v2_full.py first.")
    df = pd.read_csv(CSV)
    df = df.replace({np.nan: None})
    rows = []
    for r in df[COLUMNS].itertuples(index=False):
        d = dict(zip(COLUMNS, r))
        # numeric coercions / null-safety
        for k in ("routing_confidence", "needs_attention_score"):
            d[k] = None if d[k] is None else float(d[k])
        d["attention_rank"] = None if d["attention_rank"] is None else int(d["attention_rank"])
        rows.append(d)
    return rows


def print_dry_run(rows: list[dict]) -> None:
    log("DRY RUN - no network call, nothing uploaded.")
    log(f"Target project ref (required in SUPABASE_URL for --upload): {EXPECTED_PROJECT_REF}")
    log(f"Target table: public.{TABLE}")
    log(f"Upsert conflict keys: {CONFLICT_KEYS}")
    log(f"Rows prepared: {len(rows):,}  |  batch size: {BATCH_SIZE}  |  batches: {math.ceil(len(rows)/BATCH_SIZE)}")
    log(f"Columns ({len(COLUMNS)}): {COLUMNS}")
    if rows:
        sample = dict(rows[0])
        if sample.get("description"):
            sample["description"] = sample["description"][:60] + "..."
        log("Sample row:")
        print(json.dumps(sample, indent=2, default=str))
    log("Re-run with --upload (and SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set) to upsert.")


def upload(rows: list[dict]) -> None:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise SystemExit("Refusing to upload: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set. "
                         "(The service role key is never printed.)")
    if EXPECTED_PROJECT_REF not in url:
        raise SystemExit(f"Refusing to upload: SUPABASE_URL does not contain '{EXPECTED_PROJECT_REF}'. "
                         "This script only writes to the BramptonPOC project.")

    import requests

    endpoint = f"{url.rstrip('/')}/rest/v1/{TABLE}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    params = {"on_conflict": ",".join(CONFLICT_KEYS)}
    n = len(rows)
    batches = math.ceil(n / BATCH_SIZE)
    log(f"Upserting {n:,} rows into public.{TABLE} on {EXPECTED_PROJECT_REF} in {batches} batches ...")
    for b in range(batches):
        chunk = rows[b * BATCH_SIZE:(b + 1) * BATCH_SIZE]
        resp = requests.post(endpoint, headers=headers, params=params, json=chunk, timeout=120)
        if resp.status_code >= 300:
            raise SystemExit(f"Batch {b+1}/{batches} failed: HTTP {resp.status_code} - {resp.text[:500]}")
        if (b + 1) % 10 == 0 or b + 1 == batches:
            log(f"  ...{b+1}/{batches} batches ({min((b+1)*BATCH_SIZE, n):,} rows)")
    log(f"Upload OK. Upserted {n:,} rows.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--upload", action="store_true",
                    help="Actually upsert to Supabase in batches. Without this flag, dry run only.")
    args = ap.parse_args()
    rows = load_rows()
    if not args.upload:
        print_dry_run(rows)
        return
    upload(rows)


if __name__ == "__main__":
    main()
