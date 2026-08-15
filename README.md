# Job Application Pipeline

Every morning this pipeline: scrapes new job postings, skips anything already
seen, tailors your resume to each posting with Claude, renders a PDF, uploads
it to Supabase Storage, and emails you a one-row-per-job digest with links to
the posting and the tailored resume. **It never submits anything.** You
review each row and apply yourself.

## Read this first: LinkedIn scraping risk

Scraping LinkedIn — even logged out, even for personal use — violates
LinkedIn's User Agreement. That's a known, accepted risk here, not an
oversight. A few things worth knowing before you turn on the schedule:

- The scraper (`src/scrapeLinkedIn.ts`) only ever talks to LinkedIn's public,
  **logged-out** job search pages. There is no login flow, no session-cookie
  handling, no credential env var, anywhere in this codebase — that
  capability was deliberately left out so it can't be flipped on later by
  accident.
- Because it's logged out, the blast radius of getting blocked is the GitHub
  Actions runner's IP, not your personal LinkedIn account.
- **GitHub-hosted runners share IP ranges across every GitHub Actions user in
  the world.** LinkedIn may already have some of those ranges rate-limited or
  blocked, independent of anything this pipeline does. If that happens,
  LinkedIn's search page may return zero results or an auth wall on every
  run, through no fault of your query.
- That's exactly why the **Adzuna API fallback** exists: if the LinkedIn
  scrape throws, times out, or comes back with zero results, `src/index.ts`
  automatically calls `scrapeAdzunaFallback.ts` instead, so your digest email
  doesn't just go silent. Check the run summary in the Actions log to see
  which source was actually used that day.
- If LinkedIn scraping stops working entirely for your runner IPs, the
  pipeline keeps functioning on Adzuna alone — no code change required.

Submission is always a manual, human step. Nothing in this repo clicks
"Apply" or "Easy Apply" on your behalf, on LinkedIn or anywhere else.

## 1. Create the Supabase project and run the migration

1. Create a project at [supabase.com](https://supabase.com) (free tier is
   fine).
2. In the Supabase dashboard, open **SQL Editor**, paste the contents of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql),
   and run it. This creates:
   - `jobs_processed` — dedup ledger (primary key = job URL)
   - `user_config` — the single-row config the pipeline reads every run
   - a public `resumes` Storage bucket
   - RLS enabled on both tables with **no public policies** — the pipeline
     only ever connects with the service role key, which bypasses RLS
     entirely, so anon/public clients get zero access.
3. Grab your project's URL and **service role key** from
   **Project Settings → API**. The service role key is sensitive — treat it
   like a root password; it only ever goes into GitHub Actions secrets, never
   into a file you commit.

## 2. Get free API keys and add GitHub Actions secrets

Go to your repo's **Settings → Secrets and variables → Actions → New
repository secret** and add each of the following:

| Secret name | Where to get it |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API (the base project URL, e.g. `https://<ref>.supabase.co` — **not** the `/rest/v1/` path) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (service_role, secret) |
| `ANTHROPIC_API_KEY` | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) — pay-as-you-go, no free tier, but tailoring a handful of resumes a day is cheap |
| `RESEND_API_KEY` | [resend.com/api-keys](https://resend.com/api-keys) — free tier: 100 emails/day, sends from `onboarding@resend.dev` (no custom domain needed since you're the only recipient) |
| `ADZUNA_APP_ID` | [developer.adzuna.com](https://developer.adzuna.com/) — free signup, instant approval |
| `ADZUNA_APP_KEY` | same Adzuna signup as above |
| `ADZUNA_COUNTRY` | optional; two-letter Adzuna country code for the fallback source (e.g. `us`, `gb`). Defaults to `us` if unset. |

> **Resend sandbox restriction:** without a verified custom domain, `onboarding@resend.dev` can only deliver to the exact email address you used to sign up for Resend — sending to any other address is silently rejected by the API. Make sure `user_config.notify_email` (below) matches your Resend account's email exactly, or verify a domain in Resend if you want to send elsewhere.

None of these are committed anywhere — `.env` is git-ignored, and
`.env.example` only documents the variable names for local testing. **Never
paste real key values into README.md or any other tracked file** — this repo
is public, so anything committed here is world-readable.

## 3. Insert your initial `user_config` row

Run this in the Supabase SQL Editor once (edit `base_resume_text` to your
actual resume text — plain text or simple Markdown both work fine as input
to the tailoring step):

```sql
insert into public.user_config
  (id, base_resume_text, job_query, job_location, max_days_old, results_limit, notify_email)
values (
  1,
  $$PASTE YOUR FULL BASE RESUME TEXT HERE$$,
  'Software Engineer',
  'Remote',
  2,
  20,
  'jfmbafor@st.knust.edu.gh'
)
on conflict (id) do update set
  base_resume_text = excluded.base_resume_text,
  job_query = excluded.job_query,
  job_location = excluded.job_location,
  max_days_old = excluded.max_days_old,
  results_limit = excluded.results_limit,
  notify_email = excluded.notify_email;
```

Assumptions baked into the example above (change them if they're wrong for
you): `job_query = 'Software Engineer'`, `job_location = 'Remote'`,
`max_days_old = 2` (matches the "last 24-48 hours" requirement),
`results_limit = 20`, and the 7am cron below is set for **Africa/Accra
(UTC+0, no DST)**.

## 4. Test manually before trusting the schedule

1. Push this repo to GitHub with the workflow file in place.
2. Go to **Actions → Job Application Pipeline → Run workflow** to trigger it
   via `workflow_dispatch`.
3. Watch the run log. At the end it prints a JSON summary:
   `source` (which scraper actually produced results), `scraped`,
   `newAfterDedup`, `succeeded`, `failed`, and any `errors` collected along
   the way — one failed job doesn't stop the others.
4. Check your inbox for the digest email and confirm the resume PDF links
   open correctly.
5. Only once a manual run looks right should you rely on the 7am schedule.

## 5. Schedule and GitHub Actions minutes

The workflow triggers on `schedule: cron: "0 7 * * *"` (07:00 UTC = 7am
Africa/Accra) and on `workflow_dispatch` for manual runs.
`timeout-minutes: 20` caps a hung run.

**Free tier limits:** private repos on the GitHub Free plan get 2,000
Actions minutes/month on Linux runners (public repos are unlimited). A
typical run here — Node setup, `npm ci`, `playwright install --with-deps
chromium`, the scrape/tailor/PDF/upload/email cycle for a handful of new
jobs — takes roughly **3-6 minutes**, dominated by the Playwright Chromium
install (~1-2 min) and however many new postings need a Claude call + PDF
render that day. Running once a day is well within the free 2,000-minute
budget even with margin for retries.

## Project layout

```
supabase/migrations/0001_init.sql   Postgres schema + storage bucket
src/scrapeLinkedIn.ts               logged-out Playwright scraper (no auth code path, ever)
src/scrapeAdzunaFallback.ts         Adzuna API fallback
src/tailorResume.ts                 Claude-based resume tailoring
src/renderResumePdf.ts              Markdown -> HTML -> PDF via Playwright page.pdf()
src/uploadAndDedupe.ts              Supabase: config, dedup, storage upload
src/sendDigestEmail.ts              Resend digest email
src/index.ts                        orchestrates the run, per-stage try/catch, run summary
.github/workflows/job-pipeline.yml  schedule + workflow_dispatch
```

## Local testing

```bash
npm install
npx playwright install --with-deps chromium
cp .env.example .env   # fill in real values
npm start
```
