const fs   = require('fs');
const path = require('path');

const {
  getDb, insertJob, updateJobScoring, importRatingsFromFile,
} = require('./database');

const SCORED_JOBS_PATH = path.join(__dirname, '../scored_jobs.json');

function run() {
  if (!fs.existsSync(SCORED_JOBS_PATH)) {
    console.error('scored_jobs.json not found at', SCORED_JOBS_PATH);
    process.exit(1);
  }

  // ── Sync jobs ───────────────────────────────────────────────────────────────
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

  console.log(`\n  Jobs: ${inserted} inserted, ${updated} updated, ${skipped} unchanged`);

  // ── Remove stale jobs ───────────────────────────────────────────────────────
  // Any job in the DB whose URL is not in scored_jobs.json was excluded by the
  // scraper filters — delete it to keep the DB in sync.
  const currentUrls = new Set(jobs.filter(j => j.url).map(j => j.url));
  const dbJobs      = db.prepare('SELECT id, title, company, score, url FROM jobs').all();
  const stale       = dbJobs.filter(j => !currentUrls.has(j.url));

  if (stale.length > 0) {
    // Warn if any stale jobs have ratings (ratings are cascade-deleted with the job)
    const staleWithRatings = stale.filter(j =>
      db.prepare('SELECT 1 FROM ratings WHERE job_id = ?').get(j.id)
    );
    if (staleWithRatings.length > 0) {
      console.warn(`\n  WARNING: ${staleWithRatings.length} stale job(s) have ratings that will be deleted:`);
      staleWithRatings.forEach(j => console.warn(`    ⚠ ${j.title} @ ${j.company}`));
    }

    console.log(`\n  Removing ${stale.length} stale job(s) no longer in scored_jobs.json:`);
    const del = db.prepare('DELETE FROM jobs WHERE id = ?');
    const deleteAll = db.transaction(() => stale.forEach(j => del.run(j.id)));
    deleteAll();
    stale.forEach(j => console.log(`  - removed   (${j.score ?? '?'}/10)  ${j.title} @ ${j.company}`));
  } else {
    console.log('  No stale jobs to remove.');
  }

  // ── Sync ratings ────────────────────────────────────────────────────────────
  const { imported: ri, skipped: rs } = importRatingsFromFile();
  if (ri > 0 || rs > 0) {
    console.log(`  Ratings: ${ri} imported, ${rs} skipped (job not found locally)`);
  } else {
    console.log('  Ratings: no ratings_export.json found, skipping');
  }

  console.log('\n=== Sync complete ===');
}

run();
