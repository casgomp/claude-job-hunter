# Development Log — Claude Job Hunter

A day-by-day record of what was built, the technical decisions made, and the reasoning behind them.

---

## Day 1 — Project Setup

**Goal:** Stand up the repo, folder structure, database, and API key configuration.

Created the GitHub repo and established a three-package layout: `scraper/`, `backend/`, `frontend/`. All three have independent `package.json` files and `node_modules`, communicating through flat JSON files (`raw_jobs.json`, `scored_jobs.json`) and a shared SQLite database.

**Backend:** Express 5 (not the stable 4.x — 5.0 is the latest at time of writing) with CommonJS modules (`"type": "commonjs"`). SQLite via `better-sqlite3` (synchronous, no async/await noise). Database opens in WAL mode with `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON` for referential integrity. DB path: `backend/data/jobs.db`.

**Frontend:** React 19 + Vite 8 with ES modules (`"type": "module"`). Dark theme with CSS custom properties from the start.

**Configuration:** All secrets in a root `.env` loaded at startup with `dotenv`. Required keys: `JSEARCH_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `CLAUDE_API_KEY`.

**`criteria.md`:** Written at project root. Contains the full candidate profile: target roles, location logic (Berlin onsite/hybrid, Europe remote, Japan Tokyo/Osaka), preferred stack, experience level, eligibility constraints, and scoring guidance. This file is the single source of truth for scoring — the scorer embeds it at runtime via `fs.readFileSync()` inside a template literal.

---

## Day 2 — Scraper

**Goal:** Pull job listings from two APIs and filter aggressively before scoring.

**Sources:**
- **JSearch** (RapidAPI) via `axios` — searches by query string with `remoteOnly` and `isJapan` flags per query.
- **Adzuna** — scrapes EU job boards including Germany. The `/jp/` endpoint was tested and returns zero results; Japan coverage is handled exclusively by JSearch.

**`scraper/src/utils.js`** — the filtering and normalization layer:

- **`isGermanOnly(job)`:** Counts occurrence of a curated `DE_STOPWORDS` Set (distinctive German words that don't overlap with English: `und`, `für`, `über`, `müssen`, etc.). If >8% of words (minimum 60-word threshold) are stopwords, the listing is flagged `_german_only: true` and excluded. This avoids sending German-only listings to the scorer.

- **`applyLocationFilter(job)`:** Implements location logic from `criteria.md`. Detects `_work_type` (remote/hybrid/onsite) from description text. Rules:
  - Remote → always include
  - Hybrid → Berlin only (plus flagged warnings for Hamburg, Potsdam, Dresden, etc. within ~2h)
  - Onsite → Berlin only
  - Japan → Tokyo or Osaka only (or unflagged remote)
  - Unknown location → flagged for manual review rather than excluded

- **`deduplicate()`:** Deduplicates by `title + company` key (lowercased), not by URL, since the same job can appear across both APIs.

- **`normalizeAndDeduplicate()`:** Runs location filter then German-only check on every job, then deduplicates.

**US exclusion (JSearch):** 12 regex patterns covering US citizenship requirements, security clearances (SECRET, TS/SCI), active clearances, DoD approvals, ITAR, and polygraph requirements. Jobs matching any pattern are dropped before normalization.

**Japan filter (JSearch):** Beyond location, Japan queries also exclude roles requiring more than 1 year of experience (`requiresMoreThanOneYear()` regex on title + description).

**Logging:** `scraper/src/logger.js` (RunLogger class) appends each run to `scraper/logs/scraper_log.json` with source totals, included/excluded counts, and error records.

**Output:** `scraper/raw_jobs.json` — the included, deduplicated, location-filtered jobs ready for scoring.

---

## Day 3 — Scoring Pipeline + Backend API

**Goal:** Score each job 1–10 using Claude and expose results via REST API.

**`backend/src/scorer.js`:**

Uses `claude-opus-4-7` with two features:
- **Adaptive thinking** (`thinking: { type: 'adaptive' }`) — lets Claude reason internally before producing the score.
- **Prompt caching** (`cache_control: { type: 'ephemeral' }`) on the system prompt — the criteria document is large; caching avoids re-tokenizing it on every call.

The `SYSTEM_PROMPT` is a JavaScript template literal that embeds `criteria.md` via `fs.readFileSync()` at module load time. This means criteria changes take effect on next process start without touching `scorer.js`.

**Scoring output per job:** `match_score` (1–10), `reasoning` (2–3 sentences), `eligibility_flags` (array), `highlights`, `stack` (array), `experience_required` (fixed enum), `contract_type` (fixed enum).

**Hard caps** applied after initial scoring (lowest applicable cap wins):
- ≤3 if US citizenship/clearance/US-only remote
- ≤3 if German-only listing
- ≤3 if German proficiency B2+ required
- ≤3 for non-target regions (ANZ, US, LATAM-only, APAC-only)
- ≤4 if role description contradicts title, or remote scope is ambiguous

**`selfEvaluate()`:** After each batch, sends all scored jobs back to Claude for a consistency review. Returns `overall_quality` and any flagged inconsistencies. Logs but does not block on failures.

**Batch processing:** 10 jobs per batch, 1-second inter-call delay.

**Database schema (`backend/src/database.js`):**
- `jobs` table: 22 columns including `score`, `reasoning`, `eligibility_flags` (JSON text), `stack` (JSON text), `status` (CHECK constraint: new/saved/rejected/applied), `cv_generated` (integer boolean), `created_at`, `updated_at`. `url` is UNIQUE.
- `runs` table: scrape run history with `jobs_scraped`, `jobs_scored`, `tokens_used`.
- Indexes on `status`, `score`, `url`, `country`.

**Backend API (Express 5, `backend/src/server.js`):**
- `GET /api/jobs` — returns all jobs with optional `?status=` and `?min_score=` filters
- `GET /api/jobs/:id` — single job
- `PATCH /api/jobs/:id/status` — update status (new/saved/rejected/applied)
- `GET /api/stats` — total count, status breakdown, scrape_running flag
- `GET /api/runs` — scrape run history
- `POST /api/scrape` — triggers scrape+score pipeline via `child_process.execFile`

**`process.execPath`** is used for child processes instead of `'node'` — this picks up the nvm-managed binary rather than the system Node, avoiding version mismatch in WSL.

**`backend/src/scoringLogger.js`:** Logs individual job scores and errors per run.

---

## Day 4 — React Dashboard

**Goal:** Build a usable UI for browsing, filtering, and managing jobs.

**`frontend/src/App.jsx`:** Main state container. Fetches `GET /api/jobs` on mount. Manages `selectedJob`, `sortConfig` (`{key, dir}`), and status/score filters.

**`getSortValue(job, key)`:** Central sort key extractor. Handles special cases: `city` and `country` run through `parseCity()`/`parseCountry()` which extract from the raw `location` string; `flag_count` reads `eligibility_flags.length`.

**`parseCity()` and `parseCountry()`** are exported from `App.jsx` and imported by both `JobTable` and `JobDetail` — the canonical location-parsing logic lives in one place.

**`frontend/src/components/JobTable.jsx`:** Sortable table driven by a `COLUMNS` array. Each column has `key`, `label`, `sortable` flag, and `cls` for column width CSS. Active sort column gets `active-sort` class with ↑/↓ arrow.

**Column design decisions:**
- Stack column: `shortStack()` truncates to 3 technologies + "+N" overflow
- Score cell: `scoreClass()` maps score to `score-high` / `score-mid` / `score-low` CSS classes (green/amber/red)
- Work type: color-coded badge (remote/hybrid/onsite)
- Flags column (⚠): narrow, count only

**Vite proxy:** `vite.config.js` proxies `/api` to `http://172.31.202.183:5000` (WSL IP of the backend), so the frontend dev server and API share the same origin in development.

