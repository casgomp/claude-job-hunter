const axios = require('axios');
const { isSeniorTitle, requiresMoreThanTwoYears } = require('./utils');

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

// Country codes to hard-exclude regardless of query — these regions require
// work authorization the candidate does not have.
const EXCLUDED_COUNTRIES = new Set(['US', 'CA', 'AU', 'NZ']);

// Text patterns that indicate a role is restricted to US citizens/residents.
// Checked against full text (title + description).
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

// Additional patterns checked against job description only — strong signals of a
// US-based role even when the country field is missing or wrong.
const US_DESCRIPTION_PATTERNS = [
  /\bW-?2\b/,                            // US payroll tax form
  /\b401\s*\(?\s*k\s*\)?/i,              // US retirement plan
  /\bPTO\b/,                              // US term for paid leave
  /\b(dallas|austin|seattle|chicago)\b/i,
  /\bnew\s+york\b/i,
  /\bsan\s+francisco\b/i,
  /\blos\s+angeles\b/i,
];

const US_RATE_WARNING_THRESHOLD = 0.7;

function isUsOnly(job) {
  const fullText = `${job.job_title || ''} ${job.job_description || ''}`;
  if (US_EXCLUSION_PATTERNS.some(re => re.test(fullText))) return true;
  const desc = job.job_description || '';
  return US_DESCRIPTION_PATTERNS.some(re => re.test(desc));
}

async function fetchJSearch(logger) {
  const apiKey = process.env.JSEARCH_API_KEY;
  if (!apiKey) throw new Error('JSEARCH_API_KEY not set in .env');

  const jobs = [];

  // Cumulative filter stats across all queries
  const totals = { raw: 0, us_country: 0, us_text: 0, senior: 0, experience: 0, japan_loc: 0, kept: 0 };
  const seniorTitlesExcluded = [];

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
      totals.raw += raw.length;

      const queryStat = { us_country: 0, us_text: 0, senior: 0, experience: 0, japan_loc: 0 };

      let passed;
      if (isJapan) {
        passed = raw.filter(j => {
          const countryOk = j.job_country === 'JP' ||
            ['tokyo', 'osaka'].some(c => (j.job_city  || '').toLowerCase().includes(c)) ||
            ['tokyo', 'osaka'].some(c => (j.job_state || '').toLowerCase().includes(c));
          if (!countryOk)                                                         { queryStat.japan_loc++;  return false; }
          if (isSeniorTitle(j.job_title))                                         { queryStat.senior++;     seniorTitlesExcluded.push(j.job_title); return false; }
          if (requiresMoreThanTwoYears(`${j.job_title} ${j.job_description}`))    { queryStat.experience++; return false; }
          return true;
        });
      } else {
        passed = raw.filter(j => {
          if (EXCLUDED_COUNTRIES.has(j.job_country))                              { queryStat.us_country++; return false; }
          if (isUsOnly(j))                                                         { queryStat.us_text++;    return false; }
          if (isSeniorTitle(j.job_title))                                         { queryStat.senior++;     seniorTitlesExcluded.push(j.job_title); return false; }
          if (requiresMoreThanTwoYears(`${j.job_title} ${j.job_description}`))    { queryStat.experience++; return false; }
          return true;
        });
      }

      totals.us_country  += queryStat.us_country;
      totals.us_text     += queryStat.us_text;
      totals.senior      += queryStat.senior;
      totals.experience  += queryStat.experience;
      totals.japan_loc   += queryStat.japan_loc;
      totals.kept        += passed.length;

      const excluded = raw.length - passed.length;
      jobs.push(...passed.map(j => normalize(j, remoteOnly, isJapan)));

      logger.logQuery({
        source: 'jsearch', query, remoteOnly,
        results: raw.length, passed: passed.length,
        filtered: { ...queryStat },
      });
      console.log(`  [jsearch] "${query}": ${raw.length} raw → ${passed.length} kept (${excluded} excluded: ${queryStat.us_country} US-country, ${queryStat.us_text} US-text, ${queryStat.senior} senior, ${queryStat.experience} exp, ${queryStat.japan_loc} JP-loc)`);
    } catch (err) {
      const status  = err.response?.status;
      const message = status ? `HTTP ${status}` : err.message;
      logger.logQuery({ source: 'jsearch', query, remoteOnly, results: 0, error: message });
      console.warn(`  [jsearch] "${query}" failed: ${message}`);
    }
  }

  // Summary
  const totalExcluded = totals.raw - totals.kept;
  console.log(`\n[jsearch] FILTER SUMMARY: ${totals.raw} raw → ${totals.kept} kept (${totalExcluded} excluded)`);
  console.log(`  US country code: ${totals.us_country}`);
  console.log(`  US auth text:    ${totals.us_text}`);
  console.log(`  Senior title:    ${totals.senior}`);
  console.log(`  Experience >2yr: ${totals.experience}`);
  if (totals.japan_loc) console.log(`  Japan location:  ${totals.japan_loc}`);
  if (seniorTitlesExcluded.length) {
    console.log(`  Senior titles excluded:`);
    [...new Set(seniorTitlesExcluded)].forEach(t => console.log(`    - ${t}`));
  }

  if (totals.raw > 0) {
    const usRate = (totals.us_country + totals.us_text) / totals.raw;
    if (usRate >= US_RATE_WARNING_THRESHOLD) {
      const pct     = Math.round(usRate * 100);
      const warning = `JSearch returned ${pct}% US-filtered results (${totals.us_country + totals.us_text}/${totals.raw}).`;
      console.warn(`  [jsearch] WARNING: ${warning}`);
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
