-- 041_officer_assistant_location_history.sql
--
-- Repeat location intelligence for the Officer Case Assistant.
--
-- The officer-case-assistant Netlify function now looks up prior service
-- requests recorded at the same street address (public.resident_service_requests
-- .location, case-insensitive) to power the "Repeat complaint / address
-- history" section of the automatic Officer Field Briefing. The lookup runs
-- server-side with the service role and selects ONLY operational columns
-- (case_id, request_type, status, created_at, field_visit_completed,
-- field_outcome_recorded_at, field_enforcement_action,
-- field_follow_up_required) — never resident names, contact details, unit
-- numbers, or postal codes. No RLS or grant changes are needed for it.
--
-- This migration only adds a supporting expression index so the
-- case-insensitive address match stays an index scan as the table grows.
-- Idempotent: create index if not exists.

create index if not exists resident_requests_location_norm_idx
  on public.resident_service_requests (lower(btrim(location)));

comment on index public.resident_requests_location_norm_idx is
  'Supports the Officer Case Assistant repeat-location lookup: case-insensitive match of prior service requests at the same street address.';
