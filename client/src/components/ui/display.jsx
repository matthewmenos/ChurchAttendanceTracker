import { initials } from '../../utils/format.js';

const STATUS_LABELS = { present: 'Present', absent: 'Absent', excused: 'Excused', unmarked: 'Unmarked' };

export function Badge({ variant = 'neutral', children }) {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}

export function StatusBadge({ status }) {
  if (!status) return <Badge variant="neutral">Unmarked</Badge>;
  return <Badge variant={status}>{STATUS_LABELS[status] || status}</Badge>;
}

export function Avatar({ name, size = '' }) {
  return <span className={`avatar ${size}`.trim()} aria-hidden="true">{initials(name)}</span>;
}

export function StatCard({ label, value, sub, tone = 'blue', loading }) {
  return (
    <div className={`stat-card stat-${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{loading ? '…' : value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Tabs({ tabs, active, onChange, ariaLabel = 'Tabs' }) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          className={`tab${active === tab.key ? ' active' : ''}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Present / Absent / Excused segmented control (radiogroup semantics). */
export function StatusButtons({ value, onChange, disabled, ariaLabel, size = '' }) {
  const options = [
    ['present', 'P'],
    ['absent', 'A'],
    ['excused', 'E'],
  ];
  return (
    <div className={`seg ${size}`.trim()} role="radiogroup" aria-label={ariaLabel}>
      {options.map(([key, letter]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          disabled={disabled}
          className={`seg-btn seg-${key}${value === key ? ' active' : ''}`}
          onClick={() => onChange(key)}
        >
          <span aria-hidden="true">{letter}</span>
          <span className="sr-only">
            {key.charAt(0).toUpperCase() + key.slice(1)}
          </span>
        </button>
      ))}
    </div>
  );
}