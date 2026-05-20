const fs   = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '../logs/scraper_log.json');

class RunLogger {
  constructor() {
    this.timestamp  = new Date().toISOString();
    this.run_id     = `run_${Date.now()}`;
    this._queries   = [];   // { source, query, where?, page?, results, error, retried, retry_outcome }
    this._errors    = [];   // { source, message }
    this._rawTotals = {};   // { jsearch: n, adzuna: n }
  }

  // Called by fetchers for every query attempt
  logQuery({ source, query, where = null, page = null, remoteOnly = null, results, us_filtered = null, passed = null, error = null, retried = false, retry_outcome = null }) {
    this._queries.push({ source, query, where, page, remoteOnly, results, us_filtered, passed, error, retried, retry_outcome });
  }

  // Called by fetchers for fatal-level source errors (not per-query)
  logError({ source, message }) {
    this._errors.push({ source, message });
  }

  // Called by index.js after each source finishes
  logSourceTotal({ source, raw }) {
    this._rawTotals[source] = raw;
  }

  // Build and append log entry to scraper_log.json
  append({ before_dedup, after_dedup, included, excluded, flagged }) {
    const exclusion_breakdown = {};
    excluded.forEach(j => {
      const reason = categorizeExclusion(j._flag_reason || '');
      exclusion_breakdown[reason] = (exclusion_breakdown[reason] || 0) + 1;
    });

    const retries = this._queries.filter(q => q.retried);

    const entry = {
      timestamp: this.timestamp,
      run_id:    this.run_id,
      search_terms: buildSearchTerms(this._queries),
      sources: buildSourceSummary(this._queries, this._rawTotals),
      deduplication: {
        before:             before_dedup,
        after:              after_dedup,
        duplicates_removed: before_dedup - after_dedup,
      },
      location_filter: {
        included,
        excluded: excluded.length,
        flagged_for_review: flagged,
        exclusion_breakdown,
      },
      retries: retries.map(q => ({
        source:        q.source,
        query:         q.query,
        page:          q.page,
        retry_outcome: q.retry_outcome,
      })),
      errors:      this._errors,
      total_saved: included,
    };

    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });

    let log = [];
    if (fs.existsSync(LOG_PATH)) {
      try { log = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); }
      catch { log = []; }
    }

    log.push(entry);
    fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
    return LOG_PATH;
  }
}

function categorizeExclusion(reason) {
  if (/onsite outside berlin/i.test(reason))    return 'onsite_outside_berlin';
  if (/hybrid outside/i.test(reason))           return 'hybrid_outside_region';
  if (/location unclear.*onsite/i.test(reason)) return 'onsite_location_unclear';
  if (/location unclear.*hybrid/i.test(reason)) return 'hybrid_location_unclear';
  return 'other';
}

function buildSearchTerms(queries) {
  const terms = {};
  const seen  = {};
  for (const q of queries) {
    if (!terms[q.source]) { terms[q.source] = []; seen[q.source] = new Set(); }
    const key = q.where ? `${q.query} (in ${q.where})` : q.query;
    if (!seen[q.source].has(key)) { terms[q.source].push(key); seen[q.source].add(key); }
  }
  return terms;
}

function buildSourceSummary(queries, rawTotals) {
  const summary = {};
  for (const q of queries) {
    if (!summary[q.source]) summary[q.source] = { total_raw: rawTotals[q.source] ?? 0, queries: [] };
    summary[q.source].queries.push({
      query:              q.query,
      ...(q.where      !== null && { where:       q.where }),
      ...(q.page       !== null && { page:        q.page }),
      ...(q.remoteOnly !== null && { remote_only: q.remoteOnly }),
      results:            q.results,
      ...(q.us_filtered !== null && { us_filtered: q.us_filtered, passed: q.passed }),
      ...(q.error      !== null && { error: q.error }),
      ...(q.retried               && { retried: true, retry_outcome: q.retry_outcome }),
    });
  }
  // Attach per-source US filter totals for jsearch
  for (const source of Object.keys(summary)) {
    const jsearchQueries = summary[source].queries.filter(q => q.us_filtered != null);
    if (jsearchQueries.length) {
      summary[source].us_filtered_total = jsearchQueries.reduce((s, q) => s + (q.us_filtered || 0), 0);
      summary[source].passed_total      = jsearchQueries.reduce((s, q) => s + (q.passed      || 0), 0);
    }
  }
  return summary;
}

module.exports = { RunLogger };
