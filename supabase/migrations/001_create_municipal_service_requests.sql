-- Municipal service request table for the Brampton Proactive Enforcement POC.
-- This table stores cleaned and normalized public 311 style data.
-- Raw CSV exports are not stored in GitHub.

create table if not exists public.municipal_service_requests (
  id uuid primary key default gen_random_uuid(),
  source_city text not null,
  source_dataset text not null,
  source_id text not null unique,
  opened_at timestamp,
  closed_at timestamp,
  agency text,
  agency_name text,
  category text,
  subcategory text,
  issue_detail text,
  location_type text,
  postal_code text,
  address_label text,
  street_name text,
  city text,
  status text,
  closure_text text,
  community_board text,
  council_district integer,
  district text,
  channel text,
  latitude double precision,
  longitude double precision,
  days_open integer,
  is_closed boolean,
  risk_score integer,
  risk_level text,
  recommended_action text,
  risk_drivers text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_msr_opened_at
  on public.municipal_service_requests (opened_at desc);

create index if not exists idx_msr_category
  on public.municipal_service_requests (category);

create index if not exists idx_msr_district
  on public.municipal_service_requests (district);

create index if not exists idx_msr_risk_score
  on public.municipal_service_requests (risk_score desc);

create index if not exists idx_msr_lat_lng
  on public.municipal_service_requests (latitude, longitude);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_msr_updated_at on public.municipal_service_requests;

create trigger set_msr_updated_at
before update on public.municipal_service_requests
for each row
execute function public.set_updated_at();

alter table public.municipal_service_requests enable row level security;

-- Public read policy for demo data only.
-- Tighten this before loading private City data.
drop policy if exists "Allow public read for demo service requests" on public.municipal_service_requests;

create policy "Allow public read for demo service requests"
on public.municipal_service_requests
for select
using (true);
