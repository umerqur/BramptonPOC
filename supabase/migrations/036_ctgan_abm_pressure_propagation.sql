-- Migration 036: CTGAN + ABM pressure-propagation layer (ADDITIVE ONLY)
--
-- Purpose: persist the constructed municipal information-propagation layer produced
-- by scripts/ctgan_abm/run_pressure_propagation.py into 5 additive tables (+ 5 read
-- views) so the web app can read the graph, its per-day pressure, and the cascade.
-- The source CSVs live in outputs/ctgan_abm_500k_pressure_propagation/ and are loaded
-- by scripts/ctgan_abm/load_ctgan_abm_pressure.sql.
--
-- HONEST FRAMING: this is a CONSTRUCTED / CALIBRATED information-propagation layer. It
-- is NOT learned from Brampton operational data, NOT a causal proof, and NOT enforcement
-- decisioning. It is built on public municipal 311 benchmark data and the calibrated
-- CTGAN ABM outputs. District->district edges are a documented OPERATIONAL-SIMILARITY
-- adjacency (workload-profile similarity), NOT geographic proof.
--
-- SAFETY: this migration is ADDITIVE ONLY.
--   * It CREATEs 5 new tables (ctgan_abm_pressure_*) and 5 new views
--     (v_ctgan_abm_pressure_*), all previously non-existent names.
--   * It does NOT drop, alter, truncate, or modify any existing table.
--   * It does NOT drop or replace any existing view (033/034/035 views are untouched).
--   * The existing ctgan_abm_* metric tables and every other object are left as-is.
--   * New tables reference public.ctgan_abm_scenarios(scenario_id) (read-only FK); this
--     creates a NEW dependency but does not alter the referenced table.
-- RLS: same SELECT-only policy pattern as the existing ctgan_abm_* tables.

BEGIN;

-- --------------------------------------------------------------------------- --
-- 1. Tables (all column orders match the CSV headers exactly; surrogate identity
--    keys on edges/cascade omit an id column that is not present in the CSVs).
-- --------------------------------------------------------------------------- --

-- ctgan_abm_pressure_nodes.csv:
--   scenario_id,node_id,node_type,label,base_pressure,max_pressure,first_watch_day,first_red_day
CREATE TABLE IF NOT EXISTS public.ctgan_abm_pressure_nodes (
  scenario_id     text NOT NULL REFERENCES public.ctgan_abm_scenarios(scenario_id) ON DELETE CASCADE,
  node_id         text NOT NULL,
  node_type       text NOT NULL CHECK (node_type IN (
                    'district','complaint_type','officer_capacity',
                    'supervisor_review','stale_backlog','final_backlog')),
  label           text,
  base_pressure   numeric CHECK (base_pressure BETWEEN 0 AND 1),
  max_pressure    numeric CHECK (max_pressure  BETWEEN 0 AND 1),
  first_watch_day integer,
  first_red_day   integer,
  PRIMARY KEY (scenario_id, node_id)
);

-- ctgan_abm_pressure_edges.csv:
--   scenario_id,source_node_id,target_node_id,edge_type,weight,description
CREATE TABLE IF NOT EXISTS public.ctgan_abm_pressure_edges (
  edge_key        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scenario_id     text NOT NULL REFERENCES public.ctgan_abm_scenarios(scenario_id) ON DELETE CASCADE,
  source_node_id  text NOT NULL,
  target_node_id  text NOT NULL,
  edge_type       text NOT NULL,
  weight          numeric CHECK (weight >= 0),
  description     text
);

-- ctgan_abm_pressure_timesteps.csv:
--   scenario_id,day,node_id,node_type,base_pressure,incoming_pressure,total_pressure,zone,activated
CREATE TABLE IF NOT EXISTS public.ctgan_abm_pressure_timesteps (
  scenario_id       text NOT NULL REFERENCES public.ctgan_abm_scenarios(scenario_id) ON DELETE CASCADE,
  day               integer NOT NULL CHECK (day >= 1),
  node_id           text NOT NULL,
  node_type         text NOT NULL,
  base_pressure     numeric CHECK (base_pressure  BETWEEN 0 AND 1),
  incoming_pressure numeric CHECK (incoming_pressure >= 0),   -- pre-clamp inbound sum; only lower-bounded
  total_pressure    numeric CHECK (total_pressure BETWEEN 0 AND 1),
  zone              text NOT NULL CHECK (zone IN ('normal','watch','red')),
  activated         integer NOT NULL CHECK (activated IN (0,1)),
  PRIMARY KEY (scenario_id, day, node_id)
);

