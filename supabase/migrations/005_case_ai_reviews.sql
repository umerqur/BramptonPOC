-- Claude-powered "AI assisted staff review" results, stored one row per
-- generation for a single selected case.
--
-- This is decision support only. The generated review never replaces the
-- existing rule based POC triage columns on municipal_complaints, and it never
-- makes a final enforcement decision. Staff review is always required.
--
-- The Anthropic API is called only from the server-side Netlify function
-- (netlify/functions/generate-case-ai-review.ts). The ANTHROPIC_API_KEY is
-- never exposed to the browser, Vite env, Supabase client, or logs. The
-- structured JSON result is written here by the authenticated staff client.
--
-- A new row is appended each time staff click "Generate AI review", so the
-- table doubles as an audit trail of what was generated, by which model and
-- prompt version, and when.

create table if not exists public.case_ai_reviews (
  id uuid primary key default gen_random_uuid(),
  case_id text not null,
  model text not null,
  prompt_version text not null,
  result_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists case_ai_reviews_case_id_created_at_idx
  on public.case_ai_reviews (case_id, created_at desc);

alter table public.case_ai_reviews enable row level security;

-- Authenticated staff (signed in via magic link) may read AI reviews. Matches
-- the authenticated-only posture of the rest of the schema.
drop policy if exists "Authenticated users can read case AI reviews"
on public.case_ai_reviews;

create policy "Authenticated users can read case AI reviews"
on public.case_ai_reviews
for select
to authenticated
using (true);

-- Authenticated staff may persist a generated review for a single case.
drop policy if exists "Authenticated users can insert case AI reviews"
on public.case_ai_reviews;

create policy "Authenticated users can insert case AI reviews"
on public.case_ai_reviews
for insert
to authenticated
with check (true);

grant select, insert on public.case_ai_reviews to authenticated;
