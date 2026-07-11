-- 040_security_invoker_views_and_rls_initplan.sql
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Supabase security advisor reports every view in public as a critical
-- "Security Definer View" finding (lint 0010). Views in PostgreSQL run with
-- the *owner's* permissions unless security_invoker is set; because all app
-- views are owned by postgres (which bypasses RLS), any role holding a grant
-- on a view could read the underlying rows without the table RLS policies
-- ever being consulted. Concretely: anon held SELECT on all v_* views, so
-- NYC benchmark, workflow, officer/patrol, CTGAN/ABM and pressure data were
-- readable without signing in, even though every underlying table scopes
-- SELECT to authenticated.
--
-- The performance advisor also reports "Auth RLS Initialization Plan"
-- warnings (lint 0003) on the ctgan_abm_* tables: their select_authenticated
-- policies call auth.role() per-row. Wrapping the call in a scalar subquery
-- lets the planner evaluate it once per statement.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- 1. Sets security_invoker = true on every application view in public, so
--    access checks (grants + RLS on underlying tables) use the querying user.
--    ALTER VIEW ... SET preserves the view definition, columns, joins,
--    filters, comments and grants exactly; nothing is recreated.
-- 2. Restores the authenticated read policy on public.synthetic_patrol_logs
--    (declared in migration 032, but absent from the live database, which was
--    partially managed out of band). Without it, the v_synthetic_* views
--    would return zero rows for staff once security_invoker is on.
-- 3. Recreates each ctgan_abm_* select_authenticated policy with the
--    initplan-friendly form: (select auth.role()) is not null. The policy
--    expression is otherwise identical -- same name, same FOR SELECT, same
--    default TO public -- so access semantics are unchanged.
-- 4. Reapplies grants: authenticated keeps SELECT on every view and on the
--    materialized views the insights/NYC views wrap (materialized views have
--    no RLS, so the invoker permission check happens on the matview grant);
--    anon loses all privileges on views, materialized views and ctgan_abm_*
--    tables. The anon resident intake flow (INSERT policies on
--    resident_service_requests / resident_request_attachments and the
--    get_resident_request_status() SECURITY DEFINER function) is not touched.
--
-- The frontend only reads these views from authenticated staff pages
-- (src/pages/app/* behind ProtectedRoute); the anon resident portal never
-- selects from a view, and backend scripts / Netlify functions use
-- service_role, which retains its grants and bypasses RLS. So no application
-- query changes behaviour for signed-in users.
--
-- Everything below is idempotent and existence-guarded: objects that were
-- created out of band (and so have no repo migration) are skipped cleanly on
-- fresh databases, and re-running the file is a no-op.

-- ---------------------------------------------------------------------------
-- 1. Flip every application view in public to SECURITY INVOKER and normalize
--    its grants (authenticated: SELECT only; anon: nothing).
-- ---------------------------------------------------------------------------
do $$
declare
  v text;
begin
  for v in
    select unnest(array[
      -- workflow console (004)
      'v_workflow_stage_counts',
      'v_recent_workflow_events',
      -- Toronto ward context (007)
      'v_toronto_ward_workload',
      -- statistical attention queue (012/013)
      'v_statistical_attention_queue',
      -- NYC 311 workload (014/015/020)
      'v_nyc_service_request_workload',
      'v_nyc_council_district_workload',
      -- insights dashboard (018/019/020/021/023/031)
      'v_insights_kpis',
      'v_insights_complaint_type_volume',
      'v_insights_closure_bottlenecks',
      'v_insights_area_bottlenecks',
      'v_insights_department_workload',
      'v_insights_monthly_trend',
      'v_insights_channel_mix',
      'v_insights_source_meta',
      'v_insights_status_mix',
      'v_insights_closure_duration_distribution',
      -- NYC open-case aggregates (022)
      'v_nyc_open_status_mix',
      'v_nyc_open_aging_buckets',
      'v_nyc_open_complaint_type_volume',
      'v_nyc_open_borough_volume',
      'v_nyc_open_council_district_volume',
      'v_nyc_open_tier_volume',
      'v_nyc_open_review_queue',
      -- resident request normalization (027)
      'v_resident_service_requests_normalized',
      -- NYC map metrics (030)
      'v_nyc_council_district_map_metrics',
      'v_nyc_borough_map_metrics',
      -- operational KPI views (created out of band)
      'v_municipal_complaint_kpis',
      'v_complaints_by_department',
      'v_complaints_by_type',
      'v_complaints_by_ward_or_area',
      'v_activity_smoke_test',
      -- synthetic field activity (created out of band)
      'v_synthetic_field_activity_base',
      'v_synthetic_field_activity_scored',
      'v_synthetic_field_activity_sampled',
      'v_synthetic_field_activity_summary',
      'v_synthetic_field_activity_by_borough',
      'v_synthetic_field_activity_by_closure_bucket',
      'v_synthetic_field_activity_by_complaint_type',
      -- synthetic patrol workload (032)
      'v_synthetic_patrol_workload_by_officer_unit',
      'v_synthetic_patrol_workload_by_district',
      'v_synthetic_patrol_workload_by_closure_bucket',
      'v_synthetic_patrol_workload_by_complaint_type',
      -- CTGAN ABM stress lab (033/034/035 + out of band)
      'v_ctgan_abm_latest_run',
      'v_ctgan_abm_latest_run_summary',
      'v_ctgan_abm_latest_daily_metrics',
      'v_ctgan_abm_latest_district_pressure',
      'v_ctgan_abm_latest_complaint_type_pressure',
      'v_ctgan_abm_scenario_summary',
      'v_ctgan_abm_scenario_options',
      'v_ctgan_abm_daily_summary',
      'v_ctgan_abm_daily_by_scenario',
      'v_ctgan_abm_district_pressure',
      'v_ctgan_abm_district_pressure_by_scenario',
      'v_ctgan_abm_complaint_type_pressure',
      'v_ctgan_abm_complaint_type_pressure_by_scenario',
      'v_ctgan_abm_pressure_summary',
      'v_ctgan_abm_pressure_edges',
      'v_ctgan_abm_pressure_red_nodes',
      'v_ctgan_abm_pressure_timesteps_by_scenario',
      'v_ctgan_abm_pressure_top_cascade'
    ])
  loop
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v and c.relkind = 'v'
    ) then
      execute format('alter view public.%I set (security_invoker = true);', v);
      execute format('revoke all on public.%I from anon;', v);
      execute format('revoke all on public.%I from authenticated;', v);
      execute format('grant select on public.%I to authenticated;', v);
      execute format('grant select on public.%I to service_role;', v);
    else
      raise notice 'skipping view public.% (does not exist here)', v;
    end if;
  end loop;
end$$;

-- ---------------------------------------------------------------------------
-- 2. Materialized views backing the insights / NYC views. Materialized views
--    cannot have RLS, so with security_invoker the effective gate is the
--    grant: authenticated keeps SELECT, anon loses everything.
-- ---------------------------------------------------------------------------
do $$
declare
  m text;
begin
  for m in
    select unnest(array[
      'mv_insights_kpis',
      'mv_insights_complaint_type_volume',
      'mv_insights_closure_bottlenecks',
      'mv_insights_area_bottlenecks',
      'mv_insights_department_workload',
      'mv_insights_monthly_trend',
      'mv_insights_channel_mix',
      'mv_insights_source_meta',
      'mv_insights_status_mix',
      'mv_insights_closure_duration_distribution',
      'mv_nyc_service_request_workload',
      'mv_nyc_council_district_workload',
      'mv_nyc_borough_map_metrics',
      'mv_nyc_council_district_map_metrics',
      'mv_nyc_open_aging_buckets',
      'mv_nyc_open_borough_volume',
      'mv_nyc_open_complaint_type_volume',
      'mv_nyc_open_council_district_volume',
      'mv_nyc_open_review_queue',
      'mv_nyc_open_status_mix',
      'mv_nyc_open_tier_volume'
    ])
  loop
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = m and c.relkind = 'm'
    ) then
      execute format('revoke all on public.%I from anon;', m);
      execute format('revoke all on public.%I from authenticated;', m);
      execute format('grant select on public.%I to authenticated;', m);
      execute format('grant select on public.%I to service_role;', m);
    else
      raise notice 'skipping materialized view public.% (does not exist here)', m;
    end if;
  end loop;
end$$;

-- ---------------------------------------------------------------------------
-- 3. Restore the authenticated read policy on synthetic_patrol_logs.
--    Migration 032 declares this policy, but the live database (managed
--    partially out of band) has RLS enabled with no policy at all -- the
--    advisor flags it as rls_enabled_no_policy. Once the v_synthetic_* views
--    run as invoker, staff reads would return zero rows without it. Exact
--    same policy name and definition as migration 032, with the auth-less
--    "to authenticated using (true)" form that needs no initplan fix.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'synthetic_patrol_logs'
  ) then
    execute 'alter table public.synthetic_patrol_logs enable row level security';
    execute 'drop policy if exists "Authenticated users can read synthetic patrol logs" on public.synthetic_patrol_logs';
    execute 'create policy "Authenticated users can read synthetic patrol logs" on public.synthetic_patrol_logs for select to authenticated using (true)';
    execute 'grant select on public.synthetic_patrol_logs to authenticated';
    execute 'revoke all on public.synthetic_patrol_logs from anon';
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 4. Auth RLS initialization plan fix for the ctgan_abm_* tables.
--    Same policy name (select_authenticated), same command (FOR SELECT),
--    same role scope (default: public), same predicate semantics -- only the
--    auth.role() call is wrapped in a scalar subquery so PostgreSQL
--    evaluates it once per statement instead of once per row.
--    Also revoke anon's table grants: these are staff-only simulation
--    outputs, the app reads them exclusively from authenticated pages, and
--    the (unchanged) predicate alone would let anon through because
--    auth.role() is never null.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'ctgan_abm_scenarios',
      'ctgan_abm_scenario_runs',
      'ctgan_abm_daily_metrics',
      'ctgan_abm_district_metrics',
      'ctgan_abm_complaint_type_metrics',
      'ctgan_abm_pressure_nodes',
      'ctgan_abm_pressure_edges',
      'ctgan_abm_pressure_timesteps',
      'ctgan_abm_pressure_cascade',
      'ctgan_abm_pressure_summary'
    ])
  loop
    if exists (
      select 1 from pg_tables
      where schemaname = 'public' and tablename = t
    ) then
      execute format('alter table public.%I enable row level security;', t);
      execute format('drop policy if exists select_authenticated on public.%I;', t);
      execute format(
        'create policy select_authenticated on public.%I for select using ((select auth.role()) is not null);',
        t
      );
      execute format('revoke all on public.%I from anon;', t);
      execute format('grant select on public.%I to authenticated;', t);
    else
      raise notice 'skipping table public.% (does not exist here)', t;
    end if;
  end loop;
end$$;

-- ---------------------------------------------------------------------------
-- VERIFICATION QUERIES (run after applying; read-only)
-- ---------------------------------------------------------------------------
-- V1. Every public view with its definition (advisor-style overview):
--
--   select schemaname, viewname, definition
--   from pg_views
--   where schemaname = 'public';
--
-- V2. View options through pg_class: every public view must carry
--     security_invoker=true (expect zero rows WITHOUT it):
--
--   select c.relname as view_name, c.reloptions
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public'
--     and c.relkind = 'v'
--     and (c.reloptions is null
--          or not ('security_invoker=true' = any (c.reloptions)
--                  or 'security_invoker=on' = any (c.reloptions)));
--
-- V3. All relevant policies through pg_policies: ctgan policies must use the
--     initplan form, and synthetic_patrol_logs must have its read policy:
--
--   select tablename, policyname, roles, cmd, qual
--   from pg_policies
--   where schemaname = 'public'
--     and (tablename like 'ctgan_abm_%'
--          or tablename = 'synthetic_patrol_logs')
--   order by tablename;
--
--   -- Expect qual = ( ( SELECT auth.role() AS role) IS NOT NULL ) on all
--   -- ctgan_abm_* tables, and "Authenticated users can read synthetic
--   -- patrol logs" (qual = true, roles = {authenticated}) on
--   -- synthetic_patrol_logs.
--
-- V4. Confirm authenticated still reads a representative set of views with
--     the same role the app uses, and that anon cannot (each anon query must
--     fail with "permission denied"):
--
--   set role authenticated;
--   select count(*) from public.v_workflow_stage_counts;
--   select count(*) from public.v_insights_kpis;
--   select count(*) from public.v_nyc_open_aging_buckets;
--   select count(*) from public.v_nyc_borough_map_metrics;
--   select count(*) from public.v_synthetic_patrol_workload_by_district;
--   select count(*) from public.v_synthetic_field_activity_summary;
--   select count(*) from public.v_ctgan_abm_latest_run_summary;
--   reset role;
--
--   set role anon;
--   select count(*) from public.v_workflow_stage_counts;      -- permission denied
--   select count(*) from public.v_insights_kpis;              -- permission denied
--   select count(*) from public.ctgan_abm_scenarios;          -- permission denied
--   reset role;
--
-- V5. Confirm the advisor findings clear: re-run the Security Advisor
--     (security_definer_view should report zero) and the Performance Advisor
--     (auth_rls_initplan should report zero) from the Supabase dashboard.
