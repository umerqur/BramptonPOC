# Processed Municipal Data

This folder is for cleaned CSV outputs generated from raw municipal open data.

Generated files are ignored by Git and should be recreated locally from scripts.

Expected local output:

```text
municipal_service_requests.csv
```

This processed file is the one to upload into Supabase after running the cleaning pipeline.

## Normalized schema

The cleaning pipeline maps raw NYC 311 columns into Brampton POC friendly columns:

| Raw NYC 311 column | Normalized column |
| --- | --- |
| Unique Key | source_id |
| Created Date | opened_at |
| Closed Date | closed_at |
| Agency | agency |
| Agency Name | agency_name |
| Problem (formerly Complaint Type) | category |
| Problem Detail (formerly Descriptor) | subcategory |
| Additional Details | issue_detail |
| Location Type | location_type |
| Incident Zip | postal_code |
| Incident Address | address_label |
| Street Name | street_name |
| City | city |
| Status | status |
| Resolution Description | closure_text |
| Community Board | community_board |
| Council District | council_district |
| Borough | district |
| Open Data Channel Type | channel |
| Latitude | latitude |
| Longitude | longitude |

The processed output also adds:

```text
source_city
source_dataset
days_open
is_closed
risk_score
risk_level
recommended_action
risk_drivers
```

## Upload target

Upload `municipal_service_requests.csv` into the Supabase table created by:

```text
supabase/migrations/001_create_municipal_service_requests.sql
```
