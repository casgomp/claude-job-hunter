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
- tier: 1 (Strong Match), 2 (Possible Match), or 3 (Stretch/Unlikely). Follow the exact tier definitions in the criteria.
- score: integer 1–10 (10 = perfect match within tier)
- reasoning: 2–4 sentences explaining the tier and score
- eligibility_flags: array of strings for any risks or flags (e.g. Werkstudent eligibility risk, degree requirement, German C1 mandatory, onsite location flagged). Empty array if none.
- highlights: 1–2 sentences on what makes this role specifically interesting for the candidate

Return ONLY valid JSON with these keys: tier, score, reasoning, eligibility_flags, highlights.
Do not include markdown fences or any text outside the JSON object.`;

async function scoreJob(client, job) {
  const jobText = [
    `Title: ${job.title || 'N/A'}`,
    `Company: ${job.company || 'N/A'}`,
    `Location: ${job.location || 'N/A'}`,
    `Work type: ${job._work_type || 'N/A'}`,
    `Salary: ${job.salary || 'N/A'}`,
    `Source: ${job.source}`,
    ``,
    `Description:`,
    job.description ? job.description.slice(0, 3000) : 'N/A',
  ].join('\n');

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
    `- [T${j.tier}] "${j.title}" @ ${j.company} (score ${j.score}): ${j.reasoning}`
  ).join('\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
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
        content: `Review the following batch of job evaluations for consistency and calibration. Flag any that seem mis-tiered or mis-scored relative to each other. Return a JSON object with:\n- issues: array of { title, company, issue } for any problems\n- overall_quality: "good" | "review_needed"\n- notes: 1–2 sentences on overall calibration\n\nEvaluations:\n${summary}`,
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
        const scored = { ...job, ...parsed };
        scoredJobs.push(scored);
        logger.logJob({
          jobTitle: job.title,
          company: job.company,
          tier: parsed.tier,
          score: parsed.score,
          tokensUsed: usage,
        });
        const flags = parsed.eligibility_flags?.length ? ` [!${parsed.eligibility_flags.length} flag(s)]` : '';
        console.log(`  T${parsed.tier} (${parsed.score}/10)${flags}  ${job.title} @ ${job.company}`);
      } catch (err) {
        console.warn(`  ERROR: ${job.title} @ ${job.company} — ${err.message}`);
        logger.logError({ message: `${job.title} @ ${job.company}: ${err.message}` });
        scoredJobs.push({ ...job, tier: null, score: null, reasoning: null, eligibility_flags: [], highlights: null, _scoring_error: err.message });
      }
    }
  }

  console.log('\n--- Self-evaluation ---');
  let selfEval = null;
  try {
    const validScored = scoredJobs.filter(j => j.tier !== null);
    selfEval = await selfEvaluate(client, validScored);
    console.log(`  Quality: ${selfEval?.overall_quality ?? 'n/a'}`);
    if (selfEval?.issues?.length) {
      console.log(`  Issues flagged: ${selfEval.issues.length}`);
      selfEval.issues.forEach(i => console.log(`    - ${i.title} @ ${i.company}: ${i.issue}`));
    }
    if (selfEval?.notes) console.log(`  Notes: ${selfEval.notes}`);
  } catch (err) {
    console.warn(`  Self-eval failed: ${err.message}`);
    logger.logError({ message: `self-eval: ${err.message}` });
  }

  // Save output
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(scoredJobs, null, 2));
  console.log(`\nSaved to backend/scored_jobs.json`);

  // Tier breakdown
  const tierBreakdown = { 1: 0, 2: 0, 3: 0, null: 0 };
  for (const j of scoredJobs) {
    const t = j.tier ?? null;
    tierBreakdown[t] = (tierBreakdown[t] || 0) + 1;
  }

  console.log('\n=== Tier Breakdown ===');
  console.log(`  Tier 1 (Strong Match):    ${tierBreakdown[1]}`);
  console.log(`  Tier 2 (Possible Match):  ${tierBreakdown[2]}`);
  console.log(`  Tier 3 (Stretch):         ${tierBreakdown[3]}`);
  if (tierBreakdown[null]) console.log(`  Errors (unscored):        ${tierBreakdown[null]}`);
  console.log(`  Total:                    ${scoredJobs.length}`);

  const logPath = logger.append({
    totalJobs: scoredJobs.length,
    tierBreakdown,
    selfEval,
  });
  console.log(`Logged to ${path.relative(process.cwd(), logPath)}`);

  console.log('\n=== Tier 1 Jobs ===');
  scoredJobs
    .filter(j => j.tier === 1)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .forEach(j => {
      const flags = j.eligibility_flags?.length ? ` [${j.eligibility_flags.join('; ')}]` : '';
      console.log(`  (${j.score}/10) ${j.title} @ ${j.company}${flags}`);
    });
}

run().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
