# Target proxy assessment (workload risk)

There is **no ready-made workload-risk label**. Assessed proxies:

1. **Repeat/volume density (RECOMMENDED)** — complaints aggregated per ward (26 wards) and per address (10169 addresses, 4233 with >=3). Not leaky, fully populated, maps directly to 'where is enforcement workload concentrated'. This is the recommended target basis.
2. **Resolution duration (days_open)** — `closed_at` present in only **0.0%** of rows, so this is NOT reliably computable and is rejected as a primary target.
3. **Category severity** — depends on `complaint_type` but is circular with the derived `ai_priority`; use only as a feature, not a target.
