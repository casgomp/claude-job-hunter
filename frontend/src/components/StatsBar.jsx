export default function StatsBar({ stats, jobs }) {
  if (!stats) return <div className="stats-bar" />

  const saved   = jobs.filter(j => j.status === 'saved').length
  const applied = jobs.filter(j => j.status === 'applied').length

  return (
    <div className="stats-bar">
      <div className="stat-item">
        <span className="stat-value">{stats.total}</span>
        <span className="stat-label">Total</span>
      </div>
      <div className="stats-sep" />
      <div className="stat-item saved">
        <span className="stat-value">{saved}</span>
        <span className="stat-label">Saved</span>
      </div>
      <div className="stat-item applied">
        <span className="stat-value">{applied}</span>
        <span className="stat-label">Applied</span>
      </div>
    </div>
  )
}
