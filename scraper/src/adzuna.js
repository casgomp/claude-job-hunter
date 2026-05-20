const axios = require('axios');

// Queries tuned for German Adzuna coverage — broader terms yield more results.
// No `where` filter: location filtering is applied downstream per criteria.md.
const QUERIES = [
  { what: 'junior developer',        pages: 2 },
  { what: 'junior engineer',         pages: 2 },
  { what: 'Werkstudent software',    pages: 2 },
  { what: 'junior developer',        pages: 2, where: 'Berlin' },
  { what: 'entry level developer',   pages: 1 },
  { what: 'software developer intern', pages: 1 },
];

const RESULTS_PER_PAGE = 50;
const RETRY_DELAY_MS   = 3000;

async function fetchAdzuna(logger) {
  const appId  = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) throw new Error('ADZUNA_APP_ID or ADZUNA_APP_KEY not set in .env');

  const jobs = [];

  for (const { what, pages, where } of QUERIES) {
    for (let page = 1; page <= pages; page++) {
      await sleep(500);
      const results = await fetchPage({ appId, appKey, what, where, page });

      if (results === null) {
        // timed out — retry once after a short back-off
        console.warn(`  [adzuna] "${what}" p${page} timed out, retrying...`);
        await sleep(RETRY_DELAY_MS);
        const retry = await fetchPage({ appId, appKey, what, where, page });

        if (retry !== null) {
          jobs.push(...retry.map(normalize));
          logger.logQuery({ source: 'adzuna', query: what, where: where || null, page, results: retry.length, error: 'timeout', retried: true, retry_outcome: 'success' });
          console.log(`  [adzuna] "${what}"${where ? ` in ${where}` : ''} p${page} (retry): ${retry.length} results`);
          if (retry.length < RESULTS_PER_PAGE) break;
        } else {
          logger.logQuery({ source: 'adzuna', query: what, where: where || null, page, results: 0, error: 'timeout', retried: true, retry_outcome: 'failed' });
          logger.logError({ source: 'adzuna', message: `"${what}" p${page} timed out after retry — skipped` });
          console.warn(`  [adzuna] "${what}" p${page} retry also failed — skipping`);
        }
      } else {
        jobs.push(...results.map(normalize));
        logger.logQuery({ source: 'adzuna', query: what, where: where || null, page, results: results.length });
        console.log(`  [adzuna] "${what}"${where ? ` in ${where}` : ''} p${page}: ${results.length} results`);
        if (results.length < RESULTS_PER_PAGE) break;
      }
    }
  }

  return jobs;
}

async function fetchPage({ appId, appKey, what, where, page }) {
  try {
    const params = {
      app_id: appId,
      app_key: appKey,
      results_per_page: RESULTS_PER_PAGE,
      what,
      max_days_old: 30,
      sort_by: 'date',
    };
    if (where) params.where = where;

    const response = await axios.get(`https://api.adzuna.com/v1/api/jobs/de/search/${page}`, {
      params,
      timeout: 15000,
    });
    return response.data?.results || [];
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) return null;
    const status = err.response?.status;
    console.warn(`  [adzuna] HTTP ${status ?? err.message}`);
    return [];
  }
}

function normalize(job) {
  const salaryMin = job.salary_min;
  const salaryMax = job.salary_max;
  const salary = salaryMin || salaryMax
    ? `${salaryMin ?? '?'} - ${salaryMax ?? '?'} EUR / year`
    : null;

  const fullText = `${job.title || ''} ${job.description || ''}`.toLowerCase();
  const isRemote = /\bfully remote\b/.test(fullText) ||
    (/\bremote\b/.test(fullText) && !/\bhybrid\b/.test(fullText));

  return {
    title:       job.title || null,
    company:     job.company?.display_name || null,
    location:    job.location?.display_name || null,
    salary,
    description: job.description || null,
    url:         job.redirect_url || null,
    date_posted: job.created || null,
    source:      'adzuna',
    _is_remote:  isRemote,
    _raw_id:     job.id,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { fetchAdzuna };
