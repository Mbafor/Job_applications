import Anthropic from "@anthropic-ai/sdk";
import { requireEnv } from "./env";
import { JobListing } from "./types";

const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `You are a resume editor. You will be given a candidate's base resume and a \
target job description. Produce a tailored version of the resume that:

- Rewords and reorders existing bullet points/sections to surface the \
experience most relevant to this job and to mirror the job posting's \
keywords and phrasing where truthful.
- Reorders sections or bullets by relevance; may trim less-relevant bullets \
if the resume would otherwise run long.
- NEVER invents, embellishes, or implies skills, employers, titles, tools, \
metrics, or experience that are not already present in the base resume. If \
the job wants something the candidate's resume does not support, simply do \
not claim it.
- Preserves all factual content: employer names, job titles, dates, degrees, \
and metrics must match the base resume exactly.

Output ONLY the tailored resume in Markdown: a "# Name" heading if present in \
the source, "## Section" headings, and "-" bullet points. No commentary, no \
preamble, no explanation of changes.`;

export async function tailorResume(baseResumeText: string, job: JobListing): Promise<string> {
  const apiKey = requireEnv("ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey });

  const userPrompt = `BASE RESUME:\n${baseResumeText}\n\n---\n\nTARGET JOB\nTitle: ${job.title}\nCompany: ${job.company}\nDescription:\n${job.description || "(no description available)"}\n\n---\n\nProduce the tailored resume now, following the system instructions exactly.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Anthropic response contained no text content");
  }
  return textBlock.text.trim();
}
