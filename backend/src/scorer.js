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
- eligibility_flags: array of specific concern strings (e.g. "requires degree", "Werkstudent eligibility uncertain (42 Berlin)", "requires C1 German", "requires US work authorization", "requires Japanese language", "stack mismatch: Java/.NET", "industry mismatch: gambling"). Empty array if none.
- highlights: 1–2 sentences on what makes this role specifically interesting for the candidate, or why it scores low.
- stack: array of programming languages, frameworks, and tools explicitly mentioned in the posting (e.g. ["Python", "Django", "PostgreSQL"]). Empty array if none specified.
- experience_required: one of exactly: "entry-level", "0-1 years", "1-2 years", "2+ years", or "not specified".
- contract_type: one of exactly: "internship", "Werkstudent", "full-time", "part-time", "contract", or "not specified".

Hard caps (apply after initial scoring — take the LOWEST applicable cap). These caps are STRICT and apply regardless of title, stack match, or remote flexibility. ALWAYS re-check eligibility_flags before finalizing match_score:

- Cap at 1 (senior/lead role — out of scope): If the job title contains any of: Senior, Lead, Principal, Staff (as a seniority level), Manager, Director, Head of, Architect (unless "Junior Architect"), CTO, VP, Vice President, or Chief — the score MUST be 1. These roles are well outside the candidate's entry-level scope and should not have reached scoring. Add "senior/lead role — out of scope" to eligibility_flags. This cap is absolute and cannot be overridden by any other factor.

- Cap at 3 (US/clearance eligibility): If the posting requires US work authorization, US citizenship, green card, security clearance, or is US-only remote, the score MUST be ≤3. This rule triggers AUTOMATICALLY and UNCONDITIONALLY whenever eligibility_flags contains any of: "requires US work authorization", "requires US citizenship", "requires green card", "requires security clearance", "US-only", or the posting text mentions "must be US citizen", "must be authorized to work in the US", "US persons only", or equivalent. This cap overrides any "Junior", "Entry", "Graduate", or "Remote" framing in the title — do not exceed 3 under any circumstance. Before returning, verify: if any US-eligibility flag is present, match_score ≤ 3.

- Cap at 3 (German language — UNCONDITIONAL, INCLUDING WERKSTUDENT): If the role requires German at B2 or higher, requires C1/C2 German, mentions "fluent German" / "verhandlungssicher" / "muttersprachlich", uses German job-posting conventions like "(m/w/d)" combined with a German-language description, or the listing itself is written substantially in German (not English or bilingual), the score MUST be ≤3. This rule triggers automatically and UNCONDITIONALLY whenever eligibility_flags contains ANY of: "German-only listing", "likely requires C1/German proficiency", "likely requires German proficiency", "requires C1 German", "requires C2 German", "requires fluent German", "requires B2 German", "requires German", or any variant referencing German language ability. The candidate's profile does not indicate German fluency, so these flags are ALWAYS disqualifying — do NOT exceed 3 even if the role is otherwise an excellent fit on stack, seniority, or location. THIS CAP APPLIES TO WERKSTUDENT, INTERNSHIP, AND ENTRY-LEVEL ROLES WITH NO EXCEPTIONS. A "(m/w/d)" Werkstudent listing with a German description must be capped at 3. Before returning, verify: if any German-language flag is present, match_score ≤ 3.

- Cap at 3 (non-target region): For jobs located in or restricted to non-target regions (e.g. ANZ, US, Dallas, APAC-only, LATAM-only, India-only), cap at 3 regardless of seniority match. Add a specific region flag to eligibility_flags.

- Cap at 4 (geography/language contradicts candidate target): If eligibility_flags indicate the listing language or location contradicts the candidate's target geography (e.g. Italian-language listing, French-only listing, Spanish-only listing, ANZ-based posting, APAC-based posting, LATAM-based posting) and no explicit EU/Berlin/Japan accommodation is stated, cap at 4. If the location cap at 3 above also applies, take the lower cap.

- Cap at 4 (timezone-incompatible remote): If a role is nominally "remote" but the company/team is based in ANZ, US, or another non-EU region with no explicit EU-timezone allowance, cap at 4 even if remote work is offered. Add "timezone risk: <region>" to eligibility_flags.

