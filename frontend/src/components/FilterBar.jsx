export default function FilterBar({ filters, onChange }) {
  const set = (key, val) => onChange(prev => ({ ...prev, [key]: val }))

  const tiers    = ['all', '1', '2', '3']
  const statuses = ['all', 'new', 'saved', 'applied', 'rejected']

  return (
    <div className="filter-bar">
      <div className="filter-group">
        <span className="filter-label">Tier</span>
        {tiers.map(t => (
          <button
            key={t}
            className={`filter-btn ${t !== 'all' ? `t${t}` : ''} ${filters.tier === t ? 'active' : ''}`}
            onClick={() => set('tier', t)}
          >
            {t === 'all' ? 'All' : `T${t}`}
          </button>
        ))}
      </div>

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
        <span className="filter-label">Min score: {filters.minScore}</span>
        <input
          type="range" min="1" max="10"
          value={filters.minScore}
          onChange={e => set('minScore', Number(e.target.value))}
          className="score-slider"
        />
      </div>

      <label className="toggle-label">
        <input
          type="checkbox"
          checked={filters.hideTier3}
          onChange={e => set('hideTier3', e.target.checked)}
        />
        Hide Tier 3
      </label>
    </div>
  )
}
