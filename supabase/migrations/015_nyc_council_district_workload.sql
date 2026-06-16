-- 015_nyc_council_district_workload.sql
--
-- NYC City Council District is the operational, ward-like geographic unit for the
-- NYC 311 workload heat map. Boroughs (migration 014's
-- v_nyc_service_request_workload) stay as the broader executive overview; this
-- view provides the finer council-district workload that the borough view is too
-- coarse to show. NYC has no wards — boroughs are too broad, council districts are
-- the closest equivalent to a Brampton/Toronto ward.
--
-- This is public NYC 311 benchmark data, not Brampton operational data.
--
-- Idempotent: safe to re-run.

-- NYC 311 benchmark service-request volume per council district, aggregated from
-- the loaded benchmark complaints. `area` is the council district number as text
-- (leading zeros / whitespace stripped) so it matches council_district in the
-- bundled GeoJSON (src/data/nycCouncilDistrictBoundaries.ts).
create or replace view public.v_nyc_council_district_workload as
select
  ltrim(btrim(council_district), '0') as area,
  count(*)::bigint as complaint_volume
from public.municipal_complaints
where source_city = 'NYC'
  and council_district is not null
  and btrim(council_district) <> ''
  and ltrim(btrim(council_district), '0') <> ''
group by 1
order by complaint_volume desc;

comment on view public.v_nyc_council_district_workload is
  'NYC 311 benchmark service-request volume per City Council district (area = council district number). Decision support only; not Brampton operational data. Boroughs remain the broader executive overview (v_nyc_service_request_workload).';
