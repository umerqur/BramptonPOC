-- 024_case_explorer_indexes.sql
--
-- Make the Insights Case Explorer drilldowns feel instant — and stop the
-- statement timeout (SQLSTATE 57014, "canceling statement due to statement
-- timeout") that happened when drilling into a high-volume complaint type such
-- as "Illegal Parking".
--
-- Root cause: the Case Explorer page query filtered + ordered the ~3.4M-row
-- public.municipal_complaints table by submitted_at and asked for an EXACT
-- count. The exact count had to visit every matching row (hundreds of thousands
-- for a busy complaint type), which exceeded the statement timeout.
--
-- Two-part fix:
--   1. App side (src/services/caseExplorer.ts): drop the exact count. The page
--      now fetches pageSize + 1 rows to know if a next page exists and uses only
--      a cheap PLANNED count for an approximate hint. Pagination is "Load more".
--   2. DB side (this migration): partial covering-ish indexes on the NYC subset,
--      each ordered by submitted_at DESC NULLS LAST so the filtered + ordered
--      LIMIT slice is served straight from an index instead of a big sort.
--
-- All indexes are PARTIAL on (source_city = 'NYC'), matching the Case Explorer's
-- fixed source_city = 'NYC' predicate, so they stay small and targeted.
--
-- Idempotent: safe to re-run. NOTE: CREATE INDEX (non-concurrent) briefly locks
-- writes while building. On a busy production table you may prefer to run the
-- equivalent CREATE INDEX CONCURRENTLY statements outside a transaction; the
-- IF NOT EXISTS guards keep this migration safe either way.

-- Drilldown by complaint type (the reported Illegal-Parking case), ordered by
-- recency — the most common, and previously the slowest, drilldown.
create index if not exists idx_mc_nyc_complaint_type_submitted
  on public.municipal_complaints (complaint_type, submitted_at desc nulls last)
  where source_city = 'NYC';

-- Drilldown by borough.
create index if not exists idx_mc_nyc_borough_submitted
  on public.municipal_complaints (borough, submitted_at desc nulls last)
  where source_city = 'NYC';

-- Drilldown by council district (map + area bottleneck tables).
create index if not exists idx_mc_nyc_council_district_submitted
  on public.municipal_complaints (council_district, submitted_at desc nulls last)
  where source_city = 'NYC';

-- Drilldown by agency / department. The app ORs across assigned_department,
-- agency_name, and agency, so index all three.
create index if not exists idx_mc_nyc_agency_submitted
  on public.municipal_complaints (agency, submitted_at desc nulls last)
  where source_city = 'NYC';

create index if not exists idx_mc_nyc_agency_name_submitted
  on public.municipal_complaints (agency_name, submitted_at desc nulls last)
  where source_city = 'NYC';

create index if not exists idx_mc_nyc_assigned_department_submitted
  on public.municipal_complaints (assigned_department, submitted_at desc nulls last)
  where source_city = 'NYC';

-- Default (no-filter) Case Explorer view + every drilldown shares this ORDER BY,
-- so a recency index over the NYC subset keeps the unfiltered list instant too.
create index if not exists idx_mc_nyc_submitted
  on public.municipal_complaints (submitted_at desc nulls last)
  where source_city = 'NYC';

-- Exact lookups used by the free-text search and the case detail drawer.
create index if not exists idx_mc_nyc_case_id
  on public.municipal_complaints (case_id)
  where source_city = 'NYC';

create index if not exists idx_mc_nyc_source_dataset_id
  on public.municipal_complaints (source_dataset_id)
  where source_city = 'NYC';
