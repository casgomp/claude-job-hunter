const path = require('path');
const fs   = require('fs');

// Delete existing DB so the new schema is applied cleanly
const DB_PATH = path.join(__dirname, '../../backend/data/jobs.db');
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
  console.log('Deleted existing jobs.db — recreating with updated schema');
}

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
  let skipped  = 0;

  for (const job of jobs) {
    insertJob(job) !== null ? inserted++ : skipped++;
  }

  console.log(`\nMigration complete:`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped (duplicates): ${skipped}`);

  const all = getJobs();
  console.log(`\nTotal in DB: ${all.length}`);

  const sample = all[0];
  if (sample) {
    console.log('\nSample record (highest score):');
    console.log({
      id:                  sample.id,
      title:               sample.title,
      company:             sample.company,
      score:               sample.score,
      work_type:           sample.work_type,
      country:             sample.country,
      experience_required: sample.experience_required,
      contract_type:       sample.contract_type,
      stack:               sample.stack,
      status:              sample.status,
      created_at:          sample.created_at,
    });
  }
}

migrate();
