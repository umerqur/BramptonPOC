#!/usr/bin/env python3
"""Build a clean, loadable CALIBRATED scenario set for the Stress Testing UI.

Uses the recommended calibrated demonstration baseline (demand fraction 0.40,
officer capacity x1.0, supervisor capacity x1.0) on the persisted 500k arrivals
(no CTGAN retraining). Produces one named scenario per condition:

    baseline_calibrated
    rainstorm_pothole_mud_tracking
    construction_corridor
    event_parking_noise
    staff_capacity_drop
    supervisor_review_bottleneck

Writes the same 5 loadable CSVs that migrations 033/034 + the loader expect into
outputs/ctgan_abm_500k_calibrated/, with human-readable scenario_id / run_id.

Local-only: no Supabase, no upload, no migration, no push, no frontend edits.
Public 311 benchmark; synthetic demand for capacity planning and decision support
only. The demand fraction is a demonstration scale factor; not live Brampton data,
not enforcement decisioning.
"""
from __future__ import annotations

import csv
import importlib.util
import json
import random
from datetime import datetime
from pathlib import Path

import numpy as np

# Reuse the shock module (which itself loads the core runner as `rl`).
_SHOCKS = Path(__file__).with_name('run_ctgan_abm_shocks.py')
_spec = importlib.util.spec_from_file_location('ctgan_abm_shocks', _SHOCKS)
shocks = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(shocks)
rl = shocks.rl

ARRIVALS = Path('outputs/ctgan_abm_500k/synthetic_complaint_arrivals.csv')
OUT_DIR = Path('outputs/ctgan_abm_500k_calibrated')

# Calibrated demonstration baseline + shock parameters.
FRACTION = 0.40
BASE_OFF, BASE_SUP = 1.0, 1.0
SHOCK_DISTRICTS = ['11', '14', '10']
SHOCK_DAYS = 7
DEMAND_MULT = 1.5
OFFICER_CAP_MULT = 0.8
SUP_CAP_MULT = 0.75
DAYS = 30
SEED = 42

NAMES = {
    'baseline_calibrated': 'Calibrated baseline (40% demand, normal capacity)',
    'rainstorm_pothole_mud_tracking': 'Rainstorm: pothole / catch-basin / mud-tracking surge',
    'construction_corridor': 'Construction corridor: district-concentrated surge',
    'event_parking_noise': 'Event: parking / noise short sharp spike',
    'staff_capacity_drop': 'Staff capacity drop (officer minutes -20%)',
    'supervisor_review_bottleneck': 'Supervisor review bottleneck (capacity -25%)',
}


def run_condition(arrivals, officer_mult, supervisor_mult):
    """One ABM run; returns the runner's raw output rows (scenario_000/run_000_*)."""
    o0, s0 = rl.DEFAULT_OFFICER_DAILY_MINUTES, rl.DEFAULT_SUPERVISOR_DAILY_REVIEW_CAPACITY
    try:
        rl.DEFAULT_OFFICER_DAILY_MINUTES = max(1, int(round(o0 * officer_mult)))
        rl.DEFAULT_SUPERVISOR_DAILY_REVIEW_CAPACITY = max(1, int(round(s0 * supervisor_mult)))
        random.seed(SEED)
        np.random.seed(SEED)
        return rl.run_simulation(arrivals, days=DAYS, top_districts=50, scenarios=1)
    finally:
        rl.DEFAULT_OFFICER_DAILY_MINUTES = o0
        rl.DEFAULT_SUPERVISOR_DAILY_REVIEW_CAPACITY = s0


