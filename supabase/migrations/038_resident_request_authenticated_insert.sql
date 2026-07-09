-- 038_resident_request_authenticated_insert.sql
--
-- Fix: submitting the public resident intake form fails with an RLS violation
-- (42501) whenever the browser has a signed-in staff session.
--
-- Migration 011 granted INSERT on public.resident_service_requests to the
-- authenticated role, but only created an INSERT *policy* for anon. With RLS
-- enabled, a grant without a matching policy denies every row — so a resident
-- submitting the form from a browser that also holds a staff magic-link session
-- (the Supabase client persists it and sends the authenticated JWT on every
-- request) hit "new row violates row-level security policy".
--
-- The attachments table already handles this correctly (migration 016 has a
-- "Staff can add attachment metadata" INSERT policy for authenticated); this
-- brings the requests table in line. Same WITH CHECK as the anon policy: only
-- demo rows starting at the initial 'submitted' status.
--
-- Idempotent: safe to re-run.

drop policy if exists "Staff can submit a demo service request"
on public.resident_service_requests;

create policy "Staff can submit a demo service request"
on public.resident_service_requests
for insert
to authenticated
with check (is_demo = true and status = 'submitted');
