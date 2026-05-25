const fs   = require('fs');
const path = require('path');

const {
  getDb, insertJob, updateJobScoring, jobExistsByUrl,
} = require('./database');

const SCORED_JOBS_PATH = path.join(__dirname, '../scored_jobs.json');

function run() {
  if (!fs.existsSync(SCORED_JOBS_PATH)) {
    console.error('scored_jobs.json not found at', SCORED_JOBS_PATH);
    process.exit(1);
  }

  const jobs = JSON.parse(fs.readFileSync(SCORED_JOBS_PATH, 'utf8'));
  console.log(`=== Sync: ${jobs.length} jobs in scored_jobs.json ===\n`);

  const db = getDb();
  let inserted = 0;
  let updated  = 0;
  let skipped  = 0;

  for (const job of jobs) {
    if (!job.url) { skipped++; continue; }

    const existing = db.prepare('SELECT id, score FROM jobs WHERE url = ?').get(job.url);

    if (!existing) {
      insertJob(job);
      inserted++;
      console.log(`  + inserted  (${job.score ?? '?'}/10)  ${job.title} @ ${job.company}`);
    } else {
      const newScore = job.match_score ?? job.score ?? null;
      if (newScore !== existing.score) {
        updateJobScoring(existing.id, {
          score:               newScore,
          reasoning:           job.reasoning           ?? null,
          eligibility_flags:   job.eligibility_flags   ?? [],
          highlights:          job.highlights          ?? null,
          stack:               job.stack               ?? [],
          experience_required: job.experience_required ?? null,
          contract_type:       job.contract_type       ?? null,
        });
        updated++;
        console.log(`  ~ updated   (${existing.score ?? '?'} → ${newScore ?? '?'}/10)  ${job.title} @ ${job.company}`);
      } else {
        skipped++;
      }
    }
  }

  console.log(`\n=== Done: ${inserted} inserted, ${updated} updated, ${skipped} unchanged ===`);
}

run();
