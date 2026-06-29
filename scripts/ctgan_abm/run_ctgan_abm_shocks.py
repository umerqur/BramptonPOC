#!/usr/bin/env python3
"""Municipal service shock layer for the CTGAN ABM (local-only).

Where the shuffle sensitivity test preserves each field's marginal (so backlog
barely moves), this layer applies realistic *distribution-shift* shocks: a
municipal service shock -> complaint amplification / reporting surge -> district
queue pressure -> officer capacity stress -> supervisor review bottleneck ->
delayed closure-update pressure.

It reuses the persisted 500k arrivals (no CTGAN retraining) and the ABM in
run_ctgan_abm_stress_lab.py. It does NOT touch Supabase, upload, push, or change
any UI.

Framing: public 311 benchmark; synthetic demand for capacity planning and
decision support only. Not live Brampton data, not enforcement decisioning. The
model is a queue flow of operational pressure propagation under capacity-
constrained queue pressure. (Not panic; not graph diffusion.)

Outputs (outputs/ctgan_abm_500k/validation/):
    shock_results.csv, shock_results.json, shock_summary.md
"""
from __future__ import annotations

import argparse
import copy
import csv
import importlib.util
import json
import random
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy.stats import spearmanr

_RUNNER = Path(__file__).with_name('run_ctgan_abm_stress_lab.py')
_spec = importlib.util.spec_from_file_location('ctgan_abm_runner', _RUNNER)
rl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rl)

DEFAULT_ARRIVALS = Path('outputs/ctgan_abm_500k/synthetic_complaint_arrivals.csv')
DEFAULT_OUT = Path('outputs/ctgan_abm_500k/validation')

METRIC_KEYS = ['final_backlog', 'peak_backlog', 'stale_cases', 'processed_cases',
               'closed_cases', 'supervisor_queue_peak', 'supervisor_queue_average']

MATERIAL_PCT = 10.0
MATERIAL_SPEARMAN = 0.90

# Shock presets. mode:
#   'demand_surge'  -> amplify volume + scores for matching complaint types
#   'capacity'      -> reduce officer minutes, no demand change
#   'capacity_review' -> reduce supervisor capacity (+ raise review likelihood)
PRESETS = {
    'rainstorm_pothole_mud_tracking': {
        'mode': 'demand_surge',
        'types': ['Pothole', 'Street Condition', 'Blocked Catch Basin', 'Mud Tracking',
                  'Roadway Obstruction', 'Sewer'],
        'district_concentrated': True, 'concentrate_window': 'shock_days',
        'patrol_boost': 0.15, 'repeat_boost': 0.15, 'suplike_boost': 0.05,
        'officer_mult': 1.0, 'supervisor_mult': 1.0,
    },
    'construction_corridor': {
        'mode': 'demand_surge',
        'types': ['Mud Tracking', 'Noise', 'Dust', 'Roadway Obstruction',
                  'Property Standards', 'Construction'],
        'district_concentrated': True, 'concentrate_window': 'shock_days',
        'patrol_boost': 0.20, 'repeat_boost': 0.20, 'suplike_boost': 0.05,
        'officer_mult': 0.9, 'supervisor_mult': 1.0,  # capacity partly tied up
    },
    'event_parking_noise': {
        'mode': 'demand_surge',
        'types': ['Illegal Parking', 'Noise', 'Blocked Driveway', 'Litter'],
        'district_concentrated': False, 'concentrate_window': 3,  # short sharp spike
        'patrol_boost': 0.05, 'repeat_boost': 0.05, 'suplike_boost': 0.10,
        'officer_mult': 1.0, 'supervisor_mult': 1.0,
    },
    'staff_capacity_drop': {
        'mode': 'capacity',
        'officer_mult': None,  # from --officer-capacity-multiplier
        'supervisor_mult': 1.0,
    },
    'supervisor_review_bottleneck': {
        'mode': 'capacity_review',
        'officer_mult': 1.0,
        'supervisor_mult': None,  # from --supervisor-capacity-multiplier
        'suplike_boost_all': 0.15,
    },
}


