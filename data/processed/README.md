# Processed Municipal Data

This folder is for cleaned CSV outputs generated from the Toronto 311 public benchmark raw data.

Generated files are ignored by Git and should be recreated locally from the scripts in `scripts/`.

## Current pipeline

The Toronto 311 public benchmark data is normalized into the Brampton compatible complaint workflow schema and uploaded to Supabase:

- **`municipal_complaints`** — the active complaints table read by the app (cleaned, normalized Toronto 311 records).
- **`workload_insights_v1`** — v1 workload-density model outputs, produced by `scripts/train_workload_density_v1.py` and uploaded with `scripts/upload_workload_insights_v1.py`.
- **`workflow_ml_predictions`** — V2 "Needs Attention" model outputs, produced by `scripts/train_workflow_ml_v2.py` / `scripts/score_workflow_ml_v2_full.py` and uploaded with `scripts/upload_workflow_ml_predictions_v2.py`.

Exploratory analysis of the normalized Toronto 311 dataset lives in `scripts/eda_toronto311.py`, with outputs written to `reports/eda/`.

Every model output row carries provenance (source city, source dataset, model version, scoring period) and an advisory disclaimer: this is Toronto 311 public benchmark data, not Brampton operational data, and all outputs are decision support for staff approval only.

## Legacy

An earlier iteration of the POC used a different public 311 export normalized into `data/processed/municipal_service_requests.csv` and the legacy `municipal_service_requests` Supabase table (migration 001). That pipeline is legacy and no longer feeds the app.
