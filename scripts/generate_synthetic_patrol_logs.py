#!/usr/bin/env python3
"""Generate SYNTHETIC, case-linked + officer-linked patrol logs from the NYC 311
benchmark cases, for public.synthetic_patrol_logs (see migration 032).

WHAT THIS IS
------------
The NYC 311 public benchmark (public.municipal_complaints) is a set of real
service-request *cases*. This script converts a sample of those cases into a
synthetic *field-activity workload* layer: each case gets a short lifecycle of
patrol activities, each activity is assigned to a synthetic officer unit, and
each activity consumes estimated minutes. That turns "complaint records" into
"operational workload" that a Stress Testing / Simulation Lab tab can aggregate
(workload by officer unit, district, closure bucket, complaint type).

These rows are SYNTHETIC and clearly labelled as such. They are NOT Brampton
operational data and NOT real patrol or enforcement activity.

SAFETY
------
* This script NEVER connects to or writes to Supabase. It reads a local CSV
  export of benchmark cases and writes a local CSV (and optionally a loader.sql
  that a human can run). Loading into the database is a separate, manual step.
* Generation is DETERMINISTIC: re-running with the same --seed and the same
  input produces identical output. Officer assignment is keyed off a stable
  hash of case_id, not pure randomness.

INPUT
-----
A CSV export of benchmark cases. Required (case-insensitive) columns, with
fallbacks in parentheses:
    case_id          (source_id, source_dataset_id)
    complaint_type   (category)
    borough
    council_district
    status
    submitted_at     (opened_at)
    closed_at
    agency
    source_channel   (channel)

Export example (run in your SQL console, NOT by this script). NOTE: the frontend
reads public.municipal_complaints; an earlier brief called this table
"municipal_service_requests" — point --input at whichever export actually holds
the NYC benchmark cases:

    \\copy (
      select case_id, complaint_type, borough, council_district, status,
             submitted_at, closed_at, agency, channel as source_channel
      from public.municipal_complaints
      where submitted_at is not null
    ) to 'benchmark_cases.csv' csv header;

OUTPUT
------
* --out-csv : synthetic_patrol_logs.csv, columns matching the table (no id /
  created_at is emitted with a constant run timestamp; id uses the DB default).
* --out-sql : optional loader.sql with a \\copy command + the validation queries.
* Validation summary is always printed to stdout.

USAGE
-----
    python3 scripts/generate_synthetic_patrol_logs.py --input benchmark_cases.csv
    python3 scripts/generate_synthetic_patrol_logs.py --self-test     # no input needed
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import random
import sys
from collections import Counter, defaultdict
from typing import Iterable, Iterator, Optional

# --- Configuration ---------------------------------------------------------

# Output column order (matches migration 032; id + created_at handled by DB or
# emitted as a constant run timestamp).
OUTPUT_COLUMNS = [
    "case_id",
    "log_sequence",
    "activity_at",
    "patrol_activity_type",
    "patrol_status",
    "officer_unit",
    "officer_zone",
    "assigned_shift",
    "estimated_minutes",
    "district_or_area",
    "complaint_type",
    "closure_bucket",
    "patrol_intensity_score",
    "supervisor_review_required",
    "outcome_summary",
    "recommended_next_step",
    "created_at",
]

# Lifecycle stages, in order. A case uses a prefix of this list (closed cases
# may reach the closing stages; open cases stop before them).
LIFECYCLE = [
    "initial review",
    "site visit scheduled",
    "field inspection completed",
    "notice or warning issued",
    "follow up inspection required",
    "supervisor review queued",
    "closure review prepared",
    "case closed after review",
]
CLOSING_STAGES = {"closure review prepared", "case closed after review"}

# Baseline minutes consumed per activity type (jittered +/-20% per case).
STAGE_MINUTES = {
    "initial review": 15,
    "site visit scheduled": 10,
    "field inspection completed": 45,
    "notice or warning issued": 30,
    "follow up inspection required": 40,
    "supervisor review queued": 20,
    "closure review prepared": 25,
    "case closed after review": 15,
}

# Resident-safe, decision-support narrative per stage. No real enforcement,
# fines, or personal detail.
STAGE_OUTCOME = {
    "initial review": "Request triaged and queued for field assessment.",
    "site visit scheduled": "A site visit was scheduled to assess the reported condition.",
    "field inspection completed": "An officer attended the location and recorded the observed condition.",
    "notice or warning issued": "A notice or warning was prepared for staff review of the observed condition.",
    "follow up inspection required": "A follow-up inspection was flagged to confirm whether the condition was resolved.",
    "supervisor review queued": "The file was queued for supervisor review before any closure decision.",
    "closure review prepared": "A closure review summary was prepared for staff approval.",
    "case closed after review": "Staff completed their review of the file for this benchmark case.",
}
STAGE_NEXT = {
    "initial review": "Assign to the appropriate unit and schedule a field assessment.",
    "site visit scheduled": "Complete the scheduled field inspection.",
    "field inspection completed": "Determine whether a notice or follow-up is needed.",
    "notice or warning issued": "Schedule a follow-up inspection to confirm compliance.",
    "follow up inspection required": "Re-inspect and record whether the condition is resolved.",
    "supervisor review queued": "Supervisor to review the file before closure.",
    "closure review prepared": "Staff to approve the closure summary before any resident update.",
    "case closed after review": "No further action; retained for benchmark reporting.",
}

# Specialty service lines (citywide units). Geographic by-law work falls through
# to the directional BYLAW units below.
SPECIALTY_UNITS = {
    "PROPERTY STANDARDS": "PROPERTY STANDARDS 01",
    "PARKS": "PARKS 01",
    "TRAFFIC": "TRAFFIC 01",
}

# Directional by-law units. Each direction has a 01 and 02 unit; a stable
# case_id hash spreads load across them.
BYLAW_DIRECTIONS = ["NORTH", "CENTRAL", "EAST", "WEST"]

# NYC borough -> directional zone (illustrative for the Brampton POC).
BOROUGH_DIRECTION = {
    "BRONX": "NORTH",
    "MANHATTAN": "CENTRAL",
    "QUEENS": "EAST",
    "BROOKLYN": "WEST",
    "STATEN ISLAND": "WEST",
}


# --- Helpers ---------------------------------------------------------------

def stable_seed(case_id: str, global_seed: int) -> int:
    """Deterministic per-case seed from case_id + global seed."""
    h = hashlib.sha256(f"{global_seed}:{case_id}".encode("utf-8")).hexdigest()
    return int(h[:16], 16)


def pick(values: list[str], case_id: str, salt: str) -> str:
    """Stable choice from a list, keyed by case_id + salt (no RNG state)."""
    h = hashlib.sha256(f"{salt}:{case_id}".encode("utf-8")).hexdigest()
    return values[int(h[:8], 16) % len(values)]


def service_line(complaint_type: str) -> Optional[str]:
    """Map a complaint type to a specialty service line, or None for geographic.

    Parking is deliberately NOT a specialty line: parking enforcement is
    geographic by-law work ("everything else"), so it must fall through to a
    BYLAW unit and must not be caught by the PARKS "park" keyword.
    """
    t = (complaint_type or "").lower()
    is_parking = "parking" in t
    if not is_parking and any(
        k in t for k in ("tree", "park", "trail", "flowerbed", "hanging basket", "sod", "grass")
    ):
        return "PARKS"
    if not is_parking and any(k in t for k in ("speed", "traffic calming", "traffic sign", "sign", "signal")):
        return "TRAFFIC"
    if any(
        k in t
        for k in (
            "property", "refuse", "garbage", "lawn", "overgrow", "prohibited plant",
            "rental", "housing", "apartment", "structure", "standards", "stagnant",
            "container",
        )
    ):
        return "PROPERTY STANDARDS"
    return None


def assign_unit(complaint_type: str, direction: str, case_id: str) -> str:
    """Deterministic officer-unit assignment (not pure random)."""
    line = service_line(complaint_type)
    if line:
        return SPECIALTY_UNITS[line]
    # Geographic by-law work: spread across the 01/02 unit by a stable hash.
    n = "01" if int(hashlib.sha256(f"unit:{case_id}".encode()).hexdigest()[:8], 16) % 2 == 0 else "02"
    return f"BYLAW {direction} {n}"


def direction_for(borough: str, council_district: str, case_id: str) -> str:
    b = (borough or "").strip().upper()
    if b in BOROUGH_DIRECTION:
        return BOROUGH_DIRECTION[b]
    key = (council_district or borough or case_id) or case_id
    return pick(BYLAW_DIRECTIONS, str(key), "direction")


def parse_ts(value: str) -> Optional[dt.datetime]:
    if not value:
        return None
    v = value.strip().replace("Z", "+00:00")
    for fmt in (None,):  # try fromisoformat first
        try:
            d = dt.datetime.fromisoformat(v)
            if d.tzinfo is None:
                d = d.replace(tzinfo=dt.timezone.utc)
            return d
        except ValueError:
            break
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%m/%d/%Y %H:%M:%S", "%m/%d/%Y"):
        try:
            d = dt.datetime.strptime(v, fmt)
            return d.replace(tzinfo=dt.timezone.utc)
        except ValueError:
            continue
    return None


def closure_bucket(age_days: Optional[float]) -> str:
    if age_days is None:
        return "Unknown"
    if age_days <= 1:
        return "Within 1 day"
    if age_days <= 3:
        return "1-3 days"
    if age_days <= 14:
        return "4-14 days"
    if age_days <= 30:
        return "15-30 days"
    if age_days <= 90:
        return "1-3 months"
    return "3+ months"


def n_stages_for(bucket: str, is_closed: bool, rng: random.Random) -> int:
    """Number of lifecycle stages; longer-running cases get more follow-up."""
    ranges = {
        "Within 1 day": (2, 3),
        "1-3 days": (2, 3),
        "4-14 days": (3, 4),
        "15-30 days": (4, 5),
        "1-3 months": (5, 6),
        "3+ months": (6, 8),
        "Unknown": (3, 4),
    }
    lo, hi = ranges.get(bucket, (3, 4))
    n = rng.randint(lo, hi)
    return max(1, min(n, len(LIFECYCLE)))


def shift_for(activity_at: dt.datetime) -> str:
    if activity_at.weekday() >= 5:
        return "Weekend"
    if 7 <= activity_at.hour < 15:
        return "Day (07:00-15:00)"
    if 15 <= activity_at.hour < 23:
        return "Evening (15:00-23:00)"
    return "Overnight (23:00-07:00)"


# --- Core generation -------------------------------------------------------

def logs_for_case(row: dict[str, str], now: dt.datetime, global_seed: int) -> list[dict]:
    case_id = (row.get("case_id") or row.get("source_id") or row.get("source_dataset_id") or "").strip()
    if not case_id:
        return []
    complaint_type = (row.get("complaint_type") or row.get("category") or "").strip()
    borough = (row.get("borough") or "").strip()
    council_district = (row.get("council_district") or "").strip()
    status = (row.get("status") or "").strip()
    submitted = parse_ts(row.get("submitted_at") or row.get("opened_at") or "")
    closed = parse_ts(row.get("closed_at") or "")
    if submitted is None:
        return []

    is_closed = closed is not None or status.lower() in ("closed", "resolved", "completed")
    end = closed if (is_closed and closed is not None and closed > submitted) else now
    if end <= submitted:
        end = submitted + dt.timedelta(hours=6)

    age_days = (end - submitted).total_seconds() / 86400.0
    bucket = closure_bucket(age_days)
    district_or_area = (
        f"District {council_district}" if council_district else (borough or "Unknown")
    )
    direction = direction_for(borough, council_district, case_id)
    officer_unit = assign_unit(complaint_type, direction, case_id)
    officer_zone = "CITYWIDE" if service_line(complaint_type) else f"{direction} ZONE"

    rng = random.Random(stable_seed(case_id, global_seed))
    n = n_stages_for(bucket, is_closed, rng)

    # Choose the stage list: closed cases may include closing stages; open cases
    # stop before them.
    stages = LIFECYCLE[:n]
    if not is_closed:
        stages = [s for s in stages if s not in CLOSING_STAGES] or LIFECYCLE[:1]

    # Monotonic timestamps strictly within (submitted, end].
    span = (end - submitted).total_seconds()
    fracs = sorted(rng.uniform(0.02, 0.98) for _ in stages)
    intensity = round(min(1.0, len(stages) / len(LIFECYCLE) + (0.15 if "follow up inspection required" in stages else 0.0)), 3)
    supervisor = ("supervisor review queued" in stages) or bucket in ("1-3 months", "3+ months")

    out: list[dict] = []
    for i, stage in enumerate(stages, start=1):
        activity_at = submitted + dt.timedelta(seconds=span * fracs[i - 1])
        base = STAGE_MINUTES.get(stage, 20)
        minutes = max(5, int(round(base * rng.uniform(0.8, 1.2))))
        last = i == len(stages)
        if is_closed:
            pstatus = "Completed"
        else:
            pstatus = "In progress" if last else "Completed"
        out.append(
            {
                "case_id": case_id,
                "log_sequence": i,
                "activity_at": activity_at.isoformat(),
                "patrol_activity_type": stage,
                "patrol_status": pstatus,
                "officer_unit": officer_unit,
                "officer_zone": officer_zone,
                "assigned_shift": shift_for(activity_at),
                "estimated_minutes": minutes,
                "district_or_area": district_or_area,
                "complaint_type": complaint_type or None,
                "closure_bucket": bucket,
                "patrol_intensity_score": intensity,
                "supervisor_review_required": bool(supervisor),
                "outcome_summary": STAGE_OUTCOME.get(stage),
                "recommended_next_step": STAGE_NEXT.get(stage),
                "created_at": now.isoformat(),
            }
        )
    return out


def sampled_rows(reader: Iterable[dict], sample_cases: int, seed: int, limit_scan: Optional[int]) -> list[dict]:
    """Reservoir-sample up to sample_cases input rows deterministically."""
    rng = random.Random(seed)
    reservoir: list[dict] = []
    for idx, row in enumerate(reader):
        if limit_scan is not None and idx >= limit_scan:
            break
        if len(reservoir) < sample_cases:
            reservoir.append(row)
        else:
            j = rng.randint(0, idx)
            if j < sample_cases:
                reservoir[j] = row
    return reservoir


def generate(rows: list[dict], max_rows: int, global_seed: int, now: Optional[dt.datetime] = None) -> Iterator[dict]:
    # `now` is injectable so a run is reproducible (open-case timestamps and
    # created_at are bounded by it). Real runs default to the current UTC time.
    if now is None:
        now = dt.datetime.now(dt.timezone.utc)
    emitted = 0
    # Stable order so output is reproducible regardless of sampling order.
    for row in sorted(rows, key=lambda r: (r.get("case_id") or r.get("source_id") or "")):
        for log in logs_for_case(row, now, global_seed):
            if emitted >= max_rows:
                return
            emitted += 1
            yield log


# --- Validation ------------------------------------------------------------

def print_validation(logs: list[dict]) -> None:
    total = len(logs)
    cases = {l["case_id"] for l in logs}
    by_type = Counter(l["complaint_type"] or "Uncategorized" for l in logs)
    by_district = Counter(l["district_or_area"] for l in logs)
    by_unit = Counter(l["officer_unit"] for l in logs)
    by_bucket = Counter(l["closure_bucket"] for l in logs)
    by_activity = Counter(l["patrol_activity_type"] for l in logs)
    minutes_by_unit: dict[str, list[int]] = defaultdict(list)
    for l in logs:
        minutes_by_unit[l["officer_unit"]].append(int(l["estimated_minutes"]))
    supervisor = sum(1 for l in logs if l["supervisor_review_required"])

    def show(title: str, counter: Counter, n: int = 12) -> None:
        print(f"\n{title}")
        for k, v in counter.most_common(n):
            print(f"  {v:>10,}  {k}")

    print("\n================ VALIDATION ================")
    print(f"total logs                : {total:,}")
    print(f"distinct cases with logs  : {len(cases):,}")
    print(f"average logs per case     : {total / len(cases):.2f}" if cases else "average logs per case     : 0")
    print(f"supervisor_review_required: {supervisor:,}  ({(supervisor / total * 100 if total else 0):.1f}%)")
    show("logs by complaint_type:", by_type)
    show("logs by district_or_area:", by_district)
    show("logs by officer_unit:", by_unit)
    show("logs by closure_bucket:", by_bucket)
    show("logs by patrol_activity_type:", by_activity)
    print("\navg estimated_minutes per officer_unit:")
    for unit in sorted(minutes_by_unit):
        vals = minutes_by_unit[unit]
        print(f"  {sum(vals) / len(vals):>7.1f} min   ({sum(vals):>10,} total)  {unit}")
    print("============================================\n")


VALIDATION_SQL = """-- Validation queries for public.synthetic_patrol_logs (run after loading).
select count(*) as total_logs,
       count(distinct case_id) as distinct_cases_with_logs,
       round(count(*)::numeric / nullif(count(distinct case_id), 0), 2) as avg_logs_per_case,
       count(*) filter (where supervisor_review_required) as supervisor_review_count
