#!/usr/bin/env python3
"""Prepare CTGAN training sample from normalized municipal complaints.

Reads: data/processed/nyc311_municipal_complaints.csv
Writes: data/ctgan_abm/municipal_complaints_training_sample.csv

Default sample size: 100000 (configurable).
Uses stdlib only.
"""
from __future__ import annotations

import argparse
import csv
import os
import random
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

INPUT = Path("data/processed/nyc311_municipal_complaints.csv")
OUTPUT_DIR = Path("data/ctgan_abm")
OUTPUT = OUTPUT_DIR / "municipal_complaints_training_sample.csv"

# Columns to output
OUT_COLUMNS = [
    'case_id',
    'submitted_at',
    'closed_at',
    'status',
    'borough',
    'council_district',
    'complaint_type',
    'agency',
    'channel',
    'priority',
    'request_detail',
    'resolution_description',
    # engineered
    'submitted_day_of_week',
    'submitted_hour',
    'submitted_month',
    'status_bucket',
    'closure_bucket',
    'repeat_pressure_score',
    'patrol_intensity_score',
    'supervisor_review_likelihood',
]


def parse_dt(s: str | None):
    if not s:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
        try:
            return datetime.strptime(s[:19], fmt)
        except Exception:
            continue
    # last resort: try fromisoformat
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None


def status_bucket(s: str | None):
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sample-size', type=int, default=100000)
    parser.add_argument('--in', dest='in_path', type=Path, default=INPUT)
    parser.add_argument('--out', type=Path, default=OUTPUT)
    args = parser.parse_args()

    if not args.in_path.exists():
        raise FileNotFoundError(f"Processed input not found: {args.in_path}. Run scripts/clean_nyc311_service_requests.py first.")

    rows = []
    with args.in_path.open('r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for r in reader:
            rows.append(r)

    n = len(rows)
    if n == 0:
        raise RuntimeError('No rows in processed file')

    sample_size = min(args.sample_size, n)
    sampled = random.sample(rows, sample_size)

    # Compute frequencies for engineered scores
    by_type = Counter(r.get('request_type') or 'Unknown' for r in sampled)
    by_district = Counter(r.get('council_district') or '0' for r in sampled)

    # normalize functions
    max_type = max(by_type.values()) if by_type else 1
    max_district = max(by_district.values()) if by_district else 1

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    with args.out.open('w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=OUT_COLUMNS)
        writer.writeheader()
        for r in sampled:
            created = parse_dt(r.get('created_at') or r.get('created_date') or r.get('created_at'))
            closed = parse_dt(r.get('closed_at') or r.get('closed_date') or r.get('closed_at'))

            complaint = r.get('request_type') or r.get('complaint_type') or ''
            district = r.get('council_district') or ''

            submitted_day = created.weekday() if created else ''
            submitted_hour = created.hour if created else ''
            submitted_month = created.month if created else ''

            status = r.get('status') or ''

            # engineered
            sb = status_bucket(status)
            cb = closure_bucket(created, closed)
            repeat_pressure = round((by_type.get(complaint, 0) / max_type), 4)
            patrol_intensity = round((by_district.get(district, 0) / max_district), 4)
            res_desc = (r.get('resolution_description') or '').lower()
            supervisor_likelihood = 1 if any(k in res_desc for k in ('review', 'supervisor', 'inspect', 'approval')) else 0

            out = {
                'case_id': r.get('case_id') or r.get('unique_key') or '',
                'submitted_at': r.get('created_at') or r.get('created_date') or '',
                'closed_at': r.get('closed_at') or r.get('closed_date') or '',
                'status': status,
                'borough': r.get('borough') or '',
                'council_district': district,
                'complaint_type': complaint,
                'agency': r.get('agency') or r.get('agency_name') or '',
                'channel': r.get('channel') or r.get('open_data_channel_type') or '',
                'priority': r.get('priority') or '',
                'request_detail': r.get('request_detail') or r.get('descriptor') or '',
                'resolution_description': r.get('resolution_description') or '',
                'submitted_day_of_week': submitted_day,
                'submitted_hour': submitted_hour,
                'submitted_month': submitted_month,
                'status_bucket': sb,
                'closure_bucket': cb,
                'repeat_pressure_score': repeat_pressure,
                'patrol_intensity_score': patrol_intensity,
                'supervisor_review_likelihood': supervisor_likelihood,
            }
            writer.writerow(out)

    print(f'Wrote training sample {args.out} ({sample_size} rows from {n} available)')


if __name__ == '__main__':
    main()