def main():
    if not ARRIVALS.exists():
        raise SystemExit(f'Arrivals not found: {ARRIVALS}')
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().isoformat(timespec='seconds')

    base = rl.load_arrivals_csv(ARRIVALS)
    base_sub = shocks.subsample(base, FRACTION, SEED)
    rng = np.random.default_rng(SEED)
    print(f'Loaded {len(base)} arrivals; calibrated demand fraction {FRACTION} -> {len(base_sub)} arrivals')

    P = shocks.PRESETS

    def surge(name):
        arr, _info = shocks.apply_demand_surge(base_sub, P[name], SHOCK_DISTRICTS,
                                               SHOCK_DAYS, DEMAND_MULT, rng)
        return arr

    # (scenario_id, arrivals, officer_mult, supervisor_mult)
    conditions = [
        ('baseline_calibrated', base_sub, BASE_OFF, BASE_SUP),
        ('rainstorm_pothole_mud_tracking', surge('rainstorm_pothole_mud_tracking'),
         BASE_OFF * P['rainstorm_pothole_mud_tracking']['officer_mult'], BASE_SUP),
        ('construction_corridor', surge('construction_corridor'),
         BASE_OFF * P['construction_corridor']['officer_mult'], BASE_SUP),
        ('event_parking_noise', surge('event_parking_noise'),
         BASE_OFF * P['event_parking_noise']['officer_mult'], BASE_SUP),
        ('staff_capacity_drop', base_sub, BASE_OFF * OFFICER_CAP_MULT, BASE_SUP),
        ('supervisor_review_bottleneck',
         shocks.boost_all_suplike(base_sub, P['supervisor_review_bottleneck'].get('suplike_boost_all', 0.0)),
         BASE_OFF, BASE_SUP * SUP_CAP_MULT),
    ]

    scenarios_rows, runs_rows, daily_rows, district_rows, complaint_rows = [], [], [], [], []

    for sid, arr, om, sm in conditions:
        run_id = f'run_{sid}'
        sr, _sl, dm, dist_m, ctm, _st = run_condition(arr, om, sm)
        run = sr[0]
        red = sum(int(r['overload_flag']) for r in dist_m)
        peak_sup = max(int(d['supervisor_queue_size']) for d in dm)
        print(f'  {sid:34} backlog={run["final_backlog"]:>6} red_zones={red:>2} '
              f'sup_peak={peak_sup:>5} processed={run["processed_cases"]}')

        scenarios_rows.append({
            'scenario_id': sid, 'name': NAMES[sid],
            'description': f'Calibrated demo (demand x{FRACTION}); {DAYS}-day queue flow, 50 districts.',
            'created_at': ts,
        })
        runs_rows.append({
            'run_id': run_id, 'scenario_id': sid, 'run_date': ts,
            'generated_cases': run['generated_cases'], 'processed_cases': run['processed_cases'],
            'closed_cases': run['closed_cases'], 'final_backlog': run['final_backlog'],
            'metadata': json.dumps({'scenario': sid, 'demand_fraction': FRACTION,
                                    'officer_mult': om, 'supervisor_mult': sm, 'days': DAYS}),
        })
        for i, d in enumerate(sorted(dm, key=lambda x: x['day'])):
            daily_rows.append({
                'id': f'{run_id}_day_{i}', 'run_id': run_id, 'scenario_id': sid, 'day': d['day'],
                'total_cases': d['total_cases'], 'processed': d['processed'], 'backlog': d['backlog'],
                'stale_cases': d['stale_cases'], 'supervisor_queue_size': d['supervisor_queue_size'],
                'created_at': ts,
            })
        for r in dist_m:
            district_rows.append({
                'id': f'{run_id}_{r["district_or_area"]}', 'run_id': run_id, 'scenario_id': sid,
                'district_or_area': r['district_or_area'], 'total_cases': r['total_cases'],
                'backlog': r['backlog'], 'stale_cases': r['stale_cases'],
                'overload_flag': r['overload_flag'], 'estimated_hours': r['estimated_hours'],
                'created_at': ts,
            })
        for r in ctm:
            complaint_rows.append({
                'id': f'{run_id}_{r["complaint_type"]}', 'run_id': run_id, 'scenario_id': sid,
                'complaint_type': r['complaint_type'], 'total_cases': r['total_cases'],
                'estimated_hours': r['estimated_hours'], 'created_at': ts,
            })

    rl.write_csv(OUT_DIR / 'ctgan_abm_scenarios.csv',
                 ['scenario_id', 'name', 'description', 'created_at'], scenarios_rows)
    rl.write_csv(OUT_DIR / 'ctgan_abm_scenario_runs.csv',
                 ['run_id', 'scenario_id', 'run_date', 'generated_cases', 'processed_cases',
                  'closed_cases', 'final_backlog', 'metadata'], runs_rows)
    rl.write_csv(OUT_DIR / 'ctgan_abm_daily_metrics.csv',
                 ['id', 'run_id', 'scenario_id', 'day', 'total_cases', 'processed', 'backlog',
                  'stale_cases', 'supervisor_queue_size', 'created_at'], daily_rows)
    rl.write_csv(OUT_DIR / 'ctgan_abm_district_metrics.csv',
                 ['id', 'run_id', 'scenario_id', 'district_or_area', 'total_cases', 'backlog',
                  'stale_cases', 'overload_flag', 'estimated_hours', 'created_at'], district_rows)
    rl.write_csv(OUT_DIR / 'ctgan_abm_complaint_type_metrics.csv',
                 ['id', 'run_id', 'scenario_id', 'complaint_type', 'total_cases',
                  'estimated_hours', 'created_at'], complaint_rows)

    write_loader()
    print(f'\nWrote 5 CSVs + loader to {OUT_DIR}')
    print(f'  scenarios={len(scenarios_rows)} runs={len(runs_rows)} daily={len(daily_rows)} '
          f'district={len(district_rows)} complaint={len(complaint_rows)}')


