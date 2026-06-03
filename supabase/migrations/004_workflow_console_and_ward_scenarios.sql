-- Operations Workflow Console + synthetic Brampton ward workload overlay.
--
-- This migration adds:
--   1. public.brampton_ward_workload_scenarios — a SYNTHETIC, illustrative
--      workload layer keyed by Brampton ward name. It is NOT Brampton
--      operational complaint data; it exists purely to demonstrate what a
--      ward-level workload heatmap will look like once Brampton provides real
--      operational complaint data. Toronto 311 benchmark records in
--      municipal_complaints are never plotted onto Brampton wards.
--   2. public.v_workflow_stage_counts — live counts by workflow_stage over the
--      Toronto 311 benchmark workflow data, for the Operations Workflow Console.
--   3. public.v_recent_workflow_events — the most recent staff workflow events.
--
-- SELECT is restricted to the authenticated role, matching the other tables.

create table if not exists public.brampton_ward_workload_scenarios (
  id bigserial primary key,
  ward text not null,
  scenario_name text not null default 'Brampton enforcement workload demo scenario',
  complaint_volume integer not null,
  open_cases integer not null,
  in_progress_cases integer not null,
  closed_cases integer not null,
  escalations integer not null,
  top_category text not null,
  estimated_hours_saved numeric not null,
  source_note text not null default 'Synthetic scenario layer for visualization only. Not Brampton operational complaint data.',
  created_at timestamptz default now()
);

truncate table public.brampton_ward_workload_scenarios restart identity;

insert into public.brampton_ward_workload_scenarios
(ward, complaint_volume, open_cases, in_progress_cases, closed_cases, escalations, top_category, estimated_hours_saved)
values
('WARD 1', 9200, 1180, 940, 7080, 410, 'Parking', 620),
('WARD 2', 10400, 1320, 1090, 7990, 520, 'Parking', 710),
('WARD 3', 8700, 980, 820, 6900, 360, 'Property Standards', 570),
('WARD 4', 11200, 1510, 1160, 8530, 610, 'Property Standards', 760),
('WARD 5', 9600, 1260, 890, 7450, 430, 'Noise', 640),
('WARD 6', 10100, 1380, 970, 7750, 490, 'Zoning', 690),
('WARD 7', 8900, 1120, 840, 6940, 370, 'Illegal Dumping', 590),
('WARD 8', 9900, 1330, 930, 7640, 460, 'Parking', 670),
('WARD 9', 9300, 1190, 880, 7230, 390, 'Waste', 610),
('WARD 10', 10800, 1450, 1040, 8310, 540, 'Parking', 730);

alter table public.brampton_ward_workload_scenarios enable row level security;

drop policy if exists "Authenticated users can read Brampton ward workload scenarios"
on public.brampton_ward_workload_scenarios;

create policy "Authenticated users can read Brampton ward workload scenarios"
on public.brampton_ward_workload_scenarios
for select
to authenticated
using (true);

create or replace view public.v_workflow_stage_counts as
select
  coalesce(workflow_stage, 'Needs review') as workflow_stage,
  count(*) as case_count,
  count(*) filter (where priority = 'High') as high_priority_count,
  count(*) filter (where status = 'In Progress') as in_progress_count,
  count(*) filter (where status in ('Completed', 'Closed')) as closed_count
from public.municipal_complaints
group by coalesce(workflow_stage, 'Needs review')
order by case_count desc;

create or replace view public.v_recent_workflow_events as
select
  id,
  case_id,
  event_type,
  event_label,
  from_status,
  to_status,
  actor_type,
  notes,
  created_at
from public.workflow_events
order by created_at desc
limit 25;

grant select on public.v_workflow_stage_counts to authenticated;
grant select on public.v_recent_workflow_events to authenticated;
