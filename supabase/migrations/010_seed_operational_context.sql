-- Seed the linked operational POC records created in migration 009.
--
-- complaint_trends is GENERATED from the existing Toronto 311 public benchmark
-- complaints in public.municipal_complaints (real benchmark-derived aggregates).
--
-- patrol_logs and ticket_records are SYNTHETIC POC OPERATIONAL CONTEXT,
-- deterministically generated and linked to the real benchmark complaint
-- case_ids that appear in the Closure Review queue (the needs_attention slice
-- of public.workflow_ml_predictions), so every queue case has linked records.
-- closure_templates are synthetic policy-styled drafting aids.
--
-- The whole seed is idempotent: each section clears the seed-owned table and
-- regenerates it from the current benchmark data. Run with service_role (the
-- tables have no authenticated write policy by design).

-- ---------------------------------------------------------------------------
-- 1. complaint_trends — current 90 days vs the prior 90 days, anchored on the
--    newest benchmark submission (the dataset is a historical snapshot, so
--    wall-clock "now" would put every record in the prior period).
-- ---------------------------------------------------------------------------
delete from public.complaint_trends;

with bounds as (
  select max(submitted_at) as max_ts
  from public.municipal_complaints
  where submitted_at is not null
),
cur as (
  select
    coalesce(mc.ward_or_area, mc.fsa_or_area, 'Unknown area') as area,
    coalesce(mc.complaint_type, 'Uncategorized')              as complaint_type,
    count(*)                                                  as cnt
  from public.municipal_complaints mc, bounds b
  where mc.submitted_at >  b.max_ts - interval '90 days'
    and mc.submitted_at <= b.max_ts
  group by 1, 2
),
prior as (
  select
    coalesce(mc.ward_or_area, mc.fsa_or_area, 'Unknown area') as area,
    coalesce(mc.complaint_type, 'Uncategorized')              as complaint_type,
    count(*)                                                  as cnt
  from public.municipal_complaints mc, bounds b
  where mc.submitted_at >  b.max_ts - interval '180 days'
    and mc.submitted_at <= b.max_ts - interval '90 days'
  group by 1, 2
),
repeats as (
  -- Locations reported 2+ times for the same area + type in the current period.
  select area, complaint_type, count(*) as repeat_location_count
  from (
    select
      coalesce(mc.ward_or_area, mc.fsa_or_area, 'Unknown area') as area,
      coalesce(mc.complaint_type, 'Uncategorized')              as complaint_type,
      mc.address_or_location
    from public.municipal_complaints mc, bounds b
    where mc.submitted_at >  b.max_ts - interval '90 days'
      and mc.submitted_at <= b.max_ts
      and mc.address_or_location is not null
    group by 1, 2, 3
    having count(*) >= 2
  ) t
  group by 1, 2
)
insert into public.complaint_trends
  (area, complaint_type, period_start, period_end, complaint_count,
   prior_period_count, change_percent, repeat_location_count, trend_label)
select
  area,
  complaint_type,
  (b.max_ts - interval '90 days')::date,
  b.max_ts::date,
  coalesce(c.cnt, 0),
  coalesce(p.cnt, 0),
  case when coalesce(p.cnt, 0) = 0 then null
       else round((coalesce(c.cnt, 0) - p.cnt) * 100.0 / p.cnt, 1)
  end,
  coalesce(r.repeat_location_count, 0),
  case
    when coalesce(p.cnt, 0) = 0 and coalesce(c.cnt, 0) > 0 then 'New activity'
    when coalesce(c.cnt, 0) = 0 and coalesce(p.cnt, 0) > 0 then 'Quiet'
    when (coalesce(c.cnt, 0) - p.cnt) * 100.0 / p.cnt >= 20 then 'Rising'
    when (coalesce(c.cnt, 0) - p.cnt) * 100.0 / p.cnt <= -20 then 'Easing'
    else 'Stable'
  end
from cur c
full join prior p using (area, complaint_type)
left join repeats r using (area, complaint_type)
cross join bounds b;

-- ---------------------------------------------------------------------------
-- 2. patrol_logs — 1–2 synthetic patrol entries per Closure Review queue case.
--    Deterministic per case_id (md5-derived hash) so reseeding is stable.
--    Scoped to the top 1000 Needs Attention cases: the queue loads the top 60,
--    so this gives ample headroom without seeding the full 190k benchmark.
-- ---------------------------------------------------------------------------
delete from public.patrol_logs;

