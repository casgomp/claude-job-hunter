require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs   = require('fs');
const path = require('path');
const { fetchJSearch } = require('./jsearch');
const { fetchAdzuna }  = require('./adzuna');
const { normalizeAndDeduplicate } = require('./utils');
const { RunLogger } = require('./logger');

async function run() {
  console.log('=== Job Scraper ===\n');

  const logger = new RunLogger();

  console.log('Fetching from JSearch...');
  let jsearchJobs = [];
  try {
    jsearchJobs = await fetchJSearch(logger);
  } catch (err) {
    console.error('JSearch failed:', err.message);
    logger.logError({ source: 'jsearch', message: err.message });
  }
  logger.logSourceTotal({ source: 'jsearch', raw: jsearchJobs.length });

  console.log('\nFetching from Adzuna...');
  let adzunaJobs = [];
  try {
    adzunaJobs = await fetchAdzuna(logger);
  } catch (err) {
    console.error('Adzuna failed:', err.message);
    logger.logError({ source: 'adzuna', message: err.message });
  }
  logger.logSourceTotal({ source: 'adzuna', raw: adzunaJobs.length });

  const rawTotal = jsearchJobs.length + adzunaJobs.length;

  console.log(`\n--- Raw results (after US filter for JSearch) ---`);
  console.log(`  JSearch:  ${jsearchJobs.length}`);
  console.log(`  Adzuna:   ${adzunaJobs.length}`);
  console.log(`  Combined: ${rawTotal}`);

  const allJobs = normalizeAndDeduplicate([...jsearchJobs, ...adzunaJobs]);

  const locationIncluded = allJobs.filter(j => !j._location_excluded);
  const excluded         = allJobs.filter(j => j._location_excluded);
  const germanOnly       = locationIncluded.filter(j => j._german_only);
  const included         = locationIncluded.filter(j => !j._german_only);
  const flagged          = included.filter(j => j._location_flagged);

  console.log(`\n--- After deduplication: ${allJobs.length} unique jobs ---`);
  console.log(`\n--- Location filtering ---`);
  console.log(`  Included:         ${included.length}`);
  console.log(`  Excluded:         ${excluded.length}`);
  console.log(`  German-only (excluded): ${germanOnly.length}`);
  console.log(`  Flagged (review): ${flagged.length}`);

  if (germanOnly.length > 0) {
    console.log(`\n--- German-only listings (excluded) ---`);
    germanOnly.forEach(j => console.log(`  ${j.title} @ ${j.company}`));
  }

  const jsearchFinal = included.filter(j => j.source === 'jsearch').length;
  const adzunaFinal  = included.filter(j => j.source === 'adzuna').length;

  console.log(`\n--- Final results by source ---`);
  console.log(`  JSearch: ${jsearchFinal}`);
  console.log(`  Adzuna:  ${adzunaFinal}`);
  console.log(`  Total:   ${included.length}`);

  const outputPath = path.join(__dirname, '../raw_jobs.json');
  fs.writeFileSync(outputPath, JSON.stringify(included, null, 2));
  console.log(`\nSaved to scraper/raw_jobs.json`);

  if (flagged.length > 0) {
    console.log(`\n--- Flagged for manual review ---`);
    flagged.forEach(j => console.log(`  [${j._work_type}] ${j.title} @ ${j.company} — ${j._flag_reason}`));
  }

  const logPath = logger.append({
    before_dedup: rawTotal,
    after_dedup:  allJobs.length,
    included:     included.length,
    excluded,
    flagged:      flagged.length,
  });
  console.log(`Logged to ${path.relative(process.cwd(), logPath)}`);
}

run().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
