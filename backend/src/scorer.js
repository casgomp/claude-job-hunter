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
- reasoning: 2–3 sentences explaining the match score — focus on role fit, eligibility risks, and location. If any hard cap is triggered, explicitly cite which cap and the trigger phrase from the posting.
- eligibility_flags: array of specific concern strings (e.g. "requires degree", "Werkstudent eligibility uncertain", "requires C1 German", "requires US work authorization", "requires Japanese language"). Empty array if none.
- highlights: 1–2 sentences on what makes this role specifically interesting for the candidate, or why it scores low.
- stack: array of programming languages, frameworks, and tools explicitly mentioned in the posting (e.g. ["Python", "Django", "PostgreSQL"]). Empty array if none specified.
- experience_required: one of exactly: "entry-level", "0-1 years", "1-2 years", "2+ years", or "not specified".
- contract_type: one of exactly: "internship", "Werkstudent", "full-time", "part-time", "contract", or "not specified".

Hard caps (apply after initial scoring — take the LOWEST applicable cap). These caps are STRICT and apply regardless of title, stack match, or remote flexibility. ALWAYS re-check eligibility_flags before finalizing match_score:

- Cap at 3 (US/clearance eligibility): If the posting requires US work authorization, US citizenship, green card, security clearance, or is US-only remote, the score MUST be ≤3. This rule triggers AUTOMATICALLY and UNCONDITIONALLY whenever eligibility_flags contains any of: "requires US work authorization", "requires US citizenship", "requires green card", "requires security clearance", "US-only", or the posting text mentions "must be US citizen", "must be authorized to work in the US", "US persons only", or equivalent. This cap overrides any "Junior", "Entry", "Graduate", or "Remote" framing in the title — do not exceed 3 under any circumstance. Before returning, verify: if any US-eligibility flag is present, match_score ≤ 3.

- Cap at 3 (German language): If the role requires German at B2 or higher, requires C1/C2 German, mentions "fluent German" / "verhandlungssicher" / "muttersprachlich", or the listing itself is written almost entirely in German (not English or bilingual), the score MUST be ≤3. This rule triggers automatically whenever eligibility_flags contains any of: "German-only listing", "requires C1 German", "requires C2 German", "requires fluent German", "requires B2 German". This cap applies to Werkstudent roles as well — do not exempt them.

- Cap at 3 (non-target region): For jobs located in or restricted to non-target regions (e.g. ANZ, US, Dallas, APAC-only, LATAM-only, India-only), cap at 3 regardless of seniority match. Add a specific region flag to eligibility_flags.

- Cap at 4 (geography/language contradicts candidate target): If eligibility_flags indicate the listing language or location contradicts the candidate's target geography (e.g. Italian-language listing, French-only listing, Spanish-only listing, ANZ-based posting, APAC-based posting, LATAM-based posting) and no explicit EU/Berlin/Japan accommodation is stated, cap at 4. If the location cap at 3 above also applies, take the lower cap.

- Cap at 4 (timezone-incompatible remote): If a role is nominally "remote" but the company/team is based in ANZ, US, or another non-EU region with no explicit EU-timezone allowance, cap at 4 even if remote work is offered. Add "timezone risk: <region>" to eligibility_flags.

- Cap at 4 (title/description contradiction): If the role description contradicts the title (e.g. "Junior" title but 5+ years required), or if the remote/hybrid scope is unclear or contradictory, cap at 4. Add a flag describing the contradiction.

- Cap at 4 (experience exceeds candidate level + title contradiction): If experience_required is "1-2 years" or "2+ years" (i.e. exceeds candidate's level) AND the title implies more junior framing (e.g. "Junior", "Graduate", "Entry") OR the description otherwise contradicts the title, cap at 4. Add both the experience flag and the contradiction flag to eligibility_flags.

- Cap at 5 (ambiguous remote without confirmed EU/Berlin/Japan eligibility): If a role is listed as "remote" or "global" but the posting does NOT explicitly confirm EU work eligibility, Berlin-based hiring, or Japan-based hiring (e.g. no mention of EU entity, no EU/EMEA timezone requirement, no explicit "open to EU candidates"), cap at 5. Add "EU eligibility unconfirmed" to eligibility_flags. If a stronger cap (US, ANZ, timezone) applies, take the lower cap.

- Cap at 5 (non-software-engineering role): If the role is primarily non-engineering (e.g. data analyst, BI, product manager, designer, IT support, QA-only manual testing, DevOps-only with no coding, technical writer, sales engineer), cap at 5. In the reasoning, cite the specific phrase from the description that triggered this cap (e.g. "description says 'primary responsibility is dashboard maintenance in Tableau'"). Add "non-SWE role" to eligibility_flags.

Seniority verification:
- Do not rely on the job title alone (e.g. "Junior", "Graduate") to determine seniority. Always cross-check the experience_required field and the body of the description before assigning a score. If the title says "Junior" but the description requires 3+ years, treat it as the higher seniority and apply the title/description contradiction cap (4).
- Two roles with the same title but different experience_required values should be scored according to experience_required, not the title.
- When a company posts both junior and mid/senior versions of similar roles (e.g. home24-style clusters), verify the actual seniority from the description body — required years of experience, scope of responsibility, expected autonomy — rather than trusting the "Junior" label. If the description reads as mid-level despite a junior title, apply the title/description contradiction cap (4) and note the specific evidence in reasoning.

Consistency rules:
- For similarly-qualified entry-level roles (same company, same source, comparable seniority and eligibility), small differences in stack familiarity must not produce gaps larger than 1 point. Anchor the score primarily on role level, eligibility, and location fit; treat stack overlap as a secondary modifier.
- Do not inflate scores above 6 based on stack match alone if eligibility or location fit is weak.
- Pan-EU job boards (OfferZen, EU Remote, Honeypot, etc.) with entry-level roles requiring ~1 year of experience and no eligibility blockers should score 6 by default — adjust ±1 only for clear stack alignment or mismatch, not for board prestige. Apply this baseline uniformly across all such listings.

Final verification step (before returning JSON):
- Re-scan eligibility_flags. For each flag, confirm the appropriate cap has been applied and match_score does not exceed it.
- If multiple caps apply, the FINAL match_score must equal the LOWEST cap.

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
