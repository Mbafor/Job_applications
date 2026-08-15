import { Browser } from "playwright";
import { JobListing } from "./types";
import { jitterDelay, withRetries } from "./util";

/**
 * Scrapes LinkedIn's public, logged-out job search results page.
 *
 * IMPORTANT: this module must never gain a login/session/cookie code path.
 * It only ever hits LinkedIn's anonymous job search surface. If LinkedIn
 * shows an auth wall on a given result, that result is skipped and logged
 * -- we do not attempt to authenticate to get past it.
 */

const REALISTIC_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

export interface ScrapeLinkedInOptions {
  query: string;
  location: string;
  maxDaysOld: number;
  resultsLimit: number;
}

function buildSearchUrl(opts: ScrapeLinkedInOptions): string {
  const params = new URLSearchParams({
    keywords: opts.query,
    location: opts.location,
    // f_TPR = "posted within the last N seconds" filter on LinkedIn's public search.
    f_TPR: `r${Math.max(1, opts.maxDaysOld) * 86400}`,
    position: "1",
    pageNum: "0",
  });
  return `https://www.linkedin.com/jobs/search?${params.toString()}`;
}

function isAuthWalled(url: string): boolean {
  return url.includes("/authwall") || url.includes("/login") || url.includes("/checkpoint/");
}

async function scrapeOnce(browser: Browser, opts: ScrapeLinkedInOptions): Promise<JobListing[]> {
  const context = await browser.newContext({
    userAgent: REALISTIC_USER_AGENT,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "Africa/Accra",
    // Deliberately no storageState / cookies loaded here: every run starts anonymous.
  });

  // Trim a couple of automation tells without pretending to be a full stealth suite.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const page = await context.newPage();
  const jobs: JobListing[] = [];

  try {
    const searchUrl = buildSearchUrl(opts);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await jitterDelay(1200, 2800);

    if (isAuthWalled(page.url())) {
      console.warn(`[scrapeLinkedIn] hit auth wall on search page, skipping: ${page.url()}`);
      return [];
    }

    // Public search results render as <li> cards inside ul.jobs-search__results-list.
    // LinkedIn changes markup periodically; we fall back gracefully to an empty list
    // rather than throwing if the selector no longer matches.
    const cardSelector = "ul.jobs-search__results-list li";
    try {
      await page.waitForSelector(cardSelector, { timeout: 10_000 });
    } catch {
      console.warn("[scrapeLinkedIn] no result cards found (layout change, empty results, or soft auth wall)");
      return [];
    }

    // Scroll a bit to trigger lazy-loaded cards, with jittered pauses like a human skim.
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 800 + Math.random() * 400);
      await jitterDelay(400, 1100);
    }

    const cards = await page.$$(cardSelector);
    for (const card of cards.slice(0, opts.resultsLimit)) {
      try {
        const titleEl = await card.$("h3.base-search-card__title");
        const companyEl = await card.$("h4.base-search-card__subtitle");
        const linkEl = await card.$("a.base-card__full-link");
        const timeEl = await card.$("time");

        const title = (await titleEl?.innerText())?.trim();
        const company = (await companyEl?.innerText())?.trim();
        let url = (await linkEl?.getAttribute("href")) ?? undefined;
        const postedAt = (await timeEl?.getAttribute("datetime")) ?? null;

        if (!title || !company || !url) continue;
        url = url.split("?")[0]; // strip tracking params, keep URL stable for dedup

        jobs.push({
          title,
          company,
          url,
          description: "", // filled in by visiting the detail page below
          postedAt,
          source: "linkedin",
        });
      } catch (cardErr) {
        console.warn(`[scrapeLinkedIn] failed to parse a result card, skipping it: ${cardErr}`);
      }
    }

    // Visit each job's detail page to grab the description, skipping any that are auth-walled.
    const enriched: JobListing[] = [];
    for (const job of jobs) {
      try {
        await jitterDelay(1500, 3500);
        const detailPage = await context.newPage();
        await detailPage.goto(job.url, { waitUntil: "domcontentloaded", timeout: 20_000 });

        if (isAuthWalled(detailPage.url())) {
          console.warn(`[scrapeLinkedIn] job detail auth-walled, skipping description: ${job.url}`);
          await detailPage.close();
          enriched.push(job);
          continue;
        }

        const descSelector = ".show-more-less-html__markup, .description__text";
        let description = "";
        try {
          await detailPage.waitForSelector(descSelector, { timeout: 8_000 });
          description = (await detailPage.$eval(descSelector, (el) => el.textContent || "")).trim();
        } catch {
          console.warn(`[scrapeLinkedIn] no description found for ${job.url}`);
        }

        await detailPage.close();
        enriched.push({ ...job, description });
      } catch (detailErr) {
        console.warn(`[scrapeLinkedIn] failed to load job detail, keeping listing without description: ${detailErr}`);
        enriched.push(job);
      }
    }

    return enriched;
  } finally {
    await context.close();
  }
}

export async function scrapeLinkedIn(
  browser: Browser,
  opts: ScrapeLinkedInOptions
): Promise<JobListing[]> {
  return withRetries(() => scrapeOnce(browser, opts), {
    retries: 3,
    baseDelayMs: 4000,
    label: "scrapeLinkedIn",
  });
}
