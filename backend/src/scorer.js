require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs   = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { ScoringLogger } = require('./scoringLogger');

const RAW_JOBS_PATH    = path.join(__dirname, '../../scraper/raw_jobs.json');
const CRITERIA_PATH    = path.join(__dirname, '../../criteria.md');
const OUTPUT_PATH      = path.join(__dirname, '../scored_jobs.json');
const BATCH_SIZE       = 10;
const INTER_CALL_DELAY = 1000;

const MODEL = 'claude-opus-4-7';

const SYSTEM_PROMPT = `You are a job match evaluator for a specific candidate. Given a job posting and the candidate's criteria, evaluate the fit and return a JSON object.

Candidate criteria document:
<criteria>
${fs.readFileSync(CRITERIA_PATH, 'utf8')}
</criteria>

Evaluation rules:
- match_score: integer 1–10 (10 = perfect match for the candidate's profile and goals). Follow the Match Scoring section in the criteria, then apply the hard caps below.
- reasoning: 2–3 sentences explaining the match score — focus on role fit, eligibility risks, and location.
- eligibility_flags: array of specific concern strings (e.g. "requires degree", "Werkstudent eligibility uncertain", "requires C1 German", "requires US work authorization", "requires Japanese language"). Empty array if none.
- highlights: 1–2 sentences on what makes this role specifically interesting for the candidate, or why it scores low.
- stack: array of programming languages, frameworks, and tools explicitly mentioned in the posting (e.g. ["Python", "Django", "PostgreSQL"]). Empty array if none specified.
- experience_required: one of exactly: "entry-level", "0-1 years", "1-2 years", "2+ years", or "not specified".
- contract_type: one of exactly: "internship", "Werkstudent", "full-time", "part-time", "contract", or "not specified".

Hard caps (apply after initial scoring — take the LOWEST applicable cap):
- Cap at 3 if the role requires US work authorization, US citizenship, security clearance, or is US-only remote. This applies even if the title says "Junior" or "Remote".
- Cap at 3 if the listing is written almost entirely in German (not English or bilingual) — also add "German-only listing" to eligibility_flags.
- Cap at 3 if the role requires German proficiency (B2 or higher, or unspecified "fluent German"), since the candidate's German level is limited.
- Cap at 3 for jobs located in or restricted to non-target regions (e.g. ANZ, US, Dallas, APAC-only, LATAM-only) regardless of seniority match. Add a specific region flag to eligibility_flags.
- Cap at 4 if the role description contradicts the title (e.g. "Junior" title but 5+ years required), or if the remote/hybrid scope is unclear or contradictory. Add a flag describing the contradiction.

Consistency rules:
- For similarly-qualified entry-level roles (same company, same source, comparable seniority and eligibility), small differences in stack familiarity must not produce gaps larger than 1 point. Anchor the score primarily on role level, eligibility, and location fit; treat stack overlap as a secondary modifier.
- Do not inflate scores above 6 based on stack match alone if eligibility or location fit is weak.

Return ONLY valid JSON with these keys: match_score, reasoning, eligibility_flags, highlights, stack, experience_required, contract_type.
Do not include markdown fences or any text outside the JSON object.`;