**Japan search:** JSearch queries use `isJapan: true` flag. Location filter accepts `job_country === 'JP'` OR city/state containing 'tokyo'/'osaka' (the stricter `job_country === 'JP'` alone returned too few results).

---

## Day 5 — CV Generator

**Goal:** Generate a tailored PDF CV for any job with one click.

**`backend/src/cvGenerator.js`:**

Uses `claude-opus-4-7` with adaptive thinking and prompt caching. The system prompt (`SYSTEM_PROMPT`) has 10 named rules using `──` section delimiters for human readability:

1. **SECTION ORDER** — fixed: Profile → Technical Skills → Projects → Professional Experience → Education → Languages
2. **PROFILE SUMMARY** — lead with 42 Berlin and programming; never open with "7+ years experience"
3. **PROFESSIONAL EXPERIENCE** — max one line per role, no bullets; architecture career is context, not the pitch
4. **TECHNICAL SKILLS** — only skills explicitly in `base_cv.md`; no SQL/Snowflake/invented tools
5. **PROJECTS** — 42 Berlin projects ordered by job relevance; Claude Job Hunter always last (hard rule)
6. **CLAUDE JOB HUNTER ACCURACY** — was built using Claude Code as an accelerator; don't say "built from scratch"; say "designed and directed the build of" or "architected using an agentic development workflow"
7. **OUTPUT FORMAT** — line 1: name, line 2: role, line 3: contact (pipe-separated), then `##`/`###` markdown structure

