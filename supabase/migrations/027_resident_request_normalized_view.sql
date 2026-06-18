-- Normalized service-request schema for resident intake.
--
-- The Work Queue runs ONE operational lifecycle over two live sources (resident
-- intake + NYC open benchmark). This view projects the resident-friendly
-- resident_service_requests table onto the SAME normalized service-request shape
-- the NYC sources use, so downstream readers can treat every source uniformly.
--
-- The public resident form stays resident-friendly; the normalization happens
-- here, at the storage layer. This view is additive and non-destructive — it
-- does not alter the resident table or its privacy model (authenticated staff
-- only, mirroring the base table's SELECT policy).

create or replace view public.v_resident_service_requests_normalized as
select
  r.case_id                                            as case_id,
  'resident_intake'::text                              as source,
  r.created_at                                         as submitted_at,
  r.status                                             as status,
  r.request_type                                       as complaint_type,
  r.description                                        as request_detail,
  r.address_type                                       as location_type,
  nullif(trim(both ', ' from
    concat_ws(', ', nullif(r.location, ''), nullif(r.city, ''))), '')
                                                       as address_or_location,
  r.province                                           as ward_or_area,
  r.assigned_officer_name                              as assigned_department,
  null::numeric                                        as priority_score,
  null::text                                           as priority_reason,
  null::text                                           as resolution_description,
  case when r.status = 'closed' then 'closed' else 'open' end as closure_status
from public.resident_service_requests r;

-- Authenticated staff may read the normalized projection (same audience as the
-- base table). No anon access — resident contact details stay private.
grant select on public.v_resident_service_requests_normalized to authenticated;
