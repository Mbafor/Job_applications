import { JobListing } from "./types";
import { requireEnv, optionalEnv } from "./env";

/**
 * Adzuna's public job search API (https://developer.adzuna.com/) - free tier,
 * ToS-compliant. Used as the automatic fallback when the LinkedIn scrape
 * fails, times out, or returns zero results, so the pipeline never goes
 * silent on a bad day.
 */

interface AdzunaApiResult {
  results: Array<{
    title: string;
    company: { display_name: string };
    redirect_url: string;
    description: string;
    created: string; // ISO date
  }>;
}

export interface ScrapeAdzunaOptions {
  query: string;
  location: string;
  maxDaysOld: number;
  resultsLimit: number;
}

export async function scrapeAdzunaFallback(opts: ScrapeAdzunaOptions): Promise<JobListing[]> {
  const appId = requireEnv("ADZUNA_APP_ID");
  const appKey = requireEnv("ADZUNA_APP_KEY");
  const country = optionalEnv("ADZUNA_COUNTRY", "us");

  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: String(opts.resultsLimit),
    what: opts.query,
    max_days_old: String(opts.maxDaysOld),
    "content-type": "application/json",
  });

  // Adzuna only applies a free-text location filter if it's non-empty; a
  // "Remote" search term is passed through `what` too since Adzuna has no
  // universal remote flag across countries.
  if (opts.location && opts.location.trim().toLowerCase() !== "remote") {
    params.set("where", opts.location);
  }

  const url = `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country)}/search/1?${params.toString()}`;

  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Adzuna API returned ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as AdzunaApiResult;

  return (data.results ?? []).map((r) => ({
    title: r.title,
    company: r.company?.display_name ?? "Unknown",
    url: r.redirect_url,
    description: r.description ?? "",
    postedAt: r.created ?? null,
    source: "adzuna" as const,
  }));
}
