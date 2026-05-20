// Implements location filtering logic from criteria.md
function applyLocationFilter(job) {
  const text = [job.title, job.description, job.location].filter(Boolean).join(' ').toLowerCase();
  const loc = (job.location || '').toLowerCase();

  const hasRemote = job._is_remote || /\bfully remote\b/.test(text);
  const hasHybrid = /\bhybrid\b/.test(text);

  let workType;
  if (hasHybrid) workType = 'hybrid';
  else if (hasRemote) workType = 'remote';
  else workType = 'onsite';

  const isBerlin = loc.includes('berlin');
  // Cities within ~2 hours by train from Berlin — hybrid roles acceptable here
  const isNearBerlin = [
    'potsdam', 'brandenburg',
    'hamburg', 'wolfsburg',
    'leipzig', 'dresden',
    'rostock', 'hannover',
  ].some(city => loc.includes(city));
  const locationUnknown = !loc.trim();

  const base = { ...job, _work_type: workType };

  if (workType === 'remote') {
    return { ...base, _location_excluded: false };
  }

  if (workType === 'hybrid') {
    if (isBerlin) return { ...base, _location_excluded: false };
    if (isNearBerlin) return { ...base, _location_excluded: false, _location_flagged: true, _flag_reason: `Hybrid within ~2h of Berlin (${job.location}) — verify days onsite` };
    if (locationUnknown) return { ...base, _location_excluded: false, _location_flagged: true, _flag_reason: 'Hybrid role — location not specified, verify manually' };
    return { ...base, _location_excluded: true, _flag_reason: `Hybrid outside 2h Berlin radius (${job.location})` };
  }

  // onsite
  if (isBerlin) return { ...base, _location_excluded: false };
  if (locationUnknown) return { ...base, _location_excluded: false, _location_flagged: true, _flag_reason: 'Onsite — location unclear, verify it is in Berlin' };
  return { ...base, _location_excluded: true, _flag_reason: `Onsite outside Berlin (${job.location})` };
}

function deduplicate(jobs) {
  const seen = new Set();
  return jobs.filter(job => {
    const key = [
      (job.title || '').toLowerCase().replace(/\s+/g, ' ').trim(),
      (job.company || '').toLowerCase().replace(/\s+/g, ' ').trim(),
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeAndDeduplicate(jobs) {
  return deduplicate(jobs.map(applyLocationFilter));
}

module.exports = { normalizeAndDeduplicate };
