# NYC 311 Raw Data

This folder is for local raw exports from the NYC Open Data 311 Service Requests dataset.

Dataset used for the Brampton Proactive Enforcement POC:

- Source: NYC Open Data
- Dataset: 311 Service Requests from 2020 to Present
- Dataset ID: `erm2-nwe9`
- Export URL: `https://data.cityofnewyork.us/api/views/erm2-nwe9/rows.csv?accessType=DOWNLOAD`
- API endpoint: `https://data.cityofnewyork.us/resource/erm2-nwe9.csv`

## Local files

The raw CSV files are intentionally ignored by Git because they can be large.

Expected local files:

```text
nyc311_partial_557mb.csv
nyc311_sample_50000.csv
```

The application should not read these raw files directly. Use the cleaning scripts in `scripts/` to normalize the data into `data/processed/municipal_service_requests.csv`.

## Why NYC 311 is used

NYC 311 provides real municipal service request patterns with timestamps, complaint categories, agency routing, status, resolution text, boroughs, and geospatial coordinates. The POC uses this as comparable public municipal data while keeping the schema ready for Brampton enforcement data if City data is provided later.

## Privacy note

Do not commit raw datasets to GitHub. Do not add personally identifying complainant information. Use this data only for public data modelling, schema design, and demo analytics.
