-- Resident Intake Demo — public resident service request flow.
--
-- CLEARLY A DEMO. This table is intentionally separate from:
--   * municipal_complaints (Toronto 311 public benchmark data), and
--   * the authenticated /app workbench tables,
-- so the public resident simulation never mixes with benchmark data and never
-- touches operational records. It holds only demo submissions entered through
-- the public /resident flow.
--
-- The field set mirrors the real City of Brampton 311 "Report a Parking
-- Infraction" Service Request Form (Location → Details → Contact → Review):
-- an address/intersection location, a parking problem type plus additional
-- information, and the resident's contact details.
--
-- PRIVACY MODEL
-- -------------
-- A resident submits a request (anon INSERT). Resident contact details
-- (email / phone / postal code) are NEVER exposed to anonymous readers: anon
-- has no SELECT on the base table. The public status page looks a single
-- request up by its demo case id through the SECURITY DEFINER function
-- public.get_resident_request_status(text), which returns only non-sensitive
-- columns. Authenticated staff (the /app workbench) may read the full row and
-- update the status as they work the request.

create table if not exists public.resident_service_requests (
  id uuid primary key default gen_random_uuid(),
  case_id text not null unique,

  -- Step 1 — Location of concern
  address_type text,                 -- 'Street Address' | 'Intersection'
  location text not null,            -- street address or nearest intersection
  city text,
  province text,

  -- Step 2 — Details
  request_type text not null,        -- "Problem Type" (general enforcement complaint type)
  description text,                  -- "Additional Information" (optional)

  -- Step 3 — Contact
  first_name text not null,
  last_name text not null,
  resident_name text not null,       -- "{first} {last}", for display
  unit_number text,
  postal_code text,
  country text,
  resident_phone text,               -- contact phone number
  resident_email text not null,      -- contact email address
  resolution_followup boolean not null default false,
  method_of_contact text,            -- 'Email' | 'Phone'

  -- Canonical status mirrors the enforcement lifecycle, up to close:
  -- submitted -> received -> assigned -> in_review -> closed.
  status text not null default 'submitted'
    check (status in ('submitted', 'received', 'assigned', 'in_review', 'closed')),
  -- Always true for now — this table only ever holds demo submissions.
  is_demo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_rsr_case_id on public.resident_service_requests (case_id);
create index if not exists idx_rsr_status on public.resident_service_requests (status);
create index if not exists idx_rsr_created_at on public.resident_service_requests (created_at desc);

-- Reuse the shared updated_at trigger function (created in migration 001).
drop trigger if exists set_rsr_updated_at on public.resident_service_requests;

create trigger set_rsr_updated_at
before update on public.resident_service_requests
for each row
execute function public.set_updated_at();

alter table public.resident_service_requests enable row level security;

-- Table-level privileges (RLS still gates every row). Anonymous residents may
-- INSERT; authenticated staff may read and update.
grant insert on public.resident_service_requests to anon;
grant select, insert, update on public.resident_service_requests to authenticated;

-- Anonymous residents may SUBMIT a demo request. The WITH CHECK keeps the table
-- demo-only — anon can only insert rows flagged is_demo and starting at the
-- initial 'submitted' status.
drop policy if exists "Residents can submit a demo service request"
on public.resident_service_requests;

create policy "Residents can submit a demo service request"
on public.resident_service_requests
for insert
to anon
with check (is_demo = true and status = 'submitted');

-- Authenticated staff may read every request and update its status as they work
-- it in the Resident Intake Demo workbench. (No public/anon SELECT — contact
-- details stay private; the public status page uses the function below.)
drop policy if exists "Staff can read resident service requests"
on public.resident_service_requests;

create policy "Staff can read resident service requests"
on public.resident_service_requests
for select
to authenticated
using (true);

drop policy if exists "Staff can update resident service requests"
on public.resident_service_requests;

create policy "Staff can update resident service requests"
on public.resident_service_requests
for update
to authenticated
using (true)
with check (true);

-- Public status lookup by demo case id. SECURITY DEFINER so an anonymous
-- resident can check the status of their own request without granting anon a
-- broad SELECT over contact details. Returns ONLY non-sensitive columns and a
-- single row matched on the exact case id (no enumeration, no email / phone /
-- postal code).
create or replace function public.get_resident_request_status(p_case_id text)
returns table (
  case_id text,
  resident_name text,
  request_type text,
  location text,
  city text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    r.case_id,
    r.resident_name,
    r.request_type,
    r.location,
    r.city,
    r.status,
    r.created_at,
    r.updated_at
  from public.resident_service_requests r
  where r.case_id = p_case_id
  limit 1;
$$;

grant execute on function public.get_resident_request_status(text) to anon, authenticated;
