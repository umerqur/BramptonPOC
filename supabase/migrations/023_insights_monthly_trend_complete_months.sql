-- 023_insights_monthly_trend_complete_months.sql
--
-- Fix the Service Request Trend so it only reflects COMPLETE calendar months.
--
-- The NYC 311 history starts and ends mid-month (e.g. 2025-06-16 .. 2026-06-15),
-- so the first and last calendar months are partial. Charting them next to full
-- months is misleading: the final bar looks like demand collapsed when it is
-- really half a month, and the average-closure line is biased near the cutoff.
--
-- This redefines mv_insights_monthly_trend to drop the partial boundary months,
-- derived dynamically from the dataset's own min/max event date (no hard-coded
-- dates):
--   * first complete month = month of min(event), or the next month if min does
--     not fall exactly on a month boundary.
--   * exclusive upper bound  = first day of the month containing max(event), so
--     the partial final month is excluded.
-- We keep month_start >= first_complete_month and month_start < max_month_start.
--
-- For the example range this yields 2025-07 .. 2026-05 and excludes 2025-06 and
-- 2026-06. Refresh with supabase/refresh_insights_materialized_views.sql after
-- applying.
--
-- Idempotent: safe to re-run.

drop materialized view if exists public.mv_insights_monthly_trend cascade;
create materialized view public.mv_insights_monthly_trend as
with src as (
  select
    coalesce(submitted_at, created_at) as event_at,
    closed_at
  from public.municipal_complaints
  where source_city = 'NYC'
    and coalesce(submitted_at, created_at) is not null
),
bounds as (
  select min(event_at) as min_at, max(event_at) as max_at
  from src
),
month_window as (
  select
    -- First complete calendar month: the month after min, unless min already
    -- falls exactly on a month boundary (then that month is itself complete).
    case
      when min_at = date_trunc('month', min_at) then date_trunc('month', min_at)
      else date_trunc('month', min_at) + interval '1 month'
    end                            as first_complete_month,
    -- Exclusive upper bound — the (partial) month containing max is dropped.
    date_trunc('month', max_at)    as max_month_start
  from bounds
),
rows as (
  select
    date_trunc('month', s.event_at) as month_start,
    case
      when s.closed_at is not null and s.closed_at >= s.event_at
      then extract(epoch from (s.closed_at - s.event_at)) / 86400.0
    end as closure_days
  from src s
  cross join month_window w
  where date_trunc('month', s.event_at) >= w.first_complete_month
    and date_trunc('month', s.event_at) <  w.max_month_start
)
select
  to_char(month_start, 'YYYY-MM')      as month,
  count(*)::bigint                     as request_volume,
  round(avg(closure_days)::numeric, 1) as avg_closure_days
from rows
group by month_start
order by month_start;

create or replace view public.v_insights_monthly_trend as
  select * from public.mv_insights_monthly_trend;

comment on view public.v_insights_monthly_trend is
  'Monthly NYC 311 request volume + average closure days, COMPLETE calendar months only (partial boundary months excluded). Decision support only.';

grant select on public.v_insights_monthly_trend to authenticated;
