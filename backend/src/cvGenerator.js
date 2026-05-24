require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { marked } = require('marked');
const puppeteer  = require('puppeteer');

const BASE_CV_PATH   = path.join(__dirname, '../../base_cv.md');
const OUTPUT_DIR     = path.join(__dirname, '../generated_cvs');
const MODEL          = 'claude-opus-4-7';

const SYSTEM_PROMPT = `You are a CV tailoring expert. You will receive a candidate's base CV (in Markdown) and a job posting. Your task is to produce a tailored version of the CV optimized for that specific role.

Rules:
- Do NOT invent experience, skills, or achievements that are not in the base CV.
- You MAY reorder sections, reorder bullet points, and reframe existing content to highlight what is most relevant.
- You MAY adjust the Profile summary to speak directly to the role and company.
- You MAY reorder the Projects section to put the most relevant projects first.
- You MAY expand or compress project descriptions (within what is true) to emphasize relevant skills.
- Keep the CV to a single page in density — concise and focused.
- Output ONLY the tailored CV in Markdown format. No commentary, no preamble, no code fences.`;

function slugify(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function buildHtml(markdown) {
  const body = marked.parse(markdown);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Georgia', serif;
    font-size: 10.5pt;
    line-height: 1.45;
    color: #1a1a1a;
    padding: 22mm 20mm 18mm 20mm;
    max-width: 210mm;
  }
  h1 {
    font-size: 20pt;
    font-weight: bold;
    letter-spacing: 0.5px;
    margin-bottom: 2px;
  }
  /* Subtitle line (role + contact) */
  h1 + p {
    font-size: 9.5pt;
    color: #444;
    margin-bottom: 2px;
  }
  h1 + p + p {
    font-size: 9pt;
    color: #555;
    margin-bottom: 14px;
  }
  h2 {
    font-size: 10.5pt;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 1px;
    border-bottom: 1px solid #bbb;
    padding-bottom: 2px;
    margin-top: 12px;
    margin-bottom: 6px;
    color: #222;
  }
  h3 {
    font-size: 10.5pt;
    font-weight: bold;
    margin-top: 7px;
    margin-bottom: 1px;
  }
  p {
    margin-bottom: 4px;
  }
  ul {
    margin-left: 14px;
    margin-bottom: 4px;
  }
  li {
    margin-bottom: 2px;
  }
  strong { font-weight: bold; }
  em     { font-style: italic; color: #444; }
  a      { color: #1a1a1a; text-decoration: none; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

async function generateCv(job) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY not set in .env');

  const baseCv = fs.readFileSync(BASE_CV_PATH, 'utf8');

  const jobText = [
    `Job Title: ${job.title || 'N/A'}`,
    `Company:   ${job.company || 'N/A'}`,
    `Location:  ${job.location || 'N/A'}`,
    `Work type: ${job.work_type || 'N/A'}`,
    `Contract:  ${job.contract_type || 'N/A'}`,
    `Stack:     ${Array.isArray(job.stack) ? job.stack.join(', ') : (job.stack || 'N/A')}`,
    ``,
    `Description:`,
    job.description ? job.description.slice(0, 4000) : 'N/A',
  ].join('\n');

  const client = new Anthropic({ apiKey });

  console.log(`[cv] Tailoring CV for "${job.title}" @ ${job.company}...`);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    thinking: { type: 'adaptive' },
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: `Base CV:\n${baseCv}\n\n---\n\nJob posting:\n${jobText}`,
      },
    ],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text in Claude response');

  const tailoredMarkdown = textBlock.text.trim();
  console.log(`[cv] Got tailored CV (${tailoredMarkdown.length} chars). Generating PDF...`);

  // Build filename
  const filename = `${slugify(job.company)}_${slugify(job.title)}.pdf`;
  const outputPath = path.join(OUTPUT_DIR, filename);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Convert markdown → HTML → PDF
  const html = buildHtml(tailoredMarkdown);

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.pdf({
      path:   outputPath,
      format: 'A4',
      printBackground: false,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
  } finally {
    await browser.close();
  }

  console.log(`[cv] Saved to ${outputPath}`);
  return { filename, path: outputPath, markdown: tailoredMarkdown };
}

module.exports = { generateCv };
