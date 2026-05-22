const path = require('path');
const fs = require('fs');
const { insertJob, getJobs, getJobById } = require('./database');

const SCORED_JOBS_PATH = path.join(__dirname, '../../backend/scored_jobs.json');

function migrate() {
  if (!fs.existsSync(SCORED_JOBS_PATH)) {
    console.error(`scored_jobs.json not found at: ${SCORED_JOBS_PATH}`);
    process.exit(1);
  }

  const jobs = JSON.parse(fs.readFileSync(SCORED_JOBS_PATH, 'utf8'));
  console.log(`Found ${jobs.length} jobs in scored_jobs.json`);

  let inserted = 0;
  let skipped = 0;

  for (const job of jobs) {
    const id = insertJob(job);
    if (id !== null) {
      inserted++;
    } else {
      skipped++;
    }
  }

  console.log(`\nMigration complete:`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped (duplicates): ${skipped}`);

  // Show total count per tier
  const all = getJobs();
  const tierCounts = all.reduce((acc, j) => {
    acc[j.tier] = (acc[j.tier] || 0) + 1;
    return acc;
  }, {});
  console.log(`\nTotal in DB: ${all.length}`);
  console.log('Tier breakdown:', tierCounts);

  // Show a sample record (highest-scored job)
  const sample = all[0];
  if (sample) {
    console.log('\nSample record (highest score):');
    console.log({
      id:               sample.id,
      title:            sample.title,
      company:          sample.company,
      location:         sample.location,
      tier:             sample.tier,
      score:            sample.score,
      status:           sample.status,
      cv_generated:     sample.cv_generated,
      eligibility_flags: sample.eligibility_flags,
      created_at:       sample.created_at,
    });
  }
}

migrate();
