#!/usr/bin/env python3
"""Baseline calibration sweep for the CTGAN ABM (local-only).

The full 50k arrivals baseline is saturated (every district already a red zone),
so shocks can only deepen existing pressure, never create new red zones. This
sweep finds a *demonstration* baseline that is under pressure but not fully
failed, by varying a demand scale factor and capacity assumptions on the
persisted arrivals. No CTGAN retraining. No Supabase, no upload, no push.

Framing: public 311 benchmark; synthetic demand for capacity planning and
decision support only. Not live Brampton data, not enforcement decisioning. A
demand fraction < 1 is an explicit demonstration scale factor; a capacity
multiplier > 1 is an explicit capacity assumption.

Outputs (outputs/ctgan_abm_500k/validation/):
    baseline_calibration_results.csv / .json / baseline_calibration_summary.md
"""
from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import random
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

_RUNNER = Path(__file__).with_name('run_ctgan_abm_stress_lab.py')
_spec = importlib.util.spec_from_file_location('ctgan_abm_runner', _RUNNER)
rl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rl)

DEFAULT_ARRIVALS = Path('outputs/ctgan_abm_500k/synthetic_complaint_arrivals.csv')
DEFAULT_OUT = Path('outputs/ctgan_abm_500k/validation')

DEMAND_FRACTIONS = [0.25, 0.40, 0.60, 0.80, 1.0]
OFFICER_MULTS = [1.0, 1.25, 1.5, 2.0]
SUPERVISOR_MULTS = [1.0, 1.25, 1.5, 2.0]

RED_BAND_LO, RED_BAND_HI = 5, 20  # preferred red-zone district count


def subsample(arrivals, fraction, seed):
    if fraction >= 1.0:
        return list(arrivals)
    n = len(arrivals)
    k = max(1, int(round(fraction * n)))
    rng = np.random.default_rng(seed)
    idx = sorted(rng.choice(n, size=k, replace=False).tolist())
    return [arrivals[i] for i in idx]


def metrics_from_run(scenario_runs, daily_metrics, district_metrics):
    by_run = defaultdict(list)
    for d in daily_metrics:
        by_run[d['run_id']].append(d)
    peak_backlog, peak_sup, avg_sup, final_stale = [], [], [], []
    day_backlog = defaultdict(list)
    for _run_id, days in by_run.items():
        ds = sorted(days, key=lambda x: x['day'])
        peak_backlog.append(max(int(x['backlog']) for x in ds))
        peak_sup.append(max(int(x['supervisor_queue_size']) for x in ds))
        avg_sup.append(float(np.mean([int(x['supervisor_queue_size']) for x in ds])))
        final_stale.append(int(ds[-1]['stale_cases']))
        for di, x in enumerate(ds):
            day_backlog[di].append(int(x['backlog']))
    series = [float(np.mean(day_backlog[i])) for i in range(len(day_backlog))]

    # Red zones: districts with mean overload_flag >= 0.5 across scenarios.
    dgrp = defaultdict(lambda: {'backlog': [], 'overload': []})
    for r in district_metrics:
        dgrp[r['district_or_area']]['backlog'].append(float(r['backlog']))
        dgrp[r['district_or_area']]['overload'].append(float(r['overload_flag']))
    red = []
    for d, v in dgrp.items():
        if float(np.mean(v['overload'])) >= 0.5:
            red.append((d, float(np.mean(v['backlog']))))
    red.sort(key=lambda x: -x[1])

    gen = float(np.mean([int(r['generated_cases']) for r in scenario_runs]))
    final_backlog = float(np.mean([int(r['final_backlog']) for r in scenario_runs]))
    peak = float(np.mean(peak_backlog))
    recovered = bool(series and series[-1] < 0.95 * max(series))
    return {
        'generated_cases': round(gen, 0),
        'processed_cases': round(float(np.mean([int(r['processed_cases']) for r in scenario_runs])), 0),
        'closed_cases': round(float(np.mean([int(r['closed_cases']) for r in scenario_runs])), 0),
        'final_backlog': round(final_backlog, 0),
        'peak_backlog': round(peak, 0),
        'stale_cases': round(float(np.mean(final_stale)), 0),
        'supervisor_queue_peak': round(float(np.mean(peak_sup)), 0),
        'supervisor_queue_average': round(float(np.mean(avg_sup)), 0),
        'red_zone_count': len(red),
        'top5_red_zones': [d for d, _ in red[:5]],
        'recovering': recovered,
        'backlog_share': round(final_backlog / gen, 4) if gen else None,
    }


