"""Upload normalized NYC 311 records (and closure templates) to Supabase.

CREDENTIALED STEP — run this in a stable environment, not the ephemeral POC
sandbox. It writes to `municipal_complaints`, which requires a Supabase
service-role key (the app's anon key is read-only under RLS).

Environment:
    SUPABASE_URL                 e.g. https://YOUR-ref.supabase.co
    SUPABASE_SERVICE_ROLE_KEY    service-role key (NEVER commit; never VITE_-prefixed)

Inputs:
    data/processed/nyc311_municipal_complaints.csv   (clean_nyc311_service_requests.py)
    data/processed/nyc311_closure_templates.csv      (build_nyc311_closure_templates.py)

For very large loads (millions of rows) prefer a direct Postgres `COPY` over the
REST API. This script batch-upserts via supabase-py, which is fine for samples
and incremental loads.

    pip install supabase
    python scripts/upload_nyc311_to_supabase.py --max-rows 200000
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from pathlib import Path

COMPLAINTS_IN = Path("data/processed/nyc311_municipal_complaints.csv")
TEMPLATES_IN = Path("data/processed/nyc311_closure_templates.csv")
BATCH = 1000


def num(value: str):
    value = (value or "").strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def to_complaint(row: dict) -> dict:
    """Map a normalized NYC row to the municipal_complaints schema.

    The generic app columns are filled from the closest NYC field; the richer NYC
    source fields (added by migration 014) are preserved verbatim.
    """
    return {
        "case_id": row["case_id"],
        "source_city": row.get("source_city") or "NYC",
        "source_dataset": row.get("source_dataset"),
        "source_dataset_id": row.get("source_dataset_id"),
        "source_channel": row.get("channel"),
        "submitted_at": row.get("created_at") or None,
        "created_at": row.get("created_at") or None,
        "closed_at": row.get("closed_at") or None,
        "status": row.get("status"),
        "complaint_type": row.get("request_type"),
        "assigned_department": row.get("agency_name") or row.get("agency"),
        "ward_or_area": row.get("borough"),
        "address_or_location": row.get("incident_zip"),
        "description": row.get("request_detail"),
        "latitude": num(row.get("latitude")),
        "longitude": num(row.get("longitude")),
        # Richer NYC source fields (migration 014_nyc311_rich_fields.sql).
        "agency": row.get("agency"),
        "agency_name": row.get("agency_name"),
        "request_detail": row.get("request_detail"),
        "request_detail_2": row.get("request_detail_2"),
        "location_type": row.get("location_type"),
        "due_date": row.get("due_date") or None,
        "resolution_description": row.get("resolution_description"),
        "resolution_action_updated_at": row.get("resolution_action_updated_at") or None,
        "channel": row.get("channel"),
        "borough": row.get("borough"),
        "council_district": row.get("council_district"),
        "incident_zip": row.get("incident_zip"),
    }


def get_client():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. "
            "This is the credentialed load step — see the script header.",
            file=sys.stderr,
        )
        sys.exit(2)
    try:
        from supabase import create_client  # type: ignore
    except ImportError:
        print("Install the client first: pip install supabase", file=sys.stderr)
        sys.exit(2)
    return create_client(url, key)


def upload_complaints(client, max_rows: int | None) -> int:
    if not COMPLAINTS_IN.exists():
        print(f"Missing {COMPLAINTS_IN}; run clean_nyc311_service_requests.py first.", file=sys.stderr)
        return 0
    sent = 0
    batch: list[dict] = []
    with COMPLAINTS_IN.open("r", newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            batch.append(to_complaint(row))
            if len(batch) >= BATCH:
                client.table("municipal_complaints").upsert(batch, on_conflict="case_id").execute()
                sent += len(batch)
                print(f"  upserted {sent:,} complaints")
                batch = []
            if max_rows is not None and sent + len(batch) >= max_rows:
                break
    if batch:
        client.table("municipal_complaints").upsert(batch, on_conflict="case_id").execute()
        sent += len(batch)
    return sent


def upload_templates(client) -> int:
    if not TEMPLATES_IN.exists():
        return 0
    rows = []
    with TEMPLATES_IN.open("r", newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            rows.append(
                {
                    "complaint_type": r.get("request_type") or "Any",
                    "scenario": r["scenario"],
                    "template_text": r["template_text"],
                    "required_context": r.get("required_context"),
                    "policy_note": r.get("policy_note"),
                }
            )
    if rows:
        client.table("closure_templates").upsert(rows).execute()
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload normalized NYC 311 data to Supabase.")
    parser.add_argument("--max-rows", default=None, help="Optional cap on complaints uploaded.")
    args = parser.parse_args()
    max_rows = int(args.max_rows) if args.max_rows else None

    client = get_client()
    n = upload_complaints(client, max_rows)
    t = upload_templates(client)
    print(f"Done. Upserted {n:,} complaints and {t} closure templates.")


if __name__ == "__main__":
    main()
