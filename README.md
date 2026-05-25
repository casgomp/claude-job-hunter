# Claude Job Hunter

An AI-powered job hunting pipeline. It scrapes listings from multiple sources, scores them 1–10 against a specific candidate profile using Claude, generates tailored CVs on demand, and continuously improves its own scoring prompt based on manual feedback.

Built using an agentic development workflow with [Claude Code](https://claude.ai/code).

---

## What it does

1. **Scrapes** job listings from JSearch (RapidAPI) and Adzuna across Berlin, remote Europe, and Tokyo
2. **Filters** out German-only listings, US-restricted roles, and out-of-range locations before scoring
3. **Scores** each job 1–10 using Claude Opus with adaptive thinking, applying hard caps for ineligible roles
4. **Evaluates** its own scores for inconsistencies and mis-scores — and automatically rewrites the scoring prompt to fix them
5. **Rates** jobs manually (eligibility, technical fit, interest) and feeds that signal back into the evaluator
6. **Generates** tailored PDF CVs for any job with one click

Everything runs locally in development. A GitHub Actions workflow runs the full pipeline every 3 days and commits updated results back to the repo.

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js 24, Express 5, CommonJS |
| Database | SQLite via `better-sqlite3` (WAL mode) |
| AI | Anthropic Claude Opus 4.7 (scoring, CV generation, evaluation) |
| Scraping | JSearch (RapidAPI), Adzuna — via `axios` |
| PDF generation | Puppeteer (headless Chromium) |
| Markdown rendering | `marked` |
| Frontend | React 19, Vite 8 (ES modules) |
| Scheduling | GitHub Actions (cron every 3 days) |
| Environment | WSL2 (Ubuntu), nvm-managed Node |

---

## Project structure

```
claude-job-hunter/
├── scraper/                   # Job scraping (JSearch + Adzuna)
│   ├── src/
│   │   ├── index.js           # Entry point — scrape, filter, deduplicate
│   │   ├── jsearch.js         # JSearch API queries
│   │   ├── adzuna.js          # Adzuna API queries
│   │   ├── utils.js           # Location filter, German-only detection, dedup
│   │   └── logger.js          # Run logging
│   └── raw_jobs.json          # Output — filtered jobs ready for scoring
│
├── backend/
│   ├── src/
│   │   ├── server.js          # Express API server
│   │   ├── database.js        # SQLite schema + all queries
│   │   ├── scorer.js          # Claude scoring pipeline
│   │   ├── evaluator.js       # Quality audit + automatic prompt improvement
│   │   ├── cvGenerator.js     # Claude CV tailoring + Puppeteer PDF
│   │   ├── sync.js            # Sync scored_jobs.json → local SQLite
│   │   ├── rescore.js         # Re-score all existing DB jobs
│   │   └── scoringLogger.js   # Per-job scoring log
│   ├── data/jobs.db           # SQLite database (gitignored)
│   ├── generated_cvs/         # PDF + HTML outputs (gitignored)
│   ├── logs/evaluation_report.json
│   ├── scored_jobs.json       # Scored jobs from last run
│   └── ratings_export.json    # Human ratings keyed by job URL (cross-machine sync)
│
├── frontend/
│   └── src/
│       ├── App.jsx            # Main state, filtering, sorting
│       ├── components/
│       │   ├── JobTable.jsx   # Sortable job list
│       │   ├── JobDetail.jsx  # Side panel — job details, rating form, CV button
│       │   ├── StatsBar.jsx   # Summary bar + Evaluate button
│       │   └── EvalModal.jsx  # Evaluation report modal
│       └── index.css          # Dark theme, all component styles
│
├── criteria.md                # Candidate profile + scoring guidance (source of truth)
├── base_cv.md                 # Candidate base CV (source of truth for CV generation)
├── .github/workflows/
│   └── scrape.yml             # GitHub Actions — scrape + score + evaluate on schedule
└── .env                       # API keys (gitignored)
```

---

## Installation

### Prerequisites

- Node.js 24+ (managed via nvm recommended)
- A GitHub personal access token with `repo` and `workflow` scopes (for pushing workflow changes)

### 1. Clone and install dependencies

```bash
git clone https://github.com/casgomp/claude-job-hunter.git
cd claude-job-hunter

cd scraper && npm install && cd ..
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```env
JSEARCH_API_KEY=your_jsearch_key
ADZUNA_APP_ID=your_adzuna_app_id
ADZUNA_APP_KEY=your_adzuna_app_key
CLAUDE_API_KEY=your_anthropic_api_key
```

API keys needed:
- **JSearch:** [rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch)
- **Adzuna:** [developer.adzuna.com](https://developer.adzuna.com)
- **Claude:** [console.anthropic.com](https://console.anthropic.com)

### 3. Customize for your profile

Edit `criteria.md` to describe your target roles, location, skills, and eligibility constraints.
Edit `base_cv.md` with your actual CV content.

---

## Running locally

### Start the backend

```bash
cd backend
npm run dev       # node --watch (restarts on file change)
# or
npm start         # production mode
```

Server starts on port 5000.

### Start the frontend

```bash
cd frontend
npm run dev
```

Vite dev server starts on port 5173 and proxies `/api` to the backend.

### Run the scraper manually

```bash
node scraper/src/index.js
```

Output saved to `scraper/raw_jobs.json`.

### Score jobs

```bash
cd backend
node src/scorer.js
```

Reads `scraper/raw_jobs.json`, scores each job, saves to `backend/scored_jobs.json`.

### Sync results into your local database

After running the scraper/scorer (or after `git pull` with new GitHub Actions results):

```bash
cd backend
npm run sync
```

Inserts new jobs, updates scores for changed ones, imports any new ratings.

### Run the quality evaluator manually

```bash
cd backend
npm run evaluate
```

Or click **✦ Evaluate Scores** in the dashboard.

---

## How the scraper works

The scraper queries JSearch and Adzuna with a set of predefined queries targeting Berlin, remote Europe, and Tokyo.

After fetching, `scraper/src/utils.js` applies three filters to every job:

1. **Location filter** (`applyLocationFilter`): classifies each job as remote/hybrid/onsite and checks it against target cities (Berlin for onsite/hybrid; Tokyo or Osaka for Japan; all remote accepted). Out-of-range jobs are excluded.

2. **German-only detection** (`isGermanOnly`): counts distinctive German stopwords. If >8% of words in the description are German-specific (with a 60-word minimum), the listing is excluded. English and bilingual listings pass through.

3. **Deduplication** (`deduplicate`): by `title + company` key — catches the same job appearing on both APIs.

US-restricted jobs (citizenship requirements, clearances, ITAR) are filtered from JSearch results before normalization. Japan jobs additionally exclude roles requiring more than 1 year of experience.

---

## How the scorer works

**`backend/src/scorer.js`** sends each job to `claude-opus-4-7` with:
- The candidate criteria document (`criteria.md`) embedded in the system prompt via `fs.readFileSync()` at startup
- Prompt caching (`cache_control: ephemeral`) — avoids re-tokenizing the large criteria doc on every call
- Adaptive thinking — lets Claude reason before producing the JSON output

The scorer returns for each job: `match_score` (1–10), `reasoning`, `eligibility_flags`, `highlights`, `stack`, `experience_required`, `contract_type`.

**Hard caps** (applied after initial scoring, lowest cap wins):
- ≤3 for US work authorization / citizenship / clearance requirements
- ≤3 for German-only listings
- ≤3 if German proficiency B2+ required
- ≤3 for non-target regions (ANZ, US-only, LATAM-only)
- ≤4 if role description contradicts title, or remote scope is ambiguous

After each batch, `selfEvaluate()` sends all scored jobs back to Claude for a consistency check.

---

## How the GitHub Actions scheduler works

**`.github/workflows/scrape.yml`** runs every 3 days at 06:00 UTC and can also be triggered manually from the GitHub Actions UI.

The workflow:
1. Checks out the repo
2. Installs dependencies for both `scraper/` and `backend/`
3. Creates a `.env` from GitHub Actions secrets
4. Runs the scraper → scorer → evaluator in sequence
5. Commits `raw_jobs.json`, `scored_jobs.json`, the updated `scorer.js` (improved by the evaluator), and `evaluation_report.json` back to `main`

After the workflow runs, pull the results locally and sync:

```bash
git pull
cd backend && npm run sync
```

### GitHub Actions secrets required

Add these in your repo settings under **Settings → Secrets and variables → Actions**:

| Secret name | Description |
|---|---|
| `JSEARCH_API_KEY` | JSearch / RapidAPI key |
| `ADZUNA_APP_ID` | Adzuna application ID |
| `ADZUNA_APP_KEY` | Adzuna API key |
| `CLAUDE_API_KEY` | Anthropic API key |

---

## Human feedback loop

Rate any job in the dashboard (eligibility, technical fit 1–5, interest 1–5). Ratings are saved to `backend/ratings_export.json` (keyed by job URL, not database ID) and committed to git by GitHub Actions.

When the evaluator runs, it computes a human score (`technical_fit + interest_level`, mapped to 2–10) and compares it to Claude's score. Gaps greater than 2 points are flagged as primary feedback for prompt improvement.

On the next `git pull` + `npm run sync`, ratings from the GitHub Actions environment are imported back into the local database.

---

## Screenshots

_Coming soon._

---

## Development notes

This project was built using an agentic development workflow with [Claude Code](https://claude.ai/code). The architecture, requirements, system design, and all prompt engineering were done by the project author. Implementation was largely AI-assisted.
