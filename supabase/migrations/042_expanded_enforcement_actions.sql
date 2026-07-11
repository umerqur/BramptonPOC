-- Expanded structured enforcement actions
--
-- Infrastructure and service cases (e.g. a fallen City stop sign) were being
-- forced into a false enforcement outcome because the officer field-outcome
-- form only offered enforcement dispositions. The application now records four
-- additional non-enforcement action values in field_enforcement_action:
--
--   city_service_referral     | City service / repair referral
--   referred_other_department | Referred to another department
--   public_safety_response    | Public safety response
--   no_violation_found        | No violation found
--
-- The column is plain text with no check constraint, so no data change is
-- needed — this migration only updates the column comment so the documented
-- value set matches the application. Idempotent: safe to re-run.

comment on column public.resident_service_requests.field_enforcement_action is
  'Structured officer field action: warning_education | notice_issued | ticket_issued | city_service_referral | referred_other_department | public_safety_response | no_violation_found | no_action | other. A ticket is only ever recorded when explicitly selected — never inferred from a violation being observed. The non-enforcement values record real outcomes for infrastructure / service cases (e.g. a fallen City stop sign → city_service_referral).';
