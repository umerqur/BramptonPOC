"""Fetch a reproducible NYC 311 Open Data sample via the Socrata API.

Dataset: NYC 311 Service Requests (Socrata id `erm2-nwe9`)
Endpoint: https://data.cityofnewyork.us/resource/erm2-nwe9.json

This uses KEYSET pagination on `unique_key` (not deep `$offset`, which Socrata
degrades badly on past a few hundred thousand rows), so it scales from a small
sample to the full ~20.5M filtered rows and is restartable.

Anonymous access works but is rate-throttled. Set NYC_OPEN_DATA_APP_TOKEN to
raise the limit for large pulls.

Examples:
    # 200k controlled sample (default)
    python scripts/fetch_nyc311_sample.py

    # a bigger slice
    python scripts/fetch_nyc311_sample.py --max-rows 1000000

    # the entire filtered dataset (long-running; use an app token)
    python scripts/fetch_nyc311_sample.py --max-rows all

Output:
    data/raw/nyc311/nyc311_sample.csv  (or --out)

Reproducible: same filter + same --max-rows + ascending key order reproduces the
same controlled slice. Only the Python standard library is required.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE_URL = "https://data.cityofnewyork.us/resource/erm2-nwe9.json"

# Raw Socrata columns we request (matches the dataset's field names).
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

# Prefer records that exercise the closure workflow: a real close date and a
# resolution description we can mine for rule-based closure scenarios.
DEFAULT_WHERE = "closed_date IS NOT NULL AND resolution_description IS NOT NULL"

DEFAULT_OUT = Path("data/raw/nyc311/nyc311_sample.csv")


def build_url(where: str, page_size: int, last_key: str | None) -> str:
    # Keyset pagination: order by unique_key ascending and ask only for rows with
    # a key strictly greater than the last one we saw. unique_key is treated as
    # text by Socrata, so we quote it; text order is self-consistent between the
    # $order and the $where, which is all keyset pagination needs.
    clauses = [where]
    if last_key is not None:
        safe = last_key.replace("'", "''")
        clauses.append(f"unique_key > '{safe}'")
    params = {
        "$select": ",".join(COLUMNS),
        "$where": " AND ".join(f"({c})" for c in clauses),
        "$order": "unique_key",
        "$limit": page_size,
    }
    return f"{BASE_URL}?{urllib.parse.urlencode(params)}"


def fetch_page(url: str, token: str | None, retries: int = 4) -> list[dict]:
    headers = {"Accept": "application/json"}
    if token:
        headers["X-App-Token"] = token
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as err:  # noqa: BLE001 - retry on any transport error
            last_err = err
            wait = 2 ** attempt
            print(f"  request failed ({err}); retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"Giving up after {retries} retries: {last_err}")


def fetch(out: Path, where: str, max_rows: int | None, page_size: int, token: str | None) -> int:
    out.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    last_key: str | None = None

    with out.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=COLUMNS, extrasaction="ignore")
        writer.writeheader()

        while max_rows is None or written < max_rows:
            this_page = page_size
            if max_rows is not None:
                this_page = min(page_size, max_rows - written)
            url = build_url(where, this_page, last_key)
            page = fetch_page(url, token)
            if not page:
                break
            for row in page:
                # location is a nested dict; flatten to a JSON string so the CSV
                # stays one cell. Everything else is already scalar.
                if isinstance(row.get("location"), (dict, list)):
                    row["location"] = json.dumps(row["location"])
                writer.writerow(row)
            written += len(page)
            last_key = page[-1].get("unique_key")
            print(f"Fetched {written:,} rows (last unique_key={last_key})")
            if len(page) < this_page:
                break  # reached the end of the dataset
            time.sleep(0.2)

    return written


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch a reproducible NYC 311 sample from Socrata.")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--where", default=DEFAULT_WHERE, help="SoQL $where filter")
    parser.add_argument(
        "--max-rows",
        default="200000",
        help="Row cap, or 'all' for the entire filtered dataset (long-running).",
    )
    parser.add_argument("--page-size", type=int, default=50000)
    args = parser.parse_args()

    max_rows = None if str(args.max_rows).lower() == "all" else int(args.max_rows)
    token = os.getenv("NYC_OPEN_DATA_APP_TOKEN")
    if not token:
        print("No NYC_OPEN_DATA_APP_TOKEN set — using anonymous (throttled) access.", file=sys.stderr)

    total = fetch(args.out, args.where, max_rows, args.page_size, token)
    print(f"Done. Wrote {total:,} rows to {args.out}")


if __name__ == "__main__":
    main()