def clip01(x):
    return max(0.0, min(1.0, x))


def subsample(arrivals, fraction, seed):
    """Deterministic demand scale factor (same as the calibration sweep)."""
    if fraction >= 1.0:
        return list(arrivals)
    n = len(arrivals)
    k = max(1, int(round(fraction * n)))
    rng = np.random.default_rng(seed)
    idx = sorted(rng.choice(n, size=k, replace=False).tolist())
    return [arrivals[i] for i in idx]


def matches_types(ct, types):
    c = (ct or '').lower()
    return any(t.lower() in c or c in t.lower() for t in types)


def apply_demand_surge(base, preset, shock_districts, shock_days, demand_mult, rng):
    """Return (arrivals_copy, info). Amplifies volume + scores for affected cases."""
    arr = copy.deepcopy(base)
    dconc = preset['district_concentrated']
    win = shock_days if preset['concentrate_window'] == 'shock_days' else int(preset['concentrate_window'])

    def affected_idx(rows):
        out = []
        for i, a in enumerate(rows):
            if not matches_types(a.get('complaint_type'), preset['types']):
                continue
            if dconc and str(a.get('district')) not in shock_districts:
                continue
            out.append(i)
        return out

    idx = affected_idx(arr)
    fallback = False
    if dconc and len(idx) < 50:
        # Preset types sparse in the shock districts -> amplify all demand there.
        fallback = True
        idx = [i for i, a in enumerate(arr) if str(a.get('district')) in shock_districts]

    # Boost scores on the affected originals (distribution shift, not reshuffle).
    for i in idx:
        a = arr[i]
        a['patrol_intensity_score'] = clip01(float(a['patrol_intensity_score']) + preset['patrol_boost'])
        a['repeat_pressure_score'] = clip01(float(a['repeat_pressure_score']) + preset['repeat_boost'])
        a['supervisor_review_likelihood'] = clip01(float(a['supervisor_review_likelihood']) + preset['suplike_boost'])

    # Inject extra demand (reporting surge), concentrated into the first `win` days.
    extra = int(round((demand_mult - 1.0) * len(idx))) if idx else 0
    for _ in range(extra):
        src = arr[idx[rng.integers(0, len(idx))]]
        dup = dict(src)
        dup['arrival_day'] = int(rng.integers(0, max(1, win)))
        arr.append(dup)

    info = {'affected_base': len(idx), 'injected': extra, 'fallback_district_only': fallback,
            'concentrate_window_days': win}
    return arr, info


def boost_all_suplike(base, boost):
    arr = copy.deepcopy(base)
    for a in arr:
        a['supervisor_review_likelihood'] = clip01(float(a['supervisor_review_likelihood']) + boost)
    return arr


