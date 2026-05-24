const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../backend/data/jobs.db');

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
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      title               TEXT NOT NULL,
      company             TEXT,
      location            TEXT,
      salary              TEXT,
      description         TEXT,
      url                 TEXT UNIQUE NOT NULL,
      date_posted         TEXT,
      source              TEXT,
      work_type           TEXT,
      country             TEXT,
      score               INTEGER,
      reasoning           TEXT,
      eligibility_flags   TEXT,
      highlights          TEXT,
      stack               TEXT,
      experience_required TEXT,
      contract_type       TEXT,
      status              TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','saved','rejected','applied')),
      cv_generated        INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS runs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp    TEXT NOT NULL DEFAULT (datetime('now')),
      jobs_scraped INTEGER,
      jobs_scored  INTEGER,
      tokens_used  INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status   ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_score    ON jobs(score);
    CREATE INDEX IF NOT EXISTS idx_jobs_url      ON jobs(url);
    CREATE INDEX IF NOT EXISTS idx_jobs_country  ON jobs(country);
  `);
}

function serializeJob(row) {
  if (!row) return null;
  return {
    ...row,
    eligibility_flags: row.eligibility_flags ? JSON.parse(row.eligibility_flags) : [],
    stack:             row.stack             ? JSON.parse(row.stack)             : [],
    cv_generated:      Boolean(row.cv_generated),
  };
}

// Insert a new job. Returns the inserted row id, or null if URL already exists.
function insertJob(job) {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT OR IGNORE INTO jobs
      (title, company, location, salary, description, url, date_posted,
       source, work_type, country, score, reasoning, eligibility_flags,
       highlights, stack, experience_required, contract_type, status, cv_generated)
    VALUES
      (@title, @company, @location, @salary, @description, @url, @date_posted,
       @source, @work_type, @country, @score, @reasoning, @eligibility_flags,
       @highlights, @stack, @experience_required, @contract_type, @status, @cv_generated)
  `);
  const result = stmt.run({
    title:               job.title               ?? null,
    company:             job.company             ?? null,
    location:            job.location            ?? null,
    salary:              job.salary              ?? null,
    description:         job.description         ?? null,
    url:                 job.url,
    date_posted:         job.date_posted         ?? null,
    source:              job.source              ?? null,
    work_type:           job._work_type          ?? job.work_type ?? null,
    country:             job._country            ?? job.country   ?? null,
    // support both old (score) and new (match_score) scorer output formats
    score:               job.match_score         ?? job.score     ?? null,
    reasoning:           job.reasoning           ?? null,
    eligibility_flags:   Array.isArray(job.eligibility_flags)
                           ? JSON.stringify(job.eligibility_flags)
                           : (job.eligibility_flags ?? null),
    highlights:          job.highlights          ?? null,
    stack:               Array.isArray(job.stack)
                           ? JSON.stringify(job.stack)
                           : (job.stack ?? null),
    experience_required: job.experience_required ?? null,
    contract_type:       job.contract_type       ?? null,
    status:              job.status              ?? 'new',
    cv_generated:        job.cv_generated        ? 1 : 0,
  });
  return result.changes > 0 ? result.lastInsertRowid : null;
}

function updateJobScoring(id, { score, reasoning, eligibility_flags, highlights, stack, experience_required, contract_type }) {
  const d = getDb();
  return d.prepare(`
    UPDATE jobs SET
      score               = @score,
      reasoning           = @reasoning,
      eligibility_flags   = @eligibility_flags,
      highlights          = @highlights,
      stack               = @stack,
      experience_required = @experience_required,
      contract_type       = @contract_type,
      updated_at          = datetime('now')
    WHERE id = @id
  `).run({
    id,
    score:               score               ?? null,
    reasoning:           reasoning           ?? null,
    eligibility_flags:   Array.isArray(eligibility_flags) ? JSON.stringify(eligibility_flags) : null,
    highlights:          highlights          ?? null,
    stack:               Array.isArray(stack) ? JSON.stringify(stack) : null,
    experience_required: experience_required ?? null,
    contract_type:       contract_type       ?? null,
  }).changes;
}

function updateCvGenerated(id) {
  return getDb()
    .prepare(`UPDATE jobs SET cv_generated = 1, updated_at = datetime('now') WHERE id = ?`)
    .run(id).changes;
}

function updateJobStatus(id, status) {
  const d = getDb();
  const valid = ['new', 'saved', 'rejected', 'applied'];
  if (!valid.includes(status)) throw new Error(`Invalid status: ${status}`);
  return d.prepare(`UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, id).changes;
}

function getJobs({ status } = {}) {
  const d = getDb();
  const conditions = [];
  const params = [];
  if (status !== undefined) { conditions.push('status = ?'); params.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return d.prepare(`SELECT * FROM jobs ${where} ORDER BY score DESC NULLS LAST, created_at DESC`)
    .all(...params)
    .map(serializeJob);
}

function getJobById(id) {
  return serializeJob(getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id));
}

function jobExistsByUrl(url) {
  return Boolean(getDb().prepare('SELECT 1 FROM jobs WHERE url = ? LIMIT 1').get(url));
}

function insertRun({ jobs_scraped, jobs_scored, tokens_used } = {}) {
  const result = getDb()
    .prepare('INSERT INTO runs (jobs_scraped, jobs_scored, tokens_used) VALUES (?, ?, ?)')
    .run(jobs_scraped ?? null, jobs_scored ?? null, tokens_used ?? null);
  return result.lastInsertRowid;
}

function getRuns() {
  return getDb().prepare('SELECT * FROM runs ORDER BY timestamp DESC').all();
}

module.exports = {
  getDb, insertJob, updateJobStatus, updateJobScoring, updateCvGenerated,
  getJobs, getJobById, jobExistsByUrl, insertRun, getRuns,
};