with ranked_queue as (
  select source_record_id
  from (
    select distinct on (source_record_id) source_record_id, needs_attention_score
    from public.workflow_ml_predictions
    where prediction_type = 'needs_attention'
      and source_record_id is not null
    order by source_record_id, needs_attention_score desc nulls last
  ) d
  order by needs_attention_score desc nulls last
  limit 1000
),
queue_cases as (
  select distinct
    mc.case_id,
    coalesce(mc.ward_or_area, mc.fsa_or_area)                  as area,
    mc.address_or_location                                     as location,
    mc.complaint_type,
    mc.submitted_at,
    ('x' || substr(md5(mc.case_id), 1, 7))::bit(28)::int       as h
  from public.municipal_complaints mc
  join ranked_queue p
    on p.source_record_id = mc.case_id
)
insert into public.patrol_logs
  (case_id, patrol_date, officer_unit, patrol_type, area, location,
   observed_issue, observation_result, notes)
select
  q.case_id,
  coalesce(q.submitted_at::date, current_date) + (g.n * (2 + q.h % 5)),
  'Unit ' || lpad(((q.h % 12) + 1)::text, 2, '0'),
  case
    when q.complaint_type ilike '%noise%'    then 'Noise patrol'
    when q.complaint_type ilike '%parking%'  then 'Parking enforcement patrol'
    when q.complaint_type ilike '%property%' or q.complaint_type ilike '%standard%'
                                             then 'Property standards inspection'
    when q.complaint_type ilike '%waste%' or q.complaint_type ilike '%garbage%'
      or q.complaint_type ilike '%dump%'     then 'Waste and dumping patrol'
    when q.complaint_type ilike '%grass%' or q.complaint_type ilike '%weed%'
                                             then 'Lot maintenance inspection'
    else 'Area patrol'
  end,
  q.area,
  q.location,
  coalesce(q.complaint_type, 'General concern') || ' reported at this location',
  (array[
    'Issue observed and documented',
    'No issue observed at time of patrol',
    'Issue resolved on site',
    'Follow up patrol required'
  ])[((q.h + g.n) % 4) + 1],
  'Synthetic POC operational record for demo purposes. Linked to Toronto 311 benchmark complaint '
    || q.case_id || '. Not Brampton operational data.'
from queue_cases q
cross join lateral generate_series(1, 1 + (q.h % 2)) as g(n);

-- ---------------------------------------------------------------------------
-- 3. ticket_records — a synthetic enforcement outcome for ~40% of queue cases
--    (same top-1000 Needs Attention scope as patrol_logs).
-- ---------------------------------------------------------------------------
delete from public.ticket_records;

with ranked_queue as (
  select source_record_id
  from (
    select distinct on (source_record_id) source_record_id, needs_attention_score
    from public.workflow_ml_predictions
    where prediction_type = 'needs_attention'
      and source_record_id is not null
    order by source_record_id, needs_attention_score desc nulls last
  ) d
  order by needs_attention_score desc nulls last
  limit 1000
),
queue_cases as (
  select distinct
    mc.case_id,
    mc.complaint_type,
    mc.submitted_at,
    ('x' || substr(md5(mc.case_id), 1, 7))::bit(28)::int as h
  from public.municipal_complaints mc
  join ranked_queue p
    on p.source_record_id = mc.case_id
),
eligible as (
  select *,
    ((h / 7) % 4)                                  as outcome_slot,
    row_number() over (order by case_id)           as rn
  from queue_cases
  where h % 5 < 2
)
insert into public.ticket_records
  (case_id, ticket_number, ticket_date, enforcement_type, violation_category,
   outcome, fine_amount, status, notes)
