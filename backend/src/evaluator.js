require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { getJobs, getRatings, updateJobScoring } = require('./database');
const { scoreJob } = require('./scorer');

const LOG_DIR     = path.join(__dirname, '../logs');
const OUT_PATH    = path.join(LOG_DIR, 'evaluation_report.json');
const SCORER_PATH = path.join(__dirname, 'scorer.js');
const MODEL       = 'claude-opus-4-7';

// Boundary that separates the static preamble (criteria embed) from the
// rewriteable rules section inside scorer.js's SYSTEM_PROMPT template literal.
const RULES_BOUNDARY = '</criteria>\n\n';

const EVAL_SYSTEM_PROMPT = `You are a critical reviewer auditing the output of an automated job-scoring pipeline. The pipeline scores job listings 1–10 for a specific candidate (junior software engineering student, based in Berlin, studying at 42 Berlin, looking for entry-level/Werkstudent/internship roles in Berlin or remote Europe/Japan).

You will receive a JSON list of scored jobs. Each job has: id, title, company, score, source, work_type, country, experience_required, contract_type, eligibility_flags.

Evaluate the scoring for these problems:

1. OBVIOUS ERRORS — jobs that are clearly mis-scored given their content:
   - Senior roles, roles requiring 3+ years experience, or roles requiring security clearance scored above 4
   - Roles that are strongly relevant entry-level Berlin/remote roles scored below 5

2. INCONSISTENCIES — jobs that appear similarly qualified but scored very differently (2+ point gap with no clear justification from the metadata)

3. US-RESTRICTED SLIPPAGE — jobs with eligibility_flags mentioning "US citizen", "clearance", "work authorization" that still scored above 3

4. GERMAN-ONLY SLIPPAGE — jobs that appear to be German-language-only listings scored above 3

5. SOURCE BIAS — if jobs from one source (jsearch/adzuna) are systematically scoring higher or lower than the other without obvious justification

Return a JSON object with exactly these keys:
- overall_quality: "good" | "fair" | "poor"
- confidence: "high" | "medium" | "low" (how reliable are the scores overall)
- summary: 2–3 sentence plain English summary of the scoring quality
- issues: array of objects, each with { job_id, title, company, score, type, description }
  where type is one of: "obvious_error" | "inconsistency" | "us_restricted" | "german_only" | "source_bias"
- recommendations: array of strings — specific improvements to the scoring prompt

Return ONLY valid JSON. No markdown fences, no commentary outside the JSON.`;

const IMPROVE_SYSTEM_PROMPT = `You are improving the rules section of an automated job-scoring prompt. You will receive:
1. The current rules section (the text that appears after the candidate criteria document)
2. A list of specific recommendations from a quality evaluation of recent scoring output

Your task: return an improved version of the rules section that incorporates the recommendations.

Rules for your response:
- Keep all existing rules that are working correctly
- Add, sharpen, or reorder rules to address the recommendations
- Do not alter or remove the output format instructions (the JSON keys section at the end)
- Do not add rules that contradict well-functioning existing behaviour
- Return ONLY the improved rules text — no preamble, no commentary, no code fences
- The text you return will be inserted directly into a JavaScript template literal, so do not include backtick characters`;

// ── Rating gap analysis ──────────────────────────────────────────────────────

// human_score maps (technical_fit 1-5) + (interest_level 1-5) onto a 2-10 scale
// matching Claude's 1-10. Gap > 2 is flagged.
function computeRatingGaps(jobs) {
  const gaps = [];
  for (const job of jobs) {
    const r = job.rating;
    if (!r || r.technical_fit == null || r.interest_level == null) continue;
    if (job.score == null) continue;
    const humanScore = r.technical_fit + r.interest_level;   // 2–10
    const gap        = Math.abs(job.score - humanScore);
    if (gap > 2) {
      gaps.push({
        job_id:       job.id,
        title:        job.title,
        company:      job.company,
        claude_score: job.score,
        human_score:  humanScore,
        gap,
        eligibility:  r.eligibility,
        notes:        r.notes,
      });
    }
  }
  return gaps.sort((a, b) => b.gap - a.gap);
}

// ── Evaluation ──────────────────────────────────────────────────────────────

