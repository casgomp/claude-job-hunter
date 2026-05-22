import { useState, useEffect, useCallback, useRef } from 'react'
import StatsBar from './components/StatsBar'
import FilterBar from './components/FilterBar'
import JobCard from './components/JobCard'
import JobDetail from './components/JobDetail'

const API = 'http://172.31.202.183:5000'

export default function App() {
  const [jobs, setJobs]           = useState([])
  const [stats, setStats]         = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [selectedJob, setSelectedJob] = useState(null)
  const [scraping, setScraping]   = useState(false)
  const pollRef = useRef(null)

  const [filters, setFilters] = useState({
    tier: 'all', status: 'all', minScore: 1, hideTier3: false,
  })

  const fetchJobs = useCallback(async () => {
    const res = await fetch(`${API}/api/jobs`)
    const data = await res.json()
    setJobs(data.jobs)
  }, [])

  const fetchStats = useCallback(async () => {
    const res = await fetch(`${API}/api/stats`)
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

  const handleScrape = async () => {
    if (scraping) return
    try {
      const res = await fetch(`${API}/api/scrape`, { method: 'POST' })
      if (res.ok) startPolling()
    } catch {}
  }

  const handleStatusUpdate = async (id, status) => {
    await fetch(`${API}/api/jobs/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    setJobs(prev => prev.map(j => j.id === id ? { ...j, status } : j))
    setSelectedJob(prev => prev?.id === id ? { ...prev, status } : prev)
    fetchStats()
  }

  const filteredJobs = jobs.filter(j => {
    if (filters.hideTier3 && j.tier === 3) return false
    if (filters.tier !== 'all' && j.tier !== Number(filters.tier)) return false
    if (filters.status !== 'all' && j.status !== filters.status) return false
    if (j.score != null && j.score < filters.minScore) return false
    return true
  })

  return (
    <div className="app">
      <header className="header">
        <div className="header-row">
          <span className="app-logo">⚡</span>
          <h1 className="app-title">Job Hunter</h1>
          <div className="header-spacer" />
          <button
            className="btn-scrape"
            onClick={handleScrape}
            disabled={scraping}
          >
            {scraping
              ? <><span className="spinner" />Running scrape…</>
              : '↻ Run New Scrape'}
          </button>
        </div>
        <StatsBar stats={stats} jobs={jobs} />
      </header>

      <FilterBar filters={filters} onChange={setFilters} />

      <main className="main">
        {loading && <p className="state-msg">Loading…</p>}
        {error   && <p className="state-msg error">{error}</p>}
        {!loading && !error && (
          <>
            <div className="results-count">
              {filteredJobs.length} job{filteredJobs.length !== 1 ? 's' : ''}
              {filteredJobs.length !== jobs.length && ` of ${jobs.length}`}
            </div>
            {filteredJobs.length === 0
              ? <p className="state-msg">No jobs match your filters.</p>
              : <div className="jobs-grid">
                  {filteredJobs.map(job => (
                    <JobCard key={job.id} job={job} onClick={() => setSelectedJob(job)} />
                  ))}
                </div>
            }
          </>
        )}
      </main>

      {selectedJob && (
        <JobDetail
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onStatusUpdate={handleStatusUpdate}
        />
      )}
    </div>
  )
}