def metrics_from_run(scenario_runs, daily_metrics, district_metrics, complaint_type_metrics):
    by_run = defaultdict(list)
    for d in daily_metrics:
        by_run[d['run_id']].append(d)
    peak_backlog, peak_sup, avg_sup, final_stale = [], [], [], []
    # Per-day-index mean backlog/supervisor series (for recovery analysis).
    day_backlog, day_sup = defaultdict(list), defaultdict(list)
    for _run_id, days in by_run.items():
        days_sorted = sorted(days, key=lambda x: x['day'])
        peak_backlog.append(max(int(x['backlog']) for x in days_sorted))
        peak_sup.append(max(int(x['supervisor_queue_size']) for x in days_sorted))
        avg_sup.append(float(np.mean([int(x['supervisor_queue_size']) for x in days_sorted])))
        final_stale.append(int(days_sorted[-1]['stale_cases']))
        for di, x in enumerate(days_sorted):
            day_backlog[di].append(int(x['backlog']))
            day_sup[di].append(int(x['supervisor_queue_size']))

    n_days = len(day_backlog)
    backlog_series = [float(np.mean(day_backlog[i])) for i in range(n_days)]
    sup_series = [float(np.mean(day_sup[i])) for i in range(n_days)]

    # Red zones: districts with mean overload_flag >= 0.5 across scenarios.
    dgrp = defaultdict(lambda: {'backlog': [], 'overload': []})
    for r in district_metrics:
        dgrp[r['district_or_area']]['backlog'].append(float(r['total_cases'] and r['backlog']))
        dgrp[r['district_or_area']]['overload'].append(float(r['overload_flag']))
    red = []
    for d, v in dgrp.items():
        mo = float(np.mean(v['overload'])) if v['overload'] else 0.0
        mb = float(np.mean(v['backlog'])) if v['backlog'] else 0.0
        if mo >= 0.5:
            red.append({'district': d, 'mean_backlog': round(mb, 0), 'mean_overload': round(mo, 2)})
    red.sort(key=lambda x: -x['mean_backlog'])

    dist_vec = {r['district_or_area']: 0.0 for r in district_metrics}
    for r in district_metrics:
        dist_vec[r['district_or_area']] += float(r['total_cases'])
    comp_vec = defaultdict(float)
    for r in complaint_type_metrics:
        comp_vec[r['complaint_type']] += float(r['total_cases'])

    return {
        'final_backlog': float(np.mean([int(r['final_backlog']) for r in scenario_runs])),
        'peak_backlog': float(np.mean(peak_backlog)),
        'stale_cases': float(np.mean(final_stale)),
        'processed_cases': float(np.mean([int(r['processed_cases']) for r in scenario_runs])),
        'closed_cases': float(np.mean([int(r['closed_cases']) for r in scenario_runs])),
        'supervisor_queue_peak': float(np.mean(peak_sup)),
        'supervisor_queue_average': float(np.mean(avg_sup)),
        '_backlog_series': backlog_series,
        '_sup_series': sup_series,
        '_red_zones': red,
        '_district_vector': dict(dist_vec),
        '_complaint_vector': dict(comp_vec),
    }


def rank_spearman(a, b):
    keys = sorted(set(a) | set(b))
    if len(keys) < 3:
        return 1.0
    rho, _ = spearmanr([a.get(k, 0.0) for k in keys], [b.get(k, 0.0) for k in keys])
    return float(rho) if rho == rho else 1.0


def run_abm(arrivals, days, scenarios, top_districts, seed, officer_mult=1.0, supervisor_mult=1.0):
    """Run the ABM with optional capacity multipliers (monkey-patched constants)."""
    o0 = rl.DEFAULT_OFFICER_DAILY_MINUTES
    s0 = rl.DEFAULT_SUPERVISOR_DAILY_REVIEW_CAPACITY
    try:
        rl.DEFAULT_OFFICER_DAILY_MINUTES = max(1, int(round(o0 * officer_mult)))
        rl.DEFAULT_SUPERVISOR_DAILY_REVIEW_CAPACITY = max(1, int(round(s0 * supervisor_mult)))
        random.seed(seed)
        np.random.seed(seed)
        sr, _sl, dm, dist_m, ctm, _st = rl.run_simulation(
            arrivals, days=days, top_districts=top_districts, scenarios=scenarios)
    finally:
        rl.DEFAULT_OFFICER_DAILY_MINUTES = o0
        rl.DEFAULT_SUPERVISOR_DAILY_REVIEW_CAPACITY = s0
    return metrics_from_run(sr, dm, dist_m, ctm)


