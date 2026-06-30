-- 037_add_nyc311_alignment_to_resident_requests.sql
--
-- Temporary NYC 311 alignment for resident intake records.
--
-- The POC runs on the public NYC 311 dataset. Resident intake records are
-- Brampton-style demo submissions, so each intake is mapped to an NYC 311
-- district (plus the closest NYC 311 complaint family and a stable hashed
-- location key) so it can flow through the same queue, hotspot, similar-case,
-- and stress-testing logic as the public NYC 311 data.
--
-- The mapping is DETERMINISTIC: the same location, postal code, and complaint
-- type always map to the same NYC 311 district, so a complaint never drifts
-- between districts across demos, while different inputs spread across the five
-- NYC boroughs.
--
-- In a real Brampton deployment, this would be replaced by Brampton wards,
-- enforcement zones, patrol areas, or another approved operational geography.
--
-- This is workflow / analytics alignment only — never an enforcement decision.
-- Idempotent: safe to re-run.

alter table public.resident_service_requests
add column if not exists nyc311_district text;

alter table public.resident_service_requests
add column if not exists nyc311_complaint_type text;

alter table public.resident_service_requests
add column if not exists nyc311_location_key text;

alter table public.resident_service_requests
add column if not exists nyc311_alignment_version text default 'nyc311_alignment_v1';

comment on column public.resident_service_requests.nyc311_district is
'Temporary POC alignment field. Resident intake records are mapped to an NYC 311 district so they can flow through current NYC 311 queue, hotspot, similar case, and stress testing logic. Replace with Brampton wards, enforcement zones, or patrol areas in a Brampton deployment.';

comment on column public.resident_service_requests.nyc311_complaint_type is
'Temporary POC alignment field. Maps Brampton style intake complaint types to the closest NYC 311 public dataset complaint family for current POC analytics.';

comment on column public.resident_service_requests.nyc311_location_key is
'Temporary POC alignment field. Stable hashed location key derived from resident location and postal code. Used for repeat pattern grouping without exposing exact resident location.';

comment on column public.resident_service_requests.nyc311_alignment_version is
'Tracks the temporary NYC 311 alignment logic version used for POC intake mapping.';

create index if not exists idx_resident_service_requests_nyc311_district
on public.resident_service_requests (nyc311_district);

create index if not exists idx_resident_service_requests_nyc311_complaint_type
on public.resident_service_requests (nyc311_complaint_type);

create index if not exists idx_resident_service_requests_nyc311_location_key
on public.resident_service_requests (nyc311_location_key);

-- Backfill existing historical resident demo cases. Deterministic hashing keeps
-- the same address / postal code / complaint type on the same NYC 311 district.
update public.resident_service_requests
set
  nyc311_district = case
    when abs(('x' || substr(md5(coalesce(location, '') || '|' || coalesce(postal_code, '') || '|' || coalesce(request_type, '')), 1, 8))::bit(32)::int) % 5 = 0 then 'Bronx'
    when abs(('x' || substr(md5(coalesce(location, '') || '|' || coalesce(postal_code, '') || '|' || coalesce(request_type, '')), 1, 8))::bit(32)::int) % 5 = 1 then 'Brooklyn'
    when abs(('x' || substr(md5(coalesce(location, '') || '|' || coalesce(postal_code, '') || '|' || coalesce(request_type, '')), 1, 8))::bit(32)::int) % 5 = 2 then 'Manhattan'
    when abs(('x' || substr(md5(coalesce(location, '') || '|' || coalesce(postal_code, '') || '|' || coalesce(request_type, '')), 1, 8))::bit(32)::int) % 5 = 3 then 'Queens'
    else 'Staten Island'
  end,
  nyc311_complaint_type = case
    when lower(coalesce(request_type, '')) like '%parking%' then 'Blocked Driveway'
    when lower(coalesce(request_type, '')) like '%noise%' then 'Noise'
    when lower(coalesce(request_type, '')) like '%dump%' then 'Illegal Dumping'
    when lower(coalesce(request_type, '')) like '%yard%' then 'Dirty Condition'
    when lower(coalesce(request_type, '')) like '%property%' then 'Building Condition'
    when lower(coalesce(request_type, '')) like '%zoning%' then 'Building Use'
    else 'General Enforcement'
  end,
  nyc311_location_key = substr(md5(lower(coalesce(location, '') || '|' || coalesce(postal_code, ''))), 1, 12),
  nyc311_alignment_version = 'nyc311_alignment_v1'
where nyc311_district is null
   or nyc311_complaint_type is null
   or nyc311_location_key is null;
