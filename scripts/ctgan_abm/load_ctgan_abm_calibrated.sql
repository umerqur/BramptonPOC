-- Client-side loader for the CALIBRATED CTGAN ABM demo scenario set -> Supabase.
--
-- Calibrated demonstration baseline: demand fraction 0.40 (demonstration scale factor),
-- officer capacity x1.0, supervisor capacity x1.0. ~13 red zones, with headroom so shocks
-- can create new red zones. Public 311 benchmark; synthetic demand for capacity planning
-- and decision support only. Not live Brampton data, not enforcement decisioning.
--
-- Prerequisites: migrations 033 and 034 applied. Run from the REPO ROOT. Uses client-side
-- \copy (NOT server-side COPY), so it works against hosted Supabase. Same schema/loader
-- pattern as load_ctgan_abm_500k.sql, pointed at outputs/ctgan_abm_500k_calibrated/.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/ctgan_abm/load_ctgan_abm_calibrated.sql
--
-- Re-running: uncomment the TRUNCATE block. Load order respects the run/scenario FKs.

-- TRUNCATE public.ctgan_abm_daily_metrics,
--          public.ctgan_abm_district_metrics,
--          public.ctgan_abm_complaint_type_metrics,
--          public.ctgan_abm_scenario_runs,
--          public.ctgan_abm_scenarios
--   RESTART IDENTITY CASCADE;

-- Each \copy must stay on a single physical line.
\copy public.ctgan_abm_scenarios (scenario_id,name,description,created_at) FROM 'outputs/ctgan_abm_500k_calibrated/ctgan_abm_scenarios.csv' WITH (FORMAT csv, HEADER true)
\copy public.ctgan_abm_scenario_runs (run_id,scenario_id,run_date,generated_cases,processed_cases,closed_cases,final_backlog,metadata) FROM 'outputs/ctgan_abm_500k_calibrated/ctgan_abm_scenario_runs.csv' WITH (FORMAT csv, HEADER true)
\copy public.ctgan_abm_daily_metrics (id,run_id,scenario_id,day,total_cases,processed,backlog,stale_cases,supervisor_queue_size,created_at) FROM 'outputs/ctgan_abm_500k_calibrated/ctgan_abm_daily_metrics.csv' WITH (FORMAT csv, HEADER true)
\copy public.ctgan_abm_district_metrics (id,run_id,scenario_id,district_or_area,total_cases,backlog,stale_cases,overload_flag,estimated_hours,created_at) FROM 'outputs/ctgan_abm_500k_calibrated/ctgan_abm_district_metrics.csv' WITH (FORMAT csv, HEADER true)
\copy public.ctgan_abm_complaint_type_metrics (id,run_id,scenario_id,complaint_type,total_cases,estimated_hours,created_at) FROM 'outputs/ctgan_abm_500k_calibrated/ctgan_abm_complaint_type_metrics.csv' WITH (FORMAT csv, HEADER true)
