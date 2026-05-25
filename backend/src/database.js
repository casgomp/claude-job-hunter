const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH          = path.join(__dirname, '../../backend/data/jobs.db');
const RATINGS_EXPORT   = path.join(__dirname, '../ratings_export.json');

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

    CREATE TABLE IF NOT EXISTS ratings (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id         INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
      eligibility    TEXT CHECK(eligibility IN ('Yes','Maybe','No')),
      technical_fit  INTEGER CHECK(technical_fit BETWEEN 1 AND 5),
      interest_level INTEGER CHECK(interest_level BETWEEN 1 AND 5),
      notes          TEXT,
      rated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status   ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_score    ON jobs(score);
    CREATE INDEX IF NOT EXISTS idx_jobs_url      ON jobs(url);
    CREATE INDEX IF NOT EXISTS idx_jobs_country  ON jobs(country);
    CREATE INDEX IF NOT EXISTS idx_ratings_job   ON ratings(job_id);
  `);
}

const JOBS_WITH_RATINGS_SQL = `
  SELECT j.*,
    r.eligibility    AS rating_eligibility,
    r.technical_fit  AS rating_technical_fit,
    r.interest_level AS rating_interest_level,
    r.notes          AS rating_notes,
    r.rated_at       AS rating_rated_at
  FROM jobs j
  LEFT JOIN ratings r ON r.job_id = j.id
`;

function serializeJob(row) {
  if (!row) return null;
  const job = {
    ...row,
    eligibility_flags: row.eligibility_flags ? JSON.parse(row.eligibility_flags) : [],
    stack:             row.stack             ? JSON.parse(row.stack)             : [],
    cv_generated:      Boolean(row.cv_generated),
    rating: row.rating_rated_at ? {
      eligibility:    row.rating_eligibility,
      technical_fit:  row.rating_technical_fit,
      interest_level: row.rating_interest_level,
      notes:          row.rating_notes,
      rated_at:       row.rating_rated_at,
    } : null,
  };
  delete job.rating_eligibility;
  delete job.rating_technical_fit;
  delete job.rating_interest_level;
  delete job.rating_notes;
  delete job.rating_rated_at;
  return job;
}

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

// ── Ratings ──────────────────────────────────────────────────────────────────

function upsertRating(jobId, { eligibility, technical_fit, interest_level, notes }) {
  const d = getDb();
  d.prepare(`
    INSERT INTO ratings (job_id, eligibility, technical_fit, interest_level, notes, rated_at)
    VALUES (@job_id, @eligibility, @technical_fit, @interest_level, @notes, datetime('now'))
    ON CONFLICT(job_id) DO UPDATE SET
      eligibility    = excluded.eligibility,
      technical_fit  = excluded.technical_fit,
      interest_level = excluded.interest_level,
      notes          = excluded.notes,
      rated_at       = datetime('now')
  `).run({ job_id: jobId, eligibility, technical_fit, interest_level, notes: notes ?? null });
  _writeRatingsExport();
}

function getRatings() {
  return getDb().prepare('SELECT * FROM ratings').all();
}

// Write ratings_export.json keyed by job URL for cross-machine sync
function _writeRatingsExport() {
  const d = getDb();
  const rows = d.prepare(`
    SELECT r.*, j.url AS job_url
    FROM ratings r JOIN jobs j ON j.id = r.job_id
  `).all();
  const exportData = rows.map(r => ({
    job_url:       r.job_url,
    eligibility:   r.eligibility,
    technical_fit: r.technical_fit,
    interest_level:r.interest_level,
    notes:         r.notes,
    rated_at:      r.rated_at,
  }));
  fs.writeFileSync(RATINGS_EXPORT, JSON.stringify(exportData, null, 2));
}

// Import ratings from ratings_export.json; matches jobs by URL
function importRatingsFromFile() {
  if (!fs.existsSync(RATINGS_EXPORT)) return { imported: 0, skipped: 0 };
  const ratings = JSON.parse(fs.readFileSync(RATINGS_EXPORT, 'utf8'));
  const d = getDb();
  let imported = 0, skipped = 0;
  for (const r of ratings) {
    if (!r.job_url) { skipped++; continue; }
    const job = d.prepare('SELECT id FROM jobs WHERE url = ?').get(r.job_url);
    if (!job) { skipped++; continue; }
    d.prepare(`
      INSERT INTO ratings (job_id, eligibility, technical_fit, interest_level, notes, rated_at)
      VALUES (@job_id, @eligibility, @technical_fit, @interest_level, @notes, @rated_at)
      ON CONFLICT(job_id) DO UPDATE SET
        eligibility    = excluded.eligibility,
        technical_fit  = excluded.technical_fit,
        interest_level = excluded.interest_level,
        notes          = excluded.notes,
        rated_at       = excluded.rated_at
    `).run({
      job_id:        job.id,
      eligibility:   r.eligibility   ?? null,
      technical_fit: r.technical_fit ?? null,
      interest_level:r.interest_level?? null,
      notes:         r.notes         ?? null,
      rated_at:      r.rated_at      ?? new Date().toISOString(),
    });
    imported++;
  }
  return { imported, skipped };
}

// ── Queries ───────────────────────────────────────────────────────────────────

function getJobs({ status } = {}) {
  const d = getDb();
  const where  = status ? 'WHERE j.status = ?' : '';
  const params = status ? [status] : [];
  return d.prepare(`
    ${JOBS_WITH_RATINGS_SQL}
    ${where}
    ORDER BY j.score DESC NULLS LAST, j.created_at DESC
  `).all(...params).map(serializeJob);
}

function getJobById(id) {
  return serializeJob(
    getDb().prepare(`${JOBS_WITH_RATINGS_SQL} WHERE j.id = ?`).get(id)
  );
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
  getDb,
  insertJob, updateJobStatus, updateJobScoring, updateCvGenerated,
  upsertRating, getRatings, importRatingsFromFile,
  getJobs, getJobById, jobExistsByUrl,
  insertRun, getRuns,
};
