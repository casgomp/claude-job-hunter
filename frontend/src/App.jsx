import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import StatsBar   from './components/StatsBar'
import FilterBar  from './components/FilterBar'
import JobTable   from './components/JobTable'
import JobDetail  from './components/JobDetail'
import EvalModal  from './components/EvalModal'

const API = 'http://172.31.202.183:5000'

export function parseCity(location, workType) {
  if (!location) return ''
  if (workType === 'remote') return 'Remote'
  const clean = location.replace(/\s*\(.*?\)/g, '').trim()
  return clean.split(',')[0].trim() || ''
}

export function parseCountry(location, country) {
  if (country) return country
  if (!location) return ''
  const clean = location.replace(/\s*\(.*?\)/g, '').trim()
  const parts = clean.split(',').map(s => s.trim())
  const last = parts[parts.length - 1]
  if (!last) return ''
  if (/deutschland|germany|^de$/i.test(last)) return 'Germany'
  if (/japan|^jp$/i.test(last)) return 'Japan'
  return parts.length > 1 ? last : ''
}

function getSortValue(job, key) {
  if (key === 'city')       return parseCity(job.location, job.work_type).toLowerCase()
  if (key === 'country')    return parseCountry(job.location, job.country).toLowerCase()
  if (key === 'flag_count') return job.eligibility_flags?.length ?? 0
  if (key === 'rated')     return job.rating != null ? 1 : 0
  const val = job[key]
  if (val == null) return ''
  return typeof val === 'string' ? val.toLowerCase() : val
}

export default function App() {
  const [jobs, setJobs]         = useState([])
  const [stats, setStats]       = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [selectedJob, setSelectedJob] = useState(null)
  const [scraping, setScraping] = useState(false)
  const pollRef = useRef(null)

  const [filters, setFilters] = useState({ status: 'all', minScore: 1, workType: 'all' })
  const [sortConfig, setSortConfig] = useState({ key: 'score', dir: 'desc' })

  const [evalModal, setEvalModal] = useState(false)
  const [evalState, setEvalState] = useState('idle')   // idle | loading | done | error
  const [evalReport, setEvalReport] = useState(null)
  const [evalError, setEvalError]   = useState(null)

  const fetchJobs = useCallback(async () => {
    const res  = await fetch(`${API}/api/jobs`)
    const data = await res.json()
    setJobs(data.jobs)
  }, [])

  const fetchStats = useCallback(async () => {
    const res  = await fetch(`${API}/api/stats`)
    const data = await res.json()
    setStats(data)
    return data
  }, [])

  const startPolling = useCallback(() => {
    setScraping(true)
    pollRef.current = setInterval(async () => {
      try {
        const s = await fetchStats()
        if (!s.scrape_running) {
          clearInterval(pollRef.current)
          setScraping(false)
          fetchJobs()
        }
      } catch {}
    }, 3000)
  }, [fetchStats, fetchJobs])

  useEffect(() => {
    Promise.all([fetchJobs(), fetchStats()])
      .then(([, s]) => { if (s?.scrape_running) startPolling() })
      .catch(() => setError('Cannot connect to backend on port 5000'))
      .finally(() => setLoading(false))
    return () => clearInterval(pollRef.current)
  }, [])

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') setSelectedJob(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleScrape = async () => {
    if (scraping) return
    try {
      const res = await fetch(`${API}/api/scrape`, { method: 'POST' })
      if (res.ok) startPolling()
    } catch {}
  }

  const handleStatusUpdate = async (id, status) => {
    await fetch(`${API}/api/jobs/${id}/status`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status }),
    })
    setJobs(prev => prev.map(j => j.id === id ? { ...j, status } : j))
    setSelectedJob(prev => prev?.id === id ? { ...prev, status } : prev)
    fetchStats()
  }

  const handleEvaluate = async () => {
    setEvalState('loading')
    setEvalError(null)
    try {
      const res = await fetch(`${API}/api/evaluate`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Evaluation failed')
      setEvalReport(data)
      setEvalState('done')
    } catch (err) {
      setEvalError(err.message)
      setEvalState('error')
    }
  }

  const handleSort = (key) => {
    setSortConfig(prev =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'score' ? 'desc' : 'asc' }
    )
  }

  const sortedFilteredJobs = useMemo(() => {
    const filtered = jobs.filter(j => {
      if (filters.status !== 'all'   && j.status    !== filters.status)                   return false
      if (filters.workType !== 'all' && j.work_type !== filters.workType)                 return false
      if (j.score != null && j.score < filters.minScore)                                  return false
      return true
    })

    return [...filtered].sort((a, b) => {
      const aVal = getSortValue(a, sortConfig.key)
      const bVal = getSortValue(b, sortConfig.key)
      if (aVal === '' || aVal == null) return 1
      if (bVal === '' || bVal == null) return -1
      const cmp = typeof aVal === 'number' ? aVal - bVal : String(aVal).localeCompare(String(bVal))
      return sortConfig.dir === 'asc' ? cmp : -cmp
    })
  }, [jobs, filters, sortConfig])

  return (
    <div className="app">
      <header className="header">
        <div className="header-row">
          <span>⚡</span>
          <h1 className="app-title">Job Hunter</h1>
          <div className="header-spacer" />
          <button className="btn-scrape" onClick={handleScrape} disabled={scraping}>
            {scraping ? <><span className="spinner" />Running scrape…</> : '↻ Run New Scrape'}
          </button>
        </div>
        <StatsBar stats={stats} jobs={jobs} onEvaluate={() => { setEvalModal(true); if (evalState === 'idle') handleEvaluate() }} />
      </header>

      <FilterBar filters={filters} onChange={setFilters} />

      <div className="content-area">
        <div className="table-area">
          {loading && <p className="state-msg">Loading…</p>}
          {error   && <p className="state-msg error">{error}</p>}
          {!loading && !error && (
            <>
              <div className="results-count">
                {sortedFilteredJobs.length} job{sortedFilteredJobs.length !== 1 ? 's' : ''}
                {sortedFilteredJobs.length !== jobs.length && ` of ${jobs.length}`}
              </div>
              <JobTable
                jobs={sortedFilteredJobs}
                selectedJobId={selectedJob?.id}
                sortConfig={sortConfig}
                onSort={handleSort}
                onJobClick={setSelectedJob}
              />
            </>
          )}
        </div>

        {selectedJob && (
          <div className="detail-panel">
            <JobDetail
              job={selectedJob}
              onClose={() => setSelectedJob(null)}
              onStatusUpdate={handleStatusUpdate}
            />
          </div>
        )}
      </div>
      {evalModal && (
        <EvalModal
          state={evalState}
          report={evalReport}
          error={evalError}
          onClose={() => setEvalModal(false)}
          onRun={handleEvaluate}
        />
      )}
    </div>
  )
}
