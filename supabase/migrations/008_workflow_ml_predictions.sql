-- Complaint-level V2 workflow ML predictions over the Toronto 311 benchmark.
--
-- public.workflow_ml_predictions stores one row per scored complaint: the
-- "Needs Attention" (handling-path / stale-risk) model-assisted attention rank,
-- plus routing outputs kept for RESEARCH ONLY (Toronto routing mostly learned a
-- complaint_type -> department lookup, so it is not an operational recommendation).
--
-- This is Toronto 311 public benchmark model output — NOT Brampton operational
-- data, NOT automated enforcement, and NOT geographic prediction. Every row
-- carries its own provenance and an advisory disclaimer. Needs Attention is a
-- RELATIVE ranking (attention_tier / attention_rank), not a hard probability.
--
-- Rows are written out of band with the service_role key (a batch upload script),
-- so there is intentionally NO authenticated insert/update/delete policy. The app
-- reads only.

create table if not exists public.workflow_ml_predictions (
  id                    uuid primary key default gen_random_uuid(),
  source_city           text not null default 'Toronto',
  source_dataset        text not null,
  model_version         text not null,
  model_name            text not null,
  prediction_type       text not null,
  source_record_id      text,
  source_row_hash       text not null,
  complaint_type        text,
  description           text,
  ward_or_area          text,
  status                text,
  assigned_department   text,
  predicted_department  text,
  routing_confidence    numeric,
  needs_attention_score numeric,
  attention_tier        text,
  attention_rank        integer,
  advisory              text not null,
  scored_at             timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  -- One row per source complaint per model/prediction type; idempotent upserts.
  constraint workflow_ml_predictions_uniq
    unique (model_version, prediction_type, source_row_hash)
);

comment on table public.workflow_ml_predictions is
  'Toronto 311 benchmark V2 workflow ML predictions, one row per scored complaint. Needs Attention is a relative model-assisted ranking (decision support only); routing columns are research-only. Not Brampton operational data, not automated enforcement.';

create index if not exists workflow_ml_predictions_attention_idx
  on public.workflow_ml_predictions (needs_attention_score desc nulls last);

create index if not exists workflow_ml_predictions_type_idx
  on public.workflow_ml_predictions (prediction_type);

alter table public.workflow_ml_predictions enable row level security;

-- Authenticated staff (magic link) may read. No anon access, no browser writes.
drop policy if exists "Authenticated users can read workflow ML predictions"
  on public.workflow_ml_predictions;

create policy "Authenticated users can read workflow ML predictions"
  on public.workflow_ml_predictions
  for select
  to authenticated
  using (true);

grant select on public.workflow_ml_predictions to authenticated;
