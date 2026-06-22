-- 030_nyc_map_metrics_by_geography.sql
--
-- Multi-metric map aggregates for the Insights 3D workload map.
--
-- The workload map previously shaded geography by complaint volume only
-- (v_nyc_service_request_workload / v_nyc_council_district_workload). This
-- migration adds two per-geography metric aggregates so the same polygons can be
-- coloured and extruded by any of several operational metrics — total requests,
-- open backlog, average / P90 closure days, and high-priority open cases —
-- instead of just total volume.
--
--   v_nyc_council_district_map_metrics  — ward-like operational unit
--   v_nyc_borough_map_metrics           — broad executive overview
--
-- Each returns: area, total_requests, open_backlog, closed_requests,
-- avg_closure_days, p90_closure_days, high_priority_open.
--
-- This is public NYC 311 benchmark data, not Brampton operational data, and it is
-- decision support only — never a risk prediction and never an automated
-- enforcement decision.
--
-- Definitions (kept identical across both geographies):
--   * open backlog  — closed_at IS NULL OR status not in (Closed, Completed).
--   * closure days  — only where BOTH closed_at and submitted_at exist and
--                     closed_at >= submitted_at (otherwise null, excluded from
--                     the avg / P90).
--   * high priority open — open rows whose priority OR ai_priority indicates High
--                          (or Urgent).
--
-- Aggregating the full ~3.4M-row dataset on every page load is slow, so each
-- aggregate is a MATERIALIZED VIEW (tiny aggregate output only) with a normal
-- view repointed on top — matching migration 020. Refresh after a data load with
-- supabase/refresh_insights_materialized_views.sql.
--
-- Plain CREATE INDEX (not CONCURRENTLY) so the file runs inside the Supabase
-- migration runner's transaction. IF NOT EXISTS keeps it idempotent.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Council district map metrics (ward-like operational unit)
-- ---------------------------------------------------------------------------
drop materialized view if exists public.mv_nyc_council_district_map_metrics cascade;
create materialized view public.mv_nyc_council_district_map_metrics as
with rows as (
  select
    ltrim(btrim(council_district), '0') as area,
    -- open backlog: not yet resolved.
    (
      closed_at is null
      or lower(coalesce(status, '')) not in ('closed', 'completed')
    ) as is_open,
    -- high priority signal from either the source priority or the assistive one.
    (
      lower(coalesce(priority, '')) like '%high%'
      or lower(coalesce(priority, '')) like '%urgent%'
      or lower(coalesce(ai_priority, '')) like '%high%'
      or lower(coalesce(ai_priority, '')) like '%urgent%'
    ) as is_high_priority,
    -- closure days only where both timestamps exist and ordering is sane.
    case
      when closed_at is not null
        and submitted_at is not null
        and closed_at >= submitted_at
      then extract(epoch from (closed_at - submitted_at)) / 86400.0
    end as closure_days
  from public.municipal_complaints
  where source_city = 'NYC'
    and council_district is not null
    and btrim(council_district) <> ''
    and ltrim(btrim(council_district), '0') <> ''
)
select
  area,
  count(*)::bigint                                                                as total_requests,
  count(*) filter (where is_open)::bigint                                         as open_backlog,
  count(*) filter (where not is_open)::bigint                                     as closed_requests,
  round(avg(closure_days)::numeric, 1)                                           as avg_closure_days,
  round((percentile_cont(0.9) within group (order by closure_days))::numeric, 1) as p90_closure_days,
  count(*) filter (where is_open and is_high_priority)::bigint                    as high_priority_open
from rows
group by area
order by total_requests desc;

comment on materialized view public.mv_nyc_council_district_map_metrics is
  'NYC 311 benchmark map metrics per City Council district (total requests, open backlog, closure days, high-priority open). Decision support only; not Brampton operational data.';

-- ---------------------------------------------------------------------------
-- 2. Borough map metrics (broad executive overview)
-- ---------------------------------------------------------------------------
drop materialized view if exists public.mv_nyc_borough_map_metrics cascade;
create materialized view public.mv_nyc_borough_map_metrics as
with rows as (
  select
    coalesce(nullif(btrim(borough), ''), nullif(btrim(ward_or_area), ''), 'Unknown') as area,
    (
      closed_at is null
      or lower(coalesce(status, '')) not in ('closed', 'completed')
    ) as is_open,
    (
      lower(coalesce(priority, '')) like '%high%'
      or lower(coalesce(priority, '')) like '%urgent%'
      or lower(coalesce(ai_priority, '')) like '%high%'
      or lower(coalesce(ai_priority, '')) like '%urgent%'
    ) as is_high_priority,
    case
      when closed_at is not null
        and submitted_at is not null
        and closed_at >= submitted_at
      then extract(epoch from (closed_at - submitted_at)) / 86400.0
    end as closure_days
  from public.municipal_complaints
  where source_city = 'NYC'
)
select
  area,
  count(*)::bigint                                                                as total_requests,
  count(*) filter (where is_open)::bigint                                         as open_backlog,
  count(*) filter (where not is_open)::bigint                                     as closed_requests,
  round(avg(closure_days)::numeric, 1)                                           as avg_closure_days,
  round((percentile_cont(0.9) within group (order by closure_days))::numeric, 1) as p90_closure_days,
  count(*) filter (where is_open and is_high_priority)::bigint                    as high_priority_open
from rows
group by area
order by total_requests desc;

comment on materialized view public.mv_nyc_borough_map_metrics is
  'NYC 311 benchmark map metrics per borough (total requests, open backlog, closure days, high-priority open). Decision support only; not Brampton operational data.';

-- ---------------------------------------------------------------------------
-- 3. Repointed read views — the frontend reads these stable names.
-- ---------------------------------------------------------------------------
create or replace view public.v_nyc_council_district_map_metrics as
  select * from public.mv_nyc_council_district_map_metrics;
create or replace view public.v_nyc_borough_map_metrics as
  select * from public.mv_nyc_borough_map_metrics;

comment on view public.v_nyc_council_district_map_metrics is
  'Per council-district map metrics for the workload map. Reads mv_nyc_council_district_map_metrics.';
comment on view public.v_nyc_borough_map_metrics is
  'Per borough map metrics for the workload map. Reads mv_nyc_borough_map_metrics.';

grant select on public.v_nyc_council_district_map_metrics to authenticated;
grant select on public.v_nyc_borough_map_metrics          to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Supporting indexes (idempotent). These back the per-geography metric
--    scans above and the common operational filters over the NYC benchmark.
-- ---------------------------------------------------------------------------
create index if not exists idx_mc_source_city_council_district
  on public.municipal_complaints (source_city, council_district);
create index if not exists idx_mc_source_city_borough
  on public.municipal_complaints (source_city, borough);
create index if not exists idx_mc_source_city_status
  on public.municipal_complaints (source_city, status);
create index if not exists idx_mc_source_city_closed_at
  on public.municipal_complaints (source_city, closed_at);
create index if not exists idx_mc_source_city_submitted_at
  on public.municipal_complaints (source_city, submitted_at);
create index if not exists idx_mc_source_city_priority
  on public.municipal_complaints (source_city, priority);
create index if not exists idx_mc_source_city_ai_priority
  on public.municipal_complaints (source_city, ai_priority);