-- ctgan_abm_pressure_cascade.csv:
--   scenario_id,day,source_node_id,target_node_id,transmitted_pressure,source_zone,target_zone,edge_type
CREATE TABLE IF NOT EXISTS public.ctgan_abm_pressure_cascade (
  cascade_key         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scenario_id         text NOT NULL REFERENCES public.ctgan_abm_scenarios(scenario_id) ON DELETE CASCADE,
  day                 integer NOT NULL CHECK (day >= 1),
  source_node_id      text NOT NULL,
  target_node_id      text NOT NULL,
  transmitted_pressure numeric CHECK (transmitted_pressure >= 0),  -- pre-clamp transmission; only lower-bounded
  source_zone         text NOT NULL CHECK (source_zone IN ('normal','watch','red')),
  target_zone         text NOT NULL CHECK (target_zone IN ('normal','watch','red')),
  edge_type           text NOT NULL
);

-- ctgan_abm_pressure_summary.csv:
--   scenario_id,source_node_id,source_label,peak_pressure,red_node_count,watch_node_count,
--   first_red_day,final_backlog_pressure,supervisor_pressure,stale_pressure,recommended_mitigation
CREATE TABLE IF NOT EXISTS public.ctgan_abm_pressure_summary (
  scenario_id            text PRIMARY KEY REFERENCES public.ctgan_abm_scenarios(scenario_id) ON DELETE CASCADE,
  source_node_id         text,
  source_label           text,
  peak_pressure          numeric CHECK (peak_pressure BETWEEN 0 AND 1),
  red_node_count         integer,
  watch_node_count       integer,
  first_red_day          integer,
  final_backlog_pressure numeric CHECK (final_backlog_pressure BETWEEN 0 AND 1),
  supervisor_pressure    numeric CHECK (supervisor_pressure    BETWEEN 0 AND 1),
  stale_pressure         numeric CHECK (stale_pressure         BETWEEN 0 AND 1),
  recommended_mitigation text
);

-- --------------------------------------------------------------------------- --
-- 2. Indexes (scenario_id, day, node_id, edge_type, zone as required).
-- --------------------------------------------------------------------------- --
CREATE INDEX IF NOT EXISTS idx_pressure_nodes_scenario   ON public.ctgan_abm_pressure_nodes (scenario_id);
CREATE INDEX IF NOT EXISTS idx_pressure_nodes_node       ON public.ctgan_abm_pressure_nodes (node_id);
CREATE INDEX IF NOT EXISTS idx_pressure_nodes_type       ON public.ctgan_abm_pressure_nodes (node_type);

CREATE INDEX IF NOT EXISTS idx_pressure_edges_scenario   ON public.ctgan_abm_pressure_edges (scenario_id);
CREATE INDEX IF NOT EXISTS idx_pressure_edges_type       ON public.ctgan_abm_pressure_edges (edge_type);
CREATE INDEX IF NOT EXISTS idx_pressure_edges_source     ON public.ctgan_abm_pressure_edges (scenario_id, source_node_id);
CREATE INDEX IF NOT EXISTS idx_pressure_edges_target     ON public.ctgan_abm_pressure_edges (scenario_id, target_node_id);

CREATE INDEX IF NOT EXISTS idx_pressure_ts_scenario      ON public.ctgan_abm_pressure_timesteps (scenario_id);
CREATE INDEX IF NOT EXISTS idx_pressure_ts_day           ON public.ctgan_abm_pressure_timesteps (day);
CREATE INDEX IF NOT EXISTS idx_pressure_ts_node          ON public.ctgan_abm_pressure_timesteps (node_id);
CREATE INDEX IF NOT EXISTS idx_pressure_ts_zone          ON public.ctgan_abm_pressure_timesteps (zone);
CREATE INDEX IF NOT EXISTS idx_pressure_ts_scenario_day  ON public.ctgan_abm_pressure_timesteps (scenario_id, day);

CREATE INDEX IF NOT EXISTS idx_pressure_cascade_scenario ON public.ctgan_abm_pressure_cascade (scenario_id);
CREATE INDEX IF NOT EXISTS idx_pressure_cascade_day      ON public.ctgan_abm_pressure_cascade (day);
CREATE INDEX IF NOT EXISTS idx_pressure_cascade_edgetype ON public.ctgan_abm_pressure_cascade (edge_type);
CREATE INDEX IF NOT EXISTS idx_pressure_cascade_source   ON public.ctgan_abm_pressure_cascade (scenario_id, source_node_id);
CREATE INDEX IF NOT EXISTS idx_pressure_cascade_target   ON public.ctgan_abm_pressure_cascade (scenario_id, target_node_id);

