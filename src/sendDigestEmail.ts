import { Resend } from "resend";
import { requireEnv } from "./env";
import { DigestRow } from "./types";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const SOURCE_LABEL: Record<DigestRow["source"], { label: string; bg: string; fg: string }> = {
  linkedin: { label: "LinkedIn", bg: "#e7f0fd", fg: "#0a66c2" },
  adzuna: { label: "Adzuna", fg: "#7a4a00", bg: "#fdf1e0" },
};

function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function wrapEmail(bodyHtml: string): string {
  return `
  <div style="background:#f4f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="padding:28px 32px;border-bottom:1px solid #eee;">
        <div style="font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#6b7280;">Job Application Pipeline</div>
        <div style="font-size:20px;font-weight:700;color:#111827;margin-top:4px;">Your daily job digest</div>
        <div style="font-size:13px;color:#9ca3af;margin-top:2px;">${todayLabel()}</div>
      </div>
      <div style="padding:28px 32px;">
        ${bodyHtml}
      </div>
      <div style="padding:20px 32px;background:#f9fafb;border-top:1px solid #eee;font-size:12px;color:#9ca3af;line-height:1.6;">
        This is an automated digest. Every resume above was tailored from your base resume without inventing
        experience, but you should always give it a final read before sending. Nothing here was submitted on
        your behalf — review each posting and apply yourself when you're ready.
      </div>
    </div>
  </div>`;
}

function buildEmptyStateHtml(): string {
  return wrapEmail(`
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 8px 0;">
      No new postings matched your search since the last run.
    </p>
    <p style="font-size:14px;color:#6b7280;line-height:1.6;margin:0;">
      The pipeline ran successfully — there's simply nothing new to review today. You'll get another digest
      at the next scheduled run.
    </p>`);
}

function buildDigestHtml(rows: DigestRow[]): string {
  if (rows.length === 0) return buildEmptyStateHtml();

  const tableRows = rows
    .map((row) => {
      const badge = SOURCE_LABEL[row.source];
      return `
      <tr>
        <td style="padding:14px 12px;border-bottom:1px solid #f0f1f3;">
          <div style="font-size:14px;font-weight:600;color:#111827;">${escapeHtml(row.title)}</div>
          <div style="font-size:13px;color:#6b7280;margin-top:2px;">${escapeHtml(row.company)}</div>
          <span style="display:inline-block;margin-top:6px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:${badge.bg};color:${badge.fg};">${badge.label}</span>
        </td>
        <td style="padding:14px 12px;border-bottom:1px solid #f0f1f3;text-align:right;white-space:nowrap;">
          <a href="${row.jobUrl}" style="display:inline-block;padding:7px 14px;border-radius:6px;background:#111827;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;">View posting</a><br/>
          <a href="${row.resumePdfUrl}" style="display:inline-block;margin-top:8px;padding:7px 14px;border-radius:6px;border:1px solid #d1d5db;color:#111827;text-decoration:none;font-size:13px;font-weight:600;">Tailored resume</a>
        </td>
      </tr>`;
    })
    .join("");

  const summary = `${rows.length} new job posting${rows.length === 1 ? "" : "s"} found and tailored`;

  const body = `
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 20px 0;">
      <strong>${summary}.</strong> Each row below links to the original posting and a resume tailored
      specifically to it. Review both, then submit the application yourself — this pipeline never applies on
      your behalf.
    </p>
    <table style="border-collapse:collapse;width:100%;">
      <tbody>${tableRows}</tbody>
    </table>`;

  return wrapEmail(body);
}

export async function sendDigestEmail(rows: DigestRow[], notifyEmail: string): Promise<void> {
  const apiKey = requireEnv("RESEND_API_KEY");
  const resend = new Resend(apiKey);

  const subject =
    rows.length > 0
      ? `${rows.length} new job match${rows.length === 1 ? "" : "es"} — resumes ready for review`
      : "Job digest — no new matches today";

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
