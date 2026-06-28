-- Migration 034: CTGAN + ABM schema alignment
--
-- Migration 033 created the initial CTGAN ABM tables with uuid id columns and a
-- minimal column set. The actual ABM output CSVs (outputs/ctgan_abm_500k/) use
-- human-readable string ids (e.g. 'scenario_000', 'run_000_20260624_020547',
-- 'run_000_20260624_020547_day_0') and carry richer metric columns (processed,
-- backlog, stale_cases, supervisor_queue_size, overload_flag, ...).
--
-- This migration aligns the schema with those CSVs. No CTGAN ABM data has been
-- loaded yet, so it is safe to DROP and RECREATE the ctgan_abm_* views and
-- tables. It touches ONLY ctgan_abm_* objects -- municipal_service_requests and
-- every other table are left untouched.

BEGIN;

-- 1. Drop the CTGAN ABM views (depend on the tables).
DROP VIEW IF EXISTS public.v_ctgan_abm_latest_run_summary;
DROP VIEW IF EXISTS public.v_ctgan_abm_scenario_summary;
DROP VIEW IF EXISTS public.v_ctgan_abm_daily_summary;
DROP VIEW IF EXISTS public.v_ctgan_abm_district_pressure;
DROP VIEW IF EXISTS public.v_ctgan_abm_complaint_type_pressure;

-- 2. Drop the CTGAN ABM tables (CASCADE clears FKs/policies between them).
DROP TABLE IF EXISTS public.ctgan_abm_complaint_type_metrics CASCADE;
DROP TABLE IF EXISTS public.ctgan_abm_district_metrics CASCADE;
DROP TABLE IF EXISTS public.ctgan_abm_daily_metrics CASCADE;
DROP TABLE IF EXISTS public.ctgan_abm_scenario_runs CASCADE;
DROP TABLE IF EXISTS public.ctgan_abm_scenarios CASCADE;

-- 3. Recreate the 5 tables with text ids and the full metric column set.
--    Column order matches each CSV header in outputs/ctgan_abm_500k/.

-- ctgan_abm_scenarios.csv: scenario_id,name,description,created_at
CREATE TABLE public.ctgan_abm_scenarios (
  scenario_id text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  created_at  timestamptz DEFAULT now()
);

-- ctgan_abm_scenario_runs.csv:
--   run_id,scenario_id,run_date,generated_cases,processed_cases,closed_cases,final_backlog,metadata
CREATE TABLE public.ctgan_abm_scenario_runs (
  run_id          text PRIMARY KEY,
  scenario_id     text REFERENCES public.ctgan_abm_scenarios(scenario_id) ON DELETE SET NULL,
  run_date        timestamptz,
  generated_cases bigint,
  processed_cases bigint,
  closed_cases    bigint,
  final_backlog   bigint,
  metadata        jsonb
);

-- ctgan_abm_daily_metrics.csv:
--   id,run_id,scenario_id,day,total_cases,processed,backlog,stale_cases,supervisor_queue_size,created_at
CREATE TABLE public.ctgan_abm_daily_metrics (
  id                    text PRIMARY KEY,
  run_id                text REFERENCES public.ctgan_abm_scenario_runs(run_id) ON DELETE CASCADE,
  scenario_id           text,
  day                   date NOT NULL,
  total_cases           bigint,
  processed             bigint,
  backlog               bigint,
  stale_cases           bigint,
  supervisor_queue_size bigint,
  created_at            timestamptz DEFAULT now()
);

-- ctgan_abm_district_metrics.csv:
--   id,run_id,scenario_id,district_or_area,total_cases,backlog,stale_cases,overload_flag,estimated_hours,created_at
CREATE TABLE public.ctgan_abm_district_metrics (
  id               text PRIMARY KEY,
  run_id           text REFERENCES public.ctgan_abm_scenario_runs(run_id) ON DELETE CASCADE,
  scenario_id      text,
  district_or_area text NOT NULL,
  total_cases      bigint,
  backlog          bigint,
  stale_cases      bigint,
  overload_flag    integer,
  estimated_hours  numeric,
  created_at       timestamptz DEFAULT now()
);

-- ctgan_abm_complaint_type_metrics.csv:
--   id,run_id,scenario_id,complaint_type,total_cases,estimated_hours,created_at
CREATE TABLE public.ctgan_abm_complaint_type_metrics (
  id              text PRIMARY KEY,
  run_id          text REFERENCES public.ctgan_abm_scenario_runs(run_id) ON DELETE CASCADE,
  scenario_id     text,
  complaint_type  text NOT NULL,
  total_cases     bigint,
  estimated_hours numeric,
  created_at      timestamptz DEFAULT now()
);

-- 4. Enable RLS and (idempotently) recreate a SELECT-only policy on each table.
--    Scoped to an explicit list of ctgan_abm_* tables -- nothing else is touched.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'ctgan_abm_scenarios',
    'ctgan_abm_scenario_runs',
    'ctgan_abm_daily_metrics',
    'ctgan_abm_district_metrics',
    'ctgan_abm_complaint_type_metrics'
  ]) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS select_authenticated ON public.%I;', t);
    EXECUTE format(
      'CREATE POLICY select_authenticated ON public.%I FOR SELECT USING (auth.role() IS NOT NULL);',
      t
    );
  END LOOP;
END$$;

-- 5. Recreate the 5 read-only views (same column contract the frontend reads).
CREATE OR REPLACE VIEW public.v_ctgan_abm_latest_run_summary AS
SELECT r.run_id, s.name AS scenario_name, r.run_date, r.generated_cases
FROM public.ctgan_abm_scenario_runs r
LEFT JOIN public.ctgan_abm_scenarios s ON s.scenario_id = r.scenario_id
ORDER BY r.run_date DESC
LIMIT 1;

CREATE OR REPLACE VIEW public.v_ctgan_abm_scenario_summary AS
SELECT s.scenario_id, s.name AS scenario_name, count(r.run_id) AS runs
FROM public.ctgan_abm_scenarios s
LEFT JOIN public.ctgan_abm_scenario_runs r ON r.scenario_id = s.scenario_id
GROUP BY s.scenario_id, s.name;

CREATE OR REPLACE VIEW public.v_ctgan_abm_daily_summary AS
SELECT day, sum(total_cases) AS total_cases
FROM public.ctgan_abm_daily_metrics
GROUP BY day
ORDER BY day;

CREATE OR REPLACE VIEW public.v_ctgan_abm_district_pressure AS
SELECT district_or_area, sum(total_cases) AS total_cases, sum(estimated_hours) AS estimated_hours
FROM public.ctgan_abm_district_metrics
GROUP BY district_or_area
ORDER BY sum(total_cases) DESC;

CREATE OR REPLACE VIEW public.v_ctgan_abm_complaint_type_pressure AS
SELECT complaint_type, sum(total_cases) AS total_cases, sum(estimated_hours) AS estimated_hours
FROM public.ctgan_abm_complaint_type_metrics
GROUP BY complaint_type
ORDER BY sum(total_cases) DESC;

COMMIT;
