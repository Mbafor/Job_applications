import { chromium } from "playwright";
import { JobListing, DigestRow } from "./types";
import { scrapeLinkedIn } from "./scrapeLinkedIn";
import { scrapeAdzunaFallback } from "./scrapeAdzunaFallback";
import { tailorResume } from "./tailorResume";
import { renderResumePdf } from "./renderResumePdf";
import {
  getUserConfig,
  filterUnprocessedJobs,
  uploadResumePdf,
  markJobProcessed,
  buildResumeStoragePath,
} from "./uploadAndDedupe";
import { sendDigestEmail } from "./sendDigestEmail";

interface RunSummary {
  source: "linkedin" | "adzuna" | "none";
  scraped: number;
  newAfterDedup: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

async function main(): Promise<void> {
  const summary: RunSummary = {
    source: "none",
    scraped: 0,
    newAfterDedup: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  console.log("=== Job application pipeline run starting ===");

  const config = await getUserConfig();
  console.log(
    `Config: query="${config.job_query}" location="${config.job_location}" maxDaysOld=${config.max_days_old} resultsLimit=${config.results_limit}`
  );

  const browser = await chromium.launch({ headless: true });

  const digestRows: DigestRow[] = [];

  try {
    // ---- 1. Scrape (LinkedIn primary, Adzuna automatic fallback) ----
    let jobs: JobListing[] = [];

    try {
      jobs = await scrapeLinkedIn(browser, {
        query: config.job_query,
        location: config.job_location,
        maxDaysOld: config.max_days_old,
        resultsLimit: config.results_limit,
      });
      if (jobs.length > 0) {
        summary.source = "linkedin";
      }
    } catch (err) {
      console.error(`LinkedIn scrape failed after retries: ${err instanceof Error ? err.message : err}`);
      summary.errors.push(`LinkedIn scrape failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (jobs.length === 0) {
      console.warn("LinkedIn returned zero results (or failed) — falling back to Adzuna.");
      try {
        jobs = await scrapeAdzunaFallback({
          query: config.job_query,
          location: config.job_location,
          maxDaysOld: config.max_days_old,
          resultsLimit: config.results_limit,
        });
        summary.source = "adzuna";
      } catch (err) {
        console.error(`Adzuna fallback also failed: ${err instanceof Error ? err.message : err}`);
        summary.errors.push(`Adzuna fallback failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    summary.scraped = jobs.length;
    console.log(`Scraped ${jobs.length} job(s) from source: ${summary.source}`);

    // ---- 2. Dedup against Supabase ----
    const unprocessedUrls = await filterUnprocessedJobs(jobs.map((j) => j.url));
    const newJobs = jobs.filter((j) => unprocessedUrls.has(j.url));
    summary.newAfterDedup = newJobs.length;
    console.log(`${newJobs.length} job(s) are new after dedup.`);

    // ---- 3-5. Per-job: tailor resume, render PDF, upload, record ----
    for (const job of newJobs) {
      try {
        console.log(`Processing: "${job.title}" @ ${job.company}`);
        const tailoredMarkdown = await tailorResume(config.base_resume_text, job);
        const pdfBuffer = await renderResumePdf(browser, tailoredMarkdown, `${job.title} - ${job.company}`);
        const storagePath = buildResumeStoragePath(job);
        const resumePdfUrl = await uploadResumePdf(pdfBuffer, storagePath);
        await markJobProcessed(job, storagePath);

        digestRows.push({
          title: job.title,
          company: job.company,
          jobUrl: job.url,
          resumePdfUrl,
          source: job.source,
        });
        summary.succeeded++;
      } catch (err) {
        summary.failed++;
        const msg = `Failed processing "${job.title}" @ ${job.company}: ${
          err instanceof Error ? err.message : String(err)
        }`;
        console.error(msg);
        summary.errors.push(msg);
        // Continue to the next job — one failure must not kill the whole run.
      }
    }

    // ---- 6. Email digest ----
    try {
      await sendDigestEmail(digestRows, config.notify_email);
      console.log(`Digest email sent to ${config.notify_email} (${digestRows.length} row(s)).`);
    } catch (err) {
      const msg = `Failed to send digest email: ${err instanceof Error ? err.message : String(err)}`;
      console.error(msg);
      summary.errors.push(msg);
    }
  } finally {
    await browser.close();
  }

  console.log("=== Run summary ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("=== Job application pipeline run finished ===");
  console.log("Reminder: submission is always manual. This pipeline never submits applications.");
}

main().catch((err) => {
  console.error("Fatal error, pipeline could not run:", err);
  process.exitCode = 1;
});
