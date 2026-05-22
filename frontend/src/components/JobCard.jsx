function cleanLocation(loc) {
  if (!loc) return '—'
  return loc.replace(/\s*\(.*?\)\s*/g, '').trim() || loc.trim()
}

export default function JobCard({ job, onClick }) {
  const tierCls  = `tier${job.tier}`
  const workType = job._work_type || 'remote'
  const location = cleanLocation(job.location)
  const flags    = job.eligibility_flags ?? []

  return (
    <article className={`job-card status-${job.status}`} onClick={onClick}>
      <div className="card-top">
        <span className={`tier-badge ${tierCls}`}>T{job.tier}</span>
        <span className="score-badge">{job.score ?? '—'}/10</span>
        <span className={`work-badge ${workType}`}>{workType}</span>
      </div>

      <h3 className="card-title">{job.title}</h3>
      <div className="card-company">{job.company}</div>

      <div className="card-meta">
        <span>{location}</span>
        {job.salary && <span className="card-salary">{job.salary}</span>}
      </div>

      <div className="card-badges">
        <span className="source-badge">{job.source}</span>
        {job.status !== 'new' && (
          <span className={`status-badge status-${job.status}`}>{job.status}</span>
        )}
      </div>

      {flags.length > 0 && (
        <div className="card-flags">
          {flags.slice(0, 2).map((f, i) => (
            <span key={i} className="flag-tag">
              ⚠ {f.length > 48 ? f.slice(0, 48) + '…' : f}
            </span>
          ))}
          {flags.length > 2 && (
            <span className="flag-more">+{flags.length - 2} more</span>
          )}
        </div>
      )}
    </article>
  )
}
