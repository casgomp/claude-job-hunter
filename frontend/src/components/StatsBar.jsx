export default function StatsBar({ stats, jobs }) {
  if (!stats) return <div className="stats-bar" />

  const saved   = jobs.filter(j => j.status === 'saved').length
  const applied = jobs.filter(j => j.status === 'applied').length

  const items = [
    { label: 'Total',   value: stats.total,                    cls: '' },
    { label: 'Tier 1',  value: stats.tier_breakdown?.[1] ?? 0, cls: 'tier1' },
    { label: 'Tier 2',  value: stats.tier_breakdown?.[2] ?? 0, cls: 'tier2' },
    { label: 'Tier 3',  value: stats.tier_breakdown?.[3] ?? 0, cls: 'tier3' },
    null, // separator
    { label: 'Saved',   value: saved,   cls: 'saved' },
    { label: 'Applied', value: applied, cls: 'applied' },
  ]

  return (
    <div className="stats-bar">
      {items.map((item, i) =>
        item === null
          ? <div key={i} className="stats-sep" />
          : (
            <div key={item.label} className={`stat-item ${item.cls}`}>
              <span className="stat-value">{item.value}</span>
              <span className="stat-label">{item.label}</span>
            </div>
          )
      )}
    </div>
  )
}
