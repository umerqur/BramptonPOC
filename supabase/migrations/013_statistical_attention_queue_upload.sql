-- Direct-upload Review Attention Score queue.
--
-- The Review Attention Score for the SR2026 dataset is generated out of band
-- (from the Toronto 311 public benchmark) and delivered as a single scored CSV:
-- statistical_attention_queue_upload.csv. Rather than re-deriving the queue from
-- a join across statistical_case_scores + municipal_complaints, the app now reads
-- the scored rows directly from an uploaded table.
--
-- This is a transparent, RELATIVE statistical queue rank (Higher / Medium /
-- Lower) — case aging percentiles, repeat-location counts, area-trend z-scores,
-- type-backlog percentiles, and missing-context checks. It is NOT a
-- machine-learning model, NOT a probability, and NOT an automated or enforcement
-- decision. Decision support only — staff review every case.
--
-- NOTE: source_record_id / case_id in this upload are generated ids
-- (SR2026-000001, SR2026-000002, ...). They do NOT join to
-- public.municipal_complaints, so the queue is self-contained: every column the
-- Statistical Queue Insights page renders lives on this one table.

-- 1. Upload table — one row per scored case, loaded directly from the CSV ------
create table if not exists public.statistical_attention_queue_upload (
  id                                    bigint generated always as identity primary key,
  case_id                               text,
  source_record_id                      text,
  creation_date                         text,
  complaint_type                        text,
  status                                text,
  workflow_stage                        text,
  assigned_department                   text,
  department_unit                       text,
  ward_or_area                          text,
  fsa_or_area                           text,
  address_or_location                   text,
  attention_score                       numeric,
  attention_tier                        text,           -- Higher | Medium | Lower
  attention_rank                        integer,
  case_age_days                         integer,
  age_percentile_within_complaint_type  numeric,
  open_status_flag                      integer,
  repeat_location_count                 integer,
  area_trend_z_score                    numeric,
  type_backlog_percentile               numeric,
  missing_context_count                 integer,
  department_workload_share             numeric,
  top_driver_1                          text,
  top_driver_2                          text,
  top_driver_3                          text,
  score_version                         text,
  advisory                              text,
  created_at                            timestamptz not null default now()
);

comment on table public.statistical_attention_queue_upload is
  'Directly uploaded Review Attention Score queue (statistical_attention_queue_upload.csv). One row per scored case with all context the Statistical Queue Insights page renders. Generated case ids (SR2026-NNNNNN) — does not join to municipal_complaints. Transparent statistical rank, decision support only — not an ML model, not an enforcement decision.';

create index if not exists statistical_attention_queue_upload_rank_idx
  on public.statistical_attention_queue_upload (attention_rank asc nulls last);

create index if not exists statistical_attention_queue_upload_score_idx
  on public.statistical_attention_queue_upload (attention_score desc nulls last);

-- Read-only access for authenticated staff; rows are loaded out of band (CSV
-- import / service_role). No browser writes, no anon access — mirrors the other
-- statistical tables.
alter table public.statistical_attention_queue_upload enable row level security;
drop policy if exists "Authenticated users can read statistical_attention_queue_upload"
  on public.statistical_attention_queue_upload;
create policy "Authenticated users can read statistical_attention_queue_upload"
  on public.statistical_attention_queue_upload
  for select to authenticated using (true);
grant select on public.statistical_attention_queue_upload to authenticated;

-- 2. Queue view — now a direct select from the uploaded table -----------------
-- The previous definition joined statistical_case_scores to municipal_complaints
-- by source_record_id. The SR2026 generated ids do not match municipal_complaints,
-- so we drop that join and read the self-contained upload table directly. The
-- column set changes, so we drop-and-recreate rather than create-or-replace.
drop view if exists public.v_statistical_attention_queue;

create view public.v_statistical_attention_queue as
select
  case_id,
  source_record_id,
  creation_date,
  complaint_type,
  status,
  workflow_stage,
  assigned_department,
  department_unit,
  ward_or_area,
  fsa_or_area,
  address_or_location,
  attention_score,
  attention_tier,
  attention_rank,
  case_age_days,
  age_percentile_within_complaint_type,
  open_status_flag,
  repeat_location_count,
  area_trend_z_score,
  type_backlog_percentile,
  missing_context_count,
  department_workload_share,
  top_driver_1,
  top_driver_2,
  top_driver_3,
  score_version,
  advisory
from public.statistical_attention_queue_upload
order by attention_rank asc nulls last, attention_score desc nulls last;

comment on view public.v_statistical_attention_queue is
  'Top-ranked Review Attention cases read directly from statistical_attention_queue_upload (the uploaded SR2026 scored CSV). Self-contained — no join to municipal_complaints. Read-only decision support; staff review every case.';

grant select on public.v_statistical_attention_queue to authenticated;
