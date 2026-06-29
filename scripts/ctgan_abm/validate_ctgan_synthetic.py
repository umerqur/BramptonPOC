#!/usr/bin/env python3
"""Validate CTGAN synthetic arrivals against the real public 311 benchmark sample.

Compares the engineered REAL public NYC 311 benchmark rows that fed the CTGAN
against the SYNTHETIC arrivals the pipeline generated, and writes distance
metrics + overlay charts. Local-only: reads local CSVs, writes local files. It
does NOT touch Supabase, train anything, upload anything, or change any UI.

Real (public 311 benchmark):
    data/ctgan_abm/municipal_complaints_training_sample_500k.csv
Synthetic (generated demand):
    outputs/ctgan_abm_500k/synthetic_complaint_arrivals.csv

Outputs (under outputs/ctgan_abm_500k/validation/):
    validation_metrics.json     -- all metrics + provenance
    validation_categorical.csv  -- per categorical field: JS + total-variation
    validation_numeric.csv      -- per numeric field: KS + Wasserstein
    charts/*.png                -- real-vs-synthetic overlays

IMPORTANT framing (see docs/ctgan_abm_validation.md):
  * This is PUBLIC 311 BENCHMARK data used to model SYNTHETIC DEMAND for
    CAPACITY PLANNING and DECISION SUPPORT only. It is not Brampton operational
    data and implies no enforcement automation.
  * These metrics measure DISTRIBUTIONAL SIMILARITY, not validated forecast
    accuracy.
  * The generator is HYBRID: the CTGAN produces the numeric demand-intensity
    scores; categorical fields are bootstrapped (resampled) from real rows.
    => Categorical similarity is a SANITY CHECK that bootstrap preserved the
       marginals, NOT proof the GAN learned categories.
    => The numeric scores are the genuine CTGAN fidelity check.

Requires: numpy, scipy, matplotlib (stdlib for the rest).
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree
from scipy.spatial.distance import jensenshannon
from scipy.stats import ks_2samp, wasserstein_distance

import matplotlib
matplotlib.use('Agg')  # headless: write PNGs, never open a window
import matplotlib.pyplot as plt

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

DEFAULT_REAL = Path('data/ctgan_abm/municipal_complaints_training_sample_500k.csv')
DEFAULT_SYNTH = Path('outputs/ctgan_abm_500k/synthetic_complaint_arrivals.csv')
DEFAULT_OUT = Path('outputs/ctgan_abm_500k/validation')

# Numeric demand-intensity scores the GAN actually generates AND that exist on
# both sides -> the genuine fidelity check.
NUMERIC_FIELDS = ['patrol_intensity_score', 'repeat_pressure_score']

# Categorical fields compared as a bootstrap sanity check.
CATEGORICAL_FIELDS = ['complaint_type', 'district', 'borough', 'closure_bucket', 'supervisor_flag']

TOP_N_CHART = 12  # categories shown per categorical overlay chart


# ---------------------------------------------------------------------------
# Mapping helpers -- mirror run_ctgan_abm_stress_lab.py so the REAL side is
# turned into the same categories the synthetic side already carries. Kept local
# (not imported) so this validator has no torch dependency.
# ---------------------------------------------------------------------------

def _clean(v) -> str:
    return (v or '').strip()


def map_district(row: dict) -> str:
    cd = _clean(row.get('council_district'))
    if cd:
        return cd
    borough = _clean(row.get('borough'))
    if borough and borough.lower() != 'unspecified':
        return borough
    return 'Unknown'


def map_complaint_type(row: dict) -> str:
    ct = _clean(row.get('complaint_type'))
    if ct:
        return ct
    rd = _clean(row.get('request_detail'))
    if rd:
        return rd
    return 'Other'


def map_closure_bucket(row: dict) -> str:
    cb = _clean(row.get('closure_bucket'))
    return cb if cb else 'unknown'


def map_borough(row: dict) -> str:
    b = _clean(row.get('borough'))
    return b if b else 'Unknown'


def _to_float(v):
    try:
        f = float(v)
        return f if np.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _truthy_flag(v) -> str:
    """Normalise supervisor flag from either side to '0'/'1'."""
    s = str(v).strip().lower()
    if s in ('1', 'true', 't', 'yes', 'y'):
        return '1'
    if s in ('0', 'false', 'f', 'no', 'n', ''):
        return '0'
    return '0'


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------

def load_side(path: Path, is_real: bool) -> dict:
    """Return {categorical: {field: [values]}, numeric: {field: np.array}}."""
    cats = {f: [] for f in CATEGORICAL_FIELDS}
    nums = {f: [] for f in NUMERIC_FIELDS}
    n = 0
    with open(path, 'r', encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f)
        for row in reader:
            n += 1
            if is_real:
                cats['complaint_type'].append(map_complaint_type(row))
                cats['district'].append(map_district(row))
                cats['borough'].append(map_borough(row))
                cats['closure_bucket'].append(map_closure_bucket(row))
                cats['supervisor_flag'].append(_truthy_flag(row.get('supervisor_review_likelihood')))
            else:
                # synthetic file already carries the mapped categoricals
                cats['complaint_type'].append(_clean(row.get('complaint_type')) or 'Other')
                cats['district'].append(_clean(row.get('district')) or 'Unknown')
                cats['borough'].append(map_borough(row))
                cats['closure_bucket'].append(map_closure_bucket(row))
                cats['supervisor_flag'].append(_truthy_flag(row.get('supervisor_review_required')))
            for nf in NUMERIC_FIELDS:
                val = _to_float(row.get(nf))
                if val is not None:
                    nums[nf].append(val)
    nums = {k: np.asarray(v, dtype=np.float64) for k, v in nums.items()}
    return {'categorical': cats, 'numeric': nums, 'n_rows': n}


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

def categorical_distributions(real_vals, synth_vals):
    """Aligned probability vectors over the union of categories."""
    cats = sorted(set(real_vals) | set(synth_vals))
    idx = {c: i for i, c in enumerate(cats)}
    p = np.zeros(len(cats)); q = np.zeros(len(cats))
    for v in real_vals:
        p[idx[v]] += 1
    for v in synth_vals:
        q[idx[v]] += 1
    p = p / p.sum() if p.sum() else p
    q = q / q.sum() if q.sum() else q
    return cats, p, q


def total_variation(p, q) -> float:
    return float(0.5 * np.abs(p - q).sum())


def js_distance(p, q) -> float:
    # scipy returns the Jensen-Shannon DISTANCE (sqrt of divergence); base 2 -> [0,1]
    d = jensenshannon(p, q, base=2)
    return float(d) if np.isfinite(d) else 0.0


def numeric_nn_privacy(real_num, synth_num, seed=42, sample=5000):
    """Distance-to-closest-record check in the shared numeric space.

    Compares synthetic->real nearest-neighbour distances against a real->real
    baseline. If synthetic points are not systematically closer to real points
    than real points are to each other, there is no sign of memorisation.

    Honest scope: only the 2 shared numeric dims, on PUBLIC benchmark data with
    no PII; categoricals are deliberately resampled real tuples and are excluded
    (their NN distance is trivially zero by construction). This is a disclosure-
    distance sanity check, not a formal privacy guarantee.
    """
    fields = [f for f in NUMERIC_FIELDS if real_num[f].size and synth_num[f].size]
    if len(fields) < 1:
        return None
    rng = np.random.default_rng(seed)

    real_mat = np.column_stack([real_num[f] for f in fields])
    synth_mat = np.column_stack([synth_num[f] for f in fields])

    tree = cKDTree(real_mat)

    # synthetic -> nearest real
    s_idx = rng.choice(synth_mat.shape[0], size=min(sample, synth_mat.shape[0]), replace=False)
    s_dist, _ = tree.query(synth_mat[s_idx], k=1)

    # real -> nearest OTHER real (k=2, drop self at distance 0)
    r_idx = rng.choice(real_mat.shape[0], size=min(sample, real_mat.shape[0]), replace=False)
    r_dist, _ = tree.query(real_mat[r_idx], k=2)
    r_dist = r_dist[:, 1]

    exact = int(np.sum(s_dist == 0.0))
    return {
        'fields': fields,
        'n_synth_sampled': int(s_idx.size),
        'n_real_sampled': int(r_idx.size),
        'synth_to_real_nn': {
            'min': float(np.min(s_dist)), 'p05': float(np.percentile(s_dist, 5)),
            'median': float(np.median(s_dist)), 'mean': float(np.mean(s_dist)),
        },
        'real_to_real_nn': {
            'min': float(np.min(r_dist)), 'p05': float(np.percentile(r_dist, 5)),
            'median': float(np.median(r_dist)), 'mean': float(np.mean(r_dist)),
        },
        'synth_exact_match_count': exact,
        'synth_exact_match_pct': round(100.0 * exact / s_idx.size, 3),
        'interpretation': (
            'synthetic->real NN distances >= real->real baseline indicates no '
            'numeric-space memorisation; exact matches expected to be non-zero '
            'only because the 2D score space is coarse, not because rows were copied.'
        ),
    }


# ---------------------------------------------------------------------------
# Charts
# ---------------------------------------------------------------------------

def chart_categorical(field, cats, p, q, out_dir):
    order = np.argsort(-(p + q))[:TOP_N_CHART]
    labels = [cats[i] for i in order]
    pr = [p[i] for i in order]; sy = [q[i] for i in order]
    x = np.arange(len(labels)); w = 0.4
    fig, ax = plt.subplots(figsize=(11, 5))
    ax.bar(x - w / 2, pr, w, label='Real (public 311 benchmark)', color='#2563eb')
    ax.bar(x + w / 2, sy, w, label='Synthetic demand', color='#f59e0b')
    ax.set_title(f'{field}: real vs synthetic (top {len(labels)} by share)')
    ax.set_ylabel('proportion')
    ax.set_xticks(x); ax.set_xticklabels(labels, rotation=45, ha='right', fontsize=8)
    ax.legend()
    fig.tight_layout()
    p_out = out_dir / f'cat_{field}.png'
    fig.savefig(p_out, dpi=110); plt.close(fig)
    return p_out


def chart_numeric(field, real_arr, synth_arr, out_dir):
    fig, ax = plt.subplots(figsize=(9, 5))
    bins = np.linspace(
        min(real_arr.min(), synth_arr.min()),
        max(real_arr.max(), synth_arr.max()), 40)
    ax.hist(real_arr, bins=bins, density=True, alpha=0.55,
            label='Real (public 311 benchmark)', color='#2563eb')
    ax.hist(synth_arr, bins=bins, density=True, alpha=0.55,
            label='Synthetic demand (CTGAN)', color='#f59e0b')
    ax.set_title(f'{field}: real vs synthetic distribution')
    ax.set_xlabel(field); ax.set_ylabel('density'); ax.legend()
    fig.tight_layout()
    p_out = out_dir / f'num_{field}.png'
    fig.savefig(p_out, dpi=110); plt.close(fig)
    return p_out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description='Validate CTGAN synthetic arrivals vs the real public 311 benchmark sample.')
    ap.add_argument('--real', type=Path, default=DEFAULT_REAL)
    ap.add_argument('--synthetic', type=Path, default=DEFAULT_SYNTH)
    ap.add_argument('--out', type=Path, default=DEFAULT_OUT)
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--no-charts', action='store_true', help='skip PNG generation')
    args = ap.parse_args()

    for p in (args.real, args.synthetic):
        if not p.exists():
            print(f'ERROR: input not found: {p}', file=sys.stderr)
            sys.exit(1)

    charts_dir = args.out / 'charts'
    args.out.mkdir(parents=True, exist_ok=True)
    if not args.no_charts:
        charts_dir.mkdir(parents=True, exist_ok=True)

    print(f'Loading real:      {args.real}')
    real = load_side(args.real, is_real=True)
    print(f'  {real["n_rows"]:,} rows')
    print(f'Loading synthetic: {args.synthetic}')
    synth = load_side(args.synthetic, is_real=False)
    print(f'  {synth["n_rows"]:,} rows')

    # Categorical metrics
    categorical_results = {}
    cat_csv_rows = []
    for field in CATEGORICAL_FIELDS:
        cats, p, q = categorical_distributions(real['categorical'][field], synth['categorical'][field])
        js = js_distance(p, q)
        tv = total_variation(p, q)
        only_real = sorted(set(real['categorical'][field]) - set(synth['categorical'][field]))
        only_synth = sorted(set(synth['categorical'][field]) - set(real['categorical'][field]))
        categorical_results[field] = {
            'jensen_shannon_distance': round(js, 6),
            'total_variation_distance': round(tv, 6),
            'n_categories_real': len(set(real['categorical'][field])),
            'n_categories_synth': len(set(synth['categorical'][field])),
            'categories_only_in_real': only_real[:25],
            'categories_only_in_synth': only_synth[:25],
        }
        cat_csv_rows.append({
            'field': field, 'jensen_shannon_distance': round(js, 6),
            'total_variation_distance': round(tv, 6),
            'n_categories_real': len(set(real['categorical'][field])),
            'n_categories_synth': len(set(synth['categorical'][field])),
        })
        if not args.no_charts:
            chart_categorical(field, cats, p, q, charts_dir)
        print(f'  [cat] {field:16} JS={js:.4f}  TV={tv:.4f}')

    # Numeric metrics
    numeric_results = {}
    num_csv_rows = []
    for field in NUMERIC_FIELDS:
        r = real['numeric'][field]; s = synth['numeric'][field]
        if r.size == 0 or s.size == 0:
            print(f'  [num] {field}: SKIPPED (missing on one side)')
            continue
        ks = ks_2samp(r, s)
        wd = wasserstein_distance(r, s)
        numeric_results[field] = {
            'ks_statistic': round(float(ks.statistic), 6),
            'ks_pvalue': float(ks.pvalue),
            'wasserstein_distance': round(float(wd), 6),
            'real_mean': round(float(r.mean()), 6), 'real_std': round(float(r.std()), 6),
            'synth_mean': round(float(s.mean()), 6), 'synth_std': round(float(s.std()), 6),
            'n_real': int(r.size), 'n_synth': int(s.size),
        }
        num_csv_rows.append({'field': field, **numeric_results[field]})
        if not args.no_charts:
            chart_numeric(field, r, s, charts_dir)
        print(f'  [num] {field:24} KS={ks.statistic:.4f}  Wasserstein={wd:.4f}')

    # Privacy NN check
    privacy = numeric_nn_privacy(real['numeric'], synth['numeric'], seed=args.seed)
    if privacy:
        print(f'  [privacy] synth->real NN mean={privacy["synth_to_real_nn"]["mean"]:.4f} '
              f'vs real->real NN mean={privacy["real_to_real_nn"]["mean"]:.4f} '
              f'(exact matches: {privacy["synth_exact_match_pct"]}%)')

    metrics = {
        'generated_at': datetime.now().isoformat(timespec='seconds'),
        'framing': (
            'Public 311 benchmark data; synthetic demand for capacity planning and '
            'decision support only. Distributional similarity, NOT validated forecast '
            'accuracy. Not Brampton operational data. No enforcement automation. The '
            'ABM models queue / operational pressure propagation.'
        ),
        'caveat': (
            'Hybrid generator: the CTGAN produces the numeric demand-intensity scores; '
            'categorical fields are bootstrapped (resampled) from real rows. Categorical '
            'similarity is therefore a bootstrap SANITY CHECK, not evidence the GAN '
            'learned categories. The numeric scores are the genuine CTGAN fidelity check.'
        ),
        'inputs': {
            'real': {'path': str(args.real), 'rows': real['n_rows'], 'sha256': sha256_of(args.real)},
            'synthetic': {'path': str(args.synthetic), 'rows': synth['n_rows'], 'sha256': sha256_of(args.synthetic)},
        },
        'categorical_sanity_check': categorical_results,
        'numeric_fidelity_check': numeric_results,
        'numeric_privacy_nearest_neighbor': privacy,
    }

    (args.out / 'validation_metrics.json').write_text(json.dumps(metrics, indent=2), encoding='utf-8')

    with open(args.out / 'validation_categorical.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['field', 'jensen_shannon_distance', 'total_variation_distance',
                                          'n_categories_real', 'n_categories_synth'])
        w.writeheader(); w.writerows(cat_csv_rows)

    with open(args.out / 'validation_numeric.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['field', 'ks_statistic', 'ks_pvalue', 'wasserstein_distance',
                                          'real_mean', 'real_std', 'synth_mean', 'synth_std',
                                          'n_real', 'n_synth'])
        w.writeheader(); w.writerows(num_csv_rows)

    print(f'\nWrote: {args.out / "validation_metrics.json"}')
    print(f'Wrote: {args.out / "validation_categorical.csv"}')
    print(f'Wrote: {args.out / "validation_numeric.csv"}')
    if not args.no_charts:
        print(f'Wrote charts to: {charts_dir}')


if __name__ == '__main__':
    main()
