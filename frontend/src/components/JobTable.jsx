import { parseCity, parseCountry } from '../App'

const COLUMNS = [
  { key: 'score',               label: 'Match',    sortable: true,  cls: 'col-match'   },
  { key: 'title',               label: 'Title',    sortable: true,  cls: 'col-title'   },
  { key: 'company',             label: 'Company',  sortable: true,  cls: 'col-company' },
  { key: 'city',                label: 'City',     sortable: true,  cls: 'col-city'    },
  { key: 'country',             label: 'Country',  sortable: true,  cls: 'col-country' },
  { key: 'work_type',           label: 'Work type',sortable: true,  cls: 'col-worktype'},
  { key: 'stack',               label: 'Stack',    sortable: false, cls: 'col-stack'   },
  { key: 'experience_required', label: 'Exp.',     sortable: true,  cls: 'col-exp'     },
  { key: 'contract_type',       label: 'Contract', sortable: true,  cls: 'col-contract'},
  { key: 'flag_count',          label: '⚠',        sortable: true,  cls: 'col-flags'   },
  { key: 'status',              label: 'Status',   sortable: true,  cls: 'col-status'  },
  { key: 'rated',               label: '★',        sortable: true,  cls: 'col-rated'   },
]

function scoreClass(score) {
  if (score == null) return 'score-none'
  if (score >= 7)   return 'score-high'
  if (score >= 4)   return 'score-mid'
  return 'score-low'
}

function shortStack(stack) {
  if (!stack?.length) return null
  if (stack.length <= 3) return stack.join(', ')
  return `${stack.slice(0, 3).join(', ')} +${stack.length - 3}`
}

export default function JobTable({ jobs, selectedJobId, sortConfig, onSort, onJobClick }) {
  if (jobs.length === 0) {
    return <p className="state-msg">No jobs match your filters.</p>
  }

  return (
    <table className="jobs-table">
      <thead>
        <tr>
          {COLUMNS.map(col => {
            const isActive = sortConfig.key === col.key
            return (
              <th
                key={col.key}
                className={`${col.cls} ${col.sortable ? 'sortable' : ''} ${isActive ? 'active-sort' : ''}`}
                onClick={() => col.sortable && onSort(col.key)}
              >
                {col.label}
                {col.sortable && isActive && (
                  <i className="sort-arrow">{sortConfig.dir === 'asc' ? '↑' : '↓'}</i>
                )}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {jobs.map(job => {
          const city       = parseCity(job.location, job.work_type)
          const country    = parseCountry(job.location, job.country)
          const stack      = shortStack(job.stack)
          const flags      = job.eligibility_flags?.length ?? 0
          const isRated    = job.rating != null
          const isSelected = job.id === selectedJobId

          return (
            <tr
              key={job.id}
              className={`status-${job.status} ${isSelected ? 'selected' : ''}`}
              onClick={() => onJobClick(job)}
            >
              <td className={`col-match score-cell ${scoreClass(job.score)}`}>
                {job.score ?? '—'}
              </td>
              <td className="col-title">
                <div className="title-cell">{job.title}</div>
              </td>
              <td className="col-company">{job.company || <span className="muted">—</span>}</td>
              <td className="col-city">{city || <span className="muted">—</span>}</td>
              <td className="col-country">{country || <span className="muted">—</span>}</td>
              <td className="col-worktype">
                {job.work_type
                  ? <span className={`work-badge ${job.work_type}`}>{job.work_type}</span>
                  : <span className="muted">—</span>}
              </td>
              <td className="col-stack">
                <span className="stack-cell">{stack || <span className="muted">—</span>}</span>
              </td>
              <td className="col-exp">{job.experience_required || <span className="muted">—</span>}</td>
              <td className="col-contract">{job.contract_type || <span className="muted">—</span>}</td>
              <td className="col-flags">
                {flags > 0
                  ? <span className="flag-warn">⚠ {flags}</span>
                  : <span className="muted">—</span>}
              </td>
              <td className="col-status">
                <span className={`status-badge status-${job.status}`}>{job.status}</span>
              </td>
              <td className="col-rated">
                {isRated
                  ? <span className="rated-check">✓</span>
                  : <span className="muted">—</span>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
