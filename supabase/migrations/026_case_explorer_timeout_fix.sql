-- 026_case_explorer_timeout_fix.sql
--
-- Definitive fix for the Insights Case Explorer / Open Cases statement timeout
-- (SQLSTATE 57014, "canceling statement due to statement timeout") seen when
-- drilling into a high-volume complaint type (e.g. "Illegal Parking" or
-- "Noise - Commercial") over the ~3.4M-row public.municipal_complaints table.
--
-- Migrations 024 and 025 already declared equivalent indexes, but the live
-- Supabase database is still timing out — meaning those indexes were either
-- never applied, only partially applied, or built with a shape the planner
-- cannot use for the Case Explorer query (filtered equality + ORDER BY
-- submitted_at DESC over source_city = 'NYC', plus ILIKE '%term%' search).
--
-- This migration rebuilds the full index set the query planner needs, using
-- CREATE INDEX CONCURRENTLY so it can be applied safely on the live, busy table
-- without taking a write lock. The IF NOT EXISTS guards make it idempotent, so
-- any index already present from 024/025 is left untouched.
--
-- IMPORTANT — how to run this:
--   CREATE INDEX CONCURRENTLY CANNOT run inside a transaction block. Supabase's
--   migration runner (and the MCP apply_migration tool) wrap statements in a
--   transaction, which will reject CONCURRENTLY. Run this file by pasting it
--   into the Supabase SQL editor and executing the statements directly (the SQL
--   editor runs them outside an explicit transaction), or run each statement
--   one at a time. See supabase/diagnostics_case_explorer.sql to confirm the
--   indexes, materialized views and open-queue views actually exist afterward.

create extension if not exists pg_trgm;

create index concurrently if not exists idx_mc_nyc_submitted
on public.municipal_complaints (submitted_at desc)
where source_city = 'NYC';

create index concurrently if not exists idx_mc_nyc_complaint_type_submitted
on public.municipal_complaints (complaint_type, submitted_at desc)
where source_city = 'NYC';

create index concurrently if not exists idx_mc_nyc_borough_submitted
on public.municipal_complaints (borough, submitted_at desc)
where source_city = 'NYC';

create index concurrently if not exists idx_mc_nyc_council_district_submitted
on public.municipal_complaints (council_district, submitted_at desc)
where source_city = 'NYC';

create index concurrently if not exists idx_mc_nyc_status_submitted
on public.municipal_complaints (status, submitted_at desc)
where source_city = 'NYC';

create index concurrently if not exists idx_mc_nyc_assigned_department_submitted
on public.municipal_complaints (assigned_department, submitted_at desc)
where source_city = 'NYC';

create index concurrently if not exists idx_mc_nyc_agency_name_submitted
on public.municipal_complaints (agency_name, submitted_at desc)
where source_city = 'NYC';

create index concurrently if not exists idx_mc_nyc_agency_submitted
on public.municipal_complaints (agency, submitted_at desc)
where source_city = 'NYC';

create index concurrently if not exists idx_mc_case_id
on public.municipal_complaints (case_id);

create index concurrently if not exists idx_mc_source_dataset_id
on public.municipal_complaints (source_dataset_id);

create index concurrently if not exists idx_mc_nyc_case_id_trgm
on public.municipal_complaints using gin (case_id gin_trgm_ops)
where source_city = 'NYC';

create index concurrently if not exists idx_mc_nyc_source_dataset_id_trgm
on public.municipal_complaints using gin (source_dataset_id gin_trgm_ops)
where source_city = 'NYC';

create index concurrently if not exists idx_mc_nyc_complaint_type_trgm
on public.municipal_complaints using gin (complaint_type gin_trgm_ops)
where source_city = 'NYC';

create index concurrently if not exists idx_mc_nyc_address_trgm
on public.municipal_complaints using gin (address_or_location gin_trgm_ops)
where source_city = 'NYC';

create index concurrently if not exists idx_mc_nyc_request_detail_trgm
on public.municipal_complaints using gin (request_detail gin_trgm_ops)
where source_city = 'NYC';
