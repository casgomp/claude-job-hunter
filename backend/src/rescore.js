require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const Anthropic = require('@anthropic-ai/sdk');
const { getJobs, updateJobScoring } = require('./database');
const { scoreJob } = require('./scorer');

const BATCH_SIZE       = 5;
const INTER_CALL_DELAY = 1500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('=== Rescore existing jobs ===\n');

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY not set in .env');

  const client = new Anthropic({ apiKey });

  const jobs = getJobs();
  console.log(`Found ${jobs.length} jobs in DB\n`);

  let updated = 0;
  let errors  = 0;

  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);
    console.log(`--- Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(jobs.length / BATCH_SIZE)} ---`);

    for (const job of batch) {
      await sleep(INTER_CALL_DELAY);
      // Map DB field names to what scoreJob expects
      const jobInput = {
        ...job,
        _country:   job.country,
        _work_type: job.work_type,
      };
      try {
        const { parsed } = await scoreJob(client, jobInput);
        updateJobScoring(job.id, {
          score:               parsed.match_score,
          reasoning:           parsed.reasoning,
          eligibility_flags:   parsed.eligibility_flags,
          highlights:          parsed.highlights,
          stack:               parsed.stack,
          experience_required: parsed.experience_required,
          contract_type:       parsed.contract_type,
        });
        const flags = parsed.eligibility_flags?.length ? ` [!${parsed.eligibility_flags.length}]` : '';
        console.log(`  (${parsed.match_score}/10)${flags}  ${job.title} @ ${job.company}`);
        updated++;
      } catch (err) {
        console.warn(`  ERROR: ${job.title} @ ${job.company} — ${err.message}`);
        errors++;
      }
    }
  }

  console.log(`\n=== Done: ${updated} updated, ${errors} errors ===`);
}

run().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
