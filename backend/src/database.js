const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../backend/data/jobs.db');

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      title           TEXT NOT NULL,
      company         TEXT,
      location        TEXT,
      salary          TEXT,
      description     TEXT,
      url             TEXT UNIQUE NOT NULL,
      date_posted     TEXT,
      source          TEXT,
      tier            INTEGER,
      score           INTEGER,
      reasoning       TEXT,
      eligibility_flags TEXT,
      highlights      TEXT,
      status          TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','saved','rejected','applied')),
      cv_generated    INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS runs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
      jobs_scraped  INTEGER,
      jobs_scored   INTEGER,
      tier_breakdown TEXT,
      tokens_used   INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_tier   ON jobs(tier);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_url    ON jobs(url);
  `);
}

// --- Job helpers ---

function serializeJob(row) {
  if (!row) return null;
  return {
    ...row,
    eligibility_flags: row.eligibility_flags ? JSON.parse(row.eligibility_flags) : [],
    cv_generated: Boolean(row.cv_generated),
  };
}

// Insert a new job. Returns the inserted row id, or null if URL already exists.
function insertJob(job) {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT OR IGNORE INTO jobs
      (title, company, location, salary, description, url, date_posted,
       source, tier, score, reasoning, eligibility_flags, highlights, status, cv_generated)
    VALUES
      (@title, @company, @location, @salary, @description, @url, @date_posted,
       @source, @tier, @score, @reasoning, @eligibility_flags, @highlights, @status, @cv_generated)
  `);
  const result = stmt.run({
    title:             job.title           ?? null,
    company:           job.company         ?? null,
    location:          job.location        ?? null,
    salary:            job.salary          ?? null,
    description:       job.description     ?? null,
    url:               job.url,
    date_posted:       job.date_posted     ?? null,
    source:            job.source          ?? null,
    tier:              job.tier            ?? null,
    score:             job.score           ?? null,
    reasoning:         job.reasoning       ?? null,
    eligibility_flags: Array.isArray(job.eligibility_flags)
                         ? JSON.stringify(job.eligibility_flags)
                         : (job.eligibility_flags ?? null),
    highlights:        job.highlights      ?? null,
    status:            job.status          ?? 'new',
    cv_generated:      job.cv_generated    ? 1 : 0,
  });
  return result.changes > 0 ? result.lastInsertRowid : null;
}

// Update only the status (and updated_at) of a job.
function updateJobStatus(id, status) {
  const d = getDb();
  const valid = ['new', 'saved', 'rejected', 'applied'];
  if (!valid.includes(status)) throw new Error(`Invalid status: ${status}`);
  const stmt = d.prepare(`
    UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?
  `);
  return stmt.run(status, id).changes;
}

// Get all jobs, optionally filtered by tier and/or status.
function getJobs({ tier, status } = {}) {
  const d = getDb();
  const conditions = [];
  const params = [];
  if (tier !== undefined) { conditions.push('tier = ?'); params.push(tier); }
  if (status !== undefined) { conditions.push('status = ?'); params.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = d.prepare(`SELECT * FROM jobs ${where} ORDER BY score DESC, created_at DESC`).all(...params);
  return rows.map(serializeJob);
}

// Get a single job by id.
function getJobById(id) {
  const d = getDb();
  return serializeJob(d.prepare('SELECT * FROM jobs WHERE id = ?').get(id));
}

// Returns true if a job with this URL already exists in the database.
function jobExistsByUrl(url) {
  const d = getDb();
  const row = d.prepare('SELECT 1 FROM jobs WHERE url = ? LIMIT 1').get(url);
  return Boolean(row);
}

// --- Run helpers ---

function insertRun({ jobs_scraped, jobs_scored, tier_breakdown, tokens_used } = {}) {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO runs (jobs_scraped, jobs_scored, tier_breakdown, tokens_used)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(
    jobs_scraped  ?? null,
    jobs_scored   ?? null,
    tier_breakdown ? JSON.stringify(tier_breakdown) : null,
    tokens_used   ?? null,
  );
  return result.lastInsertRowid;
}

function getRuns() {
  const d = getDb();
  return d.prepare('SELECT * FROM runs ORDER BY timestamp DESC').all().map(row => ({
    ...row,
    tier_breakdown: row.tier_breakdown ? JSON.parse(row.tier_breakdown) : null,
  }));
}

module.exports = {
  getDb,
  insertJob,
  updateJobStatus,
  getJobs,
  getJobById,
  jobExistsByUrl,
  insertRun,
  getRuns,
};
