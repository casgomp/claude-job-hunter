// German stopwords that are not English words — their presence indicates German text.
const DE_STOPWORDS = new Set([
  'und','die','der','das','für','mit','von','auf','ist','nicht','auch','werden',
  'kann','haben','eine','einem','einer','wir','sie','uns','ihr','müssen','können',
  'oder','dass','wenn','aber','über','durch','nach','unter','alle','kein','wird',
  'sind','bei','zur','zum','des','den','dem','als','wie','er','es','an','zu',
  'einem','einer','seine','unsere','alle','mehr','noch','nur','so','dann',
  'werden','haben','dieser','diese','diesem','diesen','dieses',
]);

// Returns true when the description is written almost entirely in German.
function isGermanOnly(job) {
  const text = (job.description || '').toLowerCase();
  if (!text) return false;

  const words = text.match(/\b[a-züäöß]{3,}\b/g);
  if (!words || words.length < 60) return false;  // too short to judge

  const deCount = words.filter(w => DE_STOPWORDS.has(w)).length;
  const density  = deCount / words.length;
  return density > 0.08;  // >8% distinctive German stopwords → German-only
}

// Implements location filtering logic from criteria.md
function applyLocationFilter(job) {
  const text = [job.title, job.description, job.location].filter(Boolean).join(' ').toLowerCase();
  const loc  = (job.location || '').toLowerCase();

  const hasRemote = job._is_remote || /\bfully remote\b/.test(text);
  const hasHybrid = /\bhybrid\b/.test(text);

  let workType;
  if (hasHybrid)      workType = 'hybrid';
  else if (hasRemote) workType = 'remote';
  else                workType = 'onsite';

  const base = { ...job, _work_type: workType };

  // ── Japan jobs: Tokyo / Osaka only, or fully remote ────────────────────────
  if (job._country === 'Japan') {
    if (workType === 'remote') return { ...base, _location_excluded: false };
    const isTargetCity = ['tokyo', 'osaka'].some(c => loc.includes(c));
    if (isTargetCity) return { ...base, _location_excluded: false };
    if (!loc.trim())  return { ...base, _location_excluded: false, _location_flagged: true, _flag_reason: 'Japan job — location not specified, verify city' };
    return { ...base, _location_excluded: true, _flag_reason: `Japan job not in Tokyo/Osaka (${job.location})` };
  }

  // ── Europe / Germany jobs ───────────────────────────────────────────────────
  if (workType === 'remote') {
    return { ...base, _location_excluded: false };
  }

  const isBerlin      = loc.includes('berlin');
  const isNearBerlin  = ['potsdam', 'brandenburg', 'hamburg', 'wolfsburg', 'leipzig', 'dresden', 'rostock', 'hannover'].some(c => loc.includes(c));
  const locationUnknown = !loc.trim();

  if (workType === 'hybrid') {
    if (isBerlin)         return { ...base, _location_excluded: false };
    if (isNearBerlin)     return { ...base, _location_excluded: false, _location_flagged: true, _flag_reason: `Hybrid within ~2h of Berlin (${job.location}) — verify days onsite` };
    if (locationUnknown)  return { ...base, _location_excluded: false, _location_flagged: true, _flag_reason: 'Hybrid role — location not specified, verify manually' };
    return { ...base, _location_excluded: true, _flag_reason: `Hybrid outside 2h Berlin radius (${job.location})` };
  }

  // onsite
  if (isBerlin)        return { ...base, _location_excluded: false };
  if (locationUnknown) return { ...base, _location_excluded: false, _location_flagged: true, _flag_reason: 'Onsite — location unclear, verify it is in Berlin' };
  return { ...base, _location_excluded: true, _flag_reason: `Onsite outside Berlin (${job.location})` };
}

function deduplicate(jobs) {
  const seen = new Set();
  return jobs.filter(job => {
    const key = [
      (job.title   || '').toLowerCase().replace(/\s+/g, ' ').trim(),
      (job.company || '').toLowerCase().replace(/\s+/g, ' ').trim(),
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeAndDeduplicate(jobs) {
  return deduplicate(jobs.map(j => {
    const withLocation = applyLocationFilter(j);
    if (isGermanOnly(j)) {
      return { ...withLocation, _german_only: true };
    }
    return withLocation;
  }));
}

module.exports = { normalizeAndDeduplicate };
