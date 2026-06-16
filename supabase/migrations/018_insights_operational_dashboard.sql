-- 018_insights_operational_dashboard.sql
--
-- Operational workload intelligence views for the supervisor/coordinator
-- Insights dashboard. These aggregate the full cleaned NYC 311 benchmark dataset
-- in public.municipal_complaints SERVER SIDE so the React app reads small,
-- pre-aggregated result sets instead of scanning millions of rows in the
-- browser. Every view is filtered to source_city = 'NYC' (the benchmark) and is
-- granted to the authenticated role only, matching the rest of the schema.
--
-- These views are operational decision support for supervisors — surfacing where
-- the workload is concentrated, where closure is under pressure, and where
-- staffing/routing review may be warranted. They are NYC 311 public benchmark
-- data, not Brampton operational data. They are not a risk prediction, not an
-- automated enforcement decision, and nothing here assigns or decides anything —
-- a human coordinator or supervisor reviews and decides.
--
-- Closure timing convention: a request's "closure days" is the elapsed days
-- between its open timestamp (submitted_at, falling back to created_at) and its
-- closed_at, counted only for requests that actually have a closed_at on/after
-- the open timestamp. A request is treated as CLOSED when it has a closed_at or a
-- terminal status; everything else is OPEN/ACTIVE. avg/median/P90 use
-- percentile_cont over the closed population only.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. KPI summary (single row)
-- ---------------------------------------------------------------------------
create or replace view public.v_insights_kpis as
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

comment on view public.v_insights_kpis is
  'Insights KPI summary over NYC 311 benchmark complaints: total/open/closed requests, avg/median/P90 closure days, busiest council district, top complaint type. Supervisor decision support only — not Brampton operational data, not a risk prediction.';

-- ---------------------------------------------------------------------------
-- 2. Complaint type pressure — volume by complaint type
-- ---------------------------------------------------------------------------
create or replace view public.v_insights_complaint_type_volume as
select
  coalesce(nullif(btrim(complaint_type), ''), 'Uncategorized') as complaint_type,
  count(*)::bigint                                             as total_cases
from public.municipal_complaints
where source_city = 'NYC'
group by 1
order by total_cases desc;

comment on view public.v_insights_complaint_type_volume is
  'NYC 311 benchmark complaint volume by complaint type (workload concentration). Decision support only.';

-- ---------------------------------------------------------------------------
-- 3. Closure bottlenecks — closure pressure by complaint type
-- ---------------------------------------------------------------------------
create or replace view public.v_insights_closure_bottlenecks as
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

comment on view public.v_insights_closure_bottlenecks is
  'Closure pressure by complaint type over NYC 311 benchmark: total/closed cases, avg/median/P90 closure days. Highlights where closure is slowest. Decision support only.';

-- ---------------------------------------------------------------------------
-- 4. Area bottlenecks — closure pressure by council district
-- ---------------------------------------------------------------------------
create or replace view public.v_insights_area_bottlenecks as
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

comment on view public.v_insights_area_bottlenecks is
  'Closure pressure by NYC City Council district over NYC 311 benchmark: total cases, avg/P90 closure days, and the top complaint type per district. Decision support only; council district is the ward-like operational unit.';

-- ---------------------------------------------------------------------------
-- 5. Department workload — by responsible agency / assigned department
-- ---------------------------------------------------------------------------
create or replace view public.v_insights_department_workload as
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

comment on view public.v_insights_department_workload is
  'Workload by responsible agency / assigned department over NYC 311 benchmark: total/open/closed cases and avg closure days. Input for staffing and routing review. Decision support only.';

-- ---------------------------------------------------------------------------
-- 6. Trend — monthly request volume and monthly average closure days
-- ---------------------------------------------------------------------------
create or replace view public.v_insights_monthly_trend as
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

comment on view public.v_insights_monthly_trend is
  'Monthly NYC 311 benchmark service-request volume and monthly average closure days. Shows whether closure pressure is rising or easing. Decision support only.';

-- ---------------------------------------------------------------------------
-- 7. Channel mix — online / phone / mobile / unknown
-- ---------------------------------------------------------------------------
create or replace view public.v_insights_channel_mix as
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

comment on view public.v_insights_channel_mix is
  'Intake channel mix (Online / Phone / Mobile / Unknown) over NYC 311 benchmark. Decision support only.';

-- ---------------------------------------------------------------------------
-- Grants — authenticated read only, matching the rest of the schema.
-- ---------------------------------------------------------------------------
grant select on public.v_insights_kpis                    to authenticated;
grant select on public.v_insights_complaint_type_volume   to authenticated;
grant select on public.v_insights_closure_bottlenecks     to authenticated;
grant select on public.v_insights_area_bottlenecks        to authenticated;
grant select on public.v_insights_department_workload     to authenticated;
grant select on public.v_insights_monthly_trend           to authenticated;
grant select on public.v_insights_channel_mix             to authenticated;