def recovery_vs_baseline(base_series, shock_series, shock_window):
    """Honest recovery proxy on the shock-minus-baseline backlog gap."""
    n = min(len(base_series), len(shock_series))
    gap = [shock_series[i] - base_series[i] for i in range(n)]
    if not gap:
        return {'peak_gap': 0, 'peak_gap_day': 0, 'final_gap': 0,
                'recovering': False, 'days_to_halve_gap': None}
    peak = max(gap)
    peak_day = gap.index(peak)
    final = gap[-1]
    recovering = final < peak - 1e-9
    halve_day = None
    if recovering and peak > 0:
        for d in range(peak_day, n):
            if gap[d] <= 0.5 * peak:
                halve_day = d - shock_window
                break
    return {'peak_gap': round(peak, 0), 'peak_gap_day': peak_day, 'final_gap': round(final, 0),
            'recovering': bool(recovering),
            'days_to_halve_gap': (int(halve_day) if halve_day is not None else None)}


def recommended_action(name, pct):
    """Data-driven, capacity-planning prevention action (no enforcement framing)."""
    backlog_moved = max(abs(pct.get('final_backlog') or 0), abs(pct.get('peak_backlog') or 0))
    sup_moved = max(abs(pct.get('supervisor_queue_peak') or 0), abs(pct.get('supervisor_queue_average') or 0))
    if name == 'staff_capacity_drop' or (backlog_moved >= sup_moved and backlog_moved >= MATERIAL_PCT):
        return 'Move field capacity into the affected districts (restore/add officer minutes); prioritize high-pressure districts.'
    if name == 'supervisor_review_bottleneck' or sup_moved >= MATERIAL_PCT:
        return 'Increase supervisor review capacity; triage repeat complaints and separate duplicate complaints to cut review load.'
    if backlog_moved >= MATERIAL_PCT:
        return 'Pre-stage field capacity ahead of the surge window and prioritize high-pressure districts; triage repeat/duplicate complaints.'
    return 'No material change; current capacity absorbs this shock.'


