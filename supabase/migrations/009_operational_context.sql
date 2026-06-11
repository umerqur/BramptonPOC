-- Linked operational POC records for the Closure Review Workbench:
-- patrol logs, ticket records, complaint trends, and closure templates.
--
-- POSITIONING / PROVENANCE
-- ------------------------
-- Toronto 311 public benchmark data remains the source of complaint and trend
-- signals. public.complaint_trends is GENERATED from the existing benchmark
-- complaints in public.municipal_complaints (see migration 010).
--
-- public.patrol_logs, public.ticket_records, and public.closure_templates are
-- SYNTHETIC POC OPERATIONAL CONTEXT: clearly labelled demo records linked to
-- real benchmark complaint case_ids so the closure workflow can be shown end
-- to end. They are NOT Brampton operational data and NOT real enforcement
-- activity. Nothing here is an enforcement decision, an automatic closure, or
-- resident contact — the app reads these tables for staff review only.
--
-- Rows are written out of band (seed migration / service_role batch). There is
-- intentionally NO authenticated insert/update/delete policy: the app reads only.

-- 1. patrol_logs — synthetic patrol activity linked to benchmark complaints.
create table if not exists public.patrol_logs (
  id                 uuid primary key default gen_random_uuid(),
  case_id            text not null,
  patrol_date        date,
  officer_unit       text,
  patrol_type        text,
  area               text,
  location           text,
  observed_issue     text,
  observation_result text,
  notes              text,
  created_at         timestamptz not null default now()
);

comment on table public.patrol_logs is
  'SYNTHETIC POC operational context: demo patrol log records linked to real Toronto 311 benchmark complaint case_ids (municipal_complaints.case_id). Not Brampton operational data and not real patrol activity. Read-only decision support for the Closure Review Workbench.';

create index if not exists patrol_logs_case_id_idx on public.patrol_logs (case_id);

-- 2. ticket_records — synthetic enforcement/ticket outcomes linked to benchmark complaints.
create table if not exists public.ticket_records (
  id                 uuid primary key default gen_random_uuid(),
  case_id            text not null,
  ticket_number      text,
  ticket_date        date,
  enforcement_type   text,
  violation_category text,
  outcome            text,
  fine_amount        numeric,
  status             text,
  notes              text,
  created_at         timestamptz not null default now()
);

comment on table public.ticket_records is
  'SYNTHETIC POC operational context: demo ticket / enforcement outcome records linked to real Toronto 311 benchmark complaint case_ids. Not Brampton operational data and not real enforcement activity. Read-only decision support for the Closure Review Workbench.';

create index if not exists ticket_records_case_id_idx on public.ticket_records (case_id);

-- 3. complaint_trends — aggregated trend signals GENERATED from the Toronto 311
--    public benchmark complaints (municipal_complaints). Real benchmark-derived
--    aggregates, not synthetic; still not Brampton operational data.
create table if not exists public.complaint_trends (
  id                    uuid primary key default gen_random_uuid(),
  area                  text,
  complaint_type        text,
  period_start          date,
  period_end            date,
  complaint_count       integer not null default 0,
  prior_period_count    integer not null default 0,
  change_percent        numeric,
  repeat_location_count integer not null default 0,
  trend_label           text,
  created_at            timestamptz not null default now()
);

comment on table public.complaint_trends is
  'Complaint trend aggregates generated from Toronto 311 public benchmark complaints (municipal_complaints): per area + complaint type, current vs prior period volume, change percent, repeat locations, and a plain trend label. Benchmark-derived decision support only — not Brampton operational data.';

create index if not exists complaint_trends_area_type_idx
  on public.complaint_trends (area, complaint_type);

-- 4. closure_templates — synthetic, policy-styled resident friendly closure
--    response templates matched by complaint type + scenario.
create table if not exists public.closure_templates (
  id               uuid primary key default gen_random_uuid(),
  complaint_type   text not null,
  scenario         text not null,
  template_text    text not null,
  required_context text[] not null default '{}',
  policy_note      text,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

comment on table public.closure_templates is
  'SYNTHETIC POC closure response templates: resident friendly closure language matched by complaint type + scenario (complaint_type ''Any'' is the generic fallback). required_context lists the records staff should have on file before using the template. Drafting aid only — staff approval is required before any closure or resident communication.';

create index if not exists closure_templates_match_idx
  on public.closure_templates (complaint_type, scenario) where active;

-- Row level security: authenticated staff read only. No anon access and no
-- browser writes, matching the rest of the POC schema.
alter table public.patrol_logs       enable row level security;
alter table public.ticket_records    enable row level security;
alter table public.complaint_trends  enable row level security;
alter table public.closure_templates enable row level security;

drop policy if exists "Authenticated users can read patrol logs" on public.patrol_logs;
create policy "Authenticated users can read patrol logs"
  on public.patrol_logs for select to authenticated using (true);

drop policy if exists "Authenticated users can read ticket records" on public.ticket_records;
create policy "Authenticated users can read ticket records"
  on public.ticket_records for select to authenticated using (true);

drop policy if exists "Authenticated users can read complaint trends" on public.complaint_trends;
create policy "Authenticated users can read complaint trends"
  on public.complaint_trends for select to authenticated using (true);

drop policy if exists "Authenticated users can read closure templates" on public.closure_templates;
create policy "Authenticated users can read closure templates"
  on public.closure_templates for select to authenticated using (true);

grant select on public.patrol_logs       to authenticated;
grant select on public.ticket_records    to authenticated;
grant select on public.complaint_trends  to authenticated;
grant select on public.closure_templates to authenticated;