def run_combo(arrivals, days, scenarios, top_districts, seed, officer_mult, supervisor_mult):
    o0, s0 = rl.DEFAULT_OFFICER_DAILY_MINUTES, rl.DEFAULT_SUPERVISOR_DAILY_REVIEW_CAPACITY
    try:
        rl.DEFAULT_OFFICER_DAILY_MINUTES = max(1, int(round(o0 * officer_mult)))
        rl.DEFAULT_SUPERVISOR_DAILY_REVIEW_CAPACITY = max(1, int(round(s0 * supervisor_mult)))
        random.seed(seed)
        np.random.seed(seed)
        sr, _sl, dm, dist_m, _ctm, _st = rl.run_simulation(
            arrivals, days=days, top_districts=top_districts, scenarios=scenarios)
    finally:
        rl.DEFAULT_OFFICER_DAILY_MINUTES = o0
        rl.DEFAULT_SUPERVISOR_DAILY_REVIEW_CAPACITY = s0
    return metrics_from_run(sr, dm, dist_m)


def select_baseline(rows):
    """Prefer red-zone count in [5,20]; among those minimize the *artificial
    capacity assumption* first (multipliers closest to 1.0 -- a doubled officer
    pool is a bigger fabrication than a disclosed demand scale factor), then
    maximize demand realism (highest fraction). Else closest non-saturated."""
    def capacity_inflation(r):
        return abs(r['officer_capacity_multiplier'] - 1.0) + abs(r['supervisor_capacity_multiplier'] - 1.0)
    in_band = [r for r in rows if RED_BAND_LO <= r['red_zone_count'] <= RED_BAND_HI]
    if in_band:
        in_band.sort(key=lambda r: (capacity_inflation(r), -r['demand_fraction']))
        return in_band[0], 'in_band'
    # Fallback: not fully saturated (red < 50), closest to band midpoint.
    not_sat = [r for r in rows if r['red_zone_count'] < 50]
    if not_sat:
        mid = (RED_BAND_LO + RED_BAND_HI) / 2
        not_sat.sort(key=lambda r: (abs(r['red_zone_count'] - mid), -r['demand_fraction']))
        return not_sat[0], 'closest_not_saturated'
    rows_sorted = sorted(rows, key=lambda r: r['red_zone_count'])
    return rows_sorted[0], 'all_saturated'


