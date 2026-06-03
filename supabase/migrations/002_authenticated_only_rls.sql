-- Move live municipal service request data behind authentication.
--
-- Public demo pages no longer read from Supabase at all (they use bundled mock
-- data), so the table no longer needs a public/anon read policy. Live data is
-- only read from the authenticated `/app` area, so restrict SELECT to the
-- `authenticated` role.
--
-- Apply this after configuring Supabase Auth (magic link / OTP) and the
-- allowed redirect URLs for the deployment.

alter table public.municipal_service_requests enable row level security;

-- Remove the permissive demo-era policies.
drop policy if exists "Allow public read for demo service requests"
on public.municipal_service_requests;

drop policy if exists "Allow authenticated read for municipal service requests"
on public.municipal_service_requests;

-- Authenticated users (signed in via magic link) may read all rows.
create policy "Allow authenticated read for municipal service requests"
on public.municipal_service_requests
for select
to authenticated
using (true);
