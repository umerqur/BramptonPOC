-- 039_delete_intake_rsr_20260629_av2e.sql
--
-- One-off data cleanup: permanently remove the demo resident intake
-- RSR-20260629-AV2E and everything attached to it. The record was created
-- before structured enforcement actions existed and was stuck in the closure
-- review queue ("Field outcome incomplete"), so it was deleted rather than
-- backfilled.
--
-- This cleanup was already executed against the live project on 2026-07-10
-- (the case had 3 workflow events, no attachments, and no case_ai_reviews
-- table exists there), so on that database this migration is a no-op. It is
-- kept for the record and stays safe to run anywhere:
--   * case_ai_reviews is only touched if the table exists.
--   * Attachment metadata cascades from the parent delete; Storage objects
--     are NOT deleted here because Supabase blocks direct storage.objects
--     deletes (the case had no uploaded files).
--
-- Idempotent: re-running after the case is gone deletes nothing.

do $$
declare
  target_case_id constant text := 'RSR-20260629-AV2E';
begin
  delete from public.workflow_events
  where case_id = target_case_id;

  if to_regclass('public.case_ai_reviews') is not null then
    execute 'delete from public.case_ai_reviews where case_id = $1'
      using target_case_id;
  end if;

  -- Cascades to resident_request_attachments via its FK on case_id.
  delete from public.resident_service_requests
  where case_id = target_case_id;
end $$;
