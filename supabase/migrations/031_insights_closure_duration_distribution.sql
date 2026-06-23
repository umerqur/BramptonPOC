-- 031_insights_closure_duration_distribution.sql
--
-- Closure time distribution for the Insights "Closure time distribution" card.
--
-- Buckets closed NYC 311 service requests by how long they took to close, so the
-- dashboard can show the long tail of slower cases (most requests close quickly,
-- a minority drag on for weeks or months). Like the other Insights aggregates,
-- this is a materialized view over the full NYC 311 public dataset (tiny
-- aggregate output, never raw case-level rows); the v_ view reads from it so the
-- frontend stays fast and never scans public.municipal_complaints itself.
--
-- This is historical descriptive context — how long past requests took to close
-- — not a prediction of how long a new request will take. A human reviews and
-- decides. Refresh with supabase/refresh_insights_materialized_views.sql.
--
-- Idempotent: safe to re-run.

drop materialized view if exists public.mv_insights_closure_duration_distribution cascade;
create materialized view public.mv_insights_closure_duration_distribution as
with closed as (
  -- Only cases that actually closed, with a non-negative duration. Same closure
  -- duration definition used by the KPI + bottleneck aggregates.
  select
    extract(epoch from (closed_at - coalesce(submitted_at, created_at))) / 86400.0 as closure_days
  from public.municipal_complaints
  where source_city = 'NYC'
    and closed_at is not null
    and coalesce(submitted_at, created_at) is not null
    and closed_at >= coalesce(submitted_at, created_at)
),
bucketed as (
  select
    case
      when closure_days <= 1   then 0
      when closure_days <= 3   then 1
      when closure_days <= 7   then 2
      when closure_days <= 14  then 3
      when closure_days <= 30  then 4
      when closure_days <= 90  then 5
      when closure_days <= 180 then 6
      else 7
    end as bucket_order
  from closed
),
-- Every bucket appears even when empty, so the distribution always shows the
-- full range from same-day closures to the long 6-month-plus tail.
buckets(bucket_order, closure_bucket) as (
  values
    (0, 'Same day'),
    (1, '1-3 days'),
    (2, '4-7 days'),
    (3, '1-2 weeks'),
    (4, '2-4 weeks'),
    (5, '1-3 months'),
    (6, '3-6 months'),
    (7, '6+ months')
)
select
  b.bucket_order,
  b.closure_bucket,
  count(d.bucket_order)::bigint as total_cases
from buckets b
left join bucketed d using (bucket_order)
group by b.bucket_order, b.closure_bucket
order by b.bucket_order;

create or replace view public.v_insights_closure_duration_distribution as
  select closure_bucket, bucket_order, total_cases
  from public.mv_insights_closure_duration_distribution
  order by bucket_order;

comment on view public.v_insights_closure_duration_distribution is
  'Closure time distribution over closed NYC 311 public service requests, bucketed by how long they took to close. Historical descriptive context, not a prediction. Decision support only.';

grant select on public.v_insights_closure_duration_distribution to authenticated;
