-- 019_insights_source_meta.sql
--
-- Source metadata for the Insights data-source banner: how many NYC 311 public
-- service-request records are loaded and the date range they cover. This lets the
-- dashboard state the real data source ("New York City 311 public service
-- requests") with live counts and dates, instead of mislabeling the live data as
-- a sample. Read-only, authenticated, idempotent.

create or replace view public.v_insights_source_meta as
select
  count(*)::bigint     as record_count,
  min(submitted_at)    as earliest,
  max(submitted_at)    as latest
from public.municipal_complaints
where source_city = 'NYC';

comment on view public.v_insights_source_meta is
  'Insights data-source metadata: NYC 311 public service-request record count and submitted_at date range. Decision support / workload intelligence demo over public benchmark data.';

grant select on public.v_insights_source_meta to authenticated;
