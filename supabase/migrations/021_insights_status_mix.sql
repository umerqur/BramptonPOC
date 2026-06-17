-- 021_insights_status_mix.sql
--
-- Status mix aggregate for the Insights status donut. Like the other Insights
-- aggregates, this is a materialized view over the full NYC 311 public dataset
-- (tiny aggregate output, never raw rows); the v_ view reads from it so the
-- frontend stays fast. Refresh with
-- supabase/refresh_insights_materialized_views.sql.
--
-- Idempotent: safe to re-run.

drop materialized view if exists public.mv_insights_status_mix cascade;
create materialized view public.mv_insights_status_mix as
select
  coalesce(nullif(btrim(status), ''), 'Unknown') as status,
  count(*)::bigint                               as total_cases
from public.municipal_complaints
where source_city = 'NYC'
group by 1
order by total_cases desc;

create or replace view public.v_insights_status_mix as
  select * from public.mv_insights_status_mix;

comment on view public.v_insights_status_mix is
  'Status mix over NYC 311 public service requests. Decision support only.';

grant select on public.v_insights_status_mix to authenticated;