select
  e.case_id,
  'POC-T-' || lpad(e.rn::text, 5, '0'),
  coalesce(e.submitted_at::date, current_date) + (3 + e.h % 10),
  case
    when e.complaint_type ilike '%parking%'  then 'Parking enforcement'
    when e.complaint_type ilike '%property%' or e.complaint_type ilike '%standard%'
                                             then 'Property standards enforcement'
    when e.complaint_type ilike '%waste%' or e.complaint_type ilike '%garbage%'
      or e.complaint_type ilike '%dump%'     then 'Waste enforcement'
    else 'By-law enforcement'
  end,
  coalesce(e.complaint_type, 'General by-law matter'),
  (array[
    'Ticket issued',
    'Ticket issued',
    'Warning issued',
    'Compliance achieved - no ticket'
  ])[e.outcome_slot + 1],
  (array[250, 400, 0, 0])[e.outcome_slot + 1],
  (array['Issued', 'Paid', 'Closed', 'Closed'])[e.outcome_slot + 1],
  'Synthetic POC operational record for demo purposes. Linked to Toronto 311 benchmark complaint '
    || e.case_id || '. Not Brampton operational data.'
from eligible e;

-- ---------------------------------------------------------------------------
-- 4. closure_templates — generic ('Any') scenario templates plus complaint
--    type specific variants for the five most common benchmark types.
-- ---------------------------------------------------------------------------
delete from public.closure_templates;

insert into public.closure_templates
  (complaint_type, scenario, template_text, required_context, policy_note)
values
  ('Any', 'resolved',
   'Thank you for contacting the City about this concern. Our enforcement team reviewed your file and attended the area, and the reported issue has been addressed. This file is now being closed. If the issue returns or you have new information, please submit a new request and reference your original file number.',
   '{patrol_log}',
   'Confirm a patrol observation supporting resolution is on file before sending.'),
  ('Any', 'no_violation_found',
   'Thank you for contacting the City about this concern. An officer attended the location and did not observe a violation at the time of inspection. Based on that review, this file is being closed. If the issue recurs, please submit a new request — repeat reports help us schedule follow up patrols.',
   '{patrol_log}',
   'Use only when a patrol log records no observed violation. Do not speculate about the original report.'),
  ('Any', 'enforcement_issued',
   'Thank you for contacting the City about this concern. Following a review and site attendance, appropriate enforcement action has been taken in line with City by-laws, and this file is now being closed. For privacy reasons we cannot share details of penalties issued to another party. If the issue continues, please submit a new request.',
   '{patrol_log,ticket_record}',
   'Requires a ticket record on file. Never disclose fine amounts or third party personal information to the reporting resident.'),
  ('Any', 'referred',
   'Thank you for contacting the City about this concern. After review, this matter falls under a different service area, and your file has been referred to the responsible team. They will follow up through their own process. This enforcement file is being closed as referred.',
   '{}',
   'Confirm the receiving service area before sending and record it in the case notes.'),
  ('Any', 'insufficient_information',
   'Thank you for contacting the City about this concern. We were unable to confirm the details needed to take further action on this file. If you can provide additional information — such as the specific address, dates, or times the issue occurs — please submit an updated request so we can follow up.',
   '{}',
   'A follow up request, not a final closure. Confirm staff attempted to verify details first.'),
  ('Any', 'in_progress_update',
   'Thank you for contacting the City. Your request remains under review by the assigned service area. Staff are gathering the information needed to determine the appropriate next step, and your file stays open in the meantime.',
   '{}',
   'Status update language only — this is not closure wording.');

-- Type-specific resolved / no-violation variants for the five most common
-- benchmark complaint types so the matched template can name the issue.
with top_types as (
  select complaint_type
  from public.municipal_complaints
  where complaint_type is not null
  group by complaint_type
  order by count(*) desc
  limit 5
)
insert into public.closure_templates
  (complaint_type, scenario, template_text, required_context, policy_note)
select
  t.complaint_type,
  v.scenario,
  format(v.template_text, lower(t.complaint_type)),
  v.required_context,
  v.policy_note
from top_types t
cross join (
  values
    ('resolved',
     'Thank you for contacting the City about the %s concern you reported. Our enforcement team reviewed your file and attended the area, and the issue has been addressed. This file is now being closed. If the issue returns, please submit a new request and reference your original file number.',
     '{patrol_log}'::text[],
     'Confirm a patrol observation supporting resolution is on file before sending.'),
    ('no_violation_found',
     'Thank you for contacting the City about the %s concern you reported. An officer attended the location and did not observe a violation at the time of inspection. Based on that review, this file is being closed. If the issue recurs, please submit a new request — repeat reports help us schedule follow up patrols.',
     '{patrol_log}'::text[],
     'Use only when a patrol log records no observed violation.')
) as v(scenario, template_text, required_context, policy_note);
