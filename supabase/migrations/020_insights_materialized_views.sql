-- 020_insights_materialized_views.sql
--
-- Performance + integrity fix for the Insights dashboard.
--
-- Aggregating the full NYC 311 public dataset (~3.4M rows in
-- public.municipal_complaints) on every page load is too slow and can time out,
-- which previously caused the app to fall back to placeholder values. This
-- migration precomputes every Insights aggregate into a MATERIALIZED VIEW (tiny
-- aggregate outputs only — never raw case-level rows) and repoints the existing
-- v_insights_* / v_nyc_* views at those materialized views, so the frontend keeps
-- reading the same view names but gets fast, real data.
--
-- Refresh the materialized views after a data load with
-- supabase/refresh_insights_materialized_views.sql.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. KPI summary
-- ---------------------------------------------------------------------------
drop materialized view if exists public.mv_insights_kpis cascade;
create materialized view public.mv_insights_kpis as
with base as (
  select
    (closed_at is not null or status in ('Closed','Completed')) as is_closed,
    case
      when closed_at is not null
        and coalesce(submitted_at, created_at) is not null
        and closed_at >= coalesce(submitted_at, created_at)
      then extract(epoch from (closed_at - coalesce(submitted_at, created_at))) / 86400.0
    end as closure_days
  from public.municipal_complaints
  where source_city = 'NYC'
)
select
  count(*)::bigint                                                          as total_requests,
  count(*) filter (where not is_closed)::bigint                            as open_requests,
  count(*) filter (where is_closed)::bigint                                as closed_requests,
  round(avg(closure_days)::numeric, 1)                                     as avg_closure_days,
  round((percentile_cont(0.5) within group (order by closure_days))::numeric, 1) as median_closure_days,
  round((percentile_cont(0.9) within group (order by closure_days))::numeric, 1) as p90_closure_days,
  (
    select ltrim(btrim(council_district), '0')
    from public.municipal_complaints
    where source_city = 'NYC'
      and council_district is not null
      and btrim(council_district) <> ''
      and ltrim(btrim(council_district), '0') <> ''
    group by ltrim(btrim(council_district), '0')
    order by count(*) desc
    limit 1
  )                                                                         as busiest_council_district,
  (
    select coalesce(nullif(btrim(complaint_type), ''), 'Uncategorized')
    from public.municipal_complaints
    where source_city = 'NYC'
    group by coalesce(nullif(btrim(complaint_type), ''), 'Uncategorized')
    order by count(*) desc
    limit 1
  )                                                                         as top_complaint_type
from base;

-- ---------------------------------------------------------------------------
-- 2. Complaint type pressure
-- ---------------------------------------------------------------------------
drop materialized view if exists public.mv_insights_complaint_type_volume cascade;
create materialized view public.mv_insights_complaint_type_volume as
select
  coalesce(nullif(btrim(complaint_type), ''), 'Uncategorized') as complaint_type,
  count(*)::bigint                                             as total_cases
from public.municipal_complaints
where source_city = 'NYC'
group by 1
order by total_cases desc;

-- ---------------------------------------------------------------------------
-- 3. Closure bottlenecks (by complaint type)
-- ---------------------------------------------------------------------------
drop materialized view if exists public.mv_insights_closure_bottlenecks cascade;
create materialized view public.mv_insights_closure_bottlenecks as
with rows as (
  select
    coalesce(nullif(btrim(complaint_type), ''), 'Uncategorized') as complaint_type,
    case
      when closed_at is not null
        and coalesce(submitted_at, created_at) is not null
        and closed_at >= coalesce(submitted_at, created_at)
      then extract(epoch from (closed_at - coalesce(submitted_at, created_at))) / 86400.0
    end as closure_days
  from public.municipal_complaints
  where source_city = 'NYC'
)
select
  complaint_type,
  count(*)::bigint                                                          as total_cases,
  count(closure_days)::bigint                                              as closed_cases,
  round(avg(closure_days)::numeric, 1)                                     as avg_closure_days,
  round((percentile_cont(0.5) within group (order by closure_days))::numeric, 1) as median_closure_days,
  round((percentile_cont(0.9) within group (order by closure_days))::numeric, 1) as p90_closure_days
