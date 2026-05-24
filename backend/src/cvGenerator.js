require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { marked } = require('marked');
const puppeteer  = require('puppeteer');

const BASE_CV_PATH = path.join(__dirname, '../../base_cv.md');
const OUTPUT_DIR   = path.join(__dirname, '../generated_cvs');
const MODEL        = 'claude-opus-4-7';

const SYSTEM_PROMPT = `You are a CV tailoring expert. You will receive a candidate's base CV and a job posting. Produce a tailored version of the CV optimized for that specific role.

── SECTION ORDER ──────────────────────────────────────────────────────────────
The sections must appear in this fixed order:
  1. Profile
  2. Technical Skills
  3. Projects   ← always before Professional Experience
  4. Professional Experience
  5. Education
  6. Languages

── PROFILE SUMMARY ────────────────────────────────────────────────────────────
- Lead with the candidate's programming skills and 42 Berlin projects.
- The previous career in architecture/urban planning is background context only — mention it briefly at most, never as a selling point or lead.
- Do NOT open with "7+ years of professional experience" or anything that foregrounds the non-software career.
- Only reference skills and experience that genuinely appear in the base CV.

── PROFESSIONAL EXPERIENCE ────────────────────────────────────────────────────
- Maximum one line per role — company, title, dates, one-sentence summary. No bullet points.
- This section is context, not the main pitch. Keep it short.
- Do NOT highlight or expand statistical tools (SPSS, Stata, R, statistical modeling, survival analysis) anywhere outside the Education section. These were academic tools, not current competencies. They may appear only as part of a degree description.

── TECHNICAL SKILLS ───────────────────────────────────────────────────────────
- Only list skills and tools explicitly stated in the base CV's Technical Skills section.
- Do NOT add SQL, Snowflake, or any tool not explicitly listed there, even if the job asks for it.
- Tailor by reframing and reordering what genuinely exists — never by inventing competencies.

── PROJECTS ───────────────────────────────────────────────────────────────────
- The main selling points in order are: programming skills → 42 Berlin projects → systems thinking → brief professional background.
- Order 42 Berlin projects by relevance to the job posting.
- Claude Job Hunter MUST appear LAST in the projects list. This is a hard rule with only one exception: if the job posting explicitly and specifically mentions Node.js, React, Claude API, or AI-powered tooling as a required or desired skill. General data engineering, pipelines, or databases do NOT qualify as exceptions. When in doubt, put it last.

── CLAUDE JOB HUNTER — ACCURACY RULE ─────────────────────────────────────────
- This project was built using Claude Code as a development accelerator (an agentic AI coding tool). The candidate defined the architecture, requirements, and system design — the implementation was largely AI-assisted.
- Do NOT describe it as "built from scratch" or imply conventional solo authorship.
- Accurate framing: "designed and directed the build of", "architected using an agentic development workflow", or similar.

── OUTPUT FORMAT ──────────────────────────────────────────────────────────────
Use EXACTLY this markdown structure:
- Line 1: candidate full name (plain text, no # marker)
- Line 2: role/subtitle (plain text)
- Line 3: contact info (plain text, pipe-separated)
- Blank line
- ## for section headers (## Profile, ## Technical Skills, ## Projects, ## Professional Experience, ## Education, ## Languages)
- ### for each project or job entry title
- Plain paragraph for description text under each entry
- Use **bold** for company names or dates if helpful

Output ONLY the tailored CV. No commentary, no preamble, no code fences.`;

