import { useState } from 'react'
import { parseCity, parseCountry } from '../App'

const API = 'http://172.31.202.183:5000'

function formatDate(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Stars({ value, onChange }) {
  const [hovered, setHovered] = useState(null)
  const display = hovered ?? value ?? 0
  return (
    <div className="star-input">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          className={`star-btn ${n <= display ? 'lit' : ''}`}
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(null)}
          onClick={() => onChange(value === n ? null : n)}
        >★</button>
      ))}
    </div>
  )
}

function RatingForm({ job, onSaved }) {
  const existing = job.rating
  const [eligibility,   setEligibility]   = useState(existing?.eligibility   ?? '')
  const [technicalFit,  setTechnicalFit]  = useState(existing?.technical_fit  ?? null)
  const [interestLevel, setInterestLevel] = useState(existing?.interest_level ?? null)
  const [notes,         setNotes]         = useState(existing?.notes          ?? '')
  const [saving,        setSaving]        = useState(false)
  const [saved,         setSaved]         = useState(false)

  const isDirty = eligibility  !== (existing?.eligibility   ?? '')   ||
                  technicalFit  !== (existing?.technical_fit  ?? null) ||
                  interestLevel !== (existing?.interest_level ?? null) ||
                  notes         !== (existing?.notes          ?? '')

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch(`${API}/api/jobs/${job.id}/rating`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          eligibility:   eligibility   || null,
          technical_fit: technicalFit,
          interest_level:interestLevel,
          notes:         notes         || null,
        }),
      })
      if (!res.ok) throw new Error('Save failed')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved?.({ eligibility, technical_fit: technicalFit, interest_level: interestLevel, notes })
    } catch (err) {
      console.error('[rating]', err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rating-form">
      <div className="rating-row">
        <label className="rating-label">Eligibility</label>
        <select
          className="rating-select"
          value={eligibility}
          onChange={e => setEligibility(e.target.value)}
        >
          <option value="">—</option>
          <option value="Yes">Yes</option>
          <option value="Maybe">Maybe</option>
          <option value="No">No</option>
        </select>
      </div>

      <div className="rating-row">
        <label className="rating-label">Tech fit</label>
        <Stars value={technicalFit} onChange={setTechnicalFit} />
      </div>

      <div className="rating-row">
        <label className="rating-label">Interest</label>
        <Stars value={interestLevel} onChange={setInterestLevel} />
      </div>

      <div className="rating-row rating-notes-row">
        <label className="rating-label">Notes</label>
        <input
          className="rating-notes"
          type="text"
          placeholder="Optional notes…"
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
      </div>

      <button
        className={`action-btn rating-save-btn ${saved ? 'is-saved' : ''}`}
        onClick={handleSave}
        disabled={saving || !isDirty}
      >
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save rating'}
      </button>
    </div>
  )
}

export default function JobDetail({ job, onClose, onStatusUpdate, onRatingUpdate }) {
  const city    = parseCity(job.location, job.work_type)
  const country = parseCountry(job.location, job.country)
  const date    = formatDate(job.date_posted)
  const flags   = job.eligibility_flags ?? []

  const [cvState, setCvState] = useState(
    job.cv_generated ? 'done' : 'idle'
  )
  const [cvUrl, setCvUrl] = useState(null)

  const actions = [
    { key: 'saved',    label: '💾 Save' },
    { key: 'applied',  label: '✓ Applied' },
    { key: 'rejected', label: '✗ Reject' },
  ]

  const handleAction = (status) => {
    onStatusUpdate(job.id, job.status === status ? 'new' : status)
  }

  const handleGenerateCv = async () => {
    setCvState('loading')
    setCvUrl(null)
    try {
      const res = await fetch(`${API}/api/jobs/${job.id}/generate-cv`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Generation failed')
      }
      const data = await res.json()
      setCvUrl(`${API}${data.url}`)
      setCvState('done')
    } catch (err) {
      console.error('[cv]', err.message)
      setCvState('error')
    }
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

        <div className="detail-section">
          <h4>Your Rating</h4>
          <RatingForm job={job} onSaved={rating => onRatingUpdate?.(job.id, rating)} />
        </div>

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

        <div className="cv-section">
          {cvState === 'idle' && (
            <button className="action-btn cv-btn" onClick={handleGenerateCv}>
              ✦ Generate CV
            </button>
          )}
          {cvState === 'loading' && (
            <span className="cv-loading">Generating CV…</span>
          )}
          {cvState === 'done' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <a
                href={cvUrl || '#'}
                download
                className="action-btn cv-btn is-active"
              >
                ↓ Download CV
              </a>
              <button className="action-btn cv-btn" onClick={handleGenerateCv} style={{ opacity: 0.6, fontSize: 10 }}>
                Regenerate
              </button>
            </div>
          )}
          {cvState === 'error' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--score-low)' }}>Generation failed</span>
              <button className="action-btn cv-btn" onClick={handleGenerateCv}>Retry</button>
            </div>
          )}
        </div>

        <div className="footer-status">
          <span className={`status-badge status-${job.status}`}>{job.status}</span>
        </div>
      </div>
    </>
  )
}
