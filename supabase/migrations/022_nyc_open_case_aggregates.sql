-- 022_nyc_open_case_aggregates.sql
--
-- Open-case aggregates for the Insights "Open cases" tab and the Overview
-- "Open case status mix" chart.
--
-- The open NYC 311 review queue lives in public.nyc_open_service_requests
-- (~161k active records) with a prioritized projection in
-- public.v_nyc_open_review_queue. The aging cards and the open status mix must
-- reflect the FULL open population, not just the first page of the queue, so we
-- precompute them here as materialized views (tiny aggregate output only, never
-- raw case rows) and expose them through stable v_ views the frontend reads.
--
-- These aggregates describe the ACTIVE review queue — distinct from the
-- historical v_insights_status_mix, which is the source-label distribution over
-- the closed-heavy 3.4M-row history. This is decision support only: a human
-- reviews and decides; nothing here is an automated or enforcement decision.
--
-- Refresh after an open-case data load with
-- supabase/refresh_insights_materialized_views.sql.
--
-- NOTE ON SOURCES: status mix reads the base table public.nyc_open_service_requests
-- (status, total_cases). The aging buckets and the facet aggregates that power the
-- Open-cases filters read public.v_nyc_open_review_queue, which already exposes the
-- operational columns the app reads (status, borough, council_district,
-- complaint_type, priority_tier, age_days) plus the review-priority scoring. If a
-- column name differs in your environment, adjust it here only.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Open case status mix — active review queue (status, total_cases)
-- ---------------------------------------------------------------------------
drop materialized view if exists public.mv_nyc_open_status_mix cascade;
create materialized view public.mv_nyc_open_status_mix as
select
  coalesce(nullif(btrim(status), ''), 'Unknown') as status,
  count(*)::bigint                               as total_cases
from public.nyc_open_service_requests
group by 1
order by total_cases desc;

create or replace view public.v_nyc_open_status_mix as
  select status, total_cases from public.mv_nyc_open_status_mix;

comment on view public.v_nyc_open_status_mix is
  'Open case status mix over the active NYC 311 review queue (public.nyc_open_service_requests). Decision support only — the active queue, not the historical source-label distribution.';

grant select on public.v_nyc_open_status_mix to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Open-case aging buckets — full population by days open
-- ---------------------------------------------------------------------------
drop materialized view if exists public.mv_nyc_open_aging_buckets cascade;
create materialized view public.mv_nyc_open_aging_buckets as
with bucketed as (
  select
    case
      when age_days is null then 4
      when age_days <= 2  then 0
      when age_days <= 7  then 1
      when age_days <= 14 then 2
      else 3
    end as sort_order
  from public.v_nyc_open_review_queue
)
select
  sort_order,
  case sort_order
    when 0 then '0-2 days'
    when 1 then '3-7 days'
    when 2 then '8-14 days'
    when 3 then '15+ days'
    else 'Unknown'
  end          as bucket,
  count(*)::bigint as total_cases
from bucketed
group by sort_order;

create or replace view public.v_nyc_open_aging_buckets as
  select bucket, sort_order, total_cases from public.mv_nyc_open_aging_buckets order by sort_order;

comment on view public.v_nyc_open_aging_buckets is
  'Open-case aging buckets across the full NYC 311 review queue, by days open. Decision support only.';

grant select on public.v_nyc_open_aging_buckets to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Facet aggregates — power the Open-cases filter dropdowns + the diversified
--    queue, without distinct-scanning the full queue from the client.
-- ---------------------------------------------------------------------------
drop materialized view if exists public.mv_nyc_open_complaint_type_volume cascade;
create materialized view public.mv_nyc_open_complaint_type_volume as
select
  coalesce(nullif(btrim(complaint_type), ''), 'Uncategorized') as complaint_type,
  count(*)::bigint                                             as total_cases
from public.v_nyc_open_review_queue
group by 1
order by total_cases desc;

create or replace view public.v_nyc_open_complaint_type_volume as
  select complaint_type, total_cases from public.mv_nyc_open_complaint_type_volume;

grant select on public.v_nyc_open_complaint_type_volume to authenticated;

drop materialized view if exists public.mv_nyc_open_borough_volume cascade;
create materialized view public.mv_nyc_open_borough_volume as
select
  coalesce(nullif(btrim(borough), ''), 'Unknown') as borough,
  count(*)::bigint                                as total_cases
from public.v_nyc_open_review_queue
group by 1
order by total_cases desc;

create or replace view public.v_nyc_open_borough_volume as
  select borough, total_cases from public.mv_nyc_open_borough_volume;

grant select on public.v_nyc_open_borough_volume to authenticated;

drop materialized view if exists public.mv_nyc_open_council_district_volume cascade;
create materialized view public.mv_nyc_open_council_district_volume as
select
  ltrim(btrim(council_district::text), '0') as council_district,
  count(*)::bigint                          as total_cases
from public.v_nyc_open_review_queue
where council_district is not null
  and btrim(council_district::text) <> ''
  and ltrim(btrim(council_district::text), '0') <> ''
group by 1
order by total_cases desc;

create or replace view public.v_nyc_open_council_district_volume as
  select council_district, total_cases from public.mv_nyc_open_council_district_volume;

grant select on public.v_nyc_open_council_district_volume to authenticated;

drop materialized view if exists public.mv_nyc_open_tier_volume cascade;
create materialized view public.mv_nyc_open_tier_volume as
select
  coalesce(nullif(btrim(priority_tier), ''), 'Unscored') as priority_tier,
  count(*)::bigint                                        as total_cases
from public.v_nyc_open_review_queue
group by 1
order by total_cases desc;

create or replace view public.v_nyc_open_tier_volume as
  select priority_tier, total_cases from public.mv_nyc_open_tier_volume;

grant select on public.v_nyc_open_tier_volume to authenticated;
