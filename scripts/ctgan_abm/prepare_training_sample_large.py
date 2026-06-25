#!/usr/bin/env python3
"""Build a larger engineered CTGAN ABM training sample from a big local NYC file.

Reads (streamed, chunked — never loads the whole file into memory):
    a large cleaned NYC 311 CSV (millions of rows, multi-GB)
Writes:
    data/ctgan_abm/municipal_complaints_training_sample_500k.csv

Uses single-pass reservoir sampling so memory stays O(sample_size), independent
of the source file size. Emits the *exact* engineered schema consumed by
run_ctgan_abm_stress_lab.py (same columns as prepare_training_sample.py).

Stdlib only. Local-only: does not download anything.

The source file lives outside the repo and is machine-specific, so --in is
required (no default path is baked in). Example:

    python scripts/ctgan_abm/prepare_training_sample_large.py \\
        --in "C:/path/to/nyc311_1year_cleaned.csv" --sample-size 500000
"""
from __future__ import annotations

import argparse
import csv
import random
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

# csv fields in the big file can be large (descriptions); raise the limit.
csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

OUTPUT_DIR = Path("data/ctgan_abm")
DEFAULT_OUT = OUTPUT_DIR / "municipal_complaints_training_sample_500k.csv"

OUT_COLUMNS = [
    'case_id', 'submitted_at', 'closed_at', 'status', 'borough', 'council_district',
    'complaint_type', 'agency', 'channel', 'priority', 'request_detail',
    'resolution_description',
    # engineered
    'submitted_day_of_week', 'submitted_hour', 'submitted_month',
    'status_bucket', 'closure_bucket',
    'repeat_pressure_score', 'patrol_intensity_score', 'supervisor_review_likelihood',
]

# Only these raw fields are retained per sampled row (keeps the reservoir small).
KEEP_FIELDS = [
    'case_id', 'submitted_at', 'closed_at', 'status', 'borough', 'council_district',
    'complaint_type', 'agency', 'agency_name', 'channel', 'priority',
    'request_detail', 'descriptor', 'resolution_description',
]

SUPERVISOR_KEYWORDS = ('review', 'supervisor', 'inspect', 'approval')


def parse_dt(s):
    if not s:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
        try:
            return datetime.strptime(s[:19], fmt)
        except Exception:
            continue
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None


def status_bucket(s):
    if not s:
        return 'unknown'
    s = s.lower()
    if 'closed' in s or 'complete' in s:
        return 'closed'
    if 'open' in s:
        return 'open'
    if 'pending' in s or 'assigned' in s or 'in' in s:
        return 'pending'
    return 'other'


def closure_bucket(created, closed):
    if not created or not closed:
        return 'unknown'
    delta = (closed - created).days
    if delta <= 0:
        return 'same_day'
    if delta <= 7:
        return '1_7_days'
    if delta <= 30:
        return '8_30_days'
    return '30_plus_days'


def compact(row: dict) -> dict:
    """Keep only the fields we need, truncating long text to save memory."""
    out = {k: (row.get(k) or '') for k in KEEP_FIELDS}
    rd = (out.get('resolution_description') or '')
    # Pre-flag supervisor likelihood now, then drop the long text to a short marker.
    out['_sup'] = 1 if any(k in rd.lower() for k in SUPERVISOR_KEYWORDS) else 0
    out['resolution_description'] = rd[:120]
    return out


def main():
    parser = argparse.ArgumentParser(
        description='Reservoir-sample a large local NYC 311 CSV into an engineered '
                    'CTGAN ABM training sample.',
        epilog='Example: python scripts/ctgan_abm/prepare_training_sample_large.py '
               '--in "C:/path/to/nyc311_1year_cleaned.csv" --sample-size 500000',
    )
    parser.add_argument('--in', dest='in_path', type=Path, required=True,
                        help='Path to the large local source CSV (required; '
                             'lives outside the repo, so no default is provided).')
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT)
    parser.add_argument('--sample-size', type=int, default=500000)
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()

    if not args.in_path.exists():
        raise FileNotFoundError(f"Source not found: {args.in_path}")

    random.seed(args.seed)
    k = args.sample_size

    reservoir = []
    n = 0
    print(f'Streaming {args.in_path} (reservoir k={k})...')
    with args.in_path.open('r', encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f)
        for row in reader:
            n += 1
            if len(reservoir) < k:
                reservoir.append(compact(row))
            else:
                j = random.randint(0, n - 1)
                if j < k:
                    reservoir[j] = compact(row)
            if n % 500000 == 0:
                print(f'  read {n:,} rows...')

    print(f'Total source rows: {n:,}; sampled: {len(reservoir):,}')
    if not reservoir:
        raise RuntimeError('No rows sampled')

    # Engineered-score frequencies, computed over the sample.
    by_type = Counter((r.get('complaint_type') or 'Unknown') for r in reservoir)
    by_district = Counter((r.get('council_district') or '0') for r in reservoir)
    max_type = max(by_type.values()) if by_type else 1
    max_district = max(by_district.values()) if by_district else 1

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with args.out.open('w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=OUT_COLUMNS)
        writer.writeheader()
        for r in reservoir:
            created = parse_dt(r.get('submitted_at'))
            closed = parse_dt(r.get('closed_at'))
            complaint = r.get('complaint_type') or ''
            district = r.get('council_district') or ''

            writer.writerow({
                'case_id': r.get('case_id') or '',
                'submitted_at': r.get('submitted_at') or '',
                'closed_at': r.get('closed_at') or '',
                'status': r.get('status') or '',
                'borough': r.get('borough') or '',
                'council_district': district,
                'complaint_type': complaint,
                'agency': r.get('agency') or r.get('agency_name') or '',
                'channel': r.get('channel') or '',
                'priority': r.get('priority') or '',
                'request_detail': r.get('request_detail') or r.get('descriptor') or '',
                'resolution_description': r.get('resolution_description') or '',
                'submitted_day_of_week': created.weekday() if created else '',
                'submitted_hour': created.hour if created else '',
                'submitted_month': created.month if created else '',
                'status_bucket': status_bucket(r.get('status')),
                'closure_bucket': closure_bucket(created, closed),
                'repeat_pressure_score': round(by_type.get(complaint, 0) / max_type, 4),
                'patrol_intensity_score': round(by_district.get(district, 0) / max_district, 4),
                'supervisor_review_likelihood': r.get('_sup', 0),
            })

    print(f'Wrote {args.out} ({len(reservoir):,} rows from {n:,} source rows)')


if __name__ == '__main__':
    main()