-- --------------------------------------------------------------------------- --
-- 3. RLS + SELECT-only policy on each NEW table (same pattern as 033/034).
--    Scoped to an explicit list -- nothing outside these 5 tables is touched.
-- --------------------------------------------------------------------------- --
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'ctgan_abm_pressure_nodes',
    'ctgan_abm_pressure_edges',
    'ctgan_abm_pressure_timesteps',
    'ctgan_abm_pressure_cascade',
    'ctgan_abm_pressure_summary'
  ]) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS select_authenticated ON public.%I;', t);
    EXECUTE format(
      'CREATE POLICY select_authenticated ON public.%I FOR SELECT USING (auth.role() IS NOT NULL);',
      t
    );
  END LOOP;
END$$;

-- --------------------------------------------------------------------------- --
-- 4. Read-only views (all NEW names; CREATE OR REPLACE never touches 033/034/035).
-- --------------------------------------------------------------------------- --

-- 4a. Per-scenario summary joined to scenario name.
CREATE OR REPLACE VIEW public.v_ctgan_abm_pressure_summary AS
SELECT
  su.scenario_id,
  s.name AS scenario_name,
  su.source_node_id,
  su.source_label,
  su.peak_pressure,
  su.red_node_count,
  su.watch_node_count,
  su.first_red_day,
  su.final_backlog_pressure,
  su.supervisor_pressure,
  su.stale_pressure,
  su.recommended_mitigation
FROM public.ctgan_abm_pressure_summary su
LEFT JOIN public.ctgan_abm_scenarios s ON s.scenario_id = su.scenario_id
ORDER BY su.peak_pressure DESC, su.scenario_id;

-- 4b. Top 20 cascade transmissions per scenario (ranked by transmitted pressure).
CREATE OR REPLACE VIEW public.v_ctgan_abm_pressure_top_cascade AS
SELECT
  scenario_id,
  rn AS rank,
  day,
  source_node_id,
  target_node_id,
  transmitted_pressure,
  source_zone,
  target_zone,
  edge_type
FROM (
  SELECT
    c.scenario_id, c.day, c.source_node_id, c.target_node_id,
    c.transmitted_pressure, c.source_zone, c.target_zone, c.edge_type,
    row_number() OVER (
      PARTITION BY c.scenario_id
      ORDER BY c.transmitted_pressure DESC, c.day, c.source_node_id, c.target_node_id
    ) AS rn
  FROM public.ctgan_abm_pressure_cascade c
) ranked
WHERE rn <= 20
ORDER BY scenario_id, rn;

-- 4c. Red-zone node-days (with node label) for the red-zone list / timeline.
CREATE OR REPLACE VIEW public.v_ctgan_abm_pressure_red_nodes AS
SELECT
  t.scenario_id,
  t.day,
  t.node_id,
  t.node_type,
  n.label,
  t.base_pressure,
  t.incoming_pressure,
  t.total_pressure,
  t.zone
FROM public.ctgan_abm_pressure_timesteps t
LEFT JOIN public.ctgan_abm_pressure_nodes n
  ON n.scenario_id = t.scenario_id AND n.node_id = t.node_id
WHERE t.zone = 'red'
ORDER BY t.scenario_id, t.day, t.total_pressure DESC;

-- 4d. Edge list with source/target labels + node types for graph rendering.
CREATE OR REPLACE VIEW public.v_ctgan_abm_pressure_edges AS
SELECT
  e.scenario_id,
  e.source_node_id,
  sn.label     AS source_label,
  sn.node_type AS source_node_type,
  e.target_node_id,
  tn.label     AS target_label,
  tn.node_type AS target_node_type,
  e.edge_type,
  e.weight,
  e.description
FROM public.ctgan_abm_pressure_edges e
LEFT JOIN public.ctgan_abm_pressure_nodes sn
  ON sn.scenario_id = e.scenario_id AND sn.node_id = e.source_node_id
LEFT JOIN public.ctgan_abm_pressure_nodes tn
  ON tn.scenario_id = e.scenario_id AND tn.node_id = e.target_node_id
ORDER BY e.scenario_id, e.weight DESC;

-- 4e. Per-scenario timesteps (with node label) for the day slider / trajectory.
CREATE OR REPLACE VIEW public.v_ctgan_abm_pressure_timesteps_by_scenario AS
SELECT
  t.scenario_id,
  t.day,
  t.node_id,
  t.node_type,
  n.label,
  t.base_pressure,
  t.incoming_pressure,
  t.total_pressure,
  t.zone,
  t.activated
FROM public.ctgan_abm_pressure_timesteps t
LEFT JOIN public.ctgan_abm_pressure_nodes n
  ON n.scenario_id = t.scenario_id AND n.node_id = t.node_id
ORDER BY t.scenario_id, t.day, t.total_pressure DESC;

COMMIT;
