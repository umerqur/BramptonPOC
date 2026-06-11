# Toronto 311 Public Benchmark Raw Data

This folder is for local raw exports of the Toronto 311 public benchmark dataset used by the Brampton Proactive Enforcement POC.

- Source: City of Toronto Open Data Portal
- Dataset: 311 Service Requests (customer-initiated)
- The normalized working CSVs used by the pipeline scripts are kept outside the repo (see `scripts/eda_toronto311.py`, which reads `toronto_311_2026_normalized_full.csv` / `toronto_311_2026_normalized_sample_10000.csv` from the local Downloads folder).

## Local files

Raw and normalized CSV files are intentionally ignored by Git because they can be large. The application never reads these files directly — the data pipeline normalizes them into the Brampton compatible schema and uploads them to the Supabase `municipal_complaints` table, which the app reads.

## Why Toronto 311 is used

Toronto 311 provides real municipal service request patterns — timestamps, complaint categories, department routing, status, resolution text, ward geography, and geospatial coordinates — from a large Canadian municipality comparable to Brampton. The POC uses this as public benchmark data to demonstrate the closure review workflow while keeping the schema ready for Brampton enforcement data if City data is provided later. It is not Brampton operational data.

## Privacy note

Do not commit raw datasets to GitHub. Do not add personally identifying complainant information. Use this data only for public data modelling, schema design, and demo analytics.
