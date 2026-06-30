-- Migration 038: CTGAN + ABM per-scenario views (ADDITIVE ONLY)
--
-- Purpose: let the Simulation Lab read ONE calibrated scenario at a time
-- (scenario dropdown, day slider, per-scenario 3D heat map / red-zone list, and
-- per-scenario complaint-type pressure). The existing 033/034 views aggregate
-- across all runs and do not expose scenario_id; these views add the missing
-- per-scenario slice.
--
-- These views expose per-scenario calibrated CTGAN ABM outputs. They are based on
-- public NYC 311 benchmark synthetic demand and are for capacity planning and
-- decision support only. They are NOT live Brampton operational data and are NOT
-- enforcement decisioning. They work with the calibrated 6-scenario CSV set
-- (baseline_calibrated + the five shock scenarios) loaded into the ctgan_abm_*
-- tables by scripts/ctgan_abm/load_ctgan_abm_calibrated.sql.
--
-- Safety: this migration is ADDITIVE ONLY. It creates/replaces views and nothing
-- else. No table is created, dropped, altered, truncated, or deleted; no row is
-- modified; migrations 033 and 034 are not changed; municipal_service_requests
-- (and every other non-view object) is untouched.

BEGIN;

-- 1. Scenario dropdown options: one row per scenario joined to its run.
CREATE OR REPLACE VIEW public.v_ctgan_abm_scenario_options AS
SELECT
  s.scenario_id,
  s.name,
  s.description,
  r.run_id,
  r.run_date,
  r.generated_cases,
  r.processed_cases,
  r.closed_cases,
  r.final_backlog
FROM public.ctgan_abm_scenarios s
LEFT JOIN public.ctgan_abm_scenario_runs r ON r.scenario_id = s.scenario_id
ORDER BY s.scenario_id;

-- 2. Daily trajectory by scenario: day slider + trajectory cards.
CREATE OR REPLACE VIEW public.v_ctgan_abm_daily_by_scenario AS
SELECT
  scenario_id,
  run_id,
  day,
  total_cases,
  processed,
  backlog,
  stale_cases,
  supervisor_queue_size
FROM public.ctgan_abm_daily_metrics
ORDER BY scenario_id, day;

-- 3. District pressure by scenario: 3D heat map + red-zone list for the
--    selected scenario (overload_flag marks a red zone).
CREATE OR REPLACE VIEW public.v_ctgan_abm_district_pressure_by_scenario AS
SELECT
  scenario_id,
  run_id,
  district_or_area,
  total_cases,
  backlog,
  stale_cases,
  overload_flag,
  estimated_hours
FROM public.ctgan_abm_district_metrics
ORDER BY scenario_id, backlog DESC;

-- 4. Complaint-type pressure by scenario: top complaint-type load for the
--    selected scenario.
CREATE OR REPLACE VIEW public.v_ctgan_abm_complaint_type_pressure_by_scenario AS
SELECT
  scenario_id,
  run_id,
  complaint_type,
  total_cases,
  estimated_hours
FROM public.ctgan_abm_complaint_type_metrics
ORDER BY scenario_id, total_cases DESC;

COMMIT;