async function evaluate(client, jobs, ratingGaps) {
  const compact = jobs.map(j => ({
    id:                  j.id,
    title:               j.title,
    company:             j.company,
    score:               j.score,
    source:              j.source,
    work_type:           j.work_type,
    country:             j.country,
    experience_required: j.experience_required,
    contract_type:       j.contract_type,
    eligibility_flags:   j.eligibility_flags,
    human_rating:        j.rating ? {
      eligibility:    j.rating.eligibility,
      technical_fit:  j.rating.technical_fit,
      interest_level: j.rating.interest_level,
    } : null,
  }));

  const gapSection = ratingGaps.length > 0
    ? `\n\nMANUAL RATING GAPS (treat these as primary feedback — these are jobs where a human reviewer's score differs from Claude's by more than 2 points on a 1–10 scale):\n${JSON.stringify(ratingGaps, null, 2)}`
    : '\n\n(No manual rating gaps to report — no jobs have been rated yet.)';

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 3000,
    thinking:   { type: 'adaptive' },
    system: [{ type: 'text', text: EVAL_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role:    'user',
      content: `Here are the ${jobs.length} scored jobs to evaluate:\n\n${JSON.stringify(compact, null, 2)}${gapSection}`,
    }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in evaluation response');
  const raw = textBlock.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(raw);
}

// ── Prompt improvement ──────────────────────────────────────────────────────

function extractCurrentRules() {
  const scorerContent = fs.readFileSync(SCORER_PATH, 'utf8');
  const boundaryIdx   = scorerContent.indexOf(RULES_BOUNDARY);
  if (boundaryIdx === -1) throw new Error(`Cannot find "${RULES_BOUNDARY}" marker in scorer.js`);

  const rulesStart    = boundaryIdx + RULES_BOUNDARY.length;
  const closingIdx    = scorerContent.indexOf('`;\n', rulesStart);
  if (closingIdx === -1) throw new Error('Cannot find closing backtick of SYSTEM_PROMPT in scorer.js');

  return {
    rules:         scorerContent.slice(rulesStart, closingIdx),
    scorerContent,
    rulesStart,
    closingIdx,
  };
}

async function improvePrompt(client, currentRules, recommendations) {
  const recText = recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n');

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 3000,
    system:     IMPROVE_SYSTEM_PROMPT,
    messages: [{
      role:    'user',
      content: `Current rules section:\n\n${currentRules}\n\n---\n\nRecommendations from evaluation:\n${recText}\n\nReturn the improved rules section.`,
    }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in improvement response');
  return textBlock.text.trim();
}

function writeImprovedPrompt(scorerContent, rulesStart, closingIdx, newRules) {
  // Escape backticks so they're safe inside the template literal
  const escaped    = newRules.replace(/`/g, '\\`');
  const newContent = scorerContent.slice(0, rulesStart) + escaped + scorerContent.slice(closingIdx);
  fs.writeFileSync(SCORER_PATH, newContent);
}

// ── Re-score flagged jobs ────────────────────────────────────────────────────

// Issue types that warrant a fresh score (hard caps will apply automatically).
const RESCORE_TYPES = new Set(['us_restricted', 'german_only', 'obvious_error']);

async function rescoreFlaggedJobs(client, jobs, issues) {
  const toRescore = (issues || []).filter(i => RESCORE_TYPES.has(i.type));
  console.log(`[rescore] ${(issues || []).length} total issues → ${toRescore.length} flagged for re-scoring (types: ${[...RESCORE_TYPES].join(', ')})`);
  if (toRescore.length === 0) {
    console.log('[rescore] Nothing to re-score.');
    return 0;
  }

  let count = 0;
  for (const issue of toRescore) {
    console.log(`\n[rescore] --- job_id=${issue.job_id} type=${issue.type} reported_score=${issue.score} ---`);
    console.log(`[rescore]   title:   "${issue.title}" @ ${issue.company}`);

    const job = jobs.find(j => j.id === issue.job_id);
    if (!job) {
      console.warn(`[rescore]   SKIP — job id ${issue.job_id} not found in jobs array`);
      continue;
    }
    console.log(`[rescore]   db score before: ${job.score}`);

    try {
      const jobForScoring = { ...job, _country: job.country, _work_type: job.work_type };
      console.log(`[rescore]   calling scoreJob (_country=${jobForScoring._country}, _work_type=${jobForScoring._work_type})...`);
      const { parsed } = await scoreJob(client, jobForScoring);
      console.log(`[rescore]   scoreJob returned: ${parsed.match_score}/10`);
      console.log(`[rescore]   flags: ${JSON.stringify(parsed.eligibility_flags)}`);

      const changes = updateJobScoring(job.id, {
        score:               parsed.match_score,
        reasoning:           parsed.reasoning,
        eligibility_flags:   parsed.eligibility_flags,
        highlights:          parsed.highlights,
        stack:               parsed.stack,
        experience_required: parsed.experience_required,
        contract_type:       parsed.contract_type,
      });
      console.log(`[rescore]   updateJobScoring rows changed: ${changes}`);
      console.log(`[rescore]   RESULT: ${job.score} → ${parsed.match_score}/10 (db update ${changes > 0 ? 'OK' : 'FAILED — 0 rows changed'})`);
      count++;
    } catch (err) {
      console.error(`[rescore]   ERROR: ${err.message}`);
      console.error(err.stack);
    }
  }
  console.log(`\n[rescore] Done — ${count}/${toRescore.length} jobs successfully re-scored.`);
  return count;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function runEvaluator() {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY not set in .env');

  const jobs = getJobs();
  if (jobs.length === 0) throw new Error('No jobs in database to evaluate');

  const client = new Anthropic({ apiKey });

  // Step 1: compute rating gaps (primary feedback signal)
  const ratingGaps = computeRatingGaps(jobs);
  if (ratingGaps.length > 0) {
    console.log(`[eval] ${ratingGaps.length} manual rating gap(s) found — using as primary feedback`);
    ratingGaps.forEach(g =>
      console.log(`  gap ${g.gap}pt: "${g.title}" @ ${g.company} — Claude ${g.claude_score}/10 vs human ${g.human_score}/10`)
    );
  } else {
    console.log('[eval] No manual ratings yet — proceeding with pattern-only evaluation');
  }

  // Step 2: evaluate
  console.log(`[eval] Evaluating ${jobs.length} scored jobs...`);
  const report = await evaluate(client, jobs, ratingGaps);
  report.generated_at   = new Date().toISOString();
  report.jobs_evaluated = jobs.length;
  report.rating_gaps    = ratingGaps;

  // Step 2: improve scorer prompt
  console.log('[eval] Improving scoring prompt...');
  const { rules: previousRules, scorerContent, rulesStart, closingIdx } = extractCurrentRules();

  const updatedRules = await improvePrompt(client, previousRules, report.recommendations);
  writeImprovedPrompt(scorerContent, rulesStart, closingIdx, updatedRules);
  console.log('[eval] scorer.js updated.');

  // Step 3: re-score flagged jobs with the updated rules now in effect
  const rescored = await rescoreFlaggedJobs(client, jobs, report.issues);
  if (rescored > 0) console.log(`[eval] Re-scored ${rescored} job(s).`);
  report.rescored_count = rescored;

  // Step 4: attach diff to report
  report.prompt_update = {
    previous_rules: previousRules,
    updated_rules:  updatedRules,
  };

  // Step 5: save report
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
  console.log(`[eval] Report saved to ${OUT_PATH}`);

  return report;
}

if (require.main === module) {
  runEvaluator()
    .then(report => {
      console.log(`\nOverall quality: ${report.overall_quality.toUpperCase()}  (confidence: ${report.confidence})`);
      console.log(`Summary: ${report.summary}`);
      if (report.issues?.length) {
        console.log(`\nIssues found (${report.issues.length}):`);
        report.issues.forEach(i =>
          console.log(`  [${i.type}] (${i.score}/10) ${i.title} @ ${i.company} — ${i.description}`)
        );
      } else {
        console.log('\nNo issues found.');
      }
      if (report.recommendations?.length) {
        console.log('\nRecommendations applied to scorer.js:');
        report.recommendations.forEach(r => console.log(`  - ${r}`));
      }
      console.log('\n--- Updated rules section written to scorer.js ---');
    })
    .catch(err => {
      console.error('Fatal:', err.message);
      process.exit(1);
    });
}

module.exports = { runEvaluator };
