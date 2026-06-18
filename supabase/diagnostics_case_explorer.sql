-- diagnostics_case_explorer.sql
--
-- Read-only health check for the Insights Case Explorer + Open Cases pipeline.
-- Run this in the Supabase SQL editor against the live project to see whether
-- the indexes, materialized views and open-queue views the app depends on
-- actually exist. Use it to confirm migration 026 (and 020/022) were applied.
--
-- Result 1: every index on the two base tables the Case Explorer / Open queue
--           read. Confirms the idx_mc_nyc_* btree + trigram indexes from
--           migration 026 are present (this is what cures the 57014 timeout).
-- Result 2: materialized views and whether each is populated (the fast
--           aggregate sections rely on these — migration 020).
-- Result 3: presence of the Insights + open-queue views the readers query.
-- Result 4: the live source-meta row (record counts powering the source banner).

select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'municipal_complaints',
    'nyc_open_service_requests'
  )
order by tablename, indexname;

select
  matviewname,
  ispopulated
from pg_matviews
where schemaname = 'public'
order by matviewname;

select
  table_name
from information_schema.views
where table_schema = 'public'
  and table_name in (
    'v_insights_source_meta',
    'v_insights_complaint_type_volume',
    'v_nyc_open_review_queue',
    'v_nyc_open_tier_volume',
    'v_nyc_open_aging_buckets'
  )
order by table_name;

select * from public.v_insights_source_meta;
