const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOG_PATH = path.join(__dirname, '../logs/scoring_log.json');

class ScoringLogger {
  constructor() {
    this.runId = crypto.randomBytes(4).toString('hex');
    this.queries = [];
    this.errors  = [];
    this.tokens  = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  }

  logJob({ jobTitle, company, tier, score, tokensUsed, error }) {
    this.queries.push({ jobTitle, company, tier: tier ?? null, score: score ?? null, tokensUsed: tokensUsed ?? null, error: error ?? null });
    if (tokensUsed) {
      this.tokens.input       += tokensUsed.input_tokens       || 0;
      this.tokens.output      += tokensUsed.output_tokens      || 0;
      this.tokens.cache_read  += tokensUsed.cache_read_input_tokens  || 0;
      this.tokens.cache_write += tokensUsed.cache_creation_input_tokens || 0;
    }
  }

  logError({ message }) {
    this.errors.push({ message });
  }

  append({ totalJobs, tierBreakdown, selfEval }) {
    const logsDir = path.dirname(LOG_PATH);
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    const existing = fs.existsSync(LOG_PATH)
      ? JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'))
      : [];

    const entry = {
      timestamp:     new Date().toISOString(),
      run_id:        this.runId,
      total_jobs:    totalJobs,
      tier_breakdown: tierBreakdown,
      tokens:        this.tokens,
      errors:        this.errors,
      self_eval:     selfEval ?? null,
      jobs:          this.queries,
    };

    existing.push(entry);
    fs.writeFileSync(LOG_PATH, JSON.stringify(existing, null, 2));
    return LOG_PATH;
  }
}

module.exports = { ScoringLogger };
