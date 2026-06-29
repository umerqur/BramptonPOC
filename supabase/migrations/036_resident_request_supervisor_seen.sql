-- 036_resident_request_supervisor_seen.sql
--
-- Supervisor "seen" state for closure review. When a case has a recorded field
-- outcome it enters the supervisor's "Ready to close" queue. A supervisor needs
-- to know, at a glance, which ready-to-close cases are NEW to them (not yet
-- opened or reviewed) so the most urgent closure approvals surface first.
--
-- We persist this on the shared Supabase row (NOT in local browser state) so the
-- "new closure review" alert is consistent across the supervisor's devices and
-- sessions. supervisor_seen_at is the first time a supervisor opened / reviewed
-- the case for closure. It is set once and never cleared.
--
-- This is workflow UX state only. It is decision support — it never makes or
-- records an enforcement decision.
--
-- Idempotent: safe to re-run.

alter table public.resident_service_requests
  -- First time a supervisor opened / reviewed this case for closure approval.
  -- Null = ready for closure but not yet seen by a supervisor (show the alert).
  add column if not exists supervisor_seen_at timestamptz;

comment on column public.resident_service_requests.supervisor_seen_at is
  'First time a supervisor opened / reviewed this case for closure approval. Null while a ready-to-close case is still unseen by a supervisor. Workflow UX state only — never an enforcement decision.';

-- No RLS changes needed: migration 011 already grants authenticated staff SELECT
-- and UPDATE on this table, which covers a supervisor marking a case as seen.
