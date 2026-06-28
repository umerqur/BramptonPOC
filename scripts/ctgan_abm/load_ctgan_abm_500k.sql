-- Client-side loader for the CTGAN ABM 500k run -> Supabase.
--
-- Prerequisites:
--   1. Migrations 033 and 034 have been applied (034 gives the tables text ids
--      and the full metric columns this loader targets).
--   2. You run this from the REPO ROOT so the relative paths resolve.
--   3. Paths point at outputs/ctgan_abm_500k/ (git-ignored local artifacts).
--
-- Usage (psql, client-side \copy -- NOT server-side COPY, so it works against
-- hosted Supabase where the DB server has no local filesystem access):
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/ctgan_abm/load_ctgan_abm_500k.sql
--
-- synthetic_complaint_arrivals.csv is intentionally NOT loaded: it has no
-- destination table (it is the raw generated arrival stream, not a metric).
--
-- Re-running: uncomment the TRUNCATE block to reload idempotently. Load order
-- matters because of the run_id / scenario_id foreign keys.

-- TRUNCATE public.ctgan_abm_daily_metrics,
--          public.ctgan_abm_district_metrics,
--          public.ctgan_abm_complaint_type_metrics,
--          public.ctgan_abm_scenario_runs,
--          public.ctgan_abm_scenarios
--   RESTART IDENTITY CASCADE;

-- Each \copy must stay on a single physical line.
\copy public.ctgan_abm_scenarios (scenario_id,name,description,created_at) FROM 'outputs/ctgan_abm_500k/ctgan_abm_scenarios.csv' WITH (FORMAT csv, HEADER true)
\copy public.ctgan_abm_scenario_runs (run_id,scenario_id,run_date,generated_cases,processed_cases,closed_cases,final_backlog,metadata) FROM 'outputs/ctgan_abm_500k/ctgan_abm_scenario_runs.csv' WITH (FORMAT csv, HEADER true)
\copy public.ctgan_abm_daily_metrics (id,run_id,scenario_id,day,total_cases,processed,backlog,stale_cases,supervisor_queue_size,created_at) FROM 'outputs/ctgan_abm_500k/ctgan_abm_daily_metrics.csv' WITH (FORMAT csv, HEADER true)
\copy public.ctgan_abm_district_metrics (id,run_id,scenario_id,district_or_area,total_cases,backlog,stale_cases,overload_flag,estimated_hours,created_at) FROM 'outputs/ctgan_abm_500k/ctgan_abm_district_metrics.csv' WITH (FORMAT csv, HEADER true)
\copy public.ctgan_abm_complaint_type_metrics (id,run_id,scenario_id,complaint_type,total_cases,estimated_hours,created_at) FROM 'outputs/ctgan_abm_500k/ctgan_abm_complaint_type_metrics.csv' WITH (FORMAT csv, HEADER true)
