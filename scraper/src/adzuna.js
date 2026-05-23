const axios = require('axios');

// Germany queries
const DE_QUERIES = [
  { what: 'junior developer',          pages: 2, country: 'de' },
  { what: 'junior engineer',           pages: 2, country: 'de' },
  { what: 'Werkstudent software',      pages: 2, country: 'de' },
  { what: 'junior developer',          pages: 2, country: 'de', where: 'Berlin' },
  { what: 'entry level developer',     pages: 1, country: 'de' },
  { what: 'software developer intern', pages: 1, country: 'de' },
];

// Note: Adzuna's /jp/ endpoint returns 0 results for all tested queries — Japan
// coverage is handled via JSearch only.

const ALL_QUERIES = [...DE_QUERIES];

const RESULTS_PER_PAGE = 50;
const RETRY_DELAY_MS   = 3000;

// For Japan: exclude roles explicitly requiring > 1 year of experience
function requiresMoreThanOneYear(job) {
  const text = `${job.title || ''} ${job.description || ''}`;
  const matches = [...text.matchAll(/(\d+)\s*\+?\s*(?:year|yr)s?\s*(?:of\s+)?(?:relevant\s+|professional\s+)?experience/gi)];
  return matches.some(m => parseInt(m[1], 10) > 1);
}

async function fetchAdzuna(logger) {
  const appId  = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) throw new Error('ADZUNA_APP_ID or ADZUNA_APP_KEY not set in .env');

  const jobs = [];

  for (const { what, pages, country, where } of ALL_QUERIES) {
    const isJapan = country === 'jp';

    for (let page = 1; page <= pages; page++) {
      await sleep(500);
      const results = await fetchPage({ appId, appKey, what, where, page, country });

      if (results === null) {
        console.warn(`  [adzuna/${country}] "${what}" p${page} timed out, retrying...`);
        await sleep(RETRY_DELAY_MS);
        const retry = await fetchPage({ appId, appKey, what, where, page, country });

        if (retry !== null) {
          const kept = isJapan ? retry.filter(j => !requiresMoreThanOneYear(j)) : retry;
          jobs.push(...kept.map(j => normalize(j, isJapan)));
          logger.logQuery({ source: 'adzuna', query: what, where: where || null, page, results: kept.length, error: 'timeout', retried: true, retry_outcome: 'success' });
          console.log(`  [adzuna/${country}] "${what}"${where ? ` in ${where}` : ''} p${page} (retry): ${kept.length} results`);
          if (retry.length < RESULTS_PER_PAGE) break;
        } else {
          logger.logQuery({ source: 'adzuna', query: what, where: where || null, page, results: 0, error: 'timeout', retried: true, retry_outcome: 'failed' });
          logger.logError({ source: 'adzuna', message: `"${what}" p${page} timed out after retry — skipped` });
          console.warn(`  [adzuna/${country}] "${what}" p${page} retry also failed — skipping`);
        }
      } else {
        const kept = isJapan ? results.filter(j => !requiresMoreThanOneYear(j)) : results;
        jobs.push(...kept.map(j => normalize(j, isJapan)));
        logger.logQuery({ source: 'adzuna', query: what, where: where || null, page, results: kept.length });
        console.log(`  [adzuna/${country}] "${what}"${where ? ` in ${where}` : ''} p${page}: ${kept.length} results`);
        if (results.length < RESULTS_PER_PAGE) break;
      }
    }
  }

  return jobs;
}

async function fetchPage({ appId, appKey, what, where, page, country }) {
  try {
    const params = {
      app_id:           appId,
      app_key:          appKey,
      results_per_page: RESULTS_PER_PAGE,
      what,
      max_days_old:     30,
      sort_by:          'date',
    };
    if (where) params.where = where;

    const response = await axios.get(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}`, {
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

function normalize(job, isJapan = false) {
  const salaryMin = job.salary_min;
  const salaryMax = job.salary_max;
  const currency  = isJapan ? 'JPY / year' : 'EUR / year';
  const salary    = salaryMin || salaryMax
    ? `${salaryMin ?? '?'} - ${salaryMax ?? '?'} ${currency}`
    : null;

  const fullText = `${job.title || ''} ${job.description || ''}`.toLowerCase();
  const isRemote = /\bfully remote\b/.test(fullText) ||
    (/\bremote\b/.test(fullText) && !/\bhybrid\b/.test(fullText));

  return {
    title:       job.title                    || null,
    company:     job.company?.display_name    || null,
    location:    job.location?.display_name   || null,
    salary,
    description: job.description              || null,
    url:         job.redirect_url             || null,
    date_posted: job.created                  || null,
    source:      'adzuna',
    _is_remote:  isRemote,
    _raw_id:     job.id,
    _country:    isJapan ? 'Japan' : null,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { fetchAdzuna };
