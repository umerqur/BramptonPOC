-- Workload-density model v1 outputs (per-location), one row per scored location
-- per scoring run.
--
-- This table stores the OUTPUT of the v1 workload-density model
-- (scripts/train_workload_density_v1.py). It is NOT Brampton operational data:
-- it is Toronto 311 public benchmark model output, so every row carries its own
-- provenance (source_city, source_dataset, model_version, feature_window,
-- scoring_period) and an advisory disclaimer. This is decision support only and
-- never a final enforcement decision; authorized staff review every result.
--
-- Honest-result note: v1 only matches a prior-volume persistence baseline (see
-- reports/modeling/v1/modeling_results_v1.md). The realized April volume and
-- label are stored alongside the prediction so the UI can present this honestly.
--
-- Grain is per LOCATION (FSA in v1), which is why this is a new table rather than
-- an overload of public.ai_triage_results (that table is per CASE). SELECT is
-- restricted to the authenticated role, matching the rest of the schema. Rows are
-- written out of band with the service_role key (a local upload script), so there
-- is intentionally NO authenticated insert/update/delete policy.

create table if not exists public.workload_insights_v1 (
  id                      uuid primary key default gen_random_uuid(),
  -- Provenance — required so a row is never mistaken for Brampton operational data.
  source_city             text not null,
  source_dataset          text not null,
  model                   text not null,
  model_version           text not null,
  feature_set_version     text not null,
  feature_window          text not null,
  scoring_period          text not null,
  -- Location + scores.
  location_unit           text not null,
  location_id             text not null,
  workload_score          numeric not null,
  predicted_tier          text not null,
  prior_complaint_count   integer,
  actual_volume           integer,
  high_workload_area_true  boolean,
  top_factors             jsonb,
  advisory                text not null,
  generated_at            timestamptz not null,
  created_at              timestamptz not null default now(),
  -- One row per location per model run; makes re-uploads idempotent (upsert).
  constraint workload_insights_v1_uniq
    unique (model_version, scoring_period, location_unit, location_id)
);

comment on table public.workload_insights_v1 is
  'Toronto 311 benchmark workload-density model (v1) outputs, one row per location per scoring run. Decision support only — not Brampton operational data, not a final enforcement decision.';

create index if not exists workload_insights_v1_period_score_idx
  on public.workload_insights_v1 (scoring_period, workload_score desc);

create index if not exists workload_insights_v1_location_idx
  on public.workload_insights_v1 (location_unit, location_id);

alter table public.workload_insights_v1 enable row level security;

-- Authenticated staff (signed in via magic link) may read workload insights.
-- Matches the authenticated-only posture of the rest of the schema.
drop policy if exists "Authenticated users can read workload insights v1"
  on public.workload_insights_v1;

create policy "Authenticated users can read workload insights v1"
  on public.workload_insights_v1
  for select
  to authenticated
  using (true);

-- Read-only for the app. Inserts/updates happen only via the service_role key
-- from the local upload script, which bypasses RLS, so no write policy is granted
-- to the authenticated role.
grant select on public.workload_insights_v1 to authenticated;
