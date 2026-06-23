-- Formal schema for public.synthetic_patrol_logs.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The frontend (src/services/syntheticPatrol.ts) already reads
-- public.synthetic_patrol_logs to render the per-case patrol timeline on the
-- NYC case detail page, but the table was created out of band and its schema
-- never lived in the repo. This migration brings the schema into version
-- control and extends it from a case-only timeline into an officer-linked
-- workload model that a future Stress Testing / Simulation Lab tab can
-- aggregate (workload by officer unit, district, closure bucket, complaint
-- type).
--
-- POSITIONING / PROVENANCE
-- ------------------------
-- These rows are SYNTHETIC. They are generated from the NYC 311 public
-- benchmark cases (public.municipal_complaints) by scripts/
-- generate_synthetic_patrol_logs.py, which links each log to a real benchmark
-- case_id AND to a synthetic officer unit. They are NOT Brampton operational
-- patrol history and NOT an automated enforcement record. The app reads these
-- rows for demonstration and simulation only; nothing here issues a ticket,
-- closes a case, or contacts a resident.
--
-- This is a DIFFERENT table from public.patrol_logs (migration 009), which is a
-- separate Toronto-styled closure-context table. This migration does not touch
-- migration 009 or its table.
--
-- Rows are loaded out of band (CSV \copy or service_role batch). There is
-- intentionally NO authenticated insert/update/delete policy: the app reads only.

create table if not exists public.synthetic_patrol_logs (
  id                         uuid primary key default gen_random_uuid(),
  -- Case link: the NYC 311 benchmark case id (municipal_complaints.case_id).
  case_id                    text not null,
  log_sequence               integer not null,
  activity_at                timestamptz,
  patrol_activity_type       text,
  patrol_status              text,
  -- Officer dimension: which synthetic unit / zone / shift carried the activity.
  officer_unit               text,
  officer_zone               text,
  assigned_shift             text,
  -- Workload dimension: minutes consumed and a 0..1 follow-up intensity score.
  estimated_minutes          integer,
  district_or_area           text,
  complaint_type             text,
  closure_bucket             text,
  patrol_intensity_score     numeric(4, 3),
  supervisor_review_required boolean not null default false,
  -- Narrative (resident-safe, decision-support framing).
  outcome_summary            text,
  recommended_next_step      text,
  created_at                 timestamptz not null default now()
);

comment on table public.synthetic_patrol_logs is
  'SYNTHETIC POC field-activity logs generated from NYC 311 benchmark cases (municipal_complaints.case_id) and linked to synthetic officer units. Not Brampton operational data and not real patrol or enforcement activity. Read-only: powers the case-detail patrol timeline and future Stress Testing workload aggregates. Distinct from public.patrol_logs (migration 009).';

-- Case-detail reads filter by case_id and order by log_sequence.
create index if not exists synthetic_patrol_logs_case_seq_idx
  on public.synthetic_patrol_logs (case_id, log_sequence);

-- Workload aggregates group by these dimensions.
create index if not exists synthetic_patrol_logs_officer_unit_idx
  on public.synthetic_patrol_logs (officer_unit);
create index if not exists synthetic_patrol_logs_district_idx
  on public.synthetic_patrol_logs (district_or_area);
create index if not exists synthetic_patrol_logs_closure_bucket_idx
  on public.synthetic_patrol_logs (closure_bucket);
create index if not exists synthetic_patrol_logs_complaint_type_idx
  on public.synthetic_patrol_logs (complaint_type);

-- Row level security: authenticated staff read only. No anon access and no
-- browser writes, matching the rest of the POC schema (see migration 009).
alter table public.synthetic_patrol_logs enable row level security;

drop policy if exists "Authenticated users can read synthetic patrol logs" on public.synthetic_patrol_logs;
create policy "Authenticated users can read synthetic patrol logs"
  on public.synthetic_patrol_logs for select to authenticated using (true);

grant select on public.synthetic_patrol_logs to authenticated;

-- ---------------------------------------------------------------------------
-- Stress Testing aggregate views.
--
-- Small read-only rollups that convert synthetic patrol logs into operational
-- workload signals. The frontend (a future Stress Testing / Simulation Lab tab)
-- reads these instead of the raw rows. estimated_hours = estimated minutes / 60.
-- ---------------------------------------------------------------------------

