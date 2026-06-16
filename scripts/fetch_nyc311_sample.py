"""Fetch the latest 1 year of NYC 311 Open Data via the Socrata API.

Dataset: NYC 311 Service Requests (Socrata id `erm2-nwe9`)
Endpoint: https://data.cityofnewyork.us/resource/erm2-nwe9.json

This pulls a bounded **1-year** window (not the full ~21.5M-row dataset),
preferring closed records with a resolution description so the closure-review
workflow has real outcomes to work with.

Pagination is `$limit` / `$offset` over a stable `$order` (created_date DESC,
unique_key DESC). Anonymous access works but is rate-throttled; set
NYC_OPEN_DATA_APP_TOKEN and it is sent via the `X-App-Token` header to raise the
limit when we add one later.

Examples:
    # latest 1 year, closed + resolution_description present (default)
    python scripts/fetch_nyc311_sample.py

    # a different window / a safety cap on rows
    python scripts/fetch_nyc311_sample.py --since-days 365 --max-rows 500000

Output:
    data/raw/nyc311/nyc311_sample.csv  (or --out)

Only the Python standard library is required.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE_URL = "https://data.cityofnewyork.us/resource/erm2-nwe9.json"

# Only the columns the POC needs.
COLUMNS = [
    "unique_key",
    "created_date",
    "closed_date",
    "agency",
    "agency_name",
    "complaint_type",
    "descriptor",
    "descriptor_2",
    "location_type",
    "status",
    "due_date",
    "resolution_description",
    "resolution_action_updated_date",
    "open_data_channel_type",
    "incident_zip",
    "borough",
    "council_district",
    "latitude",
    "longitude",
    "location",
]

DEFAULT_OUT = Path("data/raw/nyc311/nyc311_sample.csv")


def build_where(cutoff_iso: str, require_closed: bool, require_resolution: bool) -> str:
    clauses = [f"created_date >= '{cutoff_iso}'"]
    if require_closed:
        clauses.append("closed_date IS NOT NULL")
    if require_resolution:
        clauses.append("resolution_description IS NOT NULL")
    return " AND ".join(f"({c})" for c in clauses)


def build_url(where: str, limit: int, offset: int) -> str:
    params = {
        "$select": ",".join(COLUMNS),
        "$where": where,
        # Stable total order so $offset paging does not skip/duplicate on ties.
        "$order": "created_date DESC, unique_key DESC",
        "$limit": limit,
        "$offset": offset,
    }
    return f"{BASE_URL}?{urllib.parse.urlencode(params)}"


def fetch_page(url: str, token: str | None, retries: int = 4) -> list[dict]:
    headers = {"Accept": "application/json"}
    if token:
        headers["X-App-Token"] = token  # optional; used when a token is configured
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            # 429 = throttled. Back off; suggest a token. Retry a few times.
            if err.code == 429:
                wait = 5 * (attempt + 1)
                print(f"  throttled (429); backing off {wait}s "
                      f"(set NYC_OPEN_DATA_APP_TOKEN to raise the limit)", file=sys.stderr)
                time.sleep(wait)
                last_err = err
                continue
            raise
        except Exception as err:  # noqa: BLE001 - retry transient transport errors
            last_err = err
            wait = 2 ** attempt
            print(f"  request failed ({err}); retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"Giving up after {retries} retries: {last_err}")


def fetch(out: Path, where: str, page_size: int, max_rows: int | None, token: str | None) -> int:
    out.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    offset = 0

    with out.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=COLUMNS, extrasaction="ignore")
        writer.writeheader()

        while max_rows is None or written < max_rows:
            this_page = page_size if max_rows is None else min(page_size, max_rows - written)
            page = fetch_page(build_url(where, this_page, offset), token)
            if not page:
                break
            for row in page:
                if isinstance(row.get("location"), (dict, list)):
                    row["location"] = json.dumps(row["location"])
                writer.writerow(row)
            written += len(page)
            offset += len(page)
            print(f"Fetched {written:,} rows (offset={offset:,})")
            if len(page) < this_page:
                break  # reached the end of the 1-year window
            time.sleep(0.2)

    return written


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch the latest 1 year of NYC 311 (limit/offset paging).")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--since-days", type=int, default=365, help="Rolling window size in days (default 365).")
    parser.add_argument("--since", default=None, help="Explicit cutoff date 'YYYY-MM-DD' (overrides --since-days).")
    parser.add_argument("--page-size", type=int, default=50000)
    parser.add_argument("--max-rows", type=int, default=None, help="Optional safety cap on rows.")
    parser.add_argument("--no-require-closed", action="store_true", help="Do not require closed_date.")
    parser.add_argument("--no-require-resolution", action="store_true", help="Do not require resolution_description.")
    args = parser.parse_args()

    if args.since:
        cutoff_date = args.since
    else:
        cutoff_date = (dt.date.today() - dt.timedelta(days=args.since_days)).isoformat()
    cutoff_iso = f"{cutoff_date}T00:00:00"

    where = build_where(cutoff_iso, not args.no_require_closed, not args.no_require_resolution)
    token = os.getenv("NYC_OPEN_DATA_APP_TOKEN")
    print(f"Window: created_date >= {cutoff_iso}")
    print(f"Filter: {where}")
    print("Auth: app token (X-App-Token)" if token else "Auth: anonymous (throttled; set NYC_OPEN_DATA_APP_TOKEN to raise limits)")

    total = fetch(args.out, where, args.page_size, args.max_rows, token)
    print(f"Done. Wrote {total:,} rows to {args.out}")


if __name__ == "__main__":
    main()
