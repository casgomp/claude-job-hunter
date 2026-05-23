import { parseCity, parseCountry } from '../App'

function formatDate(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function JobDetail({ job, onClose, onStatusUpdate }) {
  const city    = parseCity(job.location, job.work_type)
  const country = parseCountry(job.location, job.country)
  const date    = formatDate(job.date_posted)
  const flags   = job.eligibility_flags ?? []

  const actions = [
    { key: 'saved',    label: '💾 Save' },
    { key: 'applied',  label: '✓ Applied' },
    { key: 'rejected', label: '✗ Reject' },
  ]

  const handleAction = (status) => {
    onStatusUpdate(job.id, job.status === status ? 'new' : status)
  }

  return (
    <>
      <div className="panel-header">
        <h2 className="panel-title">{job.title}</h2>
        <button className="panel-close" onClick={onClose}>✕</button>
      </div>

      <div className="panel-meta">
        <strong>{job.company}</strong>
        {city    && <><span className="dot">·</span>{city}</>}
        {country && <><span className="dot">·</span>{country}</>}
        {job.work_type && (
          <><span className="dot">·</span><span className={`work-badge ${job.work_type}`}>{job.work_type}</span></>
        )}
        <span className="dot">·</span>
        <strong style={{ color: job.score >= 7 ? 'var(--score-high)' : job.score >= 4 ? 'var(--score-mid)' : 'var(--score-low)' }}>
          {job.score ?? '—'}/10
        </strong>
        <span className="dot">·</span>
        <span className="source-badge">{job.source}</span>
        {job.salary && <><span className="dot">·</span>{job.salary}</>}
        {date && <><span className="dot">·</span>{date}</>}
        {job.contract_type && <><span className="dot">·</span>{job.contract_type}</>}
        {job.experience_required && <><span className="dot">·</span>{job.experience_required}</>}
      </div>

      <div className="panel-body">
        {job.stack?.length > 0 && (
          <div className="detail-section">
            <h4>Stack</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {job.stack.map((s, i) => (
                <span key={i} style={{ fontSize: 11, padding: '2px 7px', background: 'rgba(99,102,241,0.12)', color: '#818cf8', borderRadius: 4 }}>
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {job.reasoning && (
          <div className="detail-section">
            <h4>Scorer Reasoning</h4>
            <p>{job.reasoning}</p>
          </div>
        )}

        {job.highlights && (
          <div className="detail-section">
            <h4>Highlights</h4>
            <p className="highlight-p">{job.highlights}</p>
          </div>
        )}

        {flags.length > 0 && (
          <div className="detail-section">
            <h4>Eligibility Flags</h4>
            <div className="flags-list">
              {flags.map((f, i) => (
                <span key={i} className="flag-tag">⚠ {f}</span>
              ))}
            </div>
          </div>
        )}

        {job.url && (
          <div className="detail-section">
            <h4>Link</h4>
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 11, color: 'var(--accent)', wordBreak: 'break-all' }}
            >
              {job.url}
            </a>
          </div>
        )}

        {job.description && (
          <div className="detail-section">
            <h4>Description</h4>
            <div className="description-text">{job.description}</div>
          </div>
        )}
      </div>

      <div className="panel-footer">
        <div className="action-buttons">
          {actions.map(({ key, label }) => (
            <button
              key={key}
              className={`action-btn ${key}${job.status === key ? ' is-active' : ''}`}
              onClick={() => handleAction(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="footer-status">
          <span className={`status-badge status-${job.status}`}>{job.status}</span>
        </div>
      </div>
    </>
  )
}