async function scoreJob(client, job) {
  const jobText = [
    `Title: ${job.title || 'N/A'}`,
    `Company: ${job.company || 'N/A'}`,
    `Location: ${job.location || 'N/A'}`,
    `Country: ${job._country || 'N/A'}`,
    `Work type: ${job._work_type || 'N/A'}`,
    `Salary: ${job.salary || 'N/A'}`,
    `Source: ${job.source}`,
    ``,
    `Description:`,
    job.description ? job.description.slice(0, 3000) : 'N/A',
  ].join('\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 700,
    thinking: { type: 'adaptive' },
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Evaluate this job posting:\n\n${jobText}`,
      },
    ],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in response');

  const parsed = JSON.parse(textBlock.text.trim());
  return { parsed, usage: response.usage };
}

async function selfEvaluate(client, scoredJobs) {
  const summary = scoredJobs.map(j =>
    `- (${j.score}/10) "${j.title}" @ ${j.company}: ${j.reasoning}`
  ).join('\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    thinking: { type: 'adaptive' },
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Review the following batch of job evaluations for score consistency and calibration. Flag any that seem mis-scored relative to each other or the criteria. Return a JSON object with:\n- issues: array of { title, company, issue } for any problems\n- overall_quality: "good" | "review_needed"\n- notes: 1–2 sentences on overall calibration\n\nEvaluations:\n${summary}`,
      },
    ],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) return null;
  try {
    return JSON.parse(textBlock.text.trim());
  } catch {
    return { notes: textBlock.text.trim() };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('=== Job Scorer ===\n');

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY not set in .env');

  const client = new Anthropic({ apiKey });
  const logger = new ScoringLogger();

  const rawJobs = JSON.parse(fs.readFileSync(RAW_JOBS_PATH, 'utf8'));
  console.log(`Loaded ${rawJobs.length} jobs from scraper/raw_jobs.json\n`);

  const scoredJobs = [];
  const batches = [];
  for (let i = 0; i < rawJobs.length; i += BATCH_SIZE) {
    batches.push(rawJobs.slice(i, i + BATCH_SIZE));
  }

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    console.log(`--- Batch ${bi + 1}/${batches.length} ---`);

    for (const job of batch) {
      await sleep(INTER_CALL_DELAY);
      try {
        const { parsed, usage } = await scoreJob(client, job);
        const scored = {
          ...job,
          score:               parsed.match_score,
          reasoning:           parsed.reasoning,
          eligibility_flags:   parsed.eligibility_flags,
          highlights:          parsed.highlights,
          stack:               parsed.stack,
          experience_required: parsed.experience_required,
          contract_type:       parsed.contract_type,
        };
        scoredJobs.push(scored);
        logger.logJob({
          jobTitle: job.title,
          company:  job.company,
          score:    parsed.match_score,
          tokensUsed: usage,
        });
        const flags = parsed.eligibility_flags?.length ? ` [!${parsed.eligibility_flags.length}]` : '';
        console.log(`  (${parsed.match_score}/10)${flags}  ${job.title} @ ${job.company}`);
      } catch (err) {
        console.warn(`  ERROR: ${job.title} @ ${job.company} — ${err.message}`);
        logger.logError({ message: `${job.title} @ ${job.company}: ${err.message}` });
        scoredJobs.push({
          ...job,
          score: null, reasoning: null, eligibility_flags: [], highlights: null,
          stack: [], experience_required: null, contract_type: null,
          _scoring_error: err.message,
        });
      }
    }
  }

  console.log('\n--- Self-evaluation ---');
  let selfEval = null;
  try {
    const validScored = scoredJobs.filter(j => j.score !== null);
    selfEval = await selfEvaluate(client, validScored);
    console.log(`  Quality: ${selfEval?.overall_quality ?? 'n/a'}`);
    if (selfEval?.issues?.length) {
      selfEval.issues.forEach(i => console.log(`  - ${i.title} @ ${i.company}: ${i.issue}`));
    }
    if (selfEval?.notes) console.log(`  Notes: ${selfEval.notes}`);
  } catch (err) {
    console.warn(`  Self-eval failed: ${err.message}`);
    logger.logError({ message: `self-eval: ${err.message}` });
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(scoredJobs, null, 2));
  console.log(`\nSaved to backend/scored_jobs.json`);

  const scoreBreakdown = { high: 0, mid: 0, low: 0, error: 0 };
  for (const j of scoredJobs) {
    if (j.score === null) scoreBreakdown.error++;
    else if (j.score >= 7)  scoreBreakdown.high++;
    else if (j.score >= 4)  scoreBreakdown.mid++;
    else                    scoreBreakdown.low++;
  }

  console.log('\n=== Score Breakdown ===');
  console.log(`  High (7-10): ${scoreBreakdown.high}`);
  console.log(`  Mid  (4-6):  ${scoreBreakdown.mid}`);
  console.log(`  Low  (1-3):  ${scoreBreakdown.low}`);
  if (scoreBreakdown.error) console.log(`  Errors:      ${scoreBreakdown.error}`);
  console.log(`  Total:       ${scoredJobs.length}`);

  const logPath = logger.append({
    totalJobs: scoredJobs.length,
    tierBreakdown: scoreBreakdown,
    selfEval,
  });
  console.log(`Logged to ${path.relative(process.cwd(), logPath)}`);

  console.log('\n=== Top Matches (score >= 7) ===');
  scoredJobs
    .filter(j => j.score >= 7)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .forEach(j => {
      const flags = j.eligibility_flags?.length ? ` [${j.eligibility_flags.join('; ')}]` : '';
      console.log(`  (${j.score}/10) ${j.title} @ ${j.company}${flags}`);
    });
}

if (require.main === module) {
  run().catch(err => {
    console.error('\nFatal error:', err.message);
    process.exit(1);
  });
}

module.exports = { scoreJob, SYSTEM_PROMPT };
