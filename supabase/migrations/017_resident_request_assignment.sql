-- 017_resident_request_assignment.sql
--
-- Role-based officer flow on the shared resident request record. A supervisor /
-- coordinator assigns a request to a By-law Officer (human assignment required —
-- never automated). The officer then records a field outcome. Both are stored on
-- the shared Supabase row so the supervisor and the officer (different signed-in
-- users / browsers) see the same state.
--
-- Status lifecycle already on the table: submitted -> received -> assigned ->
-- in_review -> closed. We reuse 'assigned' (officer assigned) and 'in_review'
-- (officer recorded a field outcome; ready for closure review).
--
-- Idempotent: safe to re-run.

alter table public.resident_service_requests
  -- Human assignment to a By-law Officer (set by a supervisor/coordinator).
  add column if not exists assigned_officer_email text,
  add column if not exists assigned_officer_name text,
  add column if not exists assigned_at timestamptz,
  -- Officer-recorded field outcome (feeds closure review readiness).
  add column if not exists field_visit_completed boolean not null default false,
  add column if not exists field_observed_condition text,
  -- 'yes' | 'no' | 'unclear'
  add column if not exists field_violation_observed text,
  add column if not exists field_action_taken text,
  add column if not exists field_officer_notes text,
  add column if not exists field_follow_up_required boolean not null default false,
  add column if not exists field_outcome_recorded_at timestamptz;

comment on column public.resident_service_requests.assigned_officer_email is
  'Email of the By-law Officer a supervisor/coordinator assigned this request to. Human assignment required — never automated.';
comment on column public.resident_service_requests.field_violation_observed is
  'Officer field finding: yes | no | unclear. Decision support input for closure review, not an automated enforcement decision.';

create index if not exists idx_rsr_assigned_officer
  on public.resident_service_requests (assigned_officer_email);

-- No RLS changes needed: migration 011 already grants authenticated staff SELECT
-- and UPDATE on this table, which covers both supervisor assignment and officer
-- field-outcome updates. Anon residents still cannot read or update these rows.