from rows
group by complaint_type
order by avg_closure_days desc nulls last, total_cases desc;

-- ---------------------------------------------------------------------------
-- 4. Area bottlenecks (by council district)
-- ---------------------------------------------------------------------------
drop materialized view if exists public.mv_insights_area_bottlenecks cascade;
create materialized view public.mv_insights_area_bottlenecks as
with area_rows as (
  select
    ltrim(btrim(council_district), '0')                          as council_district,
    coalesce(nullif(btrim(complaint_type), ''), 'Uncategorized') as complaint_type,
    case
      when closed_at is not null
        and coalesce(submitted_at, created_at) is not null
        and closed_at >= coalesce(submitted_at, created_at)
      then extract(epoch from (closed_at - coalesce(submitted_at, created_at))) / 86400.0
    end as closure_days
  from public.municipal_complaints
  where source_city = 'NYC'
    and council_district is not null
    and btrim(council_district) <> ''
    and ltrim(btrim(council_district), '0') <> ''
),
top_type as (
  select distinct on (council_district)
    council_district,
    complaint_type as top_complaint_type
  from (
    select council_district, complaint_type, count(*) as n
    from area_rows
    group by council_district, complaint_type
  ) t
  order by council_district, n desc
)
select
  a.council_district,
  count(*)::bigint                                                          as total_cases,
  round(avg(a.closure_days)::numeric, 1)                                   as avg_closure_days,
  round((percentile_cont(0.9) within group (order by a.closure_days))::numeric, 1) as p90_closure_days,
  tt.top_complaint_type
from area_rows a
join top_type tt using (council_district)
group by a.council_district, tt.top_complaint_type
order by total_cases desc;

-- ---------------------------------------------------------------------------
-- 5. Department workload
-- ---------------------------------------------------------------------------
drop materialized view if exists public.mv_insights_department_workload cascade;
create materialized view public.mv_insights_department_workload as
with rows as (
  select
    coalesce(
      nullif(btrim(assigned_department), ''),
      nullif(btrim(agency_name), ''),
      nullif(btrim(agency), ''),
      'Unassigned'
    ) as department,
    (closed_at is not null or status in ('Closed','Completed')) as is_closed,
    case
      when closed_at is not null
        and coalesce(submitted_at, created_at) is not null
        and closed_at >= coalesce(submitted_at, created_at)
      then extract(epoch from (closed_at - coalesce(submitted_at, created_at))) / 86400.0
    end as closure_days
  from public.municipal_complaints
  where source_city = 'NYC'
)
select
  department,
  count(*)::bigint                              as total_cases,
  count(*) filter (where not is_closed)::bigint as open_cases,
  count(*) filter (where is_closed)::bigint     as closed_cases,
  round(avg(closure_days)::numeric, 1)          as avg_closure_days
from rows
group by department
order by total_cases desc;

-- ---------------------------------------------------------------------------
-- 6. Monthly trend
-- ---------------------------------------------------------------------------
drop materialized view if exists public.mv_insights_monthly_trend cascade;
create materialized view public.mv_insights_monthly_trend as
with rows as (
  select
    date_trunc('month', coalesce(submitted_at, created_at)) as month_start,
    case
      when closed_at is not null
        and coalesce(submitted_at, created_at) is not null
        and closed_at >= coalesce(submitted_at, created_at)
      then extract(epoch from (closed_at - coalesce(submitted_at, created_at))) / 86400.0
    end as closure_days
  from public.municipal_complaints
  where source_city = 'NYC'
    and coalesce(submitted_at, created_at) is not null
)
select
  to_char(month_start, 'YYYY-MM')      as month,
  count(*)::bigint                     as request_volume,
  round(avg(closure_days)::numeric, 1) as avg_closure_days
from rows
group by month_start
order by month_start;

