"""Clean NYC 311 open data into the Brampton POC municipal service request schema.

Input:
    data/raw/nyc311/nyc311_sample_50000.csv

Output:
    data/processed/municipal_service_requests.csv

The raw data file is intentionally not committed to GitHub. See
`data/raw/nyc311/README.md` for download instructions.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

RAW_PATH = Path("data/raw/nyc311/nyc311_sample_50000.csv")
OUT_PATH = Path("data/processed/municipal_service_requests.csv")

COLUMN_MAP = {
    "Unique Key": "source_id",
    "Created Date": "opened_at",
    "Closed Date": "closed_at",
    "Agency": "agency",
    "Agency Name": "agency_name",
    "Problem (formerly Complaint Type)": "category",
    "Problem Detail (formerly Descriptor)": "subcategory",
    "Additional Details": "issue_detail",
    "Location Type": "location_type",
    "Incident Zip": "postal_code",
    "Incident Address": "address_label",
    "Street Name": "street_name",
    "City": "city",
    "Status": "status",
    "Resolution Description": "closure_text",
    "Community Board": "community_board",
    "Council District": "council_district",
    "Borough": "district",
    "Open Data Channel Type": "channel",
    "Latitude": "latitude",
    "Longitude": "longitude",
}

CATEGORY_SEVERITY = {
    "illegal parking": 15,
    "noise": 15,
    "animal-abuse": 20,
    "consumer complaint": 15,
    "building": 20,
    "plumbing": 20,
    "heat/hot water": 25,
    "water system": 15,
    "dirty condition": 15,
    "sanitation condition": 15,
    "missed collection": 10,
    "derelict vehicles": 20,
    "street condition": 10,
}


def require_columns(df: pd.DataFrame) -> None:
    missing = [column for column in COLUMN_MAP if column not in df.columns]
    if missing:
        joined = ", ".join(missing)
        raise ValueError(f"Input file is missing required columns: {joined}")


def clean_text(value: Any) -> str | None:
    if pd.isna(value):
        return None
    text = str(value).strip()
    return text if text else None


def score_row(row: pd.Series) -> tuple[int, list[str]]:
    score = 20
    drivers: list[str] = ["Base service request priority"]

    days_open = row.get("days_open")
    if pd.notna(days_open):
        days_open_int = int(days_open)
        if days_open_int >= 30:
            score += 25
            drivers.append("Open or unresolved for 30 or more days")
        elif days_open_int >= 14:
            score += 15
            drivers.append("Open or unresolved for 14 or more days")
        elif days_open_int >= 7:
            score += 8
            drivers.append("Open or unresolved for 7 or more days")

    category = str(row.get("category") or "").lower()
    for term, weight in CATEGORY_SEVERITY.items():
        if term in category:
            score += weight
            drivers.append(f"Higher sensitivity category: {row.get('category')}")
            break

    if not bool(row.get("is_closed")):
        score += 15
        drivers.append("Request is not closed")

    if row.get("closure_text") is None:
        score += 5
        drivers.append("No closure or resolution text available")

    final_score = min(max(score, 0), 100)
    return final_score, drivers


def risk_level(score: int) -> str:
    if score >= 80:
        return "Critical"
    if score >= 60:
        return "High"
    if score >= 40:
        return "Medium"
    return "Low"


def recommended_action(level: str) -> str:
    return {
        "Critical": "Supervisor review",
        "High": "Prioritize inspection",
        "Medium": "Monitor and review",
        "Low": "Standard processing",
    }[level]


def main() -> None:
    if not RAW_PATH.exists():
        raise FileNotFoundError(
            f"Raw file not found: {RAW_PATH}. See data/raw/nyc311/README.md for setup instructions."
        )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(RAW_PATH, low_memory=False)
    require_columns(df)

    df = df[list(COLUMN_MAP.keys())].rename(columns=COLUMN_MAP)

    for column in [
        "agency",
        "agency_name",
        "category",
        "subcategory",
        "issue_detail",
        "location_type",
        "postal_code",
        "address_label",
        "street_name",
        "city",
        "status",
        "closure_text",
        "community_board",
        "district",
        "channel",
    ]:
        df[column] = df[column].map(clean_text)

    df["source_city"] = "New York City"
    df["source_dataset"] = "NYC 311 Service Requests from 2020 to Present"

    df["opened_at"] = pd.to_datetime(df["opened_at"], errors="coerce")
    df["closed_at"] = pd.to_datetime(df["closed_at"], errors="coerce")
    df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
    df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")
    df["council_district"] = pd.to_numeric(df["council_district"], errors="coerce").astype("Int64")

    now = pd.Timestamp.now()
    df["days_open"] = (df["closed_at"].fillna(now) - df["opened_at"]).dt.days
    df["days_open"] = df["days_open"].clip(lower=0)
    df["is_closed"] = df["closed_at"].notna()

    df = df.dropna(subset=["source_id", "opened_at", "category", "latitude", "longitude"])
    df["source_id"] = df["source_id"].astype(str)

    scored = df.apply(score_row, axis=1, result_type="expand")
    df["risk_score"] = scored[0]
    df["risk_drivers"] = scored[1].map(lambda values: " | ".join(values))
    df["risk_level"] = df["risk_score"].map(risk_level)
    df["recommended_action"] = df["risk_level"].map(recommended_action)

    ordered_columns = [
        "source_city",
        "source_dataset",
        "source_id",
        "opened_at",
        "closed_at",
        "agency",
        "agency_name",
        "category",
        "subcategory",
        "issue_detail",
        "location_type",
        "postal_code",
        "address_label",
        "street_name",
        "city",
        "status",
        "closure_text",
        "community_board",
        "council_district",
        "district",
        "channel",
        "latitude",
        "longitude",
        "days_open",
        "is_closed",
        "risk_score",
        "risk_level",
        "recommended_action",
        "risk_drivers",
    ]

    df[ordered_columns].to_csv(OUT_PATH, index=False)

    print(f"Rows processed: {len(df):,}")
    print(f"Saved to: {OUT_PATH}")
    print(df[["source_id", "opened_at", "category", "status", "district", "risk_score", "risk_level"]].head())


if __name__ == "__main__":
    main()
