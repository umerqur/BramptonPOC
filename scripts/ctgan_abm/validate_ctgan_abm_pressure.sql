-- Validation SQL for the CTGAN ABM pressure-propagation layer (tables from migration 036,
-- data from scripts/ctgan_abm/load_ctgan_abm_pressure.sql). Read-only: runs only SELECTs.
--
--   psql "$SUPABASE_DB_URL" -f scripts/ctgan_abm/validate_ctgan_abm_pressure.sql
--
-- Emits one row per check (expected vs actual + PASS/FAIL), then an overall roll-up.
-- Expected row counts correspond to the calibrated 6-scenario CSV set.

WITH v(ord, check_name, expected, actual, status) AS (

  -- 1..5  row counts
  SELECT 1, 'nodes = 444', '444',
         (SELECT count(*) FROM public.ctgan_abm_pressure_nodes)::text,
         CASE WHEN (SELECT count(*) FROM public.ctgan_abm_pressure_nodes) = 444 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 2, 'edges = 2352', '2352',
         (SELECT count(*) FROM public.ctgan_abm_pressure_edges)::text,
         CASE WHEN (SELECT count(*) FROM public.ctgan_abm_pressure_edges) = 2352 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 3, 'timesteps = 13320', '13320',
         (SELECT count(*) FROM public.ctgan_abm_pressure_timesteps)::text,
         CASE WHEN (SELECT count(*) FROM public.ctgan_abm_pressure_timesteps) = 13320 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 4, 'cascade = 19915', '19915',
         (SELECT count(*) FROM public.ctgan_abm_pressure_cascade)::text,
         CASE WHEN (SELECT count(*) FROM public.ctgan_abm_pressure_cascade) = 19915 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 5, 'summary = 6', '6',
         (SELECT count(*) FROM public.ctgan_abm_pressure_summary)::text,
         CASE WHEN (SELECT count(*) FROM public.ctgan_abm_pressure_summary) = 6 THEN 'PASS' ELSE 'FAIL' END

  -- 6  all 6 scenarios present (distinct scenario_id across the node table)
  UNION ALL
  SELECT 6, 'all 6 scenarios present', '6',
         (SELECT count(DISTINCT scenario_id) FROM public.ctgan_abm_pressure_nodes)::text,
         CASE WHEN (SELECT count(DISTINCT scenario_id) FROM public.ctgan_abm_pressure_nodes) = 6 THEN 'PASS' ELSE 'FAIL' END

  -- 7  every pressure scenario_id is a known scenario (no dangling scenario)
  UNION ALL
  SELECT 7, 'no unknown scenario_id (0 dangling)', '0',
         (SELECT count(*) FROM (
            SELECT scenario_id FROM public.ctgan_abm_pressure_nodes
            UNION SELECT scenario_id FROM public.ctgan_abm_pressure_edges
            UNION SELECT scenario_id FROM public.ctgan_abm_pressure_timesteps
            UNION SELECT scenario_id FROM public.ctgan_abm_pressure_cascade
            UNION SELECT scenario_id FROM public.ctgan_abm_pressure_summary
          ) ps
          WHERE NOT EXISTS (
            SELECT 1 FROM public.ctgan_abm_scenarios s WHERE s.scenario_id = ps.scenario_id
          ))::text,
         CASE WHEN (SELECT count(*) FROM (
            SELECT scenario_id FROM public.ctgan_abm_pressure_nodes
            UNION SELECT scenario_id FROM public.ctgan_abm_pressure_edges
            UNION SELECT scenario_id FROM public.ctgan_abm_pressure_timesteps
            UNION SELECT scenario_id FROM public.ctgan_abm_pressure_cascade
            UNION SELECT scenario_id FROM public.ctgan_abm_pressure_summary
          ) ps
          WHERE NOT EXISTS (
            SELECT 1 FROM public.ctgan_abm_scenarios s WHERE s.scenario_id = ps.scenario_id
          )) = 0 THEN 'PASS' ELSE 'FAIL' END

  -- 8  exactly 30 distinct days per scenario in timesteps
  UNION ALL
  SELECT 8, 'scenarios without exactly 30 days', '0',
         (SELECT count(*) FROM (
            SELECT scenario_id FROM public.ctgan_abm_pressure_timesteps
            GROUP BY scenario_id HAVING count(DISTINCT day) <> 30
          ) x)::text,
         CASE WHEN (SELECT count(*) FROM (
            SELECT scenario_id FROM public.ctgan_abm_pressure_timesteps
            GROUP BY scenario_id HAVING count(DISTINCT day) <> 30
          ) x) = 0 THEN 'PASS' ELSE 'FAIL' END

  -- 9  every scenario has all 6 required node types
  UNION ALL
  SELECT 9, 'scenarios missing a required node type', '0',
         (SELECT count(*) FROM (
            SELECT scenario_id FROM public.ctgan_abm_pressure_nodes
            GROUP BY scenario_id
            HAVING count(DISTINCT node_type) FILTER (WHERE node_type IN (
              'district','complaint_type','officer_capacity',
              'supervisor_review','stale_backlog','final_backlog')) < 6
          ) x)::text,
         CASE WHEN (SELECT count(*) FROM (
            SELECT scenario_id FROM public.ctgan_abm_pressure_nodes
            GROUP BY scenario_id
            HAVING count(DISTINCT node_type) FILTER (WHERE node_type IN (
              'district','complaint_type','officer_capacity',
              'supervisor_review','stale_backlog','final_backlog')) < 6
          ) x) = 0 THEN 'PASS' ELSE 'FAIL' END

  -- 10  all pressure values in [0,1] (every pressure column, every pressure table)
  UNION ALL
  SELECT 10, 'pressure values out of [0,1]', '0',
         (SELECT count(*) FROM (
            SELECT 1 FROM public.ctgan_abm_pressure_nodes
              WHERE base_pressure NOT BETWEEN 0 AND 1 OR max_pressure NOT BETWEEN 0 AND 1
            UNION ALL
            SELECT 1 FROM public.ctgan_abm_pressure_timesteps
              WHERE base_pressure NOT BETWEEN 0 AND 1
                 OR incoming_pressure NOT BETWEEN 0 AND 1
                 OR total_pressure NOT BETWEEN 0 AND 1
            UNION ALL
            SELECT 1 FROM public.ctgan_abm_pressure_cascade
              WHERE transmitted_pressure NOT BETWEEN 0 AND 1
            UNION ALL
            SELECT 1 FROM public.ctgan_abm_pressure_summary
              WHERE peak_pressure NOT BETWEEN 0 AND 1
                 OR final_backlog_pressure NOT BETWEEN 0 AND 1
                 OR supervisor_pressure NOT BETWEEN 0 AND 1
                 OR stale_pressure NOT BETWEEN 0 AND 1
          ) x)::text,
         CASE WHEN (SELECT count(*) FROM (
            SELECT 1 FROM public.ctgan_abm_pressure_nodes
              WHERE base_pressure NOT BETWEEN 0 AND 1 OR max_pressure NOT BETWEEN 0 AND 1
            UNION ALL
            SELECT 1 FROM public.ctgan_abm_pressure_timesteps
              WHERE base_pressure NOT BETWEEN 0 AND 1
                 OR incoming_pressure NOT BETWEEN 0 AND 1
                 OR total_pressure NOT BETWEEN 0 AND 1
            UNION ALL
            SELECT 1 FROM public.ctgan_abm_pressure_cascade
              WHERE transmitted_pressure NOT BETWEEN 0 AND 1
            UNION ALL
            SELECT 1 FROM public.ctgan_abm_pressure_summary
              WHERE peak_pressure NOT BETWEEN 0 AND 1
                 OR final_backlog_pressure NOT BETWEEN 0 AND 1
                 OR supervisor_pressure NOT BETWEEN 0 AND 1
                 OR stale_pressure NOT BETWEEN 0 AND 1
          ) x) = 0 THEN 'PASS' ELSE 'FAIL' END

  -- 11  zones only normal/watch/red (timesteps.zone + cascade source/target zones)
  UNION ALL
  SELECT 11, 'zones not in {normal,watch,red}', '0',
         (SELECT count(*) FROM (
            SELECT 1 FROM public.ctgan_abm_pressure_timesteps
              WHERE zone NOT IN ('normal','watch','red')
            UNION ALL
            SELECT 1 FROM public.ctgan_abm_pressure_cascade
              WHERE source_zone NOT IN ('normal','watch','red')
                 OR target_zone NOT IN ('normal','watch','red')
          ) x)::text,
         CASE WHEN (SELECT count(*) FROM (
            SELECT 1 FROM public.ctgan_abm_pressure_timesteps
              WHERE zone NOT IN ('normal','watch','red')
            UNION ALL
            SELECT 1 FROM public.ctgan_abm_pressure_cascade
              WHERE source_zone NOT IN ('normal','watch','red')
                 OR target_zone NOT IN ('normal','watch','red')
          ) x) = 0 THEN 'PASS' ELSE 'FAIL' END

  -- 12  no dangling edge endpoints (source & target exist as nodes in same scenario)
  UNION ALL
  SELECT 12, 'dangling edge endpoints', '0',
         (SELECT count(*) FROM public.ctgan_abm_pressure_edges e
            WHERE NOT EXISTS (SELECT 1 FROM public.ctgan_abm_pressure_nodes n
                              WHERE n.scenario_id = e.scenario_id AND n.node_id = e.source_node_id)
               OR NOT EXISTS (SELECT 1 FROM public.ctgan_abm_pressure_nodes n
                              WHERE n.scenario_id = e.scenario_id AND n.node_id = e.target_node_id))::text,
         CASE WHEN (SELECT count(*) FROM public.ctgan_abm_pressure_edges e
            WHERE NOT EXISTS (SELECT 1 FROM public.ctgan_abm_pressure_nodes n
                              WHERE n.scenario_id = e.scenario_id AND n.node_id = e.source_node_id)
               OR NOT EXISTS (SELECT 1 FROM public.ctgan_abm_pressure_nodes n
                              WHERE n.scenario_id = e.scenario_id AND n.node_id = e.target_node_id)) = 0
              THEN 'PASS' ELSE 'FAIL' END

  -- 13  no dangling cascade endpoints (bonus: cascade edges reference real nodes)
  UNION ALL
  SELECT 13, 'dangling cascade endpoints', '0',
         (SELECT count(*) FROM public.ctgan_abm_pressure_cascade c
            WHERE NOT EXISTS (SELECT 1 FROM public.ctgan_abm_pressure_nodes n
                              WHERE n.scenario_id = c.scenario_id AND n.node_id = c.source_node_id)
               OR NOT EXISTS (SELECT 1 FROM public.ctgan_abm_pressure_nodes n
                              WHERE n.scenario_id = c.scenario_id AND n.node_id = c.target_node_id))::text,
         CASE WHEN (SELECT count(*) FROM public.ctgan_abm_pressure_cascade c
            WHERE NOT EXISTS (SELECT 1 FROM public.ctgan_abm_pressure_nodes n
                              WHERE n.scenario_id = c.scenario_id AND n.node_id = c.source_node_id)
               OR NOT EXISTS (SELECT 1 FROM public.ctgan_abm_pressure_nodes n
                              WHERE n.scenario_id = c.scenario_id AND n.node_id = c.target_node_id)) = 0
              THEN 'PASS' ELSE 'FAIL' END

  -- 14  no null scenario_id anywhere
  UNION ALL
  SELECT 14, 'null scenario_id rows', '0',
         (SELECT count(*) FROM (
            SELECT 1 FROM public.ctgan_abm_pressure_nodes     WHERE scenario_id IS NULL
            UNION ALL SELECT 1 FROM public.ctgan_abm_pressure_edges     WHERE scenario_id IS NULL
            UNION ALL SELECT 1 FROM public.ctgan_abm_pressure_timesteps WHERE scenario_id IS NULL
            UNION ALL SELECT 1 FROM public.ctgan_abm_pressure_cascade   WHERE scenario_id IS NULL
            UNION ALL SELECT 1 FROM public.ctgan_abm_pressure_summary   WHERE scenario_id IS NULL
          ) x)::text,
         CASE WHEN (SELECT count(*) FROM (
            SELECT 1 FROM public.ctgan_abm_pressure_nodes     WHERE scenario_id IS NULL
            UNION ALL SELECT 1 FROM public.ctgan_abm_pressure_edges     WHERE scenario_id IS NULL
            UNION ALL SELECT 1 FROM public.ctgan_abm_pressure_timesteps WHERE scenario_id IS NULL
            UNION ALL SELECT 1 FROM public.ctgan_abm_pressure_cascade   WHERE scenario_id IS NULL
            UNION ALL SELECT 1 FROM public.ctgan_abm_pressure_summary   WHERE scenario_id IS NULL
          ) x) = 0 THEN 'PASS' ELSE 'FAIL' END
)
SELECT ord AS "#", check_name AS "check", expected, actual, status
FROM v
ORDER BY ord;

-- Overall roll-up (second result set).
WITH v(status) AS (
  SELECT CASE WHEN (SELECT count(*) FROM public.ctgan_abm_pressure_nodes) = 444 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT CASE WHEN (SELECT count(*) FROM public.ctgan_abm_pressure_edges) = 2352 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT CASE WHEN (SELECT count(*) FROM public.ctgan_abm_pressure_timesteps) = 13320 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT CASE WHEN (SELECT count(*) FROM public.ctgan_abm_pressure_cascade) = 19915 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT CASE WHEN (SELECT count(*) FROM public.ctgan_abm_pressure_summary) = 6 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT CASE WHEN (SELECT count(DISTINCT scenario_id) FROM public.ctgan_abm_pressure_nodes) = 6 THEN 'PASS' ELSE 'FAIL' END
)
SELECT CASE WHEN count(*) FILTER (WHERE status = 'FAIL') = 0
            THEN 'CORE COUNTS PASS -- run the full check table above for graph integrity'
            ELSE (count(*) FILTER (WHERE status = 'FAIL'))::text || ' CORE COUNT CHECK(S) FAILED' END
       AS overall
FROM v;