-- ---------------------------------------------------------------------------
-- 7. Channel mix
-- ---------------------------------------------------------------------------
drop materialized view if exists public.mv_insights_channel_mix cascade;
create materialized view public.mv_insights_channel_mix as
select
  case
    when lower(coalesce(nullif(btrim(channel), ''), nullif(btrim(source_channel), ''), '')) like '%online%' then 'Online'
    when lower(coalesce(nullif(btrim(channel), ''), nullif(btrim(source_channel), ''), '')) like '%phone%'  then 'Phone'
    when lower(coalesce(nullif(btrim(channel), ''), nullif(btrim(source_channel), ''), '')) like '%mobile%' then 'Mobile'
    else 'Unknown'
  end             as channel,
  count(*)::bigint as total_cases
from public.municipal_complaints
where source_city = 'NYC'
group by 1
order by total_cases desc;

-- ---------------------------------------------------------------------------
-- 8. Source metadata
-- ---------------------------------------------------------------------------
drop materialized view if exists public.mv_insights_source_meta cascade;
create materialized view public.mv_insights_source_meta as
select
  count(*)::bigint     as record_count,
  min(submitted_at)    as earliest,
  max(submitted_at)    as latest
from public.municipal_complaints
where source_city = 'NYC';

-- ---------------------------------------------------------------------------
-- 9. Borough workload (executive map overview)
-- ---------------------------------------------------------------------------
drop materialized view if exists public.mv_nyc_service_request_workload cascade;
create materialized view public.mv_nyc_service_request_workload as
select
  coalesce(nullif(btrim(borough), ''), nullif(btrim(ward_or_area), ''), 'Unknown') as area,
  count(*)::bigint as complaint_volume
from public.municipal_complaints
where source_city = 'NYC'
group by 1
order by complaint_volume desc;

-- ---------------------------------------------------------------------------
-- 10. Council district workload (ward-like operational map view)
-- ---------------------------------------------------------------------------
drop materialized view if exists public.mv_nyc_council_district_workload cascade;
create materialized view public.mv_nyc_council_district_workload as
select
  ltrim(btrim(council_district), '0') as area,
  count(*)::bigint as complaint_volume
from public.municipal_complaints
where source_city = 'NYC'
  and council_district is not null
  and btrim(council_district) <> ''
  and ltrim(btrim(council_district), '0') <> ''
group by 1
order by complaint_volume desc;

-- ---------------------------------------------------------------------------
-- Repoint the existing views at the materialized views. The frontend keeps
-- reading v_insights_* / v_nyc_* names; those now return precomputed aggregates.
-- ---------------------------------------------------------------------------
create or replace view public.v_insights_kpis                  as select * from public.mv_insights_kpis;
create or replace view public.v_insights_complaint_type_volume as select * from public.mv_insights_complaint_type_volume;
create or replace view public.v_insights_closure_bottlenecks   as select * from public.mv_insights_closure_bottlenecks;
create or replace view public.v_insights_area_bottlenecks      as select * from public.mv_insights_area_bottlenecks;
create or replace view public.v_insights_department_workload   as select * from public.mv_insights_department_workload;
create or replace view public.v_insights_monthly_trend         as select * from public.mv_insights_monthly_trend;
create or replace view public.v_insights_channel_mix           as select * from public.mv_insights_channel_mix;
create or replace view public.v_insights_source_meta           as select * from public.mv_insights_source_meta;
create or replace view public.v_nyc_service_request_workload   as select * from public.mv_nyc_service_request_workload;
create or replace view public.v_nyc_council_district_workload  as select * from public.mv_nyc_council_district_workload;

-- Grants — authenticated reads the views (which read the materialized views as
-- the view owner). Re-granted here so this migration is self-contained.
grant select on public.v_insights_kpis                    to authenticated;
grant select on public.v_insights_complaint_type_volume   to authenticated;
grant select on public.v_insights_closure_bottlenecks     to authenticated;
grant select on public.v_insights_area_bottlenecks        to authenticated;
grant select on public.v_insights_department_workload     to authenticated;
grant select on public.v_insights_monthly_trend           to authenticated;
grant select on public.v_insights_channel_mix             to authenticated;
grant select on public.v_insights_source_meta             to authenticated;
grant select on public.v_nyc_service_request_workload     to authenticated;
grant select on public.v_nyc_council_district_workload    to authenticated;
