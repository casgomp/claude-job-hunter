require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const fs           = require('fs');
const { execFile } = require('child_process');

const {
  getJobs, getJobById, updateJobStatus, updateCvGenerated,
  insertJob, insertRun, getRuns,
} = require('./database');
const { generateCv } = require('./cvGenerator');

const app  = express();
const PORT = process.env.PORT || 5000;

const CV_DIR = path.join(__dirname, '../generated_cvs');

app.use(cors());
app.use(express.json());
app.use('/cvs', express.static(CV_DIR));

// ─── Jobs ────────────────────────────────────────────────────────────────────

app.get('/api/jobs', (req, res) => {
  const { status, min_score } = req.query;
  const opts = {};
  if (status) opts.status = status;

  let jobs = getJobs(opts);
  if (min_score) {
    const min = parseInt(min_score, 10);
    jobs = jobs.filter(j => j.score != null && j.score >= min);
  }
  res.json({ count: jobs.length, jobs });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJobById(parseInt(req.params.id, 10));
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.patch('/api/jobs/:id/status', (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status is required' });
  try {
    const changed = updateJobStatus(parseInt(req.params.id, 10), status);
    if (!changed) return res.status(404).json({ error: 'Job not found' });
    res.json({ success: true, id: parseInt(req.params.id, 10), status });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── CV Generator ────────────────────────────────────────────────────────────

app.post('/api/jobs/:id/generate-cv', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const job = getJobById(id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  try {
    const { filename } = await generateCv(job);
    updateCvGenerated(id);
    res.json({ success: true, filename, url: `/cvs/${filename}` });
  } catch (err) {
    console.error('[cv] Generation failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Stats ───────────────────────────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
  const jobs = getJobs();
  const statusBreakdown = {};
  for (const job of jobs) {
    statusBreakdown[job.status] = (statusBreakdown[job.status] || 0) + 1;
  }
  res.json({
    total:            jobs.length,
    status_breakdown: statusBreakdown,
    scrape_running:   scrapeRunning,
  });
});

// ─── Runs ────────────────────────────────────────────────────────────────────

app.get('/api/runs', (req, res) => {
  res.json(getRuns());
});

// ─── Scrape ──────────────────────────────────────────────────────────────────

let scrapeRunning = false;

app.post('/api/scrape', (req, res) => {
  if (scrapeRunning) {
    return res.status(409).json({ error: 'A scrape run is already in progress' });
  }
  scrapeRunning = true;
  res.status(202).json({
    status:  'started',
    message: 'Scrape + score run started. Poll GET /api/runs to see when it completes.',
  });
  runScrapeAndScore()
    .catch(err => console.error('[scrape] run failed:', err.message))
    .finally(() => { scrapeRunning = false; });
});

// ─── Scrape pipeline ─────────────────────────────────────────────────────────

const PROJECT_ROOT     = path.join(__dirname, '../../');
const SCRAPER_SCRIPT   = path.join(PROJECT_ROOT, 'scraper/src/index.js');
const SCORER_SCRIPT    = path.join(__dirname, 'scorer.js');
const SCORED_JOBS_PATH = path.join(__dirname, '../scored_jobs.json');

function spawnStep(script, cwd) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [script], { cwd, timeout: 360_000 }, (err, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (err) reject(new Error(stderr || err.message));
      else resolve();
    });
  });
}

async function runScrapeAndScore() {
  console.log('[scrape] Starting scraper...');
  await spawnStep(SCRAPER_SCRIPT, path.join(PROJECT_ROOT, 'scraper'));

  console.log('[scrape] Starting scorer...');
  await spawnStep(SCORER_SCRIPT, path.join(PROJECT_ROOT, 'backend'));

  console.log('[scrape] Importing results into DB...');
  const scoredJobs = JSON.parse(fs.readFileSync(SCORED_JOBS_PATH, 'utf8'));

  let inserted = 0, skipped = 0;
  for (const job of scoredJobs) {
    insertJob(job) !== null ? inserted++ : skipped++;
  }

  insertRun({
    jobs_scraped: scoredJobs.length,
    jobs_scored:  scoredJobs.filter(j => j.score != null).length,
    tokens_used:  null,
  });

  console.log(`[scrape] Done — ${inserted} new, ${skipped} duplicates`);
}

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
