-- 014_nyc311_rich_fields.sql
--
-- Pivot the benchmark source from Toronto 311 to NYC 311 Open Data (Socrata
-- dataset erm2-nwe9). The app table `municipal_complaints` is generic and is
-- KEPT as-is; this migration only ADDS the richer NYC 311 source fields so the
-- normalized NYC schema can be preserved (see docs/nyc311-benchmark.md and
-- scripts/clean_nyc311_service_requests.py).
--
-- This is public NYC 311 benchmark data, not Brampton operational data. The
-- workflow is designed to connect to equivalent Brampton internal data later.
--
-- Idempotent: safe to re-run.

-- Provenance + richer NYC source fields.
alter table public.municipal_complaints
  add column if not exists source_dataset_id text,
  add column if not exists agency text,
  add column if not exists agency_name text,
  add column if not exists request_detail text,
  add column if not exists request_detail_2 text,
  add column if not exists location_type text,
  add column if not exists due_date timestamptz,
  add column if not exists resolution_description text,
  add column if not exists resolution_action_updated_at timestamptz,
  add column if not exists channel text,
  add column if not exists borough text,
  add column if not exists council_district text,
  add column if not exists incident_zip text;

comment on column public.municipal_complaints.source_dataset_id is
  'Benchmark dataset id. NYC 311 = erm2-nwe9.';
comment on column public.municipal_complaints.resolution_description is
  'NYC 311 resolution text — the source for rule-based closure scenarios/templates.';
comment on column public.municipal_complaints.borough is
  'NYC borough (service area / geography). NYC has no wards; borough/council_district are the geographic units.';

-- NYC service request workload by area (borough), aggregated from the loaded
-- benchmark complaints. This is the NYC equivalent of the legacy Toronto ward
-- workload view; the dashboards read workload by `ward_or_area` (populated with
-- the NYC borough on load), so this view is provided for direct area reporting.
create or replace view public.v_nyc_service_request_workload as
select
  coalesce(nullif(btrim(borough), ''), nullif(btrim(ward_or_area), ''), 'Unknown') as area,
  count(*)::bigint as complaint_volume
from public.municipal_complaints
where source_city = 'NYC'
group by 1
order by complaint_volume desc;

comment on view public.v_nyc_service_request_workload is
  'NYC 311 benchmark service-request volume per borough/area. Decision support only; not Brampton operational data.';

-- NOTE: the legacy Toronto geography objects (public.toronto_ward_boundaries and
-- public.v_toronto_ward_workload, migration 007) are intentionally retained for
-- rollback. NYC geography is borough / council district. Brampton ward
-- boundaries remain available as the future local-context layer.
