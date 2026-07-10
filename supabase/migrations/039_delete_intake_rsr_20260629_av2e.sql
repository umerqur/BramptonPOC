-- 039_delete_intake_rsr_20260629_av2e.sql
--
-- One-off data cleanup: permanently remove the demo resident intake
-- RSR-20260629-AV2E and everything attached to it. The record was created
-- before structured enforcement actions existed and is stuck in the closure
-- review queue ("Field outcome incomplete"), so it is being deleted rather
-- than backfilled.
--
-- Removes, in order:
--   1. Uploaded files for the case in the resident-request-attachments
--      Storage bucket (storage.objects rows; attachment metadata rows in
--      resident_request_attachments cascade from the parent delete).
--   2. Staff workflow events recorded against the case.
--   3. Any cached AI reviews for the case.
--   4. The resident_service_requests row itself.
--
-- Idempotent: re-running after the case is gone deletes nothing.

do $$
declare
  target_case_id constant text := 'RSR-20260629-AV2E';
begin
  delete from storage.objects o
  where o.bucket_id = 'resident-request-attachments'
    and o.name in (
      select a.file_path
      from public.resident_request_attachments a
      where a.case_id = target_case_id
    );

  delete from public.workflow_events
  where case_id = target_case_id;

  delete from public.case_ai_reviews
  where case_id = target_case_id;

  -- Cascades to resident_request_attachments via its FK on case_id.
  delete from public.resident_service_requests
  where case_id = target_case_id;
end $$;
