# Processed Municipal Data

This folder is for cleaned CSV outputs generated from the **NYC 311 Open Data** public benchmark raw data.

Generated files are ignored by Git and should be recreated locally from the scripts in `scripts/`.

## Current pipeline (NYC 311)

The NYC 311 public benchmark data is normalized into the Brampton compatible complaint workflow schema and uploaded to Supabase:

1. **`scripts/fetch_nyc311_sample.py`** — pulls a controlled, reproducible sample (100k–300k rows) from the NYC 311 Socrata API (`erm2-nwe9`), filtered to recent records with useful `status`, `closed_date`, and `resolution_description` fields.
2. **`scripts/clean_nyc311_service_requests.py`** — normalizes the raw NYC 311 export into the Brampton compatible `municipal_complaints` schema (see field mapping in `docs/nyc311-benchmark.md`), preserving the richer NYC source fields.
3. **`scripts/build_nyc311_closure_templates.py`** — derives rule-based closure scenarios/templates from recurring NYC `resolution_description` patterns.
4. **`scripts/upload_nyc311_to_supabase.py`** — uploads the normalized complaints (and closure templates) to Supabase.

Tables the app reads:

- **`municipal_complaints`** — the active complaints table read by the app (cleaned, normalized NYC 311 records). Generic name — kept across the source change.
- **`workload_insights_v1`** — v1 workload-density model outputs (`scripts/train_workload_density_v1.py` → `scripts/upload_workload_insights_v1.py`).
- **`workflow_ml_predictions`** — legacy "Needs Attention" model outputs, retained for rollback.

Every model output row carries provenance (`source_city = NYC`, `source_dataset = NYC 311 Service Requests from 2020 to Present`, `source_dataset_id = erm2-nwe9`, model version, scoring period) and an advisory disclaimer: this is **NYC 311 public benchmark data, not Brampton operational data**, and all outputs are decision support for staff approval only.

## Why NYC 311

NYC 311 Open Data is the better public benchmark for this POC because its service-request schema (Created Date, Closed Date, Agency, Problem/Descriptor, Status, Due Date, Resolution Description, Resolution Action Updated Date, Channel, Borough, Council District, lat/long, etc.) closely mirrors what a Brampton internal enforcement system would contain. See `docs/nyc311-benchmark.md` for the full rationale and the field-to-workflow mapping.

## Legacy

- An earlier iteration normalized a different public 311 export into `data/processed/municipal_service_requests.csv` and the legacy `municipal_service_requests` Supabase table (migration 001). Legacy — no longer feeds the app.
- A prior iteration used **Toronto 311** with `scripts/eda_toronto311.py` and the `toronto_ward_boundaries` / `v_toronto_ward_workload` geography objects. Those objects are retained as legacy; the new NYC pipeline above is the current source. NYC geography is by **borough / council district** (NYC has no wards).
