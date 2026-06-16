# NYC 311 Open Data — Public Benchmark for the Brampton POC

This POC is a **Brampton compatible Proactive Enforcement Response POC modelled
using NYC 311 Open Data as a public benchmark source.** It is **not Brampton
operational data.** The workflow is designed to connect to equivalent Brampton
internal service request, patrol, inspection, ticket, and closure data during the
POC.

- Dataset: NYC 311 Service Requests from 2010 to Present
- Socrata id: `erm2-nwe9`
- Query endpoint: `https://data.cityofnewyork.us/api/v3/views/erm2-nwe9/query.json`
  (the pipeline uses the SODA resource endpoint `…/resource/erm2-nwe9.json`)

## 1. Why NYC 311 was selected

NYC 311 has a **richer service-request schema** than the thinner 311 exports of
many cities. It carries the lifecycle and disposition fields an enforcement
system actually runs on — created/closed timestamps, responding agency, problem
and descriptor, status, due date, **resolution description**, resolution-action
timestamps, channel, and geography. That makes it a far better stand-in for what
a Brampton internal enforcement system would contain, so the closure-review
workflow can be demonstrated realistically on public data.

## 2. Why this is appropriate public benchmark data

- **Public and open.** NYC 311 is open data with no personally identifying
  complainant information, so it is safe to use for modelling, schema design, and
  demo analytics.
- **Large and current.** ~20.5M records match the closure-workflow filter
  (`closed_date IS NOT NULL AND resolution_description IS NOT NULL`); it updates
  daily and spans 2020-01-01 → present. We use the **latest 1-year window**
  (currently **~3.69M** rows), paginated with `$limit`/`$offset` — **not** the
  full set.
- **Schema-aligned.** Its fields map cleanly onto the Brampton compatible
  workflow concepts (below), so nothing about the workflow is NYC-specific.

## 3. Field mapping — NYC 311 → Brampton compatible workflow

| NYC 311 field | Normalized field | Brampton compatible workflow concept |
| --- | --- | --- |
| `unique_key` | `case_id` | Service request / case id |
| `created_date` | `created_at` | Intake timestamp |
| `closed_date` | `closed_at` | Closure timestamp |
| `agency` | `agency` | Responsible department (code) |
| `agency_name` | `agency_name` | Responsible department / assignment |
| `complaint_type` | `request_type` | Complaint / request type |
| `descriptor` | `request_detail` | Request detail |
| `descriptor_2` | `request_detail_2` | Secondary detail |
| `location_type` | `location_type` | Location type |
| `status` | `status` | Workflow status |
| `due_date` | `due_date` | SLA / due date |
| `resolution_description` | `resolution_description` | Recorded outcome → **closure scenario source** |
| `resolution_action_updated_date` | `resolution_action_updated_at` | Last enforcement action timestamp |
| `open_data_channel_type` | `channel` | Intake channel |
| `borough` | `borough` (→ `ward_or_area`) | Service area / geography |
| `council_district` | `council_district` | Service area / geography |
| `incident_zip` | `incident_zip` | Location |
| `latitude` / `longitude` | `latitude` / `longitude` | Geocoordinates |
| — | `source_city = NYC` | Provenance |
| — | `source_dataset = NYC 311 Service Requests from 2020 to Present` | Provenance |
| — | `source_dataset_id = erm2-nwe9` | Provenance |

NYC geography is **borough / council district** (NYC has no wards). The legacy
Toronto ward geography objects (`toronto_ward_boundaries`,
`v_toronto_ward_workload`) are retained only for rollback.

## 4. What would be replaced by Brampton internal data during the POC

The benchmark is a stand-in. During the POC these would be swapped for Brampton
internal sources, mapped onto the same normalized schema:

- **Service requests / complaints** → Brampton 311 / by-law complaint intake.
- **Resolution / closure outcomes** → Brampton enforcement closure records.
- **Patrol logs, inspections, tickets** → Brampton officer field/inspection and
  ticketing systems (currently synthetic POC operational context).
- **Geography** → Brampton ward / area boundaries.

No code change to the workflow is required — only the loaded data source.

## 5. Disclaimer

**No Brampton operational data is used in this POC.** All complaint data is
public NYC 311 benchmark data; patrol logs, ticket records, and closure templates
are clearly labelled synthetic POC operational context; resident submissions are
demo data. Every model output and disclaimer states this. The resident-facing
final closure message is **rules based, policy aligned, template controlled, and
staff approved** — AI assists only with triage, summary, context gathering, and
workload support.

## Pipeline (reproducible)

```bash
# 1. Fetch the latest 1-year window (closed + resolution present), limit/offset paging.
#    Anonymous works (throttled); set NYC_OPEN_DATA_APP_TOKEN to raise the limit.
python scripts/fetch_nyc311_sample.py                 # whole 1-year window (~3.69M)
python scripts/fetch_nyc311_sample.py --max-rows 500000   # bounded validation run
python scripts/fetch_nyc311_sample.py --since-days 365    # explicit window size

# 2. Normalize to the Brampton compatible schema
python scripts/clean_nyc311_service_requests.py

# 3. Derive rule-based closure templates from resolution_description patterns
python scripts/build_nyc311_closure_templates.py

# 4. Load to Supabase (credentialed: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
python scripts/upload_nyc311_to_supabase.py
```

The fetch is **1 year**, not the full ~20.5M-row dataset. For a multi-million-row
load prefer a direct Postgres `COPY` over the REST upload, run in a persistent
environment with an app token.
