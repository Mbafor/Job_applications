import { Resend } from "resend";
import { requireEnv } from "./env";
import { DigestRow } from "./types";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildDigestHtml(rows: DigestRow[]): string {
  if (rows.length === 0) {
    return `<p>No new job postings matched your search in this run. The pipeline ran successfully — nothing to review today.</p>`;
  }

  const tableRows = rows
    .map(
      (row) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(row.title)}</td>
        <td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(row.company)}</td>
        <td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(row.source)}</td>
        <td style="padding:8px;border-bottom:1px solid #ddd;"><a href="${row.jobUrl}">View posting</a></td>
        <td style="padding:8px;border-bottom:1px solid #ddd;"><a href="${row.resumePdfUrl}">Tailored resume</a></td>
      </tr>`
    )
    .join("");

  return `
    <p>${rows.length} new job posting${rows.length === 1 ? "" : "s"} found. Review each posting and resume, then submit manually — this pipeline does not auto-apply.</p>
    <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;">
      <thead>
        <tr style="text-align:left;background:#f5f5f5;">
          <th style="padding:8px;">Title</th>
          <th style="padding:8px;">Company</th>
          <th style="padding:8px;">Source</th>
          <th style="padding:8px;">Posting</th>
          <th style="padding:8px;">Resume</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>`;
}

export async function sendDigestEmail(rows: DigestRow[], notifyEmail: string): Promise<void> {
  const apiKey = requireEnv("RESEND_API_KEY");
  const resend = new Resend(apiKey);

  const subject =
    rows.length > 0
      ? `Job digest: ${rows.length} new posting${rows.length === 1 ? "" : "s"}`
      : "Job digest: no new postings today";

  const { error } = await resend.emails.send({
    from: "onboarding@resend.dev",
    to: notifyEmail,
    subject,
    html: buildDigestHtml(rows),
  });

  if (error) {
    throw new Error(`Failed to send digest email: ${error.message}`);
  }
}