**`buildHtml(markdown)`:** The key design decision here is to *not* rely on `marked` for the header block. The name/role/contact lines come before the first `##` and have no markdown structure — `marked` would collapse them into a single `<p>`. Instead, `buildHtml()` manually splits the header from the body (finding the index of the first `##` line), parses the first three header lines, and builds structured HTML. The body is rendered with `marked.parse()`.

**PDF rendering:** Puppeteer with WSL-compatible flags: `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`. The `generateCv()` function also writes an `.html` companion file alongside each PDF for inspection without re-running the generator.

**CSS design:** Arial/Helvetica, `#1e3a5f` navy accent, A4 @page margins (15mm top, 18mm sides, 14mm bottom). Section headers (`h2`) are 7.5pt uppercase with letter-spacing and a blue bottom border. Entry titles (`h3`) use `display: flex; justify-content: space-between` to right-align dates naturally.

**`base_cv.md`:** Source of truth CV at project root. Contains profile, technical skills, 42 Berlin projects, professional experience, education, languages. Never modified by the generator — always read-only.

**Backend:** `POST /api/jobs/:id/generate-cv` returns `{success, filename, url}`. `app.use('/cvs', express.static(CV_DIR))` serves generated PDFs directly. `cv_generated` flag in DB updated after generation.

**Frontend (`JobDetail.jsx`):** `cvState` state machine (idle → loading → done/error). Shows "Generate CV" button, then "↓ Download CV" link plus a small "Regenerate" button after first generation.

---

## Day 6 — GitHub Actions Scheduler + Sync Script

**Goal:** Run the pipeline automatically without local intervention, and make it easy to pull results locally.

**`.github/workflows/scrape.yml`:**
- Schedule: `cron: '0 6 */3 * *'` (every 3 days at 06:00 UTC)
- Manual trigger: `workflow_dispatch`
- `permissions: contents: write` — required for committing back to the repo
- Node 24 setup with npm cache for both `scraper/package-lock.json` and `backend/package-lock.json`
- Creates `.env` from GitHub Actions secrets at runtime (no dotenvx dependency)
- Steps in order: scrape → score → evaluate (prompt improvement runs automatically) → commit
- Committed files: `scraper/raw_jobs.json`, `backend/scored_jobs.json`, `backend/src/scorer.js` (updated by evaluator), `backend/logs/evaluation_report.json`
- `.gitignore` has `!backend/logs/evaluation_report.json` exception to allow tracking this one file despite `logs/` being ignored

**`backend/src/sync.js`:**

Reads `scored_jobs.json` and reconciles with the local SQLite database:
- New jobs (by URL): `insertJob()`
- Existing jobs with changed score: `updateJobScoring()` — updates score, reasoning, flags, highlights, stack, experience_required, contract_type
- Unchanged: skipped
- After jobs: calls `importRatingsFromFile()` to import any new ratings from `ratings_export.json`

Run with `npm run sync` from the `backend/` directory after `git pull`.

---

## Day 7 — Human Feedback Loop, Quality Evaluator, Dashboard Polish

**Goal:** Close the loop between Claude's scores and human judgment; automatically improve the scoring prompt over time.

### Human Rating System

**Database (`backend/src/database.js`):**

