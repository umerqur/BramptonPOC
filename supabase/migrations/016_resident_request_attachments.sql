-- 016_resident_request_attachments.sql
--
-- Resident Intake Demo — actual file uploads (photos / documents) attached to a
-- resident service request. Files are stored in a PRIVATE Supabase Storage bucket
-- (resident-request-attachments); this table holds the per-file metadata linked to
-- the resident request by case id. Staff read the metadata and mint short-lived
-- signed URLs to view a file; the bucket is never public.
--
-- SECURITY MODEL
-- --------------
--   * Public residents (anon) may UPLOAD files and INSERT attachment metadata as
--     part of submitting a request. They cannot read attachments back.
--   * Authenticated staff may READ attachment metadata and READ the stored objects
--     (which is what createSignedUrl needs). The bucket stays private.
--
-- Idempotent: safe to re-run.

create table if not exists public.resident_request_attachments (
  id uuid primary key default gen_random_uuid(),
  case_id text not null
    references public.resident_service_requests(case_id) on delete cascade,
  file_name text not null,
  file_path text not null,
  content_type text,
  file_size_bytes bigint,
  uploaded_at timestamptz not null default now()
);

create index if not exists idx_rra_case_id on public.resident_request_attachments (case_id);
create index if not exists idx_rra_uploaded_at on public.resident_request_attachments (uploaded_at desc);

alter table public.resident_request_attachments enable row level security;

-- Table-level privileges (RLS still gates every row). Anonymous residents may
-- INSERT metadata at submission time; authenticated staff may read it.
grant insert on public.resident_request_attachments to anon;
grant select, insert on public.resident_request_attachments to authenticated;

-- Anonymous residents may record an attachment as part of submitting a request.
drop policy if exists "Residents can add attachment metadata"
on public.resident_request_attachments;

create policy "Residents can add attachment metadata"
on public.resident_request_attachments
for insert
to anon
with check (true);

-- Authenticated staff may insert (in case a staff session uploads) and read all
-- attachment metadata.
drop policy if exists "Staff can add attachment metadata"
on public.resident_request_attachments;

create policy "Staff can add attachment metadata"
on public.resident_request_attachments
for insert
to authenticated
with check (true);

drop policy if exists "Staff can read attachment metadata"
on public.resident_request_attachments;

create policy "Staff can read attachment metadata"
on public.resident_request_attachments
for select
to authenticated
using (true);

-- ---------------------------------------------------------------------------
-- Private Storage bucket for the uploaded files.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('resident-request-attachments', 'resident-request-attachments', false)
on conflict (id) do update set public = false;

-- Anonymous residents may UPLOAD into the resident-request-attachments bucket
-- (object path is resident-requests/{caseId}/{safeFileName}). They cannot read
-- objects back — there is no anon SELECT policy on this bucket.
drop policy if exists "Residents can upload resident attachments" on storage.objects;

create policy "Residents can upload resident attachments"
on storage.objects
for insert
to anon
with check (bucket_id = 'resident-request-attachments');

-- Authenticated staff may upload and READ objects in this bucket. Read is what
-- storage.createSignedUrl needs to mint a short-lived view URL for staff.
drop policy if exists "Staff can upload resident attachments" on storage.objects;

create policy "Staff can upload resident attachments"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'resident-request-attachments');

drop policy if exists "Staff can read resident attachments" on storage.objects;

create policy "Staff can read resident attachments"
on storage.objects
for select
to authenticated
using (bucket_id = 'resident-request-attachments');
