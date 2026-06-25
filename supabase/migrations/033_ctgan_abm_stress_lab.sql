-- Migration 033: CTGAN + ABM stress lab tables, RLS, and views

BEGIN;

-- Tables
CREATE TABLE IF NOT EXISTS public.ctgan_abm_scenarios (
  scenario_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ctgan_abm_scenario_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid REFERENCES public.ctgan_abm_scenarios(scenario_id) ON DELETE SET NULL,
  run_date timestamptz DEFAULT now(),
  generated_cases bigint,
  metadata jsonb
);

CREATE TABLE IF NOT EXISTS public.ctgan_abm_daily_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.ctgan_abm_scenario_runs(run_id) ON DELETE CASCADE,
  day date NOT NULL,
  total_cases bigint,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ctgan_abm_district_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.ctgan_abm_scenario_runs(run_id) ON DELETE CASCADE,
  district_or_area text NOT NULL,
  total_cases bigint,
  estimated_hours numeric,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ctgan_abm_complaint_type_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.ctgan_abm_scenario_runs(run_id) ON DELETE CASCADE,
  complaint_type text NOT NULL,
  total_cases bigint,
  estimated_hours numeric,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS and simple policy: authenticated users can SELECT only
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'ctgan_abm_%' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('CREATE POLICY select_authenticated ON public.%I FOR SELECT USING (auth.role() IS NOT NULL);', t);
  END LOOP;
END$$;

-- Views: simple aggregations for the frontend to read
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