function slugify(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function buildHtml(markdown) {
  const lines = markdown.split('\n');

  // Split header (everything before first ##) from body sections
  const firstSection = lines.findIndex(l => /^##\s/.test(l));
  const headerLines  = (firstSection > 0 ? lines.slice(0, firstSection) : []).filter(l => l.trim());
  const bodyLines    = firstSection >= 0 ? lines.slice(firstSection) : lines;

  // Extract name, role, contact from header lines
  const [name = '', role = '', ...restContact] = headerLines;
  const contactRaw = restContact.filter(Boolean).join(' ');

  // Render contact: turn links into clickable but unstyled text
  const contactHtml = contactRaw
    .replace(/https?:\/\/\S+/g, url => `<a href="${url}">${url.replace(/^https?:\/\//, '')}</a>`)
    .replace(/\|/g, '<span class="sep">·</span>');

  const bodyHtml = marked.parse(bodyLines.join('\n'));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @page {
    size: A4;
    margin: 15mm 18mm 14mm 18mm;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: Arial, Helvetica, 'Liberation Sans', sans-serif;
    font-size: 9pt;
    line-height: 1.45;
    color: #1f2937;
  }

  /* ── HEADER ─────────────────────────────────────────── */
  .cv-header {
    padding-bottom: 10px;
    margin-bottom: 10px;
    border-bottom: 2px solid #1e3a5f;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }

  .header-left { flex: 1; }

  .cv-name {
    font-size: 22pt;
    font-weight: 700;
    color: #111827;
    line-height: 1.1;
    letter-spacing: -0.3px;
  }

  .cv-role {
    font-size: 10.5pt;
    font-weight: 400;
    color: #374151;
    margin-top: 3px;
  }

  .cv-contact {
    font-size: 7.5pt;
    color: #6b7280;
    text-align: right;
    line-height: 1.7;
  }

  .cv-contact a {
    color: #6b7280;
    text-decoration: none;
  }

  .sep { margin: 0 4px; color: #d1d5db; }

  /* ── SECTION HEADERS (h2) ────────────────────────────── */
  h2 {
    font-size: 7.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.4px;
    color: #1e3a5f;
    border-bottom: 1px solid #bfdbfe;
    padding-bottom: 2px;
    margin-top: 11px;
    margin-bottom: 5px;
  }

  /* ── PROJECT / JOB ENTRY TITLES (h3) ────────────────── */
  h3 {
    font-size: 9pt;
    font-weight: 700;
    color: #111827;
    margin-top: 7px;
    margin-bottom: 1px;
    display: flex;
    justify-content: space-between;
  }

  /* ── BODY TEXT ───────────────────────────────────────── */
  p {
    font-size: 8.5pt;
    color: #374151;
    margin-bottom: 3px;
    line-height: 1.45;
  }

  ul {
    padding-left: 13px;
    margin-bottom: 3px;
  }

  li {
    font-size: 8.5pt;
    color: #374151;
    margin-bottom: 1px;
    line-height: 1.4;
  }

  strong { font-weight: 700; color: #1f2937; }
  em     { font-style: italic; color: #6b7280; }
  a      { color: #1e3a5f; text-decoration: none; }
</style>
</head>
<body>

<div class="cv-header">
  <div class="header-left">
    <div class="cv-name">${name}</div>
    <div class="cv-role">${role}</div>
  </div>
  <div class="cv-contact">${contactHtml}</div>
</div>

<div class="cv-body">
${bodyHtml}
</div>

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
    model:      MODEL,
    max_tokens: 2000,
    thinking:   { type: 'adaptive' },
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role:    'user',
        content: `Base CV:\n${baseCv}\n\n---\n\nJob posting:\n${jobText}`,
      },
    ],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text in Claude response');

  const tailoredMarkdown = textBlock.text.trim();
  console.log(`[cv] Got tailored CV (${tailoredMarkdown.length} chars). Generating PDF...`);

  const filename   = `${slugify(job.company)}_${slugify(job.title)}.pdf`;
  const outputPath = path.join(OUTPUT_DIR, filename);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const html    = buildHtml(tailoredMarkdown);
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.pdf({
      path:            outputPath,
      format:          'A4',
      printBackground: true,
      margin:          { top: '0', right: '0', bottom: '0', left: '0' },
    });
  } finally {
    await browser.close();
  }

  console.log(`[cv] Saved to ${outputPath}`);

  // Also write the HTML for inspection
  const htmlPath = outputPath.replace('.pdf', '.html');
  fs.writeFileSync(htmlPath, html);

  return { filename, path: outputPath, markdown: tailoredMarkdown };
}

module.exports = { generateCv };
