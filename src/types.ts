export type JobSource = "linkedin" | "adzuna";

export interface JobListing {
  title: string;
  company: string;
  url: string;
  description: string;
  postedAt: string | null; // ISO string if known
  source: JobSource;
}

export interface UserConfig {
  base_resume_text: string;
  job_query: string;
  job_location: string;
  max_days_old: number;
  results_limit: number;
  notify_email: string;
}

export interface DigestRow {
  title: string;
  company: string;
  jobUrl: string;
  resumePdfUrl: string;
  source: JobSource;
}
