-- Client-side loader for the CONSTRUCTED CTGAN ABM pressure-propagation layer -> Supabase.
--
-- Loads the 5 CSVs produced by scripts/ctgan_abm/run_pressure_propagation.py from
-- outputs/ctgan_abm_500k_pressure_propagation/ into the 5 additive pressure tables
-- created by migration 036_ctgan_abm_pressure_propagation.sql.
--
-- This is a CONSTRUCTED / CALIBRATED information-propagation layer. It is NOT learned
-- from Brampton operational data, NOT a causal proof, and NOT enforcement decisioning.
-- It is built on public municipal 311 benchmark data and calibrated CTGAN ABM outputs.
--
-- Prerequisites:
--   1. Migration 036 applied (the 5 ctgan_abm_pressure_* tables exist).
--   2. The scenario rows already loaded (load_ctgan_abm_calibrated.sql) -- the pressure
--      tables carry a FK to public.ctgan_abm_scenarios(scenario_id), so the 6 calibrated
--      scenarios must exist first or the \copy will fail loudly on the FK.
--   3. Run from the REPO ROOT. Uses client-side \copy (NOT server-side COPY), so it
--      works against hosted Supabase. Same loader pattern as load_ctgan_abm_calibrated.sql.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/ctgan_abm/load_ctgan_abm_pressure.sql
--
-- Re-running is safe and idempotent: the TRUNCATE below clears ONLY these 5 pressure
-- tables (RESTART IDENTITY resets the edge_key/cascade_key sequences) and reloads them.
-- It does NOT touch the existing CTGAN ABM metric tables or any other table.

BEGIN;

-- TRUNCATE ONLY the 5 pressure tables. RESTART IDENTITY resets the surrogate
-- edge_key / cascade_key sequences. No CASCADE: nothing references these tables.
TRUNCATE public.ctgan_abm_pressure_nodes,
         public.ctgan_abm_pressure_edges,
         public.ctgan_abm_pressure_timesteps,
         public.ctgan_abm_pressure_cascade,
         public.ctgan_abm_pressure_summary
  RESTART IDENTITY;

-- Each \copy must stay on a single physical line. Column lists match the CSV headers
-- exactly; edges/cascade omit their surrogate identity key (auto-generated on load).
\copy public.ctgan_abm_pressure_nodes (scenario_id,node_id,node_type,label,base_pressure,max_pressure,first_watch_day,first_red_day) FROM 'outputs/ctgan_abm_500k_pressure_propagation/ctgan_abm_pressure_nodes.csv' WITH (FORMAT csv, HEADER true)
\copy public.ctgan_abm_pressure_edges (scenario_id,source_node_id,target_node_id,edge_type,weight,description) FROM 'outputs/ctgan_abm_500k_pressure_propagation/ctgan_abm_pressure_edges.csv' WITH (FORMAT csv, HEADER true)
\copy public.ctgan_abm_pressure_timesteps (scenario_id,day,node_id,node_type,base_pressure,incoming_pressure,total_pressure,zone,activated) FROM 'outputs/ctgan_abm_500k_pressure_propagation/ctgan_abm_pressure_timesteps.csv' WITH (FORMAT csv, HEADER true)
\copy public.ctgan_abm_pressure_cascade (scenario_id,day,source_node_id,target_node_id,transmitted_pressure,source_zone,target_zone,edge_type) FROM 'outputs/ctgan_abm_500k_pressure_propagation/ctgan_abm_pressure_cascade.csv' WITH (FORMAT csv, HEADER true)
\copy public.ctgan_abm_pressure_summary (scenario_id,source_node_id,source_label,peak_pressure,red_node_count,watch_node_count,first_red_day,final_backlog_pressure,supervisor_pressure,stale_pressure,recommended_mitigation) FROM 'outputs/ctgan_abm_500k_pressure_propagation/ctgan_abm_pressure_summary.csv' WITH (FORMAT csv, HEADER true)

COMMIT;

-- Quick post-load sanity counts (expected: 444 / 2352 / 13320 / 19915 / 6).
SELECT 'nodes'     AS table, count(*) AS rows FROM public.ctgan_abm_pressure_nodes
UNION ALL SELECT 'edges',     count(*) FROM public.ctgan_abm_pressure_edges
UNION ALL SELECT 'timesteps', count(*) FROM public.ctgan_abm_pressure_timesteps
UNION ALL SELECT 'cascade',   count(*) FROM public.ctgan_abm_pressure_cascade
UNION ALL SELECT 'summary',   count(*) FROM public.ctgan_abm_pressure_summary;
