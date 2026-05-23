const axios = require('axios');

const QUERIES = [
  // ── Europe / Germany ────────────────────────────────────────────────────────
  { query: 'junior software developer remote Germany',  remoteOnly: true  },
  { query: 'junior backend developer remote Europe',    remoteOnly: true  },
  { query: 'entry level developer remote Berlin',       remoteOnly: true  },
  { query: 'junior software developer Berlin',          remoteOnly: false },
  { query: 'software developer intern Berlin Germany',  remoteOnly: false },
  // ── Japan (entry-level / English-language) ──────────────────────────────────
  { query: 'junior software developer Tokyo English',   remoteOnly: false, isJapan: true },
  { query: 'junior backend developer Tokyo',            remoteOnly: false, isJapan: true },
  { query: 'software engineer intern Tokyo English',    remoteOnly: false, isJapan: true },
];

// Patterns that indicate a role is restricted to US citizens/residents.
const US_EXCLUSION_PATTERNS = [
  /\bus\.?\s*citizen(ship)?\b/i,
  /united\s+states\s+citizen/i,
  /security\s+clearance/i,
  /\b(secret|top\s+secret|ts\s*\/\s*sci)\b/i,
  /\bactive\s+clearance\b/i,
  /\bdod\s+(clearance|secret|approved)/i,
  /us\s+work\s+authoriz/i,
  /authorized\s+to\s+work\s+in\s+the\s+(us|u\.s\.|united\s+states)/i,
  /must\s+be\s+(a\s+)?(us|u\.s\.)\s*(person|citizen|national)/i,
  /\bitr?ar\b/i,
  /\bpolygraph\s+required\b/i,
];

const US_RATE_WARNING_THRESHOLD = 0.7;

function isUsOnly(job) {
  const text = `${job.job_title || ''} ${job.job_description || ''}`;
  return US_EXCLUSION_PATTERNS.some(re => re.test(text));
}

// For Japan queries: exclude roles explicitly requiring > 1 year of experience.
function requiresMoreThanOneYear(job) {
  const text = `${job.job_title || ''} ${job.job_description || ''}`;
  const matches = [...text.matchAll(/(\d+)\s*\+?\s*(?:year|yr)s?\s*(?:of\s+)?(?:relevant\s+|professional\s+)?experience/gi)];
  return matches.some(m => parseInt(m[1], 10) > 1);
}

async function fetchJSearch(logger) {
  const apiKey = process.env.JSEARCH_API_KEY;
  if (!apiKey) throw new Error('JSEARCH_API_KEY not set in .env');

  const jobs = [];
  let totalRaw = 0;
  let totalFiltered = 0;

  for (const { query, remoteOnly, isJapan } of QUERIES) {
    await sleep(400);
    try {
      const response = await axios.get('https://jsearch.p.rapidapi.com/search', {
        headers: {
          'X-RapidAPI-Key':  apiKey,
          'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
        },
        params: {
          query,
          page:              1,
          num_pages:         1,
          date_posted:       'month',
          remote_jobs_only:  remoteOnly ? 'true' : 'false',
        },
        timeout: 12000,
      });

      const raw = response.data?.data || [];

      let passed;
      if (isJapan) {
        // Accept jobs located in Japan (country=JP) or where city/location contains
        // Tokyo/Osaka. Exclude US-restricted and roles requiring >1 yr experience.
        passed = raw.filter(j => {
          const countryOk = j.job_country === 'JP' ||
            ['tokyo', 'osaka'].some(c => (j.job_city || '').toLowerCase().includes(c)) ||
            ['tokyo', 'osaka'].some(c => (j.job_state || '').toLowerCase().includes(c));
          return countryOk && !isUsOnly(j) && !requiresMoreThanOneYear(j);
        });
      } else {
        passed = raw.filter(j => !isUsOnly(j));
      }

      const filteredCount = raw.length - passed.length;
      totalRaw      += raw.length;
      totalFiltered += filteredCount;

      jobs.push(...passed.map(j => normalize(j, remoteOnly, isJapan)));

      logger.logQuery({
        source: 'jsearch', query, remoteOnly,
        results: raw.length, us_filtered: filteredCount, passed: passed.length,
      });
      console.log(`  [jsearch] "${query}" (remote=${remoteOnly}${isJapan ? ',JP' : ''}): ${raw.length} raw, ${filteredCount} filtered, ${passed.length} kept`);
    } catch (err) {
      const status  = err.response?.status;
      const message = status ? `HTTP ${status}` : err.message;
      logger.logQuery({ source: 'jsearch', query, remoteOnly, results: 0, error: message });
      console.warn(`  [jsearch] "${query}" failed: ${message}`);
    }
  }

  if (totalRaw > 0) {
    const usRate = totalFiltered / totalRaw;
    if (usRate >= US_RATE_WARNING_THRESHOLD) {
      const pct     = Math.round(usRate * 100);
      const warning = `JSearch returned ${pct}% filtered results (${totalFiltered}/${totalRaw}).`;
      console.warn(`\n  [jsearch] WARNING: ${warning}`);
      logger.logError({ source: 'jsearch', message: warning });
    }
  }

  return jobs;
}

function normalize(job, remoteOnly, isJapan = false) {
  const salaryParts = [];
  if (job.job_min_salary) salaryParts.push(String(job.job_min_salary));
  if (job.job_max_salary) salaryParts.push(String(job.job_max_salary));
  const salary = salaryParts.length
    ? `${salaryParts.join(' - ')} ${job.job_salary_currency || ''} ${job.job_salary_period || ''}`.trim()
    : null;

  const locationParts = [job.job_city, job.job_state, job.job_country].filter(Boolean);
  const location = job.job_is_remote
    ? `Remote (${locationParts.join(', ')})`
    : locationParts.join(', ');

  const country = isJapan
    ? 'Japan'
    : job.job_country === 'DE' ? 'Germany'
    : job.job_country         ? job.job_country
    : null;

  return {
    title:       job.job_title       || null,
    company:     job.employer_name   || null,
    location,
    salary,
    description: job.job_description || null,
    url:         job.job_apply_link  || null,
    date_posted: job.job_posted_at_datetime_utc || null,
    source:      'jsearch',
    _is_remote:  remoteOnly || job.job_is_remote || false,
    _raw_id:     job.job_id,
    _country:    country,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { fetchJSearch, QUERIES, US_EXCLUSION_PATTERNS };
