-- 025_case_explorer_fast_lookup.sql
--
-- Fast, timeout-proof lookups for the Insights Case Explorer and the full NYC
-- case page.
--
-- Two problems this migration supports the app-side fix for:
--   1. Case Explorer drilldowns into a high-volume complaint type (e.g.
--      "Illegal Parking") over the ~3.4M-row public.municipal_complaints table
--      were hitting the Postgres statement timeout (SQLSTATE 57014). The app no
--      longer asks for ANY row count; it fetches pageSize + 1 ordered rows. These
--      partial, recency-ordered btree indexes serve that ordered LIMIT slice
--      straight from an index instead of a big sort.
--   2. Free-text search uses ILIKE '%term%' across case_id, source_dataset_id,
--      address, and request detail. Trigram (pg_trgm) GIN indexes make those
--      substring searches index-assisted instead of a sequential scan.
--
-- All indexes are PARTIAL on (source_city = 'NYC'), matching the Case Explorer's
-- fixed source_city = 'NYC' predicate, so they stay small and targeted.
--
-- Idempotent: safe to re-run. Migration 024 already created several equivalent
-- btree indexes under idx_mc_nyc_* names; the IF NOT EXISTS guards below keep
-- this additive and conflict-free, and add the trigram + lookup indexes that
-- migration 024 did not cover.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- public.municipal_complaints — historical NYC 311 history
-- ---------------------------------------------------------------------------

-- Default + every drilldown share this ORDER BY (submitted_at desc).
create index if not exists idx_municipal_complaints_nyc_submitted
  on public.municipal_complaints (source_city, submitted_at desc);

-- Exact-ID lookups (Case Explorer search short circuit, full case page).
create index if not exists idx_municipal_complaints_nyc_case_id
  on public.municipal_complaints (case_id);

create index if not exists idx_municipal_complaints_nyc_source_dataset_id
  on public.municipal_complaints (source_dataset_id);

-- Filtered drilldowns, each recency-ordered over the NYC subset.
create index if not exists idx_municipal_complaints_nyc_complaint_submitted
  on public.municipal_complaints (complaint_type, submitted_at desc)
  where source_city = 'NYC';

create index if not exists idx_municipal_complaints_nyc_borough_submitted
  on public.municipal_complaints (borough, submitted_at desc)
  where source_city = 'NYC';

create index if not exists idx_municipal_complaints_nyc_district_submitted
  on public.municipal_complaints (council_district, submitted_at desc)
  where source_city = 'NYC';

create index if not exists idx_municipal_complaints_nyc_status_submitted
  on public.municipal_complaints (status, submitted_at desc)
  where source_city = 'NYC';

-- Trigram GIN indexes for the ILIKE '%term%' free-text search.
create index if not exists idx_municipal_complaints_nyc_case_id_trgm
  on public.municipal_complaints using gin (case_id gin_trgm_ops)
  where source_city = 'NYC';

create index if not exists idx_municipal_complaints_nyc_source_dataset_id_trgm
  on public.municipal_complaints using gin (source_dataset_id gin_trgm_ops)
  where source_city = 'NYC';

create index if not exists idx_municipal_complaints_nyc_address_trgm
  on public.municipal_complaints using gin (address_or_location gin_trgm_ops)
  where source_city = 'NYC';

create index if not exists idx_municipal_complaints_nyc_request_detail_trgm
  on public.municipal_complaints using gin (request_detail gin_trgm_ops)
  where source_city = 'NYC';

-- ---------------------------------------------------------------------------
-- public.nyc_open_service_requests — active open review queue base table
--
-- This table is loaded SEPARATELY (the open-case dataset) and may not exist in
-- every environment, and its exact columns can vary by load. So we add matching
-- indexes defensively: only when the table exists and the column exists. Each
-- CREATE INDEX still uses IF NOT EXISTS, so this is fully idempotent.
-- ---------------------------------------------------------------------------
do $$
declare
  has_submitted boolean;
  function_schema constant text := 'public';
  tbl_name constant text := 'nyc_open_service_requests';
begin
  if to_regclass('public.nyc_open_service_requests') is null then
    raise notice 'nyc_open_service_requests not present — skipping open-queue indexes.';
    return;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = function_schema and table_name = tbl_name and column_name = 'submitted_at'
  ) into has_submitted;

  -- case_id (exact lookup used by the full case page + queue search).
  if exists (
    select 1 from information_schema.columns
    where table_schema = function_schema and table_name = tbl_name and column_name = 'case_id'
  ) then
    execute 'create index if not exists idx_nyc_open_case_id on public.nyc_open_service_requests (case_id)';
    execute 'create index if not exists idx_nyc_open_case_id_trgm on public.nyc_open_service_requests using gin (case_id gin_trgm_ops)';
  end if;

  -- submitted_at recency.
  if has_submitted then
    execute 'create index if not exists idx_nyc_open_submitted on public.nyc_open_service_requests (submitted_at desc)';
  end if;

  -- Filtered facets, recency-ordered when submitted_at is available.
  if exists (
    select 1 from information_schema.columns
    where table_schema = function_schema and table_name = tbl_name and column_name = 'complaint_type'
  ) then
    if has_submitted then
      execute 'create index if not exists idx_nyc_open_complaint_submitted on public.nyc_open_service_requests (complaint_type, submitted_at desc)';
    else
      execute 'create index if not exists idx_nyc_open_complaint on public.nyc_open_service_requests (complaint_type)';
    end if;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = function_schema and table_name = tbl_name and column_name = 'borough'
  ) then
    execute 'create index if not exists idx_nyc_open_borough on public.nyc_open_service_requests (borough)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = function_schema and table_name = tbl_name and column_name = 'council_district'
  ) then
    execute 'create index if not exists idx_nyc_open_council_district on public.nyc_open_service_requests (council_district)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = function_schema and table_name = tbl_name and column_name = 'status'
  ) then
    execute 'create index if not exists idx_nyc_open_status on public.nyc_open_service_requests (status)';
  end if;
end
$$;
