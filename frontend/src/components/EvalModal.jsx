const TYPE_LABELS = {
  obvious_error:  'Obvious Error',
  inconsistency:  'Inconsistency',
  us_restricted:  'US-Restricted',
  german_only:    'German-Only',
  source_bias:    'Source Bias',
}

const QUALITY_COLOR = {
  good: 'var(--score-high)',
  fair: 'var(--score-mid)',
  poor: 'var(--score-low)',
}

const TYPE_COLOR = {
  obvious_error: 'var(--score-low)',
  inconsistency: 'var(--score-mid)',
  us_restricted: 'var(--score-low)',
  german_only:   'var(--score-mid)',
  source_bias:   '#a78bfa',
}

export default function EvalModal({ state, report, error, onClose, onRun }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="eval-modal">
        <div className="eval-modal-header">
          <h2>Scoring Evaluator</h2>
          <button className="panel-close" onClick={onClose}>✕</button>
        </div>

        {state === 'idle' && (
          <div className="eval-idle">
            <p>Sends all scored jobs to Claude for a quality audit — checks for mis-scores, inconsistencies, and slipped US/German-only listings.</p>
            <button className="btn-scrape" onClick={onRun}>Run Evaluation</button>
          </div>
        )}

        {state === 'loading' && (
          <div className="eval-loading">
            <span className="spinner" />
            <span>Analysing {'…'}</span>
          </div>
        )}

        {state === 'error' && (
          <div className="eval-error">
            <p style={{ color: 'var(--score-low)' }}>Error: {error}</p>
            <button className="btn-scrape" onClick={onRun} style={{ marginTop: 12 }}>Retry</button>
          </div>
        )}

        {state === 'done' && report && (
          <div className="eval-report">
            <div className="eval-summary-row">
              <div className="eval-badge" style={{ color: QUALITY_COLOR[report.overall_quality] }}>
                {report.overall_quality?.toUpperCase()}
              </div>
              <div className="eval-meta">
                <span>Confidence: <strong>{report.confidence}</strong></span>
                <span className="dot">·</span>
                <span>{report.jobs_evaluated} jobs</span>
                <span className="dot">·</span>
                <span>{new Date(report.generated_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <button className="action-btn cv-btn" onClick={onRun} style={{ marginLeft: 'auto' }}>
                Re-run
              </button>
            </div>

            <p className="eval-summary-text">{report.summary}</p>

            {report.issues?.length > 0 ? (
              <div className="eval-section">
                <h4>Issues ({report.issues.length})</h4>
                <div className="eval-issues">
                  {report.issues.map((issue, i) => (
                    <div key={i} className="eval-issue">
                      <div className="eval-issue-header">
                        <span className="eval-type-tag" style={{ color: TYPE_COLOR[issue.type] }}>
                          {TYPE_LABELS[issue.type] ?? issue.type}
                        </span>
                        <span className="eval-issue-title">{issue.title} @ {issue.company}</span>
                        <span className="eval-issue-score">({issue.score ?? '?'}/10)</span>
                      </div>
                      <p className="eval-issue-desc">{issue.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="eval-no-issues">No issues found — scores look well-calibrated.</p>
            )}

            {report.recommendations?.length > 0 && (
              <div className="eval-section">
                <h4>Recommendations</h4>
                <ul className="eval-recs">
                  {report.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
