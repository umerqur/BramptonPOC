-- Statistical Queue Insights — explainable, classical statistical scoring over
-- the Toronto 311 public benchmark data.
--
-- This layer replaces the previous "ML model" framing with a transparent
-- Review Attention Score: a relative, explainable queue rank built from
-- z-scores, percentiles, repeat counts, and missing-context checks. It does NOT
-- predict an enforcement outcome and is NOT a machine-learning model. It is
-- decision support only — staff review and approve every case.
--
-- The previous public.workflow_ml_predictions table is intentionally LEFT IN
-- PLACE for rollback; the application simply stops reading it. Scores in these
-- tables are generated out of band by
-- scripts/build_statistical_attention_scores.py using the service_role key, so
-- there is intentionally NO authenticated insert/update/delete policy here — the
-- app reads only.

-- 1. Provenance — one row per scoring run -----------------------------------
create table if not exists public.statistical_model_runs (
  id                 uuid primary key default gen_random_uuid(),
  score_version      text not null,
  source_city        text not null default 'Toronto',
  source_dataset     text not null,
  target_definition  text not null,
  methodology        text not null,
  created_at         timestamptz not null default now(),
  constraint statistical_model_runs_version_uniq unique (score_version)
);

comment on table public.statistical_model_runs is
  'Provenance for each Review Attention Score run: source city/dataset, the statistical target definition, and the methodology. Classical statistical scoring, not an ML model.';

-- 2. One row per scored complaint — drives the review queue -----------------
create table if not exists public.statistical_case_scores (
  id                       uuid primary key default gen_random_uuid(),
  case_id                  text,
  source_record_id         text,
  attention_score          numeric,
  attention_tier           text,           -- Higher | Medium | Lower
  attention_rank           integer,
  aging_z_score            numeric,
  repeat_location_count    integer,
  area_trend_z_score       numeric,
  type_backlog_percentile  numeric,
  missing_context_count    integer,
  top_driver_1             text,
  top_driver_2             text,
  top_driver_3             text,
  score_version            text not null,
  advisory                 text not null,
  created_at               timestamptz not null default now(),
  -- One row per source complaint per score version; idempotent upserts.
  constraint statistical_case_scores_uniq unique (score_version, source_record_id)
);

comment on table public.statistical_case_scores is
  'Review Attention Score per complaint: a transparent, relative queue rank (Higher/Medium/Lower) built from aging z-scores, repeat-location counts, area trends, type backlog percentiles, and missing-context checks. Decision support only — not an automated decision, not an ML model.';

create index if not exists statistical_case_scores_score_idx
  on public.statistical_case_scores (attention_score desc nulls last);

create index if not exists statistical_case_scores_rank_idx
  on public.statistical_case_scores (attention_rank asc nulls last);

create index if not exists statistical_case_scores_source_idx
  on public.statistical_case_scores (source_record_id);

-- 3. Explainability — feature / target correlations from EDA ----------------
create table if not exists public.statistical_feature_correlations (
  id                      uuid primary key default gen_random_uuid(),
  feature_name            text not null,
  target_name             text not null,
  correlation_coefficient numeric,
  direction               text,            -- positive | negative
  interpretation          text,
  sample_size             integer,
  score_version           text not null,
  created_at              timestamptz not null default now()
);

comment on table public.statistical_feature_correlations is
  'Correlation coefficients between transparent features (case age, repeat-location count, area trend, etc.) and the aging / closure-burden target. Supports the explainability story behind the Review Attention Score.';

-- 4. Area / complaint-type trend table --------------------------------------
create table if not exists public.statistical_area_trends (
  id                    uuid primary key default gen_random_uuid(),
  ward_or_area          text,
  complaint_type        text,
  current_period_count  integer,
  prior_period_count    integer,
  change_percent        numeric,
  trend_label           text,             -- e.g. Rising | Stable | Falling
  z_score               numeric,
  score_version         text not null,
  created_at            timestamptz not null default now()
);

comment on table public.statistical_area_trends is
  'Per-area, per-complaint-type volume trends (current vs prior period, change %, z-score) used to compute the area-trend driver of the Review Attention Score.';

-- Read-only access (mirrors workflow_ml_predictions): authenticated staff may
-- read; rows are written out of band with the service_role key. No browser
-- writes, no anon access.
do $$
declare
  t text;
begin
  foreach t in array array[
    'statistical_model_runs',
    'statistical_case_scores',
    'statistical_feature_correlations',
    'statistical_area_trends'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "Authenticated users can read %1$s" on public.%1$s;', t);
    execute format(
      'create policy "Authenticated users can read %1$s" on public.%1$s for select to authenticated using (true);',
      t
    );
    execute format('grant select on public.%I to authenticated;', t);
  end loop;
end $$;

-- 5. Queue view — top-ranked cases for staff review -------------------------
-- Joins the per-complaint scores to the Toronto 311 benchmark complaint record
-- (public.municipal_complaints) by source_record_id = case_id, exposing the
-- columns the Statistical Insights page renders.
create or replace view public.v_statistical_attention_queue as
select
  s.case_id,
  s.source_record_id,
  c.complaint_type,
  c.status,
  c.workflow_stage,
  c.assigned_department,
  c.ward_or_area,
  c.address_or_location,
  s.attention_score,
  s.attention_tier,
  s.attention_rank,
  s.top_driver_1,
  s.top_driver_2,
  s.top_driver_3,
  s.advisory,
  s.score_version
from public.statistical_case_scores s
left join public.municipal_complaints c
  on c.case_id = s.source_record_id
order by s.attention_rank asc nulls last, s.attention_score desc nulls last;

comment on view public.v_statistical_attention_queue is
  'Top-ranked Review Attention cases joined to benchmark complaint context. Read-only decision support; staff review every case.';

grant select on public.v_statistical_attention_queue to authenticated;
