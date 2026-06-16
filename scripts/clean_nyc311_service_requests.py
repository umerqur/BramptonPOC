"""Normalize a raw NYC 311 export into the Brampton compatible workflow schema.

Input:
    data/raw/nyc311/nyc311_sample.csv   (from fetch_nyc311_sample.py)
Output:
    data/processed/nyc311_municipal_complaints.csv

Maps the raw NYC 311 Socrata columns to the normalized schema used by the app's
`municipal_complaints` concept, preserving the richer NYC source fields. The
field-to-workflow mapping is documented in docs/nyc311-benchmark.md.

Standard library only.
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

DEFAULT_IN = Path("data/raw/nyc311/nyc311_sample.csv")
DEFAULT_OUT = Path("data/processed/nyc311_municipal_complaints.csv")

SOURCE_CITY = "NYC"
SOURCE_DATASET = "NYC 311 Service Requests from 2020 to Present"
SOURCE_DATASET_ID = "erm2-nwe9"

# raw NYC column -> normalized column. Order here is the output column order.
FIELD_MAP: list[tuple[str, str]] = [
    ("unique_key", "case_id"),
    ("created_date", "created_at"),
    ("closed_date", "closed_at"),
    ("agency", "agency"),
    ("agency_name", "agency_name"),
    ("complaint_type", "request_type"),
    ("descriptor", "request_detail"),
    ("descriptor_2", "request_detail_2"),
    ("location_type", "location_type"),
    ("status", "status"),
    ("due_date", "due_date"),
    ("resolution_description", "resolution_description"),
    ("resolution_action_updated_date", "resolution_action_updated_at"),
    ("open_data_channel_type", "channel"),
    ("borough", "borough"),
    ("council_district", "council_district"),
    ("incident_zip", "incident_zip"),
    ("latitude", "latitude"),
    ("longitude", "longitude"),
]

# Constant provenance columns appended to every row.
CONSTANT_COLUMNS = {
    "source_city": SOURCE_CITY,
    "source_dataset": SOURCE_DATASET,
    "source_dataset_id": SOURCE_DATASET_ID,
}

OUTPUT_COLUMNS = [dst for _, dst in FIELD_MAP] + list(CONSTANT_COLUMNS.keys())


def clean(value: str | None) -> str:
    return (value or "").strip()


def normalize(in_path: Path, out_path: Path) -> tuple[int, int]:
    if not in_path.exists():
        raise FileNotFoundError(f"Raw file not found: {in_path}. Run scripts/fetch_nyc311_sample.py first.")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    read = 0
    written = 0
    with in_path.open("r", newline="", encoding="utf-8") as src, out_path.open(
        "w", newline="", encoding="utf-8"
    ) as dst:
        reader = csv.DictReader(src)
        writer = csv.DictWriter(dst, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        for raw in reader:
            read += 1
            case_id = clean(raw.get("unique_key"))
            if not case_id:
                continue  # a row with no stable id is not usable
            row = {dst_col: clean(raw.get(src_col)) for src_col, dst_col in FIELD_MAP}
            row.update(CONSTANT_COLUMNS)
            writer.writerow(row)
            written += 1
    return read, written


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize NYC 311 into the Brampton compatible schema.")
    parser.add_argument("--in", dest="in_path", type=Path, default=DEFAULT_IN)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    read, written = normalize(args.in_path, args.out)
    print(f"Read {read:,} raw rows; wrote {written:,} normalized rows to {args.out}")
    print(f"source_city={SOURCE_CITY} source_dataset_id={SOURCE_DATASET_ID}")


if __name__ == "__main__":
    main()
