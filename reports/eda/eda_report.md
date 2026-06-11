# Toronto 311 EDA Report

_Generated 2026-06-07 22:47 — EDA only. No model trained, no Supabase upload, no frontend change._

- Source file: `toronto_311_2026_normalized_full.csv`
- Rows: **190,511**  |  Columns: **26**
- Duplicate case_id: 0  |  Fully duplicate rows: 0

## Q1-Q4 Structure, types, missingness
See `column_profile.csv`. Highlights:

| column                | inferred_type         |   missing_pct |   n_distinct |
|:----------------------|:----------------------|--------------:|-------------:|
| case_id               | text/high-cardinality |          0    |       190511 |
| source_city           | categorical           |          0    |            1 |
| source_dataset        | categorical           |          0    |            1 |
| source_channel        | categorical           |          0    |            1 |
| submitted_at          | datetime              |          0    |       187334 |
| status                | categorical           |          0    |            6 |
| resolution_status     | categorical           |          0    |            6 |
| workflow_stage        | categorical           |          0    |            5 |
| fsa_or_area           | categorical           |          0    |          100 |
| intersection_street_1 | text/high-cardinality |         76.58 |         4613 |
| intersection_street_2 | text/high-cardinality |         76.73 |         4236 |
| address_or_location   | text/high-cardinality |          0    |        10169 |
| ward_or_area          | categorical           |          0    |           26 |
| complaint_type        | text/high-cardinality |          0    |          532 |
| assigned_department   | categorical           |          0    |            8 |
| department_unit       | categorical           |          0    |           24 |
| priority              | categorical           |          0    |            3 |
| ai_category           | categorical           |          0    |            6 |
| ai_priority           | categorical           |          0    |            3 |
| ai_summary            | text/high-cardinality |          0    |          533 |
| ai_recommended_action | categorical           |          0    |            6 |
| human_decision        | categorical           |        100    |            0 |
| closed_at             | datetime              |        100    |            0 |
| latitude              | float                 |        100    |            0 |
| longitude             | float                 |        100    |            0 |
| description           | text/high-cardinality |          0    |        50752 |

## Q5 Useful-for-ML features
`complaint_type`, `assigned_department`, `department_unit`, `source_channel`, `fsa_or_area`, `ward_or_area`, `latitude`, `longitude`, `submitted_at(hour/dow/month)`

## Q6 Leakage audit
See `leakage_audit.csv`. Derived/outcome columns must be excluded from any predictive target:

| column                | leakage_type                     |   evidence_value | verdict   |
|:----------------------|:---------------------------------|-----------------:|:----------|
| ai_category           | derived from complaint_type      |           1      | LEAKAGE   |
| ai_priority           | derived from complaint_type      |           1      | LEAKAGE   |
| ai_summary            | derived from complaint_type      |           1      | LEAKAGE   |
| ai_recommended_action | derived from complaint_type      |           0.8198 | REVIEW    |
| priority              | derived from complaint_type      |           1      | LEAKAGE   |
| status                | post-outcome / resolution state  |         nan      | LEAKAGE   |
| resolution_status     | post-outcome / resolution state  |         nan      | LEAKAGE   |
| workflow_stage        | post-outcome / resolution state  |         nan      | LEAKAGE   |
| closed_at             | post-outcome / resolution state  |         nan      | LEAKAGE   |
| human_decision        | post-outcome / resolution state  |         nan      | LEAKAGE   |
| case_id               | identifier / templated free text |         nan      | EXCLUDE   |
| description           | identifier / templated free text |         nan      | EXCLUDE   |

## Q7 Target proxy for workload risk
There is **no ready-made workload-risk label**. Assessed proxies:

1. **Repeat/volume density (RECOMMENDED)** — complaints aggregated per ward (26 wards) and per address (10169 addresses, 4233 with >=3). Not leaky, fully populated, maps directly to 'where is enforcement workload concentrated'. This is the recommended target basis.
2. **Resolution duration (days_open)** — `closed_at` present in only **0.0%** of rows, so this is NOT reliably computable and is rejected as a primary target.
3. **Category severity** — depends on `complaint_type` but is circular with the derived `ai_priority`; use only as a feature, not a target.

