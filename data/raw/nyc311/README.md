# NYC 311 Public Benchmark Raw Data

This folder is for local raw exports of the **NYC 311 Open Data** public benchmark dataset used by the Brampton compatible Proactive Enforcement Response POC.

- Source: NYC Open Data — 311 Service Requests from 2010 to Present
- Socrata dataset id: `erm2-nwe9`
- Query endpoint: `https://data.cityofnewyork.us/api/v3/views/erm2-nwe9/query.json`
- Pulled by `scripts/fetch_nyc311_sample.py` into `nyc311_sample.csv` (a controlled 100k–300k row sample, not the full 21.5M rows).

## Local files

Raw and normalized CSV files are intentionally ignored by Git because they can be large. The application never reads these files directly — the pipeline normalizes them into the Brampton compatible `municipal_complaints` schema and uploads them to Supabase, which the app reads.

## Why NYC 311 is used

NYC 311 provides real municipal service-request patterns with a **rich schema** — created/closed timestamps, agency, complaint type and descriptor, status, due date, resolution description and resolution-action timestamps, channel, borough, council district, and geocoordinates. That richer schema mimics what a Brampton internal enforcement system would likely contain far better than a thinner 311 export, which makes it a strong public benchmark for demonstrating the closure-review workflow. It is **not Brampton operational data**, and the workflow is designed to connect to equivalent Brampton internal service request, patrol, inspection, ticket, and closure data during the POC.

## Reproducible sample

Keep the sample reproducible: the fetch script filters to recent records where `closed_date` and `resolution_description` are not null and a useful `status` is present, and writes a fixed-size sample. Re-running with the same parameters reproduces the same controlled benchmark slice.

## Privacy note

Do not commit raw datasets to GitHub. Do not add personally identifying complainant information. Use this data only for public-data modelling, schema design, and demo analytics.