def main():
    ap = argparse.ArgumentParser(description='CTGAN ABM municipal service shock layer (local-only).')
    ap.add_argument('--arrivals', type=Path, default=DEFAULT_ARRIVALS)
    ap.add_argument('--output', '--out', dest='out', type=Path, default=DEFAULT_OUT)
    ap.add_argument('--days', type=int, default=30)
    ap.add_argument('--scenarios', type=int, default=5)
    ap.add_argument('--top-districts', type=int, default=50)
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--shock-districts', type=str, default='11,14,10')
    ap.add_argument('--shock-days', type=int, default=7)
    ap.add_argument('--demand-multiplier', type=float, default=1.5)
    ap.add_argument('--officer-capacity-multiplier', type=float, default=0.8)
    ap.add_argument('--supervisor-capacity-multiplier', type=float, default=0.75)
    # Calibrated-baseline controls (defaults = uncalibrated full-demand run).
    ap.add_argument('--demand-fraction', type=float, default=1.0,
                    help='Demonstration scale factor applied to arrivals before shocks')
    ap.add_argument('--base-officer-multiplier', type=float, default=1.0,
                    help='Baseline officer capacity assumption (preset multipliers compose on top)')
    ap.add_argument('--base-supervisor-multiplier', type=float, default=1.0,
                    help='Baseline supervisor capacity assumption (preset multipliers compose on top)')
    ap.add_argument('--prefix', type=str, default='shock',
                    help='Output filename prefix (e.g. calibrated_shock)')
    args = ap.parse_args()

    if not args.arrivals.exists():
        print(f'ERROR: arrivals not found: {args.arrivals}', file=sys.stderr)
        sys.exit(1)
    args.out.mkdir(parents=True, exist_ok=True)

    shock_districts = [s.strip() for s in args.shock_districts.split(',') if s.strip()]
    base_arrivals = rl.load_arrivals_csv(args.arrivals)
    if args.demand_fraction < 1.0:
        base_arrivals = subsample(base_arrivals, args.demand_fraction, args.seed)
    base_off, base_sup = args.base_officer_multiplier, args.base_supervisor_multiplier
    print(f'Loaded {len(base_arrivals)} arrivals (demand_fraction={args.demand_fraction}). '
          f'Shock districts={shock_districts}, shock_days={args.shock_days}, '
          f'demand_mult={args.demand_multiplier}, base_off={base_off}, base_sup={base_sup}\n')

    rng = np.random.default_rng(args.seed)

    print('Running baseline ...')
    base = run_abm(base_arrivals, args.days, args.scenarios, args.top_districts, args.seed,
                   officer_mult=base_off, supervisor_mult=base_sup)
    print('   ' + '  '.join(f'{k}={base[k]:.0f}' for k in METRIC_KEYS))

    conditions = {'baseline': base}
    infos = {}
    for name, preset in PRESETS.items():
        print(f'Running shock: {name} ...')
        if preset['mode'] == 'demand_surge':
            arr, info = apply_demand_surge(base_arrivals, preset, shock_districts,
                                           args.shock_days, args.demand_multiplier, rng)
            infos[name] = info
            m = run_abm(arr, args.days, args.scenarios, args.top_districts, args.seed,
                        officer_mult=base_off * preset['officer_mult'],
                        supervisor_mult=base_sup * preset['supervisor_mult'])
        elif preset['mode'] == 'capacity':
            infos[name] = {'officer_mult': args.officer_capacity_multiplier}
            m = run_abm(base_arrivals, args.days, args.scenarios, args.top_districts, args.seed,
                        officer_mult=base_off * args.officer_capacity_multiplier, supervisor_mult=base_sup)
        else:  # capacity_review
            arr = boost_all_suplike(base_arrivals, preset.get('suplike_boost_all', 0.0))
            infos[name] = {'supervisor_mult': args.supervisor_capacity_multiplier,
                           'suplike_boost_all': preset.get('suplike_boost_all', 0.0)}
            m = run_abm(arr, args.days, args.scenarios, args.top_districts, args.seed,
                        officer_mult=base_off, supervisor_mult=base_sup * args.supervisor_capacity_multiplier)
        conditions[name] = m
        print('   ' + '  '.join(f'{k}={m[k]:.0f}' for k in METRIC_KEYS))

    # Assemble summary.
    base_red = {r['district'] for r in base['_red_zones']}
    summary = {
        'config': {
            'arrivals': str(args.arrivals), 'n_arrivals': len(base_arrivals),
            'days': args.days, 'scenarios': args.scenarios, 'top_districts': args.top_districts,
            'seed': args.seed, 'shock_districts': shock_districts, 'shock_days': args.shock_days,
            'demand_multiplier': args.demand_multiplier,
            'demand_fraction': args.demand_fraction,
            'base_officer_multiplier': base_off, 'base_supervisor_multiplier': base_sup,
            'officer_capacity_multiplier': args.officer_capacity_multiplier,
            'supervisor_capacity_multiplier': args.supervisor_capacity_multiplier,
            'material_pct_threshold': MATERIAL_PCT, 'material_spearman_threshold': MATERIAL_SPEARMAN,
        },
        'framing': ('Public 311 benchmark; synthetic demand for capacity planning and decision '
                    'support only. Not live Brampton data, not enforcement decisioning. Queue flow '
                    'of operational pressure propagation under capacity-constrained queue pressure.'),
        'conditions': {},
    }
    for name, m in conditions.items():
        entry = {k: round(m[k], 1) for k in METRIC_KEYS}
        entry['red_zone_districts'] = [r['district'] for r in m['_red_zones']]
        entry['red_zone_count'] = len(m['_red_zones'])
        entry['district_rank_spearman_vs_baseline'] = round(rank_spearman(base['_district_vector'], m['_district_vector']), 4)
        entry['complaint_rank_spearman_vs_baseline'] = round(rank_spearman(base['_complaint_vector'], m['_complaint_vector']), 4)
        if name != 'baseline':
            pct = {k: round(100.0 * (m[k] - base[k]) / base[k], 1) if base[k] else None for k in METRIC_KEYS}
            entry['pct_change_vs_baseline'] = pct
            win = infos.get(name, {}).get('concentrate_window_days', args.shock_days)
            entry['recovery'] = recovery_vs_baseline(base['_backlog_series'], m['_backlog_series'], win)
            entry['new_red_zones'] = sorted(set(entry['red_zone_districts']) - base_red)
            entry['recommended_action'] = recommended_action(name, pct)
            entry['shock_info'] = infos.get(name, {})
            entry['material'] = bool(any(p is not None and abs(p) >= MATERIAL_PCT for p in pct.values())
                                     or entry['new_red_zones'])
        summary['conditions'][name] = entry

    (args.out / f'{args.prefix}_results.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')

    fieldnames = (['condition'] + METRIC_KEYS + ['red_zone_count', 'new_red_zones',
                  'district_rank_spearman', 'recovering', 'material']
                  + [f'{k}_pct_change' for k in METRIC_KEYS])
    with open(args.out / f'{args.prefix}_results.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for name, e in summary['conditions'].items():
            row = {'condition': name}
            row.update({k: e[k] for k in METRIC_KEYS})
            row['red_zone_count'] = e['red_zone_count']
            row['new_red_zones'] = ';'.join(e.get('new_red_zones', []))
            row['district_rank_spearman'] = e['district_rank_spearman_vs_baseline']
            row['recovering'] = e.get('recovery', {}).get('recovering', '')
            row['material'] = e.get('material', '')
            for k in METRIC_KEYS:
                row[f'{k}_pct_change'] = e.get('pct_change_vs_baseline', {}).get(k, '')
            w.writerow(row)

    write_shock_summary(args.out / f'{args.prefix}_summary.md', summary)

    # Honest headline findings.
    shocks = {n: e for n, e in summary['conditions'].items() if n != 'baseline'}
    worst_backlog = max(shocks, key=lambda n: shocks[n]['pct_change_vs_baseline'].get('final_backlog') or -1e9)
    worst_sup = max(shocks, key=lambda n: shocks[n]['pct_change_vs_baseline'].get('supervisor_queue_peak') or -1e9)
    print('\n=== SHOCK SUMMARY ===')
    for n, e in shocks.items():
        pct = e['pct_change_vs_baseline']
        print(f'  {n:34} backlog={pct["final_backlog"]:+.1f}% sup_peak={pct["supervisor_queue_peak"]:+.1f}% '
              f'new_red={e["new_red_zones"]} recovering={e["recovery"]["recovering"]}')
    print(f'\nWorst backlog shock: {worst_backlog}')
    print(f'Worst supervisor bottleneck shock: {worst_sup}')
    print(f'\nWrote: {args.out / (args.prefix + "_results.json")}')
    print(f'Wrote: {args.out / (args.prefix + "_results.csv")}')
    print(f'Wrote: {args.out / (args.prefix + "_summary.md")}')


def write_shock_summary(path, summary):
    cfg = summary['config']
    base = summary['conditions']['baseline']
    L = []
    L.append('# Municipal service shock summary\n')
    L.append('What happens under a realistic municipal service shock? Each shock applies a '
             'distribution shift (complaint amplification / reporting surge, district concentration, '
             'pressure-score increases, or capacity reductions) on the persisted 500k arrivals and '
             're-runs the queue flow. Unlike the shuffle test, shocks change the marginals, so they '
             'can move aggregate backlog.\n')
    L.append('Public 311 benchmark; synthetic demand for capacity planning and decision support only. '
             'Not live Brampton data, not enforcement decisioning. Queue flow of operational pressure '
             'propagation under capacity-constrained queue pressure.\n')
    L.append(f'- shock districts: {cfg["shock_districts"]}; shock days: {cfg["shock_days"]}; '
             f'demand multiplier: {cfg["demand_multiplier"]}; officer capacity multiplier: '
             f'{cfg["officer_capacity_multiplier"]}; supervisor capacity multiplier: '
             f'{cfg["supervisor_capacity_multiplier"]}')
    L.append(f'- days={cfg["days"]}, scenarios={cfg["scenarios"]}, top_districts={cfg["top_districts"]}\n')

    L.append('## Baseline (mean across scenarios)\n')
    for k in METRIC_KEYS:
        L.append(f'- {k.replace("_", " ")}: {base[k]:.0f}')
    L.append(f'- red zone districts: {base["red_zone_count"]}\n')

    L.append('## Shocks vs baseline (% change)\n')
    L.append('| shock | ' + ' | '.join(k.replace('_', ' ') for k in METRIC_KEYS)
             + ' | new red zones | recovering | action |')
    L.append('|' + '---|' * (len(METRIC_KEYS) + 4))
    for n, e in summary['conditions'].items():
        if n == 'baseline':
            continue
        pct = e['pct_change_vs_baseline']
        cells = ' | '.join(f'{pct[k]:+.1f}%' if pct.get(k) is not None else '—' for k in METRIC_KEYS)
        nr = ','.join(e['new_red_zones']) or '—'
        L.append(f'| {n} | {cells} | {nr} | {e["recovery"]["recovering"]} | {e["recommended_action"]} |')
    L.append('')

    shocks = {n: e for n, e in summary['conditions'].items() if n != 'baseline'}
    worst_b = max(shocks, key=lambda n: shocks[n]['pct_change_vs_baseline'].get('final_backlog') or -1e9)
    worst_s = max(shocks, key=lambda n: shocks[n]['pct_change_vs_baseline'].get('supervisor_queue_peak') or -1e9)
    L.append('## Honest read\n')
    L.append(f'- Worst backlog shock: **{worst_b}** '
             f'({shocks[worst_b]["pct_change_vs_baseline"]["final_backlog"]:+.1f}% final backlog).')
    L.append(f'- Worst supervisor bottleneck shock: **{worst_s}** '
             f'({shocks[worst_s]["pct_change_vs_baseline"]["supervisor_queue_peak"]:+.1f}% supervisor peak).')
    # demand vs capacity comparison
    surge = [n for n in shocks if shocks[n].get('shock_info', {}).get('injected')]
    cap = 'staff_capacity_drop'
    if cap in shocks and surge:
        surge_best = max(surge, key=lambda n: shocks[n]['pct_change_vs_baseline']['final_backlog'])
        cb = shocks[cap]['pct_change_vs_baseline']['final_backlog']
        sb = shocks[surge_best]['pct_change_vs_baseline']['final_backlog']
        if cb >= sb:
            L.append(f'- Capacity is the stronger backlog driver: `staff_capacity_drop` moves backlog '
                     f'{cb:+.1f}% vs {sb:+.1f}% for the strongest demand surge (`{surge_best}`).')
        else:
            L.append(f'- Demand surge + district concentration drive backlog more than the capacity drop: '
                     f'`{surge_best}` {sb:+.1f}% vs `staff_capacity_drop` {cb:+.1f}%.')
    L.append('- District and complaint-type pressure rankings remain near-constant under CTGAN numeric '
             'effects; ranking shifts here come from where the shock concentrates demand, not from the '
             'CTGAN scores. Base district/complaint load is bootstrap-driven.\n')
    L.append('## Prevention actions (capacity planning, decision support only)\n')
    L.append('- Move field capacity into the affected districts ahead of the surge window.')
    L.append('- Increase supervisor review capacity when the bottleneck is review, not field work.')
    L.append('- Triage repeat complaints and separate duplicate complaints to cut rework and review load.')
    L.append('- Prioritize high-pressure (red zone) districts first.')
    path.write_text('\n'.join(L), encoding='utf-8')


if __name__ == '__main__':
    main()