Added `ratings` table:
```sql
CREATE TABLE IF NOT EXISTS ratings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id         INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  eligibility    TEXT CHECK(eligibility IN ('Yes','Maybe','No')),
  technical_fit  INTEGER CHECK(technical_fit BETWEEN 1 AND 5),
  interest_level INTEGER CHECK(interest_level BETWEEN 1 AND 5),
  notes          TEXT,
  rated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`UNIQUE` on `job_id` means one rating per job — upsert semantics throughout. `ON DELETE CASCADE` cleans up ratings when a job is removed.

`JOBS_WITH_RATINGS_SQL` is a `LEFT JOIN` that aliases rating columns as `rating_*`. `serializeJob()` nests these into `job.rating` (null if unrated) and deletes the flat `rating_*` fields before returning to callers.

`_writeRatingsExport()`: after every upsert, writes `backend/ratings_export.json` — an array keyed by job URL (stable across DB resets). This file is committed to git by GitHub Actions, giving the evaluator access to local human ratings made on the dev machine.

`importRatingsFromFile()`: matches ratings to local jobs by URL, upserts. Called by `sync.js` so ratings travel back after a `git pull`.

**API:** `PATCH /api/jobs/:id/rating` validates all three fields (eligibility enum, 1–5 range for stars) before calling `upsertRating()`.

**Frontend (`JobDetail.jsx` — `RatingForm` component):**
- `Stars` component: 5 `<button>` elements with hover preview via local `hovered` state. Click on currently-selected star clears it (toggle behavior).
- Pre-populated from `job.rating` on mount.
- `isDirty` computed: Save button disabled until the form differs from the saved state.
- 2-second "✓ Saved" flash via `setTimeout` after successful save.

### Quality Evaluator

**`backend/src/evaluator.js`:**

Two-phase pipeline on every run:

**Phase 1 — Evaluation:**
- `computeRatingGaps()`: maps `technical_fit + interest_level` (2–10 scale) onto Claude's 1–10 scale. Flags `|claude_score - human_score| > 2`. Sorted by gap descending.
- `evaluate()`: sends compact job representation (no description) + gap section to Claude for audit. The gap section is labeled "MANUAL RATING GAPS — treat these as primary feedback" and appears below the jobs list. Issue types: `obvious_error`, `inconsistency`, `us_restricted`, `german_only`, `source_bias`.

**Phase 2 — Prompt improvement:**
- `extractCurrentRules()`: reads `scorer.js`, finds `RULES_BOUNDARY = '</criteria>\n\n'` marker, slices from there to the closing `` ` `` of the template literal. This is the only portion of the file that changes — the `criteria.md` embedding expression is preserved verbatim.
- `improvePrompt()`: sends current rules + numbered recommendations to Claude (separate system prompt, no adaptive thinking, faster). Returns new rules text.
- `writeImprovedPrompt()`: escapes backticks in the new rules (`.replace(/\`/g, '\\\`')`), splices into the template literal, writes the file back.

**Report (`backend/logs/evaluation_report.json`):** includes `overall_quality`, `confidence`, `summary`, `issues`, `recommendations`, `rating_gaps`, `prompt_update: {previous_rules, updated_rules}`, `jobs_evaluated`, `generated_at`.

**Concurrency guard:** `evalRunning` flag in `server.js`; returns 409 if evaluation is already running.

**Frontend (`EvalModal.jsx` + `StatsBar.jsx`):**
- "✦ Evaluate Scores" button in `StatsBar`.
- `EvalModal`: four states — idle (description + Run button), loading (spinner), done (report), error (retry).
- Quality badge colored by `overall_quality` (good/fair/poor → green/amber/red).
- Issue type tags color-coded: `obvious_error` and `us_restricted` → red, `inconsistency` and `german_only` → amber, `source_bias` → purple.
- Recommendations listed separately from issues.

**GitHub Actions integration:** Evaluator runs automatically after every score run (before the commit step), so `scorer.js` is improved and committed on every scheduled run.

### Dashboard Table Changes

- **Salary column removed** — not consistently populated across sources; added noise.
- **Rated column added** (`★` header, narrow `col-rated` at 36px): shows `✓` (green, `.rated-check`) if `job.rating != null`, else `—` (muted). Sortable: `getSortValue` returns `1` for rated, `0` for unrated.
