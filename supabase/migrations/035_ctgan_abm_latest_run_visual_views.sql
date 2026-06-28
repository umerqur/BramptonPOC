-- Migration 035: CTGAN ABM latest-run visual views
--
-- Why: the CTGAN ABM CSVs load ALL scenario runs (25 by default) into the
-- ctgan_abm_* tables. The original aggregate views (033/034) summed metrics
-- across every run, so the Stress Testing page mixed a single latest-run header
-- (generated_cases ~= 48,470) with all-run totals (e.g. "total daily demand" in
-- the tens of millions). daily_metrics.total_cases is also a CUMULATIVE arrival
-- count within a run, so summing it across days AND runs inflated the number
-- further.
--
-- This migration adds latest-run-scoped read views the frontend uses to render
-- coherent, single-run numbers and time-series charts. The "latest run" is the
-- newest run_date, with run_id as the deterministic tie breaker.
--
-- Touches ONLY ctgan_abm_* view objects. No tables, data, RLS, or other schema
-- objects are modified. The older aggregate views are intentionally LEFT IN
-- PLACE for backward compatibility.

BEGIN;

-- Helper: the single latest run (newest run_date, run_id as tie breaker).
-- Every latest-run view joins to this so the "which run" rule lives in one place.
CREATE OR REPLACE VIEW public.v_ctgan_abm_latest_run AS
SELECT run_id, scenario_id
FROM public.ctgan_abm_scenario_runs
ORDER BY run_date DESC NULLS LAST, run_id DESC
LIMIT 1;

-- 1. Latest run summary — one row, the headline run measures.
--    Replaces the prior (all-run-ordered, narrower) latest-run summary view.
DROP VIEW IF EXISTS public.v_ctgan_abm_latest_run_summary;
CREATE VIEW public.v_ctgan_abm_latest_run_summary AS
SELECT
  r.run_id,
  r.scenario_id,
  s.name AS scenario_name,
  r.run_date,
  r.generated_cases,
  r.processed_cases,
  r.closed_cases,
  r.final_backlog,
  r.metadata
FROM public.ctgan_abm_scenario_runs r
JOIN public.v_ctgan_abm_latest_run l ON l.run_id = r.run_id
LEFT JOIN public.ctgan_abm_scenarios s ON s.scenario_id = r.scenario_id;

-- 2. Latest run daily metrics — the 30-day ABM time series, ordered by day.
DROP VIEW IF EXISTS public.v_ctgan_abm_latest_daily_metrics;
CREATE VIEW public.v_ctgan_abm_latest_daily_metrics AS
SELECT
  d.run_id,
  d.scenario_id,
  d.day,
  d.total_cases,
  d.processed,
  d.backlog,
  d.stale_cases,
  d.supervisor_queue_size
FROM public.ctgan_abm_daily_metrics d
JOIN public.v_ctgan_abm_latest_run l ON l.run_id = d.run_id
ORDER BY d.day;

-- 3. Latest run district pressure — per-district load, ordered by volume.
--    share_of_cases is the district's fraction of the run's total district cases.
DROP VIEW IF EXISTS public.v_ctgan_abm_latest_district_pressure;
CREATE VIEW public.v_ctgan_abm_latest_district_pressure AS
SELECT
  d.run_id,
  d.scenario_id,
  d.district_or_area,
  d.total_cases,
  d.backlog,
  d.stale_cases,
  d.overload_flag,
  d.estimated_hours,
  CASE
    WHEN SUM(d.total_cases) OVER () > 0
    THEN d.total_cases::numeric / SUM(d.total_cases) OVER ()
    ELSE 0
  END AS share_of_cases
FROM public.ctgan_abm_district_metrics d
JOIN public.v_ctgan_abm_latest_run l ON l.run_id = d.run_id
ORDER BY d.total_cases DESC;

-- 4. Latest run complaint-type pressure — per-type load, ordered by volume.
DROP VIEW IF EXISTS public.v_ctgan_abm_latest_complaint_type_pressure;
CREATE VIEW public.v_ctgan_abm_latest_complaint_type_pressure AS
SELECT
  c.run_id,
  c.scenario_id,
  c.complaint_type,
  c.total_cases,
  c.estimated_hours,
  CASE
    WHEN SUM(c.total_cases) OVER () > 0
    THEN c.total_cases::numeric / SUM(c.total_cases) OVER ()
    ELSE 0
  END AS share_of_cases
FROM public.ctgan_abm_complaint_type_metrics c
JOIN public.v_ctgan_abm_latest_run l ON l.run_id = c.run_id
ORDER BY c.total_cases DESC;

-- Grant read access to the same roles that read the existing CTGAN ABM views.
GRANT SELECT ON
  public.v_ctgan_abm_latest_run,
  public.v_ctgan_abm_latest_run_summary,
  public.v_ctgan_abm_latest_daily_metrics,
  public.v_ctgan_abm_latest_district_pressure,
  public.v_ctgan_abm_latest_complaint_type_pressure
TO anon, authenticated;

COMMIT;