from public.synthetic_patrol_logs;

select complaint_type, count(*) from public.synthetic_patrol_logs group by 1 order by 2 desc;
select district_or_area, count(*) from public.synthetic_patrol_logs group by 1 order by 2 desc;
select officer_unit, count(*), round(avg(estimated_minutes)::numeric,1) as avg_minutes
  from public.synthetic_patrol_logs group by 1 order by 2 desc;
select closure_bucket, count(*) from public.synthetic_patrol_logs group by 1 order by 2 desc;
select patrol_activity_type, count(*) from public.synthetic_patrol_logs group by 1 order by 2 desc;
"""


def write_loader_sql(path: str, csv_path: str) -> None:
    cols = ", ".join(c for c in OUTPUT_COLUMNS)
    with open(path, "w", encoding="utf-8") as f:
        f.write("-- Loader for synthetic_patrol_logs (run manually; this script never writes to Supabase).\n")
        f.write(f"\\copy public.synthetic_patrol_logs ({cols}) from '{csv_path}' csv header;\n\n")
        f.write(VALIDATION_SQL)


# --- Self-test -------------------------------------------------------------

def synthetic_input(n: int, seed: int) -> list[dict]:
    """Build a small in-memory benchmark sample to exercise the pipeline. This is
    a CODE SELF-TEST ONLY — not for seeding the database."""
    rng = random.Random(seed)
    types = [
        "Illegal Parking", "Damaged Tree", "Noise", "Property Maintenance",
        "Speeding", "Graffiti", "Sidewalk Condition", "Rodent", "Street Sign",
        "Overgrown Lawn", "Dumping", "Flowerbed",
    ]
    boroughs = list(BOROUGH_DIRECTION.keys())
    base = dt.datetime(2024, 1, 1, tzinfo=dt.timezone.utc)
    rows = []
    for i in range(n):
        submitted = base + dt.timedelta(days=rng.randint(0, 600), hours=rng.randint(0, 23))
        is_closed = rng.random() < 0.7
        closed = submitted + dt.timedelta(days=rng.randint(1, 120)) if is_closed else None
        rows.append({
            "case_id": f"SELFTEST-{i:07d}",
            "complaint_type": rng.choice(types),
            "borough": rng.choice(boroughs),
            "council_district": str(rng.randint(1, 51)),
            "status": "Closed" if is_closed else "Open",
            "submitted_at": submitted.isoformat(),
            "closed_at": closed.isoformat() if closed else "",
            "source_channel": rng.choice(["PHONE", "ONLINE", "MOBILE"]),
            "agency": "DEMO",
        })
    return rows


def run_self_test(seed: int) -> int:
    print("Running self-test (in-memory synthetic input; NOT for seeding)...")
    rows = synthetic_input(2000, seed)
    fixed_now = dt.datetime(2026, 6, 23, tzinfo=dt.timezone.utc)
    logs = list(generate(rows, max_rows=10_000_000, global_seed=seed, now=fixed_now))

    # Invariants.
    assert logs, "expected logs"
    # Determinism: regenerate with the same pinned `now` and compare.
    logs2 = list(generate(rows, max_rows=10_000_000, global_seed=seed, now=fixed_now))
    assert logs == logs2, "generation must be deterministic"
    by_case: dict[str, list[dict]] = defaultdict(list)
    for l in logs:
        by_case[l["case_id"]].append(l)
    src = {r["case_id"]: r for r in rows}
    for cid, group in by_case.items():
        seqs = [g["log_sequence"] for g in group]
        assert seqs == list(range(1, len(group) + 1)), f"log_sequence not 1..N for {cid}"
        submitted = parse_ts(src[cid]["submitted_at"])
        closed = parse_ts(src[cid]["closed_at"])
        ts = [parse_ts(g["activity_at"]) for g in group]
        assert ts == sorted(ts), f"activity_at not monotonic for {cid}"
        for t in ts:
            assert t >= submitted, f"activity_at before submitted_at for {cid}"
            if closed is not None and closed > submitted:
                assert t <= closed + dt.timedelta(seconds=1), f"closed case activity after closed_at for {cid}"
    print(f"  OK: {len(logs):,} logs across {len(by_case):,} cases; invariants hold.")
    print_validation(logs)
    print("Self-test PASSED.")
    return 0


# --- CLI -------------------------------------------------------------------

def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", help="CSV export of benchmark cases")
    ap.add_argument("--out-csv", default="synthetic_patrol_logs.csv", help="output CSV path")
    ap.add_argument("--out-sql", help="optional loader.sql path (\\copy + validation SQL)")
    ap.add_argument("--sample-cases", type=int, default=200_000, help="number of cases to sample (default 200000)")
    ap.add_argument("--max-rows", type=int, default=800_000, help="soft cap on generated rows (default 800000)")
    ap.add_argument("--seed", type=int, default=42, help="global RNG seed (deterministic output)")
    ap.add_argument("--limit-scan", type=int, help="cap input rows scanned (for quick tests)")
    ap.add_argument("--self-test", action="store_true", help="run an in-memory self-test (no input needed)")
    args = ap.parse_args(argv)

    if args.self_test:
        return run_self_test(args.seed)

    if not args.input:
        ap.error("--input is required (or use --self-test)")

    print(f"Reading benchmark cases from {args.input} ...")
    with open(args.input, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        # Normalize header keys to lowercase for tolerant column matching.
        norm = ({(k or "").strip().lower(): v for k, v in row.items()} for row in reader)
        rows = sampled_rows(norm, args.sample_cases, args.seed, args.limit_scan)
    print(f"Sampled {len(rows):,} cases. Generating logs (max {args.max_rows:,})...")

    logs = list(generate(rows, args.max_rows, args.seed))

    with open(args.out_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        for log in logs:
            writer.writerow(log)
    print(f"Wrote {len(logs):,} rows to {args.out_csv}")

    if args.out_sql:
        write_loader_sql(args.out_sql, args.out_csv)
        print(f"Wrote loader + validation SQL to {args.out_sql}")

    print_validation(logs)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
