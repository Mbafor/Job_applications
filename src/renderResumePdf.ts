import { Browser } from "playwright";
import { marked } from "marked";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildHtmlDocument(tailoredResumeMarkdown: string, title: string): string {
  const bodyHtml = marked.parse(tailoredResumeMarkdown, { async: false }) as string;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Georgia', 'Times New Roman', serif;
    color: #1a1a1a;
    font-size: 11pt;
    line-height: 1.45;
  }
  h1 {
    font-size: 20pt;
    margin: 0 0 4pt 0;
    border-bottom: 1.5pt solid #1a1a1a;
    padding-bottom: 6pt;
  }
  h2 {
    font-size: 12.5pt;
    text-transform: uppercase;
    letter-spacing: 0.5pt;
    margin: 16pt 0 6pt 0;
    color: #2b2b2b;
    border-bottom: 0.75pt solid #999;
    padding-bottom: 2pt;
  }
  h3 {
    font-size: 11pt;
    margin: 10pt 0 2pt 0;
  }
  p { margin: 4pt 0; }
  ul { margin: 4pt 0; padding-left: 16pt; }
  li { margin: 2pt 0; }
  strong { font-weight: 700; }
  a { color: #1a1a1a; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/**
 * Renders tailored resume Markdown to a styled PDF using Playwright's
 * page.pdf() against a real Chromium instance (no LaTeX, no manual
 * text-layout library).
 */
export async function renderResumePdf(
  browser: Browser,
  tailoredResumeMarkdown: string,
  title: string
): Promise<Buffer> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const html = buildHtmlDocument(tailoredResumeMarkdown, title);
    await page.setContent(html, { waitUntil: "load" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
    });
    return pdfBuffer;
  } finally {
    await context.close();
  }
}