## Q8 days_open / resolution duration feasibility
- rows: 190511
- closed_at_present: 0
- closed_at_present_pct: 0.0
- days_open_computable: 0

## Q9-Q13 Distributions
- Complaint categories (distinct complaint_type): 532 — chart `distributions/category_complaint_type.png`
- Status distribution — chart `distributions/status.png`
- Department distribution — chart `distributions/department.png`
- Location coverage: valid lat/long 0.0%, ward_or_area present 100.0%, fsa present 100.0%
- Time span: 2026-01-01 00:21:51 -> 2026-04-30 23:58:21 (4 months) — charts time_by_hour/dayofweek/month.png

## Q14 Repeat-location patterns
- ward_or_area__distinct: 26
- ward_or_area__max_repeat: 12239
- ward_or_area__locations_ge_3: 26
- fsa_or_area__distinct: 100
- fsa_or_area__max_repeat: 44612
- fsa_or_area__locations_ge_3: 100
- address_or_location__distinct: 10169
- address_or_location__max_repeat: 3941
- address_or_location__locations_ge_3: 4233
- See `distributions/repeat_locations.png` and `complaints_per_address_hist.png`

## Q15 Demographics
No age, gender, race, income, or other demographic/personal fields exist in this dataset. The columns are operational and geographic only. No demographic attributes will be inferred or invented.

## Q16 Linear vs non-linear -> model family
Predictors are dominated by **high-cardinality categoricals** (complaint_type, department, ward, FSA) and **spatial coordinates**, where category->rate relationships are non-monotonic and location effects cluster spatially. Linear/additive assumptions fit poorly; interactions matter. This **justifies tree-based / gradient-boosting models**, with a linear model kept only as an interpretable baseline. (Quantify before modeling via mutual information and category-rate plots vs the chosen volume proxy.)

## Q17 Assumption checks that apply
- Leakage audit (deterministic complaint_type -> ai_* / priority mapping) — primary check.
- Target-proxy validity and value distribution / class balance.
- Categorical cardinality and rare-level/encoding strategy.
- Multicollinearity / redundancy (only for the linear baseline).
- Missingness mechanism (is closed_at / geo missingness informative?).
- Temporal coverage & drift (single-year span?) -> time-aware validation split.
- Spatial autocorrelation (repeat-location clustering) -> grouped validation by location/ward.
- NOT applicable for trees: residual normality, homoscedasticity, linearity-of-logits.

## Toronto City Wards GeoJSON
- Features: 25 | geometry: MultiPolygon | CRS: urn:ogc:def:crs:OGC:1.3:CRS84
- Property keys: AREA_ATTR_ID, AREA_CLASS, AREA_CLASS_ID, AREA_DESC, AREA_ID, AREA_LONG_CODE, AREA_NAME, AREA_SHORT_CODE, AREA_TYPE, AREA_TYPE_ID, DATE_EFFECTIVE, DATE_EXPIRY, FEATURE_CODE, FEATURE_CODE_DESC, OBJECTID, PARENT_AREA_ID, TRANS_ID_CREATE, TRANS_ID_EXPIRE, _id
- `ward_or_area` distinct values: 26 | GeoJSON wards: 25
- Match rate (normalized by ward number): **100.0%** (raw AREA_DESC string match was 60.67% before fixing '(07)' vs '(7)' zero-padding)
- Unmatched ward values after normalization: ['Unknown']
- **Replacement verdict:** these are REAL Toronto ward polygons; the 311 volumes aggregate into them by name, so they can drive a real-data Toronto ward workload map (`ward_workload_real.csv` / `.png`), replacing any synthetic Toronto-ward shading. This is Toronto geography and must NOT be plotted onto Brampton wards.
