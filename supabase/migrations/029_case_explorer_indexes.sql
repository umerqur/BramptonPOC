-- 029_case_explorer_indexes.sql
--
-- Case Explorer / Insights statement-timeout fix (SQLSTATE 57014). The default
-- Case Explorer query filters source_city = 'NYC' and orders by submitted_at
-- desc over the ~3.4M-row public.municipal_complaints table; without a matching
-- index the planner falls back to a full scan + sort and trips the Postgres
-- statement timeout.
--
-- These partial indexes ((column, submitted_at desc) WHERE source_city = 'NYC'
-- AND submitted_at IS NOT NULL) let the default page and the common drilldowns
-- (complaint type, borough, council district, status) be served straight from an
-- index. Plain btree exact-ID indexes back the exact case_id / source_dataset_id
-- lookups used by search.
--
-- Plain CREATE INDEX (not CONCURRENTLY) so the file runs inside the Supabase
-- migration runner's transaction. IF NOT EXISTS keeps it idempotent and leaves
-- any equivalent index from migrations 024–026 untouched.

create index if not exists idx_mc_nyc_source_submitted_at
on public.municipal_complaints (source_city, submitted_at desc)
where source_city = 'NYC'
  and submitted_at is not null;

create index if not exists idx_mc_nyc_complaint_type_submitted_at
on public.municipal_complaints (complaint_type, submitted_at desc)
where source_city = 'NYC'
  and submitted_at is not null;

create index if not exists idx_mc_nyc_borough_submitted_at
on public.municipal_complaints (borough, submitted_at desc)
where source_city = 'NYC'
  and submitted_at is not null;

create index if not exists idx_mc_nyc_council_district_submitted_at
on public.municipal_complaints (council_district, submitted_at desc)
where source_city = 'NYC'
  and submitted_at is not null;

create index if not exists idx_mc_nyc_status_submitted_at
on public.municipal_complaints (status, submitted_at desc)
where source_city = 'NYC'
  and submitted_at is not null;

create index if not exists idx_mc_nyc_case_id
on public.municipal_complaints (case_id);

create index if not exists idx_mc_nyc_source_dataset_id
on public.municipal_complaints (source_dataset_id);