def write_loader():
    path = Path('scripts/ctgan_abm/load_ctgan_abm_calibrated.sql')
    folder = 'outputs/ctgan_abm_500k_calibrated'
    lines = [
        '-- Client-side loader for the CALIBRATED CTGAN ABM demo scenario set -> Supabase.',
        '--',
        '-- Calibrated demonstration baseline: demand fraction 0.40 (demonstration scale factor),',
        '-- officer capacity x1.0, supervisor capacity x1.0. ~13 red zones, with headroom so shocks',
        '-- can create new red zones. Public 311 benchmark; synthetic demand for capacity planning',
        '-- and decision support only. Not live Brampton data, not enforcement decisioning.',
        '--',
        '-- Prerequisites: migrations 033 and 034 applied. Run from the REPO ROOT. Uses client-side',
        '-- \\copy (NOT server-side COPY), so it works against hosted Supabase. Same schema/loader',
        f'-- pattern as load_ctgan_abm_500k.sql, pointed at {folder}/.',
        '--',
        '--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/ctgan_abm/load_ctgan_abm_calibrated.sql',
        '--',
        '-- Re-running: uncomment the TRUNCATE block. Load order respects the run/scenario FKs.',
        '',
        '-- TRUNCATE public.ctgan_abm_daily_metrics,',
        '--          public.ctgan_abm_district_metrics,',
        '--          public.ctgan_abm_complaint_type_metrics,',
        '--          public.ctgan_abm_scenario_runs,',
        '--          public.ctgan_abm_scenarios',
        '--   RESTART IDENTITY CASCADE;',
        '',
        '-- Each \\copy must stay on a single physical line.',
        f"\\copy public.ctgan_abm_scenarios (scenario_id,name,description,created_at) FROM '{folder}/ctgan_abm_scenarios.csv' WITH (FORMAT csv, HEADER true)",
        f"\\copy public.ctgan_abm_scenario_runs (run_id,scenario_id,run_date,generated_cases,processed_cases,closed_cases,final_backlog,metadata) FROM '{folder}/ctgan_abm_scenario_runs.csv' WITH (FORMAT csv, HEADER true)",
        f"\\copy public.ctgan_abm_daily_metrics (id,run_id,scenario_id,day,total_cases,processed,backlog,stale_cases,supervisor_queue_size,created_at) FROM '{folder}/ctgan_abm_daily_metrics.csv' WITH (FORMAT csv, HEADER true)",
        f"\\copy public.ctgan_abm_district_metrics (id,run_id,scenario_id,district_or_area,total_cases,backlog,stale_cases,overload_flag,estimated_hours,created_at) FROM '{folder}/ctgan_abm_district_metrics.csv' WITH (FORMAT csv, HEADER true)",
        f"\\copy public.ctgan_abm_complaint_type_metrics (id,run_id,scenario_id,complaint_type,total_cases,estimated_hours,created_at) FROM '{folder}/ctgan_abm_complaint_type_metrics.csv' WITH (FORMAT csv, HEADER true)",
        '',
    ]
    path.write_text('\n'.join(lines), encoding='utf-8')


if __name__ == '__main__':
    main()
