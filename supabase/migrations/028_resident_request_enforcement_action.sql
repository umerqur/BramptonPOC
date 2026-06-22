-- 028_resident_request_enforcement_action.sql
--
-- Structured field-outcome enforcement action on the shared resident request
-- record. Previously the officer's disposition was inferred from the free-text
-- "action taken" field; it is now captured as a STRUCTURED selection so the
-- closure language is grounded in what the officer actually did.
--
-- This only records what the officer did on site. It is NOT a payment or
-- ticket-issuance system.
--
-- Enforcement action values:
--   warning_education | notice_issued | ticket_issued | no_action | other
-- Method of service (ticket_issued only):
--   placed_on_vehicle | handed_to_driver | sent_by_mail | other
--
-- Idempotent: safe to re-run.

alter table public.resident_service_requests
  -- Structured enforcement action the officer selected (drives the disposition).
  add column if not exists field_enforcement_action text,
  -- How a parking ticket / penalty notice was served (ticket_issued only).
  add column if not exists field_service_method text,
  -- Ticket / penalty notice number (ticket_issued only, optional).
  add column if not exists field_reference_number text;

comment on column public.resident_service_requests.field_enforcement_action is
  'Structured officer field action: warning_education | notice_issued | ticket_issued | no_action | other. A ticket is only ever recorded when explicitly selected — never inferred from a violation being observed.';
comment on column public.resident_service_requests.field_service_method is
  'Method of service for a parking ticket / penalty notice (ticket_issued only): placed_on_vehicle | handed_to_driver | sent_by_mail | other. Records what the officer did — not a payment or issuance system.';
comment on column public.resident_service_requests.field_reference_number is
  'Ticket / penalty notice number recorded by the officer (ticket_issued only, optional).';

-- No RLS changes needed: migration 011 already grants authenticated staff
-- SELECT and UPDATE on this table, which covers the officer field-outcome update.
