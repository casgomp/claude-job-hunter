require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { getJobs } = require('./database');

const LOG_DIR  = path.join(__dirname, '../logs');
const OUT_PATH = path.join(LOG_DIR, 'evaluation_report.json');
const MODEL    = 'claude-opus-4-7';

const SYSTEM_PROMPT = `You are a critical reviewer auditing the output of an automated job-scoring pipeline. The pipeline scores job listings 1–10 for a specific candidate (junior software engineering student, based in Berlin, studying at 42 Berlin, looking for entry-level/Werkstudent/internship roles in Berlin or remote Europe/Japan).

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

async function runEvaluator() {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY not set in .env');

  const jobs = getJobs();
  if (jobs.length === 0) throw new Error('No jobs in database to evaluate');

  console.log(`[eval] Evaluating ${jobs.length} scored jobs...`);

  // Compact representation — only the fields needed for evaluation
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
  }));

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 3000,
    thinking:   { type: 'adaptive' },
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role:    'user',
        content: `Here are the ${jobs.length} scored jobs to evaluate:\n\n${JSON.stringify(compact, null, 2)}`,
      },
    ],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in Claude response');

  const report = JSON.parse(textBlock.text.trim());
  report.generated_at = new Date().toISOString();
  report.jobs_evaluated = jobs.length;

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
      if (report.issues.length) {
        console.log(`\nIssues found (${report.issues.length}):`);
        report.issues.forEach(i =>
          console.log(`  [${i.type}] (${i.score}/10) ${i.title} @ ${i.company} — ${i.description}`)
        );
      } else {
        console.log('\nNo issues found.');
      }
      if (report.recommendations.length) {
        console.log('\nRecommendations:');
        report.recommendations.forEach(r => console.log(`  - ${r}`));
      }
    })
    .catch(err => {
      console.error('Fatal:', err.message);
      process.exit(1);
    });
}

module.exports = { runEvaluator };
