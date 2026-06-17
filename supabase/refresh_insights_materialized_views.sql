-- Refresh the Insights materialized views.
--
-- Run this after loading or updating NYC 311 data in public.municipal_complaints
-- so the supervisor Insights dashboard reflects the latest aggregates. Each
-- refresh recomputes a tiny aggregate output (never raw case-level rows), so this
-- is fast even over the full ~3.4M-row dataset.

refresh materialized view public.mv_insights_kpis;
refresh materialized view public.mv_insights_complaint_type_volume;
refresh materialized view public.mv_insights_closure_bottlenecks;
refresh materialized view public.mv_insights_area_bottlenecks;
refresh materialized view public.mv_insights_department_workload;
refresh materialized view public.mv_insights_monthly_trend;
refresh materialized view public.mv_insights_channel_mix;
refresh materialized view public.mv_insights_status_mix;

-- Source metadata + map workload aggregates (also materialized).
refresh materialized view public.mv_insights_source_meta;
refresh materialized view public.mv_nyc_service_request_workload;
refresh materialized view public.mv_nyc_council_district_workload;