create or replace view public.v_synthetic_patrol_workload_by_officer_unit as
select
  coalesce(nullif(btrim(officer_unit), ''), 'Unassigned')        as officer_unit,
  count(*)                                                        as total_logs,
  count(distinct case_id)                                        as distinct_cases,
  coalesce(sum(estimated_minutes), 0)                            as total_estimated_minutes,
  round(coalesce(sum(estimated_minutes), 0) / 60.0, 1)           as total_estimated_hours,
  round(avg(estimated_minutes)::numeric, 1)                      as avg_estimated_minutes,
  count(*) filter (where supervisor_review_required)             as supervisor_review_count
from public.synthetic_patrol_logs
group by 1;

comment on view public.v_synthetic_patrol_workload_by_officer_unit is
  'SYNTHETIC workload per officer unit: log volume, distinct cases, estimated minutes/hours, and supervisor-review count. Stress Testing decision support only; not Brampton operational data.';

create or replace view public.v_synthetic_patrol_workload_by_district as
select
  coalesce(nullif(btrim(district_or_area), ''), 'Unknown')       as district_or_area,
  count(*)                                                        as total_logs,
  count(distinct case_id)                                        as distinct_cases,
  count(distinct officer_unit)                                   as distinct_officer_units,
  coalesce(sum(estimated_minutes), 0)                            as total_estimated_minutes,
  round(coalesce(sum(estimated_minutes), 0) / 60.0, 1)           as total_estimated_hours,
  round(avg(estimated_minutes)::numeric, 1)                      as avg_estimated_minutes,
  count(*) filter (where supervisor_review_required)             as supervisor_review_count
from public.synthetic_patrol_logs
group by 1;

comment on view public.v_synthetic_patrol_workload_by_district is
  'SYNTHETIC workload per district/area: used to surface which areas need more coverage. Stress Testing decision support only; not Brampton operational data.';

create or replace view public.v_synthetic_patrol_workload_by_closure_bucket as
select
  coalesce(nullif(btrim(closure_bucket), ''), 'Unknown')         as closure_bucket,
  count(*)                                                        as total_logs,
  count(distinct case_id)                                        as distinct_cases,
  coalesce(sum(estimated_minutes), 0)                            as total_estimated_minutes,
  round(avg(estimated_minutes)::numeric, 1)                      as avg_estimated_minutes,
  round(avg(patrol_intensity_score)::numeric, 3)                 as avg_patrol_intensity_score,
  count(*) filter (where supervisor_review_required)             as supervisor_review_count
from public.synthetic_patrol_logs
group by 1;

comment on view public.v_synthetic_patrol_workload_by_closure_bucket is
  'SYNTHETIC workload per closure-timing bucket: links slow-closing cases to follow-up workload. Stress Testing decision support only; not Brampton operational data.';

create or replace view public.v_synthetic_patrol_workload_by_complaint_type as
select
  coalesce(nullif(btrim(complaint_type), ''), 'Uncategorized')   as complaint_type,
  count(*)                                                        as total_logs,
  count(distinct case_id)                                        as distinct_cases,
  round(count(*)::numeric / nullif(count(distinct case_id), 0), 2) as avg_logs_per_case,
  coalesce(sum(estimated_minutes), 0)                            as total_estimated_minutes,
  round(avg(estimated_minutes)::numeric, 1)                      as avg_estimated_minutes,
  count(*) filter (where supervisor_review_required)             as supervisor_review_count
from public.synthetic_patrol_logs
group by 1;

comment on view public.v_synthetic_patrol_workload_by_complaint_type is
  'SYNTHETIC workload per complaint type: shows which case types create repeated follow-ups and burn capacity. Stress Testing decision support only; not Brampton operational data.';

grant select on public.v_synthetic_patrol_workload_by_officer_unit   to authenticated;
grant select on public.v_synthetic_patrol_workload_by_district       to authenticated;
grant select on public.v_synthetic_patrol_workload_by_closure_bucket to authenticated;
grant select on public.v_synthetic_patrol_workload_by_complaint_type to authenticated;
