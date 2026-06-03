-- Row Level Security for the ML-enriched municipal service request table.
--
-- public.municipal_service_requests_ml_enriched carries the base
-- service-request columns plus advisory ML pattern-detection and hotspot
-- fields produced by the local PyTorch pipeline. The frontend reads this table
-- only from the authenticated `/app` area, so SELECT is restricted to the
-- `authenticated` role (matching migration 002 for the base table).
--
-- The ML outputs are advisory pattern-detection signals only. They are not
-- enforcement decisions. Final decisions remain with authorized municipal
-- staff.
--
-- Apply this after the enriched dataset has been loaded.

alter table if exists public.municipal_service_requests_ml_enriched
  enable row level security;

drop policy if exists "Allow authenticated read for ml enriched service requests"
  on public.municipal_service_requests_ml_enriched;

create policy "Allow authenticated read for ml enriched service requests"
on public.municipal_service_requests_ml_enriched
for select
to authenticated
using (true);

-- Helpful indexes for the dashboard / queue / hotspot queries.
create index if not exists idx_msr_ml_pattern_label
  on public.municipal_service_requests_ml_enriched (ml_violation_pattern_label);

create index if not exists idx_msr_ml_hotspot_cluster
  on public.municipal_service_requests_ml_enriched (ml_hotspot_cluster_id);

create index if not exists idx_msr_ml_hotspot_score
  on public.municipal_service_requests_ml_enriched (ml_hotspot_score desc);
