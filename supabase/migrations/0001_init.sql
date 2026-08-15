-- Job application pipeline: dedup table, config table, and resume storage bucket.
-- Run this once in the Supabase SQL Editor (or via `supabase db push`).

-- ---------------------------------------------------------------------------
-- jobs_processed: dedup ledger. One row per job we've ever prepared materials
-- for, keyed by the posting URL so re-runs skip anything already handled.
-- ---------------------------------------------------------------------------
create table if not exists public.jobs_processed (
  job_url         text primary key,
  title           text not null,
  company         text not null,
  posted_at       timestamptz,
  source          text not null check (source in ('linkedin', 'adzuna')),
  resume_pdf_path text,
  processed_at    timestamptz not null default now()
);

alter table public.jobs_processed enable row level security;
-- No policies are defined on purpose: the pipeline talks to Supabase only
-- via the service role key, which bypasses RLS entirely. Anon/authenticated
-- clients get zero access to this table.

-- ---------------------------------------------------------------------------
-- user_config: single-row config the pipeline reads on every run.
-- ---------------------------------------------------------------------------
create table if not exists public.user_config (
  id               smallint primary key default 1 check (id = 1), -- enforce singleton
  base_resume_text text not null,
  job_query        text not null,
  job_location     text not null,
  max_days_old     int not null default 2,
  results_limit    int not null default 20,
  notify_email     text not null
);

alter table public.user_config enable row level security;
-- Same as above: service-role-key access only, no public policies.

-- ---------------------------------------------------------------------------
-- Storage: public bucket for tailored resume PDFs so the digest email can
-- link directly to each file.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', true)
on conflict (id) do nothing;
