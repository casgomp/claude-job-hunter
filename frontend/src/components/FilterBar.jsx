export default function FilterBar({ filters, onChange }) {
  const set = (key, val) => onChange(prev => ({ ...prev, [key]: val }))

  const statuses  = ['all', 'new', 'saved', 'applied', 'rejected']
  const workTypes = ['all', 'remote', 'hybrid', 'onsite']

  return (
    <div className="filter-bar">
      <div className="filter-group">
        <span className="filter-label">Status</span>
        {statuses.map(s => (
          <button
            key={s}
            className={`filter-btn ${filters.status === s ? 'active' : ''}`}
            onClick={() => set('status', s)}
          >
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <div className="filter-group">
        <span className="filter-label">Work type</span>
        {workTypes.map(w => (
          <button
            key={w}
            className={`filter-btn ${filters.workType === w ? 'active' : ''}`}
            onClick={() => set('workType', w)}
          >
            {w === 'all' ? 'All' : w.charAt(0).toUpperCase() + w.slice(1)}
          </button>
        ))}
      </div>

      <div className="filter-group">
        <span className="filter-label">Min score: {filters.minScore}</span>
        <input
          type="range" min="1" max="10"
          value={filters.minScore}
          onChange={e => set('minScore', Number(e.target.value))}
          className="score-slider"
        />
      </div>
    </div>
  )
}
