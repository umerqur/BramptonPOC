# CTGAN ABM — Synthetic vs Real Validation Evidence

This document records how the CTGAN-generated **synthetic demand** is checked
against the **real public NYC 311 benchmark** sample that fed the generator, and
the actual measured results.

> **Scope & framing.** This uses **public 311 benchmark data** to model
> **synthetic demand** for **capacity planning and decision support only**. The
> metrics here measure **distributional similarity — not validated forecast
> accuracy**. This is **not Brampton operational data** and implies **no
> enforcement automation**. The agent-based model downstream simulates **queue /
> operational pressure propagation** (a queueing model), not information
> propagation or contagion.

## How to reproduce

```bash
python scripts/ctgan_abm/validate_ctgan_synthetic.py \
  --real data/ctgan_abm/municipal_complaints_training_sample_500k.csv \
  --synthetic outputs/ctgan_abm_500k/synthetic_complaint_arrivals.csv \
  --out outputs/ctgan_abm_500k/validation
```

Inputs and outputs are local; the script touches no database and uploads
nothing. Generated artifacts live under `outputs/ctgan_abm_500k/validation/`
(git-ignored): `validation_metrics.json`, `validation_categorical.csv`,
`validation_numeric.csv`, and `charts/*.png` overlays. The script (`.py`) and
this doc are the tracked, reviewable parts.

## The most important caveat: the generator is hybrid

The pipeline does **not** use the GAN to invent categories. It is a **hybrid**:

- the **CTGAN generates the numeric demand-intensity scores**
  (`patrol_intensity_score`, `repeat_pressure_score`), and
- **categorical fields are bootstrapped** (resampled with replacement) from real
  rows — `complaint_type`, `district` (from `council_district`), `borough`,
  `closure_bucket`.

Two consequences drive how to read everything below:

1. **Categorical similarity is a SANITY CHECK, not a GAN result.** Because the
   categories are resampled real values, their distributions *should* match the
   real ones closely. A near-zero distance confirms the bootstrap preserved the
   marginals; it is **not** evidence that the GAN "learned" categories.
2. **The numeric scores are the genuine CTGAN fidelity check** — that is the only
   place the generative model is actually on the hook.

## Results (run on the 500k sample → 50k synthetic arrivals)

### Numeric fidelity — the real CTGAN test

`scipy.stats.ks_2samp` (KS statistic) and `scipy.stats.wasserstein_distance`,
scores on a 0–1 scale:

| Field | KS statistic | Wasserstein | Real mean | Synthetic mean | Read |
|---|---|---|---|---|---|
| `patrol_intensity_score` | 0.144 | 0.033 | 0.472 | 0.501 | Central tendency captured; moderate shape difference |
| `repeat_pressure_score` | 0.105 | 0.035 | 0.367 | 0.344 | Central tendency captured; moderate shape difference |

**Honest interpretation.** The GAN reproduces the **location and scale** of both
demand-intensity scores well (means within ~0.03, Wasserstein ≈ 0.03 — about 3%
of the score range), with a **moderate, measurable difference in shape**
(KS ≈ 0.10–0.14). This is a reasonable-but-imperfect marginal match — adequate
for stress/capacity-planning demand, not a claim of forecast accuracy.

> **Why the KS p-values are not quoted as evidence.** With 500k vs 50k rows the
> KS p-value is ≈ 0 for any non-identical distribution, so it is uninformative
> here. The **effect sizes** (KS statistic, Wasserstein) are the meaningful read,
> and they are recorded in `validation_metrics.json`.

### Categorical sanity check (bootstrap preservation)

`scipy.spatial.distance.jensenshannon` (base 2, i.e. 0–1) and total-variation
distance (`0.5·Σ|p−q|`):

| Field | Jensen–Shannon | Total variation | Read |
|---|---|---|---|
| `borough` | 0.004 | 0.003 | Bootstrap preserved (expected) |
| `closure_bucket` | 0.004 | 0.002 | Bootstrap preserved (expected) |
| `district` | 0.015 | 0.014 | Bootstrap preserved (expected) |
| `complaint_type` | 0.024 | 0.013 | Bootstrap preserved (expected) |
| `supervisor_flag` | 0.103 | 0.103 | **Not directly comparable — see below** |

The first four are near-zero, exactly as a correct bootstrap predicts. They
confirm the categorical sampling is faithful; they say nothing about generative
modelling of categories.

> **`supervisor_flag` is not a like-for-like comparison.** It is *not*
> bootstrapped. On the **real** side it is `supervisor_review_likelihood`, a
> keyword heuristic over the resolution text (~29.3% positive). On the
> **synthetic** side it is `supervisor_review_required`, a **rule** derived from
> the ABM triggers (long `closure_bucket`, or `patrol_intensity ≥ 0.65`, or
> `closure_pressure ≥ 0.70`; ~19.0% positive). The ~10-point gap reflects these
> **different definitions**, not generator error. It is included for
> completeness and is the least meaningful of the categorical rows.

### Numeric nearest-neighbor privacy check

A distance-to-closest-record check in the shared 2-D numeric score space
(`scipy.spatial.cKDTree`): synthetic→real nearest-neighbor distances vs a
real→real baseline.

| Measure | synthetic→real | real→real baseline |
|---|---|---|
| mean NN distance | 0.0278 | ~0.0 |
| median NN distance | 0.0094 | 0.0 |
| exact matches | 0.06% of sampled synthetic | — |

**Honest interpretation.** Synthetic points do **not** sit on top of real
records — only 0.06% are exact matches and the mean distance is non-trivial. The
real→real baseline collapses to ~0 because the engineered scores are derived from
frequency tables and contain many **identical score pairs** (heavy ties), so real
records are already coincident with each other. The takeaway is that the
generator shows **no sign of memorising** individual records in this space.

> **Scope of the privacy check.** It covers only the 2 shared numeric dimensions,
> on **public benchmark data with no PII**. Categorical fields are deliberately
> resampled real tuples, so their nearest-neighbor distance is trivially zero by
> construction and they are excluded. This is a disclosure-distance **sanity
> check, not a formal privacy guarantee**.

## Limitations / not yet covered

- **Only two numeric fields are jointly comparable** (`patrol_intensity_score`,
  `repeat_pressure_score`). `closure_pressure_score` is synthetic-only (derived
  from `closure_bucket`) and is excluded.
- **Temporal and per-case duration distributions are not validated yet.** The
  synthetic arrivals file does not currently persist the GAN's temporal numerics
  (day-of-week / month), and duration is represented only by the categorical
  `closure_bucket`. Validating temporal/duration would require the optional,
  separately-approved change to have the runner emit those columns.
- **Categorical fidelity is bootstrap-driven** (see caveat) and should never be
  presented as evidence the GAN models categories.
- These are **single-run** results (the 500k → 50k run). They describe
  distributional similarity of generated demand, **not** any forecast-accuracy or
  operational claim.

## Relationship to the other docs

- `docs/ctgan_abm_model.md` — pipeline, agents, and the queue / operational
  pressure propagation model.
- Migrations `033` → `034` — Supabase schema for the ABM metric tables (loading
  is a separate, manual, post-review step and is unrelated to this validation).
