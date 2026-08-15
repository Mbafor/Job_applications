import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "./env";
import { JobListing, UserConfig } from "./types";

const RESUMES_BUCKET = "resumes";

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!cachedClient) {
    const url = requireEnv("SUPABASE_URL");
    const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    cachedClient = createClient(url, key, { auth: { persistSession: false } });
  }
  return cachedClient;
}

export async function getUserConfig(): Promise<UserConfig> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("user_config").select("*").eq("id", 1).single();
  if (error) throw new Error(`Failed to load user_config: ${error.message}`);
  if (!data) throw new Error("user_config table has no row — insert one before running the pipeline");
  return data as UserConfig;
}

/** Returns the subset of job URLs from `urls` that have NOT been processed before. */
export async function filterUnprocessedJobs(urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("jobs_processed").select("job_url").in("job_url", urls);
  if (error) throw new Error(`Failed to query jobs_processed: ${error.message}`);
  const alreadyProcessed = new Set((data ?? []).map((row: { job_url: string }) => row.job_url));
  return new Set(urls.filter((url) => !alreadyProcessed.has(url)));
}

export async function uploadResumePdf(pdfBuffer: Buffer, storagePath: string): Promise<string> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.storage.from(RESUMES_BUCKET).upload(storagePath, pdfBuffer, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw new Error(`Failed to upload resume PDF: ${error.message}`);

  const { data } = supabase.storage.from(RESUMES_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

export async function markJobProcessed(
  job: JobListing,
  resumePdfPath: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("jobs_processed").insert({
    job_url: job.url,
    title: job.title,
    company: job.company,
    posted_at: job.postedAt,
    source: job.source,
    resume_pdf_path: resumePdfPath,
  });
  if (error) throw new Error(`Failed to record processed job: ${error.message}`);
}

export function buildResumeStoragePath(job: JobListing): string {
  const safeSlug = `${job.company}-${job.title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
  const timestamp = Date.now();
  return `${new Date().toISOString().slice(0, 10)}/${safeSlug}-${timestamp}.pdf`;
}
