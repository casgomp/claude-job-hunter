import { useEffect } from 'react'

function cleanLocation(loc) {
  if (!loc) return '—'
  return loc.replace(/\s*\(.*?\)\s*/g, '').trim() || loc.trim()
}

function formatDate(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function JobDetail({ job, onClose, onStatusUpdate }) {
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const tierCls  = `tier${job.tier}`
  const workType = job._work_type || 'remote'
  const location = cleanLocation(job.location)
  const date     = formatDate(job.date_posted)
  const flags    = job.eligibility_flags ?? []

  const actions = [
    { key: 'saved',    label: '💾 Save' },
    { key: 'applied',  label: '✓ Applied' },
    { key: 'rejected', label: '✗ Reject' },
  ]

  const handleAction = (status) => {
    // clicking the active status resets it to 'new'
    onStatusUpdate(job.id, job.status === status ? 'new' : status)
  }

  return (
    <div
      className="modal-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="modal">
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-row">
            <span className={`tier-badge ${tierCls}`} style={{ flexShrink: 0, marginTop: 2 }}>
              Tier {job.tier}
            </span>
            <h2 className="modal-title">{job.title}</h2>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Meta row */}
        <div className="modal-meta">
          <strong>{job.company}</strong>
          <span className="dot">·</span>
          <span>{location}</span>
          <span className="dot">·</span>
          <span className={`work-badge ${workType}`}>{workType}</span>
          <span className="dot">·</span>
          <span>Score <strong>{job.score ?? '—'}/10</strong></span>
          <span className="dot">·</span>
          <span className="source-badge">{job.source}</span>
          {job.salary && <><span className="dot">·</span><span>{job.salary}</span></>}
          {date && <><span className="dot">·</span><span>{date}</span></>}
        </div>

        {/* Body */}
        <div className="modal-body">
          <div className="modal-left">
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
                    <span key={i} className="flag-tag lg">⚠ {f}</span>
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
                  style={{ fontSize: 12, color: 'var(--accent)', wordBreak: 'break-all' }}
                >
                  {job.url}
                </a>
              </div>
            )}
          </div>

          <div className="modal-right">
            <div className="detail-section">
              <h4>Description</h4>
              <div className="description-text">
                {job.description || 'No description available.'}
              </div>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="modal-footer">
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
            Status: <span className={`status-badge status-${job.status}`}>{job.status}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