def main():
    ap = argparse.ArgumentParser(description='CTGAN ABM baseline calibration sweep (local-only).')
    ap.add_argument('--arrivals', type=Path, default=DEFAULT_ARRIVALS)
    ap.add_argument('--output', '--out', dest='out', type=Path, default=DEFAULT_OUT)
    ap.add_argument('--days', type=int, default=30)
    ap.add_argument('--scenarios', type=int, default=5)
    ap.add_argument('--top-districts', type=int, default=50)
    ap.add_argument('--seed', type=int, default=42)
    args = ap.parse_args()

    if not args.arrivals.exists():
        print(f'ERROR: arrivals not found: {args.arrivals}', file=sys.stderr)
        sys.exit(1)
    args.out.mkdir(parents=True, exist_ok=True)

    base = rl.load_arrivals_csv(args.arrivals)
    print(f'Loaded {len(base)} arrivals. Sweep: {len(DEMAND_FRACTIONS)}x{len(OFFICER_MULTS)}x'
          f'{len(SUPERVISOR_MULTS)} = {len(DEMAND_FRACTIONS)*len(OFFICER_MULTS)*len(SUPERVISOR_MULTS)} combos '
          f'(days={args.days}, scenarios={args.scenarios})\n')

    # Subsample once per fraction (same subset across capacity variations).
    subsets = {f: subsample(base, f, args.seed) for f in DEMAND_FRACTIONS}

    rows = []
    for frac in DEMAND_FRACTIONS:
        arr = subsets[frac]
        for om in OFFICER_MULTS:
            for sm in SUPERVISOR_MULTS:
                m = run_combo(arr, args.days, args.scenarios, args.top_districts, args.seed, om, sm)
                row = {'demand_fraction': frac, 'officer_capacity_multiplier': om,
                       'supervisor_capacity_multiplier': sm, **m}
                rows.append(row)
                print(f'  frac={frac} off={om} sup={sm} -> red={m["red_zone_count"]:>2} '
                      f'backlog={m["final_backlog"]:.0f} stale={m["stale_cases"]:.0f} '
                      f'sup_peak={m["supervisor_queue_peak"]:.0f} share={m["backlog_share"]}')

    chosen, reason = select_baseline(rows)
    print(f'\nSelected baseline ({reason}): frac={chosen["demand_fraction"]} '
          f'off={chosen["officer_capacity_multiplier"]} sup={chosen["supervisor_capacity_multiplier"]} '
          f'-> red_zones={chosen["red_zone_count"]}')

    summary = {
        'config': {'arrivals': str(args.arrivals), 'n_arrivals': len(base), 'days': args.days,
                   'scenarios': args.scenarios, 'top_districts': args.top_districts, 'seed': args.seed,
                   'demand_fractions': DEMAND_FRACTIONS, 'officer_multipliers': OFFICER_MULTS,
                   'supervisor_multipliers': SUPERVISOR_MULTS, 'red_band': [RED_BAND_LO, RED_BAND_HI]},
        'framing': ('Public 311 benchmark; synthetic demand for capacity planning and decision support '
                    'only. Not live Brampton data, not enforcement decisioning. Demand fraction < 1 is a '
                    'demonstration scale factor; capacity multiplier > 1 is a capacity assumption.'),
        'grid': rows,
        'recommended': {**{k: chosen[k] for k in ('demand_fraction', 'officer_capacity_multiplier',
                                                  'supervisor_capacity_multiplier')},
                        'selection_reason': reason,
                        'metrics': {k: chosen[k] for k in (
                            'generated_cases', 'processed_cases', 'closed_cases', 'final_backlog',
                            'peak_backlog', 'stale_cases', 'supervisor_queue_peak',
                            'supervisor_queue_average', 'red_zone_count', 'top5_red_zones',
                            'recovering', 'backlog_share')}},
    }
    (args.out / 'baseline_calibration_results.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')

    fieldnames = ['demand_fraction', 'officer_capacity_multiplier', 'supervisor_capacity_multiplier',
                  'generated_cases', 'processed_cases', 'closed_cases', 'final_backlog', 'peak_backlog',
                  'stale_cases', 'supervisor_queue_peak', 'supervisor_queue_average', 'red_zone_count',
                  'top5_red_zones', 'recovering', 'backlog_share']
    with open(args.out / 'baseline_calibration_results.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            rr = dict(r)
            rr['top5_red_zones'] = ';'.join(r['top5_red_zones'])
            w.writerow({k: rr.get(k) for k in fieldnames})

    write_summary(args.out / 'baseline_calibration_summary.md', summary, chosen, reason)
    print(f'\nWrote: {args.out / "baseline_calibration_results.json"}')
    print(f'Wrote: {args.out / "baseline_calibration_results.csv"}')
    print(f'Wrote: {args.out / "baseline_calibration_summary.md"}')
    print('\nRECOMMENDED SHOCK COMMAND:')
    print(f'  python scripts/ctgan_abm/run_ctgan_abm_shocks.py --arrivals {args.arrivals} '
          f'--output {args.out} --prefix calibrated_shock '
          f'--demand-fraction {chosen["demand_fraction"]} '
          f'--base-officer-multiplier {chosen["officer_capacity_multiplier"]} '
          f'--base-supervisor-multiplier {chosen["supervisor_capacity_multiplier"]}')


def write_summary(path, summary, chosen, reason):
    cfg = summary['config']
    L = []
    L.append('# Baseline calibration summary\n')
    L.append('The full 50k arrivals baseline is saturated: every simulated district is already a red '
             'zone, so shocks can only deepen existing pressure, never create new red zones. This sweep '
             'finds a demonstration baseline that is under pressure but not fully failed.\n')
    L.append('Public 311 benchmark; synthetic demand for capacity planning and decision support only. '
             'Not live Brampton data, not enforcement decisioning. A demand fraction < 1 is a '
             'demonstration scale factor; a capacity multiplier > 1 is a capacity assumption.\n')
    L.append(f'- Grid: demand fractions {cfg["demand_fractions"]}, officer multipliers '
             f'{cfg["officer_multipliers"]}, supervisor multipliers {cfg["supervisor_multipliers"]}')
    L.append(f'- days={cfg["days"]}, scenarios={cfg["scenarios"]}, top_districts={cfg["top_districts"]}')
    L.append(f'- Preferred red-zone band: {cfg["red_band"][0]}-{cfg["red_band"][1]} of {cfg["top_districts"]}\n')

    L.append('## Recommended demonstration baseline\n')
    L.append(f'- Selection: **{reason}**')
    L.append(f'- demand fraction: **{chosen["demand_fraction"]}** (demonstration scale factor)')
    L.append(f'- officer capacity multiplier: **{chosen["officer_capacity_multiplier"]}** (capacity assumption)')
    L.append(f'- supervisor capacity multiplier: **{chosen["supervisor_capacity_multiplier"]}** (capacity assumption)')
    for k in ('generated_cases', 'processed_cases', 'closed_cases', 'final_backlog', 'peak_backlog',
              'stale_cases', 'supervisor_queue_peak', 'supervisor_queue_average', 'red_zone_count',
              'backlog_share', 'recovering'):
        L.append(f'- {k.replace("_", " ")}: {chosen[k]}')
    L.append(f'- top 5 red zones: {", ".join(chosen["top5_red_zones"]) or "none"}\n')

    # Candidate table (in-band first, else nearest).
    L.append('## In-band candidates (red zones 5-20)\n')
    band = [r for r in summary['grid'] if cfg['red_band'][0] <= r['red_zone_count'] <= cfg['red_band'][1]]
    if band:
        L.append('| frac | officer× | sup× | red zones | final backlog | stale | sup peak | backlog share | recovering |')
        L.append('|---|---|---|---|---|---|---|---|---|')
        for r in sorted(band, key=lambda r: (-r['demand_fraction'], r['officer_capacity_multiplier'])):
            L.append(f'| {r["demand_fraction"]} | {r["officer_capacity_multiplier"]} | '
                     f'{r["supervisor_capacity_multiplier"]} | {r["red_zone_count"]} | '
                     f'{r["final_backlog"]:.0f} | {r["stale_cases"]:.0f} | '
                     f'{r["supervisor_queue_peak"]:.0f} | {r["backlog_share"]} | {r["recovering"]} |')
    else:
        L.append('No combination landed in the 5-20 red-zone band; selected the closest '
                 'non-saturated baseline instead (see recommended above).')
    L.append('')
    path.write_text('\n'.join(L), encoding='utf-8')


if __name__ == '__main__':
    main()