- Cap at 4 (remote with unconfirmed EU/Japan eligibility): If a posting is "remote" or "global" and the work authorization region or timezone is unspecified or unclear, cap at 4 (NOT 5) unless the posting explicitly confirms EU work eligibility, Berlin-based hiring, or Japan-based hiring. Add "EU eligibility unconfirmed" or "remote scope unspecified" to eligibility_flags. Only score above 4 if the posting explicitly states EU/EMEA timezone, EU entity, Berlin office, or Japan office. If a stronger cap (US, ANZ, timezone) applies, take the lower cap.

- Cap at 4 (title/description contradiction): If the role description contradicts the title (e.g. "Junior" title but 5+ years required), or if the remote/hybrid scope is unclear or contradictory, cap at 4. Add a flag describing the contradiction.

- Cap at 4 (Junior title + 1-2 years required — STRICT): If the title contains "Junior", "Graduate", "Entry", or similar junior framing BUT the description requires "1+ year", "1-2 years", or any professional experience minimum, cap at 4. This is stricter than the generic title/description contradiction cap — it specifically targets the common case where a "Junior" role is actually a 1-2-year role inaccessible to students. Distinguish clearly: a true entry-level/0-1 years Junior role can score 7+, but a Junior role requiring 1-2 years should NOT exceed 4. Add both "requires 1+ year experience" and "title/description mismatch: Junior but requires experience" to eligibility_flags.

- Cap at 4 (experience exceeds candidate level + title contradiction): If experience_required is "1-2 years" or "2+ years" (i.e. exceeds candidate's level) AND the title implies more junior framing (e.g. "Junior", "Graduate", "Entry") OR the description otherwise contradicts the title, cap at 4. Add both the experience flag and the contradiction flag to eligibility_flags.

- Cap at 4 (professional experience required + student candidate — STRICT): If the posting requires "1+ year of professional experience", "1+ year of relevant experience", "minimum 1 year experience", or similar wording AND the candidate has no listed professional experience, cap at 4 (not 5). The candidate is a student; a hard 1-year professional requirement is a strong disqualifier. Add "requires 1+ year experience" to eligibility_flags. If this overlaps with the Junior-title cap above, the cap remains 4.

- Cap at 5 (ethics/industry interest mismatch): If the role is in an industry that conflicts with the candidate's interests — including gambling, betting, casino, sports betting, gaming-of-chance, iGaming, adult content, defense/weapons, surveillance tech, MLM, predatory fintech, or tobacco — cap at 5. This cap is MANDATORY and applies even if stack, seniority, and location are a perfect match. Add "industry mismatch: <industry>" to eligibility_flags and cite the trigger phrase from the posting in reasoning. Do NOT score gambling/betting/casino/defense roles above 5 under any circumstance unless the candidate criteria explicitly state otherwise.

- Industry-fit penalty (additive, applies even when eligible): For roles in industries that are non-target but not strictly disqualifying — including gambling-adjacent, defense-adjacent, ad-tech, crypto speculation, high-frequency trading, or other industries the candidate would likely deprioritize — subtract 1-2 points from the otherwise-computed score even if the role is technically eligible and within scope. This penalty stacks below the Cap at 5 above: if Cap at 5 applies, use 5; if it does not strictly apply but the industry is still misaligned, apply the -1 to -2 modifier. Add "industry fit concern: <industry>" to eligibility_flags and explain in reasoning.

- Cap at 5 (experience requirement exceeds candidate level — HARD): If`;

const POSTPROCESS_CAP_PATTERNS = [
  /\bhard\s+disqualifier\b/i,
  /\bdisqualifier\b/i,
  /\bUS\s+work\s+authoriz/i,
  /\bW-?2\b/,
  /\b[5-9]\d*\+\s*years?\b/i,        // 5+ years, 8+ years, etc.
  /\bsenior\/lead\s+role\b/i,
  /\bsenior.lead\s+role\b/i,
];

function applyPostProcessingCaps(parsed) {
  const searchText = [
    parsed.reasoning || '',
    ...(parsed.eligibility_flags || []),
  ].join(' ');

  if (POSTPROCESS_CAP_PATTERNS.some(re => re.test(searchText))) {
    return {
      ...parsed,
      match_score: 1,
      eligibility_flags: [
        ...(parsed.eligibility_flags || []),
        'post-processing cap: disqualifier keyword in reasoning/flags',
      ],
    };
  }
  return parsed;
}

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

  const parsed = applyPostProcessingCaps(JSON.parse(textBlock.text.trim()));
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
